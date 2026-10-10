import type { Car } from "./car";
import { type Rng, TAU, mulberry32 } from "./scenery";
import { isCovered, locate, type Track } from "./track";

// Boost pads: decorative plates on the straights (no collision: cars simply drive over them). A car
// whose centre crosses one gets a TURBO — top speed AND acceleration ×1.5 for 2 s (the last 0.5 s ease back
// to ×1), plus a one-off ×1.2 kick on its current speed. Re-triggering while boosting only refills the 2 s
// (no ×1.5 × 1.5); a pad needs 3 s to recharge FOR EACH CAR; an impact leaves the turbo 0.3 s.
//
// The multiplier is `car.boostMul`: stepCar multiplies it with `car.speedMul` (the volcano's damage
// slowdown) and the surface limits, so every effect combines. Everything is deterministic (placement
// from the track alone, visual randomness from a seeded PRNG, nothing here touches the race's own PRNG),
// and the pads are drawn each frame — never in the cached static layer — so their glow can react.
//
// This module only depends on car/track/scenery types: race.ts runs it (`update`, `cut`, `factor`),
// render.ts draws it (`drawGround`, `drawBehind`, `drawCarFlame`, `drawHud`), volcano.ts asks
// `padNear` to keep its bombs off the pads.

type Ctx = CanvasRenderingContext2D;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const BOOST = {
  MULT: 1.5, KICK: 1.2, DURATION: 2.0, EASE: 0.5, COOLDOWN: 3.0,
  /** A collision leaves this many seconds of turbo. */
  HIT_LEFT: 0.3,
  /** Impacts weaker than this closing speed (u/s) are brushes, not collisions (same threshold as race.ts's crash counter). */
  HIT_SPEED: 80,
  PAD_W: 114, PAD_L: 92, PAD_RATIO: 0.74,
  /** Design units → world units for what is drawn around the car (the design car is 16 × 28, ours 22 × 40). */
  SCALE: 40 / 28,
  GHOSTS: 6, GHOST_EVERY: 0.04, STREAK_EVERY: 0.03, PART_EVERY: 0.02, MAX_PARTS: 200, MAX_STREAKS: 80,
  /** Pads per lap. */
  COUNT: 3,
  MIN_GAP: 400, START_SAFE: 200, FINISH_SAFE: 200, STRAIGHT_LEN: 250,
  /** Largest curvature (1/px) allowed on the 250 px ahead of a pad. These circuits are gentle (median radius ~1 000 px), so 0.004 (250 px radius) would still put pads in visible bends. */
  MAX_CURV: 0.0015,
  /** Sideways shift of a pad, as a share of the road width (kept so the pad stays on the asphalt). */
  LATERAL: 0.15,
  /** A pad keeps this far (px) from hay bales ahead of it, so a turbo never carries a car into them at speed. */
  CLEAR_AHEAD: 1200,
  /** Frame rate under which the ghost images, then the speed streaks, are switched off. */
  LOW_FPS: 40,
};

type Pt = [number, number];
const CHEV: Pt[] = [[-30, 10], [0, -8], [30, 10], [30, 22], [0, 4], [-30, 22]]; // arrow
const CHEV_Y = [18, -2, -22]; // from the rear to the front (the front is -y)
const CHEV_A = [0.55, 0.78, 1]; // the front arrow is the brightest

export type BoostStyleId = "desert" | "volcano" | "north" | "classic";
type Deco = { x: number; y: number; r: number; fill: string; a: number; stroke?: string };
type BoostStyle = {
  glow: string; glowA: number; base: string; stroke: string; inner?: string; rim?: string; gloss?: boolean;
  chevFill: string[]; chevStroke: string[]; deco: Deco[]; flame: [string, string];
  part: { rgb: string; a: number; grow: number; life: number };
};
const decos = (rows: number[][], fill: string, a: number, stroke?: string): Deco[] => rows.map(([x, y, r]) => ({ x, y, r, fill, a, stroke }));
const WEST = [[-61, 56, 7], [-69, 70, 9], [63, 60, 8], [73, 74, 6]];

/** Pad looks, one per mode family (stone, basalt and lava, ice, yellow asphalt). */
export const BOOST_STYLES: Record<BoostStyleId, BoostStyle> = {
  desert: {
    glow: "#ffd45a", glowA: 0.22, base: "#c47c4c", stroke: "#6b2f1a", inner: "#e8a874",
    chevFill: ["#f3dcae", "#f3dcae", "#f3dcae"], chevStroke: ["#6b2f1a", "#6b2f1a", "#6b2f1a"],
    deco: decos(WEST, "#fff0cf", 0.55), flame: ["#e2bd84", "#fff0cf"], part: { rgb: "255,240,207", a: 0.5, grow: 14, life: 0.7 },
  },
  volcano: {
    glow: "#ff6a1f", glowA: 0.22, base: "#15100e", stroke: "#5a1a10", rim: "#ff6a1f",
    chevFill: ["#e8461a", "#ff8a24", "#ffd45a"], chevStroke: ["#ffd45a", "#ffd45a", "#ff8a24"],
    deco: decos([[-63, -28, 2.5], [63, 28, 2.5], [-67, 22, 2], [67, -24, 2]], "#ffb02e", 1), flame: ["#ff6a1f", "#ffd45a"],
    part: { rgb: "255,138,36", a: 0.8, grow: 2, life: 0.5 },
  },
  north: {
    glow: "#7cf0ff", glowA: 0.25, base: "#7cc0e8", stroke: "#5aa5d0", gloss: true,
    chevFill: ["#ffffff", "#ffffff", "#ffffff"], chevStroke: ["#5aa5d0", "#5aa5d0", "#5aa5d0"],
    deco: decos(WEST, "#ffffff", 1, "#cfe3f0"), flame: ["#7cc0e8", "#ffffff"], part: { rgb: "255,255,255", a: 0.7, grow: 10, life: 0.6 },
  },
  classic: {
    glow: "#ffd000", glowA: 0.18, base: "#2b2f36", stroke: "#111111",
    chevFill: ["#ffb020", "#ffc21a", "#ffd000"], chevStroke: ["#111111", "#111111", "#111111"],
    deco: [], flame: ["#ff8a24", "#ffd45a"], part: { rgb: "200,200,200", a: 0.3, grow: 12, life: 0.6 },
  },
};

const STYLE_OF_MODE: Record<string, BoostStyleId> = { desert: "desert", volcano: "volcano", northpole: "north" };
/** Pad style of a mode; the other modes (countryside, any unknown id) get the yellow asphalt plate. */
export function boostStyleOf(modeId: string): BoostStyleId {
  return STYLE_OF_MODE[modeId] ?? "classic";
}

// ---------- placement ----------

export type CenterPoint = { x: number; y: number; heading: number; curv: number; s: number };

/** The track's centre line with heading, curvature (1/px, absolute) and distance along it. */
export function centerlineOf(track: Track): CenterPoint[] {
  const n = track.path.length;
  const s: number[] = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(track.path[i].x - track.path[i - 1].x, track.path[i].y - track.path[i - 1].y));
  const total = s[n - 1] + Math.hypot(track.path[0].x - track.path[n - 1].x, track.path[0].y - track.path[n - 1].y);
  const heading = track.tangents.map((t) => Math.atan2(t.y, t.x));
  const W = 3; // samples each side to measure the turn over
  return track.path.map((p, i) => {
    const a = (i - W + n) % n, b = (i + W) % n;
    let dh = heading[b] - heading[a];
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    let ds = s[b] - s[a];
    if (ds <= 0) ds += total;
    return { x: p.x, y: p.y, heading: heading[i], curv: Math.abs(dh) / (ds || 1), s: s[i] };
  });
}

export type PadSpot = { x: number; y: number; heading: number; s: number };

/**
 * Picks BOOST.COUNT spots, about evenly spread along the lap: straight for STRAIGHT_LEN ahead, off the start/finish
 * (and the grid behind it), BOOST.MIN_GAP from each other, never where `isBlocked` says no. The sideways shift is
 * a fixed function of the pad's number, so a track always gets the same pads.
 */
export function placeBoostPads(cl: CenterPoint[], roadW: number, isBlocked: (x: number, y: number) => boolean, finishSafe = BOOST.FINISH_SAFE): PadSpot[] {
  if (!cl.length) return [];
  const S = cl[cl.length - 1].s;
  const start = cl[0];
  const straight = (i: number) => {
    for (let j = i; j < cl.length && cl[j].s - cl[i].s <= BOOST.STRAIGHT_LEN; j++) if (cl[j].curv > BOOST.MAX_CURV) return false;
    return cl[i].s + BOOST.STRAIGHT_LEN < S;
  };
  // The 200 px are measured to the pad's near edge, not its centre.
  const startSafe = BOOST.START_SAFE + ((BOOST.PAD_L / 2) * roadW * BOOST.PAD_RATIO) / BOOST.PAD_W;
  const cand = cl.filter((p, i) => p.s > startSafe && p.s < S - finishSafe && Math.hypot(p.x - start.x, p.y - start.y) > startSafe && straight(i) && !isBlocked(p.x, p.y));
  // The most even spread: of the candidates (thinned to one every ~30 px) take the COUNT that keep the largest gap between
  // neighbours around the lap (the wrap from the last pad back to the first counts), then the closest to the even positions.
  const thin: CenterPoint[] = [];
  for (const c of cand) if (!thin.length || c.s - thin[thin.length - 1].s >= 30) thin.push(c);
  const ideal = Array.from({ length: BOOST.COUNT }, (_, k) => ((k + 1) * S) / (BOOST.COUNT + 1));
  let best: CenterPoint[] = [], bestScore = -Infinity;
  const pick: CenterPoint[] = [];
  const search = (from: number) => {
    if (pick.length === BOOST.COUNT || from >= thin.length) {
      if (pick.length < Math.min(BOOST.COUNT, 1)) return;
      const gaps = pick.map((p, i) => (i ? p.s - pick[i - 1].s : p.s + S - pick[pick.length - 1].s));
      const dev = pick.reduce((a, p, i) => a + Math.abs(p.s - ideal[i]), 0);
      const score = (pick.length < BOOST.COUNT ? -1e6 : 0) + Math.min(...gaps) - 0.15 * dev;
      if (score > bestScore) {
        bestScore = score;
        best = [...pick];
      }
      return;
    }
    for (let i = from; i < thin.length; i++) {
      const c = thin[i];
      if (pick.some((o) => Math.abs(o.s - c.s) < BOOST.MIN_GAP || Math.hypot(o.x - c.x, o.y - c.y) < BOOST.MIN_GAP)) continue;
      pick.push(c);
      search(i + 1);
      pick.pop();
    }
  };
  search(0);
  const out: PadSpot[] = [];
  const maxOff = Math.min(BOOST.LATERAL, 0.5 - BOOST.PAD_RATIO / 2 - 0.01) * roadW; // stay on the asphalt
  best.forEach((c, i) => {
    const k = i + 1;
    let off = Math.max(-maxOff, Math.min(maxOff, (((k * 7919) % 100) / 100 - 0.5) * 2 * BOOST.LATERAL * roadW));
    let x = c.x - Math.sin(c.heading) * off, y = c.y + Math.cos(c.heading) * off;
    if (isBlocked(x, y)) {
      off = 0;
      x = c.x;
      y = c.y;
    }
    out.push({ x, y, heading: c.heading, s: c.s });
  });
  return out;
}

/** What keeps a pad off a spot: covered sections (bridge, tunnel, forest) and solid bumpers (hay bales) under its footprint. */
export function padBlockedFn(track: Track, bumpers: readonly { x: number; y: number; r: number }[] = [], lava: readonly { x: number; y: number; r: number }[] = []) {
  const k = (track.width * BOOST.PAD_RATIO) / BOOST.PAD_W;
  const reach = Math.hypot(BOOST.PAD_L / 2, BOOST.PAD_W / 2) * k + 14; // pad half-diagonal + a margin
  const n = track.path.length;
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(track.path[i].x - track.path[i - 1].x, track.path[i].y - track.path[i - 1].y);
  const around = Math.ceil((reach * 1.5) / (len / n)); // samples either side of the nearest one
  return (x: number, y: number) => {
    const loc = locate(track, { x, y });
    for (let d = -around; d <= around; d++) if (isCovered(track, loc.index + d)) return true;
    for (const b of bumpers) if (Math.hypot(b.x - x, b.y - y) < reach + b.r) return true;
    if (bumpers.length) {
      // Bales along the road ahead (within the barriers, where cars can reach them).
      const ahead = Math.ceil(BOOST.CLEAR_AHEAD / (len / n));
      for (let d = 0; d <= ahead; d++) {
        const p = track.path[(loc.index + d) % n];
        for (const b of bumpers) if (Math.hypot(b.x - p.x, b.y - p.y) < track.barrier + b.r) return true;
      }
    }
    for (const l of lava) if (Math.hypot(l.x - x, l.y - y) < reach + l.r) return true;
    return false;
  };
}

// ---------- the system ----------

export type BoostPad = PadSpot & { flash: number; cool: Map<number, number> };
type BoostState = { t: number; hist: { x: number; y: number; a: number }[]; hAcc: number; sAcc: number; pAcc: number };
type Streak = { x: number; y: number; h: number; len: number; age: number; life: number };
type Particle = { x: number; y: number; vx: number; vy: number; r: number; age: number; life: number };

export class BoostSystem {
  /** Off = pads are drawn but never trigger (scripts that measure the plain physics). */
  enabled = true;
  readonly pads: BoostPad[];
  readonly style: BoostStyle;
  /** Pad scale: the pad is `PAD_RATIO` of the road wide. */
  readonly k: number;
  /** Render-side quality: 0 everything, 1 no ghost images, 2 no speed streaks either (set by render.ts from the frame rate). */
  quality = 0;
  boosts = new Map<number, BoostState>();
  streaks: Streak[] = [];
  parts: Particle[] = [];
  private rng: Rng;
  private reduced: boolean;

  constructor(modeId: string, spots: readonly PadSpot[], roadW: number) {
    this.style = BOOST_STYLES[boostStyleOf(modeId)];
    this.pads = spots.map((p) => ({ ...p, flash: 0, cool: new Map() }));
    this.k = (roadW * BOOST.PAD_RATIO) / BOOST.PAD_W;
    this.rng = mulberry32(0xb005 + spots.length * 977);
    this.reduced = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private R(a: number, b: number) {
    return a + this.rng() * (b - a);
  }

  isBoosting(car: Car) {
    return this.boosts.has(car.id);
  }

  /** The turbo multiplier a car has right now (1 when not boosting): the bots use it to plan their braking. */
  factor(car: Car) {
    return this.boosts.has(car.id) ? car.boostMul : 1;
  }

  /** Seconds of turbo left (0 when not boosting), for the gauge. */
  remaining(car: Car) {
    return this.boosts.get(car.id)?.t ?? 0;
  }

  /** An impact: the turbo stops almost at once (HIT_LEFT s left). */
  cut(car: Car) {
    const b = this.boosts.get(car.id);
    if (b) b.t = Math.min(b.t, BOOST.HIT_LEFT);
  }

  /** Back to the start of a race: no turbo, every pad ready. */
  reset(cars: readonly Car[]) {
    for (const c of cars) c.boostMul = 1;
    this.boosts.clear();
    this.streaks = [];
    this.parts = [];
    for (const p of this.pads) {
      p.flash = 0;
      p.cool.clear();
    }
  }

  /** Advances by `dt` seconds of race time; `onTrigger` is told each time a car takes a pad (sound hook). */
  update(dt: number, cars: readonly Car[], onTrigger?: (car: Car, pad: BoostPad) => void) {
    dt = Math.min(dt, 0.05);
    const k = this.k;
    for (const pad of this.pads) {
      pad.flash = Math.max(0, pad.flash - dt * 2.5);
      for (const [id, cd] of pad.cool) {
        if (cd - dt <= 0) pad.cool.delete(id);
        else pad.cool.set(id, cd - dt);
      }
      if (!this.enabled) continue;
      const c = Math.cos(pad.heading), s = Math.sin(pad.heading);
      for (const car of cars) {
        if (car.finishTime !== null || pad.cool.has(car.id)) continue;
        const dx = car.pos.x - pad.x, dy = car.pos.y - pad.y;
        const along = dx * c + dy * s, across = -dx * s + dy * c;
        if (Math.abs(along) < (BOOST.PAD_L * k) / 2 && Math.abs(across) < (BOOST.PAD_W * k) / 2) this.trigger(car, pad, onTrigger);
      }
    }
    const S = BOOST.SCALE;
    for (const car of cars) {
      const b = this.boosts.get(car.id);
      if (!b) continue;
      if (car.finishTime !== null) b.t = 0; // the winner's lap of honour is plain
      b.t -= dt;
      if (b.t <= 0) {
        car.boostMul = 1;
        this.boosts.delete(car.id);
        continue;
      }
      car.boostMul = b.t > BOOST.EASE ? BOOST.MULT : lerp(1, BOOST.MULT, b.t / BOOST.EASE);
      const h = car.angle, c = Math.cos(h), s = Math.sin(h);
      b.hAcc += dt;
      if (b.hAcc >= BOOST.GHOST_EVERY) {
        b.hAcc = 0;
        b.hist.push({ x: car.pos.x, y: car.pos.y, a: h });
        if (b.hist.length > BOOST.GHOSTS) b.hist.shift();
      }
      b.sAcc += dt;
      while (b.sAcc >= BOOST.STREAK_EVERY) {
        b.sAcc -= BOOST.STREAK_EVERY;
        if (this.reduced || this.quality >= 2 || this.streaks.length >= BOOST.MAX_STREAKS) continue;
        const lat = (this.rng() < 0.5 ? -1 : 1) * this.R(28, 70) * S, al = this.R(-30, 40) * S;
        this.streaks.push({ x: car.pos.x + c * al - s * lat, y: car.pos.y + s * al + c * lat, h, len: this.R(40, 90) * S, age: 0, life: 0.35 });
      }
      b.pAcc += dt;
      while (b.pAcc >= BOOST.PART_EVERY) {
        b.pAcc -= BOOST.PART_EVERY;
        if (this.parts.length >= BOOST.MAX_PARTS) continue;
        const sp = this.R(20, 60) * S, sx = this.R(-0.4, 0.4);
        this.parts.push({ x: car.pos.x - c * 14 * S, y: car.pos.y - s * 14 * S, vx: -c * sp - s * sx * sp, vy: -s * sp + c * sx * sp, r: this.R(3, 6) * S, age: 0, life: this.style.part.life });
      }
    }
    const grow = this.style.part.grow * S;
    const step = <T extends { age: number; life: number }>(arr: T[], fn?: (o: T) => void) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i];
        o.age += dt;
        if (o.age > o.life) arr.splice(i, 1);
        else if (fn) fn(o);
      }
    };
    step(this.streaks);
    step(this.parts, (o) => {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.r += grow * dt;
    });
  }

  /** Starts a turbo (kick included), or only refills the one running: a ×1.5 never becomes ×2.25. */
  activate(car: Car) {
    let b = this.boosts.get(car.id);
    if (!b) {
      b = { t: BOOST.DURATION, hist: [], hAcc: 0, sAcc: 0, pAcc: 0 };
      this.boosts.set(car.id, b);
      car.vel = { x: car.vel.x * BOOST.KICK, y: car.vel.y * BOOST.KICK }; // the kick, once per turbo
    } else b.t = BOOST.DURATION;
    car.boostMul = BOOST.MULT;
  }

  private trigger(car: Car, pad: BoostPad, onTrigger?: (car: Car, pad: BoostPad) => void) {
    this.activate(car);
    pad.cool.set(car.id, BOOST.COOLDOWN);
    pad.flash = 1;
    onTrigger?.(car, pad);
  }

  // ---------- drawing ----------

  /** GROUND layer: over the track and the finish line, under the skid marks and the cars (world frame). */
  drawGround(ctx: Ctx, view: { minX: number; maxX: number; minY: number; maxY: number }) {
    const th = this.style, reach = (Math.hypot(BOOST.PAD_L, BOOST.PAD_W) * this.k) / 2 + 20;
    for (const pad of this.pads) {
      if (pad.x < view.minX - reach || pad.x > view.maxX + reach || pad.y < view.minY - reach || pad.y > view.maxY + reach) continue;
      ctx.save();
      ctx.translate(pad.x, pad.y);
      ctx.rotate(pad.heading + Math.PI / 2);
      ctx.scale(this.k, this.k);
      ctx.globalAlpha = Math.min(1, th.glowA * (1 + pad.flash * (this.reduced ? 1 : 2))); // glow, stronger right after a pass
      ctx.fillStyle = th.glow;
      ctx.beginPath();
      ctx.roundRect(-63, -54, 126, 108, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.base;
      ctx.strokeStyle = th.stroke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-57, -46, 114, 92, 8);
      ctx.fill();
      ctx.stroke();
      if (th.inner) {
        ctx.strokeStyle = th.inner;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-52, -41, 104, 82, 5);
        ctx.stroke();
      }
      if (th.rim) {
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = th.rim;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-57, -46, 114, 92, 8);
        ctx.stroke();
        ctx.restore();
      }
      if (th.gloss) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.beginPath();
        ([[-57, -46], [-15, -46], [-37, 46], [-57, 46]] as Pt[]).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
      for (let i = 0; i < 3; i++) {
        // three arrows, the front one the brightest
        ctx.save();
        ctx.translate(0, CHEV_Y[i]);
        ctx.globalAlpha = CHEV_A[i];
        ctx.beginPath();
        CHEV.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = th.chevFill[i];
        ctx.fill();
        ctx.strokeStyle = th.chevStroke[i];
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
      for (const d of th.deco) {
        ctx.globalAlpha = d.a;
        ctx.fillStyle = d.fill;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, TAU);
        ctx.fill();
        if (d.stroke) {
          ctx.strokeStyle = d.stroke;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  /**
   * Just BEFORE the cars: speed streaks, particles, and for each boosting car its ghost images (the oldest the palest)
   * and a glow behind it. `drawCarAt` draws a car like the normal sprite (skin included) at a pose, with the current alpha.
   */
  drawBehind(ctx: Ctx, drawCarAt: (car: Car, x: number, y: number, angle: number, alpha: number) => void, cars: readonly Car[]) {
    for (const s of this.streaks) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.h);
      ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - s.age / s.life)})`;
      ctx.beginPath();
      ctx.roundRect(-s.len / 2, -1.5 * BOOST.SCALE, s.len, 3 * BOOST.SCALE, 1.5 * BOOST.SCALE);
      ctx.fill();
      ctx.restore();
    }
    const pt = this.style.part;
    for (const o of this.parts) {
      ctx.fillStyle = `rgba(${pt.rgb},${pt.a * (1 - o.age / o.life)})`;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, TAU);
      ctx.fill();
    }
    const S = BOOST.SCALE;
    for (const car of cars) {
      const b = this.boosts.get(car.id);
      if (!b) continue;
      if (this.quality < 1) b.hist.forEach((h, i) => drawCarAt(car, h.x, h.y, h.a, (0.3 * (i + 1)) / b.hist.length));
      const gx = car.pos.x - Math.cos(car.angle) * 34 * S, gy = car.pos.y - Math.sin(car.angle) * 34 * S;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 42 * S);
      g.addColorStop(0, "rgba(255,138,36,0.25)");
      g.addColorStop(1, "rgba(255,138,36,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, 42 * S, 0, TAU);
      ctx.fill();
    }
  }

  /** In the drawing of EACH car, BEFORE its body, in the car's local frame (origin at the centre, front toward -y, 16 × 28). */
  drawCarFlame(ctx: Ctx, car: Car) {
    if (!this.boosts.has(car.id)) return;
    const f = this.reduced ? 1 : 0.85 + 0.3 * Math.sin(performance.now() / 40);
    const [o, i] = this.style.flame;
    ctx.fillStyle = o;
    ctx.beginPath();
    ctx.moveTo(-6.2, 14);
    ctx.lineTo(0, 14 + 58 * f);
    ctx.lineTo(6.2, 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = i;
    ctx.beginPath();
    ctx.moveTo(-3.7, 14);
    ctx.lineTo(0, 14 + 31 * f);
    ctx.lineTo(3.7, 14);
    ctx.closePath();
    ctx.fill();
  }

  /** HUD in SCREEN pixels, for the player's car only: above the speed readout (the minimap owns the top right). */
  drawHud(ctx: Ctx, car: Car, W: number, H: number) {
    const left = this.remaining(car);
    if (left <= 0) return;
    const x = W - 216, y = H - 112;
    ctx.save();
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(x, y, 200, 30, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("TURBO", x + 14, y + 20);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.roundRect(x + 70, y + 9, 90, 12, 6);
    ctx.fill();
    ctx.fillStyle = "#ffb020";
    ctx.beginPath();
    ctx.roundRect(x + 70, y + 9, Math.max(1, (90 * left) / BOOST.DURATION), 12, 6);
    ctx.fill();
    ctx.fillStyle = "#ffd45a";
    ctx.fillText("×1,5", x + 168, y + 20);
    ctx.restore();
  }
}

// ---------- per-mode pads ----------

const spotCache = new Map<string, PadSpot[]>();
/**
 * The pads of a mode: computed once from the track (and the grid depth, so no pad sits where the cars start), then shared.
 * `scene` only lends its solid bumpers and lava pools to keep pads clear of them.
 */
export function padSpotsFor(modeId: string, track: Track, scene: { bumpers?: readonly { x: number; y: number; r: number }[]; lava?: readonly { x: number; y: number; r: number }[] }, gridSamples: number): PadSpot[] {
  let spots = spotCache.get(modeId);
  if (!spots) {
    const cl = centerlineOf(track);
    const S = cl[cl.length - 1].s;
    const k = (track.width * BOOST.PAD_RATIO) / BOOST.PAD_W;
    // The grid reaches `gridSamples` samples back from the line; keep the pads (and half their length) clear of it.
    const grid = S - cl[Math.max(0, cl.length - gridSamples)].s;
    const finishSafe = Math.max(BOOST.FINISH_SAFE, grid + (BOOST.PAD_L * k) / 2 + 20);
    spots = placeBoostPads(cl, track.width, padBlockedFn(track, scene.bumpers, scene.lava), finishSafe);
    spotCache.set(modeId, spots);
  }
  return spots;
}

/** The pads already placed for a mode (empty before its first race). */
export function cachedPadSpots(modeId: string): readonly PadSpot[] {
  return spotCache.get(modeId) ?? [];
}

/** A new boost system for one race (pad state — recharge, glow — is per race). */
export function createBoost(modeId: string, track: Track, scene: Parameters<typeof padSpotsFor>[2], gridSamples: number): BoostSystem {
  return new BoostSystem(modeId, padSpotsFor(modeId, track, scene, gridSamples), track.width);
}

/** Whether a point is on (or within `margin` of) one of a mode's pads: volcano bombs keep clear of them. */
export function nearPad(spots: readonly PadSpot[], roadW: number, x: number, y: number, margin = 0) {
  const k = (roadW * BOOST.PAD_RATIO) / BOOST.PAD_W, reach = Math.hypot(BOOST.PAD_L, BOOST.PAD_W) * k / 2 + margin;
  return spots.some((p) => Math.hypot(p.x - x, p.y - y) < reach);
}
