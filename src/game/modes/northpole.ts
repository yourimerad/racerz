import { drift, dot, type Fx } from "../fx";
import {
  disc, ellipse, mulberry32, onTrackPoint, range, type Rng, scatter, scatterNear, shadow, softBlob, TAU, type Circle, type Hazard, type HazardBody,
  type HazardWorld, type Scene,
} from "../scenery";
import { isCovered, type Track, type TrackLayout } from "../track";
import { angleDiff, clamp, type Vec } from "../vec";
import { createYeti, type YetiHazard } from "./yeti";

// North pole: a mountain pass. The circuit climbs into a translucent ice massif and dives
// through a tunnel bored straight through it (~15% of the lap), then loops back across the
// banquise. Igloos, a penguin colony, a polar bear and drifting snow fill the open ground.
// From time to time a polar bear also walks across the road: a moving obstacle (see BEAR below
// and `createBears`) that cars bounce off. The shared collision / bot-avoidance / drawing hooks
// live in race.ts and render.ts and are generic: only this mode defines a hazard.

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

// ---------- polar bear: tunables ----------

const BEAR = {
  /** Bears alive at once. */
  max: 1,
  /** Walking speed (px/s). The road is 190 px wide, so crossing it takes about 5 s. */
  speed: 50,
  /** Sprite scale: the drawing is ~76 px nose to tail at 1, against a 40 px car. */
  scale: 1.25,
  /** Hitbox (an ellipse), before scale: length along the bear's heading × width across it. */
  hitbox: { length: 55, width: 30 },
  /** Seconds after the green light for the first bear, then between two appearances. */
  firstAppear: [10, 20] as const,
  interval: [20, 40] as const,
  /** Never sooner than this after the start (s). */
  noEarlierThan: 8,
  /** Blinking alert before it appears (s). */
  warning: 1.5,
  /** No car closer than this (px) to the spot when the bear appears. */
  minCarDistance: 150,
  /** The spot is at least this far ahead of where the player will be at that moment: max(leadMin px, leadSeconds of its speed). */
  leadMin: 650,
  leadSeconds: 1.6,
  /** Only on stretches turning less than `straightMaxTurn` rad over `straightWindow` samples either side (~11 px each). */
  straightWindow: 14,
  straightMaxTurn: 0.2,
  /** Kept away from the tunnel by this many samples. */
  tunnelMargin: 40,
  /** When no spot / free moment is found: retry after (s), and give up waiting for the cars to clear after (s). */
  retryDelay: 0.5,
  maxSpawnDelay: 3,
  /**
   * Impact on a car: it keeps `speedKeep` of its speed relative to the bear (0.4 = loses 60 %), bounces back
   * with `restitution`; a closing speed below `minImpact` (px/s) is not an impact, the car is just slid off.
   */
  speedKeep: 0.4,
  restitution: 0.3,
  minImpact: 40,
  /** One contact counted per bear and per car, and at least this long (s) between two counted contacts of a car. */
  contactGap: 1,
  /**
   * Bots: slow to `aiSlow` × their limit when a bear is within `aiRange` px ahead (plus `aiLookahead` s of their own
   * speed, since 120 px is under a quarter of a second at full speed), and steer round it with `aiMargin` px to spare,
   * on the side that is free where the bear will be when they reach it.
   */
  aiRange: 120,
  aiLookahead: 1.0,
  aiSlow: 0.5,
  aiMargin: 26,
  /** Fade in/out at both ends of the crossing (s) and body sway (degrees). */
  fade: 0.4,
  swayDeg: 2,
  /** Snow puff on impact: particles and lifetime (s). */
  puffs: 12,
  puffLife: 0.9,
  maxPuffs: 40,
};

export const layout: TrackLayout = {
  points: [
    [400, 1100], [400, 650], [700, 380], [1150, 300], [1600, 380], [1980, 560],
    [2320, 780], [2500, 1115], [2680, 1450], [2798, 1670], [2550, 1950], [2000, 1950],
    [1450, 1950], [950, 1800], [550, 1450],
  ],
  covers: [{ from: 5.9, to: 8.6 }],
};

// ---------- open-ground scenery (unchanged style: igloos, penguins, bear, firs) ----------

function fir(ctx: Ctx, c: Circle) {
  shadow(ctx, c.x + 5, c.y + 5, c.r, c.r * 0.9);
  const star = (r: number, fill: string, rot: number) => {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = rot + (i / 16) * TAU, rr = i % 2 ? r * 0.62 : r;
      const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  star(c.r, "#24513d", 0);
  star(c.r * 0.92, "#f4f8fb", 0.15);
  star(c.r * 0.72, "#2f6249", 0.2);
  star(c.r * 0.62, "#f4f8fb", 0.35);
  star(c.r * 0.42, "#3a7457", 0.4);
  disc(ctx, c.x, c.y, c.r * 0.16, "#ffffff");
}

function igloo(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ellipse(ctx, 6, 7, c.r, c.r * 0.92, 0, "rgba(40,70,110,0.22)");
  ctx.beginPath();
  ctx.roundRect(c.r * 0.6, -c.r * 0.32, c.r * 0.7, c.r * 0.64, c.r * 0.3);
  ctx.fillStyle = "#e8f1f8";
  ctx.fill();
  ellipse(ctx, c.r * 1.22, 0, c.r * 0.1, c.r * 0.22, 0, "#2b3a4a");
  const g = ctx.createRadialGradient(-c.r * 0.3, -c.r * 0.3, 0, 0, 0, c.r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#c7dbea");
  disc(ctx, 0, 0, c.r, g);
  ctx.strokeStyle = "rgba(120,160,190,0.55)";
  ctx.lineWidth = 1.5;
  for (const k of [0.4, 0.7]) {
    ctx.beginPath();
    ctx.arc(0, 0, c.r * k, 0, TAU);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + (i % 2) * 0.2;
    ctx.moveTo(Math.cos(a) * c.r * 0.4, Math.sin(a) * c.r * 0.4);
    ctx.lineTo(Math.cos(a) * c.r, Math.sin(a) * c.r);
  }
  ctx.stroke();
  ctx.restore();
}

function iceBlock(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(40,80,120,0.2)";
  ctx.fillRect(-c.r + 5, -c.r + 6, c.r * 2, c.r * 2);
  ctx.fillStyle = "rgba(165,215,242,0.92)";
  ctx.fillRect(-c.r, -c.r, c.r * 2, c.r * 2);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(-c.r, -c.r, c.r * 2, c.r * 0.45);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-c.r, -c.r, c.r * 2, c.r * 2);
  ctx.restore();
}

function penguin(ctx: Ctx, x: number, y: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ellipse(ctx, 3, 4, 9, 11, 0, "rgba(40,70,110,0.25)");
  ellipse(ctx, -4, 9, 3, 2, 0, "#f39c12");
  ellipse(ctx, 4, 9, 3, 2, 0, "#f39c12");
  ellipse(ctx, 0, 0, 8, 11, 0, "#1e2329");
  ellipse(ctx, 0, 2, 5, 8, 0, "#f5f5f0");
  disc(ctx, 0, -8, 5.5, "#1e2329");
  ctx.beginPath();
  ctx.moveTo(-2, -6);
  ctx.lineTo(2, -6);
  ctx.lineTo(0, -1.5);
  ctx.fillStyle = "#f39c12";
  ctx.fill();
  disc(ctx, -2, -9, 1, "#fff");
  disc(ctx, 2, -9, 1, "#fff");
  ctx.restore();
}

function polarBear(ctx: Ctx, c: Circle, rot: number) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ellipse(ctx, 5, 6, 30, 17, 0, "rgba(40,70,110,0.25)");
  for (const [lx, ly] of [[-16, -14], [-16, 14], [14, -14], [14, 14]]) ellipse(ctx, lx, ly, 7, 5, 0, "#e6dfcc");
  ellipse(ctx, 0, 0, 28, 16, 0, "#f6f2e6");
  disc(ctx, 30, 0, 10, "#f6f2e6");
  disc(ctx, 26, -8, 3.5, "#e6dfcc");
  disc(ctx, 26, 8, 3.5, "#e6dfcc");
  disc(ctx, 39, 0, 2.6, "#1e1e1e");
  disc(ctx, 32, -4, 1.2, "#1e1e1e");
  disc(ctx, 32, 4, 1.2, "#1e1e1e");
  ctx.restore();
}

// ---------- roaming polar bear (the moving obstacle) ----------

/**
 * The bear, seen from above, facing +x. `t` drives the leg swing, `alpha` the fade in/out. Blue-grey
 * outlines and a drop shadow keep it readable on the white snow.
 */
function drawPolarBear(ctx: Ctx, x: number, y: number, angle: number, t: number, s = 1, alpha = 1) {
  const swing = Math.sin(t * 8) * 5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle + Math.sin(t * 4) * ((BEAR.swayDeg * Math.PI) / 180));
  ctx.scale(s, s);
  const ell = (cx: number, cy: number, rx: number, ry: number, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };
  ell(4, 6, 30, 17, "rgba(11,29,51,0.25)"); // drop shadow
  // Four legs, swinging in alternation.
  for (const [px, py, d] of [[14, 12, 1], [-14, 12, -1], [14, -12, -1], [-14, -12, 1]]) ell(px + swing * d, py, 8, 5, "#e8eff5", "#9fb2c4");
  ell(0, 0, 27, 16, "#f2f6fa", "#9fb2c4"); // body
  ell(-2, 6, 22, 8, "#d9e3ec"); // belly shade
  ell(-27, 0, 4.5, 4, "#f2f6fa", "#9fb2c4"); // tail
  ell(27, 0, 12, 10, "#f2f6fa", "#9fb2c4"); // head
  ell(25, 8, 3.5, 3.5, "#f2f6fa", "#9fb2c4"); // ears
  ell(25, -8, 3.5, 3.5, "#f2f6fa", "#9fb2c4");
  ell(37, 0, 6, 4.5, "#e8eff5", "#9fb2c4"); // muzzle
  ell(42, 0, 2.2, 2, "#1b2430"); // nose
  ell(31, 4, 1.4, 1.4, "#1b2430"); // eyes
  ell(31, -4, 1.4, 1.4, "#1b2430");
  ctx.restore();
}

/** Orange warning triangle with an exclamation mark, dark-rimmed so it stands out on snow. */
function warningSign(ctx: Ctx, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = "round";
  const tri = () => {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.62);
    ctx.lineTo(size * 0.58, size * 0.42);
    ctx.lineTo(-size * 0.58, size * 0.42);
    ctx.closePath();
  };
  tri();
  ctx.lineWidth = size * 0.3;
  ctx.strokeStyle = "rgba(60,32,0,0.85)";
  ctx.stroke();
  tri();
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = "#ff9f1c";
  ctx.fillStyle = "#ff9f1c";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2b1a00";
  ctx.beginPath();
  ctx.roundRect(-size * 0.06, -size * 0.28, size * 0.12, size * 0.4, size * 0.05);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, size * 0.25, size * 0.075, 0, TAU);
  ctx.fill();
  ctx.restore();
}

type Bear = HazardBody & { age: number; life: number; hit: Set<number> };
type Puff = { x: number; y: number; vx: number; vy: number; r: number; life: number };
type Plan = { idx: number; side: 1 | -1; x: number; y: number; dir: Vec; signX: number; signY: number; warnAt: number; appearAt: number };

/** Sample index `dist` px further along the loop. */
function advance(track: Track, from: number, dist: number): number {
  const n = track.path.length;
  let i = from, d = 0;
  while (d < dist) {
    const a = track.path[i], b = track.path[(i + 1) % n];
    d += Math.hypot(b.x - a.x, b.y - a.y);
    i = (i + 1) % n;
  }
  return i;
}

/** Samples where the road is straight or nearly (and clear of the tunnel): where a bear may cross. */
function straightSamples(track: Track): boolean[] {
  const n = track.path.length, W = BEAR.straightWindow;
  const heading = track.tangents.map((t) => Math.atan2(t.y, t.x));
  return track.path.map((_, i) => {
    for (let m = -BEAR.tunnelMargin; m <= BEAR.tunnelMargin; m += 10) if (isCovered(track, i + m)) return false;
    let turn = 0;
    for (let k = -W; k < W; k++) turn += Math.abs(angleDiff(heading[(i + k + n) % n], heading[(i + k + 1 + n) % n]));
    return turn <= BEAR.straightMaxTurn;
  });
}

/**
 * One race's bear. It is announced by a blinking sign, appears at the edge of the road ahead of the
 * player, walks straight across at a constant speed and is dropped as soon as it has left the road
 * on the other side. State lives here (one instance per race), driven by the simulation clock.
 */
function createBears(track: Track, rng: Rng): Hazard {
  const straight = straightSamples(track);
  const n = track.path.length;
  const hx = (BEAR.hitbox.length / 2) * BEAR.scale, hy = (BEAR.hitbox.width / 2) * BEAR.scale;
  /** Distance from the centre line where a bear starts/ends: its whole body just past the road edge. */
  const edge = track.width / 2 + hx + 4;
  const life = (2 * edge) / BEAR.speed;
  const pick = (r: readonly [number, number]) => range(rng, r[0], r[1]);

  const bears: Bear[] = [];
  const puffs: Puff[] = [];
  let plan: Plan | null = null;
  let nextAppear = Math.max(BEAR.noEarlierThan, pick(BEAR.firstAppear));
  let retryAt = 0;
  let nextId = 1;
  const lastCounted = new Map<number, number>();
  let now = 0;

  /** A straight spot ahead of the player, far enough to be seen and reacted to. */
  function pickSpot(world: HazardWorld): Plan | null {
    const me = world.cars[0];
    const v = Math.hypot(me.vel.x, me.vel.y);
    const from = advance(track, me.lastIndex, v * BEAR.warning + Math.max(BEAR.leadMin, v * BEAR.leadSeconds));
    for (let k = 0; k < 70; k += 2) {
      const idx = (from + k) % n;
      if (!straight[idx]) continue;
      const p = track.path[idx], t = track.tangents[idx];
      const side: 1 | -1 = rng() < 0.5 ? -1 : 1;
      const rn = { x: -t.y, y: t.x };
      return {
        idx, side, x: p.x + rn.x * side * edge, y: p.y + rn.y * side * edge, dir: { x: -rn.x * side, y: -rn.y * side },
        signX: p.x + rn.x * side * (track.width / 2 + 26), signY: p.y + rn.y * side * (track.width / 2 + 26),
        warnAt: world.time, appearAt: Math.max(world.time + BEAR.warning, nextAppear),
      };
    }
    return null;
  }

  const clear = (world: HazardWorld, x: number, y: number) =>
    world.cars.every((c) => Math.hypot(c.pos.x - x, c.pos.y - y) >= BEAR.minCarDistance);

  return {
    avoid: { range: BEAR.aiRange, slow: BEAR.aiSlow, margin: BEAR.aiMargin, lookahead: BEAR.aiLookahead },
    impact: { speedKeep: BEAR.speedKeep, restitution: BEAR.restitution, minImpact: BEAR.minImpact },
    bodies: () => bears,
    warning: () => (plan ? { x: plan.x, y: plan.y, signX: plan.signX, signY: plan.signY, age: now - plan.warnAt } : null),

    step(world, dt) {
      now = world.time;
      // Walk, and drop any bear that has left the road (no leak: nothing is kept past that).
      for (let i = bears.length - 1; i >= 0; i--) {
        const b = bears[i];
        b.age += dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.age >= life) bears.splice(i, 1);
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.life -= dt / BEAR.puffLife;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 2.5 * dt;
        p.vy *= 1 - 2.5 * dt;
        if (p.life <= 0) puffs.splice(i, 1);
      }

      const racing = world.phase === "racing" && world.cars[0].finishTime === null;
      if (!racing) {
        plan = null;
        return;
      }
      if (!plan) {
        if (bears.length < BEAR.max && now >= nextAppear - BEAR.warning && now >= retryAt) {
          plan = pickSpot(world);
          if (!plan) retryAt = now + BEAR.retryDelay;
        }
        return;
      }
      if (now < plan.appearAt) return;
      if (clear(world, plan.x, plan.y)) {
        bears.push({
          id: nextId++, x: plan.x, y: plan.y, vx: plan.dir.x * BEAR.speed, vy: plan.dir.y * BEAR.speed, angle: Math.atan2(plan.dir.y, plan.dir.x),
          rx: hx, ry: hy, age: 0, life, hit: new Set(),
        });
        world.cues.push({ kind: "growl", power: 1 });
        plan = null;
        nextAppear = now + pick(BEAR.interval);
      } else if (now - plan.appearAt > BEAR.maxSpawnDelay) {
        plan = null; // the spot stayed busy: pick another one shortly
        retryAt = now + BEAR.retryDelay;
      }
    },

    touch(body, carId, at, power) {
      const r = rng;
      for (let k = 0; k < BEAR.puffs && puffs.length < BEAR.maxPuffs; k++) {
        const a = r() * TAU, v = range(r, 40, 60 + power * 110);
        puffs.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: range(r, 4, 9), life: 1 });
      }
      const bear = bears.find((b) => b.id === body.id);
      if (!bear || bear.hit.has(carId)) return false;
      bear.hit.add(carId);
      const last = lastCounted.get(carId);
      if (last !== undefined && now - last < BEAR.contactGap) return false;
      lastCounted.set(carId, now);
      return true;
    },

    draw(ctx, time) {
      if (plan && Math.floor((time - plan.warnAt) * 5) % 2 === 0) warningSign(ctx, plan.signX, plan.signY, 46);
      for (const b of bears) {
        const alpha = Math.min(1, b.age / BEAR.fade, (b.life - b.age) / BEAR.fade);
        drawPolarBear(ctx, b.x, b.y, b.angle, b.age, BEAR.scale, Math.max(0, alpha));
      }
      for (const p of puffs) {
        ctx.fillStyle = `rgba(255,255,255,${(0.85 * p.life).toFixed(2)})`;
        ctx.strokeStyle = `rgba(159,178,196,${(0.5 * p.life).toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1.6 - p.life * 0.6), 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    },
  };
}

/** The north pole's hazard: the polar bear that crosses the road and the yeti that leaps from the massif (yeti.ts), side by side. The 3D view reads each one. */
export type NorthPoleHazard = Hazard & { bear: Hazard; yeti: YetiHazard };

function createNorthPole(track: Track, rng: Rng): NorthPoleHazard {
  const bear = createBears(track, rng);
  // The yeti has its own PRNG (drawn from the race's once): what it does never moves the bear's dice.
  const yeti = createYeti(track, mulberry32(Math.floor(rng() * 0x100000000)));
  return {
    bear,
    yeti,
    // The standing yeti is a solid ellipse like the bear (same bounce, same bot manoeuvres); its landing ring is a danger zone bots brake for.
    avoid: bear.avoid,
    impact: bear.impact,
    bodies: () => (yeti.bodies().length ? [...(bear.bodies?.() ?? []), ...yeti.bodies()] : (bear.bodies?.() ?? [])),
    dangers: () => yeti.dangers(),
    warning: () => bear.warning?.() ?? null,
    step(world, dt) {
      bear.step(world, dt);
      yeti.step(world, dt);
    },
    touch: (body, carId, at, power) => (yeti.owns(body) ? yeti.touch(body, carId, at, power) : (bear.touch?.(body, carId, at, power) ?? false)),
    drawGround: (ctx, time, view) => yeti.drawGround(ctx, time, view),
    draw(ctx, time, view) {
      bear.draw(ctx, time, view);
      yeti.draw(ctx, time, view);
    },
    drawHud: (ctx, w, h) => yeti.drawHud(ctx, w, h),
    shake: (at) => yeti.shake(at),
  };
}

// ---------- ice-mountain tunnel ----------

/** Sample indices along the loop from `from`, `len` samples long, every `step`. */
function arcIndices(n: number, from: number, len: number, step: number): number[] {
  const out: number[] = [];
  for (let k = 0; k <= len; k += step) out.push((from + k) % n);
  if (out[out.length - 1] !== (from + len) % n) out.push((from + len) % n);
  return out;
}

type Flank = { inner: Pt[]; mid: Pt[]; outer: Pt[]; occ: Circle[] };

/** One side of the massif: a ribbon hugging the road from outside the barrier, bulging into
 * a peak over the tunnel core and tapering into the open snowfield at both ends. */
function buildFlank(track: Track, idxs: number[], side: 1 | -1, innerOff: number, jagRng: Rng): Flank {
  const inner: Pt[] = [], mid: Pt[] = [], outer: Pt[] = [], occ: Circle[] = [];
  const m = idxs.length;
  for (let k = 0; k < m; k++) {
    const idx = idxs[k];
    const bulge = Math.sin(Math.PI * clamp(k / (m - 1), 0, 1));
    const outerOff = innerOff + 85 + bulge * 230 + range(jagRng, -30, 50);
    inner.push(onTrackPoint(track, idx, side * innerOff));
    outer.push(onTrackPoint(track, idx, side * outerOff));
    mid.push(onTrackPoint(track, idx, side * (innerOff + (outerOff - innerOff) * 0.5)));
    if (k % 2 === 0) occ.push({ x: mid[mid.length - 1].x, y: mid[mid.length - 1].y, r: (outerOff - innerOff) / 2 + 24 });
  }
  return { inner, mid, outer, occ };
}

function ring(ctx: Ctx, a: Pt[], b: Pt[]) {
  ctx.beginPath();
  a.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i].x, b[i].y);
  ctx.closePath();
}

function drawFlank(ctx: Ctx, f: Flank, rng: Rng) {
  ring(ctx, f.inner, f.outer);
  const g = ctx.createLinearGradient(f.inner[0].x, f.inner[0].y, f.outer[Math.floor(f.outer.length / 2)].x, f.outer[Math.floor(f.outer.length / 2)].y);
  g.addColorStop(0, "rgba(70,105,145,0.5)");
  g.addColorStop(1, "rgba(140,185,220,0.75)");
  ctx.fillStyle = g;
  ctx.fill();
  // Snow cap: the outer half, paler and more opaque.
  ring(ctx, f.mid, f.outer);
  ctx.fillStyle = "rgba(238,247,253,0.88)";
  ctx.fill();
  // Crevasses, clipped to the rock body so they never spill onto open snow.
  ctx.save();
  ring(ctx, f.inner, f.outer);
  ctx.clip();
  ctx.strokeStyle = "rgba(15,40,70,0.5)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let i = 0; i < 14; i++) {
    const p0 = f.inner[Math.floor(range(rng, 0, f.inner.length - 1))];
    let x = p0.x, y = p0.y, a = range(rng, 0, TAU);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      a += range(rng, -0.7, 0.7);
      x += Math.cos(a) * range(rng, 18, 46);
      y += Math.sin(a) * range(rng, 18, 46);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // Ridge outline.
  ring(ctx, f.inner, f.outer);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Entrance/exit gate: a row of icicles spanning the tunnel mouth, hanging toward `into`. */
function portalGate(ctx: Ctx, l: Pt, r: Pt, into: Pt, rng: Rng) {
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = l.x + (r.x - l.x) * t, y = l.y + (r.y - l.y) * t;
    const len = range(rng, 34, 66), w = range(rng, 11, 19);
    const px = -into.y, py = into.x;
    ctx.beginPath();
    ctx.moveTo(x + px * w, y + py * w);
    ctx.lineTo(x + into.x * len, y + into.y * len);
    ctx.lineTo(x - px * w, y - py * w);
    ctx.closePath();
    ctx.fillStyle = "rgba(223,241,252,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(l.x, l.y);
  ctx.lineTo(r.x, r.y);
  ctx.strokeStyle = "rgba(235,247,255,0.95)";
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  ctx.stroke();
}

export function scene(track: Track): Scene {
  const rng = mulberry32(3001);
  const massifRng = mulberry32(3010);
  const b = track.bounds;
  const occ: Circle[] = [];
  const n = track.path.length;
  const cover = track.covers[0];
  let coreLen = cover.end - cover.start;
  if (coreLen < 0) coreLen += n;

  // Massif flanks: foothills either side of the approach roads, bulging into a peak over
  // the tunnel core, built from just outside the barrier outward.
  const FLANK_PAD = 60;
  const flankFrom = ((cover.start - FLANK_PAD) % n + n) % n;
  const flankIdx = arcIndices(n, flankFrom, coreLen + FLANK_PAD * 2, 4);
  const innerOff = track.barrier + 24;
  const leftFlank = buildFlank(track, flankIdx, -1, innerOff, massifRng);
  const rightFlank = buildFlank(track, flankIdx, 1, innerOff, massifRng);
  occ.push(...leftFlank.occ, ...rightFlank.occ);

  // Tunnel roof: a short, solid cap over the road itself (the only place scenery is allowed
  // on the track band), a little wider than the cover so the portals read as a real gate.
  const ROOF_PAD = 6;
  const roofFrom = ((cover.start - ROOF_PAD) % n + n) % n;
  const roofLen = coreLen + ROOF_PAD * 2;
  const roofIdx = arcIndices(n, roofFrom, roofLen, 3);
  // Wide enough to overlap the flanks' inner edge, so the roof reads as part of the massif.
  const roofHalf = innerOff + 70;
  const roofLeft = roofIdx.map((i) => onTrackPoint(track, i, -roofHalf));
  const roofRight = roofIdx.map((i) => onTrackPoint(track, i, roofHalf));
  const entranceT = track.tangents[roofFrom];
  const exitIdx = (roofFrom + roofLen) % n;
  const exitT = track.tangents[exitIdx];

  const igloos = scatter(track, rng, occ, 4, 34, 42);
  const colony = igloos.length ? scatterNear(track, rng, occ, 1, igloos[0], 60, 26) : [];
  const bears = scatter(track, rng, occ, 1, 42, 42);
  const firs = scatter(track, rng, occ, 54, 16, 30);
  const blocks = scatter(track, rng, occ, 18, 9, 17);
  const drifts = Array.from({ length: 60 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY),
    rx: range(rng, 120, 380), ry: range(rng, 40, 130), rot: range(rng, -0.6, 0.6), light: rng() < 0.55,
  }));
  const sastrugi = Array.from({ length: 160 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY), len: range(rng, 40, 140), a: range(rng, -0.5, -0.2),
  }));

  return {
    props: [
      ...igloos.map((c, i) => ({ kind: "igloo" as const, ...c, a: i * 2.1 })),
      ...colony.map((c) => ({ kind: "penguin" as const, ...c })),
      ...bears.map((c) => ({ kind: "polarbear" as const, ...c, a: 0.7 })),
      ...firs.map((c) => ({ kind: "fir" as const, ...c })),
      ...blocks.map((c, i) => ({ kind: "iceblock" as const, ...c, a: i * 1.7 })),
    ],
    lava: [],
    vents: [],
    hazard: createNorthPole,
    under(ctx) {
      for (const d of drifts)
        softBlob(ctx, d.x, d.y, d.rx, d.ry, d.rot, d.light ? "255,255,255" : "170,200,225", d.light ? 0.85 : 0.45);
      ctx.strokeStyle = "rgba(160,190,215,0.45)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const s of sastrugi) {
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(s.a) * s.len, s.y + Math.sin(s.a) * s.len);
      }
      ctx.stroke();
    },
    onTrack(ctx) {
      // Darken and cool the road under the mountain before the icy sheen on top of it.
      ring(ctx, roofLeft, roofRight);
      ctx.fillStyle = "rgba(8,22,40,0.5)";
      ctx.fill();
      // Tunnel lights on the road, seen through the fading ice when the player is inside.
      for (let k = 14; k < roofLen - 14; k += 24) {
        const p = track.path[(roofFrom + k) % n];
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 70);
        g.addColorStop(0, "rgba(255,238,195,0.45)");
        g.addColorStop(1, "rgba(255,238,195,0)");
        disc(ctx, p.x, p.y, 70, g);
      }

      const d = mulberry32(3002);
      const nn = track.path.length;
      // Glossy streaks along the direction of travel.
      for (let i = 0; i < 160; i++) {
        const start = Math.floor(d() * nn), off = (d() - 0.5) * track.width * 0.85, l = 3 + Math.floor(d() * 8);
        ctx.beginPath();
        for (let k = 0; k <= l; k++) {
          const p = onTrackPoint(track, (start + k) % nn, off);
          if (k) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        }
        ctx.strokeStyle = `rgba(255,255,255,${range(d, 0.15, 0.4).toFixed(2)})`;
        ctx.lineWidth = range(d, 2, 6);
        ctx.stroke();
      }
      // Hairline cracks.
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 90; i++) {
        const p = onTrackPoint(track, Math.floor(d() * nn), (d() - 0.5) * track.width * 0.8);
        let x = p.x, y = p.y, a = d() * TAU;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          a += range(d, -0.9, 0.9);
          x += Math.cos(a) * range(d, 6, 16);
          y += Math.sin(a) * range(d, 6, 16);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    over(ctx) {
      drawFlank(ctx, leftFlank, massifRng);
      drawFlank(ctx, rightFlank, massifRng);
      const d = mulberry32(3003);
      for (const c of blocks) iceBlock(ctx, c, d() * TAU);
      for (const c of igloos) igloo(ctx, c, d() * TAU);
      for (const c of colony) for (let i = 0; i < 3; i++) penguin(ctx, c.x + (i - 1) * 14, c.y + (i % 2) * 10, range(d, -0.4, 0.4));
      for (const c of bears) polarBear(ctx, c, d() * TAU);
      for (const c of firs) fir(ctx, c);
    },
    overhead(ctx) {
      // Translucent blue ice, paler toward the ridge: bands stroked along the crest so they follow the bend.
      ring(ctx, roofLeft, roofRight);
      ctx.fillStyle = "#7fb2d8";
      ctx.fill();
      const iceRng = mulberry32(3012);
      ctx.save();
      ring(ctx, roofLeft, roofRight);
      ctx.clip();
      // Snow ridge along the crest, with drifts spilling down both sides.
      const crest = roofIdx.map((i) => onTrackPoint(track, i, 0));
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      crest.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      for (const [w, c] of [[1.6, "#a2cbe8"], [1.25, "#bfe0f4"]] as const) {
        ctx.strokeStyle = c;
        ctx.lineWidth = roofHalf * w;
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = roofHalf * 0.9;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = roofHalf * 0.35;
      ctx.stroke();
      for (let k = 0; k < crest.length; k += 3) {
        const p = crest[k];
        softBlob(ctx, p.x + range(iceRng, -40, 40), p.y + range(iceRng, -40, 40), range(iceRng, 40, 90), range(iceRng, 20, 45), range(iceRng, 0, TAU), "255,255,255", 0.6);
      }
      // Crevasses: dark blue zigzags with a bright lip.
      for (let i = 0; i < 18; i++) {
        const k = Math.floor(range(iceRng, 0, roofLeft.length));
        const t = range(iceRng, 0.12, 0.88);
        let x = roofLeft[k].x + (roofRight[k].x - roofLeft[k].x) * t, y = roofLeft[k].y + (roofRight[k].y - roofLeft[k].y) * t;
        let a = range(iceRng, 0, TAU);
        const pts: Pt[] = [{ x, y }];
        for (let s = 0; s < 4; s++) {
          a += range(iceRng, -0.8, 0.8);
          x += Math.cos(a) * range(iceRng, 16, 40);
          y += Math.sin(a) * range(iceRng, 16, 40);
          pts.push({ x, y });
        }
        for (const [style, w] of [["rgba(20,60,105,0.6)", 4], ["rgba(255,255,255,0.7)", 1.2]] as const) {
          ctx.beginPath();
          pts.forEach((q, j) => (j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.strokeStyle = style;
          ctx.lineWidth = w;
          ctx.stroke();
        }
      }
      ctx.restore();
      // Shaded rim where the ice meets the flanks.
      ring(ctx, roofLeft, roofRight);
      ctx.strokeStyle = "rgba(60,105,150,0.45)";
      ctx.lineWidth = 6;
      ctx.stroke();

      const gateRng = mulberry32(3011);
      portalGate(ctx, roofLeft[0], roofRight[0], entranceT, gateRng);
      portalGate(ctx, roofLeft[roofLeft.length - 1], roofRight[roofRight.length - 1], { x: -exitT.x, y: -exitT.y }, gateRng);
    },
  };
}

export const fx: Fx = {
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
