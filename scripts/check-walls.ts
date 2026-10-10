// Racerz Jet over the walls. Run with `pnpm check:walls` (same Node + hook as check:tracks). Fails (non-zero exit) on any breach.
//
//   (a) floor altitudes: 0 inside the barriers, 60 / 50 / 40 / 35 beyond them (desert / volcano / north pole / any other mode), 25 over the crater lake;
//   (b) crossing: a Jet at the wall's height flies over it in every mode, one metre lower it hits it (a contact, the usual bounce); the world's outer
//       limits stay solid at any altitude; every other car — a Racerz GT, a bot, the Jet itself on the ground — is stopped by the walls as before;
//   (c) energy: 1.5 / s over a wall, 1 / s elsewhere; release Shift over a wall → it glides at the wall's height and lands only on the road; an empty
//       tank over a wall → no forced return: it keeps gliding at the wall's height and lands when it is over the road again (no jump, no penalty);
//       no-fly zones over a wall → it cannot land there either; flying is not time off the road and has no ground drag;
//   (d) a real shortcut in the desert: over the wall to the other side of a bend, back on the road, landing;
//   (e) no checkpoints: nothing ever puts the Jet back on the road (a lap flown over a wall counts, with no penalty, no jump, no message);
//       the line is never crossed in the air over a wall either;
//   (f) takeoff dust is a small capped cloud.

import { NO_INPUT, isAirborne, speedOf, type Car } from "../src/game/car";
import { FLY, WALLS, wallHeightOf } from "../src/game/flight";
import { aiInput, createRace, stepRace, TOTAL_LAPS, type PlayerCar, type Race } from "../src/game/race";
import type { VolcanoHazard } from "../src/game/modes/volcano";
import { THEME_ORDER, type ThemeId } from "../src/game/themes";
import { locate } from "../src/game/track";

const DT = 1 / 120;
let failed = false;
const fail = (msg: string) => {
  console.error(`  [FAIL] ${msg}`);
  failed = true;
};
const check = (cond: boolean, msg: string) => {
  if (!cond) fail(msg);
};
const near = (what: string, got: number, want: number, tol: number) => {
  if (Math.abs(got - want) > tol) fail(`${what}: ${got.toFixed(3)} (expected ${want} ± ${tol})`);
};

const JET = { model: "jet" as const, skin: "factory" as const, level: 1 };
const GT = { model: "gt" as const, skin: "factory" as const, level: 1 };
const FLYING = { ...NO_INPUT, fly: true, throttle: true };

/** A one-car race on the green light. */
function solo(mode: ThemeId, player: PlayerCar = JET, seed = 1): { race: Race; car: Car } {
  const race = createRace(mode, player, seed);
  race.cars.splice(1);
  while (race.phase === "countdown") stepRace(race, NO_INPUT, DT);
  race.boost.enabled = false;
  return { race, car: race.cars[0] };
}
/** Teleports a car, keeping its centre-line index and lap progress in step (as a real move would). */
function tp(race: Race, car: Car, x: number, y: number, angle?: number, speed?: number) {
  const n = race.track.path.length;
  car.pos = { x, y };
  const idx = locate(race.track, car.pos).index;
  let delta = idx - car.lastIndex;
  if (delta > n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  car.progress += delta;
  car.lastIndex = idx;
  if (angle !== undefined) car.angle = angle;
  if (speed !== undefined) car.vel = { x: Math.cos(car.angle) * speed, y: Math.sin(car.angle) * speed };
}
/** Puts the Jet in the air at `alt`, wings open, `energy` in the tank. */
function lift(race: Race, car: Car, alt = FLY.MAX_ALT, energy = FLY.MAX_ENERGY) {
  const s = race.flight!.st(car);
  s.mode = "fly";
  s.alt = alt;
  s.wing = 1;
  s.energy = energy;
  s.cool = 0;
  car.alt = alt;
  car.flyMul = 1 + (FLY.SPEED_MULT - 1) * (alt / FLY.MAX_ALT);
}
const distFromRoad = (race: Race, car: Car) => locate(race.track, car.pos).dist;
/** A spot on the road far from the line, with the outward normal: where the scripted wall tests start. */
function roadSpot(race: Race, idx = Math.round(race.track.path.length * 0.3)) {
  const p = race.track.path[idx], t = race.track.tangents[idx];
  return { idx, p, t, nx: -t.y, ny: t.x };
}

console.log("Racerz Jet walls checks\n");

// ---------- (a) floor altitudes ----------
{
  const want: Record<string, number> = { desert: 60, volcano: 50, northpole: 40, countryside: 35 };
  check(wallHeightOf("something-else") === 35 && wallHeightOf("") === 35, "an unknown mode's walls are not 35 m");
  for (const mode of THEME_ORDER) {
    const { race, car } = solo(mode);
    const sp = roadSpot(race);
    const f = race.flight!;
    check(wallHeightOf(mode) === want[mode], `${mode}: wall height ${wallHeightOf(mode)} (expected ${want[mode]})`);
    check(f.floorAt(sp.p.x, sp.p.y) === 0, `${mode}: floor on the road`);
    const runoff = race.track.width / 2 + 25;
    check(f.floorAt(sp.p.x + sp.nx * runoff, sp.p.y + sp.ny * runoff) === 0, `${mode}: floor on the runoff inside the barriers`);
    const out = race.track.barrier + 40;
    const h = f.floorAt(sp.p.x + sp.nx * out, sp.p.y + sp.ny * out);
    check(h === want[mode], `${mode}: floor beyond the barriers ${h} (expected ${want[mode]})`);
    check(car.alt === 0, "setup");
  }
  const { race } = solo("volcano");
  const f = race.flight!;
  check(f.floorAt(1500, 1150) === WALLS.LAVA_FLOOR && WALLS.LAVA_FLOOR === 25, `crater lake floor ${f.floorAt(1500, 1150)}`);
  // A point on the cone's slope, away from the road (the volcano's flank beyond the barriers), is 50 m.
  let slope: number | null = null;
  for (let a = 0; a < 360 && slope === null; a += 10) {
    const x = 1500 + Math.cos((a * Math.PI) / 180) * 250, y = 1150 + Math.sin((a * Math.PI) / 180) * 250;
    if (locate(race.track, { x, y }).dist > race.track.barrier + 20) slope = f.floorAt(x, y);
  }
  check(slope === 50, `the cone's slope beyond the barriers is ${slope} m (expected 50)`);
  console.log("  floors: road 0 · beyond the barriers 60 desert / 50 volcano / 40 north pole / 35 other · crater lake 25");
}

// ---------- (b) crossing, and who is stopped ----------
{
  for (const mode of THEME_ORDER) {
    const H = wallHeightOf(mode);
    const run = (alt: number, who: "jet" | "gt" | "ground-jet") => {
      const { race, car } = solo(mode, who === "gt" ? GT : JET);
      const sp = roadSpot(race);
      tp(race, car, sp.p.x + sp.nx * (race.track.width / 2), sp.p.y + sp.ny * (race.track.width / 2), Math.atan2(sp.ny, sp.nx), 500);
      if (who === "jet") lift(race, car, alt);
      let beyond = false, minAlt = Infinity;
      const hits0 = car.hits;
      for (let i = 0; i < 0.9 / DT; i++) {
        stepRace(race, who === "jet" ? FLYING : { ...NO_INPUT, throttle: true }, DT);
        if (distFromRoad(race, car) > race.track.barrier + 5) beyond = true;
        if (who === "jet") minAlt = Math.min(minAlt, car.alt);
      }
      return { beyond, hits: car.hits - hits0, alt: minAlt, dist: distFromRoad(race, car), limit: race.track.barrier };
    };
    const at = run(H, "jet"), low = run(H - 1, "jet"), gt = run(0, "gt"), grounded = run(0, "ground-jet");
    check(at.beyond && at.hits === 0, `${mode}: a Jet at exactly ${H} m did not fly over the wall (beyond ${at.beyond}, hits ${at.hits})`);
    check(!low.beyond && low.hits >= 1 && low.dist <= low.limit + 1, `${mode}: a Jet ${H - 1} m high got over the ${H} m wall (beyond ${low.beyond}, hits ${low.hits})`);
    check(!gt.beyond && gt.hits >= 1, `${mode}: a Racerz GT was not stopped by the wall (beyond ${gt.beyond}, hits ${gt.hits})`);
    check(!grounded.beyond && grounded.hits >= 1, `${mode}: the Jet on the ground was not stopped by the wall`);
    console.log(`  ${mode}: ${H} m → over the wall, ${H - 1} m → a contact · GT and grounded Jet stopped`);
  }
  // A bot is stopped like before.
  {
    const race = createRace("desert", JET, 4);
    while (race.phase === "countdown") stepRace(race, NO_INPUT, DT);
    const bot = race.cars[1], sp = roadSpot(race);
    tp(race, bot, sp.p.x, sp.p.y, Math.atan2(sp.ny, sp.nx), 500);
    let beyond = false;
    for (let i = 0; i < 0.6 / DT; i++) {
      bot.vel = { x: Math.cos(bot.angle) * 500, y: Math.sin(bot.angle) * 500 };
      stepRace(race, NO_INPUT, DT);
      if (distFromRoad(race, bot) > race.track.barrier + 5) beyond = true;
    }
    check(!beyond, "a bot went through the wall");
  }
  // The world's outer limits are solid at any altitude.
  {
    const { race, car } = solo("desert");
    const b = race.track.bounds;
    let ix = 0;
    race.track.path.forEach((q, i) => {
      if (q.x > race.track.path[ix].x) ix = i;
    });
    const q = race.track.path[ix];
    tp(race, car, q.x, q.y, 0, 800);
    lift(race, car, FLY.MAX_ALT);
    let maxX = -Infinity, bounced = false;
    for (let i = 0; i < 3 / DT; i++) {
      race.flight!.st(car).energy = FLY.MAX_ENERGY; // a full tank: only the edge is being tested
      stepRace(race, FLYING, DT);
      maxX = Math.max(maxX, car.pos.x);
      if (car.vel.x < 0) bounced = true;
    }
    check(maxX <= b.maxX + 1e-6 && car.pos.x <= b.maxX, `a flying Jet left the world (x ${maxX.toFixed(0)} > ${b.maxX.toFixed(0)})`);
    check(bounced, "the world's edge did not stop the Jet");
    console.log("  the world's outer limits stop a Jet at 80 m too");
  }
}

// ---------- (c) energy, gliding, an empty tank ----------
{
  const rate = (over: boolean) => {
    const { race, car } = solo("desert");
    const sp = roadSpot(race);
    const d = over ? race.track.barrier + 150 : 0;
    tp(race, car, sp.p.x + sp.nx * d, sp.p.y + sp.ny * d, 0, 0);
    lift(race, car);
    const e0 = race.flight!.st(car).energy;
    for (let i = 0; i < 0.5 / DT; i++) {
      car.vel = { x: 0, y: 0 };
      stepRace(race, { ...NO_INPUT, fly: true }, DT);
    }
    return (e0 - race.flight!.st(car).energy) / 0.5;
  };
  near("energy per second over a wall", rate(true), WALLS.DRAIN_OVER_WALL, 0.05);
  near("energy per second over the road", rate(false), 1, 0.05);
  console.log(`  energy: ${rate(true).toFixed(2)} / s over a wall, ${rate(false).toFixed(2)} / s elsewhere`);
}
{
  // Release Shift over a wall: the Jet glides at the wall's height and does not land there; the tank keeps falling at 1.5 / s.
  const { race, car } = solo("desert");
  const sp = roadSpot(race), f = race.flight!, s = f.st(car);
  tp(race, car, sp.p.x + sp.nx * (race.track.barrier + 200), sp.p.y + sp.ny * (race.track.barrier + 200), 0, 0);
  lift(race, car);
  const e0 = s.energy;
  let minAlt = Infinity;
  for (let i = 0; i < 0.9 / DT; i++) {
    car.vel = { x: 0, y: 0 };
    stepRace(race, NO_INPUT, DT); // Shift let go
    minAlt = Math.min(minAlt, car.alt);
  }
  check(s.mode === "landing" && minAlt === 60 && car.alt === 60, `released over the wall: mode ${s.mode}, altitude ${car.alt} (min ${minAlt}) — it must hold the wall's 60 m`);
  near("energy lost gliding over the wall (1.5 / s)", e0 - s.energy, 1.5 * 0.9, 0.1);
  check(isAirborne(car), "the Jet landed on a wall");
  // Pressing again climbs back up.
  for (let i = 0; i < 0.5 / DT; i++) {
    car.vel = { x: 0, y: 0 };
    stepRace(race, { ...NO_INPUT, fly: true }, DT);
  }
  check(car.alt > 65, `pressed again over the wall: altitude ${car.alt}`);
}
{
  // An empty tank over a wall: there is no forced return — the Jet keeps its place (no jump, no penalty, no message), glides at the wall's height and
  // lands as soon as it is over the road again. It just cannot climb back up.
  for (const mode of ["desert", "volcano"] as ThemeId[]) {
    const { race, car } = solo(mode);
    const sp = roadSpot(race), s = race.flight!.st(car);
    const vz = mode === "volcano" ? (race.hazard as VolcanoHazard) : null;
    if (vz) vz.hazards.armed = false;
    const out = race.track.barrier + 90;
    tp(race, car, sp.p.x + sp.nx * out, sp.p.y + sp.ny * out, Math.atan2(-sp.ny, -sp.nx), 150); // heading back to the road, slowly
    lift(race, car, FLY.MAX_ALT, 0.2);
    const lapStart0 = car.lapStart, hits0 = car.hits, H = wallHeightOf(mode);
    let maxJump = 0, drained = -1, minAlt = Infinity, touchdown = -1;
    for (let i = 0; i < 6 / DT; i++) {
      const before = { ...car.pos };
      stepRace(race, { ...NO_INPUT, fly: true }, DT); // Shift held, no throttle
      maxJump = Math.max(maxJump, Math.hypot(car.pos.x - before.x, car.pos.y - before.y));
      if (drained < 0 && s.energy <= 0) drained = i * DT;
      if (drained >= 0 && distFromRoad(race, car) > race.track.barrier) minAlt = Math.min(minAlt, car.alt);
      if (s.mode === "ground" && touchdown < 0) touchdown = i * DT;
      if (touchdown >= 0) break;
    }
    check(drained >= 0 && drained < 0.4, `${mode}: the tank did not run dry over the wall (${drained})`);
    check(maxJump < 15, `${mode}: the Jet jumped ${maxJump.toFixed(0)} px in one step (a return to the road?)`);
    check(car.lapStart === lapStart0, `${mode}: the lap clock was moved`);
    check(car.hits === hits0, `${mode}: a contact was counted`);
    check(minAlt === H, `${mode}: with an empty tank over the wall the Jet was at ${minAlt} m instead of gliding at ${H} m`);
    check(touchdown >= 0 && car.alt === 0, `${mode}: the Jet never landed once back over the road (mode ${s.mode}, ${car.alt.toFixed(0)} m)`);
    if (vz) check(vz.hazards.st(car).hp === 100, "health changed");
    console.log(`  ${mode}: empty tank over a wall → glides at ${H} m, lands on the road after ${touchdown.toFixed(1)} s, no jump, no penalty`);
  }
}
{
  // A no-fly zone over a wall: the Jet cannot land there either (it glides on).
  const { race, car } = solo("desert");
  const sp = roadSpot(race), s = race.flight!.st(car);
  race.scene = { ...race.scene, noFly: () => true };
  tp(race, car, sp.p.x + sp.nx * (race.track.barrier + 200), sp.p.y + sp.ny * (race.track.barrier + 200), 0, 0);
  lift(race, car);
  for (let i = 0; i < 0.6 / DT; i++) {
    car.vel = { x: 0, y: 0 };
    stepRace(race, FLYING, DT);
  }
  check(s.mode === "landing" && car.alt === 60 && s.warn > 0, `no-fly zone over a wall: mode ${s.mode}, altitude ${car.alt}, warning ${s.warn}`);
}
{
  // In the air over a wall: no ground drag, no time off the road.
  const { race, car } = solo("desert");
  const sp = roadSpot(race);
  tp(race, car, sp.p.x + sp.nx * (race.track.barrier + 40), sp.p.y + sp.ny * (race.track.barrier + 40), Math.atan2(sp.t.y, sp.t.x), 400);
  lift(race, car);
  const off0 = car.offTime;
  for (let i = 0; i < 0.5 / DT; i++) stepRace(race, FLYING, DT);
  check(car.surface === "track" && car.offTime === off0, `flying over the cliffs counted as off the road (surface ${car.surface}, off ${car.offTime - off0})`);
  check(speedOf(car) > 400, `ground drag slowed a flying Jet (${speedOf(car).toFixed(0)} u/s)`);
}

// ---------- (d) a real shortcut in the desert ----------
{
  const { race, car } = solo("desert");
  const { track } = race, n = track.path.length;
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(track.path[i].x - track.path[i - 1].x, track.path[i].y - track.path[i - 1].y));
  const total = s[n - 1];
  // The pair of road points, across a bend, with the widest gap between the road's length and the straight line, that the Jet can reach in one climb.
  let best: { i: number; j: number; d: number; gain: number } | null = null;
  for (let i = 20; i < n - 20; i += 4)
    for (let j = i + 20; j < n - 20; j += 4) {
      const d = Math.hypot(track.path[i].x - track.path[j].x, track.path[i].y - track.path[j].y), arc = s[j] - s[i];
      if (d < 400 || d > 1200 || arc < 2 * d || arc > 0.45 * total) continue; // (past half a lap the index would read it as going backwards)
      let outside = 0;
      for (let k = 1; k < 20; k++) {
        const x = track.path[i].x + ((track.path[j].x - track.path[i].x) * k) / 20, y = track.path[i].y + ((track.path[j].y - track.path[i].y) * k) / 20;
        if (locate(track, { x, y }).dist > track.barrier) outside++;
      }
      if (outside >= 10 && (!best || arc - d > best.gain)) best = { i, j, d, gain: arc - d };
    }
  if (!best) fail("no corner to cut found in the desert (the check proves nothing)");
  else {
    const a = track.path[best.i], b = track.path[best.j], ang = Math.atan2(b.y - a.y, b.x - a.x), tj = track.tangents[best.j];
    const f = race.flight!, st = f.st(car);
    tp(race, car, a.x, a.y, ang, 450);
    lift(race, car);
    car.progress = best.i;
    let crossed = false, landed = false, maxProgress = best.i, hits = 0;
    const hits0 = car.hits;
    for (let i = 0; i < 8 / DT && !landed; i++) {
      // Shift is let go once the Jet is over the other road, a little before the point: it glides at 60 m, then comes down onto the road.
      const toB = Math.hypot(car.pos.x - b.x, car.pos.y - b.y);
      const shift = toB > 320 || !crossed;
      if (distFromRoad(race, car) > track.barrier + 20) crossed = true;
      // The pilot steers along the road once over it (a Jet landing across the road would meet the far wall).
      const diff = Math.atan2(Math.sin(Math.atan2(tj.y, tj.x) - car.angle), Math.cos(Math.atan2(tj.y, tj.x) - car.angle));
      stepRace(race, { ...NO_INPUT, fly: shift, throttle: toB > 150, brake: toB < 150 && speedOf(car) > 120, left: crossed && diff < -0.05, right: crossed && diff > 0.05 }, DT);
      maxProgress = Math.max(maxProgress, car.progress);
      hits = car.hits - hits0;
      if (crossed && st.mode === "ground") landed = true;
    }
    check(crossed, "the Jet never went over the wall of the bend");
    check(landed && car.alt === 0, `the Jet did not land on the other side (mode ${st.mode}, altitude ${car.alt.toFixed(0)}, idx ${car.lastIndex} / ${best.j})`);
    check(car.lapStart === 0, "a shortcut moved the lap clock");
    check(maxProgress - best.i > best.gain / 12, `the shortcut did not gain progress (${(maxProgress - best.i).toFixed(0)} samples)`);
    console.log(`  desert: over the wall from sample ${best.i} to ${best.j} (${best.d.toFixed(0)} px across a ${(best.d + best.gain).toFixed(0)} px bend), landed on the road, ${hits} contact(s)`);
  }
}

// ---------- (e) no checkpoints ----------
{
  // What used to send the Jet back: a lap that skipped everything. Now it counts like any other, and nothing moves the car but its own driving.
  for (const last of [false, true]) {
    const { race, car } = solo("desert", JET, 3);
    const n = race.track.path.length, idx = n - 60, p = race.track.path[idx], tg = race.track.tangents[idx], lap = last ? TOTAL_LAPS - 1 : 0;
    car.pos = { ...p };
    car.angle = Math.atan2(tg.y, tg.x);
    car.vel = { x: tg.x * 500, y: tg.y * 500 };
    car.lastIndex = idx;
    car.lap = lap;
    car.progress = lap * n + idx;
    let maxJump = 0;
    for (let i = 0; i < 6 / DT && car.lap === lap && car.finishTime === null; i++) {
      const before = { ...car.pos };
      stepRace(race, { ...aiInput(race, car, DT, false), throttle: true }, DT, false);
      maxJump = Math.max(maxJump, Math.hypot(car.pos.x - before.x, car.pos.y - before.y));
    }
    check(maxJump < 15, `${last ? "last lap" : "lap"}: the Jet jumped ${maxJump.toFixed(0)} px in one step (put back on the road?)`);
    if (last) {
      check(car.finishTime !== null && Math.abs(car.finishTime - race.time) < 0.05, `the last lap's finish time ${car.finishTime} is not the clock ${race.time} (a penalty?)`);
      check(race.phase === "finished", "the race did not end");
    } else {
      check(car.lap === 1 && Math.abs(car.lapStart - race.time) < 0.05, `a lap with no checkpoint crossed was not counted as it is (lap ${car.lap})`);
    }
  }
  console.log("  no checkpoints: a lap that skipped everything counts, no jump, no penalty, the finish time is the clock");
}
{
  // The line is never crossed in the air, even from over a wall next to it.
  const { race, car } = solo("desert", JET, 6);
  const n = race.track.path.length, idx = n - 8;
  const p = race.track.path[idx], t = race.track.tangents[idx], nx = -t.y, ny = t.x;
  race.scene = { ...race.scene, noFly: () => false };
  tp(race, car, p.x + nx * (race.track.barrier + 120), p.y + ny * (race.track.barrier + 120), Math.atan2(t.y, t.x), 700);
  car.progress = idx;
  car.lastIndex = idx;
  lift(race, car, FLY.MAX_ALT, FLY.MAX_ENERGY);
  const lap0 = car.lap;
  let airLapCounted = false, capped = true;
  for (let i = 0; i < 1.2 / DT; i++) {
    race.flight!.st(car).energy = FLY.MAX_ENERGY;
    car.vel = { x: Math.cos(car.angle) * 700, y: Math.sin(car.angle) * 700 };
    stepRace(race, { ...NO_INPUT, fly: true }, DT);
    if (isAirborne(car) && car.lap > lap0) airLapCounted = true;
    if (isAirborne(car) && car.progress > (car.lap + 1) * n - 1 + 1e-9) capped = false;
  }
  check(!airLapCounted && capped, `the line was crossed over the wall (lap ${car.lap}, progress ${car.progress.toFixed(0)} / ${n})`);
  console.log("  the line is not crossed in the air, even over the wall beside it");
}

// ---------- (f) takeoff dust ----------
{
  const { race, car } = solo("desert");
  const f = race.flight!;
  const sp = roadSpot(race);
  tp(race, car, sp.p.x, sp.p.y, Math.atan2(sp.t.y, sp.t.x), 0);
  for (let i = 0; i < 0.05 / DT; i++) {
    car.vel = { x: 0, y: 0 };
    stepRace(race, { ...NO_INPUT, fly: true }, DT);
  }
  const n1 = f.puffCount();
  check(n1 >= 8 && n1 <= 10, `${n1} dust puffs at takeoff (expected 8-10)`);
  let max = n1;
  for (let k = 0; k < 12; k++) {
    f.groundCar(car);
    for (let i = 0; i < 0.02 / DT; i++) {
      car.vel = { x: 0, y: 0 };
      stepRace(race, { ...NO_INPUT, fly: true }, DT);
    }
    f.groundCar(car);
    f.st(car).cool = 0;
    max = Math.max(max, f.puffCount());
    for (let i = 0; i < 0.01 / DT; i++) stepRace(race, NO_INPUT, DT);
  }
  check(max <= 40, `${max} dust puffs (cap 40)`);
  for (let i = 0; i < 3 / DT; i++) stepRace(race, NO_INPUT, DT);
  check(f.puffCount() === 0, "the dust never clears");
  console.log(`  takeoff dust: ${n1} puffs, capped at 40, gone after a few seconds`);
}

console.log(failed ? "\ncheck:walls FAILED" : "\ncheck:walls OK");
process.exit(failed ? 1 : 0);
