// Polar bear checks (north pole): the roaming obstacle must be fair, solid and leak-free.
// Run with `pnpm check:bear` (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
//
//   (a) over several seeded all-AI races: one bear at a time, never in the first 8 s, 20-40 s apart,
//       never appearing within 150 px of a car, gone from the list once it left the road, and the
//       list empty again at the end (no leak); every car still finishes without stalling;
//   (b) bots slow down near the bear and go round it when they can (their touches are only reported:
//       on the ice they cannot always swerve in time, the requirement is that they never stay stuck);
//   (c) a car driven straight at the bear: pushed out of the hitbox every step (never inside),
//       loses most of its speed, counts as exactly one contact however many times it touches it,
//       and the bear itself never changes course or speed.

import { aiInput, createRace, stepRace, TOTAL_LAPS, type Race } from "../src/game/race";
import { NO_INPUT, speedOf } from "../src/game/car";
import type { NorthPoleHazard } from "../src/game/modes/northpole";
import type { HazardBody } from "../src/game/scenery";

const DT = 1 / 120;
const SEEDS = [1, 2, 3, 4, 5, 6];
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};

function newRace(seed: number): Race {
  return createRace("northpole", { model: "gt", skin: "factory", level: 1 }, seed);
}

/** Whether a car centre sits inside a body's hitbox (the grown ellipse race.ts uses). */
function inside(b: HazardBody, x: number, y: number, grow: number): boolean {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const lx = (x - b.x) * c + (y - b.y) * s, ly = -(x - b.x) * s + (y - b.y) * c;
  return (lx / (b.rx + grow)) ** 2 + (ly / (b.ry + grow)) ** 2 < 1 - 1e-6;
}

/** The polar bears alone: the north pole's hazard also holds the yeti (check:yeti), whose standing body is not a bear. */
const bearsOf = (hz: NorthPoleHazard) => hz.bear.bodies?.() ?? [];

console.log("Polar bear checks (north pole)\n");

// ---------- (a) + (b): full all-AI races ----------
let totalBears = 0, botTouches = 0, minGap = Infinity;
for (const seed of SEEDS) {
  const race = newRace(seed);
  const hz = race.hazard as NorthPoleHazard | undefined;
  if (!hz) {
    fail("northpole has no hazard");
    break;
  }
  const pairs = new Set<string>(); // distinct (bear, bot) pairs that touched
  const touch = hz.touch!.bind(hz);
  hz.touch = (b, carId, at, p) => {
    if (carId !== 0) pairs.add(`${b.id}:${carId}`);
    return touch(b, carId, at, p);
  };
  const seen = new Map<number, { t: number }>();
  let lastSpawn = -Infinity, firstSpawn = -1;
  const still = race.cars.map(() => 0); // seconds each car has been almost motionless while racing
  const spawns: number[] = [];
  while (race.time < 240 && race.cars.some((c) => c.finishTime === null)) {
    stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
    const bodies = bearsOf(hz);
    if (bodies.length > 1) fail(`seed ${seed}: ${bodies.length} bears at once at t=${race.time.toFixed(1)}s`);
    for (const b of bodies) {
      if (!seen.has(b.id)) {
        seen.set(b.id, { t: race.time });
        spawns.push(race.time);
        if (firstSpawn < 0) firstSpawn = race.time;
        if (race.time < 8) fail(`seed ${seed}: a bear appeared at t=${race.time.toFixed(1)}s (< 8 s)`);
        const near = Math.min(...race.cars.map((c) => Math.hypot(c.pos.x - b.x, c.pos.y - b.y)));
        if (near < 150) fail(`seed ${seed}: a bear appeared ${near.toFixed(0)} px from a car`);
        if (lastSpawn > -Infinity) minGap = Math.min(minGap, race.time - lastSpawn);
        lastSpawn = race.time;
      }
    }
    // Stall detection: no car may sit (almost) still for 5 s while racing.
    let stalled = false;
    for (const c of race.cars) {
      still[c.id] = c.finishTime === null && race.phase === "racing" && Math.abs(speedOf(c)) < 5 ? still[c.id] + DT : 0;
      if (still[c.id] > 5) stalled = true;
    }
    if (stalled) {
      fail(`seed ${seed}: a car stayed almost still for over 5 s (t=${race.time.toFixed(1)}s)`);
      break;
    }
  }
  const unfinished = race.cars.filter((c) => c.finishTime === null);
  if (unfinished.length) fail(`seed ${seed}: ${unfinished.map((c) => c.name).join(", ")} did not finish ${TOTAL_LAPS} laps`);
  totalBears += spawns.length;
  botTouches += pairs.size;
  // Let the last bear walk off: the list must end empty.
  for (let i = 0; i < 20 * 120; i++) stepRace(race, NO_INPUT, DT, false);
  if (bearsOf(hz).length) fail(`seed ${seed}: ${bearsOf(hz).length} bear(s) still alive 20 s after the end (leak)`);
  console.log(`  seed ${seed}: race ${race.time.toFixed(0)}s · ${spawns.length} bears (first at ${firstSpawn.toFixed(1)}s) · bots that touched a bear ${pairs.size}`);
}
console.log(`  total ${totalBears} bears · (bear, bot) pairs that touched ${botTouches} of ${totalBears * 3} · min gap ${Number.isFinite(minGap) ? minGap.toFixed(1) : "-"}s`);
if (totalBears < SEEDS.length) fail(`only ${totalBears} bears over ${SEEDS.length} races: too few`);
if (Number.isFinite(minGap) && minGap < 20 - 1e-6) fail(`two bears only ${minGap.toFixed(1)}s apart (< 20 s)`);

// ---------- (c): drive straight into a bear ----------
{
  const race = newRace(11);
  race.boost.enabled = false; // plain physics for the scripted impact
  const hz = race.hazard as NorthPoleHazard;
  const player = race.cars[0];
  let bear: HazardBody | null = null;
  while (!bear && race.time < 120) {
    stepRace(race, aiInput(race, player, DT, false), DT); // the bear is placed ahead of a moving player
    bear = bearsOf(hz)[0] ?? null;
  }
  if (!bear) {
    fail("no bear appeared to test collisions");
  } else {
    // Park the other cars far away, put the player 160 px "upstream" of the bear on its walking line, driving at it.
    race.cars.slice(1).forEach((c, i) => (c.pos = { x: c.pos.x + 5000 * (i + 1), y: c.pos.y }));
    const dirx = Math.cos(bear.angle), diry = Math.sin(bear.angle);
    player.pos = { x: bear.x + dirx * 160, y: bear.y + diry * 160 }; // in front of the bear, facing it
    player.angle = Math.atan2(-diry, -dirx);
    const v0 = 380;
    player.vel = { x: -dirx * v0, y: -diry * v0 };
    const hits0 = player.hits;
    const bx0 = bear.x, by0 = bear.y;
    const steps = Math.floor(2.5 / DT);
    let minSpeed = v0, wasInside = false, impact = false, vAfter = v0;
    const t0 = race.time;
    for (let i = 0; i < steps; i++) {
      // Keep the throttle down: the car keeps pressing on the bear.
      stepRace(race, { ...NO_INPUT, throttle: true }, DT);
      const b = bearsOf(hz)[0];
      if (!b) break;
      if (inside(b, player.pos.x, player.pos.y, 13.6)) wasInside = true;
      const sp = Math.hypot(player.vel.x - b.vx, player.vel.y - b.vy);
      if (!impact && player.hits > hits0) {
        impact = true;
        vAfter = sp;
      }
      minSpeed = Math.min(minSpeed, sp);
    }
    const b = bearsOf(hz)[0];
    const dt = race.time - t0;
    if (!impact) fail("collision: the car did not register an impact");
    if (wasInside) fail("collision: the car ended a step inside the bear's hitbox");
    if (player.hits - hits0 !== 1) fail(`collision: ${player.hits - hits0} contacts counted (expected exactly 1)`);
    if (vAfter > v0 * 0.5) fail(`collision: speed after impact ${vAfter.toFixed(0)} (> 50% of ${v0})`);
    if (b) {
      const speedNow = Math.hypot(b.vx, b.vy);
      if (Math.abs(speedNow - 50) > 1e-6) fail(`collision: the bear's speed changed (${speedNow.toFixed(2)})`);
      const travelled = Math.hypot(b.x - bx0, b.y - by0);
      if (Math.abs(travelled - 50 * dt) > 0.5) fail(`collision: the bear was displaced (${travelled.toFixed(1)} vs ${(50 * dt).toFixed(1)})`);
    }
    console.log(`  collision: impact ${impact ? "yes" : "no"} · relative speed ${v0} → ${vAfter.toFixed(0)} · contacts counted ${player.hits - hits0} · never inside: ${!wasInside}`);
  }
}

console.log(failed ? "\ncheck:bear FAILED" : "\ncheck:bear OK");
process.exit(failed ? 1 : 0);
