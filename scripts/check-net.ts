// Online mode checks (multiplayer). Run with `pnpm check:net` (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
// No server and no browser: the session and the race sync run over a fake network in memory (MemoryHub: latency, jitter and loss, driven by hand),
// every game on its own clock (with a different offset, as real machines have).
//
//   (a) the language: what a stranger sends is checked, clamped or dropped (names, ids, skins, snapshots, start messages, room codes);
//   (b) quick-match tables: the same list gives the same tables everywhere, four to a table, the leader is the longest waiter, nobody is in two tables;
//   (c) friends' rooms: a code, the host (first in), the host's mode followed by the others, only the host starts, a full room refuses a fifth, one
//       shared start for everybody (same game, same seed, same grid order, the starter named as host);
//   (d) quick match end to end: players meeting in a queue are started together, once, the mode keeps them apart, a full table starts at once;
//   (e0) the start: nobody leaves the grid before everybody is ready, then every game gets the same green light (within a few hundredths of a second,
//       whatever its clock, its distance, its loading time or the messages lost), a late or lost game joins where the race is, a host that is gone or stuck
//       is replaced, the start fits the hosted service's message budget;
//   (e) the race: three games, each driving its own car over a lossy 60-150 ms network — everyone finishes, sees the others where they are (a
//       short, steady delay, no jumps), agrees with them on the order, and the countdown ends together;
//   (f) people leaving: a goodbye, a closed connection and plain silence each take the car out of the others' race, and the race still ends;
//   (g) cars of other players are not simulated here: they do not get hurt by our hazards, and bumping into one moves only our car;
//   (h) the grid: every game puts every car on the same spot; a solo race is exactly what it was.

import { type Car, NO_INPUT } from "../src/game/car";
import { isDestroyed } from "../src/game/health";
import { NET, cleanCode, cleanName, makeRoomCode, parseMember, parseMsg, parseSnap, ROOM_ALPHABET, snapOf } from "../src/game/net/protocol";
import { planTables, shuffled } from "../src/game/net/matchmaking";
import { ManualClock, NetSession, RaceSync, type SessionState, type StartInfo } from "../src/game/net/session";
import { MemoryHub } from "../src/game/net/transport";
import { aiInput, createRace, standings, stepRace, type Multi, type MultiPlayer, type Race } from "../src/game/race";
import { mulberry32 } from "../src/game/scenery";
import type { ThemeId } from "../src/game/themes";
import type { VolcanoHazard } from "../src/game/modes/volcano";
import type { NorthPoleHazard } from "../src/game/modes/northpole";

let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const check = (ok: boolean, msg: string) => {
  if (!ok) fail(msg);
};
const DT = 1 / 120;

console.log("Online mode checks\n");

const player = (id: string, name = id, model: MultiPlayer["model"] = "gt"): MultiPlayer => ({ id, name, model, skin: "factory", level: 1 });

// ---------- (a) the language ----------
{
  check(cleanName("  Max   la   Menace  ") === "Max la Menace", "spaces are not collapsed");
  check(cleanName("<b>x</b>\u0007\n") === "bx/b", `markup and control characters stay in a name: "${cleanName("<b>x</b>\u0007\n")}"`);
  check(cleanName("A".repeat(60)).length === NET.NAME_MAX, "a long name is not cut");
  check(cleanName("   ") === "Pilote" && cleanName(42) === "Pilote" && cleanName(null) === "Pilote", "an empty / odd name has no fallback");
  const m = parseMember({ id: "abcd1234", name: "Zed", model: "f8", skin: "jetGold", level: 3, since: 5 });
  check(!!m && m.skin === "factory", "a skin that does not fit the car is not shown in the factory paint");
  check(parseMember({ id: "abcd1234", name: "Zed", model: "tank", skin: "factory", level: 1, since: 5 }) === null, "an unknown car is accepted");
  check(parseMember({ id: "a b", name: "Zed", model: "gt", skin: "factory", level: 1, since: 5 }) === null, "a bad id is accepted");
  check(parseMember({ id: "abcd1234", name: "Zed", model: "gt", skin: "factory", level: 99, since: 5 })?.level === 10, "a level above 10 is not clamped");
  check(parseMsg(null) === null && parseMsg("x") === null && parseMsg({ type: "nope" }) === null && parseMsg({ type: "snap" }) === null, "garbage is understood");
  const car = createRace("desert", { model: "gt", skin: "factory", level: 1 }, 1).cars[0];
  const snap = snapOf(car, 7, true, 12.345);
  const back = parseSnap(JSON.parse(JSON.stringify(snap)));
  check(!!back && back.s === 7 && back.b === true && Math.abs(back.x - car.pos.x) < 0.06 && back.f === null && back.d === false && back.t === 12.35, "a snapshot does not survive the wire");
  check(parseSnap({ ...snap, x: Number.NaN }) === null && parseSnap({ ...snap, hp: "x" }) === null && parseSnap({ ...snap, f: "soon" }) === null && parseSnap({ ...snap, t: "now" }) === null, "a snapshot with a bad number is accepted");
  check(parseSnap({ ...snap, x: 1e12 })?.x === 1e5, "a huge coordinate is not clamped");
  const start = { type: "start", game: "g1234", mode: "desert", seed: 99, host: "bbbb2222", players: [player("aaaa1111"), player("bbbb2222"), player("aaaa1111"), { id: "x" }] };
  const ps = parseMsg(start);
  check(ps?.type === "start" && ps.players.length === 2, "a start message keeps duplicates or junk players");
  check(ps?.type === "start" && ps.host === "bbbb2222", "the host named in a start message is not kept");
  const hostOf = (host: unknown) => { const m = parseMsg({ ...start, host }); return m?.type === "start" ? m.host : null; };
  check(hostOf("cccc3333") === "aaaa1111" && hostOf(undefined) === "aaaa1111" && hostOf(42) === "aaaa1111", "a host who is not one of the players (or none) does not fall back to the first on the grid");
  // The start's own messages: ready, the green light (a duration), the round trip.
  const rdy = parseMsg({ type: "ready", from: "aaaa1111" });
  check(rdy?.type === "ready" && rdy.from === "aaaa1111" && parseMsg({ type: "ready" }) === null && parseMsg({ type: "ready", from: "a b" }) === null, "a ready message is not checked");
  const go = (v: unknown) => { const m = parseMsg({ type: "go", from: "aaaa1111", in: v }); return m?.type === "go" ? m.in : null; };
  check(go(4000) === 4000 && go(-9000) === -9000 && go(1e9) === 60_000 && go(-1e12) === -3_600_000 && go("soon") === null && go(Number.NaN) === null && go(undefined) === null, "a green light is not clamped / refused when odd");
  const pg = parseMsg({ type: "ping", from: "aaaa1111", to: "bbbb2222", n: 3.7 }), pn = parseMsg({ type: "pong", from: "bbbb2222", to: "aaaa1111", n: 3 });
  check(pg?.type === "ping" && pg.n === 3 && pg.to === "bbbb2222" && pn?.type === "pong" && pn.n === 3, "ping / pong are not understood");
  check(parseMsg({ type: "ping", from: "aaaa1111", n: 1 }) === null && parseMsg({ type: "pong", from: "aaaa1111", to: "bbbb2222", n: -4 })?.type === "pong" && parseMsg({ type: "ping", from: "aaaa1111", to: "bbbb2222", n: "x" }) === null, "a ping without a target, or with a bad number, is accepted");
  check(parseMsg({ ...start, players: [player("aaaa1111")] }) === null, "a start with one player is accepted");
  check(parseMsg({ ...start, mode: "moon" }) === null, "a start message in an unknown mode is accepted");
  check(parseMsg({ ...start, players: Array.from({ length: 9 }, (_, i) => player(`pl${i}xxxx`)) })?.type === "start", "a start with too many players is refused instead of cut");
  const many = parseMsg({ ...start, players: Array.from({ length: 9 }, (_, i) => player(`pl${i}xxxx`)) });
  check(many?.type === "start" && many.players.length === NET.MAX_PLAYERS, "a start message names more than four players");
  const rnd = mulberry32(5);
  const codes = new Set(Array.from({ length: 50 }, () => makeRoomCode(rnd)));
  check([...codes].every((c) => c.length === 4 && [...c].every((ch) => ROOM_ALPHABET.includes(ch))) && codes.size > 40, "room codes are not four plain characters, or collide");
  check(cleanCode(" k7qf ") === "K7QF" && cleanCode("K7Q") === null && cleanCode("K7Q0") === null && cleanCode("K7QFF") === null && cleanCode("K-7Q-F") === "K7QF", "room code typing");
  console.log("  language: names, ids, cars, snapshots, start messages and room codes are checked before anything uses them");
}

// ---------- (b) quick-match tables ----------
{
  const seekers = Array.from({ length: 11 }, (_, i) => ({ id: `p${String(i).padStart(2, "0")}`, since: 1000 + i * 10 }));
  const tables = planTables(seekers, 1000 + 11 * 10);
  check(tables.length === 3 && tables[0].ids.length === 4 && tables[1].ids.length === 4 && tables[2].ids.length === 3, "eleven seekers do not make 4 + 4 + 3");
  check(tables[0].leader === "p00" && tables[0].ready && tables[1].ready && !tables[2].ready, "a full table is ready at once; a short one is not before the wait");
  check(planTables(seekers, 1080 + NET.QUEUE_WAIT_MS)[2].ready, "a table of three whose leader has waited is not ready");
  const flat = tables.flatMap((t) => t.ids);
  check(flat.length === 11 && new Set(flat).size === 11, "a seeker is in two tables, or in none");
  const rnd = mulberry32(3);
  const shuffledSeekers = shuffled(seekers, rnd);
  check(JSON.stringify(planTables(shuffledSeekers, 5000)) === JSON.stringify(planTables(seekers, 5000)), "the order the list arrives in changes the tables");
  check(planTables([{ id: "solo", since: 0 }], 99_999)[0].ready === false, "one player alone starts a game");
  check(planTables([{ id: "a", since: 0 }, { id: "a", since: 5 }], 99_999)[0].ids.length === 1, "one id seen twice counts as two players");
  const tie = planTables([{ id: "bb", since: 1 }, { id: "aa", since: 1 }], 0)[0];
  check(tie.leader === "aa", "equal waiting times are not settled by the id");
  console.log("  tables: same list → same tables, four to a table, longest waiter leads, nobody twice");
}

// ---------- helpers for sessions ----------
const EPOCH = 1_760_000_000_000;
type Client = { id: string; name: string; clock: ManualClock; session: NetSession; starts: StartInfo[]; states: SessionState[] };
function world(opts: ConstructorParameters<typeof MemoryHub>[0] = {}) {
  const hub = new MemoryHub({ random: mulberry32(7), ...opts });
  const clients: Client[] = [];
  const add = (id: string, name = id, offset = 0, link: { out?: number; in?: number } = {}): Client => {
    const clock = new ManualClock();
    clock.t = EPOCH + offset; // every machine's clock says something different (as real ones, a few seconds apart)
    const session = new NetSession(hub.transport(link), player(id, name), clock, mulberry32(id.length * 31 + clients.length));
    const c: Client = { id, name, clock, session, starts: [], states: [] };
    session.onStart((info) => c.starts.push(info));
    session.subscribe(() => c.states.push(session.getState()));
    clients.push(c);
    return c;
  };
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 10) {
      for (const c of clients) c.clock.advance(10);
      hub.advance(10);
    }
  };
  return { hub, clients, add, tick };
}

// ---------- (c) friends' rooms ----------
let roomCode = "";
{
  const w = world();
  const a = w.add("aaaa0001", "Alice", 0), b = w.add("bbbb0002", "Bob", 7777), c = w.add("cccc0003", "Cleo", -4000), d = w.add("dddd0004", "Dan", 123), e = w.add("eeee0005", "Eve", 50);
  a.session.createRoom("northpole");
  w.tick(300);
  const st = a.session.getState();
  roomCode = st.code ?? "";
  check(st.phase === "room" && /^[A-Z0-9]{4}$/.test(roomCode) && st.isHost && st.members.length === 1, `after creating a room: ${JSON.stringify({ phase: st.phase, code: roomCode, host: st.isHost })}`);
  check(!b.session.joinRoom("zz") && b.session.getState().error !== null, "a bad code is accepted");
  b.session.joinRoom(roomCode.toLowerCase());
  w.tick(200);
  c.session.joinRoom(roomCode);
  w.tick(200);
  for (const x of [a, b, c]) check(x.session.getState().members.length === 3, `${x.name} sees ${x.session.getState().members.length} players, not 3`);
  check(a.session.getState().isHost && !b.session.getState().isHost && !c.session.getState().isHost, "the host is not the first to have entered");
  check(b.session.getState().mode === "northpole" && c.session.getState().mode === "northpole", "guests do not follow the room's mode");
  a.session.setMode("volcano");
  b.session.setMode("desert"); // not the host: ignored
  w.tick(300);
  check(b.session.getState().mode === "volcano" && c.session.getState().mode === "volcano" && a.session.getState().mode === "volcano", "the host's mode change did not reach everybody (or a guest's changed it)");
  check(!b.session.startRoom() && b.starts.length === 0, "a guest started the room's game");
  d.session.joinRoom(roomCode);
  w.tick(200);
  e.session.joinRoom(roomCode);
  w.tick(400);
  check(e.session.getState().error?.includes("pleine") === true && e.session.getState().phase === "idle", `a fifth player was let in: ${JSON.stringify(e.session.getState().error)}`);
  check(a.session.getState().members.length === 4, "the room does not hold the four players");
  check(a.session.startRoom(), "the host could not start with four players");
  w.tick(1200);
  const got = [a, b, c, d].map((x) => x.starts);
  check(got.every((s) => s.length === 1), `each player must be started once: ${got.map((s) => s.length).join(",")}`);
  const g0 = got[0][0];
  check(got.every((s) => s[0].game === g0.game && s[0].seed === g0.seed && s[0].mode === "volcano" && JSON.stringify(s[0].players) === JSON.stringify(g0.players)), "the players were not given the same game, seed and grid");
  check(g0.players.length === 4 && new Set(g0.players.map((p) => p.id)).size === 4, "the grid is not four different players");
  check(got.every((s) => s[0].host === a.id), `the start does not name its starter as host: ${got.map((s) => s[0].host).join(",")}`);
  check(e.starts.length === 0, "the refused player was started");
  // Back to the room after the race; leaving empties it.
  a.session.raceOver();
  check(a.session.getState().phase === "room", "the host is not back in the room after the race");
  b.session.leave();
  w.tick(400);
  check(a.session.getState().members.length === 3, "a player who left is still in the room");
  console.log(`  rooms: code ${roomCode}, host, followed mode, one shared start for four, a fifth refused`);
}

// ---------- (d) quick match ----------
{
  const w = world();
  const p = ["q1xx0001", "q2xx0002", "q3xx0003", "q4xx0004", "q5xx0005"].map((id, i) => w.add(id, `Q${i + 1}`, i * 911));
  p[0].session.quickMatch("desert");
  w.tick(500);
  p[1].session.quickMatch("northpole"); // another mode: a different queue
  w.tick(3000);
  check(p.every((x) => x.starts.length === 0), "a game started before anyone could meet");
  p[2].session.quickMatch("desert");
  w.tick(2500);
  check(p[0].starts.length === 0, "a table of two started before its leader had waited long enough");
  w.tick(3000);
  check(p[0].starts.length === 1 && p[2].starts.length === 1, `the two players in the desert queue were not started together: ${p[0].starts.length}/${p[2].starts.length}`);
  check(p[1].starts.length === 0, "a player waiting for another mode was dragged in");
  check(p[0].starts[0].mode === "desert" && JSON.stringify(p[0].starts[0].players) === JSON.stringify(p[2].starts[0].players) && p[0].starts[0].game === p[2].starts[0].game, "the two players do not have the same game");
  w.tick(4000);
  check(p[0].starts.length === 1 && p[2].starts.length === 1, "a player was started twice");
  // A full table starts at once.
  const w2 = world();
  const f = ["f1xx0001", "f2xx0002", "f3xx0003", "f4xx0004"].map((id, i) => w2.add(id, `F${i}`, -i * 500));
  for (const x of f) {
    x.session.quickMatch("volcano");
    w2.tick(150);
  }
  w2.tick(2000);
  check(f.every((x) => x.starts.length === 1), `a full table did not start at once: ${f.map((x) => x.starts.length).join(",")}`);
  const order = (x: Client) => x.starts[0].players.map((q) => q.id).join();
  check(f.every((x) => order(x) === order(f[0])) && f[0].starts[0].players.length === 4, "a full table is not four players in the same order");
  // The queue is left after the start (a late starter does not catch others' next search).
  w2.tick(5000);
  check(f.every((x) => x.session.getState().phase === "starting"), "the players are not in 'starting' while their race runs");
  // The server never answers.
  const dead = world();
  const lonely = dead.add("zzzz0009", "Z");
  const silent = { join: () => ({ send: () => undefined, track: () => undefined, leave: () => undefined }) };
  const clock = new ManualClock();
  const s2 = new NetSession(silent, player("zzzz0010"), clock);
  s2.quickMatch("desert");
  clock.advance(11_000);
  check(s2.getState().phase === "idle" && s2.getState().error !== null, "a server that never answers leaves the screen waiting");
  void lonely;
  console.log("  quick match: players meet in their mode's queue, started together once; a full table at once; a dead server ends the wait");
}

// ---------- (e) the race, over a lossy network ----------
type Racer = { id: string; name: string; race: Race; sync: RaceSync; clock: ManualClock; /** What the clock said when the hub's time was 0: hub time = clock − base. */ base: number; truth: { t: number; x: number; y: number }[]; shown: Map<string, { t: number; x: number; y: number }[]>; truthF: { t: number; x: number; y: number }[]; shownF: Map<string, { t: number; x: number; y: number }[]> };

function multiOf(players: MultiPlayer[], localId: string): Multi {
  return { players, localId };
}

type SetupOpts = {
  /** Every game says it is ready at once (the default); false: the test says so when it wants. */
  ready?: boolean;
  /** Extra delay (ms) on each player's line, one way out and one way in. */
  links?: Record<string, { out?: number; in?: number }>;
  /** Who started the game (the first by default). */
  host?: string;
  /** Players of the game whose machine never joined it (they never got the start message): no sync is made for them. */
  absent?: string[];
};

function setupRace(mode: ThemeId, ids: string[], seed: number, w: ReturnType<typeof world>, opts: SetupOpts = {}) {
  const players = ids.map((id) => player(id, id.slice(0, 4).toUpperCase(), id.startsWith("jet") ? "jet" : "gt"));
  const racers: Racer[] = ids.flatMap((id, i) => {
    if (opts.absent?.includes(id)) return [];
    const clock = new ManualClock();
    clock.t = EPOCH + i * 13_337 - 20_000; // different clocks again
    const info: StartInfo = { game: "testgame1", mode, seed, players, host: opts.host ?? ids[0] };
    const sync = new RaceSync(w.hub.transport(opts.links?.[id]), players[i], info, clock);
    if (opts.ready !== false) sync.setReady();
    const race = createRace(mode, { model: players[i].model, skin: "factory", level: 1 }, seed, multiOf(players, id));
    return [{ id, name: players[i].name, race, sync, clock, base: clock.t - w.hub.now, truth: [], shown: new Map(), truthF: [], shownF: new Map() }];
  });
  return { players, racers };
}

/** Runs the racers together for `seconds` of hub time (1/120 s steps), each driving its own car with the error-free AI. */
function runRace(w: ReturnType<typeof world>, racers: Racer[], seconds: number, hooks: { each?: (t: number) => void; skip?: (r: Racer, t: number) => boolean } = {}) {
  const stepMs = DT * 1000;
  let t = 0;
  for (let step = 0; step < Math.round(seconds / DT); step++, t += stepMs) {
    hooks.each?.(t / 1000);
    for (const r of racers) {
      r.clock.advance(stepMs);
      if (hooks.skip?.(r, t / 1000)) continue;
      if (!r.sync.live()) continue;
      r.sync.startClock(r.race);
      r.sync.apply(r.race);
      const me = r.race.cars[0];
      stepRace(r.race, me.finishTime !== null ? NO_INPUT : aiInput(r.race, me, DT, false), DT);
      r.sync.sendSnapshot(r.race);
      if (step % 3 === 0) {
        // Finer samples (25 ms) to measure how far behind the opponents are shown, in seconds.
        r.truthF.push({ t, x: me.pos.x, y: me.pos.y });
        for (const c of r.race.cars) {
          if (!c.remote || !c.netId) continue;
          let l = r.shownF.get(c.netId);
          if (!l) r.shownF.set(c.netId, (l = []));
          l.push({ t, x: c.pos.x, y: c.pos.y });
        }
      }
      if (step % 12 === 0) {
        r.truth.push({ t, x: me.pos.x, y: me.pos.y });
        for (const c of r.race.cars) {
          if (!c.remote || !c.netId) continue;
          let l = r.shown.get(c.netId);
          if (!l) r.shown.set(c.netId, (l = []));
          l.push({ t, x: c.pos.x, y: c.pos.y });
        }
      }
    }
    w.hub.advance(stepMs);
  }
}

// ---------- (e0) the start: one green light for everybody ----------
/** Runs the hub and the racers' clocks together (in 10 ms steps) up to hub time `untilMs`; each racer says it is ready at its time in `readyAt`. */
function startRun(w: ReturnType<typeof world>, racers: Racer[], readyAt: Record<string, number>, untilMs: number, each?: (hubMs: number) => void) {
  while (w.hub.now < untilMs) {
    for (const r of racers) {
      if (readyAt[r.id] !== undefined && w.hub.now >= readyAt[r.id]) r.sync.setReady();
      r.clock.advance(10);
    }
    w.hub.advance(10);
    each?.(w.hub.now);
  }
}
/** When (hub time, ms) a racer's green light falls — its own clock minus what that clock was at hub time 0 — or null while it has none. */
const greenOf = (r: Racer): number | null => (r.sync.goAt === null ? null : r.sync.goAt - r.base);
const spreadOf = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

{
  const ids = ["strt0001", "strt0002", "strt0003", "strt0004"];
  // (1) A slow game holds everybody up; nobody runs before every game is ready; one green light for all, over a bad network that loses messages.
  const spreads: number[] = [];
  for (let seedNo = 0; seedNo < 6; seedNo++) {
    const w = world({ latency: 60, jitter: 90, loss: 0.3, lossy: ["snap", "ready", "go", "ping", "pong"], random: mulberry32(100 + seedNo) });
    const { racers } = setupRace("desert", ids, 5, w, { ready: false });
    const readyAt: Record<string, number> = { strt0001: 1200, strt0002: 3400, strt0003: 9000, strt0004: 5200 };
    let early = "", lobbyMid: { ready: number; total: number } | null = null;
    startRun(w, racers, readyAt, 24_000, (t) => {
      const last = Math.max(...Object.values(readyAt));
      for (const r of racers) if (t < last && (r.sync.live() || r.sync.goAt !== null) && !early) early = `${r.name} had a green light at ${t} ms, before the last game was ready (${last})`;
      if (t === 4000) lobbyMid = racers[0].sync.lobby();
    });
    check(!early, early);
    const greens = racers.map(greenOf);
    check(greens.every((g) => g !== null), `seed ${seedNo}: not every game was given a green light: ${greens.join(",")}`);
    if (greens.some((g) => g === null)) continue;
    const g = greens as number[];
    spreads.push(spreadOf(g));
    check(Math.min(...g) >= 9000 + NET.GO_LEAD_MS - 100 && Math.max(...g) <= 9000 + NET.GO_LEAD_MS + 4500, `seed ${seedNo}: the green light fell at ${g.map((x) => (x / 1000).toFixed(2)).join(" / ")} s, the last game being ready at 9 s`);
    check(spreadOf(g) < 100, `seed ${seedNo}: the green lights of four games fall ${spreadOf(g).toFixed(0)} ms apart`);
    const lm = lobbyMid as { ready: number; total: number } | null;
    check(!!lm && lm.total === 4 && lm.ready >= 1 && lm.ready <= 3, `seed ${seedNo}: the lobby counted ${JSON.stringify(lm)} ready at 4 s (two games had said so)`);
    check(racers.every((r) => r.sync.lobby() === null), "the lobby still counts after the green light");
    check(racers.every((r) => r.sync.live() && r.sync.secondsToGo() < 0), `seed ${seedNo}: at 24 s the games are not all racing`);
  }
  spreads.sort((a, b) => a - b);
  check(spreads.length === 6 && spreads[2] < 40, `with 30 % of the start messages lost and 60-150 ms trips, half the starts differ by more than 40 ms: ${spreads.map((x) => x.toFixed(0)).join(" ")}`);
  console.log(`  start: four games, the slowest ready at 9 s · nobody moves before · green lights ${spreads.map((x) => x.toFixed(0)).join("/")} ms apart over 6 runs at 60-150 ms trips and 30 % messages lost`);

  // (2) A player far away (a slow line both ways) does not start late: the trip is measured and taken off. A line slower one way only cannot be told from a long one: that is half its difference.
  {
    const mk = (links: Record<string, { out?: number; in?: number }>) => {
      const w = world({ latency: 50, jitter: 20, loss: 0, random: mulberry32(21) });
      const { racers } = setupRace("desert", ids, 6, w, { ready: false, links });
      startRun(w, racers, { strt0001: 500, strt0002: 500, strt0003: 500, strt0004: 500 }, 12_000);
      return racers.map(greenOf);
    };
    const far = mk({ strt0003: { out: 150, in: 150 } }), lopsided = mk({ strt0003: { out: 0, in: 120 } }), near = mk({});
    check([far, lopsided, near].every((gs) => gs.every((x) => x !== null)), "a start with a far player did not happen");
    const s = (gs: (number | null)[]) => spreadOf(gs as number[]);
    check(s(near) < 25, `on a good network the green lights fall ${s(near).toFixed(0)} ms apart`);
    check(s(far) < 40, `a player 300 ms away starts ${s(far).toFixed(0)} ms off the others (the trip should be taken off)`);
    check(s(lopsided) < 90, `a line 120 ms slower one way starts ${s(lopsided).toFixed(0)} ms off (half of it expected)`);
    console.log(`  start: good network ${s(near).toFixed(0)} ms apart · a player 300 ms away ${s(far).toFixed(0)} ms · a line 120 ms slower one way ${s(lopsided).toFixed(0)} ms (can't be told from a long one)`);
  }

  // (3) A game that never gets ready: the others wait for it, but not for ever; when it does come, it joins the race where it is.
  {
    const w = world({ latency: 50, jitter: 30, loss: 0, random: mulberry32(22) });
    const { racers } = setupRace("desert", ids.slice(0, 3), 7, w, { ready: false });
    startRun(w, racers, { strt0001: 1000, strt0002: 1500 }, 24_000);
    check(racers.every((r) => r.sync.goAt === null && !r.sync.live()), "the start did not wait for a game that is not ready");
    check(racers[0].sync.lobby()?.ready === 2 && racers[0].sync.lobby()?.total === 3, `the lobby says ${JSON.stringify(racers[0].sync.lobby())} with two games ready out of three`);
    startRun(w, racers, { strt0001: 1000, strt0002: 1500 }, 27_000);
    const early = racers.slice(0, 2).map(greenOf) as number[];
    check(early.every((x) => x !== null) && Math.min(...early) >= NET.READY_MAX_MS + NET.GO_LEAD_MS - 100 && Math.max(...early) <= NET.READY_MAX_MS + NET.GO_LEAD_MS + 600, `after the wait the green light fell at ${early.map((x) => (x / 1000).toFixed(2)).join(" / ")} s`);
    check(spreadOf(early) < 40, `the two ready games start ${spreadOf(early).toFixed(0)} ms apart`);
    // The third finally comes, long after the green light: it is told, and its race clock is where the others' is.
    startRun(w, racers, { strt0001: 1000, strt0002: 1500, strt0003: 40_000 }, 42_000);
    const all = racers.map(greenOf) as number[];
    check(all.every((x) => x !== null) && spreadOf(all) < 40, `the late game's green light is ${all.map((x) => (x / 1000).toFixed(2)).join(" / ")} s, not the others'`);
    const late = racers[2];
    check(late.sync.live(), "the late game is not racing");
    late.sync.startClock(late.race);
    check(late.race.phase === "racing" && Math.abs(late.race.time - (42_000 - all[0]) / 1000) < 0.06, `the late game's race clock reads ${late.race.time.toFixed(2)} s, the others' ${((42_000 - all[0]) / 1000).toFixed(2)} s`);
    console.log("  start: a game that is not ready holds the others for 25 s at most; when it comes it is told, and joins on the shared clock");
  }

  // (4) The host is gone (closed its tab before the start): the next player gives the green light at once, without waiting for it.
  {
    const w = world({ latency: 50, jitter: 30, loss: 0, random: mulberry32(23) });
    const { racers } = setupRace("desert", ids.slice(0, 3), 8, w, { ready: false });
    startRun(w, racers, { strt0002: 1500, strt0003: 2500 }, 9000, (t) => {
      if (t === 800) racers[0].sync.leave();
    });
    const gs = racers.slice(1).map(greenOf);
    check(gs.every((x) => x !== null), "with the host gone, nobody gave the green light");
    if (gs.every((x) => x !== null)) check(Math.max(...(gs as number[])) < 9000 && spreadOf(gs as number[]) < 40, `with the host gone the green light fell at ${gs.map((x) => ((x ?? 0) / 1000).toFixed(2)).join(" / ")} s`);
    // Stuck rather than gone (present, never ready): passed over once the wait and its grace are over.
    const w2 = world({ latency: 50, jitter: 30, loss: 0, random: mulberry32(24) });
    const t2 = setupRace("desert", ids.slice(0, 3), 9, w2, { ready: false });
    startRun(w2, t2.racers, { strt0002: 1000, strt0003: 1000 }, 27_500);
    check(t2.racers.every((r) => r.sync.goAt === null), "the host was passed over before the wait was over");
    startRun(w2, t2.racers, { strt0002: 1000, strt0003: 1000 }, 33_000);
    const g2 = t2.racers.slice(1).map(greenOf) as number[];
    check(g2.every((x) => x !== null) && Math.min(...g2) >= NET.READY_MAX_MS + NET.HOST_GRACE_MS + NET.GO_LEAD_MS - 100 && Math.max(...g2) <= NET.READY_MAX_MS + NET.HOST_GRACE_MS + NET.GO_LEAD_MS + 600, `a stuck host was replaced at ${g2.map((x) => (x / 1000).toFixed(2)).join(" / ")} s`);
    startRun(w2, t2.racers, { strt0002: 1000, strt0003: 1000, strt0001: 35_000 }, 37_000);
    const g3 = t2.racers.map(greenOf) as number[];
    check(g3.every((x) => x !== null) && spreadOf(g3) < 100, `the stuck host, when it came back, was given a different green light: ${g3.map((x) => (x / 1000).toFixed(2)).join(" / ")} s`);
    console.log("  start: a host that is gone is replaced at once, one that is stuck after the wait; the stuck one joins the same race when it comes back");
  }

  // (4b) A player who never came to the game (it never got the start message): waited for a short while, not for the whole 25 s.
  {
    const w = world({ latency: 50, jitter: 30, loss: 0, random: mulberry32(28) });
    const { racers } = setupRace("desert", ids.slice(0, 3), 12, w, { ready: false, absent: ["strt0003"] });
    startRun(w, racers, { strt0001: 1000, strt0002: 1500 }, 9500);
    check(racers.every((r) => r.sync.goAt === null), "the start did not wait for a player who might still be on its way");
    startRun(w, racers, { strt0001: 1000, strt0002: 1500 }, 16_000);
    const gs = racers.map(greenOf) as number[];
    check(gs.every((x) => x !== null) && Math.min(...gs) >= NET.JOIN_MAX_MS + NET.GO_LEAD_MS - 100 && Math.max(...gs) <= NET.JOIN_MAX_MS + NET.GO_LEAD_MS + 600 && spreadOf(gs) < 40, `with a player who never came, the green light fell at ${gs.map((x) => (x / 1000).toFixed(2)).join(" / ")} s (expected ≈ ${(NET.JOIN_MAX_MS + NET.GO_LEAD_MS) / 1000})`);
  }

  // (4c) A stuck host that comes back ready just after the next player took over, on a line that delivers late: it listens first, it does not start a second race.
  {
    const w = world({ latency: 50, jitter: 30, loss: 0, random: mulberry32(29) });
    const { racers } = setupRace("desert", ids.slice(0, 3), 13, w, { ready: false, links: { strt0001: { out: 800, in: 800 } } });
    startRun(w, racers, { strt0002: 1000, strt0003: 1000, strt0001: 28_500 }, 36_000);
    const g = racers.map(greenOf) as number[];
    // It takes the others' green light (a second late at worst: it only heard it as the countdown began), never its own, which would fall ≥ 1.5 s + 4 s after it was ready.
    check(g.every((x) => x !== null) && Math.abs(g[0] - g[1]) < 1000 && Math.abs(g[1] - g[2]) < 40 && g[0] < 28_500 + NET.LISTEN_MS + NET.GO_LEAD_MS - 500, `a host back just after the takeover started its own race: ${g.map((x) => (x / 1000).toFixed(2)).join(" / ")} s`);
  }

  // (5) The host is the slow one: the others wait, then everybody goes together.
  {
    const w = world({ latency: 50, jitter: 30, loss: 0, random: mulberry32(25) });
    const { racers } = setupRace("desert", ids, 10, w, { ready: false });
    startRun(w, racers, { strt0001: 12_000, strt0002: 800, strt0003: 800, strt0004: 800 }, 20_000);
    const gs = racers.map(greenOf) as number[];
    check(gs.every((x) => x !== null) && Math.min(...gs) >= 12_000 + NET.GO_LEAD_MS - 100 && Math.max(...gs) <= 12_000 + NET.GO_LEAD_MS + 300 && spreadOf(gs) < 40, `a slow host: green lights at ${gs.map((x) => (x / 1000).toFixed(2)).join(" / ")} s`);
  }

  // (6) End to end, through the session: a room of four with clocks seconds apart, the starter is the host, each game ready after its own loading time.
  {
    const w = world({ latency: 60, jitter: 60, loss: 0.2, lossy: ["snap", "start", "ready", "go", "ping", "pong"], random: mulberry32(26) });
    const c = [w.add("room0001", "A", 0), w.add("room0002", "B", 7777, { out: 40, in: 40 }), w.add("room0003", "C", -4000), w.add("room0004", "D", 123, { out: 80, in: 80 })];
    c[0].session.createRoom("volcano");
    w.tick(300);
    const code = c[0].session.getState().code ?? "";
    for (const x of c.slice(1)) {
      x.session.joinRoom(code);
      w.tick(300);
    }
    check(c[0].session.startRoom(), "the room could not be started");
    const syncs = new Map<string, RaceSync>(), readyAt = new Map<string, number>();
    const loading: Record<string, number> = { room0001: 800, room0002: 2500, room0003: 6000, room0004: 1500 };
    const hubGreen = (x: Client) => { const g = syncs.get(x.id)?.goAt; return g == null ? null : g - (x.clock.t - w.hub.now); };
    let sentBefore = w.hub.stats.sent + w.hub.stats.delivered;
    const startedAt = w.hub.now;
    let peak = 0, worstEarly = "";
    for (let step = 0; step < 2500; step++) {
      for (const x of c) {
        if (x.starts.length && !syncs.has(x.id)) {
          const sy = x.session.beginRace(x.starts[0]);
          syncs.set(x.id, sy);
          readyAt.set(x.id, w.hub.now + loading[x.id]);
        }
        const sy = syncs.get(x.id);
        if (sy && w.hub.now >= (readyAt.get(x.id) ?? Infinity)) sy.setReady();
      }
      w.tick(10);
      if ((step + 1) % 100 === 0) {
        const total = w.hub.stats.sent + w.hub.stats.delivered;
        peak = Math.max(peak, total - sentBefore);
        sentBefore = total;
      }
      const lastReady = readyAt.size === 4 ? Math.max(...readyAt.values()) : Infinity;
      for (const x of c) if (hubGreen(x) !== null && w.hub.now < lastReady && !worstEarly) worstEarly = `${x.name} had a green light at ${w.hub.now}, before the last game was ready (${lastReady})`;
    }
    check(!worstEarly, worstEarly);
    check(c.every((x) => x.starts.length === 1 && x.starts[0].host === "room0001"), "the room's starter is not named host in everybody's start");
    const gs = c.map(hubGreen);
    check(gs.every((x) => x !== null), `through the session, not every game was given a green light: ${gs.join(",")}`);
    if (gs.every((x) => x !== null)) {
      const g = gs as number[], last = Math.max(...readyAt.values());
      check(spreadOf(g) < 100 && Math.min(...g) >= last + NET.GO_LEAD_MS - 100, `through the session the green lights fall at ${g.map((x) => ((x - startedAt) / 1000).toFixed(2)).join(" / ")} s (${spreadOf(g).toFixed(0)} ms apart), the last game being ready at ${((last - startedAt) / 1000).toFixed(2)} s`);
      console.log(`  start: a room of four through the session (clocks seconds apart, 20 % of messages lost, loading times 0.8-6 s) · green lights ${spreadOf(g).toFixed(0)} ms apart, ${(Math.min(...g) - last).toFixed(0)} ms after the last game was ready`);
    }
    void peak;
  }

  // (8) A game that was frozen (busy loading) does not trust what it handles right after: the green lights that piled up in its queue say nothing
  // of when they arrived. It takes none of them, says "ready" when it is, and takes the fresh one it is answered with.
  {
    const w = world({ latency: 20, jitter: 0, loss: 0, random: mulberry32(30) });
    const { racers } = setupRace("desert", ids.slice(0, 2), 14, w, { ready: false });
    const [host, guest] = racers;
    type Inner = { onMessage(m: unknown): void; lastStep: number };
    const inner = guest.sync as unknown as Inner;
    inner.lastStep = guest.clock.now() - 20_000; // its timer has not run for 20 s
    inner.onMessage({ type: "go", from: host.id, in: 3000 });
    check(guest.sync.goAt === null, "a green light handled right after a freeze was used");
    guest.clock.advance(100);
    inner.onMessage({ type: "go", from: host.id, in: 3000 });
    check(guest.sync.goAt !== null, "a green light handled with the timer running was not used");
    // Not ready when the host gave up waiting at 25 s, but healthy and told: it forgets that light when it becomes ready, and takes the host's answer.
    const w2 = world({ latency: 20, jitter: 0, loss: 0, random: mulberry32(31) });
    const t2 = setupRace("desert", ids.slice(0, 2), 15, w2, { ready: false });
    startRun(w2, t2.racers, { strt0001: 500 }, 30_000);
    const [h2, g2] = t2.racers;
    check(g2.sync.goAt !== null && h2.sync.goAt !== null, "the host did not give the green light after the wait");
    g2.sync.setReady();
    check(g2.sync.goAt === null, "a game that becomes ready keeps a green light it heard before");
    startRun(w2, t2.racers, { strt0001: 500, strt0002: 30_000 }, 31_000);
    const fresh = greenOf(g2), hostGreen = greenOf(h2);
    check(fresh !== null && hostGreen !== null && Math.abs(fresh - hostGreen) < 40, `after becoming ready the game's green light is ${fresh} ms, the host's ${hostGreen}`);
    console.log("  start: a green light handled after a freeze is not trusted; a game that becomes ready asks again and takes the fresh one");
  }

  // (7) What the start costs the hosted service: a room of four counts messages sent plus delivered (about 100 a second is the free allowance).
  {
    const w = world({ latency: 40, jitter: 10, loss: 0, random: mulberry32(27) });
    const { racers } = setupRace("desert", ids, 11, w, { ready: false });
    let prev = 0, peak = 0;
    startRun(w, racers, { strt0001: 800, strt0002: 1500, strt0003: 4000, strt0004: 2500 }, 12_000, (t) => {
      if (t % 1000 === 0) {
        const total = w.hub.stats.sent + w.hub.stats.delivered;
        peak = Math.max(peak, total - prev);
        prev = total;
      }
    });
    check(peak <= 100, `the start of a room of four counts ${peak} messages in one second (about 100 a second is the free allowance)`);
    console.log(`  start: ≤ ${peak} messages in the busiest second of a room of four's start (ready, go, trips measured)`);
  }
}

{
  const w = world({ latency: 60, jitter: 90, loss: 0.08 });
  const { players, racers } = setupRace("desert", ["race0001", "race0002", "race0003"], 4242, w);
  // The grid is the same in every game.
  for (const p of players) {
    const spots = racers.map((r) => r.race.cars.find((c) => (c.isPlayer ? r.id : c.netId) === p.id)!.pos);
    check(spots.every((s) => Math.hypot(s.x - spots[0].x, s.y - spots[0].y) < 1e-9), `${p.name} does not start on the same spot in every game`);
  }
  check(racers.every((r) => r.race.cars.length === 3 && r.race.cars[0].isPlayer && r.race.cars.slice(1).every((c) => c.remote)), "an online race is not the local car and the others' remote copies, with no bots");
  const goTimes: number[] = [];
  runRace(w, racers, 95, {
    each: (t) => {
      if (Math.abs(t - 6.5) < 0.005) for (const r of racers) goTimes.push(r.race.time);
    },
  });
  check(goTimes.length === 3 && Math.max(...goTimes) - Math.min(...goTimes) < 0.05, `the clocks of the three races differ by ${(Math.max(...goTimes) - Math.min(...goTimes)).toFixed(3)} s at the same moment`);
  check(racers.every((r) => r.race.cars.every((c) => c.finishTime !== null)), `not everybody finished in every game: ${racers.map((r) => r.race.cars.map((c) => c.finishTime?.toFixed(1)).join("/")).join(" | ")}`);
  const orders = racers.map((r) => standings(r.race).map((c) => (c.isPlayer ? r.id : c.netId)).join(">"));
  check(orders.every((o) => o === orders[0]), `the games do not agree on the order: ${orders.join(" | ")}`);
  const times = racers.map((r) => r.race.cars.map((c) => ({ id: c.isPlayer ? r.id : c.netId!, f: c.finishTime! })).sort((a, b) => (a.id < b.id ? -1 : 1)).map((x) => x.f.toFixed(3)).join(","));
  check(times.every((x) => x === times[0]), "a finishing time changed on its way to the other games");
  // What each game shows of the others: close to the truth (a short, steady delay), never jumping.
  let sum = 0, n = 0, worst = 0, worstJump = 0, lag = 0;
  for (const viewer of racers) {
    for (const [id, shown] of viewer.shown) {
      const owner = racers.find((r) => r.id === id)!;
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i < shown.length; i++) {
        const truth = owner.truth[i];
        if (!truth) break;
        // Compare with where the owner's car was about 0.4 s earlier too: the picture may only be behind, never ahead or elsewhere.
        const behind = owner.truth[Math.max(0, i - 4)];
        const d = Math.min(Math.hypot(shown[i].x - truth.x, shown[i].y - truth.y), Math.hypot(shown[i].x - behind.x, shown[i].y - behind.y));
        sum += d;
        n++;
        worst = Math.max(worst, d);
        if (prev && shown[i].t > 8000) worstJump = Math.max(worstJump, Math.hypot(shown[i].x - prev.x, shown[i].y - prev.y));
        prev = shown[i];
      }
    }
  }
  // How far behind the truth the opponents are shown, in seconds: for each shown position, how long ago the car really was there.
  {
    let lagSum = 0, lagN = 0;
    for (const viewer of racers) {
      for (const [id, shown] of viewer.shownF) {
        const owner = racers.find((r) => r.id === id)!;
        for (let i = 400; i < shown.length - 4; i += 4) {
          // Only while it is really driving (a stopped car matches any moment of its past).
          if (Math.hypot(owner.truthF[i].x - owner.truthF[i - 4].x, owner.truthF[i].y - owner.truthF[i - 4].y) / 0.1 < 150) continue;
          let best = Infinity, bj = i;
          for (let j = Math.max(0, i - 24); j <= i + 2 && j < owner.truthF.length; j++) {
            const dd = Math.hypot(shown[i].x - owner.truthF[j].x, shown[i].y - owner.truthF[j].y);
            if (dd < best) { best = dd; bj = j; }
          }
          lagSum += (i - bj) * 0.025;
          lagN++;
        }
      }
    }
    lag = lagSum / Math.max(1, lagN);
    // The network itself costs 105 ms on average here (60 ms + 0..90 ms jitter): what the game adds is the interpolation delay (about 115 ms with three players).
    check(lag < 0.25, `opponents are shown ${(lag * 1000).toFixed(0)} ms behind on average (the network's own 105 ms included)`);
  }
  check(sum / n < 90, `an opponent is shown ${(sum / n).toFixed(0)} px away on average (at best-matching moment)`);
  check(worst < 420, `an opponent is shown ${worst.toFixed(0)} px from where it was`);
  check(worstJump < 140 * 1.5, `an opponent jumped ${worstJump.toFixed(0)} px between two looks 0.1 s apart (top speed ≈ 56 px per look)`);
  const sentRatio = w.hub.stats.lost / Math.max(1, w.hub.stats.sent * 2);
  check(sentRatio > 0.02 && sentRatio < 0.15, `the fake network lost ${(sentRatio * 100).toFixed(1)} % of what was sent (expected ≈ 8 %)`);
  // A snapshot rate that a hosted realtime service can carry: messages per second for a room of four.
  const perSecond = (w.hub.stats.sent / 95) * 3;
  console.log(`  race: 3 games over 60-150 ms with ${(w.hub.stats.lost / Math.max(1, w.hub.stats.sent * 2) * 100).toFixed(0)} % loss · everyone finished · same order · opponents ${(lag * 1000).toFixed(0)} ms behind (network included) · ${(sum / n).toFixed(0)} px off on average (worst ${worst.toFixed(0)}) · biggest jump ${worstJump.toFixed(0)} px · ≈ ${perSecond.toFixed(0)} messages/s received in a room of three`);
}

// A slow opponent's game is far behind the wall clock: our place waits for it to reach the moment we finished, never for the wall clock.
{
  const w = world({ latency: 20, jitter: 0, loss: 0 });
  const { racers } = setupRace("desert", ["wait0001", "wait0002", "wait0003"], 12, w);
  const [A, B, C] = racers;
  const pump = (ms: number) => {
    for (const r of racers) r.clock.advance(ms);
    w.hub.advance(ms);
  };
  const say = (r: Racer, time: number, finish: number | null = null) => {
    r.race.time = time;
    r.race.cars[0].finishTime = finish;
    pump(150);
    r.sync.sendSnapshot(r.race);
    pump(150);
    A.sync.apply(A.race);
  };
  pump(300); // everyone is on the race channel
  const me = A.race.cars[0];
  me.finishTime = 30;
  A.race.phase = "finished";
  A.race.time = 31;
  const names = () => A.sync.waitingFor(A.race).join(",");
  say(B, 10);
  say(C, 12);
  check(!A.sync.settled(A.race) && A.sync.pending(A.race).length === 2, `two opponents are behind our finish in their own games but the place is settled (${names()})`);
  say(B, 31); // B's game is past our finish without a finish of its own: B is behind us, for sure
  check(A.sync.pending(A.race).length === 1 && !A.sync.settled(A.race), `a game past our finishing time still holds the place up (${names()})`);
  say(C, 25, 25); // C finished at 25, before our 30
  const c = A.race.cars.find((x) => x.netId === "wait0003")!;
  check(A.sync.settled(A.race) && c.finishTime === 25, `a rival's finish was not taken into account (${names()}, finish ${c.finishTime})`);
  check(standings(A.race).map((x) => (x.isPlayer ? "me" : x.netId)).join(">") === "wait0003>me>wait0002", `standings: ${standings(A.race).map((x) => (x.isPlayer ? "me" : x.netId)).join(">")}`);
  // Nobody can be waited for once they are out.
  const w2 = world();
  const g = setupRace("desert", ["gone1001", "gone1002"], 13, w2).racers;
  g[0].race.cars[0].finishTime = 20;
  g[0].race.cars[1].destroyedAt = 5;
  check(g[0].sync.settled(g[0].race), "a destroyed or departed opponent holds the place up");
  console.log("  settling: our place waits for slow opponents' games (not the wall clock), counts a finish that was in flight, ignores those who are out");
}

// A room of four on a perfect network: how many messages a second the hosted service would count (each message is also delivered to the others).
{
  const w = world({ latency: 40, jitter: 10, loss: 0 });
  const { racers } = setupRace("countryside", ["load0001", "load0002", "load0003", "load0004"], 31, w);
  const start = { sent: 0, delivered: 0 };
  runRace(w, racers, 12); // up to the green light and a few seconds of racing
  start.sent = w.hub.stats.sent;
  start.delivered = w.hub.stats.delivered;
  runRace(w, racers, 20);
  const perSecond = (w.hub.stats.sent - start.sent + w.hub.stats.delivered - start.delivered) / 20;
  check(perSecond <= 100, `a room of four makes ${perSecond.toFixed(0)} messages a second (a free hosted project allows about 100)`);
  const two = world({ latency: 40, jitter: 10, loss: 0 });
  const duo = setupRace("countryside", ["pair0001", "pair0002"], 32, two).racers;
  runRace(two, duo, 12);
  const s2 = { s: two.hub.stats.sent, d: two.hub.stats.delivered };
  runRace(two, duo, 20);
  const duoRate = (two.hub.stats.sent - s2.s + two.hub.stats.delivered - s2.d) / 20;
  check(duoRate <= 100 && duoRate > 20, `a room of two makes ${duoRate.toFixed(0)} messages a second`);
  const lag = (r: Racer) => r.race.cars.filter((c) => c.remote).length;
  check(racers.every((r) => lag(r) === 3), "a room of four is not three remote cars for each player");
  console.log(`  load: ${perSecond.toFixed(0)} messages/s counted for a room of four (6 snapshots/s each), ${duoRate.toFixed(0)} for a room of two (10/s)`);
}

// ---------- (f) people leaving ----------
{
  // A goodbye.
  const w = world({ latency: 50, jitter: 30, loss: 0 });
  const { racers } = setupRace("desert", ["gone0001", "gone0002", "gone0003"], 77, w);
  runRace(w, racers, 40, {
    skip: (r, t) => r.id === "gone0003" && t > 15,
    each: (t) => {
      if (Math.abs(t - 15.2) < 0.005) racers[2].sync.leave();
    },
  });
  for (const r of racers.slice(0, 2)) {
    const car = r.race.cars.find((c) => c.netId === "gone0003")!;
    check(isDestroyed(car) && r.sync.isGone("gone0003") && car.name.endsWith("(a quitté)"), `${r.name} did not see the player who said goodbye leave`);
    check(r.sync.stillRacing(r.race) <= 1, `${r.name} still counts the leaver as racing`);
  }
  // Silence: no goodbye, no presence change (a frozen tab).
  const w2 = world({ latency: 50, jitter: 30, loss: 0 });
  const { racers: rs } = setupRace("desert", ["mute0001", "mute0002"], 78, w2);
  runRace(w2, rs, 30, { skip: (r, t) => r.id === "mute0002" && t > 12 });
  const seen = rs[0].race.cars.find((c) => c.netId === "mute0002")!;
  check(isDestroyed(seen) && rs[0].sync.isGone("mute0002"), "a player gone silent is still racing in the others' game");
  // They come back: the car is back.
  runRace(w2, rs, 5);
  check(!rs[0].sync.isGone("mute0002") && !seen.name.endsWith("(a quitté)") && !isDestroyed(seen), "a player who spoke again was not brought back into the race");
  // A presence list that blinks (the player drops out of it but keeps sending snapshots) takes nobody out of the race.
  const w3 = world({ latency: 50, jitter: 30, loss: 0 });
  const { racers: bl } = setupRace("desert", ["blnk0001", "blnk0002"], 79, w3);
  runRace(w3, bl, 8);
  (bl[1].sync as unknown as { channel: { leave(): void } }).channel.leave(); // the hub forgets it is there; it goes on sending
  runRace(w3, bl, 20);
  const blinked = bl[0].race.cars.find((c) => c.netId === "blnk0002")!;
  check(!bl[0].sync.isGone("blnk0002") && !isDestroyed(blinked) && !blinked.name.endsWith("(a quitté)"), "a player still sending snapshots was taken out of the race because the presence list blinked");
  console.log("  leaving: a goodbye and a silence each take the car out of the others' race");
  void seen;
}

// ---------- (g) other players' cars ----------
{
  const w = world();
  const { racers } = setupRace("desert", ["body0001", "body0002"], 5, w);
  const r = racers[0], me = r.race.cars[0], other = r.race.cars[1];
  for (let i = 0; i < 300; i++) r.race.cars.forEach((c) => (c.vel = { x: 0, y: 0 }));
  r.race.phase = "racing";
  r.race.time = 1;
  other.pos = { x: me.pos.x + 20, y: me.pos.y };
  other.vel = { x: -50, y: 0 };
  me.vel = { x: 300, y: 0 };
  me.angle = 0;
  const otherBefore = { ...other.pos };
  stepRace(r.race, NO_INPUT, DT);
  check(other.pos.x === otherBefore.x + 0 && other.pos.y === otherBefore.y, `bumping into an opponent moved it (${(other.pos.x - otherBefore.x).toFixed(2)} px): its own game moves it`);
  check(Math.hypot(me.pos.x - other.pos.x, me.pos.y - other.pos.y) >= 33.9, "our car is still inside the opponent's after the bump");
  check(me.vel.x < 300, "our car did not bounce off the opponent");
  // Our hazards leave opponents alone: a bomb falls on the opponent's copy and on our own car, the same second; only ours is hurt.
  {
    const volcano = createRace("volcano", { model: "gt", skin: "factory", level: 1 }, 9, { players: [player("v0000001"), player("v0000002")], localId: "v0000001" });
    const vh = volcano.hazard as VolcanoHazard;
    const mine = volcano.cars[0], theirs = volcano.cars[1];
    const S = 40 / 28;
    vh.hazards.addTarget(theirs.pos.x / S, theirs.pos.y / S);
    vh.hazards.addTarget(mine.pos.x / S, mine.pos.y / S);
    volcano.phase = "racing";
    volcano.time = 20;
    for (let i = 0; i < Math.round(2 / DT); i++) {
      volcano.time += DT;
      volcano.hazard!.step(volcano, DT);
    }
    check(mine.hp < 100, `the control failed: the bomb on our own car hurt nothing (hp ${mine.hp})`);
    check(theirs.hp === 100, `a bomb hurt an opponent's copy (hp ${theirs.hp})`);
  }
  // … and the yeti: it lands on our car with an opponent's copy right beside it.
  {
    const pole = createRace("northpole", { model: "gt", skin: "factory", level: 1 }, 3, { players: [player("n0000001"), player("n0000002")], localId: "n0000001" });
    pole.boost.enabled = false;
    const yeti = () => (pole.hazard as NorthPoleHazard).yeti.state.jump;
    let guard = 0;
    while (yeti()?.phase !== "flight" && guard++ < 240 * 120) stepRace(pole, aiInput(pole, pole.cars[0], DT, false), DT);
    const j = yeti();
    check(!!j, "no yeti jump in 240 s of an online race");
    if (j) {
      const mine = pole.cars[0], theirs = pole.cars[1];
      theirs.pos = { x: j.toX + 30, y: j.toY };
      let g2 = 0;
      while (yeti()?.phase === "flight" && g2++ < 10 * 120) {
        mine.pos = { x: j.toX, y: j.toY };
        mine.vel = { x: 0, y: 0 };
        theirs.vel = { x: 0, y: 0 };
        stepRace(pole, NO_INPUT, DT, false);
      }
      check(yeti()?.phase === "stand", "the yeti never landed");
      check(mine.hp < 100, `the yeti landing did not hurt our car (hp ${mine.hp})`);
      check(theirs.hp === 100, `the yeti landing hurt an opponent's copy (hp ${theirs.hp})`);
    }
  }
  console.log("  other players' cars: not moved by a bump, not hurt by our hazards");
}

// ---------- (h) the grid ----------
{
  const solo = (seed: number) => createRace("countryside", { model: "gt", skin: "factory", level: 1 }, seed);
  const a = solo(3), b = solo(3);
  check(a.cars.length === 4 && a.cars.every((c) => !c.remote) && a.cars.map((c) => c.pos.x.toFixed(3)).join() === b.cars.map((c) => c.pos.x.toFixed(3)).join(), "a solo race has changed");
  const two = createRace("countryside", { model: "gt", skin: "factory", level: 1 }, 3, { players: [player("s0000001"), player("s0000002")], localId: "s0000002" });
  check(two.cars.length === 2 && two.cars[0].isPlayer && two.cars[1].netId === "s0000001" && two.cars[1].remote === true, "a two-player race is not the local car and one remote copy");
  const one = createRace("countryside", { model: "gt", skin: "factory", level: 1 }, 3, { players: [player("s0000001")], localId: "s0000001" });
  check(one.cars.length === 4, "a one-player list must fall back to the solo race");
  console.log("  grid: the same spots everywhere, a solo race unchanged");
}

if (failed) {
  console.error("\ncheck:net FAILED");
  process.exit(1);
}
console.log("\ncheck:net OK");

void (null as unknown as Car);
