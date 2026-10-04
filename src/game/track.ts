import { type Vec, vec, sub, len, dot } from "./vec";

export type Track = {
  /** Closed centerline, densely sampled. Index 0 is the start/finish line. */
  path: Vec[];
  /** Unit tangent at each sample. */
  tangents: Vec[];
  width: number;
  /** Distance from the centerline to the barriers on both sides (runoff between kerb and barrier). */
  barrier: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

// Hand-designed circuit, clockwise. The first point is the start/finish line.
const CONTROL_POINTS: [number, number][] = [
  [400, 1100], [400, 600], [650, 300], [1100, 280], [1400, 560], [1750, 420],
  [2250, 330], [2700, 560], [2780, 1050], [2450, 1380], [1950, 1250],
  [1550, 1560], [1050, 1760], [600, 1620],
];

const SAMPLES_PER_SEGMENT = 40;

function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return vec(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y));
}

export function buildTrack(width = 190): Track {
  const pts = CONTROL_POINTS.map(([x, y]) => vec(x, y));
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
  return {
    path,
    tangents,
    width,
    barrier: width / 2 + 55,
    bounds: { minX: Math.min(...xs) - m, minY: Math.min(...ys) - m, maxX: Math.max(...xs) + m, maxY: Math.max(...ys) + m },
  };
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
