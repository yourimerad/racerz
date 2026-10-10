// Yeti checks (north pole): the jump from the massif must be fair, readable, heavy and leak-free.
// Run with `pnpm check:yeti` (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
//
//   (a) over seeded all-AI races: the yeti only exists at the north pole; one jump at a time, never before FIRST seconds,
//       GAP apart, announced WARN + FLIGHT seconds before it lands (the ring is on the road, near a tunnel portal, away
//       from the line and from every car), and the whole state (jump, popups) is empty again after the race;
//   (b) the same seed gives the same jumps (the yeti's dice are its own);
//   (c) a car under the landing loses DAMAGE points and half its speed, once (a second of grace), with a number over it,
//       the quake cue and the camera shake; a car beside it, a destroyed car, a car in the air lose nothing;
//   (d) the yeti standing is solid (pushed out of it every step, a single counted contact, it never moves);
//   (e) a car with few points left blows up when it lands on it; the wreck ranks last and the race goes on;
//   (f) bots brake for the ring (the danger zone is announced during the warning and the flight, gone once it stands),
//       and a bot is never left stuck;
//   (g) the 3D adapter reads the same state; the other modes have no yeti.

import { Adapter3D } from "../src/game/adapter3d";
import { NO_INPUT, speedOf, type Car } from "../src/game/car";
import { HEALTH, isDestroyed } from "../src/game/health";
import type { NorthPoleHazard } from "../src/game/modes/northpole";
import { YETI, type YetiJump } from "../src/game/modes/yeti";
import { aiInput, createRace, stepRace, type Race } from "../src/game/race";
import type { HazardBody } from "../src/game/scenery";
import type { ThemeId } from "../src/game/themes";

const DT = 1 / 120;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const check = (ok: boolean, msg: string) => {
  if (!ok) fail(msg);
};

const newRace = (seed: number, mode: ThemeId = "northpole"): Race => createRace(mode, { model: "gt", skin: "factory", level: 1 }, seed);
const poleOf = (race: Race) => race.hazard as NorthPoleHazard;
const jumpOf = (race: Race): YetiJump | null => poleOf(race).yeti.state.jump;

/** One all-AI step. */
const step = (race: Race) => stepRace(race, aiInput(race, race.cars[0], DT, false), DT);

console.log("Yeti checks (north pole)\n");

// ---------- (a) + (b) + (f): full all-AI races ----------
type Log = { id: number; start: number; land: number; toX: number; toY: number; fromX: number; fromY: number };
function raceLog(seed: number): { log: Log[]; race: Race } {
  const race = newRace(seed);
  const pole = poleOf(race), log: Log[] = [];
  let lastId = 0, stuck = 0;
  const still = race.cars.map(() => 0);
  while (race.time < 240 && race.cars.some((c) => c.finishTime === null && !isDestroyed(c))) {
    step(race);
    const j = pole.yeti.state.jump;
    if (j && j.id !== lastId) {
      lastId = j.id;
      log.push({ id: j.id, start: race.time, land: -1, toX: j.toX, toY: j.toY, fromX: j.fromX, fromY: j.fromY });
      // Announced: the ring is a danger zone bots brake for, from the very first step of the warning.
      const d = pole.dangers!();
      check(d.length === 1 && d[0].brake && Math.hypot(d[0].x - j.toX, d[0].y - j.toY) < 1, `seed ${seed}: the warning does not announce its ring as a danger`);
      // Fair play: no car near the spot when it is announced.
      const near = Math.min(...race.cars.filter((c) => !isDestroyed(c)).map((c) => Math.hypot(c.pos.x - j.toX, c.pos.y - j.toY)));
      check(near >= YETI.MIN_CAR_DIST - 1e-6, `seed ${seed}: a car was ${near.toFixed(0)} px from the landing spot when it was announced`);
      check(race.time >= YETI.FIRST - 1e-6, `seed ${seed}: a jump began at t=${race.time.toFixed(1)}s (< ${YETI.FIRST} s)`);
      check(pole.yeti.state.jump === j, "one jump at a time");
    }
    if (j && j.phase === "stand" && log.length && log[log.length - 1].land < 0) log[log.length - 1].land = race.time;
    // The ring is gone once it stands.
    if (j && j.phase !== "warn" && j.phase !== "flight") check(pole.dangers!().length === 0, `seed ${seed}: the ring is still announced while the yeti stands`);
    for (const c of race.cars) {
      still[c.id] = c.finishTime === null && race.phase === "racing" && !isDestroyed(c) && Math.abs(speedOf(c)) < 5 ? still[c.id] + DT : 0;
      if (still[c.id] > 5) stuck++;
    }
    if (stuck) {
      fail(`seed ${seed}: a car stayed almost still for over 5 s (t=${race.time.toFixed(1)}s)`);
      break;
    }
  }
  return { log, race };
}

let jumps = 0, minGap = Infinity, hurtPlayer = 0, hurtBots = 0;
const first = raceLog(SEEDS[0]);
for (const seed of SEEDS) {
  const { log, race } = seed === SEEDS[0] ? first : raceLog(seed);
  const pole = poleOf(race), track = race.track, n = track.path.length, cover = track.covers[0];
  jumps += log.length;
  log.forEach((l, i) => {
    if (i > 0) {
      minGap = Math.min(minGap, l.start - log[i - 1].start);
      check(l.start - log[i - 1].start >= YETI.WARN + YETI.FLIGHT + YETI.STAND + YETI.LEAVE + YETI.GAP[0] - 1e-6 - 0.5, `seed ${seed}: two jumps only ${(l.start - log[i - 1].start).toFixed(1)}s apart`);
    }
    if (l.land > 0) check(Math.abs(l.land - l.start - (YETI.WARN + YETI.FLIGHT)) < 0.05, `seed ${seed}: the landing came ${(l.land - l.start).toFixed(2)}s after the warning (expected ${YETI.WARN + YETI.FLIGHT}s)`);
    // The spot: on the road, in a window of road before the entrance or after the exit, and away from the line.
    let best = 0, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(track.path[k].x - l.toX, track.path[k].y - l.toY);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    check(bd <= track.width / 2, `seed ${seed}: jump ${l.id} lands ${bd.toFixed(0)} px from the centre line (road half width ${track.width / 2})`);
    const fromEntrance = (cover.start - best + n) % n, fromExit = (best - cover.end + n) % n;
    check(fromEntrance <= YETI.WINDOW[1] + 3 || fromExit <= YETI.WINDOW[1] + 3, `seed ${seed}: jump ${l.id} lands far from the tunnel (${fromEntrance} / ${fromExit} samples)`);
    check(Math.min(best, n - best) * 10 >= YETI.SAFE_FINISH - 30, `seed ${seed}: jump ${l.id} lands next to the start line`);
    // It starts on the massif: its perch is over the tunnel.
    const perchIdx = (() => {
      let bi = 0, bdd = Infinity;
      for (let k = cover.start; k <= cover.end; k++) {
        const d = Math.hypot(track.path[k].x - l.fromX, track.path[k].y - l.fromY);
        if (d < bdd) {
          bdd = d;
          bi = k;
        }
      }
      return { bi, bdd };
    })();
    check(perchIdx.bdd < track.width, `seed ${seed}: jump ${l.id} starts ${perchIdx.bdd.toFixed(0)} px from the tunnel line, not over the massif`);
  });
  // Let the last jump finish: nothing is left (no leak).
  for (let i = 0; i < 12 * 120; i++) stepRace(race, NO_INPUT, DT, false);
  check(pole.yeti.state.jump === null, `seed ${seed}: a jump is still going 12 s after the end`);
  check(pole.yeti.state.popups.length === 0, `seed ${seed}: ${pole.yeti.state.popups.length} damage numbers still on screen after the end`);
  check(pole.yeti.bodies().length === 0, `seed ${seed}: the yeti body is still there after the end`);
  race.cars.forEach((c) => {
    if (c.hp < HEALTH.MAX) {
      if (c.isPlayer) hurtPlayer++;
      else hurtBots++;
    }
  });
  console.log(`  seed ${seed}: race ${race.time.toFixed(0)}s · ${log.length} jumps${log.length ? ` (first at ${log[0].start.toFixed(1)}s)` : ""} · ${race.cars.map((c) => `${c.hp}`).join("/")} PV`);
}
console.log(`  total ${jumps} jumps over ${SEEDS.length} races · min gap ${Number.isFinite(minGap) ? minGap.toFixed(1) : "-"}s · cars hurt: player ${hurtPlayer}, bots ${hurtBots}`);
check(jumps >= SEEDS.length, `only ${jumps} jumps over ${SEEDS.length} races: too few`);

// (b) same seed → same jumps.
{
  const again = raceLog(SEEDS[0]).log;
  const same = again.length === first.log.length && again.every((l, i) => l.start === first.log[i].start && l.toX === first.log[i].toX && l.toY === first.log[i].toY);
  check(same, "the same seed did not give the same jumps");
}

// ---------- scripted scenes ----------
/** A race on which the first jump has just reached its flight; the other cars parked far away and the player teleported under it. */
function toFlight(seed: number, under: "player" | "none" = "player"): { race: Race; pole: NorthPoleHazard; j: YetiJump; player: Car } {
  const race = newRace(seed);
  race.boost.enabled = false;
  const pole = poleOf(race);
  let guard = 0;
  while (!(jumpOf(race)?.phase === "flight") && guard++ < 240 * 120) step(race);
  const j = jumpOf(race);
  if (!j) throw new Error(`seed ${seed}: no jump in 240 s`);
  race.cars.slice(1).forEach((c, i) => (c.pos = { x: c.pos.x + 6000 * (i + 1), y: c.pos.y }));
  const player = race.cars[0];
  if (under === "player") {
    player.pos = { x: j.toX, y: j.toY };
    player.vel = { x: 0, y: 0 };
  } else {
    // Well away from the ring (a lane's width plus the radius, along the road).
    player.pos = { x: j.toX + 600, y: j.toY + 600 };
    player.vel = { x: 0, y: 0 };
  }
  return { race, pole, j, player };
}

// ---------- (c) the landing hurts what it lands on ----------
{
  const { race, pole, j, player } = toFlight(3);
  const bots = race.cars.slice(1);
  // Bot 1 right beside the landing (just outside the hurt radius), bot 2 under it but destroyed, bot 3 under it but airborne.
  const far = YETI.LAND_R + 17 + 6;
  bots[0].pos = { x: j.toX + far, y: j.toY };
  bots[1].pos = { x: j.toX, y: j.toY + 4 };
  bots[1].destroyedAt = race.time;
  bots[1].hp = 0;
  bots[2].pos = { x: j.toX - 4, y: j.toY };
  bots[2].alt = 30;
  player.vel = { x: 300, y: 0 };
  const hp0 = player.hp, cuesBefore = race.cues.length;
  const quakes: number[] = [];
  let guard = 0;
  while (jumpOf(race)?.phase === "flight" && guard++ < 10 * 120) {
    // Hold every car still, so only the landing acts on them.
    for (const c of race.cars) {
      if (c === player) player.pos = { x: j.toX, y: j.toY };
      else c.vel = { x: 0, y: 0 };
    }
    stepRace(race, NO_INPUT, DT, false);
  }
  void cuesBefore;
  void quakes;
  check(jumpOf(race)?.phase === "stand", "the jump never landed");
  check(player.hp === hp0 - YETI.DAMAGE, `the car under the landing lost ${hp0 - player.hp} points (expected ${YETI.DAMAGE})`);
  check(Math.hypot(player.vel.x, player.vel.y) < 300 * 0.75, `the car under the landing kept ${Math.hypot(player.vel.x, player.vel.y).toFixed(0)} of its 300 speed`);
  check(pole.yeti.state.popups.length === 1 && pole.yeti.state.popups[0].text === `-${YETI.DAMAGE}`, "no damage number over the car it hurt");
  check(bots[0].hp === HEALTH.MAX, "a car beside the landing lost points");
  check(bots[1].hp === 0 && isDestroyed(bots[1]), "the destroyed car was touched");
  check(bots[2].hp === HEALTH.MAX, "a car in the air lost points");
  check(pole.yeti.shake(player.pos).x !== 0 || pole.yeti.shake(player.pos).y !== 0, "no camera shake at the landing");
  check(race.hazard !== undefined && pole.shake!(player.pos).x === pole.yeti.shake(player.pos).x, "the north pole's hazard does not carry the yeti's shake");
  // A second of grace: standing there does not hurt again.
  const hp1 = player.hp;
  for (let i = 0; i < 0.9 * 120; i++) {
    player.pos = { x: j.toX + 80, y: j.toY };
    stepRace(race, NO_INPUT, DT, false);
  }
  check(player.hp === hp1, "the same landing hurt the car twice");
  // The yeti leaves and the state clears.
  guard = 0;
  while (jumpOf(race) && guard++ < 20 * 120) {
    for (const c of race.cars) c.vel = { x: 0, y: 0 };
    stepRace(race, NO_INPUT, DT, false);
  }
  check(jumpOf(race) === null, "the yeti never left");
  console.log(`  landing: ${hp0} → ${player.hp} PV · speed ${Math.hypot(player.vel.x, player.vel.y).toFixed(0)} · beside/destroyed/airborne untouched`);
}

// ---------- (d) the standing yeti is solid ----------
{
  const { race, pole, j, player } = toFlight(4, "none");
  let guard = 0;
  while (jumpOf(race)?.phase === "flight" && guard++ < 10 * 120) {
    for (const c of race.cars) c.vel = { x: 0, y: 0 };
    stepRace(race, NO_INPUT, DT, false);
  }
  const body: HazardBody = pole.yeti.bodies()[0];
  check(!!body, "the standing yeti has no body");
  if (body) {
    check(Math.hypot(body.x - j.toX, body.y - j.toY) < 1, "the body is not where the yeti landed");
    const dirx = Math.cos(body.angle), diry = Math.sin(body.angle);
    player.pos = { x: body.x + dirx * 120, y: body.y + diry * 120 };
    player.angle = Math.atan2(-diry, -dirx);
    player.vel = { x: -dirx * 350, y: -diry * 350 };
    player.hp = HEALTH.MAX;
    const hits0 = player.hits, bx = body.x, by = body.y;
    let minD = Infinity, inside = false;
    for (let i = 0; i < 2 * 120 && jumpOf(race)?.phase === "stand"; i++) {
      stepRace(race, NO_INPUT, DT, false);
      const b = pole.yeti.bodies()[0];
      if (!b) break;
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      const lx = (player.pos.x - b.x) * c + (player.pos.y - b.y) * s, ly = -(player.pos.x - b.x) * s + (player.pos.y - b.y) * c;
      if ((lx / b.rx) ** 2 + (ly / b.ry) ** 2 < 1 - 1e-6) inside = true;
      minD = Math.min(minD, Math.hypot(player.pos.x - b.x, player.pos.y - b.y));
      check(b.x === bx && b.y === by, "the standing yeti moved");
    }
    check(!inside, "a car got inside the yeti");
    check(player.hits - hits0 === 1, `${player.hits - hits0} contacts counted for one yeti (expected 1)`);
    check(player.hp === HEALTH.MAX, "bumping into the standing yeti took points");
    console.log(`  solid: closest ${minD.toFixed(0)} px · contacts counted ${player.hits - hits0} · yeti stayed put`);
  }
}

// ---------- (e) few points left: it explodes ----------
{
  const { race, player } = toFlight(5);
  player.hp = YETI.DAMAGE - 5;
  let guard = 0;
  const bots = race.cars.slice(1);
  while (jumpOf(race)?.phase === "flight" && guard++ < 10 * 120) {
    player.pos = { x: jumpOf(race)!.toX, y: jumpOf(race)!.toY };
    for (const c of bots) c.vel = { x: 0, y: 0 };
    stepRace(race, NO_INPUT, DT, false);
  }
  stepRace(race, NO_INPUT, DT, false);
  check(player.hp === 0 && isDestroyed(player), `a car with ${YETI.DAMAGE - 5} points left did not blow up (hp ${player.hp})`);
  check(race.blasts.length >= 1, "no explosion was recorded");
  console.log(`  explosion: hp ${player.hp} · destroyed ${isDestroyed(player)} · blasts ${race.blasts.length}`);
}

// ---------- (f) bots brake for the ring ----------
{
  // The same moment twice (same seed): a bot 400 px up the road from the landing at 400 u/s, with the ring announced to the bots, and with it hidden.
  const runBot = (announced: boolean) => {
    const { race, pole, j } = toFlight(6, "none");
    if (!announced) pole.dangers = () => [];
    const track = race.track, n = track.path.length;
    let at = 0, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(track.path[k].x - j.toX, track.path[k].y - j.toY);
      if (d < bd) {
        bd = d;
        at = k;
      }
    }
    const from = (at - 40 + n) % n, bot = race.cars[1], t = track.tangents[from];
    bot.pos = { ...track.path[from] };
    bot.angle = Math.atan2(t.y, t.x);
    bot.vel = { x: t.x * 400, y: t.y * 400 };
    bot.hp = HEALTH.MAX;
    let slowest = Infinity;
    for (let i = 0; i < 1.5 * 120 && jumpOf(race)?.phase === "flight"; i++) {
      race.cars.slice(2).forEach((c) => (c.vel = { x: 0, y: 0 }));
      stepRace(race, NO_INPUT, DT, false);
      if (Math.hypot(bot.pos.x - j.toX, bot.pos.y - j.toY) > 60) slowest = Math.min(slowest, Math.hypot(bot.vel.x, bot.vel.y));
    }
    return slowest;
  };
  const withRing = runBot(true), without = runBot(false);
  check(withRing < without * 0.9, `a bot did not slow for the ring (${withRing.toFixed(0)} against ${without.toFixed(0)} without)`);
  console.log(`  bots: slowest speed on the way to the ring ${withRing.toFixed(0)} (${without.toFixed(0)} when it is not announced)`);
}

// ---------- (g) the 3D adapter and the other modes ----------
{
  const race = newRace(7), a = new Adapter3D(race);
  let seenWarn = false, seenFlight = false, seenStand = false, seenLeave = false, guard = 0;
  while (!(seenLeave) && guard++ < 240 * 120) {
    step(race);
    a.refresh(0);
    const y = a.dangers.yeti, j = jumpOf(race);
    check((y === null) === (j === null), "the adapter's yeti does not follow the game's");
    if (y && j) {
      check(Math.abs(y.x - j.x) < 1e-9 && Math.abs(y.z - j.z) < 1e-9, "the adapter's yeti is not where the game's is");
      check(Number.isFinite(y.heading) && Number.isFinite(y.left) && y.left >= 0, "the adapter reports a non-finite yeti");
      if (y.phase === "warn") seenWarn = true;
      if (y.phase === "flight") {
        seenFlight = true;
        check(y.z >= 0 && y.z <= YETI.PERCH_H + YETI.APEX + 1, `the yeti flew ${y.z.toFixed(1)} m high`);
      }
      if (y.phase === "stand") {
        seenStand = true;
        check(y.z === 0, "the yeti stands above the ground");
      }
      if (y.phase === "leave") seenLeave = true;
    }
    // The bears are still read as bears (the standing yeti is not one).
    check(a.dangers.bears.length <= 1, "the adapter reads the yeti as a bear");
  }
  check(seenWarn && seenFlight && seenStand && seenLeave, "the adapter did not see the four moments of a jump");
  for (const mode of ["desert", "countryside", "volcano"] as ThemeId[]) {
    const r = newRace(1, mode);
    check(!("yeti" in (r.hazard ?? {})), `${mode} has a yeti`);
  }
  console.log("  3D adapter: the four moments seen · other modes have no yeti");
}

if (failed) {
  console.error("\ncheck:yeti FAILED");
  process.exit(1);
}
console.log("\ncheck:yeti OK");
