// Hay-bale bumper checks (countryside). Run with `pnpm check:bales` (same Node + hook as check:tracks).
//
// Regression guard for the "teleporting" glitch: the bales' rebound is springy (> 1), so a car crossing the road
// between the two rows used to gain speed on every hit (380 → 551 → 799 → … → 3 000+ u/s) and ended up skipping
// over the bales. Cars are fired at the rows from many angles and speeds; whatever happens they must never go
// faster than ~1.35× their top speed, never jump more than a few px in one step, and a head-on hit must still
// bounce them back. (A glancing hit at full speed legitimately reaches ~1.15× top speed — the 300 u/s minimum kick adds
// to the speed along the row — so the ceiling is 1.35×; the glitch went past 5×.)

import { createRace, stepRace } from "../src/game/race";
import { NO_INPUT, PHYS } from "../src/game/car";
import { locate } from "../src/game/track";

const DT = 1 / 120;
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};

console.log("Hay-bale checks (countryside)\n");

let trials = 0, worstSpeed = 0, worstStep = 0, noBounce = 0;
for (const side of [-1, 1]) for (const ang of [0, 15, 30, 45, 60, 80, 90]) for (const speed of [80, 200, 380, 540]) for (let k = 0; k < 6; k++) {
  const race = createRace("countryside", { model: "gt", skin: "factory", level: 1 }, 1);
  race.boost.enabled = false; // plain physics: these cars must not pick up a boost pad on the way
  const me = race.cars[0];
  race.cars.slice(1).forEach((c, i) => (c.pos = { x: c.pos.x + 9000 * (i + 1), y: c.pos.y })); // keep the others out of the way
  const rows = race.scene.bumpers!.filter((b) => Math.sign(locate(race.track, b).offset) === side);
  const loc = locate(race.track, rows[20 + k * 7]);
  const t = race.track.tangents[loc.index], rn = { x: -t.y, y: t.x };
  // On the road, 35 px off the centre line toward the bales, heading at them `ang` degrees off the road axis.
  me.pos = { x: race.track.path[loc.index].x + rn.x * side * 35, y: race.track.path[loc.index].y + rn.y * side * 35 };
  const a0 = Math.atan2(t.y, t.x) + (side * (ang * Math.PI)) / 180;
  me.angle = a0;
  me.vel = { x: Math.cos(a0) * speed, y: Math.sin(a0) * speed };
  race.time = 0;
  race.phase = "racing";
  trials++;
  let prev = { ...me.pos }, hitSeen = false, peak = 0;
  for (let i = 0; i < 360; i++) {
    const hitsBefore = me.hits;
    stepRace(race, { ...NO_INPUT, throttle: true }, DT);
    const sp = Math.hypot(me.vel.x, me.vel.y);
    worstSpeed = Math.max(worstSpeed, sp);
    worstStep = Math.max(worstStep, Math.hypot(me.pos.x - prev.x, me.pos.y - prev.y));
    if (me.hits > hitsBefore) hitSeen = true;
    if (hitSeen) peak = Math.max(peak, sp);
    prev = { ...me.pos };
  }
  // A head-on hit (ang 90, fast enough to count) must still bounce the car back with some speed.
  if (ang === 90 && speed >= 200 && hitSeen && peak < 250) noBounce++;
}
const cap = 1.35 * PHYS.maxSpeed;
console.log(`  ${trials} trials · top speed seen ${worstSpeed.toFixed(0)} u/s (limit ${cap.toFixed(0)}) · biggest move in one step ${worstStep.toFixed(1)} px`);
if (worstSpeed > cap) fail(`a car reached ${worstSpeed.toFixed(0)} u/s after hitting the bales (> ${cap.toFixed(0)})`);
if (worstStep > 8) fail(`a car moved ${worstStep.toFixed(1)} px in one step (teleport)`);
if (noBounce) fail(`${noBounce} head-on hits did not bounce the car back`);

console.log(failed ? "\ncheck:bales FAILED" : "\ncheck:bales OK");
process.exit(failed ? 1 : 0);
