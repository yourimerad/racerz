import { locate, type Track } from "./track";
import { vec } from "./vec";

// Static scenery for each environment mode. Everything is generated from a fixed seed,
// so a mode always looks the same, and every prop is kept clear of the asphalt.

type Ctx = CanvasRenderingContext2D;
export type Rng = () => number;
export type Circle = { x: number; y: number; r: number };

export type Scene = {
  /** Lava pools (volcano only): driving into one is the "lava" surface. */
  lava: Circle[];
  /** Smoke sources for the animated layer. */
  vents: Circle[];
  /** Ground painted under the track. */
  under(ctx: Ctx): void;
  /** Texture painted over the asphalt (dust, ice streaks…). */
  onTrack?(ctx: Ctx): void;
  /** Props painted after the track. */
  over(ctx: Ctx): void;
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

const TAU = Math.PI * 2;
/** Clearance between a prop's radius and the track edge (kerbs included). */
const MARGIN = 30;
const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

function isClear(track: Track, x: number, y: number, r: number) {
  return locate(track, vec(x, y)).dist > track.width / 2 + MARGIN + r;
}

function overlaps(occ: Circle[], x: number, y: number, r: number) {
  return occ.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r) ** 2);
}

/** Rejection-sample up to n free spots off the track; accepted spots are added to occ. */
function scatter(track: Track, rng: Rng, occ: Circle[], n: number, rMin: number, rMax: number): Circle[] {
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
function scatterNear(track: Track, rng: Rng, occ: Circle[], n: number, c: Circle, spread: number, r: number): Circle[] {
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

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ellipse(ctx, x, y, r, r, 0, fill);
}

/** Soft cast shadow, offset toward the bottom-right (sun top-left). */
function shadow(ctx: Ctx, x: number, y: number, rx: number, ry = rx) {
  ellipse(ctx, x + rx * 0.3, y + ry * 0.35, rx, ry, 0, "rgba(0,0,0,0.22)");
}

/** Radial fade from rgb at `alpha` to the same rgb fully transparent (fading to black would grey it). */
function softBlob(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, rgb: string, alpha: number) {
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

function rock(ctx: Ctx, rng: Rng, c: Circle, base: string, light: string) {
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
function onTrackPoint(track: Track, i: number, offset: number) {
  const p = track.path[i], t = track.tangents[i];
  return { x: p.x - t.y * offset, y: p.y + t.x * offset, a: Math.atan2(t.y, t.x) };
}

// ---------- desert ----------

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

function desert(track: Track): Scene {
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

// ---------- countryside ----------

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

function countryside(track: Track): Scene {
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

// ---------- north pole ----------

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

function northPole(track: Track): Scene {
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

// ---------- volcano ----------

function volcano(track: Track): Scene {
  const rng = mulberry32(4001);
  const b = track.bounds;
  const occ: Circle[] = [];
  const lava: Circle[] = [];

  // The crater sits on a stretch of the circuit, so the road crosses it with lava on both sides.
  const cp = track.path[460]; // middle of the long bottom straight
  const crater = { x: cp.x, y: cp.y, r: 340 };
  for (let i = 0; i < 900 && lava.length < 26; i++) {
    const a = rng() * TAU, dd = Math.sqrt(rng()) * (crater.r - 40), r = range(rng, 24, 62);
    const x = crater.x + Math.cos(a) * dd, y = crater.y + Math.sin(a) * dd;
    if (dd + r < crater.r - 20 && isClear(track, x, y, r)) lava.push({ x, y, r });
  }
  // Lava rivers: meandering chains of discs that stop before reaching the track.
  for (let k = 0; k < 4; k++) {
    const [start] = scatter(track, rng, [], 1, 34, 34);
    if (!start) continue;
    let { x, y } = start, a = rng() * TAU;
    for (let s = 0; s < 30; s++) {
      const r = range(rng, 20, 32);
      if (!isClear(track, x, y, r) || x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) break;
      lava.push({ x, y, r });
      a += range(rng, -0.5, 0.5);
      x += Math.cos(a) * 30;
      y += Math.sin(a) * 30;
    }
  }
  lava.push(...scatter(track, rng, [crater, ...lava], 6, 36, 70));
  occ.push(crater, ...lava);
  const vents = [{ ...crater, r: 120 }, ...lava.filter((_, i) => i % 9 === 0).map((l) => ({ ...l }))];
  const rocks = scatter(track, rng, occ, 55, 8, 26);
  const ash = Array.from({ length: 50 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY),
    rx: range(rng, 120, 360), ry: range(rng, 50, 160), rot: rng() * Math.PI,
  }));
  const cracks = Array.from({ length: 70 }, () => ({ x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY), a: rng() * TAU }));

  return {
    lava,
    vents,
    under(ctx) {
      const d = mulberry32(4002);
      for (const a of ash) softBlob(ctx, a.x, a.y, a.rx, a.ry, a.rot, "105,95,92", 0.45);
      ctx.lineCap = "round";
      for (const c of cracks) {
        let { x, y, a } = c;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          a += range(d, -0.7, 0.7);
          x += Math.cos(a) * range(d, 15, 40);
          y += Math.sin(a) * range(d, 15, 40);
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(10,5,5,0.6)";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,90,20,0.35)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // Crater: raised rim, dark scorched floor.
      disc(ctx, crater.x, crater.y, crater.r + 70, "#3b2e2a");
      const g = ctx.createRadialGradient(crater.x, crater.y, crater.r * 0.2, crater.x, crater.y, crater.r + 10);
      g.addColorStop(0, "#2a1210");
      g.addColorStop(0.85, "#1a0f0e");
      g.addColorStop(1, "#5a2414");
      disc(ctx, crater.x, crater.y, crater.r + 10, g);
      ctx.strokeStyle = "#55443d";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(crater.x, crater.y, crater.r + 40, 0, TAU);
      ctx.stroke();
      // Dim lava base; the bright pulsing glow is the animated layer.
      for (const l of lava) disc(ctx, l.x, l.y, l.r + 6, "#3a1408");
      for (const l of lava) disc(ctx, l.x, l.y, l.r, "#9a2a08");
      for (const l of lava) for (let k = 0; k < 3; k++) disc(ctx, l.x + range(d, -0.5, 0.5) * l.r, l.y + range(d, -0.5, 0.5) * l.r, l.r * range(d, 0.12, 0.25), "rgba(40,12,6,0.7)");
    },
    onTrack(ctx) {
      const d = mulberry32(4003);
      const n = track.path.length;
      for (let i = 0; i < 1800; i++) {
        const p = onTrackPoint(track, Math.floor(d() * n), (d() - 0.5) * track.width * 0.96);
        disc(ctx, p.x, p.y, range(d, 1, 3), `rgba(150,140,135,${range(d, 0.12, 0.3).toFixed(2)})`);
      }
    },
    over(ctx) {
      const d = mulberry32(4004);
      for (const r of rocks) rock(ctx, d, r, "#2e2826", "#5a4a44");
    },
  };
}

export const SCENES = { desert, countryside, northpole: northPole, volcano };
