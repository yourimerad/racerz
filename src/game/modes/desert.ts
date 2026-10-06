import { drift, dot, type Fx } from "../fx";
import { disc, ellipse, mulberry32, onTrackPoint, range, rock, scatter, shadow, softBlob, TAU, type Circle, type Scene } from "../scenery";
import type { Track, TrackLayout } from "../track";

// Desert: same circuit as the other modes for now (see docs/decisions.md for the planned
// canyon passage). Dunes, an oasis, cacti and sun-bleached skulls beyond the barriers.

type Ctx = CanvasRenderingContext2D;

export const layout: TrackLayout = {
  points: [
    [400, 1100], [400, 600], [650, 300], [1100, 280], [1400, 560], [1750, 420],
    [2250, 330], [2700, 560], [2780, 1050], [2450, 1380], [1950, 1250],
    [1550, 1560], [1050, 1760], [600, 1620],
  ],
};

function cactus(ctx: Ctx, c: Circle) {
  const s = c.r / 18, x = c.x, y = c.y;
  ellipse(ctx, x + 16 * s, y + 4 * s, 22 * s, 6 * s, 0.2, "rgba(0,0,0,0.22)");
  ctx.fillStyle = "#4c9a4f";
  ctx.strokeStyle = "#2f6e35";
  ctx.lineWidth = 2 * s;
  const part = (px: number, py: number, w: number, h: number) => {
    ctx.beginPath();
    ctx.roundRect(x + px * s, y + py * s, w * s, h * s, (w / 2) * s);
    ctx.fill();
    ctx.stroke();
  };
  part(-16, -30, 7, 18);
  part(-16, -17, 14, 6);
  part(9, -38, 7, 20);
  part(3, -22, 13, 6);
  part(-6, -46, 12, 46);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(x - 2 * s, y - 42 * s);
  ctx.lineTo(x - 2 * s, y - 4 * s);
  ctx.stroke();
}

function skull(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ctx.strokeStyle = "#e9dfc8";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-5, -4);
  ctx.quadraticCurveTo(-16, -8, -14, -18);
  ctx.moveTo(5, -4);
  ctx.quadraticCurveTo(16, -8, 14, -18);
  ctx.stroke();
  ellipse(ctx, 0, 0, 7, 6, 0, "#f1e9d6");
  ellipse(ctx, 0, 8, 4, 6, 0, "#f1e9d6");
  disc(ctx, -3, -1, 1.8, "#3b2f25");
  disc(ctx, 3, -1, 1.8, "#3b2f25");
  ctx.restore();
}

function palm(ctx: Ctx, x: number, y: number, s: number, rot: number) {
  shadow(ctx, x + 8 * s, y + 8 * s, 30 * s, 26 * s);
  for (let i = 0; i < 7; i++) {
    const a = rot + (i / 7) * TAU;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(18 * s, -9 * s, 36 * s, 2 * s);
    ctx.quadraticCurveTo(18 * s, 5 * s, 0, 0);
    ctx.fillStyle = i % 2 ? "#3f8a3a" : "#5fae4a";
    ctx.fill();
    ctx.restore();
  }
  disc(ctx, x, y, 5 * s, "#7a5230");
  disc(ctx, x + 3 * s, y - 2 * s, 2.5 * s, "#5a3a1e");
  disc(ctx, x - 3 * s, y + 2 * s, 2.5 * s, "#5a3a1e");
}

export function scene(track: Track): Scene {
  const rng = mulberry32(1001);
  const b = track.bounds;
  const occ: Circle[] = [];
  const oasis = scatter(track, rng, occ, 1, 150, 150);
  const rocks = scatter(track, rng, occ, 45, 9, 30);
  const cacti = scatter(track, rng, occ, 40, 14, 22);
  const skulls = scatter(track, rng, occ, 8, 14, 14);
  const dunes = Array.from({ length: 34 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY),
    rx: range(rng, 220, 520), ry: range(rng, 90, 220), rot: range(rng, -0.4, 0.4), light: rng() < 0.5,
  }));
  const ripples = Array.from({ length: 220 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY),
    len: range(rng, 160, 520), amp: range(rng, 5, 14), f: range(rng, 0.012, 0.03), ph: rng() * TAU,
  }));

  return {
    lava: [],
    vents: [],
    under(ctx) {
      for (const d of dunes)
        softBlob(ctx, d.x, d.y, d.rx, d.ry, d.rot, d.light ? "255,236,190" : "150,100,50", d.light ? 0.45 : 0.22);
      ctx.lineCap = "round";
      for (const r of ripples) {
        for (const [dy, color, w] of [[0, "rgba(255,242,210,0.45)", 3], [5, "rgba(150,105,55,0.28)", 2]] as const) {
          ctx.beginPath();
          for (let x = 0; x <= r.len; x += 12) {
            const px = r.x + x, py = r.y + dy + Math.sin(x * r.f + r.ph) * r.amp;
            if (x) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = w;
          ctx.stroke();
        }
      }
    },
    onTrack(ctx) {
      const d = mulberry32(1002);
      const n = track.path.length;
      // Wind-blown sand drifts and dust speckles washing out the asphalt.
      for (let i = 0; i < 40; i++) {
        const p = onTrackPoint(track, Math.floor(d() * n), (d() - 0.5) * track.width * 0.7);
        softBlob(ctx, p.x, p.y, range(d, 50, 110), range(d, 14, 30), p.a, "222,190,135", 0.55);
      }
      for (let i = 0; i < 2600; i++) {
        const p = onTrackPoint(track, Math.floor(d() * n), (d() - 0.5) * track.width * 0.96);
        disc(ctx, p.x, p.y, range(d, 1, 3.5), `rgba(230,205,160,${range(d, 0.15, 0.4).toFixed(2)})`);
      }
    },
    over(ctx) {
      const d = mulberry32(1003);
      for (const o of oasis) {
        ellipse(ctx, o.x, o.y, o.r, o.r * 0.68, 0, "#c7a25c");
        ellipse(ctx, o.x, o.y, o.r * 0.85, o.r * 0.56, 0, "#7fa84b");
        ellipse(ctx, o.x, o.y, o.r * 0.58, o.r * 0.36, 0, "#2f9cc4");
        ellipse(ctx, o.x - o.r * 0.12, o.y - o.r * 0.08, o.r * 0.32, o.r * 0.14, 0, "rgba(200,240,255,0.35)");
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + d() * 0.4;
          palm(ctx, o.x + Math.cos(a) * o.r * 0.74, o.y + Math.sin(a) * o.r * 0.47, range(d, 0.85, 1.15), d() * TAU);
        }
      }
      for (const r of rocks) rock(ctx, d, r, "#a07850", "#c49a6c");
      for (const s of skulls) skull(ctx, s, d() * TAU);
      for (const c of [...cacti].sort((a, b) => a.y - b.y)) cactus(ctx, c);
    },
  };
}

export const fx: Fx = {
  screen(ctx, v) {
    drift(ctx, v, 110, 11, 1, 90, 14, (x, y, s, _i, h) => dot(ctx, x, y, (1.5 + 2.5 * h) * s, `rgba(235,210,160,${(0.2 + 0.3 * h).toFixed(2)})`));
    // Long wind-blown wisps.
    ctx.lineCap = "round";
    drift(ctx, v, 16, 12, 1.05, 150, 22, (x, y, s, i, h) => {
      ctx.strokeStyle = `rgba(245,225,185,${(0.08 + 0.1 * h).toFixed(2)})`;
      ctx.lineWidth = (6 + 8 * h) * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 60 * s, y + Math.sin(v.t + i) * 14 * s, x + 140 * s, y + 18 * s);
      ctx.stroke();
    });
  },
};
