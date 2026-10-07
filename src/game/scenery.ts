import { locate, type Track } from "./track";
import { vec } from "./vec";

// Scenery helpers shared by the per-mode files in ./modes. Everything is generated from a
// fixed seed, so a mode always looks the same; props stay beyond the barriers, lava stops at
// the kerbs.

type Ctx = CanvasRenderingContext2D;
export type Rng = () => number;
export type Circle = { x: number; y: number; r: number };

export type Scene = {
  /** Lava pools (volcano only): driving into one is the "lava" surface. */
  lava: Circle[];
  /** Smoke sources for the animated layer. */
  vents: Circle[];
  /** Solid round obstacles inside the barriers (hay bales…): cars bounce off them hard. */
  bumpers?: Circle[];
  /** Ground painted under the track. */
  under(ctx: Ctx): void;
  /** Texture painted over the asphalt (dust, ice streaks…). */
  onTrack?(ctx: Ctx): void;
  /** Props painted after the track. */
  over(ctx: Ctx): void;
  /**
   * Ceiling of a covered section (tunnel roof, crater rim seen from inside…), painted once
   * into its own offscreen layer and blitted after the cars so it can fade out over the player.
   */
  overhead?(ctx: Ctx): void;
};

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;
/** Gap kept between anything and the barriers / kerbs. */
const MARGIN = 14;
export const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

/** Props stay beyond the barriers. */
export function isClear(track: Track, x: number, y: number, r: number) {
  return locate(track, vec(x, y)).dist > track.barrier + MARGIN + r;
}

/** Lava may reach into the runoff, right up to the kerbs. */
export function lavaClear(track: Track, x: number, y: number, r: number) {
  return locate(track, vec(x, y)).dist > track.width / 2 + MARGIN + r;
}

function overlaps(occ: Circle[], x: number, y: number, r: number) {
  return occ.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r) ** 2);
}

/** Rejection-sample up to n free spots off the track; accepted spots are added to occ. */
export function scatter(track: Track, rng: Rng, occ: Circle[], n: number, rMin: number, rMax: number): Circle[] {
  const b = track.bounds;
  const out: Circle[] = [];
  for (let i = 0; i < n * 40 && out.length < n; i++) {
    const r = range(rng, rMin, rMax);
    const x = range(rng, b.minX + r, b.maxX - r);
    const y = range(rng, b.minY + r, b.maxY - r);
    if (!isClear(track, x, y, r) || overlaps(occ, x, y, r)) continue;
    const c = { x, y, r };
    out.push(c);
    occ.push(c);
  }
  return out;
}

/** Same, but in a ring around a center (cows by the barn, penguins by an igloo). */
export function scatterNear(track: Track, rng: Rng, occ: Circle[], n: number, c: Circle, spread: number, r: number): Circle[] {
  const out: Circle[] = [];
  for (let i = 0; i < n * 40 && out.length < n; i++) {
    const a = rng() * TAU, d = c.r + r + rng() * spread;
    const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
    if (!isClear(track, x, y, r) || overlaps(occ, x, y, r)) continue;
    const p = { x, y, r };
    out.push(p);
    occ.push(p);
  }
  return out;
}

// ---------- drawing helpers ----------

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function disc(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ellipse(ctx, x, y, r, r, 0, fill);
}

/** Soft cast shadow, offset toward the bottom-right (sun top-left). */
export function shadow(ctx: Ctx, x: number, y: number, rx: number, ry = rx) {
  ellipse(ctx, x + rx * 0.3, y + ry * 0.35, rx, ry, 0, "rgba(0,0,0,0.22)");
}

/** Radial fade from rgb at `alpha` to the same rgb fully transparent (fading to black would grey it). */
export function softBlob(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, rgb: string, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  disc(ctx, 0, 0, rx, g);
  ctx.restore();
}

export function rock(ctx: Ctx, rng: Rng, c: Circle, base: string, light: string) {
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * TAU + range(rng, -0.3, 0.3);
    const r = c.r * range(rng, 0.7, 1);
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  const poly = (dx: number, dy: number, s: number) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(c.x + dx + x * s, c.y + dy + y * s) : ctx.moveTo(c.x + dx + x * s, c.y + dy + y * s)));
    ctx.closePath();
  };
  poly(c.r * 0.25, c.r * 0.3, 1);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();
  poly(0, 0, 1);
  ctx.fillStyle = base;
  ctx.fill();
  poly(-c.r * 0.2, -c.r * 0.22, 0.5);
  ctx.fillStyle = light;
  ctx.fill();
}

/** Point on the centerline shifted sideways (positive = right of travel). */
export function onTrackPoint(track: Track, i: number, offset: number) {
  const p = track.path[i], t = track.tangents[i];
  return { x: p.x - t.y * offset, y: p.y + t.x * offset, a: Math.atan2(t.y, t.x) };
}

