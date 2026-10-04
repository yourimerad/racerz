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
  onTrack: boolean;
};

export const CAR_LENGTH = 40;
export const CAR_WIDTH = 22;
export const CAR_RADIUS = 17;

const ACCEL = 520;
const BRAKE = 950;
const REVERSE_ACCEL = 300;
const MAX_SPEED = 560;
const MAX_REVERSE = 160;
const TURN_RATE = 2.9;
const DRAG = 0.35;
const GRASS_DRAG = 2.2;
const GRASS_MAX = 0.45;
const GRIP = 9;
const DRIFT_GRIP = 1.6;

export function speedOf(car: Car): number {
  return dot(car.vel, fromAngle(car.angle));
}

/** Arcade top-down physics: split velocity into forward/lateral, kill lateral by grip. */
export function stepCar(car: Car, input: Input, dt: number) {
  const fwd = fromAngle(car.angle);
  const right = vec(-fwd.y, fwd.x);
  let vF = dot(car.vel, fwd);
  let vL = dot(car.vel, right);
  const maxSpeed = MAX_SPEED * car.skill * (car.onTrack ? 1 : GRASS_MAX);

  if (input.throttle) vF += ACCEL * dt * (vF < maxSpeed ? 1 : 0);
  if (input.brake) vF -= (vF > 0 ? BRAKE : REVERSE_ACCEL) * dt;
  vF -= vF * (car.onTrack ? DRAG : GRASS_DRAG) * dt;
  if (vF > maxSpeed) vF += (maxSpeed - vF) * Math.min(1, 3 * dt);
  vF = Math.max(vF, -MAX_REVERSE);

  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // Steering authority grows with speed and inverts in reverse.
  const authority = clamp(vF / 180, -1, 1);
  const turnPenalty = 1 - 0.35 * clamp(Math.abs(vF) / MAX_SPEED, 0, 1);
  car.angle += steer * TURN_RATE * authority * turnPenalty * dt * (input.handbrake ? 1.35 : 1);

  vL *= Math.exp(-(input.handbrake ? DRIFT_GRIP : GRIP) * dt);
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
