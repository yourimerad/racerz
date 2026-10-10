import { K } from "../adapter3d";
import type { Track } from "../track";
import { type Disposer, THREE } from "./core";

// Geometry builders shared by the modes: a fast distance-to-the-road field, a height field (canyon walls, the volcano's cone), the road
// ribbon and profile sweeps (barriers, tunnel and canopy shells). Pure geometry: no GL needed, so the checks build them in Node.

/** Distance from a point to the road's centre line (world units), through a bucket grid: a few hundred comparisons per query at most. */
export class DistField {
  private readonly cell: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  /** Index of the sample nearest to the last query. */
  nearest = 0;

  constructor(track: Track, cell = 40) {
    this.cell = cell;
    const b = track.bounds;
    this.minX = b.minX - cell;
    this.minY = b.minY - cell;
    this.nx = Math.ceil((b.maxX - b.minX) / cell) + 3;
    this.ny = Math.ceil((b.maxY - b.minY) / cell) + 3;
    const n = track.path.length;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    const counts = new Int32Array(this.nx * this.ny + 1);
    const keys = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = track.path[i].x;
      this.ys[i] = track.path[i].y;
      keys[i] = this.key(this.xs[i], this.ys[i]);
      counts[keys[i] + 1]++;
    }
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    this.start = counts;
    const fill = counts.slice();
    this.items = new Int32Array(n);
    for (let i = 0; i < n; i++) this.items[fill[keys[i]]++] = i;
  }

  private key(x: number, y: number) {
    return Math.floor((y - this.minY) / this.cell) * this.nx + Math.floor((x - this.minX) / this.cell);
  }

  /** Distance to the nearest sample if it is within `maxR`, else Infinity. */
  query(x: number, y: number, maxR: number): number {
    const c = this.cell, r = Math.ceil(maxR / c);
    const cx = Math.floor((x - this.minX) / c), cy = Math.floor((y - this.minY) / c);
    let best = maxR * maxR, found = -1;
    for (let j = Math.max(0, cy - r); j <= Math.min(this.ny - 1, cy + r); j++) {
      for (let i = Math.max(0, cx - r); i <= Math.min(this.nx - 1, cx + r); i++) {
        const k = j * this.nx + i;
        for (let s = this.start[k]; s < this.start[k + 1]; s++) {
          const q = this.items[s], dx = this.xs[q] - x, dy = this.ys[q] - y, d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            found = q;
          }
        }
      }
    }
    if (found < 0) return Infinity;
    this.nearest = found;
    return Math.sqrt(best);
  }
}

/** What a height-field sample returns: height (m) and vertex colour (linear 0..1). */
export type HeightSample = { h: number; r: number; g: number; b: number };

/**
 * A grid of `cell` metres over a world rectangle (units), each vertex asking `sample(x, y, out)` for its height and colour. Smooth normals,
 * 32-bit indices (the canyon is tens of thousands of vertices).
 */
export function heightfield(d: Disposer, x0: number, y0: number, x1: number, y1: number, cell: number, sample: (x: number, y: number, out: HeightSample) => void): THREE.BufferGeometry {
  const nx = Math.max(2, Math.ceil(((x1 - x0) * K) / cell)), ny = Math.max(2, Math.ceil(((y1 - y0) * K) / cell));
  const vx = nx + 1, vy = ny + 1;
  const pos = new Float32Array(vx * vy * 3), col = new Float32Array(vx * vy * 3);
  const out: HeightSample = { h: 0, r: 1, g: 1, b: 1 };
  for (let j = 0; j < vy; j++) {
    for (let i = 0; i < vx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, y = y0 + ((y1 - y0) * j) / ny, k = (j * vx + i) * 3;
      sample(x, y, out);
      pos[k] = x * K;
      pos[k + 1] = out.h;
      pos[k + 2] = y * K;
      col[k] = out.r;
      col[k + 1] = out.g;
      col[k + 2] = out.b;
    }
  }
  const idx = new Uint32Array(nx * ny * 6);
  let t = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vx + i, b = a + 1, c = a + vx, e = c + 1;
      // Counter-clockwise seen from above (+Y).
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = e;
    }
  }
  const g = d.add(new THREE.BufferGeometry());
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Distance (m) along the lap to each sample, and the lap's length (m). */
export function lapMetres(track: Track): { s: number[]; total: number } {
  const n = track.path.length, s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(track.path[i].x - track.path[i - 1].x, track.path[i].y - track.path[i - 1].y) * K);
  const total = s[n - 1] + Math.hypot(track.path[0].x - track.path[n - 1].x, track.path[0].y - track.path[n - 1].y) * K;
  return { s, total };
}

/**
 * A flat ribbon along the whole lap between the lateral offsets `a` and `b` (world units from the centre line, right of travel = +), at height
 * `y`. The texture runs across it (u 0..1, from `a` to `b`) and along it (v, one repeat every `repeatM` metres, rounded so that the lap closes
 * on a whole number of repeats and the pattern has no seam).
 */
export function ribbon(d: Disposer, track: Track, a: number, b: number, y: number, repeatM: number): THREE.BufferGeometry {
  const n = track.path.length, { s, total } = lapMetres(track);
  const reps = Math.max(1, Math.round(total / repeatM));
  const pos = new Float32Array((n + 1) * 2 * 3), uv = new Float32Array((n + 1) * 2 * 2), nor = new Float32Array((n + 1) * 2 * 3);
  for (let i = 0; i <= n; i++) {
    const p = track.path[i % n], t = track.tangents[i % n], v = ((i === n ? total : s[i]) / total) * reps;
    for (let side = 0; side < 2; side++) {
      const o = side ? b : a, k = i * 2 + side;
      pos[k * 3] = (p.x - t.y * o) * K;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = (p.y + t.x * o) * K;
      nor[k * 3 + 1] = 1;
      uv[k * 2] = side;
      uv[k * 2 + 1] = v;
    }
  }
  const idx = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const L = i * 2, R = L + 1, L2 = L + 2, R2 = L + 3;
    idx.set([L, R, L2, R, R2, L2], i * 6);
  }
  const g = d.add(new THREE.BufferGeometry());
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** A point of a swept profile: lateral offset (world units, right of travel = +) and height (m). */
export type ProfilePoint = [number, number];

/**
 * Sweeps a cross-section along the road from sample `from`, `count` samples long (the whole lap when omitted), one profile per sample
 * (`profile(i, k)`: k = 0..count-1 along the sweep). Use a double-sided material: the profile's winding is the caller's business.
 * Texture: u along the sweep in metres / `repeatM`, v along the profile.
 */
export function sweep(d: Disposer, track: Track, profile: (i: number, k: number) => ProfilePoint[], from = 0, count = track.path.length, repeatM = 8): THREE.BufferGeometry {
  const n = track.path.length, closed = count >= n;
  const cols = closed ? count + 1 : count, first = profile(from, 0), m = first.length;
  const pos = new Float32Array(cols * m * 3), uv = new Float32Array(cols * m * 2);
  let run = 0;
  for (let k = 0; k < cols; k++) {
    const i = (from + k) % n, p = track.path[i], t = track.tangents[i];
    if (k) {
      const q = track.path[(from + k - 1) % n];
      run += Math.hypot(p.x - q.x, p.y - q.y) * K;
    }
    const prof = k === count ? profile(from, 0) : profile(i, k);
    for (let r = 0; r < m; r++) {
      const [o, y] = prof[r], v = (k * m + r) * 3;
      pos[v] = (p.x - t.y * o) * K;
      pos[v + 1] = y;
      pos[v + 2] = (p.y + t.x * o) * K;
      uv[(k * m + r) * 2] = run / repeatM;
      uv[(k * m + r) * 2 + 1] = r / (m - 1);
    }
  }
  const idx = new Uint32Array((cols - 1) * (m - 1) * 6);
  let q = 0;
  for (let k = 0; k < cols - 1; k++) {
    for (let r = 0; r < m - 1; r++) {
      const a = k * m + r, b = a + 1, c = a + m, e = c + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = b; idx[q++] = e; idx[q++] = c;
    }
  }
  const g = d.add(new THREE.BufferGeometry());
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Sample indices of a covered range, in driving order. */
export function coverSamples(track: Track, cover: { start: number; end: number }): { from: number; count: number } {
  const n = track.path.length;
  const len = cover.start <= cover.end ? cover.end - cover.start : n - cover.start + cover.end;
  return { from: cover.start, count: len + 1 };
}
