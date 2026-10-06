import { dot, hash, visible, wrap, type Fx } from "../fx";
import { disc, lavaClear, mulberry32, onTrackPoint, range, rock, scatter, softBlob, TAU, type Circle, type Rng, type Scene } from "../scenery";
import type { CoverRange, Track, TrackLayout } from "../track";

// Volcano: the circuit climbs the cone's flank through a bored tunnel, crosses the open-air
// crater on a stone causeway ringed by a lava lake, then drops back down through a second
// tunnel on the far flank. The rest of the lap runs the ash slopes around the base.
// (The more-realistic lava pass promised in docs/decisions.md is the next commit.)

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

export const layout: TrackLayout = {
  points: [
    [1550, 2100], [1050, 2000], [480, 1700], [330, 1150], [650, 680],
    [1070, 520], [1290, 520], [1810, 520], [2030, 520],
    [2450, 680], [2770, 1150], [2620, 1700], [2050, 2000],
  ],
  covers: [
    { from: 5, to: 6 }, // west tunnel: flank -> crater rim
    { from: 7, to: 8 }, // east tunnel: crater rim -> flank
  ],
};

/** Crater disc, centered on the chord between the two rim points (control units 6 & 7 above). */
const CRATER = { x: 1550, y: 520, r: 260 };
/** Decorative radius of the cone's visible flank (tunnel mouths sit at 480, just inside it). */
const FLANK_R = 560;

function coverEndpoints(track: Track, cover: CoverRange) {
  const n = track.path.length;
  const length = cover.start <= cover.end ? cover.end - cover.start : n - cover.start + cover.end;
  return { startIdx: cover.start, endIdx: (cover.start + length) % n, length };
}

/** Points along a covered section, optionally extended past both ends along the tangent there. */
function coverPath(track: Track, cover: CoverRange, pad: number): Pt[] {
  const n = track.path.length;
  const { startIdx, endIdx, length } = coverEndpoints(track, cover);
  const pts: Pt[] = [];
  for (let k = 0; k <= length; k++) pts.push(track.path[(startIdx + k) % n]);
  if (pad > 0) {
    const t0 = track.tangents[startIdx], t1 = track.tangents[endIdx];
    pts.unshift({ x: pts[0].x - t0.x * pad, y: pts[0].y - t0.y * pad });
    pts.push({ x: pts[pts.length - 1].x + t1.x * pad, y: pts[pts.length - 1].y + t1.y * pad });
  }
  return pts;
}

function strokePath(ctx: Ctx, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

/** Two rock pillars flanking a tunnel mouth, just beyond the barrier, perpendicular to travel. */
function portal(ctx: Ctx, p: Pt, tangent: Pt, barrier: number) {
  const nx = -tangent.y, ny = tangent.x;
  for (const side of [-1, 1]) {
    const x = p.x + nx * (barrier + 22) * side, y = p.y + ny * (barrier + 22) * side;
    ctx.fillStyle = "#1c1513";
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 4, 16, 22, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#4a3a33";
    ctx.beginPath();
    ctx.ellipse(x, y, 15, 21, 0, 0, TAU);
    ctx.fill();
  }
}

/** A cooled lava flow: a meandering polyline running outward from the crater rim. */
function flowStreak(rng: Rng): Pt[] {
  let a = rng() * TAU, r = CRATER.r + range(rng, 10, 50);
  const pts: Pt[] = [{ x: CRATER.x + Math.cos(a) * r, y: CRATER.y + Math.sin(a) * r }];
  for (let s = 0; s < 8 && r < FLANK_R * 0.9; s++) {
    a += range(rng, -0.15, 0.15);
    r += range(rng, 32, 54);
    pts.push({ x: CRATER.x + Math.cos(a) * r, y: CRATER.y + Math.sin(a) * r });
  }
  return pts;
}

/** Dense lava fill inside the crater disc, kept clear of the causeway (and its margin). */
function lavaLake(track: Track, rng: Rng): Circle[] {
  const out: Circle[] = [];
  const cell = 44;
  for (let gx = -CRATER.r; gx <= CRATER.r; gx += cell) {
    for (let gy = -CRATER.r; gy <= CRATER.r; gy += cell) {
      const x = CRATER.x + gx + range(rng, -11, 11), y = CRATER.y + gy + range(rng, -11, 11);
      if (Math.hypot(x - CRATER.x, y - CRATER.y) > CRATER.r - 16) continue;
      const r = range(rng, 24, 34);
      if (!lavaClear(track, x, y, r)) continue;
      out.push({ x, y, r });
    }
  }
  // A ring hugging the causeway on both sides so the lake reaches right up to the kerbs.
  // Samples 240-280 are control units 6-7 above: the open-air crossing between the two rims.
  for (let i = 240; i <= 280; i += 4) {
    for (const side of [-1, 1]) {
      const r = range(rng, 16, 22);
      const p = onTrackPoint(track, i, side * (track.width / 2 + 16 + r));
      if (Math.hypot(p.x - CRATER.x, p.y - CRATER.y) > CRATER.r - 8) continue;
      if (!lavaClear(track, p.x, p.y, r)) continue;
      out.push({ x: p.x, y: p.y, r });
    }
  }
  return out;
}

export function scene(track: Track): Scene {
  const rng = mulberry32(4001);
  const b = track.bounds;
  const occ: Circle[] = [];
  const lava = lavaLake(track, rng);
  occ.push({ x: CRATER.x, y: CRATER.y, r: CRATER.r + 50 }, ...lava);
  const vents = [{ ...CRATER, r: 150 }, ...lava.filter((_, i) => i % 11 === 0).map((l) => ({ ...l }))];
  const rocks = scatter(track, rng, occ, 70, 8, 26);
  const ash = Array.from({ length: 56 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY),
    rx: range(rng, 120, 360), ry: range(rng, 50, 160), rot: rng() * Math.PI,
  }));
  const cracks = Array.from({ length: 80 }, () => ({ x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY), a: rng() * TAU }));
  const flows = Array.from({ length: 26 }, () => flowStreak(rng));

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
        ctx.strokeStyle = "rgba(255,90,20,0.25)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Cone: a broad gradient fading back to the ash color so it blends in at its edges.
      const cone = ctx.createRadialGradient(CRATER.x, CRATER.y, 0, CRATER.x, CRATER.y, FLANK_R);
      cone.addColorStop(0, "#4a3a33");
      cone.addColorStop(0.75, "#3a2c26");
      cone.addColorStop(1, "#2b2321");
      disc(ctx, CRATER.x, CRATER.y, FLANK_R, cone);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 3;
      ctx.setLineDash([26, 30]);
      for (const r of [CRATER.r + 80, CRATER.r + 170, CRATER.r + 260]) {
        ctx.beginPath();
        ctx.arc(CRATER.x, CRATER.y, r, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Cooled lava flows: solidified streaks running down the flank from the crater rim.
      ctx.lineCap = "round";
      for (const f of flows) {
        ctx.lineWidth = 10;
        ctx.strokeStyle = "rgba(20,14,12,0.55)";
        strokePath(ctx, f);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(90,70,62,0.4)";
        strokePath(ctx, f);
      }

      // Crater: raised rim, dark scorched floor.
      disc(ctx, CRATER.x, CRATER.y, CRATER.r + 70, "#3b2e2a");
      const g = ctx.createRadialGradient(CRATER.x, CRATER.y, CRATER.r * 0.2, CRATER.x, CRATER.y, CRATER.r + 10);
      g.addColorStop(0, "#2a1210");
      g.addColorStop(0.85, "#1a0f0e");
      g.addColorStop(1, "#5a2414");
      disc(ctx, CRATER.x, CRATER.y, CRATER.r + 10, g);
      ctx.strokeStyle = "#55443d";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(CRATER.x, CRATER.y, CRATER.r + 40, 0, TAU);
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
      // Darken the asphalt under both tunnels (lit only by the cars' headlights, in effect).
      ctx.lineCap = "round";
      ctx.lineWidth = track.width;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      for (const cover of track.covers) strokePath(ctx, coverPath(track, cover, 20));
    },
    over(ctx) {
      const d = mulberry32(4004);
      for (const r of rocks) rock(ctx, d, r, "#2e2826", "#5a4a44");
      for (const cover of track.covers) {
        const { startIdx, endIdx } = coverEndpoints(track, cover);
        portal(ctx, track.path[startIdx], track.tangents[startIdx], track.barrier);
        portal(ctx, track.path[endIdx], track.tangents[endIdx], track.barrier);
      }
    },
    overhead(ctx) {
      ctx.lineJoin = ctx.lineCap = "round";
      for (const cover of track.covers) {
        const pts = coverPath(track, cover, 60);
        ctx.lineWidth = track.barrier * 2 + 80;
        ctx.strokeStyle = "#241c19";
        strokePath(ctx, pts);
        ctx.lineWidth = track.barrier * 2 + 50;
        ctx.strokeStyle = "#362a24";
        strokePath(ctx, pts);
        const { startIdx, endIdx } = coverEndpoints(track, cover);
        for (const p of [track.path[startIdx], track.path[endIdx]]) {
          disc(ctx, p.x, p.y, track.barrier + 36, "rgba(10,6,5,0.6)");
          ctx.strokeStyle = "#5a4036";
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.arc(p.x, p.y, track.barrier + 24, 0, TAU);
          ctx.stroke();
        }
      }
    },
  };
}

export const fx: Fx = {
  ground(ctx, scene, v) {
    for (let i = 0; i < scene.lava.length; i++) {
      const c = scene.lava[i];
      if (!visible(c, v, c.r)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(v.t * 2.2 + c.x * 0.013 + c.y * 0.007);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
      g.addColorStop(0, `rgba(255,${200 + Math.round(40 * pulse)},110,0.95)`);
      g.addColorStop(0.55, `rgba(255,${100 + Math.round(40 * pulse)},20,0.9)`);
      g.addColorStop(1, "rgba(190,40,0,0)");
      dot(ctx, c.x, c.y, c.r, g);
    }
    ctx.globalCompositeOperation = "lighter";
    for (const c of scene.lava) {
      if (!visible(c, v, c.r)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(v.t * 2.2 + c.x * 0.013 + c.y * 0.007);
      const g = ctx.createRadialGradient(c.x, c.y, c.r * 0.5, c.x, c.y, c.r * 1.9);
      g.addColorStop(0, `rgba(255,90,20,${(0.12 + 0.14 * pulse).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,60,0,0)");
      dot(ctx, c.x, c.y, c.r * 1.9, g);
    }
    ctx.globalCompositeOperation = "source-over";
  },
  air(ctx, scene, v) {
    // Embers rising from the lava.
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < scene.lava.length; i++) {
      const c = scene.lava[i];
      if (!visible(c, v, 160)) continue;
      for (let j = 0; j < 2; j++) {
        const life = 2.4, age = wrap(v.t + hash(i, j) * life, life), f = age / life;
        const x = c.x + (hash(i, j + 5) - 0.5) * c.r * 1.4 + Math.sin(age * 3 + i) * 8;
        const y = c.y + (hash(i, j + 7) - 0.5) * c.r - age * 65;
        dot(ctx, x, y, 2 + hash(i, j + 3) * 2, `rgba(255,${140 + Math.round(80 * (1 - f))},60,${(0.9 * (1 - f)).toFixed(2)})`);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    // Smoke columns from the crater and vents.
    for (let i = 0; i < scene.vents.length; i++) {
      const c = scene.vents[i];
      if (!visible(c, v, 400)) continue;
      for (let j = 0; j < 7; j++) {
        const life = 6, age = wrap(v.t + (j / 7) * life + hash(i, j), life), f = age / life;
        const x = c.x + (hash(i, j + 11) - 0.5) * c.r + age * 22 + Math.sin(age + j) * 10;
        const y = c.y + (hash(i, j + 13) - 0.5) * c.r * 0.6 - age * 40;
        dot(ctx, x, y, c.r * 0.25 + 18 + age * 16, `rgba(70,60,58,${(0.28 * (1 - f) * Math.min(1, age * 2)).toFixed(3)})`);
      }
    }
  },
  screen(ctx, v) {
    ctx.fillStyle = "rgba(150,30,0,0.1)";
    ctx.fillRect(0, 0, v.sw, v.sh);
    const g = ctx.createRadialGradient(v.sw / 2, v.sh / 2, Math.min(v.sw, v.sh) * 0.35, v.sw / 2, v.sh / 2, Math.max(v.sw, v.sh) * 0.75);
    g.addColorStop(0, "rgba(60,0,0,0)");
    g.addColorStop(1, "rgba(60,0,0,0.4)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.sw, v.sh);
  },
};
