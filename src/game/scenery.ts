import { locate, type Track } from "./track";
import { type Vec, vec } from "./vec";

// Scenery helpers shared by the per-mode files in ./modes. Everything is generated from a
// fixed seed, so a mode always looks the same; props stay beyond the barriers, lava stops at
// the kerbs.

type Ctx = CanvasRenderingContext2D;
export type Rng = () => number;
export type Circle = { x: number; y: number; r: number };

/** A solid moving body of a hazard: a rotated ellipse (half-axes rx along `angle`, ry across) cars bounce off. */
export type HazardBody = { id: number; x: number; y: number; vx: number; vy: number; angle: number; rx: number; ry: number };

/** A short sound/effect request raised during the simulation; Game.tsx plays it. */
export type Cue = { kind: "growl" | "thud" | "warn" | "sizzle" | "boost" | "takeoff" | "land"; power: number };

/** What a hazard may look at (Race satisfies this) and write to (`cues`). */
export type HazardWorld = {
  time: number;
  phase: "countdown" | "racing" | "finished";
  track: Track;
  /** The cars (the Race's own objects: a hazard may slow one down by writing `speedMul` or `vel`). */
  cars: ReadonlyArray<{ id: number; isPlayer: boolean; pos: Vec; vel: Vec; angle: number; speedMul: number; lastIndex: number; finishTime: number | null; alt: number; shield: number }>;
  cues: Cue[];
};

/** The visible world rectangle (same fields as fx.ts's FxView), for culling what a hazard draws. */
export type HazardView = { minX: number; maxX: number; minY: number; maxY: number };

/** A zone bots steer clear of (a round area on the ground, not a solid body): `brake` = they also slow down for it. */
export type HazardDanger = { id: number; x: number; y: number; r: number; brake: boolean };

/**
 * A mode's dynamic element, built per race by `Scene.hazard` and driven by the simulation clock:
 * a moving obstacle cars bounce off (polar bear: `bodies`, `avoid`, `impact`, `touch`) or a purely
 * visual effect (volcano eruption: only `step` and the drawing hooks). Its state lives in the Race
 * (a fresh one per race), never in the memoized Scene.
 */
export type Hazard = {
  /** How bots react: slow to `slow` × their limit when a body is within `range` px (+ `lookahead` s of their own speed) ahead,
   * and steer to pass it with `margin` px to spare, on the side that is free where the body will be when they get there. */
  avoid?: { range: number; slow: number; margin: number; lookahead: number };
  /** Impact on a car: share of the relative speed it keeps, bounciness, and the closing speed below which it just slides off. */
  impact?: { speedKeep: number; restitution: number; minImpact: number };
  /** Solid bodies cars collide with (none for a purely visual hazard). */
  bodies?(): readonly HazardBody[];
  /** Round zones on the ground bots avoid (needs `avoid`): where something is about to fall, or is burning. */
  dangers?(): readonly HazardDanger[];
  step(world: HazardWorld, dt: number): void;
  /** A car hit `body` hard enough to count as an impact at `at`; true when it counts as a contact (clean-race rule). */
  touch?(body: HazardBody, carId: number, at: Vec, power: number): boolean;
  /** World space, drawn over the ground and under the skid marks and cars. */
  drawGround?(ctx: Ctx, time: number, view: HazardView): void;
  /** World space, drawn over the cars. */
  draw(ctx: Ctx, time: number, view: HazardView): void;
  /** World space, right after car `carId` was drawn at (x, y) heading `angle`: damage marks, flames… */
  drawCarOverlay?(ctx: Ctx, carId: number, x: number, y: number, angle: number): void;
  /** Screen space (pixels), after the whole HUD: the player's own readouts. */
  drawHud?(ctx: Ctx, w: number, h: number): void;
  /** Camera shake (world units) to apply to the whole view when the camera is at `at`. */
  shake?(at: Vec): Vec;
  /** A warning on the ground before something appears (the polar bear's alert): where, where its sign stands, how long ago it was announced (s). Read by the 3D view. */
  warning?(): { x: number; y: number; signX: number; signY: number; age: number } | null;
};

/** What a mode puts on its ground (beyond the barriers). Pure data for the 3D view (render3d.ts), which draws each kind its own way; the 2D art ignores it. */
export type PropKind =
  | "tree" | "fir" | "rock" | "cactus" | "igloo" | "penguin" | "iceblock" | "polarbear" | "bale" | "strawbale" | "hedge" | "grandstand" | "pit" | "tires"
  | "banner" | "tent" | "stand" | "farm" | "cow" | "pillar" | "lavapool";
/** `r` = the radius the mode reserves for it, `a` = its heading (radians) when it has one. */
export type SceneProp = { kind: PropKind; x: number; y: number; r: number; a?: number };

export type Scene = {
  /** The props, with the same positions as the 2D art (optional: only read by the 3D view). */
  props?: readonly SceneProp[];
  /** Wooden fences as polylines (3D view only). */
  fences?: readonly { x: number; y: number }[][];
  /** Lava pools (volcano only): driving into one is the "lava" surface. */
  lava: Circle[];
  /** Smoke sources for the animated layer. */
  vents: Circle[];
  /** Solid round obstacles inside the barriers (hay bales…): cars bounce off them hard. */
  bumpers?: Circle[];
  /** Builds this mode's moving obstacle for one race (`rng` is seeded from the race's own PRNG). */
  hazard?(track: Track, rng: Rng): Hazard;
  /** Spots where nobody may fly (the Racerz Jet lands there). No mode defines one yet. */
  noFly?(x: number, y: number): boolean;
  /** Floor altitude (m) here when it is not the mode's usual one (the volcano's crater lake: no wall, but nowhere to land); undefined elsewhere. */
  floorAlt?(x: number, y: number): number | undefined;
  /** Ground painted under the track. */
  under(ctx: Ctx): void;
  /** Texture painted over the asphalt (dust, ice streaks…). */
  onTrack?(ctx: Ctx): void;
  /** Props painted after the track. */
  over(ctx: Ctx): void;
  /**
   * Ceiling of a covered section (tunnel roof, crater rim seen from inside…), painted once
   * into its own offscreen layer and blitted after the cars so it can fade out over the player.
   */
  overhead?(ctx: Ctx): void;
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

export const TAU = Math.PI * 2;
/** Gap kept between anything and the barriers / kerbs. */
const MARGIN = 14;
export const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

/** Props stay beyond the barriers. */
export function isClear(track: Track, x: number, y: number, r: number) {
  return locate(track, vec(x, y)).dist > track.barrier + MARGIN + r;
}

/** Lava may reach into the runoff, right up to the kerbs. */
export function lavaClear(track: Track, x: number, y: number, r: number) {
  return locate(track, vec(x, y)).dist > track.width / 2 + MARGIN + r;
}

function overlaps(occ: Circle[], x: number, y: number, r: number) {
  return occ.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r) ** 2);
}

/** Rejection-sample up to n free spots off the track; accepted spots are added to occ. */
export function scatter(track: Track, rng: Rng, occ: Circle[], n: number, rMin: number, rMax: number): Circle[] {
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
export function scatterNear(track: Track, rng: Rng, occ: Circle[], n: number, c: Circle, spread: number, r: number): Circle[] {
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

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function disc(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ellipse(ctx, x, y, r, r, 0, fill);
}

/** Soft cast shadow, offset toward the bottom-right (sun top-left). */
export function shadow(ctx: Ctx, x: number, y: number, rx: number, ry = rx) {
  ellipse(ctx, x + rx * 0.3, y + ry * 0.35, rx, ry, 0, "rgba(0,0,0,0.22)");
}

/** Radial fade from rgb at `alpha` to the same rgb fully transparent (fading to black would grey it). */
export function softBlob(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, rgb: string, alpha: number) {
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

export function rock(ctx: Ctx, rng: Rng, c: Circle, base: string, light: string) {
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
export function onTrackPoint(track: Track, i: number, offset: number) {
  const p = track.path[i], t = track.tangents[i];
  return { x: p.x - t.y * offset, y: p.y + t.x * offset, a: Math.atan2(t.y, t.x) };
}


/**
 * Roughens a polyline into a broken line: every segment is split into ~22-unit steps and each
 * vertex is shifted by up to ±amp on both axes. A fixed `seed` (small LCG) makes the result
 * identical on every run, so a cliff edge looks the same every race. The last input point is
 * not emitted, so a closed loop can be passed with its first point repeated at the end.
 */
export function jagged(pts: [number, number][], amp = 8, seed = 1): [number, number][] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const steps = Math.max(2, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 22));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push([x1 + (x2 - x1) * t + (rnd() - 0.5) * amp * 2, y1 + (y2 - y1) * t + (rnd() - 0.5) * amp * 2]);
    }
  }
  return out;
}
