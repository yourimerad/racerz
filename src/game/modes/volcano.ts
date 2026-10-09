import type { Fx } from "../fx";
import { disc, mulberry32, range, rock, scatter, TAU, type Circle, type Hazard, type Rng, type Scene, softBlob } from "../scenery";
import { locate, type Track, type TrackLayout } from "../track";
import { vec } from "../vec";

// Volcano: one big cone in the middle of the map, seen from above with the sun at the top-left.
// Three rings of black rock (irregular outlines, lit on the upper-left, shaded on the lower-right)
// climb to a crater whose lava lake is purely decorative. The circuit enters at the bottom, climbs
// the cone's east flank, skirts the crater along its right-hand rim and leaves by the top, then
// loops back round the west side of the map. The only lava anywhere is the lake and two small
// pools in opposite corners of the terrain. The volcano erupts in a loop (see ERUPTION and
// VolcanoEruption below): a purely visual hazard, driven by the race clock, that never touches the cars.

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

// ---------- eruption ----------

export const ERUPTION = {
  /**
   * The eruption is simulated in a 680 × 460 frame whose crater centre is (340, 225). It is drawn with
   * the same transform as the volcano's scenery: that centre lands on CONE and one frame pixel is
   * `scale` world units (so the frame's 50 px lake is the 150-unit LAKE_R).
   */
  frame: { cx: 340, cy: 225 },
  scale: 3,
  /** Lake radius in frame px. */
  lake: 50,
  /** Timeline (s): pressure builds until `pressure`, first blast, second blast, fountain until `fountain`, ebb until `ebb`, calm until `cycle`. */
  pressure: 1.6,
  second: 3.4,
  fountain: 4.8,
  ebb: 8,
  cycle: 10.5,
  /** First blast and second blast: bombs, smoke puffs, sparks, flash alpha, shake (frame px). */
  blast: { bombs: 110, smoke: 30, smokeWide: 1.6, sparks: 50, sparkSpeed: 260, flash: 1, shake: 9 },
  blast2: { bombs: 60, smoke: 14, smokeWide: 1.4, sparks: 30, sparkSpeed: 220, flash: 0.8, shake: 6 },
  /** Per second: bombs and smoke puffs in the fountain, then while it ebbs (+ bubbles), and bubbles when calm. */
  fountainRate: { bombs: 70, smoke: 12 },
  ebbRate: { bombs: 7, smoke: 5, bubbles: 4 },
  calmBubbles: 3,
  /** Particle caps (a hard ceiling on memory and drawing cost). */
  max: { bombs: 250, smoke: 120, sparks: 300, spots: 400 },
  /** Exponential decay rates (per s) of the flash and the shake after the first blast. */
  flashDecay: 3.2,
  shakeDecay: 2.4,
  /** Whole-view shake in world units per frame px, fading out to nothing `shakeRange` world units from the crater. */
  shakeScale: 1.5,
  shakeRange: 1100,
  /** Height of a bomb is drawn as a rise up the screen (this share of z, frame px). */
  rise: 0.65,
  /** Lava stains stay off the road (it must read as plain asphalt). */
  stainRoad: false,
  /** Margin (frame px) around the view within which particles are still drawn. */
  cullMargin: 70,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Bomb = { x: number; y: number; vx: number; vy: number; z: number; vz: number; r: number; age: number };
type Smoke = { x: number; y: number; vx: number; vy: number; r: number; g: number; age: number; life: number };
type Spark = { x: number; y: number; vx: number; vy: number; age: number; life: number };
type Spot = { x: number; y: number; r: number; age: number };
type Bubble = { x: number; y: number; age: number; life: number; r: number };
/** The visible area in the eruption's frame coordinates. */
type FrameView = { x0: number; x1: number; y0: number; y1: number };

/**
 * The volcano's eruption cycle, in the eruption frame (see ERUPTION.frame): pressure builds in the
 * lake, a first blast throws lava bombs and smoke, a fountain follows, a smaller second blast,
 * then it ebbs and goes quiet before the cycle starts again. `update(dt)` advances game time (the race
 * clock, never the frame rate); a new cycle does not clear the particles still in flight.
 */
export class VolcanoEruption {
  readonly cx: number;
  readonly cy: number;
  private rng: Rng;
  private onRoad: (x: number, y: number) => boolean;
  bombs: Bomb[] = [];
  smoke: Smoke[] = [];
  sparks: Spark[] = [];
  spots: Spot[] = [];
  rings: { age: number }[] = [];
  bubbles: Bubble[] = [];
  t = 0;
  erupted = false;
  second = false;
  flash = 0;
  shake = 0;
  private accB = 0;
  private accS = 0;
  private accBub = 0;
  /** How many of each were ever created (for the checks, and for tuning). */
  readonly spawned = { bombs: 0, smoke: 0, sparks: 0, bubbles: 0 };

  /** `onRoad(x, y)` tells (in frame coordinates) whether a point is on the road, to keep lava stains off it. */
  constructor(rng: Rng, onRoad: (x: number, y: number) => boolean = () => false, cx: number = ERUPTION.frame.cx, cy: number = ERUPTION.frame.cy) {
    this.rng = rng;
    this.onRoad = onRoad;
    this.cx = cx;
    this.cy = cy;
    this.restart(true);
  }

  private R(a: number, b: number) {
    return a + this.rng() * (b - a);
  }

  restart(clear: boolean) {
    if (clear) {
      this.bombs = [];
      this.smoke = [];
      this.sparks = [];
      this.spots = [];
      this.rings = [];
      this.bubbles = [];
    }
    this.t = 0;
    this.erupted = false;
    this.second = false;
    this.flash = 0;
    this.shake = 0;
    this.accB = this.accS = this.accBub = 0;
  }

  spawnBomb(power: number, big: boolean) {
    if (this.bombs.length > ERUPTION.max.bombs) return;
    // Seen from above the burst is round (the original frame was an oblique view: wider than tall).
    const a = this.R(0, TAU), d = Math.sqrt(this.rng()) * 22, sp = this.R(40, 230) * power;
    this.spawned.bombs++;
    this.bombs.push({
      x: this.cx + Math.cos(a) * d, y: this.cy + Math.sin(a) * d,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      z: 6, vz: this.R(180, 430) * power, // z = height above the ground
      r: big ? this.R(4, 8) : this.R(2, 5), age: 0,
    });
  }

  spawnSmoke(n: number, wide: number) {
    for (let i = 0; i < n && this.smoke.length < ERUPTION.max.smoke; i++) {
      this.spawned.smoke++;
      this.smoke.push({
        x: this.cx + this.R(-22, 22) * wide, y: this.cy + this.R(-12, 12), vx: this.R(4, 18), vy: -this.R(14, 34),
        r: this.R(16, 30), g: this.R(14, 30), age: 0, life: this.R(5, 8),
      });
    }
  }

  spawnSparks(x: number, y: number, n: number, spd: number) {
    for (let i = 0; i < n && this.sparks.length < ERUPTION.max.sparks; i++) {
      const a = this.R(0, TAU), s = this.R(20, spd);
      this.spawned.sparks++;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - this.R(20, 70), age: 0, life: this.R(0.4, 0.9) });
    }
  }

  spawnBubble() {
    // Inside the lake (a disc seen from above).
    const a = this.R(0, TAU), d = Math.sqrt(this.rng()) * ERUPTION.lake * 0.92;
    this.spawned.bubbles++;
    this.bubbles.push({ x: this.cx + Math.cos(a) * d, y: this.cy + Math.sin(a) * d, age: 0, life: this.R(0.5, 0.9), r: this.R(3, 8) });
  }

  /** Lake glow, 0.25 → 0.6 (pulsing) while the pressure builds, 1 in the fountain, back down to 0.3 over 5 s. */
  glow() {
    const t = this.t;
    if (t < ERUPTION.pressure) return 0.25 + 0.35 * (t / ERUPTION.pressure) + 0.08 * Math.sin(t * 14);
    if (t < ERUPTION.fountain) return 1;
    return lerp(1, 0.3, Math.min(1, (t - ERUPTION.fountain) / 5));
  }

  /** Advances game time by `dt` seconds; returns the shake, in frame px. */
  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    if (this.t >= ERUPTION.cycle) this.restart(false); // the particles in flight finish naturally
    const t = this.t;

    if (t < ERUPTION.pressure) {
      this.accBub += dt * (4 + t * 5);
      while (this.accBub > 1) {
        this.spawnBubble();
        this.accBub -= 1;
      }
      this.shake = 0.4 + t * 1.1;
    } else if (!this.erupted) {
      const b = ERUPTION.blast;
      this.erupted = true;
      this.flash = b.flash;
      this.shake = b.shake;
      this.rings.push({ age: 0 });
      for (let i = 0; i < b.bombs; i++) this.spawnBomb(this.R(0.5, 1.15), true);
      this.spawnSmoke(b.smoke, b.smokeWide);
      this.spawnSparks(this.cx, this.cy, b.sparks, b.sparkSpeed);
    }
    if (t >= ERUPTION.second && !this.second) {
      const b = ERUPTION.blast2;
      this.second = true;
      this.flash = b.flash;
      this.shake = b.shake;
      this.rings.push({ age: 0 });
      for (let j = 0; j < b.bombs; j++) this.spawnBomb(this.R(0.6, 1.1), true);
      this.spawnSmoke(b.smoke, b.smokeWide);
      this.spawnSparks(this.cx, this.cy, b.sparks, b.sparkSpeed);
    }
    if (t >= ERUPTION.pressure && t < ERUPTION.fountain) {
      this.accB += dt * ERUPTION.fountainRate.bombs;
      this.accS += dt * ERUPTION.fountainRate.smoke;
      while (this.accB > 1) {
        this.spawnBomb(this.R(0.45, 1), this.rng() < 0.3);
        this.accB -= 1;
      }
      while (this.accS > 1) {
        this.spawnSmoke(1, 1.2);
        this.accS -= 1;
      }
      if (this.rng() < 0.5) this.spawnSparks(this.cx + this.R(-20, 20), this.cy + this.R(-12, 12), 3, 150);
    } else if (t >= ERUPTION.fountain && t < ERUPTION.ebb) {
      this.accB += dt * ERUPTION.ebbRate.bombs;
      this.accS += dt * ERUPTION.ebbRate.smoke;
      this.accBub += dt * ERUPTION.ebbRate.bubbles;
      while (this.accB > 1) {
        this.spawnBomb(this.R(0.35, 0.7), false);
        this.accB -= 1;
      }
      while (this.accS > 1) {
        this.spawnSmoke(1, 1);
        this.accS -= 1;
      }
      while (this.accBub > 1) {
        this.spawnBubble();
        this.accBub -= 1;
      }
    } else if (t >= ERUPTION.ebb) {
      this.accBub += dt * ERUPTION.calmBubbles;
      while (this.accBub > 1) {
        this.spawnBubble();
        this.accBub -= 1;
      }
    }
    if (t >= ERUPTION.pressure) this.shake *= Math.exp(-dt * ERUPTION.shakeDecay);
    this.flash *= Math.exp(-dt * ERUPTION.flashDecay);

    // Bombs: ballistic; on landing they leave a lava stain (not on the road, nor in the lake) and two sparks.
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const p = this.bombs[i];
      p.vz -= 520 * dt;
      p.z += p.vz * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += dt;
      if (p.z <= 0 && p.vz < 0) {
        const inLake = Math.hypot(p.x - this.cx, p.y - this.cy) < ERUPTION.lake;
        if (!inLake && (ERUPTION.stainRoad || !this.onRoad(p.x, p.y))) {
          this.spots.push({ x: p.x, y: p.y, r: p.r * 1.8 + this.R(1, 4), age: 0 });
          if (this.spots.length > ERUPTION.max.spots) this.spots.shift();
        }
        this.spawnSparks(p.x, p.y, 2, 60);
        this.bombs.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.age += dt;
      if (p.age > p.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.age += dt;
      if (p.age > p.life) {
        this.smoke.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.g * dt;
    }
    for (let i = this.spots.length - 1; i >= 0; i--) {
      this.spots[i].age += dt;
      if (this.spots[i].age > 9) this.spots.splice(i, 1);
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      this.bubbles[i].age += dt;
      if (this.bubbles[i].age > this.bubbles[i].life) this.bubbles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].age += dt;
      if (this.rings[i].age > 1) this.rings.splice(i, 1);
    }
    return { x: (this.rng() * 2 - 1) * this.shake, y: (this.rng() * 2 - 1) * this.shake };
  }

  private inView(v: FrameView, x: number, y: number, pad = 0) {
    const m = ERUPTION.cullMargin + pad;
    return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
  }

  /** GROUND layer, right after the volcano's scenery and before the cars: lava stains, bomb shadows, the lake's glow and bubbles, smoke. */
  drawGround(ctx: Ctx, v: FrameView) {
    const { cx, cy } = this, g = this.glow(), LR = ERUPTION.lake;
    // Lava stains: orange → black as they cool (5 s), gone at 9 s.
    for (const p of this.spots) {
      if (!this.inView(v, p.x, p.y, p.r)) continue;
      const c = Math.min(1, p.age / 5);
      const col = `${Math.round(lerp(255, 70, c))},${Math.round(lerp(170, 24, c))},${Math.round(lerp(40, 14, c))}`;
      const al = 0.9 * (1 - p.age / 9), rr = p.r * (1 + p.age * 0.12);
      const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      gr.addColorStop(0, `rgba(${col},${al.toFixed(3)})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, TAU);
      ctx.fill();
    }
    // Bomb shadows on the ground (the bomb itself is drawn in the air layer): smaller and fainter the higher it flies.
    ctx.fillStyle = "rgba(10,4,3,0.32)";
    for (const p of this.bombs) {
      if (!this.inView(v, p.x, p.y, 20)) continue;
      const k = 1 / (1 + p.z / 160);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.1 * (0.5 + k), p.r * 0.8 * (0.5 + k), 0, 0, TAU);
      ctx.fill();
    }
    // The lake lights up (additive, so it only ever brightens the lava) and warms the rock around the crater.
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(cx, cy, LR * 0.8, cx, cy, LR * 3.4);
    halo.addColorStop(0, `rgba(255,106,31,${(0.26 * g).toFixed(3)})`);
    halo.addColorStop(1, "rgba(255,106,31,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, LR * 3.4, 0, TAU);
    ctx.fill();
    const lake = ctx.createRadialGradient(cx, cy, 0, cx, cy, LR);
    lake.addColorStop(0, `rgba(255,205,100,${(0.55 * g).toFixed(3)})`);
    lake.addColorStop(0.7, `rgba(255,125,35,${(0.4 * g).toFixed(3)})`);
    lake.addColorStop(1, `rgba(255,75,15,${(0.14 * g).toFixed(3)})`);
    ctx.fillStyle = lake;
    ctx.beginPath();
    ctx.arc(cx, cy, LR, 0, TAU);
    ctx.fill();
    // Bubbles swelling and popping on the surface.
    for (const b of this.bubbles) {
      if (!this.inView(v, b.x, b.y)) continue;
      const u = b.age / b.life;
      ctx.fillStyle = `rgba(255,215,110,${(0.55 * (1 - u)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.35 + 0.65 * u), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,245,200,${(0.9 * (1 - u * u)).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.5 + 1.1 * u), 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    // Smoke drifts over the volcano and the road but stays UNDER the cars: stacked puffs would otherwise hide the player's car.
    for (const p of this.smoke) {
      if (!this.inView(v, p.x, p.y, p.r)) continue;
      const u = p.age / p.life;
      ctx.fillStyle = `rgba(66,57,55,${(0.34 * (1 - u) * Math.min(1, p.age * 2)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
  }

  /** AIR layer, over the cars: shockwaves, bombs, sparks and the flash. */
  drawAir(ctx: Ctx, v: FrameView) {
    const { cx, cy } = this;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const r of this.rings) {
      const u = r.age;
      ctx.strokeStyle = `rgba(255,228,170,${(0.8 * Math.pow(1 - u, 1.5)).toFixed(3)})`;
      ctx.lineWidth = 7 * (1 - u) + 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 38 + u * 250, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    for (const p of this.bombs) {
      // Height shows as a rise up the screen and a slightly bigger body; a short streak trails behind.
      const sy = p.y - p.z * ERUPTION.rise, rr = p.r * (1 + p.z / 420);
      if (!this.inView(v, p.x, sy, rr + 30)) continue;
      const tz = p.z - p.vz * 0.045;
      ctx.strokeStyle = "rgba(255,120,25,0.55)";
      ctx.lineWidth = rr * 1.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045 - tz * ERUPTION.rise);
      ctx.lineTo(p.x, sy);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,105,20,0.96)";
      ctx.beginPath();
      ctx.arc(p.x, sy, rr, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,226,140,1)";
      ctx.beginPath();
      ctx.arc(p.x, sy, rr * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.5;
    for (const p of this.sparks) {
      if (!this.inView(v, p.x, p.y)) continue;
      const u = p.age / p.life;
      ctx.strokeStyle = `rgba(255,${Math.round(lerp(235, 140, u))},80,${(1 - u).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    }
    // The blast's flash: white-yellow, centred on the crater (not the whole screen: nothing blinds the player).
    if (this.flash > 0.01) {
      const f = this.flash;
      for (const [rad, a] of [[150, 1], [380, 0.3]] as const) {
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        gr.addColorStop(0, `rgba(255,252,225,${Math.min(1, f * a).toFixed(3)})`);
        gr.addColorStop(0.4, `rgba(255,205,80,${(f * a * 0.55).toFixed(3)})`);
        gr.addColorStop(1, "rgba(255,150,30,0)");
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }
}

/** Reduced-motion players get a gentler flash and shake (like the victory fireworks). */
function calmFactor() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.35 : 1;
}

/** The eruption as the volcano's hazard: stepped with the race clock, drawn under and over the cars, shaking the view. */
function createEruption(track: Track, rng: Rng): Hazard {
  const { scale, frame } = ERUPTION;
  const toWorld = (x: number, y: number) => vec(CONE.x + (x - frame.cx) * scale, CONE.y + (y - frame.cy) * scale);
  const eruption = new VolcanoEruption(rng, (x, y) => {
    const p = toWorld(x, y);
    return locate(track, p).dist < track.width / 2 + 24;
  });
  const calm = calmFactor();
  let sx = 0, sy = 0;

  /** Runs `draw` in the eruption frame (same transform as the scenery) with the visible area in frame coordinates. */
  const inFrame = (ctx: CanvasRenderingContext2D, view: { minX: number; maxX: number; minY: number; maxY: number }, draw: (v: FrameView) => void) => {
    const v: FrameView = {
      x0: (view.minX - CONE.x) / scale + frame.cx, x1: (view.maxX - CONE.x) / scale + frame.cx,
      y0: (view.minY - CONE.y) / scale + frame.cy, y1: (view.maxY - CONE.y) / scale + frame.cy,
    };
    ctx.save();
    ctx.translate(CONE.x - frame.cx * scale, CONE.y - frame.cy * scale);
    ctx.scale(scale, scale);
    draw(v);
    ctx.restore();
  };

  return {
    step(world, dt) {
      if (world.time < 0) return; // the cycle starts at the green light
      const sh = eruption.update(dt);
      sx = sh.x;
      sy = sh.y;
    },
    drawGround: (ctx, _time, view) => inFrame(ctx, view, (v) => eruption.drawGround(ctx, v)),
    draw: (ctx, _time, view) => {
      const keep = eruption.flash;
      eruption.flash = keep * calm; // gentler flash for reduced motion (restored right after)
      inFrame(ctx, view, (v) => eruption.drawAir(ctx, v));
      eruption.flash = keep;
    },
    shake(at) {
      // Frame px → world units, fading out with distance from the crater.
      const d = Math.hypot(at.x - CONE.x, at.y - CONE.y);
      const k = Math.max(0, 1 - d / ERUPTION.shakeRange) * ERUPTION.shakeScale * calm;
      return { x: sx * k, y: sy * k };
    },
  };
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
    hazard: createEruption,
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
  screen(ctx, v) {
    const g = ctx.createRadialGradient(v.sw / 2, v.sh / 2, Math.min(v.sw, v.sh) * 0.4, v.sw / 2, v.sh / 2, Math.max(v.sw, v.sh) * 0.8);
    g.addColorStop(0, "rgba(10,4,3,0)");
    g.addColorStop(1, "rgba(10,4,3,0.3)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.sw, v.sh);
  },
};
