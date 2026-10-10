import { AIRBORNE_ALT, type Car } from "./car";
import { JET_SCALE, drawJet, drawJetSprite } from "./jetArt";
import { type Rng, mulberry32 } from "./scenery";
import type { Track } from "./track";

// Racerz Jet flight: hold Shift and the wings open, the car climbs to 80 m, flies over the low obstacles (hay bales, polar bear, other
// cars, lava pools, volcano targets and bombs, boost pads) and its shadow slides away from it on the ground; let go (or run out of
// energy) and it lands, wings folding. Only the human driver flies — bots never do.
//
// WALLS: the Jet can also fly over the walls (the cliffs of the desert canyon, the volcano's slopes…) when it is high enough: every
// place outside the barriers has a floor altitude (`floorAlt`, by mode) the car must reach to cross it; lower, it is the usual
// collision (bounce, a contact for the clean-race rule). The world's outer limits stay solid at any altitude. Flying over a wall costs
// more energy, a Jet cannot land on one (it glides until it finds the road again, and an empty tank sends it back to the road with a
// penalty), and invisible checkpoints (checkpoints.ts) stop a shortcut from skipping part of the lap.
//
// The controller only touches `car.alt` and, through the adapter, the car's flight speed multiplier (`car.flyMul`, combined with the
// turbo and the volcano's damage by stepCar) and, for a forced return, its position. race.ts runs it (`update`, `canCross`), render.ts
// draws it (`drawShadow`, `drawDust`, `drawCar`, `drawWingTrails`, `drawHud`), and every system that must ignore a flying car asks
// `isAirborne` (car.ts).

type Ctx = CanvasRenderingContext2D;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const FLY = {
  MAX_ENERGY: 5, RECHARGE: 0.6, MIN_TAKEOFF: 1.0, COOLDOWN: 1.0,
  WING_TIME: 0.6, MAX_ALT: 80, CLIMB: 100, DESCENT: 100, LOW_ALT: AIRBORNE_ALT,
  SPEED_MULT: 1.1,
  /** px either side of the start/finish line where no takeoff is allowed and a flying car lands. */
  NO_FLY_FINISH: 120, NO_FLY_START: 120,
  /**
   * The line must never be crossed in the air. Landing takes alt / DESCENT seconds, during which the car covers speed × that distance,
   * so the landing starts that far (plus this safety share) ahead of the 120 px: at the prototype's speeds 120 px were enough, at this
   * game's (500-1 300 u/s) they would have been crossed 60 m up.
   */
  LAND_SAFETY: 1.25,
  /** Design units → world units for the shadow's offset (the design car is 28 long, ours 40). */
  SCALE: 40 / 28,
  SHADOW_X: 0.4, SHADOW_Y: 0.55, SHADOW_ALPHA: 0.3,
  /** The Jet grows with altitude (parallax), up to this share more at full height. */
  PARALLAX: 0.2,
};

export const WALLS = {
  /** Energy per second over a wall (1 elsewhere in the air), also while gliding down over it. */
  DRAIN_OVER_WALL: 1.5,
  /** Forced return to the road: seconds added to the clock, share of the speed kept, seconds of grace (no contact counted, no damage). */
  RESPAWN_PENALTY: 2, RESPAWN_SPEED: 0.4, RESPAWN_SHIELD: 1,
  /** Height (m) of the walls beyond the barriers, by mode: the canyon cliffs, the volcano's slopes, the ice banks; any other mode: DEFAULT_HEIGHT. */
  HEIGHT: { desert: 60, volcano: 50, northpole: 40 } as Record<string, number>,
  DEFAULT_HEIGHT: 35,
  /** The volcano's crater lake is no wall (it can be flown over at any altitude) but nobody lands on it: this is its floor. */
  LAVA_FLOOR: 25,
  /** "Trop bas !" looks this far ahead of the car: fixed distances (design px) and seconds of travel. */
  LOOKAHEAD: [40, 80], LOOK_TIME: [0.25, 0.5],
  /** Invisible checkpoints: how many, and their half width as a share of the road width. */
  GATES: 8, GATE_HALF: 0.7,
  /** Seconds the "return to the road" message stays. */
  MESSAGE: 1.5,
};

/** Height (m) of a mode's walls. */
export const wallHeightOf = (modeId: string) => WALLS.HEIGHT[modeId] ?? WALLS.DEFAULT_HEIGHT;

/** Takeoff dust: sand in the desert, snow at the north pole, ash on the volcano, plain dust elsewhere. */
const DUST: Record<string, { rgb: string; alpha: number }> = {
  desert: { rgb: "226,189,132", alpha: 0.6 }, northpole: { rgb: "255,255,255", alpha: 0.75 }, volcano: { rgb: "104,96,92", alpha: 0.65 },
};
export const dustOf = (modeId: string) => DUST[modeId] ?? { rgb: "200,196,186", alpha: 0.5 };
const DUST_PUFFS = 9, DUST_MAX = 40;

export type FlightAdapter = {
  speed(car: Car): number;
  /** Sets the flight multiplier (top speed AND acceleration). */
  setSpeedMultiplier(car: Car, f: number): void;
  /** Distance (px) along the track to the finish line, whichever side of it the car is on. */
  distToFinish(car: Car): number;
  distToStart(car: Car): number;
  /** Spots where nobody flies (none of the current modes has one). */
  noFlyAt(x: number, y: number): boolean;
  /** Minimum altitude (m) at a point: 0 inside the barriers, the mode's wall height beyond them, 25 over the volcano's crater lake. */
  floorAlt(x: number, y: number): number;
  /** False beyond the world's outer limits, which stay solid at any altitude. */
  inWorld(x: number, y: number): boolean;
  /** The centre-line point nearest to (x, y), and the direction of the race there. */
  nearestRoadPoint(x: number, y: number): { x: number; y: number; heading: number };
  /** Puts the car back on the road (speed × speedFactor, a second of grace). */
  respawn(car: Car, x: number, y: number, heading: number, speedFactor: number): void;
  /** Adds seconds to the car's clock. */
  addTimePenalty(car: Car, sec: number): void;
  onTakeoff(car: Car): void;
  onLand(car: Car): void;
};

type Mode = "ground" | "takeoff" | "fly" | "landing";
type FlightState = {
  mode: Mode; wing: number; alt: number; energy: number; cool: number; warn: number; latched: boolean;
  /** Over a wall right now (flying with a floor under it). */
  over: boolean;
  /** Seconds left of the "Retour sur la piste" message. */
  respawned: number;
};
type Puff = { x: number; y: number; vx: number; vy: number; r: number; age: number; life: number };

let reducedMotion: boolean | null = null;
/** prefers-reduced-motion: no wing trails, no blinking. */
function calm(): boolean {
  if (reducedMotion === null) reducedMotion = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reducedMotion;
}
let coarse: boolean | null = null;
function touchScreen(): boolean {
  if (coarse === null) coarse = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  return coarse;
}

const lengths = new WeakMap<Track, { s: number[]; total: number }>();
/** Distance along the track from the line (sample 0) to each sample. */
function trackLengths(track: Track) {
  let l = lengths.get(track);
  if (!l) {
    const n = track.path.length, s = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(track.path[i].x - track.path[i - 1].x, track.path[i].y - track.path[i - 1].y));
    l = { s, total: s[n - 1] + Math.hypot(track.path[0].x - track.path[n - 1].x, track.path[0].y - track.path[n - 1].y) };
    lengths.set(track, l);
  }
  return l;
}

/** Distance (px) along the track from a car to the start/finish line, on whichever side it is. */
export function distToLine(track: Track, car: Car): number {
  const { s, total } = trackLengths(track);
  const d = s[car.lastIndex] ?? 0;
  return Math.min(d, total - d);
}

export class FlightController {
  private A: FlightAdapter;
  private s = new Map<number, FlightState>();
  private dust: { rgb: string; alpha: number };
  private puffs: Puff[] = [];
  private rng: Rng = mulberry32(0xf11e);
  constructor(adapter: FlightAdapter, dust = dustOf("")) {
    this.A = adapter;
    this.dust = dust;
  }

  reset() {
    this.s.clear();
    this.puffs = [];
  }

  st(car: Car): FlightState {
    let s = this.s.get(car.id);
    if (!s) {
      s = { mode: "ground", wing: 0, alt: 0, energy: FLY.MAX_ENERGY, cool: 0, warn: 0, latched: false, over: false, respawned: 0 };
      this.s.set(car.id, s);
    }
    return s;
  }

  isAirborne(car: Car) {
    return this.st(car).alt >= FLY.LOW_ALT;
  }

  isFlying(car: Car) {
    return this.st(car).mode !== "ground";
  }

  /** Live takeoff dust puffs (capped). */
  puffCount() {
    return this.puffs.length;
  }

  /** Floor altitude at a point (see `FlightAdapter.floorAlt`). */
  floorAt(x: number, y: number) {
    return this.A.floorAlt(x, y);
  }

  /**
   * Whether this car, at (x, y), passes over the wall there instead of hitting it: only in the air, high enough for the floor under it,
   * and never beyond the world's outer limits.
   */
  canCross(car: Car, x: number, y: number) {
    const s = this.st(car);
    return this.A.inWorld(x, y) && s.alt > 0 && s.alt >= this.A.floorAlt(x, y);
  }

  /** `wantsFly` = Shift held; only called for the human's Jet. */
  update(dt: number, car: Car, wantsFly: boolean) {
    dt = Math.min(dt, 0.05);
    const A = this.A, s = this.st(car);
    this.stepPuffs(dt);
    if (car.finishTime !== null) wantsFly = false; // the race is over: come down
    s.cool = Math.max(0, s.cool - dt);
    s.warn = Math.max(0, s.warn - dt);
    s.respawned = Math.max(0, s.respawned - dt);
    if (!wantsFly) s.latched = false;
    const floor = A.floorAlt(car.pos.x, car.pos.y);
    s.over = floor > 0 && s.alt > 0;
    // The landing zone around the line widens with the time (and so the distance) a landing from the current altitude takes.
    const margin = FLY.NO_FLY_FINISH + A.speed(car) * (s.alt / FLY.DESCENT) * FLY.LAND_SAFETY;
    const noFly = A.noFlyAt(car.pos.x, car.pos.y) || Math.min(A.distToFinish(car), A.distToStart(car)) < Math.max(margin, FLY.NO_FLY_START);
    const canTake = wantsFly && !s.latched && s.energy >= FLY.MIN_TAKEOFF && s.cool <= 0 && !noFly;
    const wingStep = dt / FLY.WING_TIME, drain = (s.over ? WALLS.DRAIN_OVER_WALL : 1) * dt;
    /** A landing forced by a no-fly zone: Shift must be let go before the next takeoff (else the car would bounce at the zone's edge). */
    const forceLanding = () => {
      s.mode = "landing";
      s.warn = 1;
      s.latched = true;
    };
    /** Out of energy: down, and a second before the next takeoff. */
    const outOfEnergy = () => {
      s.mode = "landing";
      s.energy = 0;
      s.cool = FLY.COOLDOWN;
    };

    if (s.mode === "ground") {
      s.wing = Math.max(0, s.wing - wingStep);
      s.energy = Math.min(FLY.MAX_ENERGY, s.energy + FLY.RECHARGE * dt);
      if (canTake) {
        s.mode = "takeoff";
        this.puff(car);
        A.onTakeoff(car);
      } else if (wantsFly && noFly) s.warn = 1;
    } else if (s.mode === "takeoff") {
      s.wing = Math.min(1, s.wing + wingStep);
      if (s.wing >= 0.5) s.alt = Math.min(FLY.MAX_ALT, s.alt + FLY.CLIMB * dt);
      s.energy -= drain;
      if (noFly) forceLanding();
      else if (s.energy <= 0) outOfEnergy();
      else if (!wantsFly) s.mode = "landing";
      else if (s.alt >= FLY.MAX_ALT) s.mode = "fly";
    } else if (s.mode === "fly") {
      s.energy -= drain;
      if (noFly) forceLanding();
      else if (s.energy <= 0) outOfEnergy();
      else if (!wantsFly) s.mode = "landing";
    } else {
      // Landing: the energy keeps falling over a wall, and the car never goes below the floor under it (it glides on at the wall's height).
      if (s.over) s.energy -= drain;
      s.alt = Math.max(Math.min(floor, s.alt), s.alt - FLY.DESCENT * dt);
      // Pressed again on the way down, with energy left: back up.
      if (wantsFly && !s.latched && !noFly && s.energy > 0 && s.cool <= 0) s.mode = "takeoff";
      else if (s.over && s.energy <= 0) this.crashLand(car, s);
      else if (s.alt <= 0) {
        s.wing = Math.max(0, s.wing - wingStep);
        if (s.wing <= 0) {
          s.mode = "ground";
          A.onLand(car);
        }
      }
    }
    s.energy = clamp(s.energy, 0, FLY.MAX_ENERGY);
    car.alt = s.alt;
    A.setSpeedMultiplier(car, 1 + (FLY.SPEED_MULT - 1) * clamp(s.alt / FLY.MAX_ALT, 0, 1));
  }

  /** Out of energy over a wall: back to the nearest road point, heading with the race, 40 % of the speed, 2 s added to the clock. No damage, no contact. */
  crashLand(car: Car, s: FlightState = this.st(car)) {
    const A = this.A, r = A.nearestRoadPoint(car.pos.x, car.pos.y);
    this.groundCar(car);
    A.respawn(car, r.x, r.y, r.heading, WALLS.RESPAWN_SPEED);
    A.addTimePenalty(car, WALLS.RESPAWN_PENALTY);
    s.respawned = WALLS.MESSAGE;
    A.onLand(car);
  }

  /** Puts the car's flight back to the ground state (wings folded, a second before the next takeoff). */
  groundCar(car: Car) {
    const s = this.st(car);
    s.mode = "ground";
    s.alt = 0;
    s.wing = 0;
    s.cool = FLY.COOLDOWN;
    s.warn = 0;
    s.latched = false;
    s.over = false;
    car.alt = 0;
    car.flyMul = 1;
  }

  /** Where the Jet is at ground level, for its sprite's wings and engines. */
  look(car: Car) {
    const s = this.st(car);
    return { wing: s.wing, flame: s.alt > 2 ? clamp(s.alt / FLY.MAX_ALT, 0.3, 1) : 0, steady: calm() };
  }

  // ---------- takeoff dust ----------

  private puff(car: Car) {
    const room = DUST_MAX - this.puffs.length;
    for (let i = 0; i < Math.min(DUST_PUFFS, room); i++) {
      const a = this.rng() * Math.PI * 2, sp = 40 + this.rng() * 90;
      this.puffs.push({
        x: car.pos.x + Math.cos(a) * 12, y: car.pos.y + Math.sin(a) * 12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 7 + this.rng() * 6, age: 0, life: 0.7 + this.rng() * 0.5,
      });
    }
  }

  private stepPuffs(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age > p.life) {
        this.puffs.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.5 * dt;
      p.vy *= 1 - 2.5 * dt;
      p.r += 22 * dt;
    }
  }

  /** GROUND layer, before the cars: the takeoff's cloud of sand, snow or ash. */
  drawDust(ctx: Ctx) {
    for (const p of this.puffs) {
      const a = this.dust.alpha * (1 - p.age / p.life);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(${this.dust.rgb},${a})`);
      g.addColorStop(1, `rgba(${this.dust.rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- drawing ----------

  /**
   * GROUND layer, BEFORE the cars: the shadow falls on whatever is under the car (the ground, or the top of a wall), so how far it slides
   * away depends on the height above THAT, and it only shows above 1 m.
   */
  drawShadow(ctx: Ctx, car: Car) {
    const s = this.st(car);
    if (s.alt < 1) return;
    const h = Math.max(0, s.alt - this.A.floorAlt(car.pos.x, car.pos.y));
    if (h < 1) return;
    const k = JET_SCALE * (1 - 0.0025 * h);
    ctx.save();
    ctx.globalAlpha = FLY.SHADOW_ALPHA * clamp(1 - h / 400, 0, 1);
    ctx.translate(car.pos.x + h * FLY.SHADOW_X * FLY.SCALE, car.pos.y + h * FLY.SHADOW_Y * FLY.SCALE);
    ctx.rotate(car.angle + Math.PI / 2);
    ctx.scale(k, k);
    drawJet(ctx, { wing: s.wing, silhouette: true });
    ctx.restore();
  }

  /**
   * The Jet itself: in the normal car layer while below 20 m (with the soft ground shadow only when it is on the ground), in the HIGH layer
   * (after the bridge, the eruption and all the scenery) above — render.ts decides. It grows a little with altitude.
   */
  drawCar(ctx: Ctx, car: Car) {
    const s = this.st(car);
    drawJetSprite(ctx, car.pos.x, car.pos.y, car.angle, { ...this.look(car), shadow: s.alt < 1, scale: 1 + FLY.PARALLAX * clamp(s.alt / FLY.MAX_ALT, 0, 1) });
  }

  /** White trails off the wing tips (in the air, not with prefers-reduced-motion). */
  drawWingTrails(ctx: Ctx, car: Car) {
    const s = this.st(car);
    if (s.alt < 40 || calm()) return;
    const k = JET_SCALE * (1 + FLY.PARALLAX * clamp(s.alt / FLY.MAX_ALT, 0, 1)), c = Math.cos(car.angle), n = Math.sin(car.angle);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      const tx = car.pos.x + (-n * 58 * side + c * 16) * k, ty = car.pos.y + (c * 58 * side + n * 16) * k;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - c * 120 * k, ty - n * 120 * k);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The highest floor within the look-ahead in front of the car (m): "Trop bas !" when it is above the car. */
  private floorAhead(car: Car) {
    const A = this.A, c = Math.cos(car.angle), n = Math.sin(car.angle), v = Math.max(0, A.speed(car));
    let m = 0;
    for (const d of [...WALLS.LOOKAHEAD.map((d) => d * FLY.SCALE), ...WALLS.LOOK_TIME.map((t) => v * t)]) {
      m = Math.max(m, A.floorAlt(car.pos.x + c * d, car.pos.y + n * d));
    }
    return m;
  }

  /**
   * HUD in SCREEN pixels, for the player only. The top left is the race panel, the top right the minimap (`mapBottom` = its lower edge),
   * the top centre the volcano's alert and the bottom right the turbo and speed: the energy bar sits bottom left, the altitude gauge
   * under the minimap, and the messages stack under the top centre (`pill`: a checkpoint message, from checkpoints.ts).
   */
  drawHud(ctx: Ctx, car: Car, W: number, H: number, mapBottom: number, pill: { text: string; bad: boolean } | null = null) {
    const s = this.st(car), ratio = s.energy / FLY.MAX_ENERGY, still = calm(), now = performance.now();
    const blink = (hz: number) => still || Math.sin(now / hz) > -0.3;
    const lift = touchScreen() ? 104 : 0; // the touch pads occupy the bottom corners
    ctx.save();
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    const bx = 14, by = H - 46 - lift;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(bx, by, 206, 28, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("VOL", bx + 12, by + 19);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.roundRect(bx + 44, by + 8, 106, 12, 6);
    ctx.fill();
    ctx.fillStyle = ratio > 0.2 ? "#7cc0e8" : "#d63a2f";
    if (ratio > 0) {
      ctx.beginPath();
      ctx.roundRect(bx + 44, by + 8, 106 * ratio, 12, 6);
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.fillText(Math.round(ratio * 100) + "%", bx + 160, by + 19);
    if (s.alt > 0) {
      // altitude gauge on the right, under the minimap, above the turbo gauge and the speed readout
      const gx = W - 28, gy = mapBottom + 30, gh = Math.min(130, H - 150 - gy), f = s.alt / FLY.MAX_ALT;
      if (gh >= 40) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.roundRect(gx, gy, 14, gh, 7);
        ctx.fill();
        ctx.fillStyle = "#ffd45a";
        ctx.beginPath();
        ctx.roundRect(gx, gy + gh * (1 - f), 14, gh * f, 7);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("ALT", gx + 7, gy - 8);
        ctx.fillText(Math.round(s.alt) + " m", gx + 7, gy + gh + 16);
        ctx.textAlign = "start";
      }
    }
    const chip = (txt: string, x: number, y: number, w: number, bg = "rgba(0,0,0,0.6)") => {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 26, 9);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(txt, x + w / 2, y + 18);
      ctx.textAlign = "start";
    };
    // Messages under the top centre, one row each (34 px apart), in order of importance.
    let row = 0;
    const top = (txt: string, w: number, bg?: string) => chip(txt, W / 2 - w / 2, 50 + 34 * row++, w, bg);
    const key = touchScreen() ? "VOL" : "SHIFT";
    if (s.respawned > 0) top("Retour sur la piste (+2 s)", 220);
    else if (s.mode === "ground" && s.energy >= FLY.MIN_TAKEOFF) top(`Maintiens ${key} pour voler`, 220);
    if (s.mode === "fly" || s.mode === "takeoff") chip(`${key} : atterrir`, bx, by - 34, 140);
    if (s.warn > 0 && blink(100)) top("Zone d'atterrissage", 160);
    if (s.mode !== "ground") {
      if (this.floorAhead(car) > s.alt + 0.01 && blink(100)) top(`Trop bas ! Monte avec ${key}`, 240, "rgba(214,58,47,0.85)");
      else if (s.over && s.energy < 2 && blink(120)) top("Retourne sur la piste !", 200, "rgba(255,159,28,0.9)");
    }
    if (pill) top(pill.text, 160, pill.bad ? "rgba(214,58,47,0.85)" : undefined);
    ctx.restore();
  }
}
