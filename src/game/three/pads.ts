import type { Adapter3D } from "../adapter3d";
import { BOOST_STYLES, CHEV, CHEV_A, CHEV_Y, boostStyleOf } from "../boost";
import type { ThemeId } from "../themes";
import { type Disposer, THREE, softDisc } from "./core";

// The boost pads: a plate in the mode's style (stone in the desert, basalt with a lava rim at the volcano, ice at the north pole, yellow on
// asphalt elsewhere), three arrows whose brightness runs toward the front, a halo of light that flares when a car takes the pad and dims while
// the player's turbo is recharging. The pads are the game's (boost.ts): this only draws them where they are.

const FLOOR = 0.05;

type PadMesh = { group: THREE.Group; halo: THREE.MeshBasicMaterial; chevrons: THREE.MeshStandardMaterial[]; plate: THREE.MeshStandardMaterial; glowA: number; volcano: boolean };

function roundRect(w: number, l: number, r: number, inset = 0): THREE.Shape {
  // x = along the road (length), y = across it (width).
  const hw = w / 2 - inset, hl = l / 2 - inset, s = new THREE.Shape();
  s.moveTo(-hl + r, -hw);
  s.lineTo(hl - r, -hw);
  s.quadraticCurveTo(hl, -hw, hl, -hw + r);
  s.lineTo(hl, hw - r);
  s.quadraticCurveTo(hl, hw, hl - r, hw);
  s.lineTo(-hl + r, hw);
  s.quadraticCurveTo(-hl, hw, -hl, hw - r);
  s.lineTo(-hl, -hw + r);
  s.quadraticCurveTo(-hl, -hw, -hl + r, -hw);
  return s;
}

/** A flat geometry lying on the road from a 2D shape in (along, across) coordinates, thickness `t` upward. */
function flat(d: Disposer, shape: THREE.Shape, t: number, bevel = 0): THREE.BufferGeometry {
  const g = d.add(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6 }));
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Pads3D {
  private pads: PadMesh[] = [];
  private root = new THREE.Group();

  private adapter: Adapter3D;

  constructor(d: Disposer, scene: THREE.Scene, adapter: Adapter3D, mode: ThemeId, halo: THREE.Texture | null) {
    this.adapter = adapter;
    const th = BOOST_STYLES[boostStyleOf(mode)], k = adapter.race.boost.k, sc = k * 0.1, volcano = mode === "volcano";
    const W = 80 * sc, L = 92 * sc;
    for (const pv of adapter.pads) {
      const group = new THREE.Group();
      group.position.set(pv.x * 0.1, FLOOR, pv.y * 0.1);
      group.rotation.y = -pv.heading;
      // The plate and its outlines.
      const plate = d.add(new THREE.MeshStandardMaterial({ color: th.base, roughness: th.gloss ? 0.12 : 0.55, metalness: th.gloss ? 0.1 : 0.05, emissive: volcano ? "#2a0a02" : "#000000", emissiveIntensity: 1 }));
      const base = new THREE.Mesh(flat(d, roundRect(W, L, 8 * sc), 0.08, 0.015), plate);
      base.receiveShadow = true;
      group.add(base);
      const stroke = d.add(new THREE.MeshStandardMaterial({ color: th.stroke, roughness: 0.7 }));
      const rimShape = roundRect(W + 3 * sc, L + 3 * sc, 9 * sc);
      rimShape.holes.push(new THREE.Path(roundRect(W, L, 8 * sc).getPoints(8)));
      const outline = new THREE.Mesh(flat(d, rimShape, 0.1), stroke);
      outline.position.y = -0.01;
      group.add(outline);
      if (th.inner) {
        const inner = roundRect(W - 10 * sc, L - 10 * sc, 5 * sc);
        inner.holes.push(new THREE.Path(roundRect(W - 13 * sc, L - 13 * sc, 4 * sc).getPoints(8)));
        const m = new THREE.Mesh(flat(d, inner, 0.01), d.add(new THREE.MeshStandardMaterial({ color: th.inner, roughness: 0.6 })));
        m.position.y = 0.085;
        group.add(m);
      }
      if (th.rim) {
        const rim = roundRect(W, L, 8 * sc);
        rim.holes.push(new THREE.Path(roundRect(W - 4 * sc, L - 4 * sc, 7 * sc).getPoints(8)));
        const m = new THREE.Mesh(flat(d, rim, 0.01), d.add(new THREE.MeshStandardMaterial({ color: th.rim, emissive: th.rim, emissiveIntensity: 1.2 })));
        m.position.y = 0.09;
        group.add(m);
      }
      // Three arrows, the front one the brightest. Design coordinates: x across, y along with the front toward -y.
      const chevrons: THREE.MeshStandardMaterial[] = [];
      for (let i = 0; i < 3; i++) {
        const shape = new THREE.Shape();
        CHEV.forEach(([cx, cy], j) => {
          const along = -(cy + CHEV_Y[i]) * sc, across = cx * sc;
          if (j) shape.lineTo(along, across);
          else shape.moveTo(along, across);
        });
        shape.closePath();
        const fill = d.add(new THREE.MeshStandardMaterial({ color: th.chevFill[i], emissive: th.chevFill[i], emissiveIntensity: volcano ? 0.7 : 0.15, roughness: 0.45, transparent: true, opacity: CHEV_A[i] }));
        const outl = d.add(new THREE.MeshStandardMaterial({ color: th.chevStroke[i], roughness: 0.6 }));
        const mo = new THREE.Mesh(flat(d, shape, 0.012), outl);
        mo.position.y = 0.083;
        mo.scale.set(1.0, 1, 1.0);
        const mf = new THREE.Mesh(flat(d, shape, 0.012), fill);
        mf.position.y = 0.097;
        mf.scale.set(0.9, 1, 0.9);
        group.add(mo, mf);
        chevrons.push(fill);
      }
      for (const dc of th.deco) {
        const m = new THREE.Mesh(d.add(new THREE.CircleGeometry(dc.r * sc, 12).rotateX(-Math.PI / 2)), d.add(new THREE.MeshStandardMaterial({ color: dc.fill, emissive: volcano ? dc.fill : "#000000", emissiveIntensity: 0.8, transparent: true, opacity: dc.a })));
        m.position.set(-dc.y * sc, 0.1, dc.x * sc);
        group.add(m);
      }
      // The halo of light: additive, wider than the plate.
      const haloMat = d.add(new THREE.MeshBasicMaterial({ color: th.glow, map: halo, transparent: true, opacity: th.glowA, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const haloGeo = d.add(new THREE.PlaneGeometry(L * 1.9, W * 1.9).rotateX(-Math.PI / 2));
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.y = 0.12;
      haloMesh.renderOrder = 2;
      group.add(haloMesh);
      this.root.add(group);
      this.pads.push({ group, halo: haloMat, chevrons, plate, glowA: th.glowA, volcano });
    }
    scene.add(this.root);
  }

  update(time: number) {
    const views = this.adapter.pads;
    this.pads.forEach((p, i) => {
      const v = views[i], ready = v.ready ? 1 : 0.3;
      p.halo.opacity = Math.min(1, p.glowA * ready * (1 + v.flash * 3.5) * (0.85 + 0.15 * Math.sin(time * 3 + i)));
      // A pulse running from the rear arrow to the front one.
      p.chevrons.forEach((m, j) => {
        const wave = 0.5 + 0.5 * Math.sin(time * 5 - j * 1.4);
        m.emissiveIntensity = (p.volcano ? 0.5 : 0.1) + (p.volcano ? 0.9 : 0.35) * wave * ready + v.flash * 1.5;
        m.opacity = CHEV_A[j] * (0.7 + 0.3 * ready);
      });
      p.plate.emissiveIntensity = 0.6 + v.flash * 2;
    });
  }

  dispose() {
    this.root.removeFromParent();
    this.pads = [];
  }
}

export { softDisc };
