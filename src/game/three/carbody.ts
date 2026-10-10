import { type Disposer, THREE } from "./core";

// Building blocks for realistic cars: smooth bodies lofted from cross-sections (the way a car is sculpted: width, floor and deck height as
// curves along its length), wheels with tyres, spokes and brake discs. Pure geometry — no GL needed.

export type Key = [number, number];

/** Smooth curve through [x, value] keys (cubic Hermite with Catmull-Rom tangents), flat beyond the first and last key. */
export function spline(keys: readonly Key[], x: number): number {
  const n = keys.length;
  if (x <= keys[0][0]) return keys[0][1];
  if (x >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && x > keys[i + 1][0]) i++;
  const [x0, y0] = keys[i], [x1, y1] = keys[i + 1], h = x1 - x0, t = (x - x0) / h;
  const m0 = i > 0 ? (y1 - keys[i - 1][1]) / (x1 - keys[i - 1][0]) : (y1 - y0) / h;
  const m1 = i < n - 2 ? (keys[i + 2][1] - y0) / (keys[i + 2][0] - x0) : (y1 - y0) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}

export type LoftOpts = {
  /** Extent along the car (x), number of stations along it, points around each section. */
  x0: number; x1: number; stations: number; around: number;
  /** Half width (widest point of a section), bottom and top height as functions of x. */
  hw: (x: number) => number; yb: (x: number) => number; yt: (x: number) => number;
  /** Superellipse exponents of the upper and lower halves (2 = ellipse, higher = boxier). */
  eTop: number; eBot: number;
  /** How much the upper half narrows (0 none .. 0.4 strong): the shoulders and the roof's tumblehome. */
  tumble: number;
  /** Material index of the quad starting at station-x `x`, point `j` of `m`. Default 0. */
  group?: (x: number, j: number, m: number) => number;
  /** Close both ends with a cap (the end sections should already be small). */
  caps?: boolean;
  /**
   * Wheel arches: at `x`, a wheel of arch radius `r` (hub at height `hub`) with its inner face at |z| = `zIn`. Every vertex of the shell that falls
   * inside the arch and outboard of the inner face is lifted to the arch's vault, so the shell has a real round opening the tyre sits in.
   */
  arches?: Arch[];
};

export type Arch = { x: number; r: number; hub: number; zIn: number };

/**
 * Wheel arches: every vertex (x, y, z triplets in `pos`) that falls inside an arch of radius `r` (hub at `hub`) and outboard of the wheel's inner face
 * `zIn` is lifted to the arch's vault, so the shell has a real round opening the tyre sits in.
 */
export function liftArches(pos: number[], arches: Arch[]) {
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], z = Math.abs(pos[i + 2]);
    for (const a of arches) {
      const dx = x - a.x;
      if (Math.abs(dx) >= a.r) continue;
      // Full effect outboard of the wheel's inner face, fading to nothing 0.12 m inboard of it.
      const k = Math.min(1, Math.max(0, (z - (a.zIn - 0.12)) / 0.12));
      if (k <= 0) continue;
      const vault = a.hub + Math.sqrt(a.r * a.r - dx * dx);
      if (pos[i + 1] < vault) pos[i + 1] += (vault - pos[i + 1]) * k;
    }
  }
}

const sp = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), 2 / e);

/**
 * A closed tube of superelliptic sections along x. Smooth normals (the ring wraps), optional end caps, material groups by `group`.
 * Point j of a section is at angle 2πj/m, starting at +z (the right side) and going up over the top.
 */
export function loft(d: Disposer, o: LoftOpts): THREE.BufferGeometry {
  const { stations: n, around: m } = o;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = o.x0 + ((o.x1 - o.x0) * i) / (n - 1), hw = o.hw(x), yb = o.yb(x), yt = o.yt(x), yc = (yb + yt) / 2, b = Math.max(0.001, (yt - yb) / 2);
    for (let j = 0; j < m; j++) {
      const th = (j / m) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), e = s > 0 ? o.eTop : o.eBot;
      const py = sp(s, e), px = sp(c, e), squeeze = 1 - o.tumble * Math.pow(Math.max(0, py), 2);
      pos.push(x, yc + b * py, hw * px * squeeze);
    }
  }
  if (o.arches) liftArches(pos, o.arches);
  const nCenter0 = pos.length / 3;
  if (o.caps) {
    for (const x of [o.x0, o.x1]) pos.push(x, (o.yb(x) + o.yt(x)) / 2, 0);
  }
  const buckets = new Map<number, number[]>();
  const push = (g: number, a: number, b: number, c: number) => {
    let arr = buckets.get(g);
    if (!arr) buckets.set(g, (arr = []));
    arr.push(a, b, c);
  };
  for (let i = 0; i < n - 1; i++) {
    const xm = o.x0 + ((o.x1 - o.x0) * (i + 0.5)) / (n - 1);
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m, a = i * m + j, b = (i + 1) * m + j, c = i * m + j2, e = (i + 1) * m + j2, g = o.group ? o.group(xm, j, m) : 0;
      push(g, a, b, c);
      push(g, b, e, c);
    }
  }
  if (o.caps) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      push(0, nCenter0, j, j2); // rear cap: faces -x
      push(0, nCenter0 + 1, (n - 1) * m + j2, (n - 1) * m + j); // front cap: faces +x
    }
  }
  const idx: number[] = [], g = d.add(new THREE.BufferGeometry());
  let start = 0;
  for (const [mat, arr] of [...buckets.entries()].sort((p, q) => p[0] - q[0])) {
    g.addGroup(start, arr.length, mat);
    idx.push(...arr);
    start += arr.length;
  }
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------- sections with straight sides ----------

/** One cross-section, right half: points (z, y) from the bottom centre (z = 0) out and up round to the top centre (z = 0). */
export type Ring = [number, number][];

export type PolyLoftOpts = {
  /** Stations along the car, ascending; `ring(x)` gives the section there (always the same number of points). */
  xs: number[];
  ring: (x: number) => Ring;
  /** Material index of the strip between points k and k + 1 of the half ring (mirrored on the left) at station-x `x`. Default 0; negative = no faces (a hole). */
  group?: (x: number, k: number) => number;
  /** Edges sharper than this angle (radians) stay sharp; flatter ones are smoothed. Default 0.7 (40°). */
  crease?: number;
  /** Close both ends with a flat cap. */
  caps?: boolean;
  arches?: Arch[];
};

/**
 * A faceted body: straight strips between the points of every section, creased normals (the shoulder, the sill and the hood's facets stay crisp
 * while the gently curved parts read smooth). The way a Lamborghini is drawn: planes and edges, not pillows.
 */
export function polyLoft(d: Disposer, o: PolyLoftOpts): THREE.BufferGeometry {
  const nS = o.xs.length, n = o.ring(o.xs[0]).length, m = 2 * n - 2;
  const pos: number[] = [];
  for (const x of o.xs) {
    const r = o.ring(x);
    for (let j = 0; j < m; j++) {
      const [z, y] = j < n ? r[j] : r[m - j];
      pos.push(x, y, j < n ? z : -z);
    }
  }
  if (o.arches) liftArches(pos, o.arches);
  const centre = pos.length / 3;
  if (o.caps) {
    for (const i of [0, nS - 1]) {
      let cy = 0;
      for (let j = 0; j < m; j++) cy += pos[(i * m + j) * 3 + 1];
      pos.push(o.xs[i], cy / m, 0);
    }
  }
  const buckets = new Map<number, number[]>();
  const push = (g: number, a: number, b: number, c: number) => {
    if (g < 0) return;
    let arr = buckets.get(g);
    if (!arr) buckets.set(g, (arr = []));
    arr.push(a, b, c);
  };
  for (let i = 0; i < nS - 1; i++) {
    const xm = (o.xs[i] + o.xs[i + 1]) / 2;
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m, a = i * m + j, b = (i + 1) * m + j, c = i * m + j2, e = (i + 1) * m + j2;
      const k = j < n - 1 ? j : m - 1 - j, g = o.group ? o.group(xm, k) : 0;
      push(g, a, b, c);
      push(g, b, e, c);
    }
  }
  if (o.caps) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      push(0, centre, j, j2); // rear cap: faces -x
      push(0, centre + 1, (nS - 1) * m + j2, (nS - 1) * m + j); // front cap: faces +x
    }
  }
  // Unwelded triangles, in material order, each corner with a normal averaged over the neighbouring faces that are not sharply bent away.
  const tri: number[] = [], groups: [number, number, number][] = [];
  let start = 0;
  for (const [mat, arr] of [...buckets.entries()].sort((p, q) => p[0] - q[0])) {
    groups.push([start, arr.length, mat]);
    for (const v of arr) tri.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    start += arr.length;
  }
  const nT = tri.length / 9, fn = new Float32Array(nT * 3), key = (k: number) => `${Math.round(tri[k] * 1e4)},${Math.round(tri[k + 1] * 1e4)},${Math.round(tri[k + 2] * 1e4)}`;
  const at = new Map<string, number[]>();
  for (let t = 0; t < nT; t++) {
    const b = t * 9, ux = tri[b + 3] - tri[b], uy = tri[b + 4] - tri[b + 1], uz = tri[b + 5] - tri[b + 2], vx = tri[b + 6] - tri[b], vy = tri[b + 7] - tri[b + 1], vz = tri[b + 8] - tri[b + 2];
    // The cross product's length is twice the face's area: kept as the weight.
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
    for (let c = 0; c < 3; c++) {
      const k = key(b + c * 3);
      const l = at.get(k);
      if (l) l.push(t);
      else at.set(k, [t]);
    }
  }
  const cosCrease = Math.cos(o.crease ?? 0.7), nrm = new Float32Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2], fl = Math.hypot(fx, fy, fz);
    for (let c = 0; c < 3; c++) {
      let sx = 0, sy = 0, sz = 0;
      if (fl > 1e-12) {
        for (const u of at.get(key(t * 9 + c * 3)) as number[]) {
          const gx = fn[u * 3], gy = fn[u * 3 + 1], gz = fn[u * 3 + 2], gl = Math.hypot(gx, gy, gz);
          if (gl < 1e-12 || (fx * gx + fy * gy + fz * gz) / (fl * gl) < cosCrease) continue;
          sx += gx;
          sy += gy;
          sz += gz;
        }
      }
      const sl = Math.hypot(sx, sy, sz) || 1;
      nrm[t * 9 + c * 3] = sx / sl;
      nrm[t * 9 + c * 3 + 1] = sy / sl;
      nrm[t * 9 + c * 3 + 2] = sz / sl;
    }
  }
  const g = d.add(new THREE.BufferGeometry());
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tri), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  for (const [s0, len, mat] of groups) g.addGroup(s0, len, mat);
  g.computeBoundingSphere();
  return g;
}

export type WheelKit = { tyre: THREE.Material; rim: THREE.Material; dark: THREE.Material; disc: THREE.Material; caliper: THREE.Material };

/**
 * A wheel with its axle along z, outer face toward +z: a tyre with rounded shoulders, a rim with `spokes` spokes over a dark dish, the brake
 * disc and caliper behind. The group's origin is the hub.
 */
export function makeWheel(d: Disposer, k: WheelKit, r: number, w: number, spokes: number, style?: "y"): THREE.Group {
  const g = new THREE.Group();
  const tyreProfile = [[0.66, -0.5], [0.8, -0.5], [0.93, -0.46], [0.985, -0.36], [1, -0.25], [1, 0.25], [0.985, 0.36], [0.93, 0.46], [0.8, 0.5], [0.66, 0.5]].map(([a, b]) => new THREE.Vector2(a * r, b * w));
  const tyreGeo = d.add(new THREE.LatheGeometry(tyreProfile, 32));
  tyreGeo.rotateX(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, k.tyre);
  tyre.castShadow = true;
  g.add(tyre);
  // The rim's barrel and a dark dish behind the spokes.
  const barrel = d.add(new THREE.LatheGeometry([[0.62, 0.3], [0.68, 0.34], [0.7, 0.2], [0.7, -0.3]].map(([a, b]) => new THREE.Vector2(a * r, b * w)), 28));
  barrel.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(barrel, k.rim));
  const dishGeo = d.add(new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.02, 24));
  dishGeo.rotateX(Math.PI / 2);
  const dish = new THREE.Mesh(dishGeo, k.dark);
  dish.position.z = w * 0.22;
  g.add(dish);
  if (style === "y") {
    // Y spokes: one stem from the hub, forking in two toward the rim.
    const stemGeo = d.add(new THREE.BoxGeometry(r * 0.3, r * 0.15, 0.04)), armGeo = d.add(new THREE.BoxGeometry(r * 0.3, r * 0.085, 0.04));
    const fork = (Math.PI / spokes) * 0.52;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2, stem = new THREE.Mesh(stemGeo, k.rim);
      stem.position.set(Math.cos(a) * r * 0.27, Math.sin(a) * r * 0.27, w * 0.3);
      stem.rotation.z = a;
      g.add(stem);
      for (const f of [-1, 1]) {
        const aa = a + f * fork * 0.5, arm = new THREE.Mesh(armGeo, k.rim), rad = r * 0.5;
        arm.position.set(Math.cos(aa) * rad, Math.sin(aa) * rad, w * 0.3);
        arm.rotation.z = a + f * fork * 0.9;
        g.add(arm);
      }
    }
  } else {
    const spokeGeo = d.add(new THREE.BoxGeometry(r * 0.56, r * 0.12, 0.035));
    for (let i = 0; i < spokes; i++) {
      const sp = new THREE.Mesh(spokeGeo, k.rim), a = (i / spokes) * Math.PI * 2;
      sp.position.set(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, w * 0.3);
      sp.rotation.z = a;
      g.add(sp);
    }
  }
  const hubGeo = d.add(new THREE.CylinderGeometry(r * 0.13, r * 0.13, 0.05, 14));
  hubGeo.rotateX(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, k.rim);
  hub.position.z = w * 0.32;
  g.add(hub);
  // Brake disc behind the spokes and a caliper over its top rear.
  const discGeo = d.add(new THREE.CylinderGeometry(r * 0.56, r * 0.56, 0.03, 24));
  discGeo.rotateX(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, k.disc);
  disc.position.z = w * 0.1;
  g.add(disc);
  const cal = new THREE.Mesh(d.add(new THREE.BoxGeometry(r * 0.3, r * 0.26, 0.09)), k.caliper);
  cal.position.set(-r * 0.3, r * 0.42, w * 0.1);
  cal.rotation.z = 0.5;
  g.add(cal);
  return g;
}
