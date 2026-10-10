import { type ModelId, type Profile, type SkinId, skinFits } from "./garage";

// The pure part of the 3D garage (the lobby's showroom): what the stage shows, how its camera turns, and a small cache. No Three.js and no
// React here, so `pnpm check:garage` can test all of it without a GL context.

export type StageChoice = {
  model: ModelId;
  skin: SkinId;
  /** The stage shows something the player has not equipped: a car or a skin being looked at (hovered, or tapped in the list). */
  preview: boolean;
};

/**
 * What the stage shows. The equipped car in its paint by default; a car hovered or tapped in the list takes its place; a skin hovered in the
 * shop is tried on the equipped car (the shop is always for that one), bought or not.
 */
export function stageChoice(p: Profile, o: { hoverCar?: ModelId | null; focusCar?: ModelId | null; hoverSkin?: SkinId | null }): StageChoice {
  const model = o.hoverSkin ? p.selected : o.hoverCar ?? o.focusCar ?? p.selected;
  const owned = p.cars[model];
  const equipped: SkinId = owned && skinFits(model, owned.skin) ? owned.skin : "factory";
  if (o.hoverSkin && skinFits(model, o.hoverSkin)) return { model, skin: o.hoverSkin, preview: o.hoverSkin !== equipped };
  return { model, skin: equipped, preview: model !== p.selected };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The turntable's view: the car turns by `yaw` under a fixed camera that sits `dist` metres away, `pitch` radians above the horizon. It turns by
 * itself, slowly, until the player takes hold of it; a flick keeps turning a little (inertia), and it goes back to its own pace 1.5 s after
 * the player lets go.
 */
export class Orbit {
  yaw = -0.62;
  pitch = 0.2;
  dist = 12;
  private spin = 0;
  private held = false;
  private since = 99;

  /** Rad/s of the idle turn. */
  static readonly AUTO = 0.32;
  static readonly PITCH_MIN = 0.04;
  static readonly PITCH_MAX = 0.55;

  /** The player takes hold of the car. */
  grab() {
    this.held = true;
    this.spin = 0;
  }

  /** Dragged by (dx, dy) pixels over `dt` seconds. */
  drag(dx: number, dy: number, dt: number) {
    if (!this.held) return;
    this.yaw += dx * 0.0085;
    this.pitch = clamp(this.pitch + dy * 0.004, Orbit.PITCH_MIN, Orbit.PITCH_MAX);
    if (dt > 0) this.spin += (((dx * 0.0085) / dt) - this.spin) * 0.5;
  }

  release() {
    this.held = false;
    this.since = 0;
  }

  get isHeld() {
    return this.held;
  }

  /** One frame: inertia after a flick, then the idle turn (unless it is held or the screen asks for no motion). */
  update(dt: number, auto: boolean, wantDist: number) {
    if (!this.held) {
      this.since += dt;
      this.yaw += this.spin * dt;
      this.spin *= Math.exp(-3 * dt);
      if (auto && this.since > 1.5) this.yaw += Orbit.AUTO * Math.min(1, (this.since - 1.5) / 1.5) * dt;
    }
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 4);
    if (this.yaw > Math.PI * 2 || this.yaw < -Math.PI * 2) this.yaw %= Math.PI * 2;
  }

  /** Camera position for a target at (0, ty, 0). */
  position(ty: number): [number, number, number] {
    return [0, ty + this.dist * Math.sin(this.pitch), this.dist * Math.cos(this.pitch)];
  }

  /** Distance at which a sphere of `radius` fits the view (vertical field of view in degrees, width / height), with a margin (1.3 = 30 % to spare). */
  static fit(radius: number, fovDeg: number, aspect: number, margin = 1.3): number {
    const v = (fovDeg * Math.PI) / 360, h = Math.atan(Math.tan(v) * Math.max(0.2, aspect));
    return (radius * margin) / Math.sin(Math.min(v, h));
  }
}

/** Half the length of the car, rounded up (a turntable turns it, so this is the radius that must fit); the Jet's wings add to it as they open. */
export function carRadius(model: ModelId, wing = 0): number {
  if (model === "jet") return 2.9 + 1.0 * clamp(wing, 0, 1);
  return model === "aventador" ? 2.55 : 2.4;
}

/** The wings' opening at `t` seconds for the Jet on the stage: open for 3 s, folded for 3 s, and so on; 0 for a screen that asks for no motion. */
export function stageWing(t: number, still: boolean): number {
  if (still) return 0;
  const k = t % 6;
  if (k < 0.6) return k / 0.6;
  if (k < 3) return 1;
  if (k < 3.6) return 1 - (k - 3) / 0.6;
  return 0;
}

/** A cache of at most `max` values, the least recently used one going first (never one `keep` returns true for); `onEvict` frees it. */
export class Lru<V> {
  private map = new Map<string, V>();
  private max: number;
  private onEvict: (key: string, v: V) => void;
  private keep: (v: V) => boolean;

  constructor(max: number, onEvict: (key: string, v: V) => void, keep: (v: V) => boolean = () => false) {
    this.max = max;
    this.onEvict = onEvict;
    this.keep = keep;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, v: V) {
    this.map.delete(key);
    this.map.set(key, v);
    for (const [k, old] of this.map) {
      if (this.map.size <= this.max) break;
      if (k === key || this.keep(old)) continue;
      this.map.delete(k);
      this.onEvict(k, old);
    }
  }

  get size() {
    return this.map.size;
  }

  /** Empties the cache, freeing every value. */
  clear() {
    for (const [k, v] of this.map) this.onEvict(k, v);
    this.map.clear();
  }
}

/** The cache key of a car in a paint. */
export const carKey = (model: ModelId, skin: { name: string; body: string; accent: string; pattern?: string; matte?: boolean }) =>
  `${model}|${skin.name}|${skin.body}|${skin.accent}|${skin.pattern ?? ""}|${skin.matte ? 1 : 0}`;
