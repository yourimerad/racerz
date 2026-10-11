import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Disposer, THREE } from "./core";

// Fewer, bigger draw calls. Every draw call costs the CPU something (a phone more than a PC), and a race had ~420 of them (a car alone is 80 to
// 190 little meshes), twice with the shadow pass. Two tools, both pure re-batching: what is drawn is the same, nothing in the game reads any of it.
//   bakeStatic — a car's parts that never move relative to each other become one mesh per material;
//   splitMesh  — a big static mesh (terrain, road) becomes cells that share its vertex buffers, so what is out of view is culled instead of drawn.

const attrSignature = (g: THREE.BufferGeometry) =>
  `${Object.keys(g.attributes).sort().map((k) => `${k}:${g.attributes[k].itemSize}${g.attributes[k].normalized ? "n" : ""}`).join(",")}|${g.index ? "i" : "v"}|${Object.keys(g.morphAttributes).length}`;

/**
 * Merges the meshes under `root` that share a material (and shadow flags, draw order and vertex layout) into one mesh each, with their
 * transforms baked in `root`'s frame. Left alone: everything under `skip` (the parts that move: wheels, wings, flames), transparent materials
 * (their order matters), multi-material meshes, mirrored (negative-scale) meshes and instanced meshes. Returns the mesh counts before and after.
 */
export function bakeStatic(d: Disposer, root: THREE.Object3D, skip: ReadonlySet<THREE.Object3D> = new Set()): { before: number; after: number } {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  type Bucket = { mat: THREE.Material; cast: boolean; recv: boolean; order: number; items: THREE.Mesh[] };
  const buckets = new Map<string, Bucket>();
  let before = 0, kept = 0;
  const walk = (o: THREE.Object3D) => {
    if (skip.has(o)) {
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          before++;
          kept++;
        }
      });
      return;
    }
    for (const c of [...o.children]) walk(c);
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    before++;
    const mat = m.material;
    const mergeable =
      !Array.isArray(mat) && !mat.transparent && m.visible && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh &&
      m.geometry.attributes.position && m.matrixWorld.determinant() > 0;
    if (!mergeable) {
      kept++;
      return;
    }
    const key = `${(mat as THREE.Material).uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${attrSignature(m.geometry)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: mat as THREE.Material, cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder, items: [] }));
    b.items.push(m);
  };
  walk(root);
  let after = kept;
  for (const b of buckets.values()) {
    if (b.items.length < 2) {
      after += b.items.length;
      continue;
    }
    const pieces = b.items.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(pieces, false);
    for (const g of pieces) g.dispose();
    if (!merged) {
      after += b.items.length;
      continue;
    }
    d.add(merged);
    const baked = new THREE.Mesh(merged, b.mat);
    baked.castShadow = b.cast;
    baked.receiveShadow = b.recv;
    baked.renderOrder = b.order;
    baked.name = "baked";
    root.add(baked);
    for (const m of b.items) m.removeFromParent();
    after++;
  }
  return { before, after };
}

/**
 * Cuts a big static mesh into cells of `cell` metres (by triangle centre, in the mesh's own x and z). The cells share the original vertex
 * buffers (only their index differs) and each carries its own bounding sphere, so the renderer culls the cells out of view, in the main pass
 * and in the shadow pass alike. Returns the group that replaces the mesh, or null when it does not span several cells (nothing to gain).
 */
export function splitMesh(d: Disposer, mesh: THREE.Mesh, cell: number): THREE.Group | null {
  const g = mesh.geometry, pos = g.attributes.position;
  if (!pos || Array.isArray(mesh.material)) return null;
  const idx = g.index, tris = (idx ? idx.count : pos.count) / 3;
  const cells = new Map<number, number[]>();
  const at = (i: number) => (idx ? idx.getX(i) : i);
  for (let t = 0; t < tris; t++) {
    const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2);
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const key = (Math.floor(cx / cell) + 512) * 1024 + (Math.floor(cz / cell) + 512);
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(a, b, c);
  }
  if (cells.size < 2) return null;
  const group = new THREE.Group();
  group.name = `${mesh.name || "mesh"}-cells`;
  group.position.copy(mesh.position);
  group.quaternion.copy(mesh.quaternion);
  group.scale.copy(mesh.scale);
  group.renderOrder = mesh.renderOrder;
  group.visible = mesh.visible;
  const pt = new THREE.Vector3();
  for (const list of cells.values()) {
    const sub = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) sub.setAttribute(name, g.attributes[name]);
    sub.setIndex(new THREE.BufferAttribute(pos.count > 65535 ? new Uint32Array(list) : new Uint16Array(list), 1));
    const pts: THREE.Vector3[] = [];
    for (const v of new Set(list)) pts.push(pt.set(pos.getX(v), pos.getY(v), pos.getZ(v)).clone());
    sub.boundingSphere = new THREE.Sphere().setFromPoints(pts);
    sub.boundingBox = new THREE.Box3().setFromPoints(pts);
    d.add(sub);
    const m = new THREE.Mesh(sub, mesh.material);
    m.castShadow = mesh.castShadow;
    m.receiveShadow = mesh.receiveShadow;
    m.renderOrder = mesh.renderOrder;
    m.name = mesh.name;
    group.add(m);
  }
  return group;
}

/**
 * Splits every big static mesh under `root` (at least `minTris` triangles, spread over more than two cells; not transparent, not instanced)
 * into cells. Returns how many meshes were split.
 */
export function cullable(d: Disposer, root: THREE.Object3D, cell = 60, minTris = 2000): number {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || m.material.transparent) return;
    const g = m.geometry, n = g.index ? g.index.count / 3 : g.attributes.position ? g.attributes.position.count / 3 : 0;
    if (n >= minTris) targets.push(m);
  });
  let done = 0;
  for (const m of targets) {
    const grp = splitMesh(d, m, cell);
    if (!grp || !m.parent) continue;
    m.parent.add(grp);
    m.removeFromParent();
    done++;
  }
  return done;
}

/** A small prop's cell that is hidden beyond `max` metres from the camera. */
export type FarRule = { obj: THREE.Object3D; x: number; y: number; z: number; r: number; max: number };

/** The cells under `root` that asked to be hidden when far (`userData.maxDist`, set by `instanced`). */
export function collectFar(root: THREE.Object3D): FarRule[] {
  const out: FarRule[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    const max = o.userData.maxDist as number | undefined;
    const m = o as THREE.InstancedMesh;
    if (!max || !m.isInstancedMesh) return;
    if (!m.boundingSphere) m.computeBoundingSphere();
    const s = new THREE.Sphere().copy(m.boundingSphere as THREE.Sphere).applyMatrix4(m.matrixWorld);
    out.push({ obj: o, x: s.center.x, y: s.center.y, z: s.center.z, r: s.radius, max });
  });
  return out;
}

/** Shows each cell whose nearest edge is within its `max` of the camera. Once a frame; a handful of cells. */
export function applyFar(rules: readonly FarRule[], cam: THREE.Vector3) {
  for (const f of rules) f.obj.visible = Math.hypot(f.x - cam.x, f.y - cam.y, f.z - cam.z) - f.r < f.max;
}
