import { type Disposer, THREE, hash2 } from "./core";

// The yeti: a hulking white ape of the high ice, built from shaggy rounded shapes (faceted, with a jitter on each vertex, so the fur looks tufted).
// About 4.6 m tall standing, 3.6 m across the shoulders — a car is 4 m long beside it. Local +X is forward, +Y up, ±Z the sides.
// `pose` moves it through the four moments of a jump: it roars on the perch, leaps (arms thrown up, legs tucked then stretched out for the landing),
// stands and pounds its chest where it landed, and leaps off across the road.

export type YetiMoment = "roar" | "leap" | "stand" | "away";

export type YetiRig = {
  group: THREE.Group;
  /** `u` = how far into the moment (0..1), `t` = the clock in seconds (for the shaking and the chest pounding). */
  pose(moment: YetiMoment, u: number, t: number): void;
  /** 1 = solid; below 1 the whole yeti fades. */
  setAlpha(a: number): void;
};

const ease = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

export function makeYeti(d: Disposer): YetiRig {
  const fur = d.add(new THREE.MeshStandardMaterial({ color: "#eaf3fa", roughness: 0.95, flatShading: true }));
  const shade = d.add(new THREE.MeshStandardMaterial({ color: "#c3d8e8", roughness: 0.95, flatShading: true }));
  const skin = d.add(new THREE.MeshStandardMaterial({ color: "#3d566e", roughness: 0.7, flatShading: true }));
  const bone = d.add(new THREE.MeshStandardMaterial({ color: "#f4f1e6", roughness: 0.5 }));
  const eye = d.add(new THREE.MeshBasicMaterial({ color: "#8fe9ff", fog: false }));
  const mats: (THREE.MeshStandardMaterial | THREE.MeshBasicMaterial)[] = [fur, shade, skin, bone, eye];

  const group = new THREE.Group();
  const root = new THREE.Group(); // the whole body, lowered / tilted by the poses
  group.add(root);

  /** A shaggy ellipsoid: a sphere whose vertices are nudged (the same way for the vertices that share a place, so it stays closed). */
  const blob = (r: number, sx: number, sy: number, sz: number, m: THREE.Material, seed: number, bump = 0.16) => {
    const g = d.add(new THREE.IcosahedronGeometry(r, 2));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (hash2(Math.round(x * 40) + Math.round(z * 40) * 131, Math.round(y * 40), seed) - 0.5) * bump;
      p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const place = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent: THREE.Object3D = root): T => {
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  // ---- the trunk: a big chest over a heavy belly, a hump of shoulders ----
  const torso = new THREE.Group();
  place(torso, 0, 2.0, 0);
  place(blob(1, 1.5, 1.35, 1.45, fur, 1), 0.1, 0.5, 0, torso); // chest
  place(blob(1, 1.3, 1.1, 1.3, fur, 2), -0.1, -0.6, 0, torso); // belly
  place(blob(1, 1.1, 0.85, 1.55, shade, 3), -0.35, 1.25, 0, torso); // the hump of the shoulders
  place(blob(1, 0.8, 0.8, 1.0, shade, 4), -0.9, -0.4, 0, torso); // rump
  // Tufts along the spine.
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(d.add(new THREE.ConeGeometry(0.28, 0.9, 5)), fur);
    c.castShadow = true;
    place(c, -0.55 - i * 0.18, 1.6 - i * 0.42, (i % 2 ? 1 : -1) * 0.15, torso).rotation.z = 0.9 + i * 0.12;
  }

  // ---- the head: a heavy brow, a dark face with glowing eyes, a jaw that opens, fangs ----
  const head = new THREE.Group();
  place(head, 1.15, 1.3, 0, torso);
  place(blob(1, 0.95, 0.85, 0.95, fur, 5), 0, 0.2, 0, head); // skull and fur
  place(blob(1, 0.55, 0.55, 0.7, skin, 6, 0.08), 0.55, 0.0, 0, head); // face
  place(blob(1, 0.4, 0.2, 1.0, shade, 7), 0.5, 0.42, 0, head); // brow ridge
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(d.add(new THREE.SphereGeometry(0.11, 8, 6)), eye);
    place(e, 0.9, 0.22, s * 0.3, head);
    place(blob(1, 0.2, 0.22, 0.2, fur, 8 + s), -0.2, 0.55, s * 0.78, head); // ears of fur
  }
  const jaw = new THREE.Group();
  place(jaw, 0.35, -0.2, 0, head);
  place(blob(1, 0.6, 0.22, 0.55, skin, 10, 0.06), 0.3, -0.1, 0, jaw);
  for (const s of [-1, 1]) {
    const lower = new THREE.Mesh(d.add(new THREE.ConeGeometry(0.07, 0.3, 5)), bone);
    place(lower, 0.62, 0.12, s * 0.22, jaw);
    const upper = new THREE.Mesh(d.add(new THREE.ConeGeometry(0.07, 0.32, 5)), bone);
    upper.rotation.z = Math.PI;
    place(upper, 0.78, -0.03, s * 0.2, head);
  }

  // ---- the arms: long, hanging to the knuckles, ending in big fists with claws ----
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    place(arm, -0.05, 1.5, s * 1.75, torso);
    place(blob(1, 0.5, 1.25, 0.5, fur, 20 + s), 0, -1.0, 0, arm); // upper arm and forearm
    place(blob(1, 0.6, 0.55, 0.6, shade, 22 + s), 0.05, -2.2, 0, arm); // fist
    for (let c = -1; c <= 1; c++) {
      const claw = new THREE.Mesh(d.add(new THREE.ConeGeometry(0.07, 0.4, 5)), bone);
      claw.rotation.z = Math.PI;
      place(claw, 0.32, -2.55, c * 0.2, arm);
    }
    arms.push(arm);
  }

  // ---- the legs: short and thick, with broad feet ----
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    place(leg, -0.1, -1.1, s * 0.85, torso);
    place(blob(1, 0.55, 1.0, 0.55, fur, 30 + s), 0, -0.9, 0, leg);
    place(blob(1, 0.95, 0.3, 0.6, shade, 32 + s), 0.3, -1.85, 0, leg); // foot
    legs.push(leg);
  }

  return {
    group,
    pose(moment, u, t) {
      u = clamp01(u);
      let pitch = 0, crouch = 0, spread = 0.12, swingL = 0, swingR = 0, legSwing = 0, legBend = 0, headUp = 0, open = 0.1, shake = 0;
      if (moment === "roar") {
        // Chest thrown out, arms flung wide, head back, mouth wide open, the whole body trembling with it.
        const k = ease(Math.min(1, u * 3));
        pitch = 0.32 * k;
        spread = 0.12 + 1.15 * k;
        swingL = swingR = -0.25 * k;
        headUp = 0.5 * k;
        open = 0.1 + 0.75 * k;
        shake = 0.03 * k;
        crouch = -0.15 * k;
      } else if (moment === "leap") {
        // A crouch to spring, then arms thrown up and forward, legs tucked under it and stretched out again for the landing.
        const fly = ease(clamp01((u - 0.1) / 0.5)), reach = ease(clamp01((u - 0.6) / 0.4));
        crouch = u < 0.1 ? 0.5 * ease(u / 0.1) : 0.5 * (1 - ease(clamp01((u - 0.1) / 0.08)));
        pitch = -0.1 - 0.45 * fly + 0.45 * reach;
        spread = 0.5 - 0.3 * fly;
        swingL = swingR = 2.4 * fly - 1.1 * reach;
        legSwing = 1.1 * fly - 1.6 * reach;
        legBend = 0.9 * fly - 0.8 * reach;
        headUp = -0.1 + 0.2 * reach;
        open = 0.7;
      } else if (moment === "stand") {
        // The weight of the landing: down on the fists, then up to pound the chest in turn.
        const slam = ease(clamp01(u / 0.1));
        const up = ease(clamp01((u - 0.1) / 0.2));
        crouch = 0.6 * (1 - up) * slam;
        const pound = Math.sin(t * 9);
        pitch = 0.15 * up;
        spread = 0.25 + 0.35 * up;
        swingL = 1.5 * up * (0.5 + 0.5 * pound) + 0.2 * (1 - up);
        swingR = 1.5 * up * (0.5 - 0.5 * pound) + 0.2 * (1 - up);
        headUp = 0.4 * up;
        open = 0.5 + 0.3 * up;
        shake = 0.02 * up;
      } else {
        // Off again, across the road: a long jump, arms out.
        const k = ease(clamp01(u / 0.3));
        pitch = -0.35 * k;
        spread = 0.8 * k;
        swingL = swingR = 0.9 * k;
        legSwing = 0.9 * k;
        legBend = 0.8 * k;
        open = 0.5;
        crouch = u < 0.2 ? 0.3 * (1 - u / 0.2) : 0;
      }
      root.position.y = -crouch * 1.2 + shake * Math.sin(t * 55) * 3;
      root.position.x = shake * Math.cos(t * 47) * 2;
      torso.rotation.z = pitch;
      torso.rotation.x = shake * Math.sin(t * 39) * 2;
      head.rotation.z = headUp;
      jaw.rotation.z = -open;
      arms[0].rotation.set(spread, 0, swingL);
      arms[1].rotation.set(-spread, 0, swingR);
      legs[0].rotation.set(0, 0, legSwing);
      legs[1].rotation.set(0, 0, legSwing);
      legs[0].children[1].rotation.z = -legBend * 0.5;
      legs[1].children[1].rotation.z = -legBend * 0.5;
    },
    setAlpha(a) {
      for (const m of mats) {
        m.transparent = a < 0.999;
        m.opacity = a;
        m.needsUpdate = true;
      }
    },
  };
}
