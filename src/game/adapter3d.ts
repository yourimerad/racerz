import { type Car, PHYS, isAirborne, speedOf } from "./car";
import { FLY } from "./flight";
import type { ModelId, Skin } from "./garage";
import { CONE, ERUPTION, HZ, HZ_SCALE, type VolcanoHazard } from "./modes/volcano";
import type { Race } from "./race";
import type { SceneProp } from "./scenery";
import type { ThemeId } from "./themes";
import type { CoverRange } from "./track";
import { type Vec, angleDiff, clamp } from "./vec";

// The 3D view's way into the game. Nothing here (nor in render3d.ts) ever writes to the Race: the 3D view is a picture of the state the
// 2D game already computes — positions, speeds, laps, money and saves stay exactly the same whichever view is on. This file is pure (no
// Three.js, no canvas), so scripts/check-3d.ts can test it in Node.
//
// UNITS: one world unit (what the physics and the 2D drawing use) is `K` metres in the 3D scene, a single factor everywhere: the world's
// (x, y) become the scene's (x, z), and the height (y) comes from the flight altitude, which is already in metres. A car (40 × 22 units)
// is then a real 4.0 × 2.2 m, the road 19 m wide, the walls of the flight rules (35–60 m) as high as they are in the flight HUD.

export const K = 0.1;
export type V3 = { x: number; y: number; z: number };

/** World (x, y) and altitude (m) → scene position (metres). */
export function toScene(x: number, y: number, alt = 0, out: V3 = { x: 0, y: 0, z: 0 }): V3 {
  out.x = x * K;
  out.y = alt;
  out.z = y * K;
  return out;
}

/** How the car is seen: one entry per car, reused from frame to frame. */
export type CarView = {
  id: number;
  isPlayer: boolean;
  model: ModelId;
  skin: Skin;
  /** World position (extrapolated by the frame's lag), heading (rad, 2D convention), altitude (m), signed forward speed (u/s). */
  x: number;
  y: number;
  heading: number;
  alt: number;
  speed: number;
  boosting: boolean;
  /** 1 = new, 0 = wrecked (the volcano's damage); 1 outside the volcano. */
  health: number;
  /** Wings 0 (folded) .. 1 (open) and engine flame 0..1 of the Jet; 0 for a normal car. */
  wing: number;
  flame: number;
  finished: boolean;
  /** The engine is cut after a bale bounce. */
  stunned: boolean;
};

export type PadView = { x: number; y: number; heading: number; flash: number; /** The player's turbo can take this pad now (it is not in its 3 s recharge). */ ready: boolean; /** Metres along / across the road. */ length: number; width: number };
export type TargetView = { id: number; x: number; y: number; /** Seconds left before the bomb lands. */ left: number; /** Metres. */ radius: number };
export type PoolView = { id: number; x: number; y: number; /** 1 hot .. 0 cooled; fade-out in the last second. */ heat: number; fade: number; radius: number; shape: readonly number[] };
export type BearView = { id: number; x: number; y: number; angle: number; /** Fade in / out at both ends of the crossing. */ alpha: number; age: number };
export type BearWarning = { x: number; y: number; signX: number; signY: number; age: number };
export type BombView = { x: number; y: number; /** Metres above the ground. */ z: number; r: number };

/** The player's numbers: the variables the 3D view is plugged into. */
export type PlayerView = CarView & {
  /** Speed in km/h as the HUD shows it. */
  kmh: number;
  /** 0..~1.8: speed against the car's own top speed (the turbo goes beyond 1). */
  speedRatio: number;
  /** Hit points 0..100 (volcano damage; 100 everywhere else). */
  hp: number;
  /** Flight energy 0..1 (null when the car cannot fly). */
  flightEnergy: number | null;
  /** Seconds of turbo left. */
  boostLeft: number;
  /** Height (m) of what is under the car: 0 on the road, the wall's height over a wall (shadow, landing). */
  floorAlt: number;
  /** Above 20 m (the game's `isAirborne`). */
  airborne: boolean;
  /** Impact strength 0..1 of this frame (camera shake): read from `race.crashes` without emptying it (Game.tsx does that for the sound). */
  impact: number;
};

export type TrackView = {
  /** The centre line: closed, densely sampled (sample 0 = the start / finish line). */
  center: readonly Vec[];
  tangents: readonly Vec[];
  width: number;
  barrier: number;
  covers: readonly CoverRange[];
  /** Length of one lap, world units. */
  length: number;
};

export type Dangers = {
  /** The volcano's aimed bombs on their way (red targets on the road), the burning pools, the bombs of the eruption in flight. */
  targets: TargetView[];
  pools: PoolView[];
  bombs: BombView[];
  /** The polar bears on the road and the blinking alert before the next one. */
  bears: BearView[];
  warning: BearWarning | null;
};

const emptyCar = (): CarView => ({
  id: 0, isPlayer: false, model: "gt", skin: { name: "", body: "#e63946", accent: "#9d1c27" }, x: 0, y: 0, heading: 0, alt: 0, speed: 0, boosting: false, health: 1,
  wing: 0, flame: 0, finished: false, stunned: false,
});

const isVolcano = (h: unknown): h is VolcanoHazard => !!h && typeof h === "object" && "eruption" in h && "hazards" in h;
type BearBody = { id: number; x: number; y: number; angle: number; age?: number; life?: number };

/**
 * Reads a Race for the 3D view. `refresh(lag)` once per frame (the lag is the time the simulation has not stepped yet: the display is not
 * a multiple of the 120 Hz step, so positions are carried forward by velocity × lag), then read the views. Everything is reused: nothing
 * is allocated per frame except what the hazards themselves hold.
 */
export class Adapter3D {
  readonly race: Race;
  readonly mode: ThemeId;
  readonly track: TrackView;
  readonly player: PlayerView;
  readonly cars: CarView[];
  readonly pads: PadView[];
  readonly dangers: Dangers = { targets: [], pools: [], bombs: [], bears: [], warning: null };
  /** The scenery: props with the same positions as the 2D art, hay-bale bumpers (physical), ground lava. */
  readonly props: readonly SceneProp[];
  private bearViews: BearView[] = [];

  constructor(race: Race) {
    this.race = race;
    this.mode = race.theme.id;
    const { track } = race;
    let length = 0;
    for (let i = 0; i < track.path.length; i++) {
      const a = track.path[i], b = track.path[(i + 1) % track.path.length];
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    this.track = { center: track.path, tangents: track.tangents, width: track.width, barrier: track.barrier, covers: track.covers, length };
    this.props = race.scene.props ?? [];
    this.cars = race.cars.map(() => emptyCar());
    this.player = { ...emptyCar(), kmh: 0, speedRatio: 0, hp: 100, flightEnergy: null, boostLeft: 0, floorAlt: 0, airborne: false, impact: 0 };
    const k = race.boost.k;
    this.pads = race.boost.pads.map((p) => ({ x: p.x, y: p.y, heading: p.heading, flash: 0, ready: true, length: 92 * k * K, width: 80 * k * K }));
    this.refresh(0);
  }

  /** The player's car (the one the camera follows). */
  get car(): Car {
    return this.race.cars[0];
  }

  refresh(lag: number) {
    const { race } = this;
    const flight = race.flight;
    lag = clamp(lag, 0, 0.05);
    for (let i = 0; i < race.cars.length; i++) {
      const c = race.cars[i], v = this.cars[i];
      v.id = c.id;
      v.isPlayer = c.isPlayer;
      v.model = c.model;
      v.skin = c.skin;
      // The cars move on until the next step: carry them forward (a stopped or finished car just stays).
      v.x = c.pos.x + c.vel.x * lag;
      v.y = c.pos.y + c.vel.y * lag;
      v.heading = c.angle;
      v.alt = c.alt;
      v.speed = speedOf(c);
      v.boosting = race.boost.isBoosting(c);
      v.health = this.healthOf(c);
      v.finished = c.finishTime !== null;
      v.stunned = c.stun > 0;
      if (c.isPlayer && flight) {
        const look = flight.look(c);
        v.wing = look.wing;
        v.flame = look.flame;
      } else {
        v.wing = 0;
        v.flame = 0;
      }
    }
    const me = race.cars[0], mv = this.cars[0], p = this.player;
    Object.assign(p, mv);
    p.kmh = Math.round(Math.abs(mv.speed) * 0.45);
    p.speedRatio = Math.abs(mv.speed) / (PHYS.maxSpeed * me.skill);
    p.hp = Math.round(this.healthOf(me) * 100);
    p.flightEnergy = flight ? clamp(flight.st(me).energy / FLY.MAX_ENERGY, 0, 1) : null;
    p.boostLeft = race.boost.remaining(me);
    p.floorAlt = flight ? flight.floorAt(mv.x, mv.y) : 0;
    p.airborne = isAirborne(me);
    p.impact = 0;
    for (const c of race.crashes) if (c > p.impact) p.impact = c;
    for (let i = 0; i < this.pads.length; i++) {
      this.pads[i].flash = race.boost.pads[i].flash;
      this.pads[i].ready = !race.boost.pads[i].cool.has(me.id);
    }
    this.readDangers();
  }

  /** The damage of a car as 1 (untouched) .. 0 (wrecked): only the volcano wears cars down. */
  private healthOf(c: Car): number {
    const hz = this.race.hazard;
    return isVolcano(hz) ? hz.hazards.st(c).hp / HZ.MAX_HP : 1;
  }

  private readDangers() {
    const hz = this.race.hazard, d = this.dangers;
    d.targets.length = 0;
    d.pools.length = 0;
    d.bombs.length = 0;
    d.warning = null;
    if (isVolcano(hz)) {
      for (const t of hz.hazards.targets) {
        d.targets.push({ id: t.id, x: t.x * HZ_SCALE, y: t.y * HZ_SCALE, left: Math.max(0, HZ.WARN_TIME - t.age), radius: HZ.TARGET_R * HZ_SCALE * K });
      }
      for (const p of hz.hazards.pools) {
        const heat = Math.max(0, 1 - p.age / HZ.POOL_LIFE);
        d.pools.push({ id: p.id, x: p.x * HZ_SCALE, y: p.y * HZ_SCALE, heat, fade: p.age > HZ.POOL_LIFE ? Math.max(0, 1 - (p.age - HZ.POOL_LIFE)) : 1, radius: HZ.POOL_RADIUS * HZ_SCALE * K, shape: p.shape });
      }
      // The eruption's own bombs (decorative): eruption frame → world, height in frame px → metres.
      const e = hz.eruption;
      for (const b of e.bombs) {
        const w = eruptionToWorld(b.x, b.y);
        d.bombs.push({ x: w.x, y: w.y, z: b.z * ERUPTION.scale * K, r: b.r * ERUPTION.scale * K });
      }
    }
    this.bearViews.length = 0;
    const bodies = hz && !isVolcano(hz) ? hz.bodies?.() : undefined;
    if (bodies) {
      for (const b of bodies as readonly BearBody[]) {
        const age = b.age ?? 1, life = b.life ?? 99;
        this.bearViews.push({ id: b.id, x: b.x, y: b.y, angle: b.angle, alpha: clamp(Math.min(age / 0.4, (life - age) / 0.4), 0, 1), age });
      }
    }
    d.bears = this.bearViews;
    const w = hz && !isVolcano(hz) ? hz.warning?.() : null;
    if (w) d.warning = w;
  }

  /** The volcano's eruption state for the 3D smoke, glow and flash (null in the other modes). */
  eruption() {
    const hz = this.race.hazard;
    return isVolcano(hz) ? hz.eruption : null;
  }

  /** The volcano's aimed-bomb system (popups, puffs, splashes) (null in the other modes). */
  volcano() {
    const hz = this.race.hazard;
    return isVolcano(hz) ? hz.hazards : null;
  }

  /** The camera shake the game itself asks for (the eruption near the crater, the player's bomb hits), in world units. */
  hazardShake(): Vec {
    return this.race.hazard?.shake?.(this.race.cars[0].pos) ?? { x: 0, y: 0 };
  }
}

/** The eruption's own drawing frame (680 × 460, crater at its centre) → world position (the same transform the 2D scenery uses). */
export function eruptionToWorld(fx: number, fy: number): Vec {
  return { x: CONE.x + (fx - ERUPTION.frame.cx) * ERUPTION.scale, y: CONE.y + (fy - ERUPTION.frame.cy) * ERUPTION.scale };
}

// ---------- chase camera ----------

export const CAM = {
  /** Distance behind the car and height above it (m), on the ground. */
  DIST: 9.5, HEIGHT: 4.2,
  /** Extra distance and height at full altitude (80 m): it rises and backs off a little when the car flies. */
  FLY_BACK: 3.5, FLY_UP: 2.6,
  /** Field of view (degrees): at rest, added at the car's top speed (grows as speed^1.4), added during a turbo. */
  FOV: 60, FOV_SPEED: 16, FOV_BOOST: 8, FOV_MAX: 92,
  /** Smoothing rates (1/s): the view direction (yaw), the flight lift, the field of view. The distance itself is never smoothed. */
  YAW_RATE: 6.5, LIFT_RATE: 2.2, FOV_RATE: 3,
  /** The camera looks this far ahead of the car (m) and this far above it. */
  LOOK_AHEAD: 6, LOOK_UP: 1.1,
  /** Shake: impacts decay at this rate (1/s) and move the camera up to this far (m); the game's own shake (world units) counts × SHAKE_SCALE. */
  IMPACT_DECAY: 5, IMPACT_AMP: 0.35, SHAKE_SCALE: K * 0.6,
};

export type CamPose = { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov: number };
export type CamTarget = { x: number; y: number; alt: number; heading: number; speedRatio: number; boosting: boolean; impact: number };

/**
 * The chase camera behind the car. Only the view direction, the lift and the field of view are smoothed (so the car never lags 14 m behind
 * itself at 60 m/s); a pure function of what the game says, so a toggle 2D → 3D mid-race starts at the right place (`snap`).
 */
export class ChaseCamera {
  readonly pose: CamPose = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: CAM.FOV };
  private yaw = 0;
  private lift = 0;
  private fov = CAM.FOV;
  private shake = 0;
  private t = 0;

  /** Puts the camera exactly where it settles for this target (no sweep from wherever it was). */
  snap(t: CamTarget, shake: Vec = { x: 0, y: 0 }) {
    this.yaw = t.heading;
    this.lift = clamp(t.alt / FLY.MAX_ALT, 0, 1);
    this.fov = this.targetFov(t);
    this.shake = 0;
    this.place(t, shake);
  }

  update(dt: number, t: CamTarget, shake: Vec = { x: 0, y: 0 }) {
    dt = clamp(dt, 0, 0.1);
    this.t += dt;
    this.yaw += angleDiff(this.yaw, t.heading) * (1 - Math.exp(-CAM.YAW_RATE * dt));
    this.lift += (clamp(t.alt / FLY.MAX_ALT, 0, 1) - this.lift) * (1 - Math.exp(-CAM.LIFT_RATE * dt));
    this.fov += (this.targetFov(t) - this.fov) * (1 - Math.exp(-CAM.FOV_RATE * dt));
    this.shake = Math.max(this.shake * Math.exp(-CAM.IMPACT_DECAY * dt), t.impact);
    this.place(t, shake);
  }

  private targetFov(t: CamTarget) {
    return Math.min(CAM.FOV_MAX, CAM.FOV + CAM.FOV_SPEED * Math.pow(clamp(t.speedRatio, 0, 1.6), 1.4) + (t.boosting ? CAM.FOV_BOOST : 0));
  }

  private place(t: CamTarget, hazard: Vec) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const dist = CAM.DIST + CAM.FLY_BACK * this.lift, up = CAM.HEIGHT + CAM.FLY_UP * this.lift;
    const cx = t.x * K, cz = t.y * K, cy = t.alt;
    // A deterministic wobble (no random state): two incommensurable sines per axis.
    const a = this.shake * CAM.IMPACT_AMP;
    const wx = Math.sin(this.t * 61.3) * a, wy = Math.sin(this.t * 47.1 + 1.3) * a, wz = Math.sin(this.t * 53.7 + 2.1) * a;
    const hx = hazard.x * CAM.SHAKE_SCALE, hz = hazard.y * CAM.SHAKE_SCALE;
    const p = this.pose;
    p.px = cx - c * dist + wx + hx;
    p.py = cy + up + wy + Math.abs(hx + hz) * 0.5;
    p.pz = cz - s * dist + wz + hz;
    p.lx = cx + c * CAM.LOOK_AHEAD;
    p.ly = cy + CAM.LOOK_UP;
    p.lz = cz + s * CAM.LOOK_AHEAD;
    p.fov = this.fov;
  }

  /** Heading the camera looks along (rad), for the sky and the sun. */
  get heading() {
    return this.yaw;
  }
}
