import { drift, dot, type Fx } from "../fx";
import { disc, ellipse, jagged, mulberry32, onTrackPoint, range, rock, scatter, TAU, type Circle, type Rng, type Scene } from "../scenery";
import type { Track, TrackLayout } from "../track";

// Desert: a red-sandstone canyon all the way round. The road is a ribbon of pale sand at the
// bottom of a ravine; on each side a jagged cliff face (lighter brown, lit rim) rises to the
// plateau, which is dotted with cracks, boulders and top-down cacti. All edges are broken
// lines drawn from fixed seeds (scenery.jagged), so the canyon is identical every race.

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

export const layout: TrackLayout = {
  points: [
    [420, 1700], [420, 1200], [520, 820], [850, 600], [1300, 520], [1750, 500],
    [2200, 560], [2600, 780], [2820, 1150], [2650, 1550], [2150, 1700],
    [1700, 1550], [1200, 1700], [750, 1800],
  ],
};

const COL = {
  plateau: "#c4663a", patch: "#b25830", crack: "#7a3519", rockBase: "#98582f", rockLight: "#b06a3e",
  cliff: "#b06a3e", rim: "#e8a874", foot: "#6b2f1a", floor: "#d6ae74",
  cactus: "#4a6a2e", cactusCore: "#6f9446",
};
/** Cliff face width between the canyon floor and the plateau. */
const CLIFF = 25;
/** Distance from the centerline to the cliff foot, a little beyond the barrier. */
const footOffset = (track: Track) => track.barrier + 16;

/** One jagged edge of the canyon as a closed loop, `offset` from the centerline on `side`. */
function edgeLoop(track: Track, side: 1 | -1, offset: number, amp: number, seed: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < track.path.length; i += 4) {
    const p = onTrackPoint(track, i, side * offset);
    pts.push([p.x, p.y]);
  }
  pts.push(pts[0]);
  return jagged(pts, amp, seed);
}

function tracePoly(ctx: Ctx, pts: Pt[]) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** The ground between two edge loops (either may be the outer one: even-odd fill). */
function fillBetween(ctx: Ctx, a: Pt[], b: Pt[], fill: string) {
  ctx.beginPath();
  tracePoly(ctx, a);
  tracePoly(ctx, b);
  ctx.fillStyle = fill;
  ctx.fill("evenodd");
}

function strokeLoop(ctx: Ctx, pts: Pt[], width: number, style: string) {
  ctx.beginPath();
  tracePoly(ctx, pts);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/** An irregular flat stain on the plateau. */
function blotch(ctx: Ctx, rng: Rng, x: number, y: number, r: number, fill: string) {
  const n = 9;
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, rr = r * range(rng, 0.6, 1.1);
    const px = x + Math.cos(a) * rr * 1.5, py = y + Math.sin(a) * rr;
    if (k) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A hairline fissure: a short random walk. */
function crack(ctx: Ctx, rng: Rng, x: number, y: number) {
  let a = rng() * TAU;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let k = 0; k < 6; k++) {
    a += range(rng, -0.6, 0.6);
    x += Math.cos(a) * range(rng, 14, 36);
    y += Math.sin(a) * range(rng, 14, 36);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Cactus seen from above: a round green crown with a lighter heart. */
function cactus(ctx: Ctx, c: Circle) {
  ellipse(ctx, c.x + c.r * 0.35, c.y + c.r * 0.4, c.r, c.r * 0.9, 0, "rgba(60,20,8,0.28)");
  disc(ctx, c.x, c.y, c.r, COL.cactus);
  ctx.strokeStyle = "rgba(20,40,10,0.35)";
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    ctx.beginPath();
    ctx.moveTo(c.x + Math.cos(a) * c.r * 0.5, c.y + Math.sin(a) * c.r * 0.5);
    ctx.lineTo(c.x + Math.cos(a) * c.r * 0.95, c.y + Math.sin(a) * c.r * 0.95);
    ctx.stroke();
  }
  disc(ctx, c.x, c.y, c.r * 0.5, COL.cactusCore);
}

export function scene(track: Track): Scene {
  const rng = mulberry32(1001);
  const b = track.bounds;
  const n = track.path.length;
  const foot = footOffset(track);

  // Both sides' edge loops: cliff foot (floor edge) and cliff rim (plateau edge).
  const footL = edgeLoop(track, -1, foot, 8, 11), footR = edgeLoop(track, 1, foot, 8, 23);
  const rimL = edgeLoop(track, -1, foot + CLIFF, 10, 37), rimR = edgeLoop(track, 1, foot + CLIFF, 10, 53);

  // Props stay on the plateau, clear of the cliff.
  const occ: Circle[] = [];
  for (let i = 0; i < n; i += 8) {
    const p = track.path[i];
    occ.push({ x: p.x, y: p.y, r: foot + CLIFF + 40 });
  }
  const rocks = scatter(track, rng, occ, 50, 10, 30);
  const cacti = scatter(track, rng, occ, 34, 10, 16);
  const patches = Array.from({ length: 140 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY), r: range(rng, 30, 90), light: rng() < 0.3,
  }));
  const cracks = Array.from({ length: 90 }, () => ({ x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY) }));

  return {
    lava: [],
    vents: [],
    under(ctx) {
      const d = mulberry32(1002);
      // 1. Plateau (the base fill): stains, fissures, boulders, cacti.
      for (const p of patches) blotch(ctx, d, p.x, p.y, p.r, p.light ? "rgba(214,128,80,0.35)" : COL.patch);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = COL.crack;
      ctx.lineWidth = 2;
      for (const c of cracks) crack(ctx, d, c.x, c.y);
      for (const r of rocks) rock(ctx, d, r, COL.rockBase, COL.rockLight);
      for (const c of [...cacti].sort((p, q) => p.y - q.y)) cactus(ctx, c);

      // 2. Cliff: a lighter brown face with a bright rim, then the canyon floor inside it.
      fillBetween(ctx, rimL, rimR, COL.cliff);
      fillBetween(ctx, footL, footR, COL.floor);
      for (const loop of [rimL, rimR]) strokeLoop(ctx, loop, 3, COL.rim);
      // Contact shadow where the cliff meets the floor.
      for (const loop of [footL, footR]) strokeLoop(ctx, loop, 7, "rgba(107,47,26,0.5)");
    },
    onTrack(ctx) {
      // Two fine, continuous tyre tracks along the whole lap.
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = onTrackPoint(track, i, side * 26);
          if (i) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#d3a96d";
        ctx.stroke();
      }
    },
    over() {},
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
