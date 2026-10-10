import { K } from "../adapter3d";
import type { SceneProp } from "../scenery";
import { type Disposer, type Placement, THREE, hash2, paintTexture } from "./core";
import type { DistField } from "./terrain";

// Placing scenery: props from the mode's own data, facing the road, with small deterministic variations.

/** The props of one kind (the scene's own list: same positions as the 2D art). */
export const propsOf = (props: readonly SceneProp[], kind: SceneProp["kind"]) => props.filter((p) => p.kind === kind);

/** Yaw (about Y) that turns a model whose front is +Z toward the nearest bit of road. */
export function faceRoad(field: DistField, path: readonly { x: number; y: number }[], x: number, y: number): number {
  if (!isFinite(field.query(x, y, 900))) return 0;
  const q = path[field.nearest];
  return Math.atan2(q.x - x, q.y - y);
}

/** A placement for a prop of reserved radius `r` (world units), whose model is `modelR` metres across: x, z in metres, scaled to fit, a random-looking yaw and a slight brightness. */
export function placeOf(p: SceneProp, modelR: number, i: number, yaw?: number): Placement {
  const v = 205 + Math.floor(hash2(i, Math.round(p.x), 9) * 50);
  return { x: p.x * K, z: p.y * K, s: (p.r * K) / modelR, ry: yaw ?? hash2(i, Math.round(p.y), 5) * Math.PI * 2, tint: (v << 16) | (v << 8) | v };
}

/**
 * A world-sized ground texture (the rectangle of the world, in world units → one plane in metres) painted by `paint`, with a plain plane
 * under and around it that fades into the fog at the horizon.
 */
export function texturedGround(
  d: Disposer, group: THREE.Group, bounds: { minX: number; minY: number; maxX: number; maxY: number }, outer: string, texW: number,
  paint: (g: CanvasRenderingContext2D, w: number, h: number, sx: number, sy: number) => void, roughness = 1,
) {
  const wm = (bounds.maxX - bounds.minX) * K, hm = (bounds.maxY - bounds.minY) * K, texH = Math.round((texW * hm) / wm);
  const tex = paintTexture(d, texW, texH, (g, w, h) => paint(g, w, h, w / (bounds.maxX - bounds.minX), h / (bounds.maxY - bounds.minY)), { anisotropy: 8 });
  const geo = d.add(new THREE.PlaneGeometry(wm, hm));
  geo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geo, d.add(new THREE.MeshStandardMaterial({ map: tex, roughness, ...(tex ? {} : { color: outer }) })));
  ground.position.set(((bounds.minX + bounds.maxX) / 2) * K, 0, ((bounds.minY + bounds.maxY) / 2) * K);
  ground.receiveShadow = true;
  group.add(ground);
  const farGeo = d.add(new THREE.PlaneGeometry(6000, 6000));
  farGeo.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(farGeo, d.add(new THREE.MeshStandardMaterial({ color: outer, roughness: 1 })));
  far.position.set(ground.position.x, -0.06, ground.position.z);
  far.receiveShadow = true;
  group.add(far);
  return ground;
}
