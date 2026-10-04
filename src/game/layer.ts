import type { Scene } from "./scenery";
import type { Theme } from "./themes";
import type { Track } from "./track";

// The static part of the world (ground, track, props) is painted once per mode into an
// offscreen canvas, then blitted every frame with the camera transform.

type Layer = { id: string; canvas: HTMLCanvasElement };
let cached: Layer | null = null; // one mode at a time keeps memory bounded

function tracePath(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.beginPath();
  track.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function drawTrack(ctx: CanvasRenderingContext2D, track: Track, c: Theme["colors"]) {
  ctx.lineJoin = ctx.lineCap = "round";
  tracePath(ctx, track);
  ctx.lineWidth = track.width + c.kerbWidth;
  ctx.strokeStyle = c.kerbA;
  ctx.stroke();
  ctx.setLineDash([30, 30]);
  ctx.strokeStyle = c.kerbB;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = track.width;
  ctx.strokeStyle = c.asphalt;
  ctx.stroke();
}

function drawMarkings(ctx: CanvasRenderingContext2D, track: Track, c: Theme["colors"]) {
  tracePath(ctx, track);
  ctx.lineWidth = 4;
  ctx.setLineDash([40, 40]);
  ctx.strokeStyle = c.dash;
  ctx.stroke();
  ctx.setLineDash([]);

  // Checkered start/finish line at sample 0.
  const p = track.path[0], t = track.tangents[0];
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(t.y, t.x));
  const sq = 12, rows = Math.ceil(track.width / sq);
  for (let col = 0; col < 2; col++)
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = (r + col) % 2 ? "#111" : "#fff";
      ctx.fillRect(col * sq - sq, -track.width / 2 + r * sq, sq, sq);
    }
  ctx.restore();
}

export function staticLayer(theme: Theme, track: Track, scene: Scene): HTMLCanvasElement {
  if (cached?.id === theme.id) return cached.canvas;
  const b = track.bounds;
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  // ~14 Mpx max: sharp enough on HiDPI screens, under mobile canvas limits.
  const s = Math.min(1.5, Math.sqrt(14e6 / (w * h)));
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
  drawMarkings(ctx, track, theme.colors);
  scene.over(ctx);
  cached = { id: theme.id, canvas };
  return canvas;
}

export { tracePath };
