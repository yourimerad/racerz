import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { THREE, hash2, mat4, merge, part } from "./core";

// The scenery models, each merged into ONE vertex-coloured geometry (so a kind is one instanced draw call), built at real size in metres with
// the origin on the ground. Placements scale them to the radius the mode reserved for the prop.

type Col = string | number;
const box = (w: number, h: number, dp: number, x: number, y: number, z: number, c: Col, ry = 0) => part(new THREE.BoxGeometry(w, h, dp), c, mat4(x, y + h / 2, z, 0, ry));
const cyl = (rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, c: Col, rx = 0, rz = 0) =>
  part(new THREE.CylinderGeometry(rt, rb, h, seg), c, mat4(x, y + h / 2, z, rx, 0, rz));
const sph = (r: number, x: number, y: number, z: number, c: Col, sx = 1, sy = 1, sz = 1, detail = 1) => part(new THREE.IcosahedronGeometry(r, detail), c, mat4(x, y, z, 0, 0, 0, sx, sy, sz));

/** A lumpy rock: an icosphere whose vertices are pushed in and out. Rest on the ground, `r` metres across. */
export function rockModel(seed: number, base: Col, light: Col, flat = 0.7): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.72 + hash2(Math.round(x * 50), Math.round(y * 50 + z * 31), seed) * 0.5;
    p.setXYZ(i, x * k, y * k * flat, z * k);
  }
  g.computeVertexNormals();
  const c = new THREE.Color(base), l = new THREE.Color(light), n = p.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, (p.getY(i) + 0.4) * 0.9 + (hash2(i, seed) - 0.5) * 0.25));
    const m = c.clone().lerp(l, t);
    arr[i * 3] = m.r; arr[i * 3 + 1] = m.g; arr[i * 3 + 2] = m.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  g.translate(0, 0.32 * flat, 0);
  g.computeVertexNormals();
  return g;
}

// ---------- trees ----------

const c3 = (hex: string) => new THREE.Color(hex);

/**
 * A lump of foliage: an icosphere with its vertices pushed in and out (a leafy, irregular mass), smooth-shaded, coloured dark underneath and
 * light on top with a little noise so that it reads as leaves in light and shade. `s` = radii along x, y, z.
 */
function foliage(seed: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, dark: THREE.Color, light: THREE.Color, detail = 1): THREE.BufferGeometry {
  const base = mergeVertices(new THREE.IcosahedronGeometry(1, detail));
  const p = base.attributes.position, cols = new Float32Array(p.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const k = 0.84 + hash2(Math.round(ux * 40) + seed, Math.round(uy * 40 + uz * 29), seed * 3) * 0.32;
    const t = Math.max(0, Math.min(1, uy * 0.5 + 0.5 + (hash2(Math.round(ux * 17), Math.round(uz * 17 + uy * 9), seed) - 0.5) * 0.3));
    tmp.copy(dark).lerp(light, t * t * (3 - 2 * t));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
    p.setXYZ(i, x + ux * k * sx, y + uy * k * sy, z + uz * k * sz);
  }
  base.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  base.computeVertexNormals();
  const out = base.toNonIndexed();
  base.dispose();
  out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}

/** A limb between two points (a branch or a trunk): tapered, bark-coloured from dark at the foot to lighter up, with streaks, smooth. */
function limb(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, seed: number, foot = c3("#3b2a1c"), top = c3("#6a4c30"), seg = 8): THREE.BufferGeometry {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 3, false);
  const p = g.attributes.position, cols = new Float32Array(p.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const u = p.getY(i) / len + 0.5, ang = Math.atan2(p.getZ(i), p.getX(i));
    const streak = hash2(Math.round(ang * 4), seed, 5) * 0.4 + hash2(Math.round(ang * 9), Math.round(u * 6), seed) * 0.25;
    tmp.copy(foot).lerp(top, Math.max(0, Math.min(1, u * 0.7 + streak - 0.15)));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  // Orient the cylinder (axis +Y) from a to b.
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1)));
  const out = g.toNonIndexed();
  g.dispose();
  out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}

/** The root flare: a wide, short cone where the trunk meets the ground. */
function flare(r: number, h: number, seed: number): THREE.BufferGeometry {
  return limb(0, 0, 0, 0, h, 0, r * 1.9, r * 1.05, seed, c3("#2f2217"), c3("#4a3624"), 10);
}

/**
 * Broadleaf trees, three silhouettes (the variant): 0 an oak (a thick trunk, a few branches, a broad crown of leafy masses), 1 a poplar (a
 * tall narrow crown on a visible trunk), 2 a forest tree (a tall bare straight trunk and a crown high up: the trunks you see along a forest
 * road). Crown radius about 2.2 m for the oak, 7–11 m tall; origin on the ground. Smooth-shaded, vertex-coloured.
 */
export function treeModel(variant: 0 | 1 | 2 = 0, detail = 1): THREE.BufferGeometry {
  const dk = [c3("#244f22"), c3("#2a5a2a"), c3("#22521f")], lt = [c3("#7fbd4f"), c3("#8ec65a"), c3("#74b24a")];
  const mid = c3("#3f7a35");
  const parts: THREE.BufferGeometry[] = [];
  if (variant === 0) {
    parts.push(flare(0.42, 0.9, 1), limb(0, 0.5, 0, 0.1, 3.7, 0, 0.5, 0.34, 2));
    parts.push(limb(0.05, 3.2, 0, 1.3, 4.7, 0.5, 0.2, 0.1, 3), limb(0.05, 3.4, 0, -1.2, 4.6, -0.4, 0.2, 0.1, 4), limb(0.05, 3.6, 0, 0.3, 5.0, -1.2, 0.18, 0.09, 5));
    const clusters: [number, number, number, number, number][] = [[0.1, 5.7, 0, 2.3, 1.9], [1.5, 5.1, 0.6, 1.6, 1.4], [-1.4, 5.2, -0.5, 1.7, 1.4], [0.3, 6.9, -0.5, 1.5, 1.3], [-0.5, 4.7, 1.4, 1.4, 1.1], [1.0, 6.2, 1.1, 1.3, 1.1], [0.2, 4.9, -1.6, 1.4, 1.1]];
    clusters.forEach(([x, y, z, r, rh], i) => parts.push(foliage(i + 1, x, y, z, r, rh, r, dk[0], i % 2 ? mid.clone().lerp(lt[0], 0.5) : lt[0], detail)));
  } else if (variant === 1) {
    parts.push(flare(0.3, 0.7, 6), limb(0, 0.4, 0, 0.05, 4.6, 0, 0.3, 0.2, 7));
    const heights = [4.4, 5.8, 7.2, 8.6, 9.8];
    heights.forEach((y, i) => {
      const r = [1.35, 1.5, 1.4, 1.1, 0.7][i];
      parts.push(foliage(20 + i, (i % 2 ? 0.1 : -0.1), y, (i % 2 ? -0.1 : 0.1), r, 1.5, r, dk[1], lt[1], detail));
    });
  } else {
    parts.push(flare(0.34, 1.0, 11), limb(0, 0.6, 0, 0.1, 8.2, 0, 0.36, 0.2, 12));
    for (const [bx, by, bz] of [[1.1, 9.0, 0.4], [-1.0, 9.2, -0.5], [0.2, 9.4, 1.1]] as const) parts.push(limb(0.1, 7.6, 0, bx, by, bz, 0.14, 0.08, 13 + Math.round(bx * 7)));
    const clusters: [number, number, number, number, number][] = [[0.1, 9.6, 0, 2.0, 1.5], [1.3, 9.1, 0.4, 1.4, 1.1], [-1.2, 9.3, -0.5, 1.5, 1.2], [0.2, 10.8, -0.2, 1.2, 1.0], [0.1, 8.7, 1.2, 1.2, 0.9]];
    clusters.forEach(([x, y, z, r, rh], i) => parts.push(foliage(40 + i, x, y, z, r, rh, r, dk[2], lt[2], detail)));
  }
  return merge(parts, true);
}

/** A mass of leaves for the roofs of the forest road: three overlapping lumps, flattened, unit radius, lighter than a tree's so the underside is not black. */
export function leafMass(): THREE.BufferGeometry {
  const dark = c3("#3f7a35"), light = c3("#86c456");
  return merge([foliage(60, 0, 0, 0, 1, 0.62, 1, dark, light, 1), foliage(61, -0.45, 0.22, 0.25, 0.7, 0.5, 0.7, dark, light, 1), foliage(62, 0.5, 0.18, -0.3, 0.66, 0.46, 0.66, dark, light, 1)], true);
}

/**
 * A fir: a visible trunk, six tiers of drooping skirts with ragged edges, dark green below and snow settled on every upward-facing branch.
 * 2.3 m radius at the base, 11 m tall, origin on the ground. Smooth-shaded, vertex-coloured.
 */
export function firModel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [flare(0.3, 0.8, 21), limb(0, 0.4, 0, 0, 2.2, 0, 0.32, 0.24, 22)];
  const dark = c3("#17402b"), mid = c3("#2a6a45"), snow = c3("#f6fbff"), tmp = new THREE.Color();
  for (let i = 0; i < 6; i++) {
    const r = 2.35 - i * 0.34, h = 2.3, y = 1.3 + i * 1.55;
    const cone = mergeVertices(new THREE.ConeGeometry(r, h, 14, 2, true));
    const p = cone.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), yy = p.getY(k), z = p.getZ(k), rim = yy < -h * 0.3 ? 1 : 0;
      // Ragged, drooping rim: the lowest ring is pushed out and down by a hash of its angle.
      const j = rim ? 0.82 + hash2(Math.round(Math.atan2(z, x) * 5), i, 31) * 0.4 : 1;
      p.setXYZ(k, x * j, yy - rim * hash2(Math.round(x * 9), Math.round(z * 9), i) * 0.25, z * j);
    }
    cone.computeVertexNormals();
    const n = cone.attributes.normal, cols = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const t = (p.getY(k) + h / 2) / h; // 0 at the skirt, 1 at the tip
      tmp.copy(dark).lerp(mid, Math.min(1, t * 0.9 + hash2(k, i, 9) * 0.15));
      tmp.lerp(snow, Math.max(0, Math.min(1, (n.getY(k) - 0.15) * 1.6)) * (0.35 + 0.55 * t));
      cols[k * 3] = tmp.r;
      cols[k * 3 + 1] = tmp.g;
      cols[k * 3 + 2] = tmp.b;
    }
    cone.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    cone.translate(0, y + h / 2, 0);
    const out = cone.toNonIndexed();
    cone.dispose();
    out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
    parts.push(out);
  }
  return merge(parts, true);
}

/** A cactus (saguaro): 4.5 m tall, two arms. */
export function cactusModel(): THREE.BufferGeometry {
  const g = "#4a6a2e", l = "#6f9446";
  return merge([
    cyl(0.42, 0.5, 4.2, 8, 0, 0, 0, g), sph(0.42, 0, 4.2, 0, l, 1, 0.9, 1, 0),
    cyl(0.28, 0.3, 1.4, 7, 0.95, 1.3, 0, g, 0, Math.PI / 2), cyl(0.28, 0.3, 1.8, 7, 1.62, 1.3, 0, g), sph(0.28, 1.62, 3.1, 0, l, 1, 0.9, 1, 0),
    cyl(0.25, 0.28, 1.2, 7, -0.85, 2.1, 0, g, 0, Math.PI / 2), cyl(0.25, 0.28, 1.4, 7, -1.42, 2.1, 0, g), sph(0.25, -1.42, 3.5, 0, l, 1, 0.9, 1, 0),
  ]);
}

export function igloo(): THREE.BufferGeometry {
  const body = part(new THREE.SphereGeometry(4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), "#f4fbff");
  return merge([body, part(new THREE.CylinderGeometry(1.2, 1.2, 2.2, 10, 1, false, -Math.PI / 2, Math.PI), "#dcebf5", mat4(0, 1.1, 4.4, 0, 0, 0)), part(new THREE.SphereGeometry(1.25, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), "#f4fbff", mat4(0, 2.2, 4.4)), box(1.6, 1.7, 0.4, 0, 0, 5.6, "#2a3b52")]);
}

export function iceBlock(): THREE.BufferGeometry {
  return merge([
    part(new THREE.OctahedronGeometry(1.5, 0), "#bfe3f6", mat4(0, 1.2, 0, 0.2, 0.5, 0.1, 1, 1.35, 0.9)),
    part(new THREE.OctahedronGeometry(1, 0), "#e6f6ff", mat4(1.6, 0.7, 0.6, 0.1, 1.2, 0.3, 1, 1.1, 1)),
    part(new THREE.OctahedronGeometry(0.8, 0), "#a9d4ec", mat4(-1.4, 0.55, -0.7, 0.3, 0.2, 0.4)),
  ]);
}

export function penguin(): THREE.BufferGeometry {
  return merge([
    sph(0.5, 0, 0.75, 0, "#1a2230", 0.85, 1.35, 0.8, 1), sph(0.36, 0, 0.7, 0.12, "#f4f6f8", 0.8, 1.2, 0.5, 1), sph(0.26, 0, 1.45, 0, "#1a2230", 1, 1, 1, 1),
    part(new THREE.ConeGeometry(0.09, 0.25, 4), "#f0a020", mat4(0, 1.42, 0.3, Math.PI / 2, 0, 0)),
  ]);
}

/** A round bale lying on its side (~1 m radius). */
export function roundBale(): THREE.BufferGeometry {
  return merge([part(new THREE.CylinderGeometry(1, 1, 1.3, 14), "#e3c35a", mat4(0, 1, 0, Math.PI / 2, 0, 0)), part(new THREE.TorusGeometry(1, 0.03, 4, 14), "#b8923a", mat4(0, 1, 0.3)), part(new THREE.TorusGeometry(1, 0.03, 4, 14), "#b8923a", mat4(0, 1, -0.3))]);
}

/** A square straw bale, long side along X: 2.3 × 1.1 × 1.2 m, twine round it. */
export function strawBale(): THREE.BufferGeometry {
  return merge([
    box(2.3, 1.1, 1.2, 0, 0, 0, "#e3c35a"), box(2.32, 0.08, 1.22, 0, 0.5, 0, "#f1dc8a"),
    box(0.06, 1.14, 1.24, -0.6, 0, 0, "#8a5a2b"), box(0.06, 1.14, 1.24, 0.6, 0, 0, "#8a5a2b"),
  ]);
}

export function hedge(): THREE.BufferGeometry {
  return merge([sph(1, 0, 0.6, 0, "#2f5d27", 1, 0.8, 1, 1), sph(0.6, -0.3, 1.0, -0.3, "#467d36", 1, 0.8, 1, 1)]);
}

/** A grandstand, front toward +Z: stepped rows, coloured seats, a roof on posts. 13.8 × 7.5 m. */
export function grandstand(): THREE.BufferGeometry {
  const w = 13.8, parts = [];
  for (let i = 0; i < 5; i++) {
    parts.push(box(w, 0.9 + i * 0.9, 1.3, 0, 0, 3.0 - i * 1.4, i % 2 ? "#1d3557" : "#274472"));
    for (let k = 0; k < 14; k++) parts.push(box(0.5, 0.35, 0.35, -w / 2 + 0.7 + k * (w / 14), 0.9 + i * 0.9, 3.0 - i * 1.4 + 0.2, (k + i) % 3 === 0 ? "#e63946" : (k + i) % 3 === 1 ? "#f1faee" : "#457b9d"));
  }
  parts.push(box(w + 1.2, 0.4, 6.6, 0, 6.6, -0.6, "#0d1b2a"));
  for (const x of [-w / 2 + 0.4, w / 2 - 0.4]) parts.push(box(0.35, 6.6, 0.35, x, 0, 3.3, "#cfd6de"), box(0.35, 6.6, 0.35, x, 0, -4.2, "#cfd6de"));
  return merge(parts);
}

/** The pit building: white, coloured garage doors toward +Z, a small tower. 9.6 × 4.8 m. */
export function pitBuilding(): THREE.BufferGeometry {
  const parts = [box(9.6, 3.6, 4.8, 0, 0, 0, "#e9ecef"), box(9.8, 0.3, 5.0, 0, 3.6, 0, "#c3c8cf"), box(1.2, 2.2, 1.2, 3.6, 3.9, -1, "#1d3557")];
  for (let i = 0; i < 4; i++) parts.push(box(1.9, 2.4, 0.15, -3.6 + i * 2.4, 0, 2.45, i % 2 ? "#d62828" : "#1d3557"));
  return merge(parts);
}

export function tireStack(): THREE.BufferGeometry {
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push(part(new THREE.TorusGeometry(0.65 - i * 0.06, 0.28, 8, 14), "#1a1a1a", mat4(0, 0.3 + i * 0.5, 0, Math.PI / 2, 0, 0)));
  return merge(parts);
}

/** A sponsor flag on a pole, board toward +Z. */
export function banner(): THREE.BufferGeometry {
  const parts = [cyl(0.08, 0.1, 5, 6, 0, 0, 0, "#6b4f30"), box(4.2, 1.2, 0.12, 0, 3.4, 0.1, "#ffd166"), box(4.3, 1.3, 0.1, 0, 3.35, 0.0, "#2b2b2b")];
  for (let i = 0; i < 4; i++) parts.push(cyl(0.22, 0.22, 0.05, 10, -1.5 + i, 3.7, 0.18, "#1d3557", Math.PI / 2));
  return merge(parts);
}

/** The village marquee: red and white wedges, a gold finial. 8 m radius. */
export function marquee(): THREE.BufferGeometry {
  const parts = [], n = 10, R = 8, wall = 3, top = 5.2;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, c = i % 2 ? "#e63946" : "#f1faee";
    const p = (a: number, r: number, y: number): number[] => [Math.cos(a) * r, y, Math.sin(a) * r];
    const tri = (vs: number[][]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vs.flat()), 3));
      g.computeVertexNormals();
      return part(g, c);
    };
    parts.push(tri([p(a0, R, 0), p(a0, R, wall), p(a1, R, wall)]), tri([p(a0, R, 0), p(a1, R, wall), p(a1, R, 0)]), tri([p(a0, R * 1.04, wall), [0, wall + top, 0], p(a1, R * 1.04, wall)]));
  }
  parts.push(sph(0.35, 0, wall + top + 0.2, 0, "#ffd166"), cyl(0.12, 0.12, 1.2, 6, 0, wall + top - 0.2, 0, "#8a6a45"));
  return merge(parts);
}

/** A rustic stand: three wooden tiers and a roof, front toward +Z. 9.2 × 4.1 m. */
export function villageStand(): THREE.BufferGeometry {
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push(box(9.2, 0.9 + i * 0.8, 1.2, 0, 0, 1.1 - i * 1.2, i % 2 ? "#8a6a45" : "#a4824f"));
  parts.push(box(9.8, 0.3, 4.4, 0, 4.2, -0.4, "#6b4226"));
  for (const x of [-4.4, 4.4]) parts.push(box(0.3, 4.2, 0.3, x, 0, 1.9, "#6b4226"), box(0.3, 4.2, 0.3, x, 0, -2.4, "#6b4226"));
  return merge(parts);
}

/** A farm: red barn, white house, silo. Fits in ~28 m. */
export function farm(): THREE.BufferGeometry {
  const gable = (w: number, d: number, h: number, x: number, y: number, z: number, c: Col) => {
    // Triangular prism: ridge along X.
    const hw = w / 2, hd = d / 2;
    const v = [-hw, y, -hd, hw, y, -hd, 0, y + h, -hd, -hw, y, hd, hw, y, hd, 0, y + h, hd];
    const idx = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return part(g, c, mat4(x, 0, z));
  };
  return merge([
    box(10, 5, 7, -6, 0, 0, "#b3382c"), gable(10.6, 7.6, 3, -6, 5, 0, "#5a2a22"), box(2.6, 3.4, 0.2, -6, 0, 3.5, "#f1f1f1"),
    box(6.5, 3.4, 5.5, 6.5, 0, 3, "#f1ece0"), gable(7.2, 6.1, 2.4, 6.5, 3.4, 3, "#8a4a2f"),
    cyl(1.6, 1.6, 8, 12, 0.5, 0, -7, "#c9ced6"), sph(1.6, 0.5, 8, -7, "#8d949e", 1, 0.8, 1, 1),
    box(10, 0.1, 10, 0, 0, 0, "#8d7a55"),
  ]);
}

export function cow(): THREE.BufferGeometry {
  const parts = [box(2.2, 0.95, 0.9, 0, 0.7, 0, "#f4f4f2"), box(0.7, 0.6, 0.6, 1.35, 1.2, 0, "#f4f4f2"), box(0.55, 0.28, 0.5, 1.62, 1.1, 0, "#e8a9a0"), box(0.8, 0.5, 0.35, 0.3, 1.15, 0.46, "#222"), box(0.7, 0.45, 0.35, -0.6, 0.9, -0.46, "#222")];
  for (const x of [-0.8, 0.8]) for (const z of [-0.3, 0.3]) parts.push(box(0.2, 0.7, 0.2, x, 0, z, "#e9e9e6"));
  return merge(parts);
}
