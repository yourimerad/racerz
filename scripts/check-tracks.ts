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
//   (e) the volcano's circuit goes both round the cone and through it: a lap of at least 9 000 u (it was 5 941), a covered lava tube
//       whose road passes within 350 u of the crater and half-turns round it (>= 150 degrees), and an open ring that reaches 1 000 u out;
//   (d) an all-AI race (car 0 included — see race.ts's exported `aiInput`) finishes every lap
//       within 240s simulated, with no car stalled (no progress) for more than 5s.
//
// Prints a one-line summary per mode and exits non-zero if anything fails.

import { isDestroyed } from "../src/game/health";
import { layerSize } from "../src/game/layer";
import { aiInput, createRace, stepRace, TOTAL_LAPS } from "../src/game/race";
import { THEMES, type ThemeId } from "../src/game/themes";
import { CONE } from "../src/game/modes/volcano";
import { isCovered, type Track } from "../src/game/track";

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

/** (e) The volcano's lap: a big ring round the cone and a covered tube through it, half-turning round the crater. */
function checkVolcano(track: Track): string | null {
  const n = track.path.length, len = lapLength(track);
  if (len < 9000) return `the lap is only ${len.toFixed(0)}u (the volcano's circuit is meant to be longer than 9 000u)`;
  let closest = Infinity, far = 0, turn = 0, prev: number | null = null, covered = 0;
  for (let i = 0; i < n; i++) {
    const p = track.path[i], d = Math.hypot(p.x - CONE.x, p.y - CONE.y);
    far = Math.max(far, d);
    if (!isCovered(track, i)) continue;
    covered++;
    closest = Math.min(closest, d);
    const a = Math.atan2(track.tangents[i].y, track.tangents[i].x);
    if (prev !== null) turn += Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
    prev = a;
  }
  if (!covered) return "the volcano has no covered stretch (the lava tube)";
  if (closest > 350) return `the tube stays ${closest.toFixed(0)}u from the crater (> 350u): it does not go through the mountain`;
  if (Math.abs(turn) < (150 * Math.PI) / 180) return `the tube turns only ${((Math.abs(turn) * 180) / Math.PI).toFixed(0)} degrees round the crater (< 150)`;
  if (far < 1000) return `the circuit never gets farther than ${far.toFixed(0)}u from the cone (< 1 000u): no ring round it`;
  return null;
}

/** (d) Drive every car with aiInput (car 0 included) and watch for timeouts/stalls. */
function simulateAllAi(themeId: ThemeId): { ok: true; avgLap: number } | { ok: false; message: string } {
  const race = createRace(themeId, { model: "gt", skin: "factory", level: 1 });
  const lastProgress = race.cars.map((c) => c.progress);
  const lastProgressTime = race.cars.map(() => 0);
  // (A car that ran out of points blows up and is out of the race: it neither finishes nor counts as stuck.)
  while (race.time < MAX_SIM_TIME && race.cars.some((c) => c.finishTime === null && !isDestroyed(c))) {
    stepRace(race, aiInput(race, race.cars[0], DT, false), DT);
    for (const car of race.cars) {
      if (car.progress > lastProgress[car.id] + 0.01) {
        lastProgress[car.id] = car.progress;
        lastProgressTime[car.id] = race.time;
      } else if (car.finishTime === null && !isDestroyed(car) && race.time - lastProgressTime[car.id] > STALL_TIME) {
        return { ok: false, message: `${car.name} stalled (no progress for >${STALL_TIME}s) near sample ${car.lastIndex}, t=${race.time.toFixed(1)}s` };
      }
    }
  }
  const unfinished = race.cars.filter((c) => c.finishTime === null && !isDestroyed(c));
  if (unfinished.length) return { ok: false, message: `${unfinished.map((c) => c.name).join(", ")} did not finish ${TOTAL_LAPS} laps within ${MAX_SIM_TIME}s` };
  const finishers = race.cars.filter((c) => c.finishTime !== null);
  const avgLap = finishers.reduce((sum, c) => sum + c.finishTime! / TOTAL_LAPS, 0) / Math.max(1, finishers.length);
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

  if (id === "volcano") {
    const v = checkVolcano(track);
    if (v) fail("volcano circuit", v);
    else console.log("  circuit      ring round the cone + a lava tube through it (half-turn round the crater)");
  }

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
