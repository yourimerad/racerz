import { K } from "../adapter3d";
import { wallHeightOf } from "../flight";
import { THREE, type Placement, fbm, hash2, instanced, mat4, merge, part, propMaterial, smoothstep, vnoise } from "./core";
import { placeOf, propsOf } from "./place";
import * as models from "./props";
import { heightfield } from "./terrain";
import type { Scenery, WorldCtx } from "./world";

// The desert: a red-sandstone canyon all the way round. The road runs at the bottom of a ravine whose walls rise 60 m (the flight rules' wall
// height) at the barrier line, in jagged strata lit along their rim; the plateau on top has boulders and cacti; a natural rock bridge,
// the same rock, spans the canyon where the lap is straightest and is welded into both walls, with cracks. All of it comes from the same
// height function, so props stand exactly on the plateau.

const COL = {
  floor: "#d6ae74", foot: "#6b2f1a", cliff: "#b06a3e", cliffAlt: "#9c5a33", rim: "#e8a874", plateau: "#c4663a", patch: "#b25830", light: "#d6804f",
};

export function buildDesert(ctx: WorldCtx): Scenery {
  const { adapter, d, group, field, quality } = ctx, track = adapter.race.track, b = track.bounds;
  const H = wallHeightOf("desert"), barrierM = track.barrier * K;
  const colFloor = new THREE.Color(COL.floor), colFoot = new THREE.Color(COL.foot), colCliff = new THREE.Color(COL.cliff), colAlt = new THREE.Color(COL.cliffAlt);
  const colRim = new THREE.Color(COL.rim), colPlat = new THREE.Color(COL.plateau), colPatch = new THREE.Color(COL.patch), colLight = new THREE.Color(COL.light);
  const tmp = new THREE.Color();

  /** Height (m) of the ground at a world point, and how much of the wall it has climbed (0 floor .. 1 plateau). */
  const wall = (x: number, y: number) => {
    const dist = field.query(x, y, 330);
    if (!isFinite(dist)) return { h: H, t: 1 };
    const dm = dist * K;
    // The cliff's foot wanders ±2 m; its face leans out 3–5 m over its whole height (nearly sheer).
    const foot = barrierM + 0.25 + (fbm(x * 0.02, y * 0.02, 7, 3) - 0.5) * 3.2 + (vnoise(x * 0.11, y * 0.11, 9) - 0.5) * 1.2;
    const run = 3.4 + vnoise(x * 0.05, y * 0.05, 13) * 2.2;
    return { h: 0, t: smoothstep(foot, foot + run, dm) };
  };
  const height = (x: number, y: number, edgeFade: number) => {
    const w = wall(x, y);
    // Strata: the face steps in terraces; the plateau rolls a little (fading out toward the world's edge so it meets the flat plane around it).
    const t = w.t, strata = t > 0 && t < 1 ? Math.sin(t * 38 + vnoise(x * 0.2, y * 0.2, 3) * 6) * 0.012 : 0;
    const roll = (fbm(x * 0.012, y * 0.012, 21, 3) - 0.5) * 4.5 * smoothstep(0.9, 1, t) * edgeFade;
    return { h: H * (t + strata) + roll, t };
  };

  // ---- the terrain: canyon floor, walls, plateau ----
  const cell = quality.level >= 1 ? 2.2 : 1.6;
  const geo = heightfield(d, b.minX, b.minY, b.maxX, b.maxY, cell, (x, y, o) => {
    const fadeX = Math.min(x - b.minX, b.maxX - x) * K, fadeY = Math.min(y - b.minY, b.maxY - y) * K;
    const { h, t } = height(x, y, smoothstep(0, 14, Math.min(fadeX, fadeY)));
    o.h = h;
    const n = vnoise(x * 0.35, y * 0.35, 5), n2 = fbm(x * 0.05, y * 0.05, 31, 3);
    if (t < 0.012) tmp.copy(colFloor).multiplyScalar(0.94 + n * 0.12);
    else if (t < 0.985) {
      // The face: dark at the foot, banded strata, a bright rim.
      const band = vnoise(0, h * 0.42 + n2 * 4, 17);
      tmp.copy(colCliff).lerp(colAlt, band * 0.9).lerp(colFoot, (1 - smoothstep(0, 0.14, t)) * 0.75).lerp(colRim, smoothstep(0.9, 0.985, t) * 0.85).multiplyScalar(0.9 + n * 0.2);
    } else {
      tmp.copy(colPlat).lerp(colPatch, smoothstep(0.55, 0.8, n2) * 0.8).lerp(colLight, smoothstep(0.7, 0.9, vnoise(x * 0.03, y * 0.03, 8)) * 0.35).multiplyScalar(0.95 + n * 0.1);
    }
    o.r = tmp.r;
    o.g = tmp.g;
    o.b = tmp.b;
  });
  const terrain = new THREE.Mesh(geo, d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })));
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  group.add(terrain);
  // The plateau continues, flat, beyond the world's limits.
  const farGeo = d.add(new THREE.PlaneGeometry(6000, 6000));
  farGeo.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(farGeo, d.add(new THREE.MeshStandardMaterial({ color: COL.plateau, roughness: 1 })));
  far.position.set(((b.minX + b.maxX) / 2) * K, H - 0.05, ((b.minY + b.maxY) / 2) * K);
  far.receiveShadow = true;
  group.add(far);

  // ---- boulders and cacti on the plateau ----
  const matProp = propMaterial(d);
  const onTop = (p: { x: number; y: number }) => height(p.x, p.y, 1).h;
  const rocks = propsOf(adapter.props, "rock").map((p, i): Placement => ({ ...placeOf(p, 1, i), y: onTop(p) - 0.15, s: (p.r * K) * 1.05 }));
  const cacti = propsOf(adapter.props, "cactus").map((p, i): Placement => ({ ...placeOf(p, 1.3, i), y: onTop(p) - 0.05 }));
  const rock = instanced(d, models.rockModel(1, "#98582f", "#b06a3e"), matProp, rocks);
  const cactus = instanced(d, models.cactusModel(), matProp, cacti);
  if (rock) group.add(rock);
  if (cactus) group.add(cactus);

  // ---- the rock bridge ----
  const cover = track.covers[0];
  if (cover) buildBridge(ctx, cover, matProp);
  return {};
}

function buildBridge(ctx: WorldCtx, cover: { start: number; end: number }, matProp: THREE.MeshStandardMaterial) {
  const { adapter, d, group } = ctx, track = adapter.race.track, n = track.path.length;
  const len = cover.start <= cover.end ? cover.end - cover.start : n - cover.start + cover.end;
  let arc = 0;
  for (let k = 0; k < len; k++) {
    const a = track.path[(cover.start + k) % n], c = track.path[(cover.start + k + 1) % n];
    arc += Math.hypot(c.x - a.x, c.y - a.y);
  }
  const mid = (cover.start + Math.floor(len / 2)) % n, p = track.path[mid], t = track.tangents[mid];
  const L = arc * K, half = 21; // 21 m either side of the road: the ends are buried in the walls
  // Cross-section (lateral u, height y): an arch whose underside is lowest at the walls (7 m) and highest at the crown (10 m), 3.5–4.5 m thick.
  const bottom = (u: number) => 7 + 3 * (1 - Math.pow(u / half, 2));
  const top = (u: number) => bottom(u) + 4 + 0.5 * Math.cos((u / half) * Math.PI);
  const steps = 28, shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const u = -half + (2 * half * i) / steps;
    if (i) shape.lineTo(u, bottom(u));
    else shape.moveTo(u, bottom(u));
  }
  for (let i = steps; i >= 0; i--) {
    const u = -half + (2 * half * i) / steps;
    shape.lineTo(u, top(u));
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, steps: 6 });
  g.rotateY(Math.PI / 2);
  g.translate(-L / 2, 0, 0);
  // Rough rock: push the vertices about by a hash of their position (equal positions move equally, so the faces stay joined).
  const pos = g.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color(), base = new THREE.Color(COL.cliff), dark = new THREE.Color("#7d4426"), lit = new THREE.Color("#c98050");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const kx = Math.round(x * 4), ky = Math.round(y * 4), kz = Math.round(z * 4);
    const jx = (hash2(kx, ky + kz * 7, 41) - 0.5) * 0.9, jy = (hash2(kx + 3, ky, kz + 9) - 0.5) * 0.5, jz = (hash2(kz, kx, ky + 5) - 0.5) * 0.9;
    pos.setXYZ(i, x + jx, y + jy, z + jz);
    // Shade from the underside (dark) to the top (lit), with banding.
    const tt = Math.max(0, Math.min(1, (y - 6) / 9));
    c.copy(dark).lerp(base, smoothstep(0, 0.5, tt)).lerp(lit, smoothstep(0.6, 1, tt) * 0.5).multiplyScalar(0.92 + hash2(kx, kz, 77) * 0.16);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const deck = new THREE.Mesh(d.add(g), d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })));
  deck.castShadow = true;
  deck.receiveShadow = true;

  // Fissures zig-zagging over the top and down both faces (thin dark strips).
  const strips = [];
  const crackCol = "#4a1f0e";
  for (const f of [-0.28, 0.02, 0.3]) {
    let u = f * L;
    let prevU = u, prevV = -half + 3;
    for (let v = -half + 3; v <= half - 3; v += 2.4) {
      u = Math.max(-L / 2 + 1.2, Math.min(L / 2 - 1.2, u + (hash2(Math.round(v * 3), Math.round(f * 100), 5) - 0.5) * 1.6));
      if (v > prevV) {
        const dx = u - prevU, dz = v - prevV, l = Math.hypot(dx, dz);
        strips.push(part(new THREE.BoxGeometry(l + 0.1, 0.06, 0.2), crackCol, mat4((u + prevU) / 2, top((v + prevV) / 2) + 0.04, (v + prevV) / 2, 0, -Math.atan2(dz, dx), 0)));
      }
      prevU = u;
      prevV = v;
    }
  }
  for (const face of [-1, 1]) {
    for (const f of [-0.6, -0.15, 0.3, 0.7]) {
      let v = half * f;
      for (let y = top(v) - 0.2; y > bottom(v) + 0.3; y -= 0.9) {
        const nv = v + (hash2(Math.round(y * 5), Math.round(f * 100), face + 3) - 0.5) * 0.8;
        strips.push(part(new THREE.BoxGeometry(0.18, 1.0, 0.07), crackCol, mat4(face * (L / 2 + 0.05), y - 0.45, (v + nv) / 2, 0, 0, 0.1 * (nv - v))));
        v = nv;
      }
    }
  }
  const cracks = new THREE.Mesh(d.add(merge(strips)), matProp);
  const root = new THREE.Group();
  root.position.set(p.x * K, 0, p.y * K);
  root.rotation.y = -Math.atan2(t.y, t.x);
  root.add(deck, cracks);
  group.add(root);
}
