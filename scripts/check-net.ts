// Online mode checks (multiplayer). Run with `pnpm check:net` (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
// No server and no browser: the session and the race sync run over a fake network in memory (MemoryHub: latency, jitter and loss, driven by hand),
// every game on its own clock (with a different offset, as real machines have).
//
//   (a) the language: what a stranger sends is checked, clamped or dropped (names, ids, skins, snapshots, start messages, room codes);
//   (b) quick-match tables: the same list gives the same tables everywhere, four to a table, the leader is the longest waiter, nobody is in two tables;
//   (c) friends' rooms: a code, the host (first in), the host's mode followed by the others, only the host starts, a full room refuses a fifth, one
//       shared start for everybody (same game, same seed, same grid order, a green light a few seconds on);
//   (d) quick match end to end: players meeting in a queue are started together, once, the mode keeps them apart, a full table starts at once;
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
  const start = { type: "start", game: "g1234", mode: "desert", seed: 99, startIn: 6, players: [player("aaaa1111"), player("bbbb2222"), player("aaaa1111"), { id: "x" }] };
  const ps = parseMsg(start);
  check(ps?.type === "start" && ps.players.length === 2, "a start message keeps duplicates or junk players");
  check(parseMsg({ ...start, players: [player("aaaa1111")] }) === null, "a start with one player is accepted");
  check(parseMsg({ ...start, mode: "moon" }) === null && parseMsg({ ...start, startIn: -1 })?.type === "start", "start message mode / delay checks");
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
  const add = (id: string, name = id, offset = 0): Client => {
    const clock = new ManualClock();
    clock.t = EPOCH + offset; // every machine's clock says something different (as real ones, a few seconds apart)
    const session = new NetSession(hub.transport(), player(id, name), clock, mulberry32(id.length * 31 + clients.length));
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
  for (const x of [a, b, c, d]) {
    const info = x.starts[0], wait = info.goAt - x.clock.t;
    check(wait <= NET.START_IN * 1000 && wait > (NET.START_IN - 1.5) * 1000 - 1200, `${x.name}'s green light is ${wait} ms away on its own clock`);
  }
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
type Racer = { id: string; name: string; race: Race; sync: RaceSync; clock: ManualClock; truth: { t: number; x: number; y: number }[]; shown: Map<string, { t: number; x: number; y: number }[]> };

function multiOf(players: MultiPlayer[], localId: string): Multi {
  return { players, localId };
}

function setupRace(mode: ThemeId, ids: string[], seed: number, w: ReturnType<typeof world>, lateMs: Record<string, number> = {}) {
  const players = ids.map((id) => player(id, id.slice(0, 4).toUpperCase(), id.startsWith("jet") ? "jet" : "gt"));
  const racers: Racer[] = ids.map((id, i) => {
    const clock = new ManualClock();
    clock.t = EPOCH + i * 13_337 - 20_000; // different clocks again
    const info: StartInfo = { game: "testgame1", mode, seed, players, goAt: clock.t + 6000 + (lateMs[id] ?? 0) * 0 };
    const sync = new RaceSync(w.hub.transport(), players[i], info, clock);
    const race = createRace(mode, { model: players[i].model, skin: "factory", level: 1 }, seed, multiOf(players, id));
    return { id, name: players[i].name, race, sync, clock, truth: [], shown: new Map() };
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
  let sum = 0, n = 0, worst = 0, worstJump = 0;
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
  check(sum / n < 90, `an opponent is shown ${(sum / n).toFixed(0)} px away on average (at best-matching moment)`);
  check(worst < 420, `an opponent is shown ${worst.toFixed(0)} px from where it was`);
  check(worstJump < 140 * 1.5, `an opponent jumped ${worstJump.toFixed(0)} px between two looks 0.1 s apart (top speed ≈ 56 px per look)`);
  const sentRatio = w.hub.stats.lost / Math.max(1, w.hub.stats.sent * 2);
  check(sentRatio > 0.02 && sentRatio < 0.15, `the fake network lost ${(sentRatio * 100).toFixed(1)} % of what was sent (expected ≈ 8 %)`);
  // A snapshot rate that a hosted realtime service can carry: messages per second for a room of four.
  const perSecond = (w.hub.stats.sent / 95) * 3;
  console.log(`  race: 3 games over 60-150 ms with ${(w.hub.stats.lost / Math.max(1, w.hub.stats.sent * 2) * 100).toFixed(0)} % loss · everyone finished · same order · opponents ${(sum / n).toFixed(0)} px behind on average (worst ${worst.toFixed(0)}) · biggest jump ${worstJump.toFixed(0)} px · ≈ ${perSecond.toFixed(0)} messages/s received in a room of three`);
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
