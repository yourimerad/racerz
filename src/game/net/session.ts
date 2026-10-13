import type { Car } from "../car";
import { type MultiPlayer, type Race, blastRemote } from "../race";
import { mulberry32 } from "../scenery";
import type { ThemeId } from "../themes";
import { locate } from "../track";
import { vec } from "../vec";
import { planTables, shuffled } from "./matchmaking";
import { type Member, type Snap, type StartMsg, NET, cleanCode, interpDelay, makeRoomCode, parseMember, parseMsg, queueChannel, raceChannel, roomChannel, snapOf, snapshotHz } from "./protocol";
import type { Channel, Transport } from "./transport";

// The online mode, from "I want to play with others" to "the race is over". Two parts, both independent of how messages travel:
//   NetSession — finding a game: the quick-match queue of a mode, or a friends' room with a four-letter code; who is there; who starts; the
//                start message (game id, shared seed, the grid in order, the host).
//   RaceSync   — the start (everybody says "ready", the host gives one green light for all), then during the race: tells the others where
//                our car is ten times a second, shows theirs by blending the snapshots we get, and knows when everybody is done. Every game plays its own car; nothing here can move our car, only the opponents' copies.

// ---------- time ----------

/** The clock the session uses: the real one, or one a test moves by hand. */
export type Clock = {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
};

export const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
  after: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export class ManualClock implements Clock {
  t = 0;
  private timers: { id: number; at: number; every: number | null; fn: () => void }[] = [];
  private nextId = 1;
  now() {
    return this.t;
  }
  every(ms: number, fn: () => void) {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, every: ms, fn });
    return () => this.cancel(id);
  }
  after(ms: number, fn: () => void) {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, every: null, fn });
    return () => this.cancel(id);
  }
  private cancel(id: number) {
    this.timers = this.timers.filter((x) => x.id !== id);
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: (typeof this.timers)[number] | null = null;
      for (const x of this.timers) if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      if (!next) break;
      this.t = next.at;
      if (next.every !== null) next.at += next.every;
      else this.cancel(next.id);
      next.fn();
    }
    this.t = end;
  }
}

// ---------- finding a game ----------

export type SessionPhase = "idle" | "connecting" | "searching" | "room" | "starting";
export type SessionState = {
  phase: SessionPhase;
  /** "quick": a game with whoever is waiting. "friends": a room with a code. */
  kind: "quick" | "friends" | null;
  mode: ThemeId;
  /** The friends' room's code. */
  code: string | null;
  /** Everybody in the queue / room (this player included), longest-waiting first. */
  members: Member[];
  /** The first of them: in a friends' room, the one who picks the mode and starts. */
  isHost: boolean;
  error: string | null;
};

/**
 * A game that is about to start: what every game needs to build the same race. The green light is not part of it: it is set once every game
 * says it is ready, by the `host` (see `RaceSync`).
 */
export type StartInfo = { game: string; mode: ThemeId; seed: number; players: MultiPlayer[]; host: string };

/** The place of someone who has not yet seen the room (after everybody). */
const JOINING = 1e15;

export const IDLE_SESSION: SessionState = { phase: "idle", kind: null, mode: "countryside", code: null, members: [], isHost: false, error: null };

export class NetSession {
  private transport: Transport;
  private clock: Clock;
  private random: () => number;
  private me: MultiPlayer;
  private state: SessionState = IDLE_SESSION;
  private listeners = new Set<() => void>();
  private channel: Channel | null = null;
  private myMeta: Member | null = null;
  private stops: (() => void)[] = [];
  private gen = 0;
  private started = new Set<string>();
  private startHandler: ((info: StartInfo) => void) | null = null;
  /** A friend who joins a room has no place in it yet: it takes one once it has seen who is there (see onPresence). */
  private joining = false;
  private upAt: number | null = null;

  constructor(transport: Transport, me: MultiPlayer, clock: Clock = realClock, random: () => number = Math.random) {
    this.transport = transport;
    this.me = me;
    this.clock = clock;
    this.random = random;
  }

  getState = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Who this player is (name, car, paint): taken when a search or a room begins. */
  setIdentity(me: MultiPlayer) {
    this.me = me;
  }
  /** Called once, when a game this player is in is about to start. */
  onStart(h: (info: StartInfo) => void) {
    this.startHandler = h;
  }

  quickMatch(mode: ThemeId) {
    this.begin("quick", mode, null, queueChannel(mode), this.clock.now());
  }
  createRoom(mode: ThemeId) {
    const code = makeRoomCode(this.random);
    this.begin("friends", mode, code, roomChannel(code), 0); // the creator is first, whatever its clock says
  }
  /** Joins the room with the code a friend gave. False when what was typed cannot be a code. */
  joinRoom(text: string): boolean {
    const code = cleanCode(text);
    if (!code) {
      this.set({ error: "Ce code n'est pas valide : 4 lettres ou chiffres." });
      return false;
    }
    this.begin("friends", this.state.mode, code, roomChannel(code), JOINING);
    return true;
  }

  /**
   * `since` is the order players are in: in the quick-match queue the time one started waiting (their own clock: only the leader reads
   * the waiting time, from its own entry); in a friends' room a place that no clock decides (the creator 0, a guest after everybody it sees).
   */
  private begin(kind: "quick" | "friends", mode: ThemeId, code: string | null, name: string, since: number) {
    this.cleanup();
    const token = ++this.gen;
    const meta: Member = { ...this.me, since, mode };
    this.joining = since === JOINING;
    this.upAt = null;
    this.myMeta = meta;
    this.set({ phase: "connecting", kind, mode, code, members: [], isHost: false, error: null });
    this.channel = this.transport.join(name, meta, {
      onMessage: (raw) => token === this.gen && this.onMessage(raw),
      onPresence: (raw) => token === this.gen && this.onPresence(raw),
      onStatus: (status, detail) => token === this.gen && this.onStatus(status, detail),
    });
    this.stops.push(this.clock.every(1000, () => token === this.gen && this.consider()));
    // A server that never answers must not leave the screen waiting for ever.
    this.stops.push(
      this.clock.after(10_000, () => {
        if (token === this.gen && this.state.phase === "connecting") this.fail("Impossible de joindre le serveur de jeu. Réessaie dans un instant.");
      }),
    );
  }

  private onStatus(status: "joined" | "error" | "closed", detail?: string) {
    if (status === "joined" && this.state.phase === "connecting") {
      this.upAt = this.clock.now();
      if (this.state.kind === "quick") {
        this.set({ phase: "searching" });
        this.consider();
      } else if (!this.joining) this.set({ phase: "room" });
    } else if (status === "error") this.fail(`Connexion au serveur de jeu impossible${detail ? ` (${detail})` : ""}.`);
    else if (status === "closed" && (this.state.phase === "searching" || this.state.phase === "room" || this.state.phase === "connecting")) this.fail("La connexion au serveur de jeu a été perdue.");
  }

  private onPresence(raw: unknown[]) {
    if (!this.myMeta) return;
    const seen = new Set<string>(), list: Member[] = [];
    for (const r of raw) {
      const m = parseMember(r);
      if (!m || seen.has(m.id) || m.id === this.me.id) continue; // our own entry is the local one: it cannot lag behind
      seen.add(m.id);
      list.push(m);
    }
    const friends = this.state.kind === "friends";
    // A guest takes its place after everybody who is there: no clock is compared with another (a phone running five seconds behind must not become host).
    let adopted = false;
    if (friends && this.joining) {
      const before = list.filter((m) => m.since < JOINING);
      if (before.length) {
        this.myMeta = { ...this.myMeta, since: Math.max(...before.map((m) => m.since)) + 1 };
        this.joining = false;
        adopted = true;
      }
    }
    list.push(this.myMeta);
    list.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (friends && list.findIndex((m) => m.id === this.me.id) >= NET.MAX_PLAYERS) {
      this.fail("Cette salle est pleine (4 joueurs).");
      return;
    }
    const members = friends ? list.slice(0, NET.MAX_PLAYERS) : list;
    const host = members[0];
    const isHost = !this.joining && host.id === this.me.id;
    const patch: Partial<SessionState> = { members, isHost };
    if (friends) {
      if (isHost && !this.state.isHost && this.myMeta.mode !== this.state.mode) {
        // Taking over a room: its mode stays what the room was showing.
        this.myMeta = { ...this.myMeta, mode: this.state.mode };
        adopted = true;
      } else if (!isHost && host.mode) patch.mode = host.mode; // in a friends' room the mode is the host's
    }
    if (adopted) this.channel?.track(this.myMeta);
    if (friends && !this.joining && this.state.phase === "connecting" && this.upAt !== null) patch.phase = "room";
    this.set(patch);
    this.consider();
  }

  /** Quick match: start the table this player leads, when it is ready. */
  private consider() {
    // A code nobody answers to: the room does not exist (or its creator has left).
    if (this.joining && this.upAt !== null && this.clock.now() - this.upAt > 4000) {
      this.fail("Salle introuvable. Vérifie le code avec ton ami.");
      return;
    }
    if (this.state.phase !== "searching") return;
    const table = planTables(this.state.members.map((m) => ({ id: m.id, since: m.since })), this.clock.now()).find((t) => t.ids.includes(this.me.id));
    if (!table || !table.ready || table.leader !== this.me.id) return;
    this.launch(this.state.members.filter((m) => table.ids.includes(m.id)));
  }

  /** The host of a friends' room picks the mode (the others see it follow). */
  setMode(mode: ThemeId) {
    if (this.state.kind !== "friends" || !this.state.isHost || !this.myMeta || !this.channel) return;
    this.myMeta = { ...this.myMeta, mode };
    this.channel.track(this.myMeta);
    this.set({ mode });
  }

  /** The host starts the room's game with everybody who is in it. */
  startRoom(): boolean {
    const s = this.state;
    if (s.kind !== "friends" || s.phase !== "room" || !s.isHost || s.members.length < NET.MIN_PLAYERS) return false;
    this.launch(s.members.slice(0, NET.MAX_PLAYERS));
    return true;
  }

  private launch(members: Member[]) {
    const seed = Math.floor(this.random() * 2 ** 32) >>> 0;
    const game = `${this.me.id.slice(0, 6)}${Math.floor(this.random() * 36 ** 5).toString(36).padStart(5, "0")}`;
    const strip = (m: Member): MultiPlayer => ({ id: m.id, name: m.name, model: m.model, skin: m.skin, level: m.level });
    const msg: StartMsg = {
      type: "start", game, mode: this.state.mode, seed, host: this.me.id,
      players: shuffled(members.map(strip), mulberry32(seed)),
    };
    const channel = this.channel, token = this.gen;
    channel?.send(msg);
    // A message can be lost: say it a few more times (a game already started is ignored).
    for (let i = 1; i < NET.START_REPEATS; i++) {
      this.stops.push(
        this.clock.after(i * NET.START_REPEAT_MS, () => {
          if (token === this.gen) channel?.send(msg);
        }),
      );
    }
    this.applyStart(msg);
  }

  private onMessage(raw: unknown) {
    const msg = parseMsg(raw);
    if (msg?.type !== "start") return;
    if (this.state.phase !== "searching" && this.state.phase !== "room") return;
    if (!msg.players.some((p) => p.id === this.me.id)) return;
    this.applyStart(msg);
  }

  private applyStart(msg: StartMsg) {
    if (this.started.has(msg.game)) return;
    this.started.add(msg.game);
    const info: StartInfo = { game: msg.game, mode: msg.mode, seed: msg.seed, players: msg.players, host: msg.host };
    this.set({ phase: "starting", mode: msg.mode });
    // A quick-match queue is left once the start message has been said enough times for everybody to hear it; a friends' room is kept for the next game.
    if (this.state.kind === "quick") {
      const token = this.gen;
      this.stops.push(
        this.clock.after(NET.START_REPEATS * NET.START_REPEAT_MS + 500, () => {
          if (token === this.gen) this.cleanup();
        }),
      );
    }
    this.startHandler?.(info);
  }

  /** Joins the game's own channel: what the race talks over. */
  beginRace(info: StartInfo): RaceSync {
    return new RaceSync(this.transport, this.me, info, this.clock);
  }

  /** The race is over: back to the friends' room, or out. */
  raceOver() {
    if (this.state.kind === "friends" && this.channel) this.set({ phase: "room" });
    else this.leave();
  }

  /** Stops searching / leaves the room. */
  leave() {
    this.cleanup();
    this.set({ ...IDLE_SESSION, mode: this.state.mode });
  }

  private fail(error: string) {
    this.cleanup();
    this.set({ ...IDLE_SESSION, mode: this.state.mode, error });
  }

  private cleanup() {
    this.gen++;
    for (const s of this.stops.splice(0)) s();
    this.channel?.leave();
    this.channel = null;
    this.myMeta = null;
    this.joining = false;
    this.upAt = null;
  }

  /** Drops everything (the page is closing). */
  dispose() {
    this.cleanup();
    this.transport.close?.();
  }
}

// ---------- during the race ----------

type Stamped = { rt: number; snap: Snap };

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpAngle = (a: number, b: number, u: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
};

/** How long a race counts down before the green light (race.ts: COUNTDOWN). */
const COUNTDOWN_MS = 3000;

/** What the start screen can say: how many of the players have said they are ready. */
export type Lobby = { ready: number; total: number };

/**
 * One race, from "everybody has been told" to "everybody is done".
 *
 * The start. Every game builds the race and gets its 3D view ready, which takes each machine a different time, then says `ready`. The host
 * (the player who started the game; if it is gone or never shows up, the next on the list) waits until every game present has said so, or
 * `NET.READY_MAX_MS` has passed, and then sets the green light `NET.GO_LEAD_MS` ahead and says `go`. That message is a duration, "in so many
 * ms", never a time of day, so no machine's clock is compared with another's: the receiver puts the green light at the moment the message
 * arrived plus that duration, less half of the round trip to the host measured with `ping`/`pong` (the shortest one seen), and keeps the
 * earliest of the copies it gets (the host repeats it): the one that travelled fastest. A game that is slow, or late, or whose `go` was lost,
 * keeps saying `ready` and is told again, with the green light already behind it, so it joins the race where it is.
 */
export class RaceSync {
  readonly info: StartInfo;
  private clock: Clock;
  private me: MultiPlayer;
  private channel: Channel;
  private joined = false;
  private buf = new Map<string, Stamped[]>();
  private lastSeq = new Map<string, number>();
  private heardAt = new Map<string, number>();
  /** Each opponent's race time in its last snapshot: how far its game has got. */
  private gameTime = new Map<string, number>();
  private present = new Set<string>();
  private everPresent = new Set<string>();
  private left = new Set<string>();
  private seq = 0;
  private lastSent = -1e9;
  private lastKey = "";
  private begun = false;
  private closed = false;
  /** Opponents that have left (or stopped answering), by player id, and when we decided so: shown as out of the race until they speak again. */
  private goneAt = new Map<string, number>();
  // --- the start ---
  private startedAt: number;
  /** The players in the order they may give the green light: the host first, then the grid. */
  private order: string[];
  /** Our game is ready (built, 3D up), and who else has said so. */
  private isReady = false;
  private readyAt = 0;
  private readyFrom = new Set<string>();
  private lastReady = -1e9;
  /** The green light on this machine's clock (null until a `go` has been heard or given), and the position in `order` of whoever it came from. */
  private goTime: number | null = null;
  private goBy = Infinity;
  /** Where the green light would fall with no trip taken off (the earliest arrival of the host's message + what it says), and who said it. */
  private goRaw = Infinity;
  private goFrom: string | null = null;
  /** We are the one giving the green light: how many times it was said, and when last. */
  private deciding = false;
  private goSaid = 0;
  private lastGo = -1e9;
  private answeredReady = new Map<string, number>();
  /** The shortest round trips (ms) to each player, from `ping`s, and the pings in flight. */
  private trips = new Map<string, number[]>();
  private pingsOut = new Map<number, number>();
  private pingN = 0;
  private lastPing = -1e9;
  /** When we heard anything from each player, and since when one has been missing from the race channel's presence. */
  private lastSeen = new Map<string, number>();
  private absentSince = new Map<string, number>();
  private stopTimer: () => void;

  constructor(transport: Transport, me: MultiPlayer, info: StartInfo, clock: Clock) {
    this.info = info;
    this.me = me;
    this.clock = clock;
    this.startedAt = clock.now();
    this.order = [info.host, ...info.players.map((p) => p.id).filter((id) => id !== info.host)];
    const meta: Member = { ...me, since: clock.now() };
    this.channel = transport.join(raceChannel(info.game), meta, {
      onMessage: (raw) => this.onMessage(raw),
      onPresence: (raw) => this.onPresence(raw),
      onStatus: (status) => {
        if (status === "joined") this.joined = true;
      },
    });
    this.stopTimer = clock.every(100, () => this.step());
  }

  private inGame(id: string) {
    return this.info.players.some((p) => p.id === id);
  }

  private onMessage(raw: unknown) {
    if (this.closed) return;
    const msg = parseMsg(raw);
    if (!msg) return;
    if (msg.type === "bye") {
      if (msg.from !== this.me.id) this.left.add(msg.from);
      return;
    }
    if (msg.type === "start" || msg.from === this.me.id || !this.inGame(msg.from)) return;
    this.lastSeen.set(msg.from, this.clock.now());
    if (msg.type === "ready") return this.onReady(msg.from);
    if (msg.type === "go") return this.onGo(msg.from, msg.in);
    if (msg.type === "ping") {
      if (msg.to === this.me.id && this.joined) this.channel.send({ type: "pong", from: this.me.id, to: msg.from, n: msg.n });
      return;
    }
    if (msg.type === "pong") return this.onPong(msg.from, msg.to, msg.n);
    if (msg.type !== "snap") return;
    if (msg.snap.s <= (this.lastSeq.get(msg.from) ?? -1)) return; // older than one we have
    this.lastSeq.set(msg.from, msg.snap.s);
    const now = this.clock.now();
    this.heardAt.set(msg.from, now);
    this.gameTime.set(msg.from, msg.snap.t);
    this.left.delete(msg.from); // it spoke: it is there
    let b = this.buf.get(msg.from);
    if (!b) this.buf.set(msg.from, (b = []));
    b.push({ rt: now, snap: msg.snap });
    while (b.length > 24 || (b.length > 3 && now - b[0].rt > 2000)) b.shift();
  }

  private onPresence(raw: unknown[]) {
    if (this.closed) return;
    const ids = new Set<string>();
    for (const r of raw) {
      const m = parseMember(r);
      if (m) ids.add(m.id);
    }
    const now = this.clock.now();
    for (const id of ids) {
      this.everPresent.add(id);
      this.absentSince.delete(id);
    }
    for (const id of this.everPresent) if (!ids.has(id) && !this.absentSince.has(id)) this.absentSince.set(id, now);
    this.present = ids;
  }

  // ---------- the start ----------

  /** Our game is ready: the race is built and the 3D view is up (or will not be). Says so to the others, and keeps saying it until the green light is heard. Once. */
  setReady() {
    if (this.closed || this.isReady) return;
    this.isReady = true;
    this.readyAt = this.clock.now();
    this.readyFrom.add(this.me.id);
    this.step();
  }

  /**
   * Whether a player is out of the start: said goodbye, or has been missing from the channel for a moment and has not been heard from, or
   * never came to the channel at all (it joins as soon as it has the start message, however long its 3D takes to load).
   */
  private isAbsent(id: string, now: number): boolean {
    if (this.left.has(id)) return true;
    if (!this.everPresent.has(id) && !this.lastSeen.has(id)) return now - this.startedAt >= NET.JOIN_MAX_MS;
    const since = this.absentSince.get(id);
    return since !== undefined && now - since >= NET.ABSENT_MS && now - (this.lastSeen.get(id) ?? -1e9) > NET.ABSENT_MS;
  }

  /**
   * Who gives the green light: the first on the list that is still there. Once the wait is over (`READY_MAX_MS`, plus a grace) a player who has
   * not even said it is ready is passed over too, so a host stuck loading does not hold the others up.
   */
  private leader(now: number): string {
    const late = now - this.startedAt >= NET.READY_MAX_MS + NET.HOST_GRACE_MS;
    for (const id of this.order) {
      if (id === this.me.id) return id;
      if (this.isAbsent(id, now) || (late && !this.readyFrom.has(id))) continue;
      return id;
    }
    return this.me.id;
  }

  /** Who the start is waiting for, as a count: the players that are still there, and how many of them are ready. */
  lobby(): Lobby | null {
    if (this.goTime !== null) return null;
    const now = this.clock.now(), here = this.info.players.filter((p) => p.id === this.me.id || !this.isAbsent(p.id, now));
    return { ready: here.filter((p) => this.readyFrom.has(p.id)).length, total: here.length };
  }

  private send(msg: Parameters<Channel["send"]>[0]): boolean {
    if (this.closed || !this.joined) return false;
    this.channel.send(msg);
    return true;
  }

  /** Called every 100 ms (and when something changes): says "ready" again, gives the green light when it is time, repeats it, measures the trip to the host. */
  private step() {
    if (this.closed) return;
    const now = this.clock.now();
    const leader = this.leader(now);
    // The host (or whoever stands in for it) gives the green light once every game that is there is ready, or the wait is over.
    // (A host that comes back after the wait is over listens a moment first: the next player may have given it already.)
    const listening = now - this.startedAt >= NET.READY_MAX_MS + NET.HOST_GRACE_MS && now - this.readyAt < NET.LISTEN_MS;
    if (this.goTime === null && this.isReady && leader === this.me.id && !listening) {
      const waiting = this.info.players.some((p) => p.id !== this.me.id && !this.readyFrom.has(p.id) && !this.isAbsent(p.id, now));
      if (!waiting || now - this.startedAt >= NET.READY_MAX_MS) {
        this.goTime = now + NET.GO_LEAD_MS;
        this.goBy = this.order.indexOf(this.me.id);
        this.deciding = true;
      }
    }
    if (this.deciding && this.goSaid < NET.GO_REPEATS && now - this.lastGo >= NET.GO_REPEAT_MS) this.sayGo(now, true);
    // A game that has not heard the green light keeps saying it is ready.
    if (this.goTime === null && this.isReady && now - this.lastReady >= NET.READY_REPEAT_MS && this.send({ type: "ready", from: this.me.id })) this.lastReady = now;
    // …and, until the race has begun, measures how long a message takes to the one who gives (or has given) the green light: often at first, then now and then.
    const caller = this.goFrom ?? leader;
    if (!this.begun && !this.deciding && caller !== this.me.id) {
      const samples = this.trips.get(caller)?.length ?? 0;
      if (now - this.lastPing >= (samples < NET.PING_SAMPLES ? NET.PING_EVERY_MS : NET.PING_EVERY_MS * 3)) {
        const n = this.pingN++;
        if (this.send({ type: "ping", from: this.me.id, to: caller, n })) {
          this.lastPing = now;
          this.pingsOut.set(n, now);
          this.pingsOut.delete(n - 16);
        }
      }
    }
  }

  private sayGo(now: number, burst: boolean) {
    if (this.goTime === null || !this.send({ type: "go", from: this.me.id, in: Math.round(this.goTime - now) })) return;
    this.lastGo = now;
    if (burst) this.goSaid++;
  }

  private onReady(from: string) {
    this.readyFrom.add(from);
    const now = this.clock.now();
    // The green light is already set and this game is still asking: tell it again (it may have been lost, or this game may be late).
    if (this.deciding && now - (this.answeredReady.get(from) ?? -1e9) >= NET.GO_REPEAT_MS) {
      this.answeredReady.set(from, now);
      this.sayGo(now, false);
    }
    this.step();
  }

  private onPong(from: string, to: string, n: number) {
    const sent = this.pingsOut.get(n);
    if (to !== this.me.id || sent === undefined) return;
    this.pingsOut.delete(n);
    const list = this.trips.get(from) ?? [];
    list.push(Math.max(0, this.clock.now() - sent));
    if (list.length > 12) list.shift();
    this.trips.set(from, list);
    // A better idea of the trip moves a green light that came from this player a little (until the race has begun: a few hundredths of a second).
    if (!this.begun && !this.deciding && this.goFrom === from) this.goTime = this.goRaw - this.oneWay(from);
  }

  /** Half the shortest round trip we measured to a player (ms): about how long a message from it takes. Nothing measured, nothing taken off. */
  private oneWay(id: string): number {
    const list = this.trips.get(id);
    return list?.length ? Math.min(400, Math.min(...list) / 2) : 0;
  }

  /** A green light heard: the one from the player earliest on the list wins; copies from the same player are merged by keeping the one that arrived fastest. */
  private onGo(from: string, inMs: number) {
    const rank = this.order.indexOf(from);
    if (this.begun || rank < 0) return;
    const raw = this.clock.now() + inMs;
    if (this.goTime === null || rank < this.goBy) {
      this.goRaw = raw;
      this.goBy = rank;
      this.goFrom = from;
      this.deciding = false; // someone ahead of us in the list gave it: it is theirs to repeat
    } else if (rank === this.goBy) this.goRaw = Math.min(this.goRaw, raw);
    else return;
    this.goTime = this.goRaw - this.oneWay(from);
  }

  /** The green light's time on this machine's clock, or null while the start is waiting for the others. */
  get goAt(): number | null {
    return this.goTime;
  }
  /** Seconds to the green light (negative once it has come); Infinity while it has not been given. */
  secondsToGo(): number {
    return this.goTime === null ? Infinity : (this.goTime - this.clock.now()) / 1000;
  }

  /**
   * Whether the race may start running: from three seconds before the green light, so every game's countdown ends together. The first
   * time it says yes, `startClock` puts the race's clock where it belongs.
   */
  live(): boolean {
    return this.goTime !== null && this.clock.now() >= this.goTime - COUNTDOWN_MS;
  }

  /** Sets the race's clock from the shared start (late games join the countdown where it is, or the race where it is). Once. */
  startClock(race: Race) {
    if (this.begun || this.goTime === null) return;
    this.begun = true;
    race.time = (this.clock.now() - this.goTime) / 1000;
    if (race.time >= 0 && race.phase === "countdown") race.phase = "racing";
  }

  /** Tells the others where our car is (at most `snapshotHz` a second, at once when something that matters changes). */
  sendSnapshot(race: Race) {
    if (this.closed || !this.joined) return;
    const car = race.cars[0], now = this.clock.now();
    const key = `${car.finishTime !== null}|${car.destroyedAt !== null}|${car.lap}`;
    if (now - this.lastSent < 1000 / snapshotHz(this.info.players.length) && key === this.lastKey) return;
    this.lastSent = now;
    this.lastKey = key;
    this.channel.send({ type: "snap", from: this.me.id, snap: snapOf(car, this.seq++, race.boost.isBoosting(car), race.time) });
  }

  /** Puts every opponent's copy where its player's game says it is now (blending the last snapshots, a little in the past), and what it says about the race. */
  apply(race: Race) {
    const now = this.clock.now(), t = now - interpDelay(this.info.players.length) * 1000;
    for (const car of race.cars) {
      if (!car.remote || !car.netId) continue;
      const id = car.netId, b = this.buf.get(id);
      this.checkGone(race, car, now);
      if (!b || !b.length) continue;
      let i = b.length - 1;
      while (i > 0 && b[i].rt > t) i--;
      const a = b[i].snap, next = b[i + 1]?.snap;
      let x = a.x, y = a.y, vx = a.vx, vy = a.vy, ang = a.a, z = a.z;
      if (next && b[i].rt <= t) {
        const u = Math.min(1, Math.max(0, (t - b[i].rt) / Math.max(1, b[i + 1].rt - b[i].rt)));
        x = lerp(a.x, next.x, u);
        y = lerp(a.y, next.y, u);
        vx = lerp(a.vx, next.vx, u);
        vy = lerp(a.vy, next.vy, u);
        ang = lerpAngle(a.a, next.a, u);
        z = lerp(a.z, next.z, u);
      } else if (!next && t > b[i].rt) {
        const dt = Math.min((t - b[i].rt) / 1000, NET.EXTRAP_MAX); // the last word, carried on a little by its velocity
        x += a.vx * dt;
        y += a.vy * dt;
      }
      car.pos = vec(x, y);
      car.vel = vec(vx, vy);
      car.angle = ang;
      car.alt = z;
      car.lastIndex = locate(race.track, car.pos).index;
      car.surface = "track";
      const last = b[b.length - 1].snap;
      const back = this.goneAt.get(id);
      if (back !== undefined && (this.heardAt.get(id) ?? -1) > back && !last.d) this.revive(car); // thought gone, but it spoke since: it is back
      car.lap = last.lap;
      car.progress = last.p;
      car.finishTime = last.f;
      if (last.d) {
        if (car.destroyedAt === null) blastRemote(race, car);
      } else {
        car.hp = last.hp;
        car.hpShown = last.hp;
      }
    }
  }

  private checkGone(race: Race, car: Car, now: number) {
    const id = car.netId as string;
    if (this.goneAt.has(id) || car.destroyedAt !== null || car.finishTime !== null) return;
    const silent = now - (this.heardAt.get(id) ?? -1);
    const heard = this.heardAt.has(id);
    // Said goodbye; or was in the room and no longer is (unless its snapshots are still arriving: a presence list that blinks, a slow tab,
    // must not take a player who is driving out of the race); or has gone quiet (after being heard, or never having come at all long after the start).
    const talking = heard && silent < 2000;
    const left = this.left.has(id) || (this.everPresent.has(id) && !this.present.has(id) && !talking);
    const quiet = heard ? silent > NET.STALE_MS : now - (this.goTime ?? now) > 15_000;
    if (!left && !quiet) return;
    if (left && !this.joined) return;
    this.goneAt.set(id, now);
    car.destroyedAt = race.time; // out of the race, no explosion: it just is not there any more
    car.hp = 0;
    car.vel = vec(0, 0);
    if (!car.name.endsWith(" (a quitté)")) car.name += " (a quitté)";
  }

  private revive(car: Car) {
    this.goneAt.delete(car.netId as string);
    car.destroyedAt = null;
    car.name = car.name.replace(/ \(a quitté\)$/, "");
  }

  /** Whether an opponent has left the race (or stopped answering). */
  isGone(id: string) {
    return this.goneAt.has(id);
  }

  /** How many opponents are still racing (not finished, destroyed or gone). */
  stillRacing(race: Race): number {
    return race.cars.filter((c) => c.remote && c.finishTime === null && c.destroyedAt === null).length;
  }
  /**
   * The opponents whose result against ours is not known yet, once the local car has finished: they are still driving AND their game has not
   * reached the moment we finished (a slow machine's race clock can lag far behind the wall clock, and an opponent who is not past our finishing
   * time may still turn out to have finished before us). Those whose game is past it without a finish are behind us for sure.
   */
  pending(race: Race): Car[] {
    const mine = race.cars[0].finishTime;
    if (mine === null) return race.cars.filter((c) => c.remote && c.finishTime === null && c.destroyedAt === null);
    return race.cars.filter((c) => c.remote && c.finishTime === null && c.destroyedAt === null && (this.gameTime.get(c.netId as string) ?? -1) < mine);
  }
  /** The names of those, for the "waiting for…" line. */
  waitingFor(race: Race): string[] {
    return this.pending(race).map((c) => c.name);
  }
  /** Whether our place is known: nobody who is still driving can yet beat our finishing time. */
  settled(race: Race): boolean {
    return this.pending(race).length === 0;
  }

  /** Says goodbye and leaves the game's channel. */
  leave() {
    if (this.closed) return;
    this.channel.send({ type: "bye", from: this.me.id });
    this.closed = true;
    this.stopTimer();
    this.channel.leave();
  }
}
