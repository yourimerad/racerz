// Volcano eruption checks. Run with `pnpm check:eruption` (same Node + hook as check:tracks).
//
//   (a) timeline (10.5 s cycle): bubbles during the pressure phase, the first blast at 1.6 s (110 bombs,
//       flash 1, shake 9), the second at 3.4 s (60 bombs, flash 0.8), ~70 bombs/s in the fountain,
//       7/s once it ebbs, glow 0.25 → 0.6 → 1 → 0.3, the cycle restarting without clearing the particles;
//   (b) time, not frames: the same game time at 120, 60 and 30 steps per second spawns the same amounts;
//   (c) bounded: over many cycles no list ever exceeds its cap (nothing leaks), and the stains stay off the road;
//   (d) purely visual: a full all-AI race plays out identically with and without the eruption.

import { aiInput, createRace, stepRace } from "../src/game/race";
import { mulberry32 } from "../src/game/scenery";
import { ERUPTION, VolcanoEruption } from "../src/game/modes/volcano";

let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const near = (what: string, got: number, want: number, tol: number) => {
  if (Math.abs(got - want) > tol) fail(`${what}: ${got.toFixed(3)} (expected ${want} ± ${tol})`);
};

console.log("Volcano eruption checks\n");

// ---------- (a) timeline ----------
{
  const e = new VolcanoEruption(mulberry32(7));
  const DT = 1 / 120;
  let t = 0;
  const run = (until: number) => {
    while (t < until - 1e-9) {
      e.update(DT);
      t += DT;
    }
  };
  near("glow at 0 s", e.glow(), 0.25, 1e-9);
  run(1.58);
  near("glow before the blast", e.glow(), 0.6, 0.09);
  const bubbles = e.spawned.bubbles;
  if (bubbles < 10 || bubbles > 16) fail(`pressure phase made ${bubbles} bubbles (expected ~13)`);
  if (e.spawned.bombs !== 0) fail("a bomb appeared before the blast");
  if (e.shake < 0.4 || e.shake > 2.2) fail(`pressure shake ${e.shake.toFixed(2)} outside 0.4-2 px`);
  run(1.63);
  if (!e.erupted) fail("no blast at 1.6 s");
  if (e.spawned.bombs < 110) fail(`first blast threw ${e.spawned.bombs} bombs (< 110)`);
  if (e.flash < 0.8) fail(`flash ${e.flash.toFixed(2)} right after the blast`);
  if (e.shake < 7) fail(`shake ${e.shake.toFixed(2)} right after the blast (expected ~9)`);
  if (e.spawned.smoke < 30 || e.spawned.sparks < 50) fail(`blast smoke ${e.spawned.smoke} / sparks ${e.spawned.sparks}`);
  const bombsBefore = e.spawned.bombs;
  run(3.38);
  const fountain = e.spawned.bombs - bombsBefore;
  near("fountain bombs over 1.75 s", fountain, 70 * 1.75, 6);
  run(3.42);
  if (!e.second) fail("no second blast at 3.4 s");
  near("flash after the second blast", e.flash, 0.8, 0.12);
  run(4.8);
  const b48 = e.spawned.bombs;
  near("bombs in the whole fountain", b48, 110 + 60 + 70 * 3.2, 8);
  near("glow at 4.8 s", e.glow(), 1, 1e-6);
  run(8);
  near("ebb bombs per second", (e.spawned.bombs - b48) / 3.2, 7, 1);
  near("glow at 8 s", e.glow(), 1 - 0.7 * (3.2 / 5), 0.02);
  if (e.bombs.length > ERUPTION.max.bombs + 1) fail("bomb cap exceeded");
  run(10.49);
  const smokeBefore = e.smoke.length, spotsBefore = e.spots.length;
  run(10.5 + 0.03);
  if (e.t > 0.1) fail(`the cycle did not restart (t=${e.t.toFixed(2)})`);
  if (e.erupted || e.second) fail("a new cycle must start un-erupted");
  if (smokeBefore > 0 && e.smoke.length < smokeBefore * 0.8) fail(`the restart cleared the smoke (${smokeBefore} → ${e.smoke.length})`);
  if (spotsBefore > 0 && e.spots.length < spotsBefore * 0.8) fail(`the restart cleared the lava stains (${spotsBefore} → ${e.spots.length})`);
  console.log(`  timeline ok · bombs ${e.spawned.bombs} · smoke ${e.spawned.smoke} · sparks ${e.spawned.sparks} · bubbles ${e.spawned.bubbles}`);
}

// ---------- (b) game time, not frames ----------
{
  const counts = [120, 60, 30].map((hz) => {
    const e = new VolcanoEruption(mulberry32(3));
    for (let i = 0; i < 10 * hz; i++) e.update(1 / hz);
    return e.spawned.bombs;
  });
  console.log(`  bombs over 10 s at 120/60/30 steps per second: ${counts.join(" / ")}`);
  // The blasts and the fountain are timed by the clock; the totals may differ only by the rounding of the accumulators
  // and of the random power (tiny: a few bombs in ~560).
  if (Math.max(...counts) - Math.min(...counts) > 12) fail(`bomb totals depend on the frame rate (${counts.join(" / ")})`);
}

// ---------- (c) bounded, stains off the road ----------
{
  const e = new VolcanoEruption(mulberry32(5), (x) => x > 400); // pretend everything right of x=400 is road
  let maxB = 0, maxSm = 0, maxSp = 0, maxSpots = 0, stainOnRoad = false;
  for (let i = 0; i < 12 * 10.5 * 120; i++) {
    e.update(1 / 120);
    maxB = Math.max(maxB, e.bombs.length);
    maxSm = Math.max(maxSm, e.smoke.length);
    maxSp = Math.max(maxSp, e.sparks.length);
    maxSpots = Math.max(maxSpots, e.spots.length);
    if (e.spots.some((s) => s.x > 400)) stainOnRoad = true;
  }
  console.log(`  peaks over 12 cycles: bombs ${maxB} · smoke ${maxSm} · sparks ${maxSp} · stains ${maxSpots}`);
  if (maxB > ERUPTION.max.bombs + 1) fail(`bombs peaked at ${maxB}`);
  if (maxSm > ERUPTION.max.smoke) fail(`smoke peaked at ${maxSm}`);
  if (maxSp > ERUPTION.max.sparks) fail(`sparks peaked at ${maxSp}`);
  if (maxSpots > ERUPTION.max.spots) fail(`stains peaked at ${maxSpots}`);
  if (stainOnRoad) fail("a lava stain was left on the road");
}

// ---------- (d) purely visual ----------
{
  const DT = 1 / 120;
  const finish = (withEruption: boolean) => {
    const race = createRace("volcano", { model: "gt", skin: "factory", level: 1 }, 9);
    if (!withEruption) race.hazard = null;
    while (race.time < 240 && race.cars.some((c) => c.finishTime === null)) stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
    return race.cars.map((c) => `${c.finishTime?.toFixed(3)}:${c.hits}`).join(" ");
  };
  const a = finish(true), b = finish(false);
  console.log(`  race with / without the eruption: ${a === b ? "identical" : "DIFFERENT"}`);
  if (a !== b) fail(`the eruption changed the race: ${a} vs ${b}`);
}

console.log(failed ? "\ncheck:eruption FAILED" : "\ncheck:eruption OK");
process.exit(failed ? 1 : 0);
