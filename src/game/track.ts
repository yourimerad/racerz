import { type Vec, vec, sub, len, dot } from "./vec";

/** A sample-index range on the closed path; `end < start` means the range wraps past index 0. */
export type CoverRange = { start: number; end: number };

export type Track = {
  /** Closed centerline, densely sampled. Index 0 is the start/finish line. */
  path: Vec[];
  /** Unit tangent at each sample. */
  tangents: Vec[];
  width: number;
  /** Distance from the centerline to the barriers on both sides (runoff between kerb and barrier). */
  barrier: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Covered sections (tunnels, crater, canyon…), as sample-index ranges. */
  covers: CoverRange[];
};

/** A covered section, in control-point units (e.g. 3.5 = halfway between points 3 and 4). */
export type CoverLayout = { from: number; to: number };

/** Per-mode circuit: its own control points, optional width and covered sections. */
export type TrackLayout = {
  points: [number, number][];
  width?: number;
  covers?: CoverLayout[];
};

const SAMPLES_PER_SEGMENT = 40;
const DEFAULT_WIDTH = 190;

function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return vec(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y));
}

/** Convert a control-point unit (may be fractional) to a sample index, wrapped into [0, total). */
function toSampleIndex(control: number, samplesPerSegment: number, total: number): number {
  return ((Math.round(control * samplesPerSegment) % total) + total) % total;
}

export function buildTrack(layout: TrackLayout): Track {
  const width = layout.width ?? DEFAULT_WIDTH;
  const pts = layout.points.map(([x, y]) => vec(x, y));
  const n = pts.length;
  const path: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) path.push(catmullRom(p0, p1, p2, p3, s / SAMPLES_PER_SEGMENT));
  }
  const tangents = path.map((_, i) => {
    const d = sub(path[(i + 1) % path.length], path[(i - 1 + path.length) % path.length]);
    const l = len(d) || 1;
    return vec(d.x / l, d.y / l);
  });
  const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
  const m = width * 2;
  const covers: CoverRange[] = (layout.covers ?? []).map((c) => ({
    start: toSampleIndex(c.from, SAMPLES_PER_SEGMENT, path.length),
    end: toSampleIndex(c.to, SAMPLES_PER_SEGMENT, path.length),
  }));
  return {
    path,
    tangents,
    width,
    barrier: width / 2 + 55,
    bounds: { minX: Math.min(...xs) - m, minY: Math.min(...ys) - m, maxX: Math.max(...xs) + m, maxY: Math.max(...ys) + m },
    covers,
  };
}

/** Whether sample `index` falls under a covered section (handles ranges that wrap past 0). */
export function isCovered(track: Track, index: number): boolean {
  const n = track.path.length;
  const i = ((index % n) + n) % n;
  return track.covers.some((c) => (c.start <= c.end ? i >= c.start && i <= c.end : i >= c.start || i <= c.end));
}

const tracks = new Map<string, Track>();
/** The layout is deterministic, so each mode's track is built once and reused. */
export function trackFor(id: string, layout: TrackLayout): Track {
  let t = tracks.get(id);
  if (!t) tracks.set(id, (t = buildTrack(layout)));
  return t;
}

/** Nearest centerline sample and signed lateral offset (positive = right of travel direction). */
export function locate(track: Track, p: Vec): { index: number; dist: number; offset: number } {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < track.path.length; i++) {
    const q = track.path[i];
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const t = track.tangents[best];
  const offset = dot(sub(p, track.path[best]), vec(-t.y, t.x));
  return { index: best, dist: Math.sqrt(bestD), offset };
}
