import type { Fx } from "../fx";
import { disc, mulberry32, range, rock, scatter, TAU, type Circle, type Hazard, type HazardDanger, type HazardWorld, type Rng, type Scene, softBlob } from "../scenery";
import { locate, type Track, type TrackLayout } from "../track";
import { cachedPadSpots, nearPad } from "../boost";
import { CAR_RADIUS } from "../car";
import { vec } from "../vec";

// Volcano: one big cone in the middle of the map, seen from above with the sun at the top-left.
// Three rings of black rock (irregular outlines, lit on the upper-left, shaded on the lower-right)
// climb to a crater whose lava lake is purely decorative. The circuit enters at the bottom, climbs
// the cone's east flank, skirts the crater along its right-hand rim and leaves by the top, then
// loops back round the west side of the map. The only lava anywhere is the lake and two small
// pools in opposite corners of the terrain. The volcano erupts in a loop (see ERUPTION and
// VolcanoEruption below): a decorative show driven by the race clock that never touches the cars. Only the
// aimed bombs (VolcanoHazards, further down) hurt: they warn first, then damage, burn and slow a car.

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

// ---------- eruption hazards: aimed lava bombs, damage, lava pools ----------
//
// During the eruption, red targets appear on the road; 1.5 s later a lava bomb falls on each one. A car
// inside the target loses 20 HP (explosion, "-20", shake, red screen), every impact leaves a lava pool that
// burns 5 HP per second for 9 s before it cools, and a damaged car smokes, burns and slows down. It is an
// obstacle, never a death: at 0 HP the car keeps rolling at 35 % speed and can lose nothing more. The
// decorative bombs of VolcanoEruption never hurt anyone: only these aimed ones do.
//
// The code runs in a "design" frame in which a car is 16 × 28 (ours are 22 × 40 world units): one design
// unit is HZ_SCALE world units, and everything is drawn with ctx.scale(HZ_SCALE) from the world origin.

export const HZ_SCALE = 40 / 28;

export const HZ = {
  MAX_HP: 100, BOMB_DAMAGE: 20, POOL_DPS: 5, POOL_LIFE: 9, POOL_RADIUS: 24,
  TARGET_R: 20, // target radius = real radius of the hit (the car's own radius is added: any part of the car inside the ring is hit)
  WARN_TIME: 1.5, FALL_TIME: 0.6, MAX_TARGETS: 3,
  SPAWN_MIN: 1.2, SPAWN_MAX: 2.0,
  ACTIVE_FROM: 2.2, ACTIVE_TO: 7.0, // window within the eruption cycle (s)
  NO_HAZARD_FIRST: 8, SAFE_FINISH_DIST: 150,
  MIN_SPAWN_DIST: 90, AHEAD_MIN: 120, AHEAD_MAX: 320,
  INVULN: 1.0, HIT_SLOW: 0.6, LOW_HP: 25, LOW_SLOW: 0.6, ZERO_HP_CAP: 0.35,
  // Added for this game's speeds (design units; cars here are several times faster than in the 680 × 460 prototype):
  /** Share of targets aimed at the player (the others at any car). */
  PLAYER_SHARE: 0.7,
  /** A target is aimed where the car will be when the bomb lands: at least AHEAD_MIN..AHEAD_MAX ahead, further when it goes fast, never beyond this. */
  AIM_MAX: 640, AIM_SPREAD: [0.85, 1.1] as readonly [number, number],
  /** Bots: slow to this share of their limit when a target is within `AI_RANGE` ahead (+ `AI_LOOKAHEAD` s of their speed) and steer round it with this margin. */
  AI_RANGE: 100, AI_LOOKAHEAD: 0.8, AI_SLOW: 0.55, AI_MARGIN: 10,
  /** How close (world units) to the player a target / impact is still heard. */
  EARSHOT: 1000,
};

/** The world's way into the hazard code. */
type HzCar = HazardWorld["cars"][number];
type HzRoadPoint = { x: number; y: number; nx: number; ny: number; halfWidth: number };
type HzAdapter = {
  pos(car: HzCar): { x: number; y: number };
  radius(car: HzCar): number;
  speed(car: HzCar): number;
  isPlayer(car: HzCar): boolean;
  /** Point of the centre line `ahead` design units in front of the car; null when it is too close to the start / finish. */
  roadAhead(car: HzCar, ahead: number): HzRoadPoint | null;
  nearFinish(x: number, y: number): boolean;
  /** Whether a spot is on a boost pad (bombs, and so lava pools, never land there). */
  nearPad(x: number, y: number): boolean;
  /** Top speed and acceleration are scaled together by this factor. */
  setSpeedMultiplier(car: HzCar, f: number): void;
  scaleSpeedOnce(car: HzCar, f: number): void;
  onWarn(tg: HzTarget): void;
  onImpact(tg: HzTarget): void;
  onDamage(car: HzCar, amount: number, small: boolean): void;
};

type HzTarget = { id: number; x: number; y: number; age: number };
type HzPool = { id: number; x: number; y: number; age: number; shape: number[] };
type HzState = { hp: number; shown: number; invuln: number; smokeAcc: number; markDist: number; poolT: number; inPool: boolean };
type HzPopup = { x: number; y: number; text: string; size: number; age: number };
type HzDot = { x: number; y: number; vx: number; vy: number; age: number; life: number };
type HzPuff = { x: number; y: number; vx: number; vy: number; r: number; g: number; age: number; life: number; dark: boolean };

/** Irregular nine-point lava pool outline. */
function blob(ctx: Ctx, x: number, y: number, r: number, shape: number[], fill: string, alpha = 1, stroke: string | null = null, lw = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  shape.forEach((m, i) => {
    const a = (i / shape.length) * TAU, px = x + Math.cos(a) * r * m * 1.15, py = y + Math.sin(a) * r * m * 0.9;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
}

export class VolcanoHazards {
  private A: HzAdapter;
  private rng: Rng;
  private eruption: VolcanoEruption | null;
  /** Reduced motion: no shake, no blinking. */
  private calm: boolean;
  /** Off = no aimed bomb is ever thrown (the decorative eruption goes on): for the checks. */
  armed = true;
  t = 0;
  spawnIn = 2;
  targets: HzTarget[] = [];
  pools: HzPool[] = [];
  popups: HzPopup[] = [];
  splashes: HzDot[] = [];
  flashes: { x: number; y: number; age: number }[] = [];
  puffs: HzPuff[] = [];
  marks: { x: number; y: number; age: number }[] = [];
  shake = 0;
  vignette = 0;
  cars: readonly HzCar[] = [];
  private state = new Map<HzCar, HzState>();
  private nextId = 1;

  constructor(adapter: HzAdapter, eruption: VolcanoEruption | null, rng: Rng, calm = false) {
    this.A = adapter;
    this.eruption = eruption;
    this.rng = rng;
    this.calm = calm;
    this.reset();
  }

  private R(a: number, b: number) {
    return a + this.rng() * (b - a);
  }

  reset() {
    this.t = 0;
    this.spawnIn = 2;
    this.targets = [];
    this.pools = [];
    this.popups = [];
    this.splashes = [];
    this.flashes = [];
    this.puffs = [];
    this.marks = [];
    this.shake = 0;
    this.vignette = 0;
    this.state = new Map();
  }

  st(car: HzCar): HzState {
    let s = this.state.get(car);
    if (!s) {
      s = { hp: HZ.MAX_HP, shown: HZ.MAX_HP, invuln: 0, smokeAcc: 0, markDist: 0, poolT: 0, inPool: false };
      this.state.set(car, s);
    }
    return s;
  }

  /** Advances by `dt` (race clock); returns the shake to add to the view, in design px. */
  update(dt: number, cars: readonly HzCar[], raceTime: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.cars = cars;
    const et = this.eruption ? this.eruption.t : this.t % 10.5; // time within the eruption cycle
    const active = et >= HZ.ACTIVE_FROM && et <= HZ.ACTIVE_TO;

    this.spawnIn -= dt;
    if (this.spawnIn < -1) this.spawnIn = 0.5;
    if (this.armed && active && raceTime > HZ.NO_HAZARD_FIRST && this.spawnIn <= 0 && this.targets.length < HZ.MAX_TARGETS) {
      // A refused spot is retried soon (it can only be a car in the way, or the start / finish); an accepted one waits SPAWN_MIN..MAX.
      this.spawnIn = this.trySpawn(cars) ? this.R(HZ.SPAWN_MIN, HZ.SPAWN_MAX) : 0.25;
    }
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const tg = this.targets[i];
      tg.age += dt;
      if (tg.age >= HZ.WARN_TIME) {
        this.impact(tg, cars);
        this.targets.splice(i, 1);
      }
    }

    const burning = new Set<HzCar>(); // a car in several overlapping pools burns once, not once per pool
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const pl = this.pools[i];
      pl.age += dt;
      if (pl.age > HZ.POOL_LIFE + 1) {
        this.pools.splice(i, 1);
        continue;
      }
      if (pl.age >= HZ.POOL_LIFE) continue; // cooled: harmless
      for (const car of cars) {
        const p = this.A.pos(car);
        if (Math.hypot(p.x - pl.x, p.y - pl.y) < HZ.POOL_RADIUS) burning.add(car);
      }
    }
    for (const car of cars) {
      const s = this.st(car);
      s.inPool = burning.has(car);
      if (!s.inPool) continue;
      s.poolT += dt;
      if (s.poolT >= 1) {
        s.poolT -= 1;
        this.damage(car, HZ.POOL_DPS, true); // one tick per second spent in a pool: "-5"
      }
    }

    for (const car of cars) {
      const s = this.st(car), p = this.A.pos(car);
      if (!s.inPool) s.poolT = 0;
      s.invuln = Math.max(0, s.invuln - dt);
      s.shown = s.hp < s.shown ? Math.max(s.hp, s.shown - 30 * dt) : s.hp; // the white segment catches up with the real value
      const ratio = s.hp / HZ.MAX_HP;
      let f = 1;
      if (s.hp === 0) f = HZ.ZERO_HP_CAP;
      else if (ratio * 100 <= HZ.LOW_HP) f = HZ.LOW_SLOW;
      this.A.setSpeedMultiplier(car, f);

      const rate = ratio <= 0.25 ? 12 : ratio <= 0.5 ? 4 : 0; // smoke
      s.smokeAcc += rate * dt;
      while (s.smokeAcc >= 1 && this.puffs.length < 150) {
        s.smokeAcc -= 1;
        this.puffs.push({ x: p.x + this.R(-4, 4), y: p.y + this.R(-4, 4), vx: this.R(4, 14), vy: -this.R(14, 30), r: this.R(6, 10), g: this.R(10, 18), age: 0, life: this.R(1.2, 2.0), dark: ratio <= 0.25 });
      }
      if (ratio <= 0.25) {
        // Black marks behind the car.
        s.markDist += this.A.speed(car) * dt;
        if (s.markDist > 14) {
          s.markDist = 0;
          if (this.marks.length < 300) this.marks.push({ x: p.x, y: p.y, age: 0 });
        }
      }
    }

    const age = <T extends { age: number; life?: number }>(arr: T[], life: number, fn?: (o: T) => void) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i];
        o.age += dt;
        if (fn) fn(o);
        if (o.age > (o.life || life)) arr.splice(i, 1);
      }
    };
    age(this.popups, 0.9, (o) => { o.y -= 40 * dt; });
    age(this.flashes, 0.25);
    age(this.splashes, 0.8, (o) => { o.x += o.vx * dt; o.y += o.vy * dt; });
    age(this.puffs, 2, (o) => { o.x += o.vx * dt; o.y += o.vy * dt; o.r += o.g * dt; });
    age(this.marks, 6);
    this.shake *= Math.exp(-dt * 6);
    this.vignette *= Math.exp(-dt * 3);
    if (this.calm) return { x: 0, y: 0 };
    return { x: this.R(-1, 1) * this.shake, y: this.R(-1, 1) * this.shake };
  }

  /** Aims a new target (in design coordinates) and announces it. Public so a check can place one. */
  addTarget(x: number, y: number): HzTarget {
    const tg = { id: this.nextId++, x, y, age: 0 };
    this.targets.push(tg);
    this.A.onWarn(tg);
    return tg;
  }

  private trySpawn(cars: readonly HzCar[]): boolean {
    const players = cars.filter((c) => this.A.isPlayer(c));
    const car = players.length && this.rng() < HZ.PLAYER_SHARE ? players[0] : cars[Math.floor(this.rng() * cars.length)];
    // Where the car will be when the bomb lands (so a target on the line it drives cannot simply be passed before it falls),
    // never closer than the prototype's 120..320 and never so far it is off screen for good.
    const reach = (this.A.speed(car) * HZ.WARN_TIME) * this.R(HZ.AIM_SPREAD[0], HZ.AIM_SPREAD[1]);
    const ahead = Math.min(HZ.AIM_MAX, Math.max(this.R(HZ.AHEAD_MIN, HZ.AHEAD_MAX), reach));
    const rp = this.A.roadAhead(car, ahead);
    if (!rp) return false;
    const off = this.R(-0.5, 0.5) * rp.halfWidth;
    const x = rp.x + rp.nx * off, y = rp.y + rp.ny * off;
    if (this.A.nearFinish(x, y) || this.A.nearPad(x, y)) return false;
    for (const c of cars) {
      const p = this.A.pos(c);
      if (Math.hypot(p.x - x, p.y - y) < HZ.MIN_SPAWN_DIST) return false;
    }
    for (const t of this.targets) if (Math.hypot(t.x - x, t.y - y) < 60) return false;
    this.addTarget(x, y);
    return true;
  }

  private impact(tg: HzTarget, cars: readonly HzCar[]) {
    this.flashes.push({ x: tg.x, y: tg.y, age: 0 });
    for (let i = 0; i < 7; i++) {
      const a = this.R(0, TAU), sp = this.R(40, 120);
      this.splashes.push({ x: tg.x, y: tg.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: this.R(0.4, 0.8) });
    }
    this.pools.push({ id: this.nextId++, x: tg.x, y: tg.y, age: 0, shape: Array.from({ length: 9 }, () => this.R(0.85, 1.15)) });
    for (const car of cars) {
      const p = this.A.pos(car), s = this.st(car);
      if (s.invuln <= 0 && Math.hypot(p.x - tg.x, p.y - tg.y) < HZ.TARGET_R + this.A.radius(car)) {
        const before = s.hp;
        this.damage(car, HZ.BOMB_DAMAGE, false);
        if (before > 0) {
          this.A.scaleSpeedOnce(car, HZ.HIT_SLOW);
          s.invuln = HZ.INVULN;
        }
      }
    }
    this.A.onImpact(tg);
  }

  damage(car: HzCar, amount: number, small: boolean) {
    const s = this.st(car);
    if (s.hp <= 0) return;
    s.hp = Math.max(0, s.hp - amount);
    const p = this.A.pos(car);
    this.popups.push({ x: p.x + 10, y: p.y - 20, text: "-" + amount, size: small ? 15 : 26, age: 0 });
    if (this.A.isPlayer(car)) {
      this.vignette = 1;
      if (!small) this.shake = Math.max(this.shake, 6);
    }
    this.A.onDamage(car, amount, small);
  }

  /** What bots steer round, in WORLD units: the targets (they brake for these too) and the burning pools. */
  dangers(): HazardDanger[] {
    const out: HazardDanger[] = [];
    for (const t of this.targets) out.push({ id: 1000 + t.id, x: t.x * HZ_SCALE, y: t.y * HZ_SCALE, r: HZ.TARGET_R * HZ_SCALE, brake: true });
    for (const p of this.pools) if (p.age < HZ.POOL_LIFE) out.push({ id: 100000 + p.id, x: p.x * HZ_SCALE, y: p.y * HZ_SCALE, r: HZ.POOL_RADIUS * HZ_SCALE, brake: false });
    return out;
  }

  /** GROUND layer: after the volcano's scenery, BEFORE the cars (design frame). */
  drawGround(ctx: Ctx) {
    for (const m of this.marks) {
      ctx.fillStyle = `rgba(21,16,14,${0.5 * (1 - m.age / 6)})`;
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, 5, 3, 0, 0, TAU);
      ctx.fill();
    }
    for (const pl of this.pools) {
      // Pools: hot, then cooled.
      const heat = Math.max(0, 1 - pl.age / HZ.POOL_LIFE);
      const fade = pl.age > HZ.POOL_LIFE ? 1 - (pl.age - HZ.POOL_LIFE) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(pl.x, pl.y, 0, pl.x, pl.y, HZ.POOL_RADIUS * 3);
      g.addColorStop(0, `rgba(255,106,31,${0.25 * heat})`);
      g.addColorStop(1, "rgba(255,106,31,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, HZ.POOL_RADIUS * 3, 0, TAU);
      ctx.fill();
      ctx.restore();
      const crust = `rgb(${Math.round(lerp(58, 90, heat))},${Math.round(lerp(20, 26, heat))},${Math.round(lerp(16, 16, heat))})`;
      blob(ctx, pl.x, pl.y, HZ.POOL_RADIUS, pl.shape, crust, 1, "#2a0f0a", 3);
      if (heat > 0.02) {
        blob(ctx, pl.x, pl.y, HZ.POOL_RADIUS * 0.8, pl.shape, "#e8461a", heat);
        blob(ctx, pl.x, pl.y, HZ.POOL_RADIUS * 0.55, pl.shape, "#ff8a24", heat);
        blob(ctx, pl.x, pl.y, HZ.POOL_RADIUS * 0.3, pl.shape, "#ffd45a", heat);
      }
      ctx.restore();
    }
    for (const t of this.targets) {
      // Red targets.
      const left = HZ.WARN_TIME - t.age;
      const blink = left < 0.5 && !this.calm ? (Math.sin(t.age * 40) > 0 ? 1 : 0.35) : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.translate(t.x, t.y);
      ctx.fillStyle = "rgba(255,59,47,0.16)";
      ctx.beginPath();
      ctx.arc(0, 0, HZ.TARGET_R, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#ff3b2f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, HZ.TARGET_R, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,59,47,0.5)"; // closing ring
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, HZ.TARGET_R + 9 + 14 * (left / HZ.WARN_TIME), 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 7);
      ctx.stroke();
      if (left < HZ.FALL_TIME) {
        // The falling bomb's growing shadow.
        const k = 1 - left / HZ.FALL_TIME;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(0, 0, 3 + 9 * k, (3 + 9 * k) * 0.6, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** In the drawing of EACH car, right after its body: burnt body and flames. Local frame of the car (front toward -y, 16 × 28). */
  drawCarOverlay(ctx: Ctx, carId: number, x: number, y: number, angle: number) {
    const car = this.cars.find((c) => c.id === carId);
    if (!car) return;
    const ratio = this.st(car).hp / HZ.MAX_HP;
    if (ratio > 0.25) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2); // our sprites face +x; the overlay's front is -y
    ctx.scale(HZ_SCALE, HZ_SCALE);
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    ctx.roundRect(-8, -14, 16, 28, 4);
    ctx.fill();
    const f = this.calm ? 1 : 0.8 + 0.4 * Math.sin(performance.now() / 70); // flickering flames
    ctx.fillStyle = "#ff8a24";
    ctx.beginPath();
    [[-6.4, -11.4], [-3.6, -22.9 * f], [0, -15.7], [2.9, -24.3 * f], [6.4, -11.4]].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd45a";
    ctx.beginPath();
    [[-2.9, -11.4], [0, -18.6 * f], [2.9, -11.4]].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** AIR layer, AFTER the cars: falling bombs, flashes, splashes, smoke, damage numbers (design frame). */
  drawAir(ctx: Ctx) {
    for (const t of this.targets) {
      const left = HZ.WARN_TIME - t.age;
      if (left > HZ.FALL_TIME) continue;
      const k = 1 - left / HZ.FALL_TIME, z = 260 * (1 - k * k), sx = t.x, sy = t.y - z * 0.55;
      ctx.strokeStyle = "rgba(255,138,36,0.5)";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 26);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,106,31,0.35)";
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ff8a24";
      ctx.beginPath();
      ctx.arc(sx, sy, 7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffd45a";
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, TAU);
      ctx.fill();
    }
    for (const f of this.flashes) {
      // 16-point star explosion.
      const a = 1 - f.age / 0.25;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 14 : 30, an = (i / 16) * TAU;
        const x = f.x + Math.cos(an) * r, y = f.y + Math.sin(an) * r;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = "#ff8a24";
      ctx.fill();
      ctx.strokeStyle = "#ffd45a";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = "#fff3b0";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 11, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    for (const sp of this.splashes) {
      ctx.fillStyle = `rgba(255,106,31,${1 - sp.age / sp.life})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3, 0, TAU);
      ctx.fill();
    }
    for (const p of this.puffs) {
      const c = p.dark ? "58,53,50" : "90,84,80", a = 0.7 * (1 - p.age / p.life);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(${c},${a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    for (const p of this.popups) {
      // "-20" / "-5", red with a white outline.
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.age / 0.9);
      ctx.font = `bold ${p.size}px sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "#ff3b2f";
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  /** HUD in SCREEN pixels, for the player's car only. */
  drawHud(ctx: Ctx, W: number, H: number) {
    const car = this.cars.find((c) => this.A.isPlayer(c));
    if (!car) return;
    ctx.save();
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    const s = this.st(car), ratio = s.hp / HZ.MAX_HP;
    const v = Math.min(0.9, Math.max(0, 0.5 - ratio) * 1.8) + this.vignette * 0.5; // red edges
    if (v > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.65);
      g.addColorStop(0, "rgba(208,0,0,0)");
      g.addColorStop(1, `rgba(208,0,0,${Math.min(0.8, v)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // Under the race HUD, to the right of the sound button.
    const x = 58, y = 148;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(x, y, 240, 26, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("PV", x + 12, y + 18);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.roundRect(x + 36, y + 7, 150, 12, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(x + 36, y + 7, Math.max(0, (150 * s.shown) / HZ.MAX_HP), 12, 6); // white segment: the recent loss
    ctx.fill();
    ctx.fillStyle = ratio > 0.5 ? "#3ddc84" : ratio > 0.25 ? "#ff9f1c" : "#d63a2f";
    if (s.hp > 0) {
      ctx.beginPath();
      ctx.roundRect(x + 36, y + 7, 150 * ratio, 12, 6);
      ctx.fill();
    }
    ctx.fillStyle = ratio <= 0.25 ? "#ff6b5f" : "#fff";
    ctx.fillText(Math.round(ratio * 100) + "%", x + 198, y + 18);
    if (ratio * 100 <= HZ.LOW_HP) {
      // Slowdown badge.
      const cut = Math.round((1 - (s.hp === 0 ? HZ.ZERO_HP_CAP : HZ.LOW_SLOW)) * 100);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.roundRect(x, y + 34, 130, 24, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(`↓ Vitesse −${cut} %`, x + 12, y + 51);
    }
    if (this.targets.length && (this.calm || Math.sin(performance.now() / 120) > -0.3)) {
      // Blinking warning triangle, top centre (the minimap is on the right).
      const ax = W / 2, ay = 14;
      ctx.fillStyle = "#ff9f1c";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + 16, ay + 28);
      ctx.lineTo(ax - 16, ay + 28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", ax, ay + 25);
    }
    ctx.restore();
  }
}

/** Reduced-motion players get a gentler flash and shake (like the victory fireworks). */
function calmFactor() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.35 : 1;
}

/** The volcano's hazard: the decorative eruption plus the aimed bombs, pools and damage, stepped by the race clock. */
export type VolcanoHazard = Hazard & { eruption: VolcanoEruption; hazards: VolcanoHazards };

export function createVolcano(track: Track, rng: Rng): VolcanoHazard {
  const { scale, frame } = ERUPTION;
  const toWorld = (x: number, y: number) => vec(CONE.x + (x - frame.cx) * scale, CONE.y + (y - frame.cy) * scale);
  const eruption = new VolcanoEruption(rng, (x, y) => {
    const p = toWorld(x, y);
    return locate(track, p).dist < track.width / 2 + 24;
  });
  const calm = calmFactor();
  let sx = 0, sy = 0;
  let cues: HazardWorld["cues"] = [];
  const S = HZ_SCALE;

  /** The player's own car, for sounds. */
  const heard = (x: number, y: number, cars: readonly HzCar[]) => {
    const me = cars.find((c) => c.isPlayer);
    return me ? Math.hypot(me.pos.x - x * S, me.pos.y - y * S) : Infinity;
  };
  const cue = (kind: "warn" | "thud" | "sizzle", power: number) => {
    if (cues.length < 16) cues.push({ kind, power });
  };

  const adapter: HzAdapter = {
    pos: (car) => ({ x: car.pos.x / S, y: car.pos.y / S }),
    radius: () => (CAR_RADIUS * 0.8) / S,
    speed: (car) => Math.hypot(car.vel.x, car.vel.y) / S,
    isPlayer: (car) => car.isPlayer,
    nearFinish: (x, y) => Math.hypot(x * S - track.path[0].x, y * S - track.path[0].y) < HZ.SAFE_FINISH_DIST * S,
    nearPad: (x, y) => nearPad(cachedPadSpots("volcano"), track.width, x * S, y * S, (HZ.TARGET_R + 6) * S),
    roadAhead(car, ahead) {
      const n = track.path.length;
      let i = car.lastIndex, d = 0;
      for (let k = 0; k < n && d < ahead * S; k++) {
        const a = track.path[i], b = track.path[(i + 1) % n];
        d += Math.hypot(b.x - a.x, b.y - a.y);
        i = (i + 1) % n;
      }
      const p = track.path[i], t = track.tangents[i];
      if (this.nearFinish(p.x / S, p.y / S)) return null;
      return { x: p.x / S, y: p.y / S, nx: -t.y, ny: t.x, halfWidth: track.width / 2 / S };
    },
    setSpeedMultiplier: (car, f) => {
      car.speedMul = f;
    },
    scaleSpeedOnce: (car, f) => {
      car.vel = { x: car.vel.x * f, y: car.vel.y * f };
    },
    // Sounds: a target appearing within earshot, any impact within earshot (louder the closer), a tick of burning for the player.
    onWarn: (tg) => {
      if (heard(tg.x, tg.y, hz.cars) < HZ.EARSHOT) cue("warn", 1);
    },
    onImpact: (tg) => {
      const d = heard(tg.x, tg.y, hz.cars);
      if (d < HZ.EARSHOT) cue("thud", Math.max(0.25, 1 - d / HZ.EARSHOT));
    },
    onDamage: (car, _amount, small) => {
      if (car.isPlayer && small) cue("sizzle", 1);
    },
  };
  const hz = new VolcanoHazards(adapter, eruption, rng, calm < 1);

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
  /** Runs `draw` in the hazards' design frame (a world scaled by HZ_SCALE about the origin). */
  const inDesign = (ctx: CanvasRenderingContext2D, draw: () => void) => {
    ctx.save();
    ctx.scale(S, S);
    draw();
    ctx.restore();
  };

  let hx = 0, hy = 0; // hazard shake, design px
  return {
    eruption,
    hazards: hz,
    avoid: { range: HZ.AI_RANGE * S, slow: HZ.AI_SLOW, margin: HZ.AI_MARGIN * S, lookahead: HZ.AI_LOOKAHEAD },
    dangers: () => hz.dangers(),
    step(world, dt) {
      if (world.time < 0) return; // the cycle starts at the green light
      cues = world.cues;
      const sh = eruption.update(dt);
      sx = sh.x;
      sy = sh.y;
      const h = hz.update(dt, world.cars, world.time);
      hx = h.x;
      hy = h.y;
    },
    drawGround: (ctx, _time, view) => {
      inFrame(ctx, view, (v) => eruption.drawGround(ctx, v));
      inDesign(ctx, () => hz.drawGround(ctx));
    },
    draw: (ctx, _time, view) => {
      const keep = eruption.flash;
      eruption.flash = keep * calm; // gentler flash for reduced motion (restored right after)
      inFrame(ctx, view, (v) => eruption.drawAir(ctx, v));
      eruption.flash = keep;
      inDesign(ctx, () => hz.drawAir(ctx));
    },
    drawCarOverlay: (ctx, carId, x, y, angle) => hz.drawCarOverlay(ctx, carId, x, y, angle),
    drawHud: (ctx, w, h) => hz.drawHud(ctx, w, h),
    shake(at) {
      // Eruption: frame px → world units, fading out with distance from the crater. Hazard hits: the player's own, undiminished.
      const d = Math.hypot(at.x - CONE.x, at.y - CONE.y);
      const k = Math.max(0, 1 - d / ERUPTION.shakeRange) * ERUPTION.shakeScale * calm;
      return { x: sx * k + hx * S, y: sy * k + hy * S };
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
    hazard: createVolcano,
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
