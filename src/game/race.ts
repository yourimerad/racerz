import { type Car, type Input, type Surface, NO_INPUT, CAR_RADIUS, PHYS, stepCar, slipOf, speedOf } from "./car";
import { type ModelId, type SkinId, MODELS, carStats, skinOf } from "./garage";
import { type Rng, type Scene, mulberry32 } from "./scenery";
import { type Theme, type ThemeId, THEMES, sceneFor } from "./themes";
import { isCovered, locate, trackFor, type Track } from "./track";
import { type Vec, vec, add, sub, scale, len, dot, angleDiff, clamp, fromAngle } from "./vec";

export const TOTAL_LAPS = 3;
const COUNTDOWN = 3;

export type Phase = "countdown" | "racing" | "finished";
export type Skid = { a: Vec; b: Vec; life: number };

/** Per-bot random-mistake state (see `aiInput`), indexed by `car.id`. */
export type MistakeKind = "lateBrake" | "liftOff" | "wideLine" | "twitch";
export type AiState = { mistake: MistakeKind | null; until: number; cooldown: number; sign: number; count: number };

export type Race = {
  track: Track;
  theme: Theme;
  scene: Scene;
  cars: Car[];
  phase: Phase;
  /** Seconds since the green light (negative during countdown). */
  time: number;
  skids: Skid[];
  /** Opacity of the covered-section overhead layer over the player (1 outside, ~0.3 inside). */
  overheadOpacity: number;
  /** Seeded PRNG for this race (bot mistakes); same seed + same inputs replay identically. */
  rng: Rng;
  /** Random-mistake bookkeeping per car, indexed by `car.id`. */
  ai: AiState[];
  /** Straw thrown up by bumper hits (hay bales), drawn by render.ts. */
  straw: Straw[];
};

export type Straw = { x: number; y: number; vx: number; vy: number; rot: number; life: number };

export type PlayerCar = { model: ModelId; skin: SkinId; level: number };

const ROSTER = [
  { name: "Toi", color: "#e63946" },
  { name: "Blaze", color: "#f4a261" },
  { name: "Volt", color: "#2a9d8f" },
  { name: "Nitro", color: "#457b9d" },
];

/**
 * Builds a race. `seed` drives the reproducible bot-mistake PRNG (see `aiInput`); omit it
 * for a random race (that's what Game.tsx does). The 3 bots' pace comes from
 * `theme.bots` (desert easiest … volcano hardest), spread symmetrically so they keep
 * distinct rhythms.
 */
export function createRace(themeId: ThemeId, player: PlayerCar, seed?: number): Race {
  const theme = THEMES[themeId];
  const track = trackFor(themeId, theme.layout);
  const n = track.path.length;
  const { pace, spread } = theme.bots;
  const cars: Car[] = ROSTER.map((r, i) => {
    // 2-wide staggered grid behind the line; player starts at the back.
    const slot = ROSTER.length - 1 - i;
    const idx = (n - 8 - slot * 7) % n;
    const p = track.path[idx], t = track.tangents[idx];
    const side = slot % 2 === 0 ? -1 : 1;
    const pos = add(p, scale(vec(-t.y, t.x), side * track.width * 0.22));
    const isPlayer = i === 0;
    // Bots: 3 distinct rhythms symmetric around the mode's pace (+1, 0, -1 * spread).
    const botSkill = pace + (2 - i) * spread;
    const stats = isPlayer ? carStats(player.model, player.level) : { speed: botSkill, accel: 1, grip: 1 };
    const skin = isPlayer ? skinOf(player.model, player.skin) : { name: r.name, body: r.color, accent: r.color };
    return {
      id: i, name: isPlayer ? `Toi (${MODELS[player.model].name})` : r.name, color: skin.body, isPlayer,
      model: isPlayer ? player.model : "gt", skin, skill: stats.speed, accelMul: stats.accel, gripMul: stats.grip,
      offTime: 0, hits: 0, hitCooldown: 0,
      pos, vel: vec(0, 0), angle: Math.atan2(t.y, t.x),
      progress: idx - n, lastIndex: idx, lap: 0, lapStart: 0, bestLap: null, finishTime: null, surface: "track",
    };
  });
  const rng = mulberry32(seed ?? ((Math.random() * 2 ** 32) >>> 0));
  const ai: AiState[] = cars.map(() => ({ mistake: null, until: 0, cooldown: 0, sign: 1, count: 0 }));
  return { track, theme, scene: sceneFor(theme, track), cars, phase: "countdown", time: -COUNTDOWN, skids: [], overheadOpacity: 1, rng, ai, straw: [] };
}

const MISTAKE_KINDS: MistakeKind[] = ["lateBrake", "liftOff", "wideLine", "twitch"];
/** [min, max] seconds a mistake lasts, once triggered. */
const MISTAKE_DURATION: Record<MistakeKind, [number, number]> = {
  lateBrake: [0.35, 0.7],
  liftOff: [0.4, 0.9],
  wideLine: [0.5, 1.0],
  twitch: [0.15, 0.3],
};

/** Roll a new mistake for `car` if its cooldown has elapsed and it's safe to do so. */
function rollMistake(race: Race, car: Car, state: AiState, dt: number) {
  if (race.time < state.cooldown) return;
  // Never pile a mistake on top of an off-track excursion or a fresh barrier bounce:
  // that's how a bot would get stuck or chain barrier hits.
  if (car.surface !== "track" || car.hitCooldown > 0) return;
  const rate = race.theme.bots.errors / 60; // nominal mistakes per second
  if (race.rng() >= rate * dt) return;
  const kind = MISTAKE_KINDS[Math.floor(race.rng() * MISTAKE_KINDS.length)];
  const [lo, hi] = MISTAKE_DURATION[kind];
  state.mistake = kind;
  state.until = race.time + lo + race.rng() * (hi - lo);
  state.sign = race.rng() < 0.5 ? -1 : 1;
  state.count++;
}

/**
 * Drives a car (bots; also car 0 in the track-check and bot-sim scripts): aim a lookahead point on the centerline, brake for corners
 * scaled by grip, and throttle/brake/steer toward it. Exported so `scripts/sim-bots.ts`
 * can also drive an error-free "proxy" car to benchmark each car model.
 *
 * `allowMistakes` (default true) gates the random-mistake system driven by
 * `race.theme.bots.errors` and `race.rng` (see `rollMistake`); pass false for a perfect
 * driver (the simulation proxy).
 */
export function aiInput(race: Race, car: Car, dt: number, allowMistakes = true): Input {
  const { track } = race;
  const n = track.path.length;
  const grip = race.theme.phys.trackGrip;
  const speed = speedOf(car);

  const state = race.ai[car.id];
  if (allowMistakes && state) {
    if (state.mistake && race.time > state.until) {
      state.mistake = null;
      state.cooldown = race.time + 1.5 + race.rng() * 1.5;
    }
    if (!state.mistake) rollMistake(race, car, state, dt);
  }
  const mistake = allowMistakes ? state?.mistake ?? null : null;

  // Low grip: look further ahead and slow down much more for bends.
  const look = Math.round((10 + Math.max(0, speed) / 40) * (1 + (1 - grip) * 0.8));
  const baseLane = ((car.id % 3) - 1) * track.width * 0.15 * grip;
  // "wideLine": briefly aim further out, as if missing the apex.
  const lane = mistake === "wideLine" ? baseLane + state!.sign * track.width * 0.22 : baseLane;
  const i = (car.lastIndex + look) % n;
  const t = track.tangents[i];
  const target = add(track.path[i], scale(vec(-t.y, t.x), lane));
  const to = sub(target, car.pos);
  const bearing = Math.atan2(to.y, to.x);
  // On ice, steer the velocity rather than the nose so the slide is caught early.
  const velDir = len(car.vel) > 60 ? Math.atan2(car.vel.y, car.vel.x) : car.angle;
  let diff = angleDiff(car.angle, bearing) + angleDiff(velDir, bearing) * (1 - grip) * 0.8;
  // "twitch": a brief, self-correcting flinch on the wheel.
  if (mistake === "twitch") diff += state!.sign * 0.9;
  const far = track.tangents[(car.lastIndex + look * 2) % n];
  const bend = Math.abs(angleDiff(Math.atan2(t.y, t.x), Math.atan2(far.y, far.x)));
  const cornerK = 0.45 + (1 - grip) * 0.55;
  const limit = PHYS.maxSpeed * car.skill * Math.max(0.3, 1 - clamp(bend, 0, 1.2) * cornerK) * (car.surface === "track" ? 1 : 0.6);
  const tooFast = speed > limit;
  return {
    // "liftOff": brief lift, no risk. "lateBrake": brake late and run wide instead.
    throttle: !tooFast && Math.abs(diff) < 1.2 && mistake !== "liftOff",
    brake: tooFast && speed > limit + 40 && mistake !== "lateBrake",
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

/** Normal speed a bumper sends a car back with: springy (more than it came in), never less than a kick. */
const BUMPER_BOUNCE = 1.45;
const BUMPER_KICK = 300;

/** Hay bales and other round bumpers: push out, bounce back hard, spin a little, throw straw. */
function hitBumpers(race: Race, car: Car) {
  for (const b of race.scene.bumpers ?? []) {
    const d = sub(car.pos, b);
    const dist = len(d);
    const min = b.r + CAR_RADIUS * 0.8;
    if (dist === 0 || dist >= min) continue;
    const nrm = scale(d, 1 / dist);
    car.pos = add(b, scale(nrm, min));
    const vn = dot(car.vel, nrm);
    if (vn >= 0) continue;
    car.vel = add(car.vel, scale(nrm, -vn + Math.max(-vn * BUMPER_BOUNCE, BUMPER_KICK)));
    const fwd = fromAngle(car.angle);
    car.angle += 0.3 * Math.sign(fwd.x * nrm.y - fwd.y * nrm.x);
    if (-vn > 80 && car.hitCooldown <= 0) {
      car.hits++;
      car.hitCooldown = 0.5;
      for (let k = 0; k < 14; k++) {
        const a = Math.atan2(nrm.y, nrm.x) + (race.rng() - 0.5) * 2.4, v = 60 + race.rng() * 160;
        race.straw.push({ x: b.x + nrm.x * b.r, y: b.y + nrm.y * b.r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: race.rng() * Math.PI, life: 1 });
      }
    }
  }
}

function updateProgress(race: Race, car: Car, dt: number) {
  const n = race.track.path.length;
  const loc = locate(race.track, car.pos);
  hitBarrier(race, car, loc.index, loc.dist);
  hitBumpers(race, car);
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

/**
 * `playerIsAi` lets `scripts/sim-bots.ts` drive the player slot with the mistake-free
 * AI (a "proxy" of a given car model) instead of `playerInput`; Game.tsx never sets it.
 */
export function stepRace(race: Race, playerInput: Input, dt: number, playerIsAi = false) {
  race.time += dt;
  if (race.phase === "countdown" && race.time >= 0) race.phase = "racing";

  const live = race.phase !== "countdown";
  for (const car of race.cars) {
    let input = NO_INPUT;
    if (live) {
      if (car.isPlayer) input = playerIsAi ? aiInput(race, car, dt, false) : playerInput;
      else if (car.finishTime !== null) input = { ...NO_INPUT, brake: speedOf(car) > 0 };
      else input = aiInput(race, car, dt);
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
  for (const p of race.straw) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 3 * dt;
    p.vy *= 1 - 3 * dt;
    p.life -= dt * 0.8;
  }
  race.straw = race.straw.filter((p) => p.life > 0).slice(-300);

  // Fade the overhead layer when the player is under a covered section (~0.25s either way).
  const target = isCovered(race.track, race.cars[0].lastIndex) ? 0.3 : 1;
  race.overheadOpacity += (target - race.overheadOpacity) * Math.min(1, dt / 0.25);

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
