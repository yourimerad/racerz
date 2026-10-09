import { drawFinishLine } from "./finishLine";
import type { Scene } from "./scenery";
import type { Theme } from "./themes";
import type { Track } from "./track";

// The static part of the world (ground, track, props) is painted once per mode into an
// offscreen canvas, then blitted every frame with the camera transform. A mode that defines
// Scene.overhead gets a second, transparent offscreen layer (the covered-section ceiling),
// painted with the exact same transform and blitted after the cars.

type Layer = { id: string; canvas: HTMLCanvasElement };
let cached: Layer | null = null; // one mode at a time keeps memory bounded
let cachedOverhead: Layer | null = null;

/**
 * Canvas size and scale for a track's offscreen layers (pure, no DOM access — also used by
 * scripts/check-tracks.ts to verify the scale without a canvas).
 */
export function layerSize(track: Track) {
  const b = track.bounds;
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  // ~14 Mpx max: sharp enough on HiDPI screens, under mobile canvas limits.
  const s = Math.min(1.5, Math.sqrt(14e6 / (w * h)));
  return { w, h, s, b };
}

function tracePath(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.beginPath();
  track.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function drawTrack(ctx: CanvasRenderingContext2D, track: Track, c: Theme["colors"]) {
  ctx.lineJoin = ctx.lineCap = "round";
  tracePath(ctx, track);
  // Optional dark outline around the kerbs (or straight around the road when kerbWidth is 0).
  if (c.edge) {
    ctx.lineWidth = track.width + c.kerbWidth + c.edge.width * 2;
    ctx.strokeStyle = c.edge.color;
    ctx.stroke();
  }
  ctx.lineWidth = track.width + c.kerbWidth;
  ctx.strokeStyle = c.kerbA;
  ctx.stroke();
  // Same two kerb colors = one solid kerb, no dashes.
  if (c.kerbB !== c.kerbA) {
    ctx.setLineDash([30, 30]);
    ctx.strokeStyle = c.kerbB;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.lineWidth = track.width;
  ctx.strokeStyle = c.asphalt;
  ctx.stroke();
}

function drawMarkings(ctx: CanvasRenderingContext2D, track: Track, c: Theme["colors"], mode: string) {
  if (c.dash) {
    tracePath(ctx, track);
    ctx.lineWidth = 4;
    ctx.setLineDash([40, 40]);
    ctx.strokeStyle = c.dash;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Checkered start/finish line at sample 0, in the mode's own style (purely visual: lap detection is race.ts's).
  const t = track.tangents[0];
  drawFinishLine(ctx, mode, track.path[0].x, track.path[0].y, Math.atan2(t.y, t.x), track.width);
}

/**
 * Barriers: everything at exactly track.barrier from the centerline. Drawn as the ring
 * between two strokes of the centerline (outer minus inner), which stays exact even where
 * a tight corner's radius is smaller than the barrier offset.
 */
function drawBarriers(ctx: CanvasRenderingContext2D, track: Track, c: Theme["colors"], w: number, h: number, s: number) {
  const b = track.bounds;
  const band = document.createElement("canvas");
  band.width = w;
  band.height = h;
  const g = band.getContext("2d");
  if (!g) return;
  g.scale(s, s);
  g.translate(-b.minX, -b.minY);
  g.lineJoin = g.lineCap = "round";
  const thickness = 12;
  tracePath(g, track);
  g.lineWidth = track.barrier * 2 + thickness;
  g.strokeStyle = c.barrierA;
  g.stroke();
  g.setLineDash([22, 26]);
  g.strokeStyle = c.barrierB;
  g.stroke();
  g.setLineDash([]);
  g.globalCompositeOperation = "destination-out";
  g.lineWidth = track.barrier * 2 - thickness;
  g.stroke();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 6 * s;
  ctx.shadowOffsetX = 3 * s;
  ctx.shadowOffsetY = 4 * s;
  ctx.drawImage(band, 0, 0);
  ctx.restore();
}

export function staticLayer(theme: Theme, track: Track, scene: Scene): HTMLCanvasElement {
  if (cached?.id === theme.id) return cached.canvas;
  const { w, h, s, b } = layerSize(track);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * s);
  canvas.height = Math.ceil(h * s);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(s, s);
  ctx.translate(-b.minX, -b.minY);
  ctx.fillStyle = theme.colors.offtrack;
  ctx.fillRect(b.minX, b.minY, w, h);
  scene.under(ctx);
  drawTrack(ctx, track, theme.colors);
  scene.onTrack?.(ctx);
  drawMarkings(ctx, track, theme.colors, theme.id);
  drawBarriers(ctx, track, theme.colors, canvas.width, canvas.height, s);
  scene.over(ctx);
  cached = { id: theme.id, canvas };
  return canvas;
}

/**
 * Ceiling of a mode's covered sections, painted once into its own transparent offscreen
 * layer (same transform/resolution as the static layer). Returns null when the mode has no
 * `scene.overhead`, so a mode without covered sections costs no extra canvas memory.
 */
export function overheadLayer(theme: Theme, track: Track, scene: Scene): HTMLCanvasElement | null {
  if (!scene.overhead) return null;
  if (cachedOverhead?.id === theme.id) return cachedOverhead.canvas;
  const { w, h, s, b } = layerSize(track);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * s);
  canvas.height = Math.ceil(h * s);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(s, s);
  ctx.translate(-b.minX, -b.minY);
  scene.overhead(ctx);
  cachedOverhead = { id: theme.id, canvas };
  return canvas;
}

export { tracePath };
