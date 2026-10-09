import { dot, type Fx } from "../fx";
import { disc, mulberry32, range, rock, scatter, TAU, type Circle, type Rng, type Scene, softBlob } from "../scenery";
import type { Track, TrackLayout } from "../track";

// Volcano: one big cone in the middle of the map, seen from above with the sun at the top-left.
// Three rings of black rock (irregular outlines, lit on the upper-left, shaded on the lower-right)
// climb to a crater whose lava lake is purely decorative. The circuit enters at the bottom, climbs
// the cone's east flank, skirts the crater along its right-hand rim and leaves by the top, then
// loops back round the west side of the map. The only lava anywhere is the lake and two small
// pools in opposite corners of the terrain.

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

/** The volcano (centre of the cone and crater). */
const CONE = { x: 1500, y: 1150 };
/** Radii: three rock rings, crater lip, inner wall, lava lake. */
const RING_R = [620, 480, 340] as const;
const LIP_R = 215, WALL_R = 190, LAKE_R = 150;

export const layout: TrackLayout = {
  points: [
    [1880, 1950], [1930, 1600], [1880, 1200], [1930, 900], [1830, 600],
    [1600, 360], [1200, 220], [720, 330], [380, 660], [250, 1150],
    [330, 1650], [680, 2000], [1100, 2180], [1500, 2030],
  ],
};

const COL = {
  rings: ["#3a302d", "#4a3a34", "#5c453c"],
  light: ["#7a6256", "#8a7062", "#9a8070"],
  dark: "#150f0d",
  lip: "#7a5a4a", lipLight: "#a08672", wall: "#3a1a14",
  lake: ["#9a2a12", "#e8461a", "#ff8a24", "#ffd45a"], crust: "#4a1810",
  poolRim: "#5a1a10", poolCore: "#ff6a1f", block: "#1e1715", shadow: "#120d0c",
};

/**
 * An irregular closed outline around (cx, cy): a few low harmonics (shared by every ring built
 * from the same `seed`, so nested rings never cross) plus a little per-vertex jitter.
 */
function outline(cx: number, cy: number, r: number, seed: number, rough = 0.07, jitterSeed = seed + 1): Pt[] {
  const rng = mulberry32(seed), jit = mulberry32(jitterSeed);
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
  const n = 72;
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU;
    const f = 1 + rough * (0.55 * Math.sin(2 * a + ph[0]) + 0.3 * Math.sin(4 * a + ph[1]) + 0.15 * Math.sin(7 * a + ph[2])) + (jit() - 0.5) * rough * 0.5;
    out.push([cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f]);
  }
  return out;
}

function path(ctx: Ctx, pts: Pt[], dx = 0, dy = 0) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
  ctx.closePath();
}

function rgba(hex: string, a: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
}

/** Top-left → bottom-right gradient spanning an outline's bounding box. */
function diagonal(ctx: Ctx, pts: Pt[]) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/** Light edge on the upper-left of an outline, dark edge (5 px) on the lower-right. */
function litEdge(ctx: Ctx, pts: Pt[], light: string) {
  ctx.lineJoin = "round";
  const lit = diagonal(ctx, pts);
  lit.addColorStop(0, rgba(light, 1));
  lit.addColorStop(0.5, rgba(light, 0));
  path(ctx, pts);
  ctx.lineWidth = 4;
  ctx.strokeStyle = lit;
  ctx.stroke();
  const shade = diagonal(ctx, pts);
  shade.addColorStop(0.5, rgba(COL.dark, 0));
  shade.addColorStop(1, rgba(COL.dark, 1));
  ctx.lineWidth = 5;
  ctx.strokeStyle = shade;
  ctx.stroke();
}

/** A small lava pool: dark rim and a glowing core. */
function pool(ctx: Ctx, x: number, y: number, r: number, seed: number) {
  path(ctx, outline(x, y, r, seed, 0.18));
  ctx.fillStyle = COL.poolRim;
  ctx.fill();
  path(ctx, outline(x + r * 0.04, y + r * 0.05, r * 0.45, seed + 7, 0.2));
  ctx.fillStyle = COL.poolCore;
  ctx.fill();
}

/** The crater: rim, lit inner wall, then a lava lake in four layers with cooled crust. */
function crater(ctx: Ctx) {
  const { x, y } = CONE;
  const lip = outline(x, y, LIP_R, 31, 0.05), wall = outline(x, y, WALL_R, 31, 0.05, 33);
  // Faint orange glow of the lake on the surrounding rock.
  const glow = ctx.createRadialGradient(x, y, LIP_R * 0.8, x, y, LIP_R + 190);
  glow.addColorStop(0, "rgba(255,106,31,0.1)");
  glow.addColorStop(1, "rgba(255,106,31,0)");
  disc(ctx, x, y, LIP_R + 190, glow);

  path(ctx, lip);
  ctx.fillStyle = COL.lip;
  ctx.fill();
  litEdge(ctx, lip, COL.lipLight);

  // Inner wall: darker on the upper-left, lit by the lava on the lower-right.
  path(ctx, wall);
  ctx.fillStyle = COL.wall;
  ctx.fill();
  const lit = diagonal(ctx, wall);
  lit.addColorStop(0, "rgba(0,0,0,0.45)");
  lit.addColorStop(0.5, "rgba(0,0,0,0)");
  lit.addColorStop(1, "rgba(255,106,31,0.4)");
  path(ctx, wall);
  ctx.fillStyle = lit;
  ctx.fill();

  // Lava lake: four nested layers, each a little off-centre and irregular.
  const layers = [LAKE_R, LAKE_R * 0.82, LAKE_R * 0.61, LAKE_R * 0.35];
  layers.forEach((r, i) => {
    path(ctx, outline(x + i * 2, y + i * 3, r, 31, 0.05, 40 + i));
    ctx.fillStyle = COL.lake[i];
    ctx.fill();
  });
  // Plates of cooled crust drifting on the rim of the lake (kept inside the outer layer).
  const rng = mulberry32(55);
  ctx.save();
  path(ctx, outline(x, y, LAKE_R, 31, 0.05, 40));
  ctx.clip();
  for (let i = 0; i < 6; i++) {
    const a = rng() * TAU, d = range(rng, LAKE_R * 0.62, LAKE_R * 0.98);
    path(ctx, outline(x + Math.cos(a) * d, y + Math.sin(a) * d, range(rng, 12, 26), 60 + i, 0.3));
    ctx.fillStyle = COL.crust;
    ctx.fill();
  }
  ctx.restore();
}

export function scene(track: Track): Scene {
  const rng = mulberry32(4001);
  const b = track.bounds;
  const corner = 190;
  const pools: Circle[] = [
    { x: b.minX + corner, y: b.minY + corner, r: 80 },
    { x: b.maxX - corner, y: b.maxY - corner, r: 70 },
  ];
  const occ: Circle[] = [{ x: CONE.x, y: CONE.y, r: RING_R[0] + 30 }, ...pools.map((p) => ({ ...p, r: p.r + 30 }))];
  const blocks = scatter(track, rng, occ, 46, 10, 30);
  const ash = Array.from({ length: 50 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY),
    rx: range(rng, 120, 360), ry: range(rng, 50, 160), rot: rng() * Math.PI,
  }));
  const rings = RING_R.map((r, i) => outline(CONE.x, CONE.y, r, 21, 0.07, 22 + i * 3));

  return {
    lava: [], // the lake is decoration only: nothing slows the car
    vents: [],
    under(ctx) {
      for (const a of ash) softBlob(ctx, a.x, a.y, a.rx, a.ry, a.rot, "105,95,92", 0.3);
      for (const [i, p] of pools.entries()) pool(ctx, p.x, p.y, p.r, 7 + i * 5);

      // The cone casts a shadow on the ground, offset toward the lower-right.
      ctx.globalAlpha = 0.45;
      path(ctx, rings[0], 18, 20);
      ctx.fillStyle = COL.shadow;
      ctx.fill();
      ctx.globalAlpha = 1;

      rings.forEach((ring, i) => {
        path(ctx, ring);
        ctx.fillStyle = COL.rings[i];
        ctx.fill();
      });
      // Volume over the whole cone: light from the top-left, shade toward the bottom-right.
      ctx.save();
      path(ctx, rings[0]);
      ctx.clip();
      const vol = diagonal(ctx, rings[0]);
      vol.addColorStop(0, "rgba(255,255,255,0.2)");
      vol.addColorStop(0.5, "rgba(255,255,255,0)");
      vol.addColorStop(0.5, "rgba(0,0,0,0)");
      vol.addColorStop(1, "rgba(0,0,0,0.5)");
      ctx.fillStyle = vol;
      ctx.fillRect(CONE.x - RING_R[0] * 1.2, CONE.y - RING_R[0] * 1.2, RING_R[0] * 2.4, RING_R[0] * 2.4);
      ctx.restore();
      rings.forEach((ring, i) => litEdge(ctx, ring, COL.light[i]));
      crater(ctx);
    },
    onTrack(ctx) {
      const d = mulberry32(4003);
      const n = track.path.length;
      for (let i = 0; i < 1800; i++) {
        const k = Math.floor(d() * n), p = track.path[k], t = track.tangents[k];
        const off = (d() - 0.5) * track.width * 0.96;
        disc(ctx, p.x - t.y * off, p.y + t.x * off, range(d, 1, 3), `rgba(150,140,135,${range(d, 0.1, 0.25).toFixed(2)})`);
      }
    },
    over(ctx) {
      const d: Rng = mulberry32(4004);
      for (const r of blocks) rock(ctx, d, r, COL.block, "#2e2421");
    },
  };
}

export const fx: Fx = {
  // A very slow pulse of the lake's glow, nothing else: no embers, no sparks.
  ground(ctx, _scene, v) {
    if (v.maxX < CONE.x - LAKE_R || v.minX > CONE.x + LAKE_R || v.maxY < CONE.y - LAKE_R || v.minY > CONE.y + LAKE_R) return;
    const pulse = 0.5 + 0.5 * Math.sin(v.t * 0.8);
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(CONE.x, CONE.y, 0, CONE.x, CONE.y, LAKE_R * 0.9);
    g.addColorStop(0, `rgba(255,150,40,${(0.1 + 0.08 * pulse).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,90,20,0)");
    dot(ctx, CONE.x, CONE.y, LAKE_R * 0.9, g);
    ctx.globalCompositeOperation = "source-over";
  },
  screen(ctx, v) {
    const g = ctx.createRadialGradient(v.sw / 2, v.sh / 2, Math.min(v.sw, v.sh) * 0.4, v.sw / 2, v.sh / 2, Math.max(v.sw, v.sh) * 0.8);
    g.addColorStop(0, "rgba(10,4,3,0)");
    g.addColorStop(1, "rgba(10,4,3,0.3)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.sw, v.sh);
  },
};
