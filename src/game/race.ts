import { type Car, type Input, type Surface, NO_INPUT, CAR_RADIUS, PHYS, stepCar, slipOf, speedOf } from "./car";
import { type ModelId, type SkinId, MODELS, carStats, skinOf } from "./garage";
import type { Scene } from "./scenery";
import { type Theme, type ThemeId, THEMES, sceneFor } from "./themes";
import { type Track, buildTrack, locate } from "./track";
import { type Vec, vec, add, sub, scale, len, dot, angleDiff, clamp, fromAngle } from "./vec";

export const TOTAL_LAPS = 3;
const COUNTDOWN = 3;

export type Phase = "countdown" | "racing" | "finished";
export type Skid = { a: Vec; b: Vec; life: number };

export type Race = {
  track: Track;
  theme: Theme;
  scene: Scene;
  cars: Car[];
  phase: Phase;
  /** Seconds since the green light (negative during countdown). */
  time: number;
  skids: Skid[];
};

export type PlayerCar = { model: ModelId; skin: SkinId; level: number };

const ROSTER = [
  { name: "Toi", color: "#e63946", skill: 1 },
  { name: "Blaze", color: "#f4a261", skill: 0.93 },
  { name: "Volt", color: "#2a9d8f", skill: 0.9 },
  { name: "Nitro", color: "#457b9d", skill: 0.87 },
];

export function createRace(themeId: ThemeId, player: PlayerCar): Race {
  const track = buildTrack();
  const theme = THEMES[themeId];
  const n = track.path.length;
  const cars: Car[] = ROSTER.map((r, i) => {
    // 2-wide staggered grid behind the line; player starts at the back.
    const slot = ROSTER.length - 1 - i;
    const idx = (n - 8 - slot * 7) % n;
    const p = track.path[idx], t = track.tangents[idx];
    const side = slot % 2 === 0 ? -1 : 1;
    const pos = add(p, scale(vec(-t.y, t.x), side * track.width * 0.22));
    const isPlayer = i === 0;
    const stats = isPlayer ? carStats(player.model, player.level) : { speed: r.skill, accel: 1, grip: 1 };
    const skin = isPlayer ? skinOf(player.model, player.skin) : { name: r.name, body: r.color, accent: r.color };
    return {
      id: i, name: isPlayer ? `Toi (${MODELS[player.model].name})` : r.name, color: skin.body, isPlayer,
      model: isPlayer ? player.model : "gt", skin, skill: stats.speed, accelMul: stats.accel, gripMul: stats.grip,
      offTime: 0, hits: 0, hitCooldown: 0,
      pos, vel: vec(0, 0), angle: Math.atan2(t.y, t.x),
      progress: idx - n, lastIndex: idx, lap: 0, lapStart: 0, bestLap: null, finishTime: null, surface: "track",
    };
  });
  return { track, theme, scene: sceneFor(theme, track), cars, phase: "countdown", time: -COUNTDOWN, skids: [] };
}

function aiInput(race: Race, car: Car): Input {
  const { track } = race;
  const n = track.path.length;
  const grip = race.theme.phys.trackGrip;
  const speed = speedOf(car);
  // Low grip: look further ahead and slow down much more for bends.
  const look = Math.round((10 + Math.max(0, speed) / 40) * (1 + (1 - grip) * 0.8));
  const lane = ((car.id % 3) - 1) * track.width * 0.15 * grip;
  const i = (car.lastIndex + look) % n;
  const t = track.tangents[i];
  const target = add(track.path[i], scale(vec(-t.y, t.x), lane));
  const to = sub(target, car.pos);
  const bearing = Math.atan2(to.y, to.x);
  // On ice, steer the velocity rather than the nose so the slide is caught early.
  const velDir = len(car.vel) > 60 ? Math.atan2(car.vel.y, car.vel.x) : car.angle;
  const diff = angleDiff(car.angle, bearing) + angleDiff(velDir, bearing) * (1 - grip) * 0.8;
  const far = track.tangents[(car.lastIndex + look * 2) % n];
  const bend = Math.abs(angleDiff(Math.atan2(t.y, t.x), Math.atan2(far.y, far.x)));
  const cornerK = 0.45 + (1 - grip) * 0.55;
  const limit = PHYS.maxSpeed * car.skill * Math.max(0.3, 1 - clamp(bend, 0, 1.2) * cornerK) * (car.surface === "track" ? 1 : 0.6);
  const tooFast = speed > limit;
  return {
    throttle: !tooFast && Math.abs(diff) < 1.2,
    brake: tooFast && speed > limit + 40,
    left: diff < -0.04,
    right: diff > 0.04,
    handbrake: false,
  };
}

function collide(a: Car, b: Car) {
  const d = sub(b.pos, a.pos);
  const dist = len(d);
  const min = CAR_RADIUS * 2;
  if (dist === 0 || dist >= min) return;
  const nrm = scale(d, 1 / dist);
  const push = (min - dist) / 2;
  a.pos = sub(a.pos, scale(nrm, push));
  b.pos = add(b.pos, scale(nrm, push));
  const rel = dot(sub(a.vel, b.vel), nrm);
  if (rel > 0) {
    const imp = scale(nrm, rel * 0.85);
    a.vel = sub(a.vel, imp);
    b.vel = add(b.vel, imp);
  }
}

function surfaceAt(race: Race, p: Vec, dist: number): Surface {
  if (dist < race.track.width / 2) return "track";
  for (const l of race.scene.lava) if ((l.x - p.x) ** 2 + (l.y - p.y) ** 2 < (l.r * 0.9) ** 2) return "lava";
  return "offtrack";
}

/** Barriers run along both edges at track.barrier from the centerline: push back and bounce. */
function hitBarrier(race: Race, car: Car, index: number, dist: number) {
  const limit = race.track.barrier - CAR_RADIUS * 0.7;
  if (dist <= limit) return;
  const p = race.track.path[index];
  const n = scale(sub(car.pos, p), 1 / dist);
  car.pos = add(p, scale(n, limit));
  const vn = dot(car.vel, n);
  if (vn <= 0) return;
  car.vel = scale(sub(car.vel, scale(n, vn * 1.3)), 0.95);
  if (vn > 80 && car.hitCooldown <= 0) {
    car.hits++;
    car.hitCooldown = 0.5;
  }
}

function updateProgress(race: Race, car: Car, dt: number) {
  const n = race.track.path.length;
  const loc = locate(race.track, car.pos);
  hitBarrier(race, car, loc.index, loc.dist);
  car.surface = surfaceAt(race, car.pos, Math.min(loc.dist, race.track.barrier));
  if (race.phase === "racing" && car.finishTime === null && car.surface !== "track") car.offTime += dt;
  let delta = loc.index - car.lastIndex;
  if (delta > n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  car.progress += delta;
  car.lastIndex = loc.index;

  const completed = Math.floor(car.progress / n);
  if (completed > car.lap && car.finishTime === null) {
    const lapTime = race.time - car.lapStart;
    car.bestLap = car.bestLap === null ? lapTime : Math.min(car.bestLap, lapTime);
    car.lap = completed;
    car.lapStart = race.time;
    if (car.lap >= TOTAL_LAPS) car.finishTime = race.time;
  }
}

/** Keep cars inside the world with a soft wall. */
function containCar(race: Race, car: Car) {
  const b = race.track.bounds;
  if (car.pos.x < b.minX || car.pos.x > b.maxX) { car.pos.x = clamp(car.pos.x, b.minX, b.maxX); car.vel.x *= -0.4; }
  if (car.pos.y < b.minY || car.pos.y > b.maxY) { car.pos.y = clamp(car.pos.y, b.minY, b.maxY); car.vel.y *= -0.4; }
}

export function stepRace(race: Race, playerInput: Input, dt: number) {
  race.time += dt;
  if (race.phase === "countdown" && race.time >= 0) race.phase = "racing";

  const live = race.phase !== "countdown";
  for (const car of race.cars) {
    let input = NO_INPUT;
    if (live) {
      if (car.isPlayer) input = playerInput;
      else if (car.finishTime !== null) input = { ...NO_INPUT, brake: speedOf(car) > 0 };
      else input = aiInput(race, car);
    }
    const before = car.pos;
    stepCar(car, input, dt, race.theme.phys);
    car.hitCooldown -= dt;
    containCar(race, car);
    if (slipOf(car) > 140 || (input.brake && speedOf(car) > 300)) {
      const back = scale(fromAngle(car.angle), -14);
      race.skids.push({ a: add(before, back), b: add(car.pos, back), life: 1 });
    }
  }
  for (let i = 0; i < race.cars.length; i++)
    for (let j = i + 1; j < race.cars.length; j++) collide(race.cars[i], race.cars[j]);
  for (const car of race.cars) updateProgress(race, car, dt);

  for (const s of race.skids) s.life -= dt * 0.25;
  race.skids = race.skids.filter((s) => s.life > 0).slice(-600);

  if (race.phase === "racing" && race.cars[0].finishTime !== null) race.phase = "finished";
}

export function standings(race: Race): Car[] {
  return [...race.cars].sort((a, b) => {
    if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
    if (a.finishTime !== null) return -1;
    if (b.finishTime !== null) return 1;
    return b.progress - a.progress;
  });
}
