import { AIRBORNE_ALT, type Car } from "./car";
import { JET_SCALE, drawJet, drawJetSprite } from "./jetArt";
import type { Track } from "./track";

// Racerz Jet flight: hold Shift and the wings open, the car climbs to 80 m, flies over the low obstacles (hay bales, polar bear, other
// cars, lava pools, volcano targets and bombs, boost pads) and its shadow slides away from it on the ground; let go (or run out of
// energy) and it lands, wings folding. Walls and barriers stay solid. Only the human driver flies — bots never do.
//
// The controller only touches `car.alt` and, through the adapter, the car's flight speed multiplier (`car.flyMul`, combined with the
// turbo and the volcano's damage by stepCar). race.ts runs it (`update`), render.ts draws it (`drawShadow`, `drawCar`,
// `drawWingTrails`, `drawHud`), and every system that must ignore a flying car asks `isAirborne` (car.ts).

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
};

export type FlightAdapter = {
  speed(car: Car): number;
  /** Sets the flight multiplier (top speed AND acceleration). */
  setSpeedMultiplier(car: Car, f: number): void;
  /** Distance (px) along the track to the finish line, whichever side of it the car is on. */
  distToFinish(car: Car): number;
  distToStart(car: Car): number;
  /** Spots where nobody flies (none of the current modes has one). */
  noFlyAt(x: number, y: number): boolean;
  onTakeoff(car: Car): void;
  onLand(car: Car): void;
};

type Mode = "ground" | "takeoff" | "fly" | "landing";
type FlightState = { mode: Mode; wing: number; alt: number; energy: number; cool: number; warn: number; latched: boolean };

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
  constructor(adapter: FlightAdapter) {
    this.A = adapter;
  }

  reset() {
    this.s.clear();
  }

  st(car: Car): FlightState {
    let s = this.s.get(car.id);
    if (!s) {
      s = { mode: "ground", wing: 0, alt: 0, energy: FLY.MAX_ENERGY, cool: 0, warn: 0, latched: false };
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

  /** `wantsFly` = Shift held; only called for the human's Jet. */
  update(dt: number, car: Car, wantsFly: boolean) {
    dt = Math.min(dt, 0.05);
    const A = this.A, s = this.st(car);
    if (car.finishTime !== null) wantsFly = false; // the race is over: come down
    s.cool = Math.max(0, s.cool - dt);
    s.warn = Math.max(0, s.warn - dt);
    if (!wantsFly) s.latched = false;
    // The landing zone around the line widens with the time (and so the distance) a landing from the current altitude takes.
    const margin = FLY.NO_FLY_FINISH + A.speed(car) * (s.alt / FLY.DESCENT) * FLY.LAND_SAFETY;
    const noFly = A.noFlyAt(car.pos.x, car.pos.y) || Math.min(A.distToFinish(car), A.distToStart(car)) < Math.max(margin, FLY.NO_FLY_START);
    const canTake = wantsFly && !s.latched && s.energy >= FLY.MIN_TAKEOFF && s.cool <= 0 && !noFly;
    const wingStep = dt / FLY.WING_TIME;
    /** A landing forced by a no-fly zone: Shift must be let go before the next takeoff (else the car would bounce at the zone's edge). */
    const forceLanding = () => {
      s.mode = "landing";
      s.warn = 1;
      s.latched = true;
    };

    if (s.mode === "ground") {
      s.wing = Math.max(0, s.wing - wingStep);
      s.energy = Math.min(FLY.MAX_ENERGY, s.energy + FLY.RECHARGE * dt);
      if (canTake) {
        s.mode = "takeoff";
        A.onTakeoff(car);
      } else if (wantsFly && noFly) s.warn = 1;
    } else if (s.mode === "takeoff") {
      s.wing = Math.min(1, s.wing + wingStep);
      if (s.wing >= 0.5) s.alt = Math.min(FLY.MAX_ALT, s.alt + FLY.CLIMB * dt);
      s.energy -= dt;
      if (noFly) forceLanding();
      else if (!wantsFly || s.energy <= 0) {
        s.mode = "landing";
        if (s.energy <= 0) {
          s.energy = 0;
          s.cool = FLY.COOLDOWN;
        }
      } else if (s.alt >= FLY.MAX_ALT) s.mode = "fly";
    } else if (s.mode === "fly") {
      s.energy -= dt;
      if (noFly) forceLanding();
      else if (!wantsFly || s.energy <= 0) {
        s.mode = "landing";
        if (s.energy <= 0) {
          s.energy = 0;
          s.cool = FLY.COOLDOWN;
        }
      }
    } else {
      s.alt = Math.max(0, s.alt - FLY.DESCENT * dt);
      // Pressed again on the way down, with energy left: back up.
      if (wantsFly && !s.latched && !noFly && s.energy > 0 && s.cool <= 0) s.mode = "takeoff";
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

  /** Where the Jet is at ground level, for its sprite's wings and engines. */
  look(car: Car) {
    const s = this.st(car);
    return { wing: s.wing, flame: s.alt > 2 ? clamp(s.alt / FLY.MAX_ALT, 0.3, 1) : 0, steady: calm() };
  }

  /** GROUND layer, BEFORE the cars: the shadow slides away from the car as it climbs (drawn only above 1 m). */
  drawShadow(ctx: Ctx, car: Car) {
    const s = this.st(car);
    if (s.alt < 1) return;
    const k = JET_SCALE * (1 - 0.0025 * s.alt);
    ctx.save();
    ctx.globalAlpha = FLY.SHADOW_ALPHA * clamp(1 - s.alt / 400, 0, 1);
    ctx.translate(car.pos.x + s.alt * FLY.SHADOW_X * FLY.SCALE, car.pos.y + s.alt * FLY.SHADOW_Y * FLY.SCALE);
    ctx.rotate(car.angle + Math.PI / 2);
    ctx.scale(k, k);
    drawJet(ctx, { wing: s.wing, silhouette: true });
    ctx.restore();
  }

  /**
   * The Jet itself: in the normal car layer while below 20 m (with the soft ground shadow only when it is on the ground), in the HIGH layer
   * (after the bridge, the eruption and all the scenery) above — render.ts decides.
   */
  drawCar(ctx: Ctx, car: Car) {
    const s = this.st(car);
    drawJetSprite(ctx, car.pos.x, car.pos.y, car.angle, { ...this.look(car), shadow: s.alt < 1 });
  }

  /** White trails off the wing tips (in the air, not with prefers-reduced-motion). */
  drawWingTrails(ctx: Ctx, car: Car) {
    const s = this.st(car);
    if (s.alt < 40 || calm()) return;
    const k = JET_SCALE, c = Math.cos(car.angle), n = Math.sin(car.angle);
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

  /**
   * HUD in SCREEN pixels, for the player only. The top left is the race panel, the top right the minimap (`mapBottom` = its lower edge),
   * the top centre the volcano's alert and the bottom right the turbo and speed: the energy bar sits bottom left, the altitude gauge
   * under the minimap, the hints top centre.
   */
  drawHud(ctx: Ctx, car: Car, W: number, H: number, mapBottom: number) {
    const s = this.st(car), ratio = s.energy / FLY.MAX_ENERGY, still = calm();
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
    const chip = (txt: string, x: number, y: number, w: number) => {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.roundRect(x, y, w, 26, 9);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(txt, x + w / 2, y + 18);
      ctx.textAlign = "start";
    };
    const key = touchScreen() ? "VOL" : "SHIFT";
    if (s.mode === "ground" && s.energy >= FLY.MIN_TAKEOFF) chip(`Maintiens ${key} pour voler`, W / 2 - 110, 50, 220);
    if (s.mode === "fly" || s.mode === "takeoff") chip(`${key} : atterrir`, bx, by - 34, 140);
    if (s.warn > 0 && (still || Math.sin(performance.now() / 100) > -0.3)) chip("Zone d'atterrissage", W / 2 - 80, 84, 160);
    ctx.restore();
  }
}
