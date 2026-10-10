import { type Disposer, THREE } from "./core";

// The polar bear: a heavy white bear built from rounded shapes, with legs that swing in a walking trot. About 6.7 m nose to tail, 3.4 m at
// the shoulder: the size of the game's own hitbox (a 4 m car looks small next to it, as it does in 2D). Local +X is forward.

export type BearRig = {
  group: THREE.Group;
  /** Walk cycle: `phase` in radians. Also bobs the body. */
  walk(phase: number): void;
  /** 1 = solid; below 1 the whole bear fades (the crossing's ends). */
  setAlpha(a: number): void;
};

export function makeBear(d: Disposer): BearRig {
  const fur = d.add(new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.95 }));
  const shade = d.add(new THREE.MeshStandardMaterial({ color: "#e3dfd6", roughness: 0.95 }));
  const dark = d.add(new THREE.MeshStandardMaterial({ color: "#14161a", roughness: 0.5 }));
  const mats = [fur, shade, dark];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const ell = (r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material, parent: THREE.Object3D = body) => {
    const g = d.add(new THREE.SphereGeometry(r, 18, 12));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  ell(1, 0, 2.0, 0, 2.5, 1.35, 1.3, fur); // torso
  ell(1, 0.9, 2.6, 0, 1.2, 0.85, 1.15, fur); // shoulder hump
  ell(1, -1.3, 1.95, 0, 1.4, 1.2, 1.2, shade); // haunch
  ell(1, 2.0, 2.15, 0, 1.0, 0.85, 0.85, fur); // neck
  ell(1, 3.0, 2.3, 0, 0.95, 0.8, 0.75, fur); // head
  ell(1, 3.75, 2.1, 0, 0.62, 0.4, 0.42, shade); // snout
  ell(1, 4.3, 2.22, 0, 0.12, 0.12, 0.16, dark); // nose
  for (const s of [-1, 1]) {
    ell(1, 2.85, 3.0, s * 0.55, 0.22, 0.22, 0.2, shade); // ears
    ell(1, 3.5, 2.5, s * 0.36, 0.09, 0.09, 0.09, dark); // eyes
  }
  ell(1, -2.6, 2.4, 0, 0.35, 0.3, 0.3, fur); // tail
  // Legs: a swinging pivot at each hip, a thick limb and a wide paw.
  const legs: THREE.Group[] = [];
  const limb = d.add(new THREE.CylinderGeometry(0.5, 0.42, 1.5, 12));
  for (const [x, z] of [[1.5, 0.85], [1.5, -0.85], [-1.6, 0.85], [-1.6, -0.85]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 1.6, z);
    const leg = new THREE.Mesh(limb, fur);
    leg.position.y = -0.7;
    leg.castShadow = true;
    hip.add(leg);
    ell(1, 0.12, -1.45, 0, 0.62, 0.25, 0.45, shade, hip);
    body.add(hip);
    legs.push(hip);
  }
  return {
    group,
    walk(phase) {
      const swing = 0.5;
      legs[0].rotation.z = Math.sin(phase) * swing;
      legs[3].rotation.z = Math.sin(phase) * swing;
      legs[1].rotation.z = Math.sin(phase + Math.PI) * swing;
      legs[2].rotation.z = Math.sin(phase + Math.PI) * swing;
      body.position.y = Math.abs(Math.sin(phase)) * 0.08;
      body.rotation.z = Math.sin(phase) * 0.015;
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
