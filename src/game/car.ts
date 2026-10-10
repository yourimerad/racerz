import type { ModelId, Skin } from "./garage";
import { type Vec, vec, add, scale, dot, fromAngle, clamp } from "./vec";

/** `fly` = Shift held (only the Racerz Jet's pilot uses it; see flight.ts). */
export type Input = { throttle: boolean; brake: boolean; left: boolean; right: boolean; handbrake: boolean; fly: boolean };
export const NO_INPUT: Input = { throttle: false, brake: false, left: false, right: false, handbrake: false, fly: false };

export type Car = {
  id: number;
  name: string;
  color: string;
  isPlayer: boolean;
  pos: Vec;
  vel: Vec;
  angle: number;
  model: ModelId;
  skin: Skin;
  /** Top-speed multiplier (AI difficulty, or the player's car and level). */
  skill: number;
  accelMul: number;
  gripMul: number;
  /** Extra multiplier on top speed AND acceleration (1 normally; a mode's hazard lowers it for a damaged car). */
  speedMul: number;
  /** The turbo's multiplier (boost.ts: 1 normally, ×1.5 on a pad). Combines with `speedMul` and the surface limits. */
  boostMul: number;
  /** The Racerz Jet's flight multiplier (flight.ts: ×1 on the ground, up to ×1.10 at full altitude). Combines with the others. */
  flyMul: number;
  /** Altitude in metres (0 on the ground; only the Racerz Jet's pilot ever leaves it). */
  alt: number;
  // Race bookkeeping (see race.ts).
  progress: number;
  lastIndex: number;
  lap: number;
  lapStart: number;
  bestLap: number | null;
  finishTime: number | null;
  surface: Surface;
  /** Seconds spent off the asphalt, and barrier impacts (clean-race check). */
  offTime: number;
  hits: number;
  hitCooldown: number;
  /** Seconds left with the engine cut after a bumper hit, so the bounce plays out. */
  stun: number;
};

/** From this altitude (m) a car is "in the air": it passes over low obstacles and no longer counts contacts. */
export const AIRBORNE_ALT = 20;
export const isAirborne = (car: { alt: number }) => car.alt >= AIRBORNE_ALT;

export const CAR_LENGTH = 40;
export const CAR_WIDTH = 22;
export const CAR_RADIUS = 17;

/** Base physics. Environment modes scale these through PhysMods, never by mutating them. */
export const PHYS = {
  accel: 520,
  brake: 950,
  reverseAccel: 300,
  maxSpeed: 560,
  maxReverse: 160,
  turnRate: 2.9,
  drag: 0.35,
  grassDrag: 2.2,
  grassMax: 0.45,
  grip: 9,
  driftGrip: 1.6,
};
export const PHYS_DEFAULTS = { ...PHYS };

export type Surface = "track" | "offtrack" | "lava";

/** Per-mode multipliers applied on top of PHYS. */
export type PhysMods = {
  trackGrip: number;
  offGrip: number;
  offDrag: number;
  offMax: number;
  lavaDrag: number;
  lavaMax: number;
};

export function speedOf(car: Car): number {
  return dot(car.vel, fromAngle(car.angle));
}

/** Arcade top-down physics: split velocity into forward/lateral, kill lateral by grip. */
export function stepCar(car: Car, input: Input, dt: number, mods: PhysMods) {
  const fwd = fromAngle(car.angle);
  const right = vec(-fwd.y, fwd.x);
  let vF = dot(car.vel, fwd);
  let vL = dot(car.vel, right);

  const s = car.surface;
  const gripMul = s === "track" ? mods.trackGrip : mods.offGrip;
  const drag = s === "track" ? PHYS.drag : PHYS.grassDrag * (s === "lava" ? mods.lavaDrag : mods.offDrag);
  const maxMul = s === "track" ? 1 : PHYS.grassMax * (s === "lava" ? mods.lavaMax : mods.offMax);
  const maxSpeed = PHYS.maxSpeed * car.skill * car.speedMul * car.boostMul * car.flyMul * maxMul;

  if (input.throttle) vF += PHYS.accel * car.accelMul * car.speedMul * car.boostMul * car.flyMul * dt * (vF < maxSpeed ? 1 : 0);
  if (input.brake) vF -= (vF > 0 ? PHYS.brake : PHYS.reverseAccel) * dt;
  vF -= vF * drag * dt;
  if (vF > maxSpeed) vF += (maxSpeed - vF) * Math.min(1, 3 * dt);
  // While bouncing off a bumper (engine cut), let the rebound play out: no reverse cap, loose grip.
  const bouncing = car.stun > 0;
  if (!bouncing) vF = Math.max(vF, -PHYS.maxReverse);

  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // Steering authority grows with speed and inverts in reverse.
  const authority = clamp(vF / 180, -1, 1);
  const turnPenalty = 1 - 0.35 * clamp(Math.abs(vF) / PHYS.maxSpeed, 0, 1);
  car.angle += steer * PHYS.turnRate * authority * turnPenalty * dt * (input.handbrake ? 1.35 : 1);

  vL *= Math.exp(-(input.handbrake || bouncing ? PHYS.driftGrip : PHYS.grip) * gripMul * car.gripMul * dt);
  if (input.handbrake) vF -= vF * 0.8 * dt;

  const nf = fromAngle(car.angle);
  const nr = vec(-nf.y, nf.x);
  car.vel = add(scale(nf, vF), scale(nr, vL));
  car.pos = add(car.pos, scale(car.vel, dt));
}

/** Lateral slip speed, used for skid marks. */
export function slipOf(car: Car): number {
  const f = fromAngle(car.angle);
  return Math.abs(dot(car.vel, vec(-f.y, f.x)));
}
