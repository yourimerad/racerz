import { type Vec, vec, add, scale, dot, fromAngle, clamp } from "./vec";

export type Input = { throttle: boolean; brake: boolean; left: boolean; right: boolean; handbrake: boolean };
export const NO_INPUT: Input = { throttle: false, brake: false, left: false, right: false, handbrake: false };

export type Car = {
  id: number;
  name: string;
  color: string;
  isPlayer: boolean;
  pos: Vec;
  vel: Vec;
  angle: number;
  /** AI top-speed multiplier (player = 1). */
  skill: number;
  // Race bookkeeping (see race.ts).
  progress: number;
  lastIndex: number;
  lap: number;
  lapStart: number;
  bestLap: number | null;
  finishTime: number | null;
  surface: Surface;
};

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
  const maxSpeed = PHYS.maxSpeed * car.skill * maxMul;

  if (input.throttle) vF += PHYS.accel * dt * (vF < maxSpeed ? 1 : 0);
  if (input.brake) vF -= (vF > 0 ? PHYS.brake : PHYS.reverseAccel) * dt;
  vF -= vF * drag * dt;
  if (vF > maxSpeed) vF += (maxSpeed - vF) * Math.min(1, 3 * dt);
  vF = Math.max(vF, -PHYS.maxReverse);

  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // Steering authority grows with speed and inverts in reverse.
  const authority = clamp(vF / 180, -1, 1);
  const turnPenalty = 1 - 0.35 * clamp(Math.abs(vF) / PHYS.maxSpeed, 0, 1);
  car.angle += steer * PHYS.turnRate * authority * turnPenalty * dt * (input.handbrake ? 1.35 : 1);

  vL *= Math.exp(-(input.handbrake ? PHYS.driftGrip : PHYS.grip) * gripMul * dt);
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
