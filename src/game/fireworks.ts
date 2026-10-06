import { type Vec, vec, add, scale, clamp } from "./vec";

// Pure firework simulation for the victory screen: rockets climb, then burst into sparks.
// No DOM/canvas access here — see Fireworks.tsx for the canvas loop that drives this.

export type BurstKind = "peony" | "ring" | "willow" | "crackle" | "double";

export type Rocket = {
  pos: Vec;
  vel: Vec;
  color: string;
  kind: BurstKind;
  /** Safety cutoff so a rocket that never slows down still explodes. */
  life: number;
};

export type Spark = {
  pos: Vec;
  vel: Vec;
  color: string;
  life: number;
  maxLife: number;
  radius: number;
  drag: number;
  gravityMul: number;
  sparkle: boolean;
  twinkleFreq: number;
  twinklePhase: number;
};

export type Flash = { pos: Vec; life: number; maxLife: number; radius: number };

type PendingBurst = { pos: Vec; color: string; kind: BurstKind; delay: number; size: number };

export type FireworksState = {
  t: number;
  reducedMotion: boolean;
  rockets: Rocket[];
  sparks: Spark[];
  flashes: Flash[];
  pending: PendingBurst[];
  /** Countdown to the next automatic launch. */
  nextLaunch: number;
  /** Intense simultaneous salvos happen while t < finaleUntil. */
  finaleUntil: number;
};

const GRAVITY = 420;
const KINDS: BurstKind[] = ["peony", "ring", "willow", "crackle", "double"];
const PALETTE = ["#ff5c5c", "#ffd166", "#06d6a0", "#4cc9f0", "#c77dff", "#ff8fab", "#f4f1de", "#ffb703", "#ff9f1c"];
const MAX_SPARKS = 900; // perf ceiling, oldest dropped first

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function createFireworks(reducedMotion: boolean): FireworksState {
  return {
    t: 0,
    reducedMotion,
    rockets: [],
    sparks: [],
    flashes: [],
    pending: [],
    nextLaunch: 0,
    finaleUntil: reducedMotion ? 0 : 3,
  };
}

function launchRocket(state: FireworksState, w: number, h: number): void {
  const speedMul = state.reducedMotion ? 0.55 : 1;
  const x = w * rand(0.1, 0.9);
  const targetY = h * rand(0.14, 0.46);
  const vy = -Math.sqrt(2 * GRAVITY * Math.max(40, h - targetY)) * rand(0.92, 1.02) * speedMul;
  state.rockets.push({
    pos: vec(x, h + 12),
    vel: vec(rand(-30, 30), vy),
    color: pick(PALETTE),
    kind: pick(KINDS),
    life: 3.5,
  });
}

function addSpark(state: FireworksState, s: Spark): void {
  state.sparks.push(s);
}

/** Spherical burst, even in all directions — the classic "peony". */
function spawnPeony(state: FireworksState, pos: Vec, color: string, count: number, speed: number, reduced: boolean): void {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = speed * rand(0.35, 1);
    addSpark(state, {
      pos: vec(pos.x, pos.y),
      vel: vec(Math.cos(a) * sp, Math.sin(a) * sp),
      color: Math.random() < 0.25 ? pick(PALETTE) : color,
      life: 1.1 + Math.random() * 0.6,
      maxLife: 1.7,
      radius: reduced ? 2 : 2.4 + Math.random() * 1.4,
      drag: 1.1,
      gravityMul: 1,
      sparkle: false,
      twinkleFreq: 0,
      twinklePhase: 0,
    });
  }
}

/** Thin expanding ring: near-uniform speed and angle spacing. */
function spawnRing(state: FireworksState, pos: Vec, color: string, count: number, speed: number, reduced: boolean): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(-0.04, 0.04);
    const sp = speed * rand(0.9, 1.05);
    addSpark(state, {
      pos: vec(pos.x, pos.y),
      vel: vec(Math.cos(a) * sp, Math.sin(a) * sp),
      color,
      life: 1.3 + Math.random() * 0.3,
      maxLife: 1.6,
      radius: reduced ? 2 : 2.2 + Math.random(),
      drag: 0.7,
      gravityMul: 1.3,
      sparkle: false,
      twinkleFreq: 0,
      twinklePhase: 0,
    });
  }
}

/** Slow, heavy, long-lived sparks that droop under gravity — the drooping "willow". */
function spawnWillow(state: FireworksState, pos: Vec, color: string, count: number, speed: number, reduced: boolean): void {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = speed * rand(0.3, 0.75);
    addSpark(state, {
      pos: vec(pos.x, pos.y),
      vel: vec(Math.cos(a) * sp, Math.sin(a) * sp * 0.6 - 20),
      color,
      life: 2.2 + Math.random() * 0.8,
      maxLife: 3,
      radius: reduced ? 1.6 : 1.8 + Math.random(),
      drag: 0.35,
      gravityMul: 1.7,
      sparkle: false,
      twinkleFreq: 0,
      twinklePhase: 0,
    });
  }
}

/** Dense cloud of tiny flickering sparkles — crackling glitter. */
function spawnCrackle(state: FireworksState, pos: Vec, color: string, count: number, speed: number, reduced: boolean): void {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = speed * rand(0.2, 0.9);
    addSpark(state, {
      pos: vec(pos.x, pos.y),
      vel: vec(Math.cos(a) * sp, Math.sin(a) * sp),
      color: Math.random() < 0.5 ? "#fff6d5" : color,
      life: 0.5 + Math.random() * 0.7,
      maxLife: 1.1,
      radius: reduced ? 1.3 : 1.2 + Math.random() * 1.2,
      drag: 1.6,
      gravityMul: 0.6,
      sparkle: true,
      twinkleFreq: 14 + Math.random() * 18,
      twinklePhase: rand(0, Math.PI * 2),
    });
  }
}

function explode(state: FireworksState, pos: Vec, color: string, kind: BurstKind, size: number): void {
  const reduced = state.reducedMotion;
  if (!reduced && state.flashes.length < 40) {
    state.flashes.push({ pos: vec(pos.x, pos.y), life: 0.09, maxLife: 0.09, radius: 90 * size });
  }
  const count = Math.max(6, Math.round((reduced ? 22 : 64) * size));
  const speed = (reduced ? 90 : 170) * (0.85 + size * 0.15);
  switch (kind) {
    case "peony":
      spawnPeony(state, pos, color, count, speed, reduced);
      break;
    case "ring":
      spawnRing(state, pos, color, count, speed, reduced);
      break;
    case "willow":
      spawnWillow(state, pos, color, count, speed, reduced);
      break;
    case "crackle":
      spawnCrackle(state, pos, color, count, speed, reduced);
      break;
    case "double":
      spawnPeony(state, pos, color, count, speed, reduced);
      if (!reduced) {
        state.pending.push({
          pos: vec(pos.x, pos.y - 6),
          color: pick(PALETTE),
          kind: Math.random() < 0.5 ? "ring" : "crackle",
          delay: 0.28 + Math.random() * 0.14,
          size: size * 0.55,
        });
      }
      break;
  }
}

export function stepFireworks(state: FireworksState, dt: number, w: number, h: number): void {
  state.t += dt;
  const reduced = state.reducedMotion;

  state.nextLaunch -= dt;
  if (state.nextLaunch <= 0) {
    if (state.t < state.finaleUntil) {
      const salvo = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < salvo; i++) launchRocket(state, w, h);
      state.nextLaunch = 0.16 + Math.random() * 0.1;
    } else {
      const count = reduced ? 1 : Math.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < count; i++) launchRocket(state, w, h);
      state.nextLaunch = reduced ? 1.8 + Math.random() * 1.4 : 0.55 + Math.random() * 0.45;
    }
  }

  for (let i = state.rockets.length - 1; i >= 0; i--) {
    const r = state.rockets[i];
    r.vel = add(r.vel, vec(0, GRAVITY * 0.55 * dt));
    r.vel = scale(r.vel, 1 - 0.3 * dt);
    r.pos = add(r.pos, scale(r.vel, dt));
    r.life -= dt;
    if (r.vel.y >= -30 || r.life <= 0) {
      explode(state, r.pos, r.color, r.kind, 1);
      state.rockets.splice(i, 1);
    }
  }

  for (let i = state.pending.length - 1; i >= 0; i--) {
    const p = state.pending[i];
    p.delay -= dt;
    if (p.delay <= 0) {
      explode(state, p.pos, p.color, p.kind, p.size);
      state.pending.splice(i, 1);
    }
  }

  for (let i = state.sparks.length - 1; i >= 0; i--) {
    const s = state.sparks[i];
    s.vel = add(s.vel, vec(0, GRAVITY * s.gravityMul * dt));
    s.vel = scale(s.vel, Math.max(0, 1 - s.drag * dt));
    s.pos = add(s.pos, scale(s.vel, dt));
    s.life -= dt;
    if (s.life <= 0) state.sparks.splice(i, 1);
  }
  if (state.sparks.length > MAX_SPARKS) state.sparks.splice(0, state.sparks.length - MAX_SPARKS);

  for (let i = state.flashes.length - 1; i >= 0; i--) {
    state.flashes[i].life -= dt;
    if (state.flashes[i].life <= 0) state.flashes.splice(i, 1);
  }
}

function glowDot(ctx: CanvasRenderingContext2D, pos: Vec, radius: number, color: string, alpha: number): void {
  if (radius <= 0 || alpha <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Draws the current state onto a transparent canvas. `dt` scales the trail fade to the frame rate. */
export function drawFireworks(ctx: CanvasRenderingContext2D, state: FireworksState, w: number, h: number, dt: number): void {
  // Erase a fraction of the existing alpha instead of clearing, which leaves fading
  // trails behind rockets and sparks while keeping the canvas itself transparent.
  const fadePerSecond = state.reducedMotion ? 5.5 : 9.5;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${clamp(fadePerSecond * dt, 0, 1).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = "lighter";
  for (const r of state.rockets) glowDot(ctx, r.pos, 2.6, r.color, 0.9);
  for (const s of state.sparks) {
    const f = clamp(s.life / s.maxLife, 0, 1);
    let alpha = f;
    if (s.sparkle) alpha *= 0.3 + 0.7 * Math.max(0, Math.sin(state.t * s.twinkleFreq + s.twinklePhase));
    glowDot(ctx, s.pos, s.radius * (0.5 + 0.5 * f), s.color, alpha);
  }

  // Additive white flash so overlapping bursts bloom brighter instead of just stacking alpha.
  for (const fl of state.flashes) {
    const f = clamp(fl.life / fl.maxLife, 0, 1);
    const g = ctx.createRadialGradient(fl.pos.x, fl.pos.y, 0, fl.pos.x, fl.pos.y, fl.radius);
    g.addColorStop(0, `rgba(255,255,255,${(0.85 * f).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fl.pos.x, fl.pos.y, fl.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}
