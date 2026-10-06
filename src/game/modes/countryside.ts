import type { Fx } from "../fx";
import { drift, hash } from "../fx";
import { disc, ellipse, isClear, mulberry32, range, scatter, scatterNear, shadow, TAU, type Circle, type Scene } from "../scenery";
import type { Track, TrackLayout } from "../track";

// Countryside: same circuit as the other modes for now (see docs/decisions.md for the planned
// forest passage). Patchwork fields, hedges, a farm with cows and hay bales.

type Ctx = CanvasRenderingContext2D;

export const layout: TrackLayout = {
  points: [
    [400, 1100], [400, 600], [650, 300], [1100, 280], [1400, 560], [1750, 420],
    [2250, 330], [2700, 560], [2780, 1050], [2450, 1380], [1950, 1250],
    [1550, 1560], [1050, 1760], [600, 1620],
  ],
};

const FIELD_COLORS = [
  { fill: "#6aa84f", stripe: "rgba(255,255,255,0.06)" },
  { fill: "#5e9a45", stripe: "rgba(0,0,0,0.05)" },
  { fill: "#86b85e", stripe: "rgba(255,255,255,0.07)" },
  { fill: "#8b6b4a", stripe: "rgba(60,40,20,0.35)" }, // ploughed
  { fill: "#d8c165", stripe: "rgba(255,240,170,0.45)" }, // wheat
  { fill: "#c9b052", stripe: "rgba(120,100,30,0.25)" }, // stubble
];

function tree(ctx: Ctx, c: Circle) {
  shadow(ctx, c.x + 4, c.y + 4, c.r, c.r * 0.9);
  disc(ctx, c.x, c.y, c.r, "#3e7a35");
  disc(ctx, c.x - c.r * 0.22, c.y - c.r * 0.24, c.r * 0.66, "#559a3f");
  disc(ctx, c.x - c.r * 0.38, c.y - c.r * 0.4, c.r * 0.25, "#73b552");
}

function bale(ctx: Ctx, c: Circle) {
  shadow(ctx, c.x + 2, c.y + 2, c.r);
  disc(ctx, c.x, c.y, c.r, "#e3c35a");
  ctx.strokeStyle = "#b8923a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let a = 0; a < TAU * 2.5; a += 0.3) {
    const r = (a / (TAU * 2.5)) * c.r * 0.9;
    const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
    if (a) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
}

function cow(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ellipse(ctx, 4, 5, 24, 12, 0, "rgba(0,0,0,0.2)");
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.quadraticCurveTo(-30, 4, -32, 0);
  ctx.stroke();
  ellipse(ctx, 0, 0, 22, 11, 0, "#f7f3ea");
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 11, 0, 0, TAU);
  ctx.clip();
  disc(ctx, -8, -5, 7, "#222");
  disc(ctx, 7, 6, 6, "#222");
  disc(ctx, 12, -7, 4, "#222");
  ctx.restore();
  ellipse(ctx, 26, 0, 8, 7, 0, "#f7f3ea");
  ellipse(ctx, 32, 0, 4, 5, 0, "#f0a5a5");
  ellipse(ctx, 23, -8, 4, 2, -0.5, "#222");
  ellipse(ctx, 23, 8, 4, 2, 0.5, "#222");
  ctx.restore();
}

function farm(ctx: Ctx, f: Circle) {
  ellipse(ctx, f.x, f.y, f.r, f.r * 0.8, 0.2, "#b39a70");
  ellipse(ctx, f.x + 20, f.y + 10, f.r * 0.6, f.r * 0.4, 0.2, "#a68c63");
  const building = (dx: number, dy: number, w: number, h: number, rot: number, a: string, bCol: string) => {
    ctx.save();
    ctx.translate(f.x + dx, f.y + dy);
    ctx.rotate(rot);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(-w / 2 + 8, -h / 2 + 8, w, h);
    ctx.fillStyle = a;
    ctx.fillRect(-w / 2, -h / 2, w, h / 2);
    ctx.fillStyle = bCol;
    ctx.fillRect(-w / 2, 0, w, h / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.stroke();
    ctx.restore();
  };
  building(-30, -20, 120, 74, 0.2, "#c0392b", "#962d22"); // barn
  building(70, 55, 70, 52, 0.2, "#7d8a99", "#5f6b78"); // farmhouse
  ctx.fillStyle = "#4b4b4b";
  ctx.fillRect(f.x + 80, f.y + 34, 8, 8); // chimney
  shadow(ctx, f.x + 70, f.y - 70, 22);
  disc(ctx, f.x + 70, f.y - 70, 22, "#b8bec4"); // silo
  disc(ctx, f.x + 70, f.y - 70, 14, "#9aa1a8");
  disc(ctx, f.x + 66, f.y - 74, 5, "#d7dce0");
}

export function scene(track: Track): Scene {
  const rng = mulberry32(2001);
  const b = track.bounds;
  const occ: Circle[] = [];
  const farms = scatter(track, rng, occ, 1, 170, 170);
  const cows = farms.length ? scatterNear(track, rng, occ, 2, farms[0], 120, 30) : [];
  const trees = scatter(track, rng, occ, 70, 18, 30);
  const bales = scatter(track, rng, occ, 16, 9, 12);

  // Patchwork: a jittered grid of quads.
  const cw = 300, ch = 240;
  const cols = Math.ceil((b.maxX - b.minX) / cw) + 1, rows = Math.ceil((b.maxY - b.minY) / ch) + 1;
  const vtx = Array.from({ length: cols + 1 }, (_, i) =>
    Array.from({ length: rows + 1 }, (_, j) => ({
      x: b.minX + (i - 0.5) * cw + range(rng, -0.25, 0.25) * cw,
      y: b.minY + (j - 0.5) * ch + range(rng, -0.25, 0.25) * ch,
    })),
  );
  const fields: { quad: { x: number; y: number }[]; kind: (typeof FIELD_COLORS)[number]; angle: number; gap: number }[] = [];
  const hedges: Circle[] = [];
  const fences: { x: number; y: number }[][] = [];
  const blocked = (x: number, y: number, r: number) => !isClear(track, x, y, r) || farms.some((f) => Math.hypot(f.x - x, f.y - y) < f.r + 30);
  const edge = (a: { x: number; y: number }, c: { x: number; y: number }) => {
    const roll = rng();
    const l = Math.hypot(c.x - a.x, c.y - a.y);
    if (roll < 0.55) {
      for (let t = 0; t <= l; t += 13) {
        const x = a.x + ((c.x - a.x) * t) / l, y = a.y + ((c.y - a.y) * t) / l;
        const r = range(rng, 8, 12);
        if (!blocked(x, y, r)) hedges.push({ x, y, r });
      }
    } else if (roll < 0.8) {
      let run: { x: number; y: number }[] = [];
      for (let t = 0; t <= l; t += 28) {
        const x = a.x + ((c.x - a.x) * t) / l, y = a.y + ((c.y - a.y) * t) / l;
        if (blocked(x, y, 6)) {
          if (run.length > 1) fences.push(run);
          run = [];
        } else run.push({ x, y });
      }
      if (run.length > 1) fences.push(run);
    }
  };
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      fields.push({
        quad: [vtx[i][j], vtx[i + 1][j], vtx[i + 1][j + 1], vtx[i][j + 1]],
        kind: FIELD_COLORS[Math.floor(rng() * FIELD_COLORS.length)],
        angle: rng() * Math.PI,
        gap: range(rng, 9, 14),
      });
      edge(vtx[i + 1][j], vtx[i + 1][j + 1]);
      edge(vtx[i][j + 1], vtx[i + 1][j + 1]);
    }

  return {
    lava: [],
    vents: [],
    under(ctx) {
      for (const f of fields) {
        ctx.save();
        ctx.beginPath();
        f.quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = f.kind.fill;
        ctx.fill();
        ctx.clip();
        const cx = f.quad[0].x, cy = f.quad[0].y;
        ctx.translate(cx, cy);
        ctx.rotate(f.angle);
        ctx.strokeStyle = f.kind.stripe;
        ctx.lineWidth = f.gap * 0.45;
        ctx.beginPath();
        for (let k = -700; k <= 700; k += f.gap) {
          ctx.moveTo(-700, k);
          ctx.lineTo(700, k);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
    over(ctx) {
      const d = mulberry32(2002);
      ctx.lineCap = "round";
      for (const run of fences) {
        ctx.strokeStyle = "#8a6a45";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        run.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        for (const p of run) disc(ctx, p.x, p.y, 3.5, "#6b4f30");
      }
      for (const h of hedges) disc(ctx, h.x + 3, h.y + 4, h.r, "rgba(0,0,0,0.2)");
      for (const h of hedges) disc(ctx, h.x, h.y, h.r, "#2f5d27");
      for (const h of hedges) disc(ctx, h.x - h.r * 0.3, h.y - h.r * 0.3, h.r * 0.5, "#467d36");
      for (const f of farms) farm(ctx, f);
      for (const c of cows) cow(ctx, c, d() * TAU);
      for (const bl of bales) bale(ctx, bl);
      for (const t of trees) tree(ctx, t);
    },
  };
}

export const fx: Fx = {
  screen(ctx, v) {
    // One fill per cloud so overlapping puffs merge instead of stacking alpha.
    const puffs = (x: number, y: number, s: number, i: number, fill: string) => {
      ctx.beginPath();
      for (let p = 0; p < 5; p++) {
        const px = x + (hash(i, p) - 0.5) * 160 * s, py = y + (hash(i, p + 9) - 0.5) * 70 * s, r = (45 + hash(i, p + 20) * 45) * s;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, TAU);
      }
      ctx.fillStyle = fill;
      ctx.fill();
    };
    drift(ctx, v, 7, 21, 1, 24, 7, (x, y, s, i) => puffs(x, y, s, i, "rgba(0,30,0,0.07)")); // cloud shadows
    drift(ctx, v, 7, 22, 1.45, 24, 7, (x, y, s, i) => puffs(x, y, s, i, "rgba(255,255,255,0.22)"));
    ctx.strokeStyle = "rgba(30,30,30,0.75)";
    ctx.lineCap = "round";
    drift(ctx, v, 5, 23, 1.2, 85, -30, (x, y, s, i) => {
      ctx.lineWidth = 2 * s;
      for (let b = 0; b < 5; b++) {
        const bx = x - Math.abs(b - 2) * 16 * s, by = y + (b - 2) * 14 * s;
        const flap = Math.sin(v.t * 9 + i * 2 + b) * 4 * s;
        ctx.beginPath();
        ctx.moveTo(bx - 6 * s, by - 7 * s - flap);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx - 6 * s, by + 7 * s + flap);
        ctx.stroke();
      }
    });
  },
};
