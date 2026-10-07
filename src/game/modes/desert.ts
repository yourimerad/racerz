import { drift, dot, type Fx } from "../fx";
import { disc, ellipse, mulberry32, onTrackPoint, range, rock, scatter, shadow, softBlob, TAU, type Circle, type Scene } from "../scenery";
import type { Track, TrackLayout } from "../track";

// Desert: open dunes for most of the lap, cut through by a canyon of red sandstone — a
// natural arch to drive under, plus two cliff overhangs that jut out over the road. Oasis,
// cacti and sun-bleached skulls fill the open stretch, same as before.

type Ctx = CanvasRenderingContext2D;

const OVERHANG_A = { from: 3.1, to: 3.75 }; // west overhang: a cliff ledge jutting halfway over the road
const ARCH = { from: 4.3, to: 4.7 }; // the arch itself
const OVERHANG_B = { from: 5.25, to: 5.9 }; // east overhang

export const layout: TrackLayout = {
  points: [
    [420, 1700], [420, 1200], [520, 820], [850, 600], [1300, 520], [1750, 500],
    [2200, 560], [2600, 780], [2820, 1150], [2650, 1550], [2150, 1700],
    [1700, 1550], [1200, 1700], [750, 1800],
  ],
  covers: [OVERHANG_A, ARCH, OVERHANG_B],
};

// Mirrors track.ts's SAMPLES_PER_SEGMENT: control-point unit -> sample index. Kept local so
// this mode doesn't need a shared export just for placing its own canyon scenery.
const SPS = 40;
function sampleAt(track: Track, control: number): number {
  const n = track.path.length;
  return ((Math.round(control * SPS) % n) + n) % n;
}

/** Sample indices from control unit `from` to `to` (both within the same loop, `from` < `to`), every `step`. */
function sampleRange(track: Track, from: number, to: number, step: number): number[] {
  const a = sampleAt(track, from), b = sampleAt(track, to);
  const out: number[] = [];
  for (let i = a; i < b; i += step) out.push(i);
  out.push(b);
  return out;
}

// ---------- canyon (red-sandstone strata, a natural arch, two overhangs) ----------

const CANYON = { wallFrom: 2.7, wallTo: 6.3 };

const STRATA = ["#b5603f", "#9c4b32", "#c97a4e", "#8a3f2b", "#d99a5f"];

/** Points along the centerline, offset sideways (see onTrackPoint), from control unit `from` to `to`. */
function wallPoints(track: Track, from: number, to: number, offset: number) {
  return sampleRange(track, from, to, 3).map((i) => onTrackPoint(track, i, offset));
}

function strokePath(ctx: Ctx, pts: { x: number; y: number }[], lineWidth: number, style: string) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/** One canyon wall (side = -1 left / +1 right of travel), with sedimentary strata bands. */
function canyonWall(ctx: Ctx, track: Track, side: 1 | -1) {
  const gap = 40, thick = 200;
  const inner = track.barrier + gap;
  ctx.lineCap = ctx.lineJoin = "round";
  // Contact shadow where the cliff meets the ground, just outside the barrier.
  strokePath(ctx, wallPoints(track, CANYON.wallFrom, CANYON.wallTo, side * (inner - 10)), 26, "rgba(40,16,8,0.4)");
  // Base rock mass.
  strokePath(ctx, wallPoints(track, CANYON.wallFrom, CANYON.wallTo, side * (inner + thick / 2)), thick, "#8a4330");
  // Strata bands: parallel stripes following the cliff, like sediment layers seen from above.
  const bandCount = STRATA.length;
  for (let k = 0; k < bandCount; k++) {
    const d = inner + ((k + 0.5) / bandCount) * thick;
    strokePath(ctx, wallPoints(track, CANYON.wallFrom, CANYON.wallTo, side * d), thick / bandCount - 4, STRATA[k]);
  }
  // Sunlit clifftop rim.
  strokePath(ctx, wallPoints(track, CANYON.wallFrom, CANYON.wallTo, side * (inner + thick - 6)), 10, "rgba(255,225,185,0.55)");
}

/** A rock bulge pushing closer to the road where an overhang's base anchors into the wall. */
function canyonLedgeBase(ctx: Ctx, track: Track, cover: { from: number; to: number }, side: 1 | -1) {
  const gap = 20, thick = 120;
  const inner = track.barrier + gap;
  strokePath(ctx, wallPoints(track, cover.from, cover.to, side * (inner + thick / 2)), thick, "#7a3b2a");
  strokePath(ctx, wallPoints(track, cover.from, cover.to, side * (inner + thick - 8)), 14, "rgba(255,225,185,0.4)");
}

/** The arch's two rock legs flanking the road at its midpoint. */
function archLegs(ctx: Ctx, track: Track, rng: () => number) {
  const mid = sampleAt(track, (ARCH.from + ARCH.to) / 2);
  const gap = 22, r = 72;
  for (const side of [-1, 1] as const) {
    const p = onTrackPoint(track, mid, side * (track.barrier + gap + r));
    rock(ctx, rng, { x: p.x, y: p.y, r }, "#6b3324", "#a35a3b");
  }
}

/** Underside shading inside the arch: darkest at the apex, fading toward both openings. */
function archOverhead(ctx: Ctx, track: Track) {
  const a = sampleAt(track, ARCH.from), b = sampleAt(track, ARCH.to);
  const mid = onTrackPoint(track, sampleAt(track, (ARCH.from + ARCH.to) / 2), 0);
  const halfSpan = track.barrier + 160;
  const archLenPts = wallPoints(track, ARCH.from, ARCH.to, 0);
  const archLen = archLenPts.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - archLenPts[i - 1].x, p.y - archLenPts[i - 1].y) : 0), 0);
  // Deck: solid rock slab spanning the full barrier-to-barrier width.
  strokePath(ctx, wallPoints(track, ARCH.from, ARCH.to, 0), halfSpan * 2, "#5e2d20");
  for (let k = 0; k < STRATA.length; k++) {
    const t = (k + 0.5) / STRATA.length;
    strokePath(ctx, wallPoints(track, ARCH.from, ARCH.to, (t - 0.5) * halfSpan * 2), halfSpan * 2 / STRATA.length - 3, STRATA[k]);
  }
  // Pooled shadow toward the apex (fades out near both mouths of the arch).
  softBlob(ctx, mid.x, mid.y, Math.max(60, archLen * 0.6), halfSpan * 0.9, mid.a, "15,6,4", 0.55);
  // Bright rim at each opening, marking entrance/exit.
  for (const i of [a, b]) {
    const p = track.path[i], t = track.tangents[i];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(t.y, t.x));
    const g = ctx.createLinearGradient(-30, 0, 30, 0);
    g.addColorStop(0, "rgba(255,230,190,0)");
    g.addColorStop(0.5, "rgba(255,230,190,0.5)");
    g.addColorStop(1, "rgba(255,230,190,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-30, -halfSpan, 60, halfSpan * 2);
    ctx.restore();
  }
}

/** A cliff ledge hanging partway over the road (not the full width), with a lit edge. */
function overhangDeck(ctx: Ctx, track: Track, cover: { from: number; to: number }, side: 1 | -1) {
  const outer = side * (track.barrier + 50);
  const inner = side * -track.width * 0.08; // crosses just past the centerline
  const center = (outer + inner) / 2;
  const width = Math.abs(outer - inner);
  strokePath(ctx, wallPoints(track, cover.from, cover.to, center), width, "#6b3324");
  for (let k = 0; k < STRATA.length; k++) {
    const t = (k + 0.5) / STRATA.length;
    strokePath(ctx, wallPoints(track, cover.from, cover.to, outer + (inner - outer) * t), width / STRATA.length - 3, STRATA[k]);
  }
  // Lit inner edge, where the rock ends mid-road.
  strokePath(ctx, wallPoints(track, cover.from, cover.to, inner), 10, "rgba(255,225,185,0.6)");
  // Soft shadow it casts just ahead of its own edge.
  const mid = onTrackPoint(track, sampleAt(track, (cover.from + cover.to) / 2), inner * 0.6);
  softBlob(ctx, mid.x, mid.y, 90, 60, 0, "15,6,4", 0.3);
}

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

  // Keep the canyon's area clear of the usual scattered props (rocks/cacti/skulls/oasis),
  // so they don't collide with the custom cliff walls drawn for it below.
  for (const i of sampleRange(track, CANYON.wallFrom, CANYON.wallTo, 20)) {
    const p = track.path[i];
    occ.push({ x: p.x, y: p.y, r: track.barrier + 300 });
  }
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
      // Strong shadows cast across the road by the canyon walls, darkest on the west side.
      for (const [cover, side] of [[OVERHANG_A, -1], [ARCH, -1], [ARCH, 1], [OVERHANG_B, 1]] as const) {
        const mid = sampleAt(track, (cover.from + cover.to) / 2);
        for (let k = -2; k <= 2; k++) {
          const p = onTrackPoint(track, (mid + k * 4 + n) % n, side * track.width * 0.3);
          softBlob(ctx, p.x, p.y, 90, 70, p.a, "20,10,6", 0.3);
        }
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

      // Canyon: two sandstone walls, ledge bases for the overhangs, and the arch's legs.
      for (const side of [-1, 1] as const) canyonWall(ctx, track, side);
      canyonLedgeBase(ctx, track, OVERHANG_A, -1);
      canyonLedgeBase(ctx, track, OVERHANG_B, 1);
      archLegs(ctx, track, d);
    },
    overhead(ctx) {
      archOverhead(ctx, track);
      overhangDeck(ctx, track, OVERHANG_A, -1);
      overhangDeck(ctx, track, OVERHANG_B, 1);
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
