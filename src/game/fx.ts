import type { Circle, Scene } from "./scenery";
import type { Vec } from "./vec";

// Fx helpers shared by the per-mode files in ./modes. Animated layers are redrawn every
// frame on top of the cached static layer.

type Ctx = CanvasRenderingContext2D;
export type FxView = {
  t: number;
  cam: Vec;
  zoom: number;
  /** Screen size in CSS pixels. */
  sw: number;
  sh: number;
  /** Visible world rectangle. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
export type Fx = {
  /** World space, under skid marks and cars. */
  ground?(ctx: Ctx, scene: Scene, v: FxView): void;
  /** World space, over cars. */
  air?(ctx: Ctx, scene: Scene, v: FxView): void;
  /** Screen space. */
  screen?(ctx: Ctx, v: FxView): void;
};

const TAU = Math.PI * 2;
export const wrap = (v: number, m: number) => ((v % m) + m) % m;
export function hash(i: number, seed: number) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
export const visible = (c: Circle, v: FxView, pad: number) =>
  c.x + c.r + pad > v.minX && c.x - c.r - pad < v.maxX && c.y + c.r + pad > v.minY && c.y - c.r - pad < v.maxY;

/**
 * Stateless particle field: each particle drifts at (vx, vy) inside a tile that wraps around
 * the camera. Parallax k > 1 makes the layer feel closer to the viewer than the ground.
 */
export function drift(
  ctx: Ctx, v: FxView, n: number, seed: number, k: number, vx: number, vy: number,
  draw: (x: number, y: number, s: number, i: number, h: number) => void,
) {
  const tile = (Math.max(v.sw, v.sh) + 300) / v.zoom;
  for (let i = 0; i < n; i++) {
    const h = hash(i, seed + 2);
    const sp = 0.6 + 0.8 * h;
    const x = v.sw / 2 + (wrap(hash(i, seed) * tile + vx * sp * v.t - v.cam.x * k, tile) - tile / 2) * v.zoom;
    const y = v.sh / 2 + (wrap(hash(i, seed + 1) * tile + vy * sp * v.t - v.cam.y * k, tile) - tile / 2) * v.zoom;
    draw(x, y, v.zoom * k, i, h);
  }
}

export function dot(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}
