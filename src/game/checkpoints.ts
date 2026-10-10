import type { Car } from "./car";
import { centerlineOf } from "./boost";
import { WALLS } from "./flight";
import type { Track } from "./track";

// Invisible checkpoints (anti-shortcut): WALLS.GATES gates spread along the lap, each a segment across the road (a little wider than the
// whole road, barriers included, so a car that stays inside the barriers cannot miss one). A lap only counts once every gate was crossed,
// in order and in the forward direction — in the air too. Flying over a wall to cut a corner is fine as long as no gate is skipped;
// crossing the line with a gate missing is refused: the car goes back to the first missing gate with a time penalty.
//
// The game had no checkpoints before (laps follow the centre-line index), so this is the whole system. race.ts only builds it for a race
// in the Racerz Jet (the one car that can leave the road) and asks it about the human's lap; the bots' laps are never refused.

type Pt = { x: number; y: number };
/** `back` = where a car sent back to the gate is put: a few samples before it, so that it crosses the gate again (standing on it, it never would). */
export type Gate = { x: number; y: number; heading: number; index: number; a: Pt; b: Pt; back: { x: number; y: number; heading: number; index: number } };
const BACK_SAMPLES = 3;
type GateState = { next: number; prev: Pt | null; flash: number };

/** Hooks into the race: putting a car back (with its path index) and the time penalty. */
export type GuardAdapter = {
  respawn(car: Car, x: number, y: number, heading: number, speedFactor: number, index: number): void;
  addTimePenalty(car: Car, sec: number): void;
};

function segCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt) {
  const d = (a: Pt, b: Pt, c: Pt) => (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
  return d(p3, p4, p1) * d(p3, p4, p2) < 0 && d(p1, p2, p3) * d(p1, p2, p4) < 0;
}

export class CheckpointGuard {
  readonly gates: Gate[];
  private A: GuardAdapter;
  private state = new Map<number, GateState>();

  constructor(track: Track, adapter: GuardAdapter) {
    this.A = adapter;
    this.gates = CheckpointGuard.build(track);
  }

  /** The gates: evenly spread along the centre line, none on the start/finish line itself. */
  static build(track: Track): Gate[] {
    const cl = centerlineOf(track);
    if (cl.length < 2) return [];
    const S = cl[cl.length - 1].s, hw = track.width * WALLS.GATE_HALF, out: Gate[] = [];
    for (let k = 1; k <= WALLS.GATES; k++) {
      const t = (S * k) / (WALLS.GATES + 1);
      let index = 0;
      for (let i = 1; i < cl.length; i++) if (Math.abs(cl[i].s - t) < Math.abs(cl[index].s - t)) index = i;
      const p = cl[index], nx = -Math.sin(p.heading), ny = Math.cos(p.heading);
      const bi = Math.max(0, index - BACK_SAMPLES), q = cl[bi];
      out.push({
        x: p.x, y: p.y, heading: p.heading, index, a: { x: p.x - nx * hw, y: p.y - ny * hw }, b: { x: p.x + nx * hw, y: p.y + ny * hw },
        back: { x: q.x, y: q.y, heading: q.heading, index: bi },
      });
    }
    return out;
  }

  st(car: Car): GateState {
    let s = this.state.get(car.id);
    if (!s) {
      s = { next: 0, prev: null, flash: 0 };
      this.state.set(car.id, s);
    }
    return s;
  }

  /** Back to the first gate: at every new lap and at the restart (all cars, or one). */
  reset(car?: Car) {
    if (car) this.state.delete(car.id);
    else this.state.clear();
  }

  /** The car was put somewhere else: the next step must not read the jump as crossing a gate. */
  teleported(car: Car) {
    this.st(car).prev = null;
  }

  /** Called every step for every car, after it moved. */
  update(dt: number, car: Car) {
    const s = this.st(car), cur = { x: car.pos.x, y: car.pos.y };
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
    else if (s.flash < 0) s.flash = Math.min(0, s.flash + dt);
    const g = this.gates[s.next];
    if (g && s.prev && segCross(s.prev, cur, g.a, g.b) && (cur.x - s.prev.x) * Math.cos(g.heading) + (cur.y - s.prev.y) * Math.sin(g.heading) > 0) {
      s.next++;
      if (s.flash >= 0) s.flash = 1; // (the "manqué" message keeps its 1.5 s)
    }
    s.prev = cur;
  }

  allPassed(car: Car) {
    return this.st(car).next >= this.gates.length;
  }

  /** Gates crossed so far this lap. */
  passed(car: Car) {
    return this.st(car).next;
  }

  /** The car crossed the line with a gate missing: the lap is refused and it goes back to the first missing gate (just before it), with the penalty. */
  onMissedFinish(car: Car) {
    const s = this.st(car), g = this.gates[Math.min(s.next, this.gates.length - 1)];
    if (!g) return;
    this.A.respawn(car, g.back.x, g.back.y, g.back.heading, WALLS.RESPAWN_SPEED, g.back.index);
    this.A.addTimePenalty(car, WALLS.RESPAWN_PENALTY);
    s.prev = null;
    s.flash = -WALLS.MESSAGE;
  }

  /** The message to show the driver: "Checkpoint 3/8" for a second, "Checkpoint manqué !" for 1.5 s. */
  pill(car: Car): { text: string; bad: boolean } | null {
    const s = this.st(car);
    if (s.flash === 0) return null;
    return s.flash < 0 ? { text: "Checkpoint manqué !", bad: true } : { text: `Checkpoint ${s.next}/${this.gates.length}`, bad: false };
  }
}
