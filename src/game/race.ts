import { type BoostSystem, createBoost } from "./boost";
import { type Car, type Input, type Surface, NO_INPUT, CAR_RADIUS, PHYS, isAirborne, stepCar, slipOf, speedOf } from "./car";
import { FlightController, distToLine, dustOf, wallHeightOf } from "./flight";
import { type ModelId, type SkinId, MODELS, carStats, skinOf } from "./garage";
import { type Circle, type Cue, type Hazard, type HazardBody, type Rng, type Scene, mulberry32 } from "./scenery";
import { type Theme, type ThemeId, THEMES, sceneFor } from "./themes";
import { isCovered, locate, trackFor, type Track } from "./track";
import { type Vec, vec, add, sub, scale, len, dot, angleDiff, clamp, fromAngle } from "./vec";

export const TOTAL_LAPS = 3;
const COUNTDOWN = 3;
/** The starting grid: the first row is GRID_FIRST samples behind the line, each further row GRID_ROW more. */
const GRID_FIRST = 8;
const GRID_ROW = 7;

export type Phase = "countdown" | "racing" | "finished";
export type Skid = { a: Vec; b: Vec; life: number };

/** Per-bot random-mistake state (see `aiInput`), indexed by `car.id`. */
export type MistakeKind = "lateBrake" | "liftOff" | "wideLine" | "twitch";
export type AiState = {
  mistake: MistakeKind | null; until: number; cooldown: number; sign: number; count: number;
  /** The hazard body this bot is steering round, and which way it chose to pass it (-1 left / +1 right, 0 = none yet). */
  hazardId: number; hazardPass: -1 | 0 | 1;
};

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
  /** Impacts the player's car took since Game.tsx last emptied this list (drives the crash sound). */
  crashes: number[];
  /** The mode's moving obstacle for this race (null in modes without one). */
  hazard: Hazard | null;
  /** Sound requests raised by the hazard and the boost pads, emptied by Game.tsx. */
  cues: Cue[];
  /** The mode's boost pads and every car's turbo (see boost.ts). */
  boost: BoostSystem;
  /** The human's flight (Shift) when they drive the Racerz Jet, else null (see flight.ts). */
  flight: FlightController | null;
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
    const idx = (n - GRID_FIRST - slot * GRID_ROW) % n;
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
      model: isPlayer ? player.model : "gt", skin, skill: stats.speed, accelMul: stats.accel, gripMul: stats.grip, speedMul: 1, boostMul: 1, flyMul: 1, alt: 0,
      offTime: 0, hits: 0, hitCooldown: 0, stun: 0,
      pos, vel: vec(0, 0), angle: Math.atan2(t.y, t.x),
      progress: idx - n, lastIndex: idx, lap: 0, lapStart: 0, bestLap: null, finishTime: null, surface: "track",
    };
  });
  const rng = mulberry32(seed ?? ((Math.random() * 2 ** 32) >>> 0));
  const ai: AiState[] = cars.map(() => ({ mistake: null, until: 0, cooldown: 0, sign: 1, count: 0, hazardId: 0, hazardPass: 0 }));
  const scene = sceneFor(theme, track);
  // Built before the hazard: the volcano's bombs keep clear of the pads (see boost.ts `nearPad`).
  const boost = createBoost(theme.id, track, { bumpers: scene.bumpers, lava: scene.lava }, GRID_FIRST + (ROSTER.length - 1) * GRID_ROW);
  // Only modes with a moving obstacle consume the PRNG here, so the other modes replay as before.
  const hazard = scene.hazard ? scene.hazard(track, mulberry32((rng() * 2 ** 32) >>> 0)) : null;
  const race: Race = { track, theme, scene, cars, phase: "countdown", time: -COUNTDOWN, skids: [], overheadOpacity: 1, rng, ai, straw: [], crashes: [], hazard, cues: [], boost, flight: null };
  if (MODELS[player.model].flying) {
    const cue = (kind: "takeoff" | "land") => {
      if (race.cues.length < 16) race.cues.push({ kind, power: 1 });
    };
    const b = track.bounds;
    race.flight = new FlightController(
      {
        speed: (car) => Math.hypot(car.vel.x, car.vel.y),
        setSpeedMultiplier: (car, f) => {
          car.flyMul = f;
        },
        // The start line is the finish line (sample 0); a car is on the same side of it for both.
        distToFinish: (car) => distToLine(track, car),
        distToStart: (car) => distToLine(track, car),
        noFlyAt: (x, y) => race.phase === "countdown" || (race.scene.noFly?.(x, y) ?? false),
        floorAlt: (x, y) => floorAltAt(race, x, y),
        inWorld: (x, y) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY,
        onTakeoff: () => cue("takeoff"),
        onLand: () => cue("land"),
      },
      dustOf(theme.id),
    );
  }
  return race;
}

/**
 * Minimum altitude (m) at a point: 0 inside the barriers (the road and its runoff are ground), the mode's wall height beyond them — a car whose
 * centre is past `limit` is touching the wall — and whatever the mode says for itself (the volcano's crater lake).
 */
function floorAltAt(race: Race, x: number, y: number): number {
  const own = race.scene.floorAlt?.(x, y);
  if (own !== undefined) return own;
  // `hitBarrier` clamps a car to exactly `limit` from the centre line: that spot is still ground.
  return locate(race.track, vec(x, y)).dist <= race.track.barrier - CAR_RADIUS * 0.7 + 1e-3 ? 0 : wallHeightOf(race.theme.id);
}

/** Bots under a turbo: how far ahead (× their usual look-ahead) they check bends, and the deceleration they plan their braking with (u/s², under the real 950). */
const TURBO_REACH = [1.5, 2, 3];
const TURBO_BRAKE = 650;

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
 * What a bot does about the hazard bodies ahead of it: a slowdown factor, and (when a body will be
 * in its way) the road offset to steer for. The body keeps walking, so the way round is judged where
 * it will be when the bot gets there, and once chosen (left or right of it) it is kept.
 */
function hazardAvoidance(race: Race, car: Car): { slow: number; offset: number | null } {
  const hz = race.hazard;
  if (!hz?.avoid || (!hz.bodies && !hz.dangers)) return { slow: 1, offset: null };
  const avoid = hz.avoid;
  const { track } = race;
  const state = race.ai[car.id];
  const fwd = fromAngle(car.angle);
  const speed = Math.max(0, speedOf(car));
  // Faster cars look further ahead: 120 px is under a quarter of a second at full speed.
  const range = avoid.range + speed * avoid.lookahead;
  const t = track.tangents[car.lastIndex];
  const here = dot(sub(car.pos, track.path[car.lastIndex]), vec(-t.y, t.x)); // the car's current road offset
  const room = track.width / 2 - 28;
  let slow = 1, offset: number | null = null, seen = false;

  /** One thing to get round: a solid body, or a ground zone (`brake` false = steer round it without slowing). */
  const consider = (b: HazardBody, brake: boolean) => {
    const dx = b.x - car.pos.x, dy = b.y - car.pos.y;
    const ahead = dx * fwd.x + dy * fwd.y;
    const side = -dx * fwd.y + dy * fwd.x; // + = body on the car's right
    const reach = Math.max(b.rx, b.ry);
    if (ahead < -reach * 0.5 || ahead > range + reach) return;
    // Half-extent of the body across the car's path (its ellipse projected on the lateral axis).
    const hc = Math.cos(b.angle) * -fwd.y + Math.sin(b.angle) * fwd.x;
    const half = Math.hypot(b.rx * hc, b.ry * Math.sqrt(Math.max(0, 1 - hc * hc)));
    const clearance = half + CAR_RADIUS + avoid.margin;
    // Where the body will be (across the car's path) when the car, slowed, reaches it.
    const eta = clamp(ahead / Math.max(speed * avoid.slow, 100), 0, 3);
    const bodySide = side + (-b.vx * fwd.y + b.vy * fwd.x) * eta;
    if (Math.abs(side) > clearance && Math.abs(bodySide) > clearance) return;
    seen = true;
    if (brake) slow = Math.min(slow, avoid.slow);
    // Passing on its left needs the car at most `bodySide - clearance` sideways; on its right, at least `bodySide + clearance`.
    const left = Math.min(0, bodySide - clearance), right = Math.max(0, bodySide + clearance);
    const fits = (shift: number) => Math.abs(here + shift) <= room;
    let pass: -1 | 1;
    if (state.hazardId === b.id && state.hazardPass !== 0 && fits(state.hazardPass < 0 ? left : right)) pass = state.hazardPass;
    else if (fits(left) && fits(right)) pass = -left < right ? -1 : 1;
    else pass = fits(left) ? -1 : fits(right) ? 1 : bodySide >= 0 ? -1 : 1;
    state.hazardId = b.id;
    state.hazardPass = pass;
    const shift = pass < 0 ? left : right;
    // No room to get round it in time: take the speed off further and let it walk on.
    if (brake && !fits(shift)) slow = Math.min(slow, avoid.slow * 0.6);
    offset = clamp(here + shift, -room, room);
  };
  for (const b of hz.bodies?.() ?? []) consider(b, true);
  for (const d of hz.dangers?.() ?? []) consider({ id: d.id, x: d.x, y: d.y, vx: 0, vy: 0, angle: 0, rx: d.r, ry: d.r }, d.brake);
  if (!seen && state.hazardPass !== 0) state.hazardPass = 0;
  return { slow, offset };
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
  let lane = mistake === "wideLine" ? baseLane + state!.sign * track.width * 0.22 : baseLane;
  const i = (car.lastIndex + look) % n;
  const t = track.tangents[i];
  // A moving obstacle just ahead: slow down and swerve away from it (never stop).
  const { slow: hazardSlow, offset: hazardLane } = hazardAvoidance(race, car);
  if (hazardLane !== null) lane = hazardLane;
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
  const turbo = race.boost.factor(car);
  const cornerK = 0.45 + (1 - grip) * 0.55;
  const corner = Math.max(0.3, 1 - clamp(bend, 0, 1.2) * cornerK);
  // The turbo raises the straight-line limit only: into a bend (or off the road) the bot brakes to its usual speed.
  const turboBonus = car.surface === "track" ? 1 + (turbo - 1) * clamp((corner - 0.5) / 0.5, 0, 1) : 1;
  let limit = PHYS.maxSpeed * car.skill * corner * (car.surface === "track" ? 1 : 0.6) * hazardSlow * turboBonus;
  if (turbo > 1 || speed > PHYS.maxSpeed * car.skill * 1.05) {
    // Boosting (see boost.ts), or still carrying the turbo's speed: that needs a longer braking distance than the bend window above
    // covers. Judge the bends further ahead too, each allowing the speed from which a firm brake (TURBO_BRAKE) still gets down to its
    // corner speed. At its usual speeds a bot never gets here.
    const spacing = Math.hypot(track.path[(car.lastIndex + look) % n].x - track.path[car.lastIndex].x, track.path[(car.lastIndex + look) % n].y - track.path[car.lastIndex].y) / look;
    for (const reach of TURBO_REACH) {
      const m = Math.round(look * reach);
      const a = track.tangents[(car.lastIndex + m) % n], b = track.tangents[(car.lastIndex + m * 2) % n];
      const bendAhead = Math.abs(angleDiff(Math.atan2(a.y, a.x), Math.atan2(b.y, b.x)));
      const cornerSpeed = PHYS.maxSpeed * car.skill * Math.max(0.3, 1 - clamp(bendAhead, 0, 1.2) * cornerK);
      limit = Math.min(limit, Math.sqrt(cornerSpeed * cornerSpeed + 2 * TURBO_BRAKE * m * spacing));
    }
  }
  const tooFast = speed > limit;
  return {
    // "liftOff": brief lift, no risk. "lateBrake": brake late and run wide instead.
    throttle: !tooFast && Math.abs(diff) < 1.2 && mistake !== "liftOff",
    brake: tooFast && speed > limit + 40 && mistake !== "lateBrake",
    left: diff < -0.04,
    right: diff > 0.04,
    handbrake: false,
    fly: false, // bots never fly
  };
}

/** Records an impact on the player's car, as a 0..1 strength (speed against 500 u/s). */
function noteCrash(race: Race, car: Car, speed: number) {
  if (car.isPlayer && race.crashes.length < 16) race.crashes.push(clamp(speed / 500, 0, 1));
}

/** A real impact (any car, wall, bale or hazard): the car's turbo stops almost at once, and the player's crash is heard. */
function noteImpact(race: Race, car: Car, speed: number) {
  race.boost.cut(car);
  noteCrash(race, car, speed);
}

function collide(race: Race, a: Car, b: Car) {
  if (isAirborne(a) || isAirborne(b)) return; // a flying car passes over the others
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
    if (rel > 80) {
      noteImpact(race, a, rel);
      noteImpact(race, b, rel);
    }
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
  // A Jet high enough for the wall under it flies over it (the world's outer limits stay solid: containCar).
  if (car.isPlayer && race.flight?.canCross(car, car.pos.x, car.pos.y)) return;
  const p = race.track.path[index];
  const n = scale(sub(car.pos, p), 1 / dist);
  car.pos = add(p, scale(n, limit));
  const vn = dot(car.vel, n);
  if (vn <= 0) return;
  car.vel = scale(sub(car.vel, scale(n, vn * 1.3)), 0.95);
  if (vn > 80) {
    race.boost.cut(car);
    if (car.hitCooldown <= 0) {
      car.hits++; // also for a Jet that was too low for the wall: that is a normal collision
      car.hitCooldown = 0.5;
      noteCrash(race, car, vn);
    }
  }
}

/** Normal speed a bumper sends a car back with: springy (more than it came in), never less than a kick. */
const BUMPER_BOUNCE = 1.45;
const BUMPER_KICK = 300;
/**
 * Ceiling on that rebound, as a share of the car's top speed. The bounce is springy (> 1), so without a ceiling a car
 * crossing the road between the two rows of bales gains speed on every hit (380 → 551 → 799 → … → 3 000+ u/s) and ends up
 * skipping over the bales: the "teleporting" glitch.
 */
const BUMPER_MAX_REBOUND = 0.85;
/** Engine cut after a bumper hit (seconds): throttle ignored so the bounce isn't driven straight back in. */
const BUMPER_STUN = 0.6;

/**
 * Hay bales and other round bumpers: push out, bounce back hard, spin a little, throw straw. The bales of a row overlap,
 * so the car is pushed out of all of them (a few passes: leaving one can mean entering the next), and the whole contact
 * gets a single bounce along the combined normal, not one per bale.
 */
function hitBumpers(race: Race, car: Car) {
  const bumpers = race.scene.bumpers;
  if (!bumpers?.length || isAirborne(car)) return; // a flying car passes over the bales
  let nx = 0, ny = 0, deepest = 0, hit: Circle | null = null;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const b of bumpers) {
      const d = sub(car.pos, b);
      const dist = len(d);
      const min = b.r + CAR_RADIUS * 0.8;
      if (dist >= min) continue;
      const nrm = dist === 0 ? vec(1, 0) : scale(d, 1 / dist);
      car.pos = add(b, scale(nrm, min));
      moved = true;
      if (pass === 0) {
        const pen = min - dist;
        nx += nrm.x * pen;
        ny += nrm.y * pen;
        if (pen > deepest) {
          deepest = pen;
          hit = b;
        }
      }
    }
    if (!moved) break;
  }
  if (!hit) return;
  const nl = Math.hypot(nx, ny);
  const away = sub(car.pos, hit);
  const nrm = nl > 1e-6 ? vec(nx / nl, ny / nl) : len(away) > 0 ? scale(away, 1 / len(away)) : vec(1, 0);
  const vn = dot(car.vel, nrm);
  if (vn >= 0) return;
  const rebound = Math.min(Math.max(-vn * BUMPER_BOUNCE, BUMPER_KICK), Math.max(BUMPER_KICK, BUMPER_MAX_REBOUND * PHYS.maxSpeed * car.skill));
  car.vel = add(car.vel, scale(nrm, -vn + rebound));
  const fwd = fromAngle(car.angle);
  car.angle += 0.3 * Math.sign(fwd.x * nrm.y - fwd.y * nrm.x);
  car.stun = BUMPER_STUN;
  if (-vn > 80) race.boost.cut(car);
  if (-vn > 80 && car.hitCooldown <= 0) {
    car.hits++;
    car.hitCooldown = 0.5;
    noteCrash(race, car, -vn);
    for (let k = 0; k < 14; k++) {
      const a = Math.atan2(nrm.y, nrm.x) + (race.rng() - 0.5) * 2.4, v = 60 + race.rng() * 160;
      race.straw.push({ x: hit.x + nrm.x * hit.r, y: hit.y + nrm.y * hit.r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: race.rng() * Math.PI, life: 1 });
    }
  }
}

/**
 * A mode's moving obstacle (polar bear…): solid, never stops. Cars are pushed out of its
 * elliptical hitbox every step (so none can sit inside it or cross it); a real impact bounces
 * the car back, takes most of its speed and may count as a contact for the clean-race rule.
 */
function hitHazard(race: Race, car: Car) {
  const hz = race.hazard;
  if (!hz?.bodies || !hz.impact || isAirborne(car)) return; // a flying car passes over the bear
  const { speedKeep, restitution, minImpact } = hz.impact;
  for (const b of hz.bodies()) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const dx = car.pos.x - b.x, dy = car.pos.y - b.y;
    // Car centre in the body's frame; the ellipse is grown by the car's own radius.
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const A = b.rx + CAR_RADIUS * 0.8, B = b.ry + CAR_RADIUS * 0.8;
    const q = Math.sqrt((lx / A) ** 2 + (ly / B) ** 2);
    if (q >= 1) continue;
    // Outward normal on the grown ellipse, and the point on its boundary to push the car to.
    let nx = lx / (A * A), ny = ly / (B * B), bx: number, by: number;
    if (q < 1e-6) {
      nx = 0;
      ny = ly >= 0 ? 1 : -1;
      bx = 0;
      by = ny * B;
    } else {
      bx = lx / q;
      by = ly / q;
    }
    const nl = Math.hypot(nx, ny) || 1;
    const n = vec((nx / nl) * c - (ny / nl) * s, (nx / nl) * s + (ny / nl) * c);
    car.pos = vec(b.x + (bx * 1.002) * c - (by * 1.002) * s, b.y + (bx * 1.002) * s + (by * 1.002) * c);
    // Velocity relative to the (moving) body.
    const rv = vec(car.vel.x - b.vx, car.vel.y - b.vy);
    const vn = dot(rv, n);
    if (vn >= 0) continue;
    if (vn > -minImpact) {
      car.vel = vec(b.vx + rv.x - n.x * vn, b.vy + rv.y - n.y * vn); // just stop closing in
      continue;
    }
    race.boost.cut(car); // a real hit, not a slide-off
    const k = -(1 + restitution) * vn;
    car.vel = vec(b.vx + (rv.x + n.x * k) * speedKeep, b.vy + (rv.y + n.y * k) * speedKeep);
    const power = clamp(-vn / 500, 0, 1);
    if (hz.touch?.(b, car.id, car.pos, power)) car.hits++;
    if (car.isPlayer && race.cues.length < 16) race.cues.push({ kind: "thud", power });
  }
}

function updateProgress(race: Race, car: Car, dt: number) {
  const n = race.track.path.length;
  const loc = locate(race.track, car.pos);
  hitBarrier(race, car, loc.index, loc.dist);
  hitBumpers(race, car);
  hitHazard(race, car);
  // In the air the ground's drag and lava mean nothing (and it is not time spent off the road).
  car.surface = isAirborne(car) ? "track" : surfaceAt(race, car.pos, Math.min(loc.dist, race.track.barrier));
  if (race.phase === "racing" && car.finishTime === null && car.surface !== "track") car.offTime += dt;
  let delta = loc.index - car.lastIndex;
  if (delta > n / 2) delta -= n;
  if (delta < -n / 2) delta += n;
  car.progress += delta;
  car.lastIndex = loc.index;
  // The line is never crossed in the air (a Jet cutting a corner over a wall could pass it): the lap waits for the ground.
  if (car.isPlayer && race.flight && isAirborne(car)) car.progress = Math.min(car.progress, (car.lap + 1) * n - 1);

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

/** Sound hook for a car taking a pad: the player's whoosh, a quieter one for a bot close to the player. */
function takePad(race: Race) {
  return (car: Car) => {
    if (race.cues.length >= 16) return;
    if (car.isPlayer) race.cues.push({ kind: "boost", power: 1 });
    else {
      const d = len(sub(car.pos, race.cars[0].pos));
      if (d < 600) race.cues.push({ kind: "boost", power: 0.4 * (1 - d / 600) + 0.1 });
    }
  };
}

/**
 * `playerIsAi` lets `scripts/sim-bots.ts` drive the player slot with the mistake-free
 * AI (a "proxy" of a given car model) instead of `playerInput`; Game.tsx never sets it.
 */
export function stepRace(race: Race, playerInput: Input, dt: number, playerIsAi = false) {
  race.time += dt;
  if (race.phase === "countdown" && race.time >= 0) race.phase = "racing";
  race.hazard?.step(race, dt);
  // The pads wait for the green light: cars standing on the grid never take one.
  if (race.phase !== "countdown") race.boost.update(dt, race.cars, takePad(race));

  const live = race.phase !== "countdown";
  for (const car of race.cars) {
    let input = NO_INPUT;
    if (live) {
      if (car.isPlayer) input = playerIsAi ? aiInput(race, car, dt, false) : playerInput;
      else if (car.finishTime !== null) input = { ...NO_INPUT, brake: speedOf(car) > 0 };
      else input = aiInput(race, car, dt);
    }
    if (car.stun > 0) input = { ...input, throttle: false };
    if (car.isPlayer && race.flight) race.flight.update(dt, car, live && input.fly);
    const before = car.pos;
    stepCar(car, input, dt, race.theme.phys);
    car.hitCooldown -= dt;
    car.stun = Math.max(0, car.stun - dt);
    containCar(race, car);
    if (slipOf(car) > 140 || (input.brake && speedOf(car) > 300)) {
      const back = scale(fromAngle(car.angle), -14);
      race.skids.push({ a: add(before, back), b: add(car.pos, back), life: 1 });
    }
  }
  for (let i = 0; i < race.cars.length; i++)
    for (let j = i + 1; j < race.cars.length; j++) collide(race, race.cars[i], race.cars[j]);
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
  const target = isCovered(race.track, race.cars[0].lastIndex) && !isAirborne(race.cars[0]) ? 0.3 : 1; // a Jet overhead sees the whole ceiling
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
