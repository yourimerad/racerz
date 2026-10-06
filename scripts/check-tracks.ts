// Track invariant checks, one mode at a time (run before committing anything in src/game that
// touches a track layout, the static layer, or scenery). Needs no dependency beyond Node's own
// native TypeScript support — see `check:tracks` in package.json for the exact command
// (the --disable-warning flag just silences Node's "no type field in package.json" notice).
//
// For every mode:
//   (a) parts of the loop more than ~4*barrier apart along the track never get geometrically
//       close enough to look like they touch;
//   (b) the cached static layer (see layer.ts) keeps a legible resolution (scale >= 0.6);
//   (c) covered sections (CoverLayout, see track.ts) convert to well-formed sample ranges;
//   (d) an all-AI race (car 0 included — see race.ts's exported `aiInput`) finishes every lap
//       within 240s simulated, with no car stalled (no progress) for more than 5s.
//
// Prints a one-line summary per mode and exits non-zero if anything fails.

import { layerSize } from "../src/game/layer";
import { aiInput, createRace, stepRace, TOTAL_LAPS } from "../src/game/race";
import { THEMES, type ThemeId } from "../src/game/themes";
import type { Track } from "../src/game/track";

const MODE_IDS: ThemeId[] = ["desert", "countryside", "northpole", "volcano"];
const DT = 1 / 60; // simulation step; physics has no randomness so this is deterministic
const MAX_SIM_TIME = 240;
const STALL_TIME = 5;

let failed = false;
function fail(label: string, msg: string) {
  console.error(`  [FAIL] ${label}: ${msg}`);
  failed = true;
}

function lapLength(track: Track): number {
  let total = 0;
  const n = track.path.length;
  for (let i = 0; i < n; i++) {
    const a = track.path[i], b = track.path[(i + 1) % n];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** (a) Any two samples far apart along the loop must also stay far apart in space. */
function checkSeparation(track: Track): string | null {
  const n = track.path.length;
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(track.path[i].x - track.path[i - 1].x, track.path[i].y - track.path[i - 1].y);
  const loopLen = arc[n - 1] + Math.hypot(track.path[0].x - track.path[n - 1].x, track.path[0].y - track.path[n - 1].y);
  const minArc = 4 * track.barrier;
  const minDist = 2 * track.barrier + 40;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const fwd = arc[j] - arc[i];
      const along = Math.min(fwd, loopLen - fwd);
      if (along <= minArc) continue;
      const dist = Math.hypot(track.path[j].x - track.path[i].x, track.path[j].y - track.path[i].y);
      if (dist < minDist) return `samples ${i} & ${j} are ${along.toFixed(0)}u apart along the loop but only ${dist.toFixed(0)}u apart in space (need >= ${minDist.toFixed(0)}u)`;
    }
  }
  return null;
}

/** (c) Covered ranges must be in-bounds sample indices, and neither empty nor the whole loop. */
function checkCovers(track: Track): string | null {
  const n = track.path.length;
  for (const c of track.covers) {
    if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < 0 || c.start >= n || c.end < 0 || c.end >= n)
      return `cover [${c.start}, ${c.end}] out of range for ${n} samples`;
    const length = c.start <= c.end ? c.end - c.start + 1 : n - c.start + c.end + 1;
    if (length <= 0 || length >= n) return `cover [${c.start}, ${c.end}] has degenerate length ${length} (of ${n})`;
  }
  return null;
}

/** (d) Drive every car with aiInput (car 0 included) and watch for timeouts/stalls. */
function simulateAllAi(themeId: ThemeId): { ok: true; avgLap: number } | { ok: false; message: string } {
  const race = createRace(themeId, { model: "gt", skin: "factory", level: 1 });
  const lastProgress = race.cars.map((c) => c.progress);
  const lastProgressTime = race.cars.map(() => 0);
  while (race.time < MAX_SIM_TIME && race.cars.some((c) => c.finishTime === null)) {
    stepRace(race, aiInput(race, race.cars[0]), DT);
    for (const car of race.cars) {
      if (car.progress > lastProgress[car.id] + 0.01) {
        lastProgress[car.id] = car.progress;
        lastProgressTime[car.id] = race.time;
      } else if (car.finishTime === null && race.time - lastProgressTime[car.id] > STALL_TIME) {
        return { ok: false, message: `${car.name} stalled (no progress for >${STALL_TIME}s) near sample ${car.lastIndex}, t=${race.time.toFixed(1)}s` };
      }
    }
  }
  const unfinished = race.cars.filter((c) => c.finishTime === null);
  if (unfinished.length) return { ok: false, message: `${unfinished.map((c) => c.name).join(", ")} did not finish ${TOTAL_LAPS} laps within ${MAX_SIM_TIME}s` };
  const avgLap = race.cars.reduce((sum, c) => sum + c.finishTime! / TOTAL_LAPS, 0) / race.cars.length;
  return { ok: true, avgLap };
}

console.log("Checking tracks for all modes...\n");

for (const id of MODE_IDS) {
  const theme = THEMES[id];
  const track = createRace(id, { model: "gt", skin: "factory", level: 1 }).track;
  const { s: scale } = layerSize(track);
  console.log(`${theme.name} (${id})`);
  console.log(`  lap length   ${lapLength(track).toFixed(0)}u`);
  console.log(`  layer scale  ${scale.toFixed(3)}`);

  const sep = checkSeparation(track);
  if (sep) fail("separation", sep);

  if (scale < 0.6) fail("layer scale", `${scale.toFixed(3)} < 0.6`);

  const cov = checkCovers(track);
  if (cov) fail("covers", cov);
  else console.log(`  covers       ok (${track.covers.length})`);

  const sim = simulateAllAi(id);
  if (!sim.ok) fail("all-AI race", sim.message);
  else console.log(`  AI avg lap   ${sim.avgLap.toFixed(1)}s`);

  console.log();
}

if (failed) {
  console.error("check:tracks FAILED");
  process.exit(1);
}
console.log("check:tracks OK");
