import { drift, dot, type Fx } from "../fx";
import { disc, ellipse, mulberry32, onTrackPoint, range, scatter, scatterNear, shadow, softBlob, TAU, type Circle, type Scene } from "../scenery";
import type { Track, TrackLayout } from "../track";

// North pole: same circuit as the other modes for now (see docs/decisions.md for the planned
// ice-mountain passage). Igloos, a penguin colony, a polar bear and drifting snow.

type Ctx = CanvasRenderingContext2D;

export const layout: TrackLayout = {
  points: [
    [400, 1100], [400, 600], [650, 300], [1100, 280], [1400, 560], [1750, 420],
    [2250, 330], [2700, 560], [2780, 1050], [2450, 1380], [1950, 1250],
    [1550, 1560], [1050, 1760], [600, 1620],
  ],
};

function fir(ctx: Ctx, c: Circle) {
  shadow(ctx, c.x + 5, c.y + 5, c.r, c.r * 0.9);
  const star = (r: number, fill: string, rot: number) => {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = rot + (i / 16) * TAU, rr = i % 2 ? r * 0.62 : r;
      const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  star(c.r, "#24513d", 0);
  star(c.r * 0.92, "#f4f8fb", 0.15);
  star(c.r * 0.72, "#2f6249", 0.2);
  star(c.r * 0.62, "#f4f8fb", 0.35);
  star(c.r * 0.42, "#3a7457", 0.4);
  disc(ctx, c.x, c.y, c.r * 0.16, "#ffffff");
}

function igloo(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ellipse(ctx, 6, 7, c.r, c.r * 0.92, 0, "rgba(40,70,110,0.22)");
  ctx.beginPath();
  ctx.roundRect(c.r * 0.6, -c.r * 0.32, c.r * 0.7, c.r * 0.64, c.r * 0.3);
  ctx.fillStyle = "#e8f1f8";
  ctx.fill();
  ellipse(ctx, c.r * 1.22, 0, c.r * 0.1, c.r * 0.22, 0, "#2b3a4a");
  const g = ctx.createRadialGradient(-c.r * 0.3, -c.r * 0.3, 0, 0, 0, c.r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#c7dbea");
  disc(ctx, 0, 0, c.r, g);
  ctx.strokeStyle = "rgba(120,160,190,0.55)";
  ctx.lineWidth = 1.5;
  for (const k of [0.4, 0.7]) {
    ctx.beginPath();
    ctx.arc(0, 0, c.r * k, 0, TAU);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + (i % 2) * 0.2;
    ctx.moveTo(Math.cos(a) * c.r * 0.4, Math.sin(a) * c.r * 0.4);
    ctx.lineTo(Math.cos(a) * c.r, Math.sin(a) * c.r);
  }
  ctx.stroke();
  ctx.restore();
}

function iceBlock(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(40,80,120,0.2)";
  ctx.fillRect(-c.r + 5, -c.r + 6, c.r * 2, c.r * 2);
  ctx.fillStyle = "rgba(165,215,242,0.92)";
  ctx.fillRect(-c.r, -c.r, c.r * 2, c.r * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(-c.r, -c.r, c.r * 2, c.r * 0.45);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-c.r, -c.r, c.r * 2, c.r * 2);
  ctx.restore();
}

function penguin(ctx: Ctx, x: number, y: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ellipse(ctx, 3, 4, 9, 11, 0, "rgba(40,70,110,0.25)");
  ellipse(ctx, -4, 9, 3, 2, 0, "#f39c12");
  ellipse(ctx, 4, 9, 3, 2, 0, "#f39c12");
  ellipse(ctx, 0, 0, 8, 11, 0, "#1e2329");
  ellipse(ctx, 0, 2, 5, 8, 0, "#f5f5f0");
  disc(ctx, 0, -8, 5.5, "#1e2329");
  ctx.beginPath();
  ctx.moveTo(-2, -6);
  ctx.lineTo(2, -6);
  ctx.lineTo(0, -1.5);
  ctx.fillStyle = "#f39c12";
  ctx.fill();
  disc(ctx, -2, -9, 1, "#fff");
  disc(ctx, 2, -9, 1, "#fff");
  ctx.restore();
}

function polarBear(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ellipse(ctx, 5, 6, 30, 17, 0, "rgba(40,70,110,0.25)");
  for (const [lx, ly] of [[-16, -14], [-16, 14], [14, -14], [14, 14]]) ellipse(ctx, lx, ly, 7, 5, 0, "#e6dfcc");
  ellipse(ctx, 0, 0, 28, 16, 0, "#f6f2e6");
  disc(ctx, 30, 0, 10, "#f6f2e6");
  disc(ctx, 26, -8, 3.5, "#e6dfcc");
  disc(ctx, 26, 8, 3.5, "#e6dfcc");
  disc(ctx, 39, 0, 2.6, "#1e1e1e");
  disc(ctx, 32, -4, 1.2, "#1e1e1e");
  disc(ctx, 32, 4, 1.2, "#1e1e1e");
  ctx.restore();
}

export function scene(track: Track): Scene {
  const rng = mulberry32(3001);
  const b = track.bounds;
  const occ: Circle[] = [];
  const igloos = scatter(track, rng, occ, 4, 34, 42);
  const colony = igloos.length ? scatterNear(track, rng, occ, 1, igloos[0], 60, 26) : [];
  const bears = scatter(track, rng, occ, 1, 42, 42);
  const firs = scatter(track, rng, occ, 60, 16, 30);
  const blocks = scatter(track, rng, occ, 22, 9, 17);
  const drifts = Array.from({ length: 60 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY),
    rx: range(rng, 120, 380), ry: range(rng, 40, 130), rot: range(rng, -0.6, 0.6), light: rng() < 0.55,
  }));
  const sastrugi = Array.from({ length: 160 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY), len: range(rng, 40, 140), a: range(rng, -0.5, -0.2),
  }));

  return {
    lava: [],
    vents: [],
    under(ctx) {
      for (const d of drifts)
        softBlob(ctx, d.x, d.y, d.rx, d.ry, d.rot, d.light ? "255,255,255" : "170,200,225", d.light ? 0.85 : 0.45);
      ctx.strokeStyle = "rgba(160,190,215,0.45)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const s of sastrugi) {
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(s.a) * s.len, s.y + Math.sin(s.a) * s.len);
      }
      ctx.stroke();
    },
    onTrack(ctx) {
      const d = mulberry32(3002);
      const n = track.path.length;
      ctx.lineCap = "round";
      // Glossy streaks along the direction of travel.
      for (let i = 0; i < 160; i++) {
        const start = Math.floor(d() * n), off = (d() - 0.5) * track.width * 0.85, l = 3 + Math.floor(d() * 8);
        ctx.beginPath();
        for (let k = 0; k <= l; k++) {
          const p = onTrackPoint(track, (start + k) % n, off);
          if (k) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        }
        ctx.strokeStyle = `rgba(255,255,255,${range(d, 0.15, 0.4).toFixed(2)})`;
        ctx.lineWidth = range(d, 2, 6);
        ctx.stroke();
      }
      // Hairline cracks.
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 90; i++) {
        const p = onTrackPoint(track, Math.floor(d() * n), (d() - 0.5) * track.width * 0.8);
        let x = p.x, y = p.y, a = d() * TAU;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          a += range(d, -0.9, 0.9);
          x += Math.cos(a) * range(d, 6, 16);
          y += Math.sin(a) * range(d, 6, 16);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    over(ctx) {
      const d = mulberry32(3003);
      for (const c of blocks) iceBlock(ctx, c, d() * TAU);
      for (const c of igloos) igloo(ctx, c, d() * TAU);
      for (const c of colony) for (let i = 0; i < 3; i++) penguin(ctx, c.x + (i - 1) * 14, c.y + (i % 2) * 10, range(d, -0.4, 0.4));
      for (const c of bears) polarBear(ctx, c, d() * TAU);
      for (const c of firs) fir(ctx, c);
    },
  };
}

export const fx: Fx = {
  screen(ctx, v) {
    const layers = [
      { n: 90, k: 1.1, vy: 45, r: 1.3, a: 0.7 },
      { n: 60, k: 1.35, vy: 75, r: 2.2, a: 0.8 },
      { n: 30, k: 1.7, vy: 110, r: 3.2, a: 0.9 },
    ];
    layers.forEach((l, li) =>
      drift(ctx, v, l.n, 31 + li, l.k, 18, l.vy, (x, y, s, i) => dot(ctx, x + Math.sin(v.t * 1.5 + i) * 10 * s, y, l.r * s, `rgba(255,255,255,${l.a})`)),
    );
  },
};
