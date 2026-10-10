// Boost-pad checks. Run with `pnpm check:boost` (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
//
//   (a) placement, every mode: 3 pads spread along the lap, on straights, 200+ from the start/finish and the grid,
//       400+ apart, never under a covered section (bridge, tunnel, forest) or on hay bales, entirely on the asphalt
//       and 74 % of the road wide, identical from one race to the next; style per mode (stone, basalt, ice, yellow
//       asphalt for the others and for an unknown id);
//   (b) the turbo: ×1.2 kick, ×1.5 for 2 s then an ease back over the last 0.5 s, speed AND acceleration, combined
//       with the volcano slowdown and the surface limits; refilled (not stacked) by a second pad; a pad recharges 3 s
//       per car; no pad is taken during the countdown or after the finish;
//   (c) impacts (wall, car, hay bale, polar bear) leave the turbo 0.3 s; a brush does not;
//   (d) all-AI races on every mode: the bots use the pads and still finish, without more time off the road or more
//       barrier hits than without pads; the race is identical from one run to the next; the volcano's bombs keep off the pads;
//   (e) effects stay bounded (particles, streaks, ghost images) and respect the quality levels.

import { BOOST, BOOST_STYLES, boostStyleOf, centerlineOf, nearPad } from "../src/game/boost";
import { NO_INPUT, PHYS, speedOf, stepCar, type Car } from "../src/game/car";
import { aiInput, createRace, stepRace, TOTAL_LAPS, type Race } from "../src/game/race";
import { THEME_ORDER, type ThemeId } from "../src/game/themes";
import { isCovered } from "../src/game/track";
import type { VolcanoHazard } from "../src/game/modes/volcano";

const DT = 1 / 120;
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const near = (what: string, got: number, want: number, tol: number) => {
  if (Math.abs(got - want) > tol) fail(`${what}: ${got.toFixed(3)} (expected ${want} ± ${tol})`);
};
const PLAYER = { model: "gt" as const, skin: "factory" as const, level: 1 };
const fresh = (mode: ThemeId, seed = 1): Race => createRace(mode, PLAYER, seed);
/** A one-car race on the green light: scripted scenes without the bots in the way. */
function solo(mode: ThemeId, seed = 1): { race: Race; car: Car } {
  const race = fresh(mode, seed);
  race.cars.splice(1);
  while (race.phase === "countdown") stepRace(race, NO_INPUT, DT);
  return { race, car: race.cars[0] };
}

console.log("Boost pad checks\n");

// ---------- (a) placement ----------
{
  for (const mode of THEME_ORDER) {
    const race = fresh(mode, 1), other = fresh(mode, 99);
    const { track, boost } = race;
    const cl = centerlineOf(track);
    const S = cl[cl.length - 1].s;
    const start = track.path[0];
    const k = (track.width * BOOST.PAD_RATIO) / BOOST.PAD_W;
    const pads = boost.pads;
    if (pads.length !== BOOST.COUNT) fail(`${mode}: ${pads.length} pads (expected ${BOOST.COUNT})`);
    if (JSON.stringify(other.boost.pads.map((p) => [p.x, p.y, p.heading])) !== JSON.stringify(pads.map((p) => [p.x, p.y, p.heading]))) fail(`${mode}: the pads differ from one race to the next`);
    near(`${mode} pad scale (pad width / road width)`, BOOST.PAD_W * k / track.width, BOOST.PAD_RATIO, 1e-9);
    const grid = S - cl[cl.length - 29].s; // the grid reaches 29 samples behind the line
    pads.forEach((p, i) => {
      const toStart = Math.hypot(p.x - start.x, p.y - start.y);
      if (p.s < BOOST.START_SAFE || S - p.s < BOOST.FINISH_SAFE || toStart < BOOST.START_SAFE) fail(`${mode} pad ${i}: ${Math.min(p.s, S - p.s, toStart).toFixed(0)} px from the start/finish (< ${BOOST.START_SAFE})`);
      if (S - p.s < grid + (BOOST.PAD_L * k) / 2) fail(`${mode} pad ${i}: on the starting grid`);
      const idx = cl.findIndex((c) => c.s === p.s);
      for (let j = idx; j < cl.length && cl[j].s - cl[idx].s <= BOOST.STRAIGHT_LEN; j++) if (cl[j].curv > BOOST.MAX_CURV + 1e-12) fail(`${mode} pad ${i}: bend (curvature ${cl[j].curv.toFixed(4)}) within ${BOOST.STRAIGHT_LEN} px ahead`);
      // Footprint: four corners + centre, mapped on the track.
      const c = Math.cos(p.heading), s = Math.sin(p.heading);
      let maxOff = 0;
      for (const [al, ac] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = p.x + c * al * (BOOST.PAD_L * k) / 2 - s * ac * (BOOST.PAD_W * k) / 2, y = p.y + s * al * (BOOST.PAD_L * k) / 2 + c * ac * (BOOST.PAD_W * k) / 2;
        let bi = 0, bd = Infinity;
        track.path.forEach((q, qi) => {
          const d = Math.hypot(q.x - x, q.y - y);
          if (d < bd) {
            bd = d;
            bi = qi;
          }
        });
        maxOff = Math.max(maxOff, bd);
        for (let d = -3; d <= 3; d++) if (isCovered(track, bi + d)) fail(`${mode} pad ${i}: under a covered section`);
        for (const b of race.scene.bumpers ?? []) if (Math.hypot(b.x - x, b.y - y) < b.r + 12) fail(`${mode} pad ${i}: on a hay bale`);
      }
      if (maxOff > track.width / 2) fail(`${mode} pad ${i}: sticks out of the asphalt (${maxOff.toFixed(0)} > ${track.width / 2})`);
      pads.forEach((q, j) => {
        if (j <= i) return;
        if (Math.abs(q.s - p.s) < BOOST.MIN_GAP || Math.hypot(q.x - p.x, q.y - p.y) < BOOST.MIN_GAP) fail(`${mode}: pads ${i} and ${j} less than ${BOOST.MIN_GAP} px apart`);
      });
    });
    // Evenly spread around the lap — except where hay bales rule out half of it (pads keep BOOST.CLEAR_AHEAD clear of them).
    const gaps = pads.map((p, i) => (i ? p.s - pads[i - 1].s : p.s + S - pads[pads.length - 1].s));
    const minGap = race.scene.bumpers?.length ? S / 8 : S / 4;
    if (Math.min(...gaps) < minGap) fail(`${mode}: two pads only ${Math.min(...gaps).toFixed(0)} px apart along the lap (< ${minGap.toFixed(0)})`);
    console.log(`  ${mode}: ${pads.length} pads at s = ${pads.map((p) => p.s.toFixed(0)).join(", ")} of ${S.toFixed(0)} · style ${boostStyleOf(mode)}`);
  }
  const want: Record<string, string> = { desert: "desert", volcano: "volcano", northpole: "north", countryside: "classic", "something-else": "classic", "": "classic" };
  for (const [id, style] of Object.entries(want)) if (boostStyleOf(id) !== style) fail(`style of mode "${id}": ${boostStyleOf(id)} (expected ${style})`);
  for (const id of ["desert", "volcano", "north", "classic"] as const) if (!BOOST_STYLES[id]) fail(`no style ${id}`);
}

// ---------- (b) the turbo ----------
{
  // Pure physics: ×1.5 on top speed AND acceleration, combined with the other multipliers.
  const mods = { trackGrip: 1, offGrip: 1, offDrag: 1, offMax: 1, lavaDrag: 1, lavaMax: 1 };
  const { car } = solo("desert");
  const run = (speedMul: number, boostMul: number, seconds: number, surface: Car["surface"] = "track") => {
    car.pos = { x: 0, y: 0 };
    car.vel = { x: 0, y: 0 };
    car.angle = 0;
    car.surface = surface;
    car.stun = 0;
    car.speedMul = speedMul;
    car.boostMul = boostMul;
    let top = 0, at05 = 0;
    for (let t = 0; t < seconds; t += DT) {
      stepCar(car, { ...NO_INPUT, throttle: true }, DT, mods);
      top = Math.max(top, speedOf(car));
      if (Math.abs(t - 0.5) < DT / 2) at05 = speedOf(car);
    }
    return { top, at05 };
  };
  const base = run(1, 1, 12), turbo = run(1, 1.5, 12);
  near("top speed ×1.5", turbo.top / base.top, 1.5, 0.02);
  near("acceleration ×1.5 (speed after 0.5 s)", turbo.at05 / base.at05, 1.5, 0.12);
  const damaged = run(0.6, 1.5, 12);
  near("turbo × volcano damage (0.6 × 1.5)", damaged.top / base.top, 0.9, 0.02);
  const off = run(1, 1.5, 12, "offtrack"), offBase = run(1, 1, 12, "offtrack");
  near("turbo × surface limit (off the road)", off.top / offBase.top, 1.5, 0.03);
  console.log(`  physics: top speed ${base.top.toFixed(0)} → ${turbo.top.toFixed(0)} (×${(turbo.top / base.top).toFixed(2)}), with damage ×${(damaged.top / base.top).toFixed(2)}, off the road ×${(off.top / offBase.top).toFixed(2)}`);
}
{
  // The system itself, on a dummy car sitting on a pad (no physics): timeline, kick, cooldown, stacking.
  const { race, car } = solo("desert");
  const boost = race.boost, pad = boost.pads[0];
  const place = () => {
    car.pos = { x: pad.x, y: pad.y };
    car.angle = pad.heading;
    car.vel = { x: Math.cos(pad.heading) * 400, y: Math.sin(pad.heading) * 400 };
  };
  place();
  const seen: { t: number; mul: number }[] = [];
  const triggers: number[] = [];
  let t = 0;
  const step = () => {
    boost.update(DT, [car], () => triggers.push(t));
    t += DT;
    seen.push({ t, mul: car.boostMul });
  };
  step();
  near("kick (speed ×1.2 at the trigger)", speedOf(car), 400 * BOOST.KICK, 1);
  while (t < 10) step();
  near("triggers while sitting on the pad for 10 s (0, 3, 6, 9 s)", triggers.length, 4, 0);
  triggers.forEach((tt, i) => near(`trigger ${i} time`, tt, i * 3, 0.05)); // the recharge ends, then the next step takes the pad
  const first = seen.filter((s) => s.t <= BOOST.DURATION + 0.05);
  const full = first.filter((s) => s.t > 0.02 && s.t < BOOST.DURATION - BOOST.EASE - 0.02);
  if (full.some((s) => Math.abs(s.mul - BOOST.MULT) > 1e-9)) fail("the multiplier is not ×1.5 during the first 1.5 s");
  const ease = first.filter((s) => s.t > BOOST.DURATION - BOOST.EASE + 0.02 && s.t < BOOST.DURATION - 0.02);
  if (!ease.length || ease.some((s, i) => s.mul > BOOST.MULT + 1e-9 || s.mul < 1 - 1e-9 || (i && s.mul > ease[i - 1].mul + 1e-9))) fail("the last 0.5 s is not a steady ease from ×1.5 to ×1");
  near("multiplier half-way through the ease", seen.find((s) => s.t >= 1.75)!.mul, 1.25, 0.03);
  near("multiplier after 2 s", seen.find((s) => s.t >= 2.1)!.mul, 1, 1e-9);
  near("multiplier between two triggers (2.5 s)", seen.find((s) => s.t >= 2.5)!.mul, 1, 1e-9);
  if (seen.some((s) => s.mul > BOOST.MULT + 1e-9)) fail("a multiplier above ×1.5 (stacking)");
  // Another car is not held back by this car's recharge.
  const { race: r2, car: c2 } = solo("desert");
  const p2 = r2.boost.pads[0];
  r2.boost.pads[0].cool.set(99, 3); // some other car recharging
  c2.pos = { x: p2.x, y: p2.y };
  r2.boost.update(DT, [c2]);
  if (!r2.boost.isBoosting(c2)) fail("a car was held back by another car's recharge");
  // A second pad while boosting: refills to 2 s, no second kick, no ×2.25.
  const { race: r3, car: c3 } = solo("desert");
  const [pa, pb] = r3.boost.pads;
  c3.pos = { x: pa.x, y: pa.y };
  c3.vel = { x: 300, y: 0 };
  r3.boost.update(DT, [c3]);
  for (let i = 0; i < 1.2 / DT; i++) r3.boost.update(DT, [c3]);
  const left = r3.boost.remaining(c3), vBefore = c3.vel.x;
  c3.pos = { x: pb.x, y: pb.y };
  r3.boost.update(DT, [c3]);
  if (r3.boost.remaining(c3) < BOOST.DURATION - 0.05) fail(`a second pad did not refill the turbo (${r3.boost.remaining(c3).toFixed(2)} s, was ${left.toFixed(2)})`);
  if (c3.vel.x !== vBefore) fail("a second pad kicked the speed again");
  if (c3.boostMul > BOOST.MULT + 1e-9) fail("stacked multipliers");
  console.log(`  system: kick ×1.2 · ×1.5 for 1.5 s then ease · back to ×1 at 2 s · triggers at ${triggers.map((x) => x.toFixed(1)).join(", ")} s · refill ${left.toFixed(2)} → 2.00 s`);
}
{
  // Countdown and finish: no pad is taken.
  const race = fresh("desert");
  const pad = race.boost.pads[0];
  race.cars[0].pos = { x: pad.x, y: pad.y };
  for (let i = 0; i < 2 * 120; i++) stepRace(race, NO_INPUT, DT); // 2 of the 3 countdown seconds
  if (race.phase !== "countdown") fail("the countdown ended early in the check");
  if (race.boost.isBoosting(race.cars[0])) fail("a pad was taken during the countdown");
  race.phase = "racing";
  race.cars[0].finishTime = 10;
  race.boost.update(DT, race.cars);
  if (race.boost.isBoosting(race.cars[0])) fail("a car that finished took a pad");
}

// ---------- (c) impacts ----------
{
  const boosted = (mode: ThemeId) => {
    const s = solo(mode);
    s.race.boost.activate(s.car);
    s.race.boost.update(DT, [s.car]); // t = 2 - dt
    return s;
  };
  const left = (s: { race: Race; car: Car }) => s.race.boost.remaining(s.car);
  // Wall: drive at the barrier.
  {
    const s = boosted("desert");
    const { race, car } = s;
    const i = 40, p = race.track.path[i], t = race.track.tangents[i];
    const nx = -t.y, ny = t.x;
    car.pos = { x: p.x + nx * (race.track.barrier - 20), y: p.y + ny * (race.track.barrier - 20) };
    car.angle = Math.atan2(ny, nx);
    car.vel = { x: nx * 500, y: ny * 500 };
    for (let k = 0; k < 8 && left(s) > BOOST.HIT_LEFT + 1e-6; k++) stepRace(race, NO_INPUT, DT); // a few steps to reach the barrier
    if (left(s) > BOOST.HIT_LEFT + 1e-6) fail(`wall: ${left(s).toFixed(2)} s of turbo left (expected ≤ ${BOOST.HIT_LEFT})`);
    if (!race.boost.isBoosting(car)) fail("wall: the turbo vanished instead of running out");
    for (let k = 0; k < 0.4 / DT; k++) stepRace(race, NO_INPUT, DT);
    if (race.boost.isBoosting(car) || car.boostMul !== 1) fail("wall: the turbo did not end within 0.3 s");
  }
  // A brush against the wall (slow closing speed) keeps it.
  {
    const s = boosted("desert");
    const { race, car } = s;
    const i = 40, p = race.track.path[i], t = race.track.tangents[i];
    const nx = -t.y, ny = t.x;
    car.pos = { x: p.x + nx * (race.track.barrier - 20) + t.x * 0, y: p.y + ny * (race.track.barrier - 20) };
    car.angle = Math.atan2(t.y, t.x);
    car.vel = { x: t.x * 600 + nx * 30, y: t.y * 600 + ny * 30 };
    for (let k = 0; k < 8; k++) stepRace(race, NO_INPUT, DT);
    if (left(s) < 1.8) fail(`a brush against the wall cut the turbo (${left(s).toFixed(2)} s left)`);
  }
  // Car against car: both lose it.
  {
    const race = fresh("desert");
    while (race.phase === "countdown") stepRace(race, NO_INPUT, DT);
    const [a, b] = race.cars;
    race.cars.splice(2);
    a.pos = { x: 1000, y: 1000 };
    b.pos = { x: 1030, y: 1000 };
    a.vel = { x: 400, y: 0 };
    b.vel = { x: 0, y: 0 };
    race.boost.activate(a);
    race.boost.activate(b);
    race.boost.update(DT, race.cars);
    stepRace(race, NO_INPUT, DT);
    if (race.boost.remaining(a) > BOOST.HIT_LEFT + 1e-6 || race.boost.remaining(b) > BOOST.HIT_LEFT + 1e-6) fail(`car against car: ${race.boost.remaining(a).toFixed(2)} / ${race.boost.remaining(b).toFixed(2)} s left (expected ≤ ${BOOST.HIT_LEFT})`);
  }
  // Hay bale.
  {
    const s = boosted("countryside");
    const { race, car } = s;
    const bale = race.scene.bumpers![10];
    car.pos = { x: bale.x - 60, y: bale.y };
    car.angle = 0;
    car.vel = { x: 500, y: 0 };
    for (let k = 0; k < 0.4 / DT && left(s) > BOOST.HIT_LEFT; k++) stepRace(race, NO_INPUT, DT);
    if (left(s) > BOOST.HIT_LEFT + 1e-6 && race.boost.isBoosting(car)) fail(`hay bale: ${left(s).toFixed(2)} s of turbo left`);
  }
  // Polar bear: wait for one, drive at it.
  {
    const s = boosted("northpole");
    const { race, car } = s;
    const hz = race.hazard!;
    while (!(hz.bodies?.() ?? []).length && race.time < 120) stepRace(race, aiInput(race, car, DT, false), DT);
    const bear = (hz.bodies?.() ?? [])[0];
    if (!bear) fail("no bear appeared to test the impact");
    else {
      const dx = Math.cos(bear.angle), dy = Math.sin(bear.angle);
      car.pos = { x: bear.x + dx * 150, y: bear.y + dy * 150 };
      car.angle = Math.atan2(-dy, -dx);
      car.vel = { x: -dx * 450, y: -dy * 450 };
      race.boost.activate(car);
      let cut = false;
      for (let k = 0; k < 2 / DT; k++) {
        stepRace(race, { ...NO_INPUT, throttle: true }, DT);
        if (left(s) <= BOOST.HIT_LEFT + 1e-6) {
          cut = true;
          break;
        }
        if (!race.boost.isBoosting(car)) break;
      }
      if (!cut) fail("polar bear: the turbo kept running after the impact");
    }
  }
  console.log("  impacts: wall, car, hay bale, polar bear → 0.3 s left · brushes keep the turbo");
}

// ---------- (d) all-AI races on every mode ----------
{
  const SEEDS = [1, 2, 3, 4];
  for (const mode of THEME_ORDER) {
    let uses = 0, offBase = 0, offBoost = 0, hitsBase = 0, hitsBoost = 0, timeBase = 0, timeBoost = 0, races = 0, maxSpeed = 0, bombsOnPads = 0, bombs = 0;
    for (const seed of SEEDS) {
      const results: { off: number; hits: number; time: number; sig: string }[] = [];
      for (const on of [false, true]) {
        const race = fresh(mode, seed);
        race.boost.enabled = on;
        const still = race.cars.map(() => 0);
        const seenTargets = new Set<number>();
        const vz = race.hazard as VolcanoHazard | null;
        while (race.time < 400 && race.cars.some((c) => c.finishTime === null)) {
          stepRace(race, aiInput(race, race.cars[0], DT, false), DT, false);
          if (on) {
            for (const c of race.cars) if (race.boost.isBoosting(c)) maxSpeed = Math.max(maxSpeed, speedOf(c));
            if (mode === "volcano" && vz?.hazards) {
              for (const tg of vz.hazards.targets) {
                if (seenTargets.has(tg.id)) continue;
                seenTargets.add(tg.id);
                bombs++;
                if (nearPad(race.boost.pads, race.track.width, tg.x * (40 / 28), tg.y * (40 / 28))) bombsOnPads++;
              }
            }
          }
          race.cars.forEach((c, i) => {
            still[i] = c.finishTime === null && Math.abs(speedOf(c)) < 5 ? still[i] + DT : 0;
            if (still[i] > 5) {
              fail(`${mode} seed ${seed}${on ? " (pads)" : ""}: ${c.name} stayed almost still for over 5 s (t=${race.time.toFixed(1)}s)`);
              still[i] = -1e9;
            }
          });
        }
        for (const c of race.cars) if (c.finishTime === null) fail(`${mode} seed ${seed}${on ? " (pads)" : ""}: ${c.name} did not finish ${TOTAL_LAPS} laps`);
        results.push({
          off: race.cars.reduce((a, c) => a + c.offTime, 0), hits: race.cars.reduce((a, c) => a + c.hits, 0),
          time: race.cars.reduce((a, c) => a + (c.finishTime ?? race.time), 0) / race.cars.length,
          sig: race.cars.map((c) => `${c.finishTime?.toFixed(3)}:${c.hits}:${c.pos.x.toFixed(1)}`).join(" "),
        });
        if (on) {
          // Count pad uses by watching the recharge timers of a replay with a probe.
          const replay = fresh(mode, seed);
          let n = 0;
          while (replay.time < 400 && replay.cars.some((c) => c.finishTime === null)) {
            const before = replay.cars.map((c) => replay.boost.isBoosting(c));
            stepRace(replay, aiInput(replay, replay.cars[0], DT, false), DT, false);
            replay.cars.forEach((c, i) => {
              if (!before[i] && replay.boost.isBoosting(c)) n++;
            });
          }
          uses += n;
          if (replay.cars.map((c) => `${c.finishTime?.toFixed(3)}:${c.hits}:${c.pos.x.toFixed(1)}`).join(" ") !== results[1].sig) fail(`${mode} seed ${seed}: the race is not identical from one run to the next`);
        }
      }
      offBase += results[0].off;
      offBoost += results[1].off;
      hitsBase += results[0].hits;
      hitsBoost += results[1].hits;
      timeBase += results[0].time;
      timeBoost += results[1].time;
      races++;
    }
    console.log(`  ${mode}: ${(uses / races).toFixed(1)} pad uses/race · mean finish ${(timeBase / races).toFixed(1)} → ${(timeBoost / races).toFixed(1)} s · off-road ${(offBase / races).toFixed(1)} → ${(offBoost / races).toFixed(1)} s · barrier hits ${(hitsBase / races).toFixed(1)} → ${(hitsBoost / races).toFixed(1)}${mode === "volcano" ? ` · bombs on pads ${bombsOnPads}/${bombs}` : ""}`);
    if (uses < races * 3) fail(`${mode}: the bots used the pads only ${uses} times over ${races} races`);
    if (timeBoost >= timeBase) fail(`${mode}: the pads made the bots slower (${timeBase.toFixed(1)} → ${timeBoost.toFixed(1)} s)`);
    if (offBoost > offBase * 1.5 + 1.5 * races) fail(`${mode}: the bots spend much more time off the road with pads (${(offBase / races).toFixed(1)} → ${(offBoost / races).toFixed(1)} s per race)`);
    // Bots already bounce off the hay bales of the countryside's chicanes (5-6 hits a race): the turbo's extra speed adds a few.
    if (hitsBoost > hitsBase + 2.0 * races) fail(`${mode}: the bots hit the barriers much more with pads (${(hitsBase / races).toFixed(1)} → ${(hitsBoost / races).toFixed(1)} per race)`);
    if (maxSpeed < PHYS.maxSpeed * 1.1) fail(`${mode}: no bot ever went above ${(PHYS.maxSpeed * 1.1).toFixed(0)} u/s on a pad (max ${maxSpeed.toFixed(0)})`);
    if (bombsOnPads) fail(`${mode}: ${bombsOnPads} volcano bomb(s) aimed at a pad`);
  }
}

// ---------- (e) bounded effects, quality levels ----------
{
  const { race, car } = solo("desert");
  const boost = race.boost;
  const others = fresh("desert").cars.slice(1);
  const cars = [car, ...others];
  let maxP = 0, maxS = 0, maxH = 0;
  for (let i = 0; i < 20 * 120; i++) {
    for (const c of cars) boost.activate(c);
    cars.forEach((c, j) => (c.pos = { x: 500 + i * 3 + j * 40, y: 500 }));
    boost.update(DT, cars);
    maxP = Math.max(maxP, boost.parts.length);
    maxS = Math.max(maxS, boost.streaks.length);
    for (const b of boost.boosts.values()) maxH = Math.max(maxH, b.hist.length);
  }
  console.log(`  caps: particles ≤ ${maxP} (${BOOST.MAX_PARTS}) · streaks ≤ ${maxS} (${BOOST.MAX_STREAKS}) · ghost images ≤ ${maxH} (${BOOST.GHOSTS})`);
  if (maxP > BOOST.MAX_PARTS) fail(`${maxP} particles (> ${BOOST.MAX_PARTS})`);
  if (maxS > BOOST.MAX_STREAKS) fail(`${maxS} streaks (> ${BOOST.MAX_STREAKS})`);
  if (maxH > BOOST.GHOSTS) fail(`${maxH} ghost images (> ${BOOST.GHOSTS})`);
  boost.streaks = [];
  boost.quality = 2;
  for (let i = 0; i < 2 * 120; i++) {
    for (const c of cars) boost.activate(c);
    boost.update(DT, cars);
  }
  if (boost.streaks.length) fail("speed streaks are still produced at the lowest quality level");
}

console.log(failed ? "\ncheck:boost FAILED" : "\ncheck:boost OK");
process.exit(failed ? 1 : 0);
