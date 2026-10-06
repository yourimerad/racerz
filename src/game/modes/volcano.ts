import { dot, hash, visible, wrap, type Fx } from "../fx";
import { disc, lavaClear, mulberry32, onTrackPoint, range, rock, scatter, softBlob, TAU, type Circle, type Scene } from "../scenery";
import type { Track, TrackLayout } from "../track";

// Volcano: same circuit as the other modes for now (see docs/decisions.md for the planned
// crater passage and the more realistic lava pass). Crater with lava pools, ash drifts, rocks.

export const layout: TrackLayout = {
  points: [
    [400, 1100], [400, 600], [650, 300], [1100, 280], [1400, 560], [1750, 420],
    [2250, 330], [2700, 560], [2780, 1050], [2450, 1380], [1950, 1250],
    [1550, 1560], [1050, 1760], [600, 1620],
  ],
};

export function scene(track: Track): Scene {
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
    if (dd + r < crater.r - 20 && lavaClear(track, x, y, r)) lava.push({ x, y, r });
  }
  // Lava rivers: meandering chains of discs that stop before reaching the track.
  for (let k = 0; k < 4; k++) {
    const [start] = scatter(track, rng, [], 1, 34, 34);
    if (!start) continue;
    let { x, y } = start, a = rng() * TAU;
    for (let s = 0; s < 30; s++) {
      const r = range(rng, 20, 32);
      if (!lavaClear(track, x, y, r) || x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) break;
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
