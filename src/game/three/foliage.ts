import { type Disposer, THREE, hash2, smoothstep } from "./core";
import { surface } from "./pbr";

// Realistic broadleaf trees and grass: leaves are small alpha-tested sprites in cards packed into crowns (not lumps of solid colour), lit by
// the normals of the crown they belong to (a round, soft shading instead of facets), over trunks with a bark normal map; grass is tufts of
// blades. The textures are drawn into typed arrays (no canvas: Node builds them too). A small wind sways the crowns and the blades.

// ---------- textures ----------

/** A leafy sprite: ~140 small leaves (ellipses with a pale vein, dark edge, varied green) on a transparent ground; the empty texels keep a leaf green so mipmaps do not darken the edge. */
export function leafTexture(d: Disposer, dry = false): THREE.DataTexture {
  const n = 256, data = new Uint8Array(new ArrayBuffer(n * n * 4));
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = 58;
    data[i * 4 + 1] = 104;
    data[i * 4 + 2] = 38;
    data[i * 4 + 3] = 0;
  }
  const deep = dry ? [92, 86, 46] : [34, 84, 30], fresh = dry ? [186, 172, 98] : [128, 176, 52];
  for (let L = 0; L < 150; L++) {
    const cx = hash2(L, 1, 11) * n, cy = hash2(L, 2, 11) * n, ang = hash2(L, 3, 11) * Math.PI * 2, a = 9 + 12 * hash2(L, 4, 11), b = a * 0.44;
    const shade = 0.62 + 0.5 * hash2(L, 5, 11), mixc = hash2(L, 6, 11) * hash2(L, 7, 11), ca = Math.cos(ang), sa = Math.sin(ang);
    const r = Math.ceil(a) + 1;
    for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) {
      for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca, t = Math.abs(u / a);
        if (t > 1) continue;
        const half = b * Math.pow(1 - Math.pow(t, 1.8), 0.8), av = Math.abs(v);
        if (av > half) continue;
        const px = ((x % n) + n) % n, py = ((y % n) + n) % n, q = (py * n + px) * 4;
        const vein = av < 0.07 * b ? 1.28 : 1, edge = 1 - 0.3 * Math.pow(av / (half || 1), 3);
        for (let c = 0; c < 3; c++) data[q + c] = Math.min(255, Math.round((deep[c] + (fresh[c] - deep[c]) * mixc) * shade * vein * edge));
        data[q + 3] = 255;
      }
    }
  }
  const t = d.add(new THREE.DataTexture(data, n, n, THREE.RGBAFormat));
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Blades of grass on a transparent ground: tapered, leaning, dark at the root and yellow-green at the tip (vertical axis = up the blade). */
export function grassTexture(d: Disposer): THREE.DataTexture {
  const w = 128, h = 128, data = new Uint8Array(new ArrayBuffer(w * h * 4));
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 70;
    data[i * 4 + 1] = 110;
    data[i * 4 + 2] = 40;
    data[i * 4 + 3] = 0;
  }
  for (let B = 0; B < 46; B++) {
    const x0 = 6 + hash2(B, 1, 21) * (w - 12), lean = (hash2(B, 2, 21) - 0.5) * 30, hh = h * (0.55 + 0.45 * hash2(B, 3, 21)), width = 2.6 + 2.4 * hash2(B, 4, 21), shade = 0.7 + 0.45 * hash2(B, 5, 21);
    for (let y = 0; y < hh; y++) {
      const t = y / hh, cx = x0 + lean * t * t, half = (width * (1 - t * t * 0.95)) / 2;
      const rgb = [58 + 90 * t, 96 + 78 * t, 34 + 12 * t];
      for (let x = Math.floor(cx - half - 1); x <= Math.ceil(cx + half + 1); x++) {
        if (x < 0 || x >= w || Math.abs(x + 0.5 - cx) > half) continue;
        const q = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) data[q + c] = Math.min(255, Math.round(rgb[c] * shade));
        data[q + 3] = 255;
      }
    }
  }
  const t = d.add(new THREE.DataTexture(data, w, h, THREE.RGBAFormat));
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------- materials ----------

/** The wind: shared clock the crowns and blades read (set it from the scenery's `update`). */
export type Wind = { time: { value: number } };

/** Foliage: alpha-tested, both faces lit by the geometry's normals (no flip on the back), swaying with the wind by height above `swayFrom` metres. */
export function leafMaterial(d: Disposer, map: THREE.Texture, wind: Wind, o: { swayFrom?: number; amp?: number; alphaTest?: number; glow?: number } = {}): THREE.MeshStandardMaterial {
  // Leaves let light through: a little of their own colour shows even in the shade (emissive from the same map), so a canopy is dark green, not black.
  const mat = d.add(new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: o.alphaTest ?? 0.45, side: THREE.DoubleSide, roughness: 0.72, metalness: 0, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: o.glow ?? 0.22 }));
  const from = o.swayFrom ?? 3, amp = o.amp ?? 0.1;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind.time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  float h = max(0.0, position.y - ${from.toFixed(2)});
  float k = h * ${amp.toFixed(3)} / (h + 2.0);
  #ifdef USE_INSTANCING
  vec3 wp = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  #else
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  #endif
  transformed.x += sin(windTime * 1.7 + wp.x * 0.21 + wp.z * 0.17) * k + sin(windTime * 3.1 + wp.z * 0.9) * k * 0.25;
  transformed.z += cos(windTime * 1.3 + wp.z * 0.19 + wp.x * 0.13) * k * 0.7;
}`);
    // The card's own (crown-round) normal is right from both sides: no flip for the back face.
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""));
  };
  mat.customProgramCacheKey = () => `leaf:${from}:${amp}`;
  return mat;
}

/** Bark: vertex-coloured trunk with a normal map along the trunk's own UVs (streaks run up the trunk). */
export function barkMaterial(d: Disposer): THREE.MeshStandardMaterial {
  const s = surface(d, "bark", 256);
  s.normal.channel = 0;
  s.rough.channel = 0;
  return d.add(new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: s.normal, roughnessMap: s.rough, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 }));
}

// ---------- geometry ----------

const c3 = (hex: string) => new THREE.Color(hex);

/** A tapered limb from a to b with bark UVs (u around, v every 1.2 m along it) and dark-to-light bark colour; non-indexed, attributes: position, normal, uv, color. */
function bough(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, seed: number, foot = c3("#34261a"), top = c3("#6d5238"), seg = 9, rings = 4): THREE.BufferGeometry {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, rings, true);
  const p = g.attributes.position, uv = g.attributes.uv, cols = new Float32Array(p.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const u = p.getY(i) / len + 0.5, ang = Math.atan2(p.getZ(i), p.getX(i));
    // Knots and swellings: the radius wobbles a little along the limb.
    const k = 1 + 0.08 * Math.sin(u * 9 + seed) + (hash2(Math.round(ang * 3), Math.round(u * 8), seed) - 0.5) * 0.08;
    p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
    uv.setXY(i, uv.getX(i) * 2, u * len / 1.2);
    const streak = hash2(Math.round(ang * 5), seed, 5) * 0.35 + hash2(Math.round(ang * 11), Math.round(u * 5), seed) * 0.2;
    tmp.copy(foot).lerp(top, Math.max(0, Math.min(1, u * 0.7 + streak - 0.1)));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1)));
  const out = g.toNonIndexed();
  g.dispose();
  return out;
}

/**
 * A cluster of leaf cards in an ellipsoid of radii (rx, ry, rz) at (cx, cy, cz): each card a 1.5 m sprite facing mostly outward, the vertex normals
 * pointing away from the cluster's centre (soft round shading), darker toward the inside and the underside. Attributes: position, normal, uv, color.
 */
function leafCluster(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, cards: number, seed: number, dark: THREE.Color, light: THREE.Color, size = 1.5): THREE.BufferGeometry {
  const pos = new Float32Array(cards * 4 * 3), nor = new Float32Array(cards * 4 * 3), uv = new Float32Array(cards * 4 * 2), col = new Float32Array(cards * 4 * 3), idx: number[] = [];
  const tmp = new THREE.Color(), n = new THREE.Vector3(), tu = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
  for (let c = 0; c < cards; c++) {
    // A point in the shell of the ellipsoid (leaves are on the outside of a crown, the inside is hollow and dark).
    const a = hash2(c, 1, seed) * Math.PI * 2, z = hash2(c, 2, seed) * 2 - 1, rr = Math.sqrt(1 - z * z), depth = 0.45 + 0.55 * Math.cbrt(hash2(c, 3, seed));
    n.set(rr * Math.cos(a) * rx, z * ry, rr * Math.sin(a) * rz);
    p.set(cx + n.x * depth, cy + n.y * depth, cz + n.z * depth);
    n.set(rr * Math.cos(a) / rx, z / ry, rr * Math.sin(a) / rz).normalize(); // the ellipsoid's own outward normal
    // The card lies roughly tangent to the crown, tilted at random.
    tu.crossVectors(Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up, n).normalize();
    tv.crossVectors(n, tu).normalize();
    const roll = hash2(c, 4, seed) * Math.PI * 2, tilt = (hash2(c, 5, seed) - 0.5) * 1.1, s = size * (0.8 + 0.5 * hash2(c, 6, seed));
    const ux = tu.clone().multiplyScalar(Math.cos(roll)).addScaledVector(tv, Math.sin(roll)), vx = tv.clone().multiplyScalar(Math.cos(roll)).addScaledVector(tu, -Math.sin(roll));
    ux.addScaledVector(n, tilt * 0.5);
    vx.addScaledVector(n, -tilt * 0.4);
    const shade = 0.3 + 0.7 * smoothstep(0.1, 1, depth) * (0.65 + 0.35 * (n.y * 0.5 + 0.5));
    tmp.copy(dark).lerp(light, shade * (0.85 + 0.3 * hash2(c, 7, seed)));
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    corners.forEach(([sx, sy], k) => {
      const q = (c * 4 + k) * 3;
      pos[q] = p.x + (ux.x * sx + vx.x * sy) * s * 0.5;
      pos[q + 1] = p.y + (ux.y * sx + vx.y * sy) * s * 0.5;
      pos[q + 2] = p.z + (ux.z * sx + vx.z * sy) * s * 0.5;
      nor[q] = n.x;
      nor[q + 1] = n.y;
      nor[q + 2] = n.z;
      col[q] = tmp.r;
      col[q + 1] = tmp.g;
      col[q + 2] = tmp.b;
      uv[(c * 4 + k) * 2] = sx * 0.5 + 0.5;
      uv[(c * 4 + k) * 2 + 1] = sy * 0.5 + 0.5;
    });
    const b = c * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  const out = g.toNonIndexed();
  g.dispose();
  return out;
}

const mergeAll = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  // Same attribute set everywhere, so a plain concatenation works (and keeps our normals).
  const attrs = ["position", "normal", "uv", "color"] as const;
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of attrs) {
    const size = parts[0].attributes[name].itemSize, arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array as Float32Array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of parts) g.dispose();
  out.computeBoundingSphere();
  return out;
};

export type Tree = { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry };

/**
 * Broadleaf trees, three silhouettes: 0 an oak (a thick trunk, a few boughs, a broad crown of seven leafy clusters), 1 a poplar (a tall narrow
 * crown on a visible trunk), 2 a forest tree (a tall straight trunk, the crown high up). Same sizes as the old low-poly trees (origin on the ground).
 * Two geometries: the trunk and boughs (bark material), the leaf cards (leaf material).
 */
export function realisticTree(variant: 0 | 1 | 2): Tree {
  const dk = [c3("#1f4a1c"), c3("#2a5a2a"), c3("#1d4a1b")], lt = [c3("#86b84c"), c3("#a0cc58"), c3("#78b04a")];
  const wood: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
  if (variant === 0) {
    wood.push(bough(0, 0, 0, 0, 0.9, 0, 0.8, 0.5, 1, c3("#2a1e14"), c3("#4a3624")), bough(0, 0.8, 0, 0.1, 3.7, 0, 0.5, 0.3, 2));
    wood.push(bough(0.05, 3.2, 0, 1.3, 4.7, 0.5, 0.2, 0.1, 3), bough(0.05, 3.4, 0, -1.2, 4.6, -0.4, 0.2, 0.1, 4), bough(0.05, 3.6, 0, 0.3, 5.0, -1.2, 0.18, 0.09, 5));
    const clusters: [number, number, number, number, number][] = [[0.1, 5.7, 0, 2.3, 1.8], [1.5, 5.1, 0.6, 1.6, 1.3], [-1.4, 5.2, -0.5, 1.7, 1.3], [0.3, 6.9, -0.5, 1.5, 1.2], [-0.5, 4.7, 1.4, 1.4, 1.0], [1.0, 6.2, 1.1, 1.3, 1.0], [0.2, 4.9, -1.6, 1.4, 1.0]];
    clusters.forEach(([x, y, z, r, rh], i) => leaves.push(leafCluster(x, y, z, r, rh, r, Math.round(10 + r * 12), i + 1, dk[0], lt[0])));
  } else if (variant === 1) {
    wood.push(bough(0, 0, 0, 0, 0.8, 0, 0.55, 0.36, 6, c3("#2a1e14"), c3("#4a3624")), bough(0, 0.7, 0, 0.05, 4.8, 0, 0.36, 0.2, 7));
    [4.4, 5.8, 7.2, 8.6, 9.8].forEach((y, i) => {
      const r = [1.35, 1.5, 1.4, 1.1, 0.7][i];
      leaves.push(leafCluster(i % 2 ? 0.1 : -0.1, y, i % 2 ? -0.1 : 0.1, r, 1.6, r, Math.round(10 + r * 12), 20 + i, dk[1], lt[1]));
    });
  } else {
    wood.push(bough(0, 0, 0, 0, 1.0, 0, 0.62, 0.34, 11, c3("#2a1e14"), c3("#4a3624")), bough(0, 0.9, 0, 0.1, 8.2, 0, 0.34, 0.2, 12, c3("#34261a"), c3("#5e4630"), 9, 6));
    for (const [bx, by, bz] of [[1.1, 9.0, 0.4], [-1.0, 9.2, -0.5], [0.2, 9.4, 1.1]] as const) wood.push(bough(0.1, 7.6, 0, bx, by, bz, 0.14, 0.08, 13 + Math.round(bx * 7)));
    const clusters: [number, number, number, number, number][] = [[0.1, 9.6, 0, 2.0, 1.5], [1.3, 9.1, 0.4, 1.4, 1.1], [-1.2, 9.3, -0.5, 1.5, 1.2], [0.2, 10.8, -0.2, 1.2, 1.0], [0.1, 8.7, 1.2, 1.2, 0.9]];
    clusters.forEach(([x, y, z, r, rh], i) => leaves.push(leafCluster(x, y, z, r, rh, r, Math.round(10 + r * 12), 40 + i, dk[2], lt[2])));
  }
  return { trunk: mergeAll(wood), leaves: mergeAll(leaves) };
}

/** A roof of leaves for the forest road: five big overlapping clusters (about 5 m across), the cards lighter underneath so the underside is not black. */
export function leafCanopy(): THREE.BufferGeometry {
  const dark = c3("#33662d"), light = c3("#8cc45a");
  const parts = [[0, 0, 0, 4.6, 2.4, 4.6], [-2.4, 0.6, 1.1, 3.2, 1.9, 3.2], [2.5, 0.5, -1.2, 3.0, 1.8, 3.0], [0.6, 0.7, 2.6, 2.6, 1.6, 2.6], [-0.9, 0.4, -2.5, 2.6, 1.6, 2.6]] as const;
  return mergeAll(parts.map(([x, y, z, rx, ry, rz], i) => leafCluster(x, y, z, rx, ry, rz, Math.round(rx * 15), 60 + i, dark, light, 1.9)));
}

/** A tuft of grass: three crossed quads 0.55 m wide and 0.5 m tall, normals up (soft light), darker at the root. Attributes: position, normal, uv, color. */
export function grassTuft(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const dark = c3("#4a6a30"), light = c3("#c8d890");
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, ca = Math.cos(a) * 0.28, sa = Math.sin(a) * 0.28, h = 0.5;
    const pos = new Float32Array([-ca, 0, -sa, ca, 0, sa, ca, h, sa, -ca, h, -sa]), nor = new Float32Array(12).map((_, i) => (i % 3 === 1 ? 1 : 0));
    const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), col = new Float32Array([...dark.toArray(), ...dark.toArray(), ...light.toArray(), ...light.toArray()]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const ng = g.toNonIndexed();
    g.dispose();
    parts.push(ng);
  }
  return mergeAll(parts);
}

// ---------- conifers ----------

/** A spray of conifer branchlets (a central twig, side twigs, short needles) on a transparent ground; `snow` (0..1) dusts the needles white. */
export function needleTexture(d: Disposer, snow = 0): THREE.DataTexture {
  const w = 128, h = 128, data = new Uint8Array(new ArrayBuffer(w * h * 4));
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 40;
    data[i * 4 + 1] = 84;
    data[i * 4 + 2] = 52;
    data[i * 4 + 3] = 0;
  }
  const plot = (x: number, y: number, r: number, rgb: number[], k: number) => {
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) {
      for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
        if (i < 0 || i >= w || j < 0 || j >= h || Math.hypot(i + 0.5 - x, j + 0.5 - y) > r) continue;
        const q = (j * w + i) * 4;
        const white = snow > 0 && hash2(i, j, 91) < snow * (0.25 + 0.75 * (j / h)) ? 1 : 0; // snow settles on the upper (tip-ward) half
        for (let c = 0; c < 3; c++) data[q + c] = Math.min(255, Math.round(white ? 235 + 20 * hash2(i, j, 92) : rgb[c] * k));
        data[q + 3] = 255;
      }
    }
  };
  const twig = (x0: number, y0: number, x1: number, y1: number, needle: number, seed: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(len);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      plot(x, y, 1.1, [70, 52, 36], 1);
      if (s % 2) continue;
      const nl = needle * (1 - 0.5 * t);
      for (const side of [-1, 1]) {
        const a = Math.atan2(y1 - y0, x1 - x0) + side * (0.95 + 0.25 * hash2(s, seed, 93));
        for (let k = 0; k <= nl; k += 1) plot(x + Math.cos(a) * k, y + Math.sin(a) * k, 1.3 - 0.7 * (k / nl), [34 + 40 * (k / nl), 82 + 50 * (k / nl), 50 + 20 * (k / nl)], 0.8 + 0.4 * hash2(s, seed, 94));
      }
    }
  };
  // The main twig runs up the sprite (the base is at the bottom, v = 0); side twigs fan out along it.
  twig(w / 2, 2, w / 2 + 3, h - 4, 11, 1);
  for (let k = 0; k < 9; k++) {
    const y0 = 12 + k * 12, len = 40 - k * 3.2, dir = k % 2 ? 1 : -1;
    twig(w / 2 + 1, y0, w / 2 + dir * len + 1, Math.min(h - 3, y0 + len * 0.55), 9, 10 + k);
    twig(w / 2 + 1, y0 + 5, w / 2 - dir * (len * 0.8) + 1, Math.min(h - 3, y0 + 5 + len * 0.45), 9, 30 + k);
  }
  const t = d.add(new THREE.DataTexture(data, w, h, THREE.RGBAFormat));
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * A fir: a straight trunk and seven tiers of branch sprays (two crossed layers each), drooping, shorter toward the top. About 2.4 m radius at the
 * base, 11 m tall, origin on the ground; same attributes as `realisticTree`. The sprites carry the needles (and the snow, see `needleTexture`).
 */
export function realisticFir(): Tree {
  const wood: THREE.BufferGeometry[] = [bough(0, 0, 0, 0, 1.0, 0, 0.55, 0.3, 21, c3("#2a1e14"), c3("#4a3624")), bough(0, 0.9, 0, 0, 10.8, 0, 0.3, 0.05, 22, c3("#34261a"), c3("#5a4430"), 8, 6)];
  const cards: THREE.BufferGeometry[] = [];
  const dark = c3("#a8c0ae"), light = c3("#ffffff");
  for (let tier = 0; tier < 7; tier++) {
    const y = 1.5 + tier * 1.4, R = 2.5 - tier * 0.3, n = 13 - tier, w = 1.5 + R * 0.35;
    for (let layer = 0; layer < 2; layer++) {
      const pos = new Float32Array(n * 4 * 3), nor = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), col = new Float32Array(n * 4 * 3), idx: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = ((k + layer * 0.5 + 0.3 * hash2(k, tier, 61 + layer)) / n) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
        const r0 = 0.25, y0 = y + layer * 0.35, droop = R * (0.38 + 0.12 * hash2(k, tier, 63)), len = R * (0.82 + 0.3 * hash2(k, tier, 65));
        const tipX = dx * len, tipZ = dz * len, tipY = y0 - droop;
        const corners = [[dx * r0 - px * w * 0.25, y0, dz * r0 - pz * w * 0.25, 0, 0], [dx * r0 + px * w * 0.25, y0, dz * r0 + pz * w * 0.25, 1, 0], [tipX + px * w * 0.5, tipY, tipZ + pz * w * 0.5, 1, 1], [tipX - px * w * 0.5, tipY, tipZ - pz * w * 0.5, 0, 1]];
        const nx = dx * 0.4, ny = 0.9, nz = dz * 0.4, nl = Math.hypot(nx, ny, nz), shade = 0.55 + 0.45 * (tier / 6) * 0.6 + 0.3 * hash2(k, tier, 67);
        corners.forEach(([x, yy, z, u, v], c) => {
          const q = (k * 4 + c) * 3;
          pos.set([x, yy, z], q);
          nor.set([nx / nl, ny / nl, nz / nl], q);
          uv.set([u, v], (k * 4 + c) * 2);
          const t = Math.min(1, shade * (0.7 + 0.5 * v));
          col.set([dark.r + (light.r - dark.r) * t, dark.g + (light.g - dark.g) * t, dark.b + (light.b - dark.b) * t], q);
        });
        const b = k * 4;
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      cards.push(g.toNonIndexed());
      g.dispose();
    }
  }
  return { trunk: mergeAll(wood), leaves: mergeAll(cards) };
}

// ---------- desert plants ----------

/** A ribbed tube along a path (points x, y, z) with radii at its ends, `ribs` flutes, a domed tip; attributes: position, normal, uv, color. For cactus columns and arms. */
function ribbedTube(path: [number, number, number][], r0: number, r1: number, ribs: number, seed: number, base: THREE.Color, rib: THREE.Color, dome = true): THREE.BufferGeometry {
  const rings = path.length + (dome ? 2 : 0), seg = ribs * 3, pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const tmp = new THREE.Color(), tan = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < rings; i++) {
    const pi = Math.min(i, path.length - 1), p = path[pi], t = pi / Math.max(1, path.length - 1);
    const prev = path[Math.max(0, pi - 1)], next = path[Math.min(path.length - 1, pi + 1)];
    tan.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]).normalize();
    a.crossVectors(Math.abs(tan.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up, tan).normalize();
    b.crossVectors(tan, a).normalize();
    let r = r0 + (r1 - r0) * t;
    let lift = 0;
    if (dome && i >= path.length) {
      const k = (i - path.length + 1) / 2; // 0.5, 1 : the tip closes like a dome
      r *= Math.sqrt(Math.max(0, 1 - k * k)) + 0.02;
      lift = r0 * 0.5 * k;
    }
    for (let j = 0; j <= seg; j++) {
      const ang = (j / seg) * Math.PI * 2, flute = 1 + 0.13 * Math.cos(ang * ribs) + 0.03 * (hash2(j, i, seed) - 0.5);
      const rr = r * flute, cx = Math.cos(ang) * rr, cy = Math.sin(ang) * rr;
      pos.push(p[0] + a.x * cx + b.x * cy + tan.x * lift, p[1] + a.y * cx + b.y * cy + tan.y * lift, p[2] + a.z * cx + b.z * cy + tan.z * lift);
      const ridge = 0.5 + 0.5 * Math.cos(ang * ribs);
      tmp.copy(base).lerp(rib, ridge * 0.7 + 0.15 * hash2(j, i, seed + 5));
      col.push(tmp.r, tmp.g, tmp.b);
      uv.push(j / seg, i / rings);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const q = i * (seg + 1) + j;
      idx.push(q, q + 1, q + seg + 1, q + 1, q + seg + 2, q + seg + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const out = g.toNonIndexed();
  g.dispose();
  return out;
}

/** A saguaro: a fluted green column with two arms that bend up (4.5 m tall, like the old model), smooth and vertex-coloured (darker valleys, paler ribs). */
export function realisticCactus(): THREE.BufferGeometry {
  const base = c3("#3e6a35"), rib = c3("#86a85a");
  const arm = (x0: number, y0: number, dir: number, reach: number, rise: number, r: number, seed: number) => {
    const path: [number, number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, out = reach * Math.sin(t * Math.PI * 0.5), up = y0 + rise * (t * t) + 0.12 * t;
      path.push([x0 + dir * out, up, 0]);
    }
    return ribbedTube(path, r, r * 0.92, 7, seed, base, rib);
  };
  return mergeAll([
    ribbedTube(Array.from({ length: 8 }, (_, i) => [0, (i / 7) * 4.1, 0] as [number, number, number]), 0.48, 0.4, 9, 1, base, rib),
    arm(0.3, 1.5, 1, 1.4, 1.7, 0.27, 2),
    arm(-0.3, 2.2, -1, 1.25, 1.35, 0.24, 3),
  ]);
}

/** A dry desert shrub: three low clusters of small grey-green leaves (about 1.6 m across). */
export function realisticShrub(): THREE.BufferGeometry {
  const dark = c3("#5a5a30"), light = c3("#b4ac62");
  return mergeAll([leafCluster(0, 0.45, 0, 0.8, 0.45, 0.8, 26, 81, dark, light, 0.5), leafCluster(0.55, 0.35, 0.3, 0.55, 0.33, 0.55, 18, 82, dark, light, 0.45), leafCluster(-0.5, 0.3, -0.3, 0.5, 0.3, 0.5, 16, 83, dark, light, 0.45)]);
}
