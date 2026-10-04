import type { Circle, Scene } from "./scenery";
import type { Vec } from "./vec";

// Animated layers, redrawn every frame on top of the cached static layer.

type Ctx = CanvasRenderingContext2D;
export type FxView = {
  t: number;
  cam: Vec;
  zoom: number;
  /** Screen size in CSS pixels. */
  sw: number;
  sh: number;
  /** Visible world rectangle. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
export type Fx = {
  /** World space, under skid marks and cars. */
  ground?(ctx: Ctx, scene: Scene, v: FxView): void;
  /** World space, over cars. */
  air?(ctx: Ctx, scene: Scene, v: FxView): void;
  /** Screen space. */
  screen?(ctx: Ctx, v: FxView): void;
};

const TAU = Math.PI * 2;
const wrap = (v: number, m: number) => ((v % m) + m) % m;
function hash(i: number, seed: number) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const visible = (c: Circle, v: FxView, pad: number) =>
  c.x + c.r + pad > v.minX && c.x - c.r - pad < v.maxX && c.y + c.r + pad > v.minY && c.y - c.r - pad < v.maxY;

/**
 * Stateless particle field: each particle drifts at (vx, vy) inside a tile that wraps around
 * the camera. Parallax k > 1 makes the layer feel closer to the viewer than the ground.
 */
function drift(
  ctx: Ctx, v: FxView, n: number, seed: number, k: number, vx: number, vy: number,
  draw: (x: number, y: number, s: number, i: number, h: number) => void,
) {
  const tile = (Math.max(v.sw, v.sh) + 300) / v.zoom;
  for (let i = 0; i < n; i++) {
    const h = hash(i, seed + 2);
    const sp = 0.6 + 0.8 * h;
    const x = v.sw / 2 + (wrap(hash(i, seed) * tile + vx * sp * v.t - v.cam.x * k, tile) - tile / 2) * v.zoom;
    const y = v.sh / 2 + (wrap(hash(i, seed + 1) * tile + vy * sp * v.t - v.cam.y * k, tile) - tile / 2) * v.zoom;
    draw(x, y, v.zoom * k, i, h);
  }
}

function dot(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

export const desertFx: Fx = {
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

export const countrysideFx: Fx = {
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

export const northPoleFx: Fx = {
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

export const volcanoFx: Fx = {
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
