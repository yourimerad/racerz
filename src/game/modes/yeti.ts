import { CAR_RADIUS, isAirborne } from "../car";
import { hurt, isDestroyed } from "../health";
import { type Hazard, type HazardBody, type HazardDanger, type HazardWorld, type Rng, range } from "../scenery";
import { type Track } from "../track";
import { type Vec, vec } from "../vec";

// The yeti of the north pole. From time to time it leaps from the top of the ice massif, over the tunnel, and lands on the road a little before
// the tunnel's entrance or a little after its exit: a ring closes in on the spot (the warning), the yeti roars on its perch, jumps (an arc over the
// barriers), and lands with its whole weight — any car on the ground under it loses points (health.ts) and most of its speed. It then stands
// there a moment, as solid as the polar bear, and leaps away across the road. A car flying (the Racerz Jet, 20 m and more) passes over it.
//
// The spot is where the player will be when it lands (the way the volcano aims its bombs), but only near the tunnel: the yeti jumps when the
// player is about to reach one of the two stretches of road at the massif's ends. World units are pixels (1 px = 0.1 m); heights are metres.

export const YETI = {
  /** Never sooner than this after the green light (s); then between two jumps, a pause of this many seconds (min, max). */
  FIRST: 10, GAP: [6, 14] as const,
  /** The ring closing in on the landing spot while it roars on its perch (s), then the jump itself, standing, and leaping away. */
  WARN: 1.3, FLIGHT: 1.6, STAND: 2.4, LEAVE: 0.9,
  /** Cars under it: how near (px, plus the car's own radius) the landing spot they are hurt, how many points, the speed they keep, and the seconds
   * a car just hurt cannot be hurt by it again. */
  LAND_R: 50, DAMAGE: 30, SPEED_KEEP: 0.5, INVULN: 1.2,
  /** Standing, it is a solid ellipse (half-axes along / across its heading, px) the cars bounce off like the polar bear. */
  BODY: { rx: 30, ry: 36 },
  impact: { speedKeep: 0.3, restitution: 0.3, minImpact: 40 },
  /** Fair play: no car within MIN_CAR_DIST px of the spot when the ring appears, never within SAFE_FINISH px of the line, and the spot is on the road. */
  MIN_CAR_DIST: 110, SAFE_FINISH: 220,
  /** Where it jumps from and to, in samples along the road (~10 px each): the perch is CROWN samples inside the tunnel from the portal. The spot
   * must fall in a window of road before the entrance or after the exit: [from, to] samples out from the portal. */
  CROWN: 30, WINDOW: [20, 60] as const,
  /** Perch height (m: the massif's crown over the tunnel), arc height above the straight line (m). */
  PERCH_H: 20, APEX: 10,
  /** The player's predicted spot: at least this far ahead (px), and what share of the jumps aims at the player (the others at a random lane). */
  AHEAD_MIN: 500, AHEAD_MAX: 2200, PLAYER_SHARE: 0.7, SPREAD: [0.85, 1.1] as const,
  /** The spot's offset across the road, as a share of the half width, at most. */
  LANE: 0.62,
  /** Bots: slow to AI_SLOW × their limit within AI_RANGE px of the ring (+ AI_LOOKAHEAD s of their speed) and steer round it with AI_MARGIN px. */
  AI_RANGE: 140, AI_LOOKAHEAD: 0.9, AI_SLOW: 0.5, AI_MARGIN: 20,
  /** The camera shake of the landing: size (world units) and how far away it is felt (px). */
  SHAKE: 9, SHAKE_RANGE: 1100, EARSHOT: 1500,
  /** When no spot is found: ask again after (s). */
  RETRY: 0.3,
};

/** The standing yeti's body id is BODY_ID + the jump's number: never one of the polar bears' (1, 2, 3…). */
export const BODY_ID = 100000;

export type YetiPhase = "warn" | "flight" | "stand" | "leave";

/** One jump, from the roar on the perch to the leap away. `x`, `y` (px) and `z` (m) are where the yeti is NOW; `age` is the seconds in this phase. */
export type YetiJump = {
  id: number;
  phase: YetiPhase;
  age: number;
  /** The perch (on the tunnel's crown) and the landing spot, px. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Where it faces (radians), and the direction it leaps away along. */
  heading: number;
  awayX: number;
  awayY: number;
  x: number;
  y: number;
  z: number;
  /** Cars hurt by this landing; cars whose contact with the standing yeti was counted. */
  hurt: Set<number>;
  touched: Set<number>;
};

export type YetiPopup = { x: number; y: number; text: string; age: number };

export type YetiHazard = Hazard & {
  /** The jump in progress (null between two), the damage numbers on screen, and the landing shake in progress. */
  state: { jump: YetiJump | null; popups: YetiPopup[]; quake: { x: number; y: number; age: number } | null };
  /** Whether this solid body is the yeti's (the north pole's hazard asks before it dispatches a touch). */
  owns(body: HazardBody): boolean;
} & Required<Pick<Hazard, "bodies" | "dangers" | "touch" | "drawGround" | "drawHud" | "shake">>;

/** Sample index `dist` px further along the loop. */
function advance(track: Track, from: number, dist: number): number {
  const n = track.path.length;
  let i = ((from % n) + n) % n, d = 0;
  for (let k = 0; k < n && d < dist; k++) {
    const a = track.path[i], b = track.path[(i + 1) % n];
    d += Math.hypot(b.x - a.x, b.y - a.y);
    i = (i + 1) % n;
  }
  return i;
}

/** The tunnel's two ends, in samples (the first covered section): null when the mode has none. */
export function portalsOf(track: Track): { entrance: number; exit: number } | null {
  const c = track.covers[0];
  return c ? { entrance: c.start, exit: c.end } : null;
}

/**
 * The spots the yeti may land on: for each portal, the samples WINDOW[0]..WINDOW[1] out from it (before the entrance, after the exit), each with
 * the perch it jumps from. Samples are indices into the track's centre line.
 */
export function yetiSpots(track: Track): { land: number; perch: number; side: "entrance" | "exit" }[] {
  const p = portalsOf(track), n = track.path.length;
  if (!p) return [];
  const out: { land: number; perch: number; side: "entrance" | "exit" }[] = [];
  for (let k = YETI.WINDOW[0]; k <= YETI.WINDOW[1]; k++) {
    out.push({ land: (p.entrance - k + n) % n, perch: (p.entrance + YETI.CROWN) % n, side: "entrance" });
    out.push({ land: (p.exit + k) % n, perch: (((p.exit - YETI.CROWN) % n) + n) % n, side: "exit" });
  }
  return out;
}

/** One race's yeti: state lives here (a fresh one per race), driven by the simulation clock. */
export function createYeti(track: Track, rng: Rng): YetiHazard {
  const n = track.path.length, spots = yetiSpots(track);
  const pick = (r: readonly [number, number]) => range(rng, r[0], r[1]);
  let jump: YetiJump | null = null;
  let nextAt = YETI.FIRST + pick([0, 8]), retryAt = 0, nextId = 1, now = 0;
  const popups: YetiPopup[] = [];
  const invuln = new Map<number, number>(); // car id → race time until which this yeti cannot hurt it again
  let quake: { x: number; y: number; age: number } | null = null;
  const body: HazardBody = { id: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0, rx: YETI.BODY.rx, ry: YETI.BODY.ry };
  const standing = () => (jump && jump.phase === "stand" ? [body] : []);

  /** The spot for a jump that starts now, or null: where the player will be when it lands, if that falls in a window near a portal. */
  function plan(world: HazardWorld): { land: number; perch: number; lane: number } | null {
    const me = world.cars[0], v = Math.max(300, Math.hypot(me.vel.x, me.vel.y));
    const ahead = Math.min(YETI.AHEAD_MAX, Math.max(YETI.AHEAD_MIN, v * (YETI.WARN + YETI.FLIGHT) * range(rng, YETI.SPREAD[0], YETI.SPREAD[1])));
    const idx = advance(track, me.lastIndex, ahead);
    const spot = spots.find((s) => s.land === idx);
    if (!spot) return null;
    // Not on the start/finish line, and the spot must be free of cars.
    if (Math.min(spot.land, n - spot.land) * 10 < YETI.SAFE_FINISH) return null;
    const p = track.path[spot.land];
    if (world.cars.some((c) => !isDestroyed(c) && Math.hypot(c.pos.x - p.x, c.pos.y - p.y) < YETI.MIN_CAR_DIST)) return null;
    // Across the road: where the player will be (most of the time), or any lane.
    const half = track.width / 2;
    const off = (me.pos.x - track.path[me.lastIndex].x) * -track.tangents[me.lastIndex].y + (me.pos.y - track.path[me.lastIndex].y) * track.tangents[me.lastIndex].x;
    const aimed = rng() < YETI.PLAYER_SHARE ? off : range(rng, -half, half);
    const lane = Math.max(-YETI.LANE, Math.min(YETI.LANE, aimed / half)) * half;
    return { land: spot.land, perch: spot.perch, lane };
  }

  function begin(world: HazardWorld, pl: { land: number; perch: number; lane: number }) {
    const p = track.path[pl.land], t = track.tangents[pl.land], nx = -t.y, ny = t.x;
    const toX = p.x + nx * pl.lane, toY = p.y + ny * pl.lane;
    const q = track.path[pl.perch], tq = track.tangents[pl.perch], side = rng() < 0.5 ? -1 : 1;
    const fromX = q.x + -tq.y * side * track.width * 0.25, fromY = q.y + tq.x * side * track.width * 0.25;
    const heading = Math.atan2(toY - fromY, toX - fromX);
    // It leaps away across the road, the side opposite to where it came from along the road's normal.
    const away = pl.lane >= 0 ? 1 : -1;
    jump = {
      id: nextId++, phase: "warn", age: 0, fromX, fromY, toX, toY, heading, awayX: nx * away, awayY: ny * away,
      x: fromX, y: fromY, z: YETI.PERCH_H, hurt: new Set(), touched: new Set(),
    };
    const me = world.cars[0], d = Math.hypot(me.pos.x - fromX, me.pos.y - fromY);
    if (d < YETI.EARSHOT * 1.6) world.cues.push({ kind: "roar", power: Math.max(0.3, 1 - d / (YETI.EARSHOT * 1.6)) });
  }

  function land(world: HazardWorld, j: YetiJump) {
    j.phase = "stand";
    j.age = 0;
    j.x = j.toX;
    j.y = j.toY;
    j.z = 0;
    body.id = BODY_ID + j.id;
    body.x = j.toX;
    body.y = j.toY;
    body.angle = j.heading;
    for (const car of world.cars) {
      if (isAirborne(car) || isDestroyed(car) || (invuln.get(car.id) ?? -1) > now) continue;
      if (Math.hypot(car.pos.x - j.toX, car.pos.y - j.toY) >= YETI.LAND_R + CAR_RADIUS) continue;
      if (hurt(car, YETI.DAMAGE, now) > 0) {
        j.hurt.add(car.id);
        invuln.set(car.id, now + YETI.INVULN);
        car.vel = vec(car.vel.x * YETI.SPEED_KEEP, car.vel.y * YETI.SPEED_KEEP);
        popups.push({ x: car.pos.x + 10, y: car.pos.y - 20, text: "-" + YETI.DAMAGE, age: 0 });
      }
    }
    quake = { x: j.toX, y: j.toY, age: 0 };
    const me = world.cars[0], d = Math.hypot(me.pos.x - j.toX, me.pos.y - j.toY);
    if (d < YETI.EARSHOT) world.cues.push({ kind: "quake", power: Math.max(0.3, 1 - d / YETI.EARSHOT) });
  }

  const dangers = (): HazardDanger[] => (jump && (jump.phase === "warn" || jump.phase === "flight") ? [{ id: BODY_ID + jump.id, x: jump.toX, y: jump.toY, r: YETI.LAND_R + 14, brake: true }] : []);

  return {
    avoid: { range: YETI.AI_RANGE, slow: YETI.AI_SLOW, margin: YETI.AI_MARGIN, lookahead: YETI.AI_LOOKAHEAD },
    impact: YETI.impact,
    bodies: () => standing(),
    dangers,
    state: { get jump() { return jump; }, popups, get quake() { return quake; } },
    owns: (b) => jump !== null && b.id === BODY_ID + jump.id && jump.phase === "stand",

    step(world, dt) {
      now = world.time;
      for (let i = popups.length - 1; i >= 0; i--) {
        popups[i].age += dt;
        popups[i].y -= 40 * dt;
        if (popups[i].age > 0.9) popups.splice(i, 1);
      }
      if (quake) {
        quake.age += dt;
        if (quake.age > 0.9) quake = null;
      }
      const j = jump;
      if (j) {
        j.age += dt;
        if (j.phase === "warn") {
          if (j.age >= YETI.WARN) {
            j.phase = "flight";
            j.age = 0;
          }
        } else if (j.phase === "flight") {
          const u = Math.min(1, j.age / YETI.FLIGHT);
          j.x = j.fromX + (j.toX - j.fromX) * u;
          j.y = j.fromY + (j.toY - j.fromY) * u;
          j.z = YETI.PERCH_H * (1 - u) + 4 * YETI.APEX * u * (1 - u);
          if (u >= 1) land(world, j);
        } else if (j.phase === "stand") {
          if (j.age >= YETI.STAND) {
            j.phase = "leave";
            j.age = 0;
          }
        } else {
          const u = Math.min(1, j.age / YETI.LEAVE), run = (track.width / 2 + YETI.BODY.rx + 40) / YETI.LEAVE;
          j.x += j.awayX * run * dt;
          j.y += j.awayY * run * dt;
          j.z = 5 * Math.sin(Math.PI * u);
          if (u >= 1) {
            jump = null;
            nextAt = now + pick(YETI.GAP);
          }
        }
      }
      const racing = world.phase === "racing" && world.cars[0].finishTime === null && !isDestroyed(world.cars[0]);
      if (!racing) return;
      if (!jump && now >= nextAt && now >= retryAt) {
        const pl = plan(world);
        if (pl) begin(world, pl);
        else retryAt = now + YETI.RETRY;
      }
    },

    touch(b, carId, at, power) {
      void at;
      void power;
      const j = jump;
      if (!j || b.id !== BODY_ID + j.id || j.touched.has(carId)) return false;
      j.touched.add(carId);
      return true;
    },

    drawGround(ctx, time) {
      const j = jump;
      if (!j || (j.phase !== "warn" && j.phase !== "flight")) return;
      const left = j.phase === "warn" ? YETI.WARN - j.age + YETI.FLIGHT : YETI.FLIGHT - j.age;
      const blink = left < 0.5 && Math.floor(time * 12) % 2 === 0 ? 0.35 : 1;
      ctx.save();
      ctx.translate(j.toX, j.toY);
      ctx.globalAlpha = blink;
      ctx.fillStyle = "rgba(255,140,31,0.2)";
      ctx.beginPath();
      ctx.arc(0, 0, YETI.LAND_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ff8a1f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, YETI.LAND_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, YETI.LAND_R + 8 + 40 * Math.min(1, left / (YETI.WARN + YETI.FLIGHT)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },

    draw(ctx) {
      const j = jump;
      if (j && j.phase !== "warn") {
        // A big pale shape from above: its shadow on the ground and its body (bigger the higher it is).
        const alpha = j.phase === "leave" ? 1 - j.age / YETI.LEAVE : 1, s = 1 + j.z * 0.02;
        ctx.save();
        ctx.translate(j.x, j.y);
        ctx.globalAlpha = alpha * 0.25;
        ctx.fillStyle = "#1c2c40";
        ctx.beginPath();
        ctx.ellipse(8, 8 + j.z * 0.5, YETI.BODY.rx, YETI.BODY.ry, j.heading, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.rotate(j.heading);
        ctx.scale(s, s);
        ctx.fillStyle = "#eef4fa";
        ctx.strokeStyle = "#9db4c8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, YETI.BODY.rx, YETI.BODY.ry * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#cddbe8";
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(10, sy * YETI.BODY.ry * 0.85, 22, 9, sy * 0.3, 0, Math.PI * 2); // arms
          ctx.fill();
        }
        ctx.fillStyle = "#f6f9fc";
        ctx.beginPath();
        ctx.arc(YETI.BODY.rx * 0.75, 0, 16, 0, Math.PI * 2); // head
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      for (const p of popups) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p.age / 0.9);
        ctx.font = "800 26px sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 6;
        ctx.strokeStyle = "#fff";
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = "#ff3b2f";
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      }
    },

    drawHud(ctx, W) {
      const j = jump;
      if (!j || (j.phase !== "warn" && j.phase !== "flight") || Math.floor(performance.now() / 120) % 3 === 2) return;
      // A blinking warning triangle, top centre (the minimap is on the right).
      const ax = W / 2, ay = 14;
      ctx.save();
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
      ctx.restore();
    },

    shake(at): Vec {
      if (!quake) return { x: 0, y: 0 };
      const d = Math.hypot(at.x - quake.x, at.y - quake.y), k = Math.max(0, 1 - d / YETI.SHAKE_RANGE) * Math.exp(-quake.age * 4) * YETI.SHAKE;
      return { x: Math.sin(quake.age * 70) * k, y: Math.cos(quake.age * 53) * k };
    },
  };
}
