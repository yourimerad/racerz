import type { Fx } from "../fx";
import { dot, drift, hash, visible } from "../fx";
import {
  disc, ellipse, isClear, mulberry32, onTrackPoint, range, scatter, scatterNear, shadow, softBlob, TAU,
  type Circle, type Rng, type Scene,
} from "../scenery";
import type { CoverLayout, Track, TrackLayout } from "../track";

// Countryside "campagne" circuit, campaign-style: zone A (start/finish, grandstands & pits) ->
// a forest road with two canopy-covered stretches -> zone B (a village circuit, hay bales and a
// marquee) -> back to zone A across fields and a farm. Zones are contiguous stretches of
// control-point units (see ZONE_* below, same unit as CoverLayout); sample indices are derived
// from track.path.length at scene-build time, so they stay exact regardless of the shared
// SAMPLES_PER_SEGMENT constant in track.ts.

type Ctx = CanvasRenderingContext2D;
type Prop = Circle & { a: number };

const CANOPY: CoverLayout[] = [{ from: 3.5, to: 4.6 }, { from: 5.2, to: 6.4 }];

export const layout: TrackLayout = {
  points: [
    [900, 1830], [1350, 1800], [1800, 1830], [2200, 1750],
    [2550, 1500], [2750, 1050], [2650, 580], [2300, 280],
    [1850, 160], [1410, 400], [950, 150], [550, 300],
    [280, 750], [260, 1250], [330, 1650], [500, 1800],
  ],
  covers: CANOPY,
};

// Zones, in control-point units. Half-open [from, to) and wrap past 0 like CoverLayout does.
const ZONE_A = { from: 15, to: 19 }; // point15 -> 0 -> ... -> 3: start/finish straight, grandstands & pits
const FOREST = { from: 3, to: 7 }; // point3 -> ... -> 7: forest road, two canopy passages
const ZONE_B = { from: 7, to: 11 }; // point7 -> ... -> 11: village circuit
const FARM = { from: 11, to: 15 }; // point11 -> ... -> 15: fields and a farm, back to zone A

function idxOf(u: number, spp: number, n: number) {
  return ((Math.round(u * spp) % n) + n) % n;
}
function zoneIndices(spp: number, n: number, zone: { from: number; to: number }) {
  const start = idxOf(zone.from, spp, n), end = idxOf(zone.to, spp, n);
  const len = start <= end ? end - start : n - start + end;
  return { start, end, len };
}
/** Sample indices through a zone, `step` apart, excluding the end (shared with the next zone). */
function stepThrough(spp: number, n: number, zone: { from: number; to: number }, step: number): number[] {
  const { start, len } = zoneIndices(spp, n, zone);
  const out: number[] = [];
  for (let k = 0; k < len; k += step) out.push((start + k) % n);
  return out;
}

function hits(occ: Circle[], x: number, y: number, r: number) {
  return occ.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r) ** 2);
}

/** Trees along both sides of a stretch of road, just beyond the barrier. */
function belt(track: Track, rng: Rng, occ: Circle[], idxs: number[], rMin: number, rMax: number, padMin: number, padMax: number): Circle[] {
  const out: Circle[] = [];
  for (const i of idxs)
    for (const side of [-1, 1] as const) {
      const r = range(rng, rMin, rMax);
      const p = onTrackPoint(track, i, side * (track.barrier + range(rng, padMin, padMax) + r));
      if (!isClear(track, p.x, p.y, r) || hits(occ, p.x, p.y, r)) continue;
      const c = { x: p.x, y: p.y, r };
      out.push(c);
      occ.push(c);
    }
  return out;
}

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

/** Square straw bale lining a bend (a bumper: cars bounce off it), long side along the road. */
function strawBale(ctx: Ctx, c: Prop) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  const w = c.r * 2.1, h = c.r * 1.35;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
  ctx.fillStyle = "#e3c35a";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "rgba(255,240,180,0.45)";
  ctx.fillRect(-w / 2, -h / 2, w, h * 0.35);
  ctx.strokeStyle = "rgba(150,110,40,0.55)";
  ctx.lineWidth = 1;
  for (let k = -2; k <= 2; k++) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 2, (k * h) / 6);
    ctx.lineTo(w / 2 - 2, (k * h) / 6 + 1);
    ctx.stroke();
  }
  // Two binding twines.
  ctx.strokeStyle = "#8a5a2b";
  ctx.lineWidth = 1.6;
  for (const x of [-w / 4, w / 4]) {
    ctx.beginPath();
    ctx.moveTo(x, -h / 2);
    ctx.lineTo(x, h / 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(120,85,30,0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
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

// ---------- zone A: start/finish straight, grandstands, pit building, tires, banners ----------

function grandstand(ctx: Ctx, c: Prop) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  const w = c.r * 2.3, h = c.r * 1.25;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-w / 2 + 8, -h / 2 + 10, w, h);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? "#1d3557" : "#274472";
    ctx.fillRect(-w / 2, -h / 2 + (i * h) / 5, w, h / 5 + 1);
  }
  for (let i = 0; i < 16; i++) {
    const px = -w / 2 + 10 + (i % 8) * (w / 8), py = -h / 2 + 5 + Math.floor(i / 8) * (h / 2.2);
    disc(ctx, px, py, 2.6, i % 3 === 0 ? "#e63946" : i % 3 === 1 ? "#f1faee" : "#457b9d");
  }
  ctx.fillStyle = "#0d1b2a";
  ctx.fillRect(-w / 2 - 6, -h / 2 - 10, w + 12, 10);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function pitBuilding(ctx: Ctx, c: Prop) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  const w = c.r * 2.1, h = c.r * 1.05;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-w / 2 + 8, -h / 2 + 8, w, h);
  ctx.fillStyle = "#e9ecef";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? "#d62828" : "#1d3557";
    ctx.fillRect(-w / 2 + 6 + i * (w / 4), -h / 2 + h * 0.3, w / 4 - 10, h * 0.6);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "#1d3557";
  ctx.fillRect(-6, -h / 2 - 20, 12, 20);
  ctx.restore();
}

function tireStack(ctx: Ctx, c: Circle) {
  shadow(ctx, c.x + 3, c.y + 3, c.r);
  for (let i = 0; i < 3; i++) disc(ctx, c.x, c.y - i * c.r * 0.35, c.r * (1 - i * 0.12), "#1a1a1a");
  for (let i = 0; i < 3; i++) disc(ctx, c.x, c.y - i * c.r * 0.35, c.r * (1 - i * 0.12) * 0.55, "#2e2e2e");
}

function banner(ctx: Ctx, c: Prop) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  ctx.fillStyle = "#6b4f30";
  ctx.fillRect(-3, -4, 6, c.r * 2.2);
  const w = c.r * 2.6;
  ctx.fillStyle = "#ffd166";
  ctx.fillRect(-w / 2, -c.r * 2.1, w, c.r * 0.7);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -c.r * 2.1, w, c.r * 0.7);
  for (let i = 0; i < 4; i++) disc(ctx, -w / 2 + (i + 0.5) * (w / 4), -c.r * 1.75, 4, "#1d3557");
  ctx.restore();
}

// ---------- zone B: village circuit, hay bales & a marquee ----------

function chapiteau(ctx: Ctx, c: Circle) {
  shadow(ctx, c.x + 6, c.y + 8, c.r * 1.05, c.r * 0.8);
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * TAU, a1 = ((i + 1) / 10) * TAU;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - c.r * 1.15);
    ctx.arc(c.x, c.y, c.r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? "#e63946" : "#f1faee";
    ctx.fill();
  }
  disc(ctx, c.x, c.y - c.r * 1.15, c.r * 0.08, "#ffd166");
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, c.r, 0, TAU);
  ctx.stroke();
}

function villageStand(ctx: Ctx, c: Prop) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.a);
  const w = c.r * 2, h = c.r * 0.9;
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 ? "#8a6a45" : "#a4824f";
    ctx.fillRect(-w / 2, -h / 2 + (i * h) / 3, w, h / 3 + 1);
  }
  ctx.fillStyle = "#6b4226";
  ctx.fillRect(-w / 2 - 4, -h / 2 - 8, w + 8, 8);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

// ---------- forest: dense trees, canopy entrances ----------

function archPillar(ctx: Ctx, c: Circle) {
  shadow(ctx, c.x + 5, c.y + 6, c.r * 0.9, c.r * 0.7);
  ctx.fillStyle = "#4a3421";
  ctx.beginPath();
  ctx.roundRect(c.x - c.r * 0.35, c.y - c.r * 0.9, c.r * 0.7, c.r * 1.8, c.r * 0.3);
  ctx.fill();
  disc(ctx, c.x, c.y - c.r * 0.9, c.r, "#2f5d27");
  disc(ctx, c.x - c.r * 0.3, c.y - c.r * 1.1, c.r * 0.6, "#3e7a35");
}

/** The canopy ceiling over one covered stretch: leafy clusters with a few light gaps. */
function canopyRoof(ctx: Ctx, track: Track, rng: Rng, cover: CoverLayout, spp: number, n: number) {
  const { start, len } = zoneIndices(spp, n, cover);
  for (let k = -3; k <= len + 3; k += 5) {
    const i = ((start + k) % n + n) % n;
    for (let s = 0; s < 3; s++) {
      const lateral = (s - 1) * (track.barrier * 0.7) + range(rng, -40, 40);
      const p = onTrackPoint(track, i, lateral);
      const r = range(rng, 55, 100);
      const gap = rng() < 0.1;
      disc(
        ctx, p.x + range(rng, -20, 20), p.y + range(rng, -20, 20), r,
        gap
          ? "rgba(255,230,170,0.22)"
          : `rgba(${18 + Math.floor(rng() * 18)},${55 + Math.floor(rng() * 35)},${18 + Math.floor(rng() * 15)},0.94)`,
      );
    }
  }
}

export function scene(track: Track): Scene {
  const rng = mulberry32(2001);
  const n = track.path.length;
  const spp = n / layout.points.length;
  const b = track.bounds;
  const occ: Circle[] = [];

  // Zone A: grandstands, pit building, tire stacks and banners along the start/finish straight.
  const grandstands: Prop[] = [], pits: Prop[] = [], tires: Circle[] = [], banners: Prop[] = [];
  stepThrough(spp, n, ZONE_A, 20).forEach((i, k) => {
    const side = k % 2 === 0 ? 1 : (-1 as 1 | -1);
    if (k % 4 === 0) {
      const p = onTrackPoint(track, i, side * (track.barrier + 94));
      const c = { x: p.x, y: p.y, r: 60, a: p.a };
      if (isClear(track, c.x, c.y, c.r) && !hits(occ, c.x, c.y, c.r)) { grandstands.push(c); occ.push(c); }
    } else if (k % 4 === 2) {
      const p = onTrackPoint(track, i, side * (track.barrier + 80));
      const c = { x: p.x, y: p.y, r: 46, a: p.a };
      if (isClear(track, c.x, c.y, c.r) && !hits(occ, c.x, c.y, c.r)) { pits.push(c); occ.push(c); }
    } else {
      const p = onTrackPoint(track, i, -side * (track.barrier + 48));
      const c = { x: p.x, y: p.y, r: 14 };
      if (isClear(track, c.x, c.y, c.r) && !hits(occ, c.x, c.y, c.r)) { tires.push(c); occ.push(c); }
    }
  });
  stepThrough(spp, n, ZONE_A, 11).forEach((i) => {
    const side = i % 2 === 0 ? 1 : (-1 as 1 | -1);
    const p = onTrackPoint(track, i, side * (track.barrier + 50));
    const c = { x: p.x, y: p.y, r: 16, a: p.a };
    if (isClear(track, c.x, c.y, c.r) && !hits(occ, c.x, c.y, c.r)) { banners.push(c); occ.push(c); }
  });

  // Zone B: a village circuit — a marquee, a couple of rustic stands, hay-bale clusters.
  const chapiteaux: Circle[] = [], villageStands: Prop[] = [], villageBales: Circle[] = [];
  stepThrough(spp, n, ZONE_B, 24).forEach((i, k) => {
    const side = k % 2 === 0 ? 1 : (-1 as 1 | -1);
    if (k === 0) {
      const p = onTrackPoint(track, i, side * (track.barrier + 110));
      const c = { x: p.x, y: p.y, r: 80 };
      if (isClear(track, c.x, c.y, c.r) && !hits(occ, c.x, c.y, c.r)) { chapiteaux.push(c); occ.push(c); }
    } else if (k % 2 === 1) {
      const p = onTrackPoint(track, i, side * (track.barrier + 70));
      const c = { x: p.x, y: p.y, r: 46, a: p.a };
      if (isClear(track, c.x, c.y, c.r) && !hits(occ, c.x, c.y, c.r)) { villageStands.push(c); occ.push(c); }
    } else {
      for (let o = -1; o <= 1; o++) {
        const r = range(rng, 9, 12);
        const p = onTrackPoint(track, (i + o + n) % n, side * (track.barrier + 26 + r));
        if (!isClear(track, p.x, p.y, r) || hits(occ, p.x, p.y, r)) continue;
        const c = { x: p.x, y: p.y, r };
        villageBales.push(c);
        occ.push(c);
      }
    }
  });

  // Zone B (top): the kerbs are rows of straw bales on both edges, packed tight so no car can
  // slip between them — solid bumpers (scene.bumpers) that cars bounce off hard.
  const hayBales: Prop[] = [], hayBumpers: Circle[] = [];
  for (const i of stepThrough(spp, n, ZONE_B, 2))
    for (const side of [-1, 1] as const) {
      const p = onTrackPoint(track, i, side * (track.width / 2 + 9));
      hayBales.push({ x: p.x, y: p.y, r: 13, a: p.a });
      hayBumpers.push({ x: p.x, y: p.y, r: 10 });
    }

  // Forest: dense trees on both sides, plus marked entrances/exits at the two canopy passages.
  const forestTrees = belt(track, rng, occ, stepThrough(spp, n, FOREST, 5), 16, 28, 10, 70);
  const archPillars: Circle[] = [];
  for (const cover of CANOPY) {
    const { start, end } = zoneIndices(spp, n, cover);
    for (const idx of [start, end])
      for (const side of [-1, 1] as const) {
        const p = onTrackPoint(track, idx, side * (track.barrier + 70));
        if (isClear(track, p.x, p.y, 24)) archPillars.push({ x: p.x, y: p.y, r: 24 });
      }
  }
  const forestIdxs = stepThrough(spp, n, FOREST, 4);
  const leftEdge = forestIdxs.map((i) => onTrackPoint(track, i, track.barrier + 210));
  const rightEdge = forestIdxs.map((i) => onTrackPoint(track, i, -(track.barrier + 210)));

  // A handful of light-shaft sources under the canopy, animated in fx.ground (reusing Scene.vents,
  // a plain Circle[] slot — volcano uses it for smoke, here it marks dappled-light spots).
  const lightGaps: Circle[] = [];
  for (const cover of CANOPY) {
    const { start, len } = zoneIndices(spp, n, cover);
    for (const k of [0.2, 0.5, 0.8]) {
      const p = onTrackPoint(track, (start + Math.round(len * k)) % n, range(rng, -1, 1) * track.width * 0.3);
      lightGaps.push({ x: p.x, y: p.y, r: 36 });
    }
  }

  // Farm: back to zone A across the fields, through a farm placed in the return stretch.
  const fz = zoneIndices(spp, n, FARM);
  const farmIdx = (fz.start + Math.floor(fz.len / 2)) % n;
  const fp = onTrackPoint(track, farmIdx, (farmIdx % 2 === 0 ? 1 : -1) * (track.barrier + 204));
  const farms: Circle[] = isClear(track, fp.x, fp.y, 170) ? [{ x: fp.x, y: fp.y, r: 170 }] : [];
  if (farms.length) occ.push(farms[0]);
  const cows = farms.length ? scatterNear(track, rng, occ, 2, farms[0], 120, 30) : [];

  // Generic countryside filler: a few more trees and bales, beyond what the forest/village already placed.
  const trees = scatter(track, rng, occ, 55, 18, 30);
  const bales = scatter(track, rng, occ, 10, 9, 12);

  // Patchwork fields: a jittered grid of quads (unchanged from the previous single-circuit layout).
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
    vents: lightGaps,
    bumpers: hayBumpers,
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
      // Forest floor: darker undergrowth painted over the patchwork, under the whole forest road.
      ctx.beginPath();
      leftEdge.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      for (let i = rightEdge.length - 1; i >= 0; i--) ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
      ctx.closePath();
      ctx.fillStyle = "#23401f";
      ctx.fill();
      const d = mulberry32(2005);
      for (let i = 0; i < 46; i++) {
        const idx = forestIdxs[Math.floor(d() * forestIdxs.length)];
        const p = onTrackPoint(track, idx, range(d, -1, 1) * (track.barrier + 190));
        softBlob(ctx, p.x, p.y, range(d, 40, 90), range(d, 30, 60), range(d, 0, Math.PI), "10,30,10", 0.35);
      }
    },
    onTrack(ctx) {
      // Darken the asphalt under the canopy (the leaves themselves are in the overhead layer).
      ctx.lineCap = "round";
      for (const cover of CANOPY) {
        const { start, len } = zoneIndices(spp, n, cover);
        ctx.beginPath();
        for (let k = 0; k <= len; k++) {
          const p = track.path[(start + k) % n];
          if (k) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        }
        ctx.lineWidth = track.width;
        ctx.strokeStyle = "rgba(5,10,5,0.4)";
        ctx.stroke();
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
      for (const g of grandstands) grandstand(ctx, g);
      for (const p of pits) pitBuilding(ctx, p);
      for (const t of tires) tireStack(ctx, t);
      for (const bn of banners) banner(ctx, bn);
      for (const c of chapiteaux) chapiteau(ctx, c);
      for (const v of villageStands) villageStand(ctx, v);
      for (const vb of villageBales) bale(ctx, vb);
      for (const hb of hayBales) strawBale(ctx, hb);
      for (const t of forestTrees) tree(ctx, t);
      for (const p of archPillars) archPillar(ctx, p);
      for (const t of trees) tree(ctx, t);
    },
    overhead(ctx) {
      const rng2 = mulberry32(2010);
      for (const cover of CANOPY) canopyRoof(ctx, track, rng2, cover, spp, n);
    },
  };
}

export const fx: Fx = {
  ground(ctx, scene, v) {
    // Dappled light flickering through the canopy gaps (scene.vents reused for the gap spots).
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < scene.vents.length; i++) {
      const c = scene.vents[i];
      if (!visible(c, v, 150)) continue;
      const flicker = 0.5 + 0.5 * Math.sin(v.t * 2.3 + hash(i, 5) * 10);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 2.2);
      g.addColorStop(0, `rgba(255,244,200,${(0.1 + 0.1 * flicker).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,244,200,0)");
      dot(ctx, c.x, c.y, c.r * 2.2, g);
    }
    ctx.globalCompositeOperation = "source-over";
  },
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
