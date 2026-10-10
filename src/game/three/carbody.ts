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
  arches?: { x: number; r: number; hub: number; zIn: number }[];
};

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
  if (o.arches) {
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = Math.abs(pos[i + 2]);
      for (const a of o.arches) {
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

export type WheelKit = { tyre: THREE.Material; rim: THREE.Material; dark: THREE.Material; disc: THREE.Material; caliper: THREE.Material };

/**
 * A wheel with its axle along z, outer face toward +z: a tyre with rounded shoulders, a rim with `spokes` spokes over a dark dish, the brake
 * disc and caliper behind. The group's origin is the hub.
 */
export function makeWheel(d: Disposer, k: WheelKit, r: number, w: number, spokes: number): THREE.Group {
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
  const spokeGeo = d.add(new THREE.BoxGeometry(r * 0.56, r * 0.12, 0.035));
  for (let i = 0; i < spokes; i++) {
    const sp = new THREE.Mesh(spokeGeo, k.rim), a = (i / spokes) * Math.PI * 2;
    sp.position.set(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, w * 0.3);
    sp.rotation.z = a;
    g.add(sp);
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
