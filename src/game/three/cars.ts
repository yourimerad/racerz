import type { CarView } from "../adapter3d";
import { K } from "../adapter3d";
import type { ModelId } from "../garage";
import { WHEEL as AVENTADOR_WHEEL, buildAventador } from "./aventador";
import { WHEEL as CHIRON_WHEEL, buildChiron } from "./chiron";
import { type Kit, type Parts, type PaintUniforms, type Spec, addExhausts, addWheels, box, ball, cylX, finish, flameGroup, furniture, headlight, interior, makeKit, mesh, shell, taillight, yAt, zAt } from "./carkit";
import { type Disposer, THREE, clamp, lerp } from "./core";
import { loft, spline } from "./carbody";

// The cars in 3D, sculpted like real ones: the body is lofted from cross-sections (width, floor and deck height as curves along its length)
// into one smooth shell; the greenhouse is a second loft in glass with painted pillars and roof; there are interiors with seats and a
// driver, headlights with reflectors, tail lights, mirrors, exhausts, a number plate, and wheels with tyres, spokes, brake discs and
// calipers. The paint is a clear-coated metallic that reflects the surroundings (the mode's sky), with the shop's skins as a shader on
// top (racing stripes, carbon weave, gold). Real size: about 4 m long; the Racerz Jet is 5 m. Nose toward +X, origin on the ground.


const SPECS: Record<Exclude<ModelId, "jet" | "aventador" | "chiron">, Spec> = {
  gt: {
    x0: -2.1, x1: 2.1, eTop: 3.3, eBot: 7, tumble: 0.08,
    hw: [[-2.1, 0.76], [-1.95, 0.86], [-1.5, 0.95], [-0.8, 0.93], [0.2, 0.92], [0.9, 0.94], [1.45, 0.95], [1.9, 0.88], [2.1, 0.74]],
    yb: [[-2.1, 0.4], [-1.8, 0.3], [-1.4, 0.26], [1.4, 0.25], [1.9, 0.28], [2.1, 0.36]],
    yt: [[-2.1, 0.84], [-1.9, 0.96], [-1.4, 1.0], [-0.7, 1.0], [0.3, 0.96], [0.9, 0.92], [1.5, 0.82], [1.9, 0.7], [2.1, 0.56]],
    cabin: { x0: -1.4, x1: 0.75, base: 0.76, tumble: 0.3, roof: [[-1.4, 0.99], [-1.15, 1.2], [-0.7, 1.36], [-0.1, 1.4], [0.3, 1.32], [0.55, 1.12], [0.75, 0.94]], side: [-1.2, 0.5], ws: 0.3, rw: -0.95, pillars: [[-1.0, -0.85], [0.35, 0.5]] },
    wheel: { xf: 1.32, xr: -1.3, r: 0.345, w: 0.27, z: 0.8, spokes: 5, rim: "#c8ccd2", caliper: "#d62828" },
  },
  mx5: {
    x0: -1.97, x1: 1.97, eTop: 3.0, eBot: 7, tumble: 0.1,
    hw: [[-1.97, 0.72], [-1.8, 0.84], [-1.3, 0.88], [-0.6, 0.85], [0.3, 0.84], [1.0, 0.86], [1.4, 0.87], [1.8, 0.8], [1.97, 0.68]],
    yb: [[-1.97, 0.38], [-1.6, 0.28], [1.5, 0.26], [1.97, 0.34]],
    yt: [[-1.97, 0.78], [-1.7, 0.88], [-1.2, 0.9], [-0.5, 0.86], [0.3, 0.86], [0.9, 0.84], [1.5, 0.74], [1.97, 0.55]],
    wheel: { xf: 1.2, xr: -1.2, r: 0.32, w: 0.22, z: 0.76, spokes: 5, rim: "#b9bec6", caliper: "#9aa0a8" },
  },
  p911: {
    x0: -2.1, x1: 2.1, eTop: 2.9, eBot: 6, tumble: 0.12,
    hw: [[-2.1, 0.82], [-1.9, 0.92], [-1.45, 0.98], [-0.7, 0.94], [0.2, 0.92], [1.0, 0.92], [1.5, 0.93], [1.9, 0.86], [2.1, 0.72]],
    yb: [[-2.1, 0.42], [-1.8, 0.3], [-1.3, 0.26], [1.3, 0.25], [1.9, 0.28], [2.1, 0.34]],
    yt: [[-2.1, 0.88], [-1.9, 0.98], [-1.5, 1.0], [-0.6, 0.98], [0.4, 0.93], [1.0, 0.84], [1.6, 0.74], [2.0, 0.62], [2.1, 0.52]],
    cabin: { x0: -1.75, x1: 0.78, base: 0.74, tumble: 0.34, roof: [[-1.75, 0.97], [-1.45, 1.12], [-0.85, 1.28], [-0.2, 1.34], [0.3, 1.28], [0.55, 1.12], [0.78, 0.9]], side: [-1.45, 0.45], ws: 0.25, rw: -1.0, pillars: [[-1.62, -1.4], [0.1, 0.3]] },
    wheel: { xf: 1.32, xr: -1.3, r: 0.35, w: 0.27, z: 0.82, spokes: 5, rim: "#d4d7dc", caliper: "#e0b000" },
  },
  f8: {
    x0: -2.1, x1: 2.1, eTop: 3.1, eBot: 7, tumble: 0.1,
    hw: [[-2.1, 0.82], [-1.9, 0.94], [-1.4, 1.0], [-0.7, 0.97], [0.1, 0.94], [0.9, 0.95], [1.5, 0.96], [1.9, 0.88], [2.1, 0.72]],
    yb: [[-2.1, 0.4], [-1.8, 0.28], [-1.2, 0.22], [1.4, 0.22], [1.9, 0.24], [2.1, 0.3]],
    yt: [[-2.1, 0.86], [-1.9, 0.98], [-1.3, 1.02], [-0.5, 1.0], [0.4, 0.88], [1.0, 0.76], [1.6, 0.64], [2.0, 0.5], [2.1, 0.42]],
    cabin: { x0: -1.1, x1: 0.85, base: 0.74, tumble: 0.3, roof: [[-1.1, 0.99], [-0.8, 1.12], [-0.3, 1.2], [0.2, 1.2], [0.55, 1.08], [0.85, 0.84]], side: [-0.85, 0.55], ws: 0.3, rw: -2, pillars: [[-0.95, -0.75]] },
    wheel: { xf: 1.32, xr: -1.28, r: 0.35, w: 0.29, z: 0.84, spokes: 5, rim: "#b8bcc4", caliper: "#e0b000" },
  },
};

// ---------- the cars (the Aventador and the Chiron are in their own files) ----------

/** Racerz GT: a muscular coupé with a ducktail. */
function buildGT(kit: Kit): Parts {
  const g = new THREE.Group(), spec = SPECS.gt, wheels = shell(kit, g, spec);
  interior(kit, g, -0.3, 0.95, { seatX: -0.55, dashX: 0.5, hw: 0.76 });
  furniture(kit, g, spec, 0.55, 1.0, 0.92);
  headlight(kit, g, spec, 1.93, 0.62, 0.1, [0.2, 0.06]);
  taillight(kit, g, spec, -2.06, 0.66, 0.08, [0.3, 0.05]);
  g.add(box(kit, 0.07, 0.1, 0.78, 2.07, yAt(spec, 2.07, 0.3), 0, kit.dark)); // grille
  for (let i = 0; i < 3; i++) g.add(box(kit, 0.075, 0.012, 0.78, 2.075, yAt(spec, 2.07, 0.3) - 0.03 + i * 0.03, 0, kit.chrome));
  g.add(box(kit, 0.22, 0.02, 1.5, 2.0, 0.27, 0, kit.dark)); // splitter
  g.add(box(kit, 0.3, 0.035, 1.1, -1.82, spline(spec.yt, -1.82) + 0.01, 0, kit.paint, true)); // ducktail
  g.add(box(kit, 0.6, 0.04, 0.9, 1.0, spline(spec.yt, 1.0) - 0.07, 0, kit.dark)); // bonnet vent
  addExhausts(kit, g, -2.1, 0.4, [-0.55, 0.55]);
  return finish(kit, g, spec, wheels);
}

/** Mazda MX-5: a small open roadster: no roof, a low windscreen, two headrest fairings. */
function buildMX5(kit: Kit): Parts {
  const g = new THREE.Group(), spec = SPECS.mx5, wheels = shell(kit, g, spec);
  g.add(box(kit, 1.15, 0.015, 1.0, -0.2, 0.862, 0, kit.dark)); // the cockpit opening
  interior(kit, g, -0.2, 0.9, { seatX: -0.5, dashX: 0.42, hw: 0.72, head: 0.34 });
  // Windscreen: a slanted glass sheet in a thin chrome frame.
  const wsGroup = new THREE.Group();
  wsGroup.position.set(0.4, 1.06, 0);
  wsGroup.rotation.z = -0.62;
  const ws = mesh(kit, new THREE.PlaneGeometry(1.3, 0.42), kit.glass, false);
  ws.rotation.y = Math.PI / 2;
  wsGroup.add(ws, box(kit, 0.04, 0.04, 1.34, 0, 0.21, 0, kit.chrome), box(kit, 0.04, 0.42, 0.04, 0, 0, 0.66, kit.chrome), box(kit, 0.04, 0.42, 0.04, 0, 0, -0.66, kit.chrome));
  g.add(wsGroup);
  for (const s of [-1, 1]) g.add(ball(kit, 0.3, -0.85, 0.9, s * 0.34, 1.7, 0.7, 0.8, kit.paint, true)); // headrest fairings
  furniture(kit, g, spec, 0.42, 0.98, 0.8);
  headlight(kit, g, spec, 1.85, 0.7, 0.1, [0.17, 0.07]);
  taillight(kit, g, spec, -1.92, 0.62, 0.08, [0.22, 0.05]);
  g.add(box(kit, 0.07, 0.09, 0.5, 1.96, yAt(spec, 1.96, 0.3), 0, kit.dark));
  addExhausts(kit, g, -1.98, 0.42, [0.5]);
  return finish(kit, g, spec, wheels);
}

/** Porsche 911 Carrera: raised front wings with round headlights, a long sloping roof, a retractable-spoiler lip. */
function buildP911(kit: Kit): Parts {
  const g = new THREE.Group(), spec = SPECS.p911, wheels = shell(kit, g, spec);
  interior(kit, g, -0.45, 0.92, { seatX: -0.65, dashX: 0.5, hw: 0.74 });
  furniture(kit, g, spec, 0.5, 1.0, 0.9);
  for (const s of [-1, 1]) {
    g.add(ball(kit, 0.3, 1.5, spline(spec.yt, 1.5) - 0.05, s * 0.6, 1.7, 0.5, 0.85, kit.paint, true)); // the front wings' humps
    g.add(ball(kit, 0.15, 1.9, 0.78, s * 0.6, 0.45, 1, 1, kit.housing));
    g.add(ball(kit, 0.12, 1.93, 0.78, s * 0.6, 0.4, 1, 1, kit.lens));
  }
  taillight(kit, g, spec, -2.08, 0.65, 0.1, [0.3, 0.045]);
  g.add(box(kit, 0.06, 0.05, 0.5, -2.1, yAt(spec, -2.1, 0.65), 0, kit.tail));
  g.add(box(kit, 0.2, 0.04, 1.2, -1.88, spline(spec.yt, -1.88) + 0.005, 0, kit.paint, true));
  g.add(box(kit, 0.06, 0.09, 0.9, 2.08, yAt(spec, 2.08, 0.3), 0, kit.dark));
  addExhausts(kit, g, -2.1, 0.4, [-0.52, 0.52]);
  return finish(kit, g, spec, wheels);
}

/** Ferrari F8 Spider: curvy and low, side intakes behind the doors, hood vents, twin round tail lights, four exhausts. */
function buildF8(kit: Kit): Parts {
  const g = new THREE.Group(), spec = SPECS.f8, wheels = shell(kit, g, spec);
  interior(kit, g, -0.1, 0.8, { seatX: -0.35, dashX: 0.6, hw: 0.74, head: 0.2 });
  furniture(kit, g, spec, 0.5, 0.98, 0.98);
  for (const s of [-1, 1]) {
    const zi = zAt(spec, -0.85, 0.6);
    g.add(ball(kit, 1, -0.85, 0.6, s * (zi - 0.005), 0.4, 0.1, 0.04, kit.dark)); // intakes
    const y = yAt(spec, 2.03, 0.62), z = s * (zAt(spec, 2.03, y) - 0.1);
    g.add(ball(kit, 1, 2.03, y, z, 0.07, 0.04, 0.27, kit.housing));
    g.add(ball(kit, 1, 2.05, y, z, 0.05, 0.028, 0.23, kit.lens));
    const ring = mesh(kit, new THREE.TorusGeometry(0.12, 0.035, 8, 18), kit.tail, false);
    ring.position.set(-2.1, yAt(spec, -2.1, 0.68), s * 0.42);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    g.add(ball(kit, 1, -2.1, yAt(spec, -2.1, 0.68), s * 0.42, 0.03, 0.08, 0.08, kit.tail));
    g.add(box(kit, 0.9, 0.03, 0.14, 1.0, spline(spec.yt, 1.0) - 0.04, s * 0.36, kit.dark)); // hood vents
  }
  g.add(box(kit, 0.22, 0.035, 1.25, -1.9, spline(spec.yt, -1.9) + 0.005, 0, kit.paint, true));
  g.add(box(kit, 0.08, 0.09, 0.8, 2.07, yAt(spec, 2.07, 0.3), 0, kit.dark));
  addExhausts(kit, g, -2.1, 0.5, [-0.18, 0.18, -0.34, 0.34], 0.045);
  return finish(kit, g, spec, wheels);
}

/**
 * Racerz Jet: a white and red plane-car, 5 m long: a lofted fuselage with a red nose, a glass canopy over the pilot, wings that fold against
 * the body on the ground and swing out in the air, a V-tail and two engines with blue afterburners. The colours are fixed.
 */
function buildJet(kit: Kit): Parts {
  const g = new THREE.Group();
  const r = (x: number) => spline([[-2.5, 0.3], [-2.3, 0.42], [-1.6, 0.55], [-0.6, 0.6], [0.4, 0.58], [1.2, 0.46], [1.9, 0.26], [2.5, 0.03]], x);
  const yc = 0.86;
  const fus = loft(kit.d, {
    x0: -2.5, x1: 2.5, stations: 40, around: 26, hw: (x) => r(x) * 0.95, yb: (x) => yc - r(x) * 0.72, yt: (x) => yc + r(x) * 0.88, eTop: 2.2, eBot: 2.4, tumble: 0.05, caps: true,
    group: (x) => (x > 2.0 ? 1 : 0),
  });
  g.add(mesh(kit, fus, [kit.paint, kit.accent]));
  // The canopy: a glass bubble from behind the nose to over the pilot.
  const canopy = loft(kit.d, {
    x0: -0.1, x1: 1.55, stations: 20, around: 22, hw: (x) => spline([[-0.1, 0.3], [0.4, 0.4], [1.0, 0.34], [1.55, 0.08]], x),
    yb: (x) => yc + r(x) * 0.6, yt: (x) => yc + r(x) * 0.88 + spline([[-0.1, 0.03], [0.4, 0.34], [1.0, 0.3], [1.55, 0.03]], x), eTop: 2.2, eBot: 4, tumble: 0.15, caps: true,
  });
  g.add(mesh(kit, canopy, kit.glass, false));
  interior(kit, g, 0.5, 1.0, { seatX: 0.35, dashX: 1.1, hw: 0.45 });
  // Dorsal stripe and air intakes.
  g.add(box(kit, 1.5, 0.02, 0.12, -1.2, yc + r(-1.2) * 0.88 + 0.005, 0, kit.accent));
  for (const s of [-1, 1]) g.add(box(kit, 0.7, 0.22, 0.12, 0.2, 0.78, s * 0.56, kit.dark));
  // Wings: a swept, thin airfoil each, hinged at the fuselage.
  const wingShape = new THREE.Shape();
  [[0.35, 0], [-1.7, 0], [-2.3, 3.4], [-1.3, 3.4]].forEach(([x, z], i) => (i ? wingShape.lineTo(x, z) : wingShape.moveTo(x, z)));
  wingShape.closePath();
  const wingGeo = kit.d.add(new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 1 }));
  wingGeo.rotateX(Math.PI / 2);
  const tipGeo = kit.d.add(new THREE.BoxGeometry(1.1, 0.16, 0.34));
  const wings: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(-0.1, 0.86, s * 0.5);
    const w = new THREE.Mesh(wingGeo, kit.paint);
    w.castShadow = true;
    const tip = new THREE.Mesh(tipGeo, kit.accent);
    tip.position.set(-1.8, 0.0, 3.25);
    w.add(tip);
    if (s < 0) w.scale.z = -1;
    pivot.add(w);
    g.add(pivot);
    wings.push(pivot);
  }
  // V-tail, in red.
  const finShape = new THREE.Shape();
  [[-1.55, 0], [-2.5, 0], [-2.42, 1.0], [-1.95, 1.05]].forEach(([x, y], i) => (i ? finShape.lineTo(x, y) : finShape.moveTo(x, y)));
  finShape.closePath();
  const finGeo = kit.d.add(new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02, bevelSegments: 1 }));
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, kit.accent);
    fin.position.set(0, 1.15, s * 0.25);
    fin.rotation.x = s * 0.42;
    fin.castShadow = true;
    g.add(fin);
  }
  // Two engines: dark nozzles with a glowing blue core; their flames show while it climbs.
  const jetFlames: THREE.Group[] = [];
  const coreMat = kit.d.add(new THREE.MeshBasicMaterial({ color: "#7fd0ff", fog: false }));
  for (const s of [-1, 1]) {
    g.add(cylX(kit, 0.27, 0.9, -2.3, 0.7, s * 0.34, kit.housing));
    const core = mesh(kit, new THREE.CircleGeometry(0.22, 16), coreMat, false);
    core.position.set(-2.76, 0.7, s * 0.34);
    core.rotation.y = -Math.PI / 2;
    g.add(core);
    const fl = flameGroup(kit, -2.78, 0.7, s * 0.34, "#59b8ff", "#e6f6ff", 3.4, 0.26);
    g.add(fl);
    jetFlames.push(fl);
  }
  for (const sd of [-1, 1]) g.add(ball(kit, 1, 2.05, 0.78, sd * 0.1, 0.05, 0.03, 0.08, kit.lens));
  g.add(box(kit, 0.04, 0.1, 0.5, -2.52, 0.6, 0, kit.tail));
  const wheels = addWheels(kit, g, { xf: 1.45, xr: -1.5, r: 0.32, w: 0.24, z: 0.62, spokes: 5, rim: "#c8ccd2", caliper: "#d63a2f" });
  const flame = flameGroup(kit, -2.95, 0.7);
  g.add(flame);
  return { group: g, wheels, wheelR: 0.32, rear: -2.95, flame, tail: kit.tail, wings, jetFlames, engineY: 0.7 };
}

const BUILDERS: Record<ModelId, (kit: Kit) => Parts> = { gt: buildGT, mx5: buildMX5, p911: buildP911, aventador: buildAventador, f8: buildF8, chiron: buildChiron, jet: buildJet };

/** One car in the scene. `update` places it from the game's numbers; it owns nothing the game reads. */
export class Car3D {
  readonly group: THREE.Group;
  readonly model: ModelId;
  readonly id: number;
  private parts: Parts;
  private uniforms: PaintUniforms;
  private spin = 0;
  private lastHeading = 0;
  private yawRate = 0;
  private lastAlt = 0;
  private climb = 0;
  private lastSpeed = 0;
  private brake = 0;

  constructor(d: Disposer, view: CarView, env: THREE.Texture | null) {
    this.model = view.model;
    this.id = view.id;
    const wheel = view.model === "jet" ? undefined : view.model === "aventador" ? AVENTADOR_WHEEL : view.model === "chiron" ? CHIRON_WHEEL : SPECS[view.model].wheel;
    const { kit, uniforms } = makeKit(d, view.skin, env, wheel);
    this.parts = BUILDERS[view.model](kit);
    this.uniforms = uniforms;
    this.group = this.parts.group;
    this.lastHeading = view.heading;
    this.lastAlt = view.alt;
    this.lastSpeed = view.speed;
  }

  /** World (x, y in game units, altitude in m) → scene; the car's attitude follows the game's heading, speed and flight. */
  update(v: CarView, dt: number, time: number) {
    const g = this.group, p = this.parts;
    g.position.set(v.x * K, v.alt, v.y * K);
    let accel = 0;
    // Yaw rate → a little body roll into the turn and the steered front wheels; climb rate → pitch for the Jet; deceleration → brake lights.
    if (dt > 0) {
      let dh = v.heading - this.lastHeading;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      this.yawRate += (dh / dt - this.yawRate) * Math.min(1, dt * 8);
      this.climb += ((v.alt - this.lastAlt) / dt - this.climb) * Math.min(1, dt * 6);
      accel = (v.speed - this.lastSpeed) / dt;
    }
    this.lastHeading = v.heading;
    this.lastAlt = v.alt;
    this.lastSpeed = v.speed;
    this.brake += ((accel < -250 && v.speed > 30 ? 1 : 0) - this.brake) * Math.min(1, dt * 14);
    p.tail.emissiveIntensity = v.destroyed >= 0 ? 0 : 0.9 + this.brake * 2.6;
    const speedK = Math.min(1, Math.abs(v.speed) / 500);
    const roll = clamp(this.yawRate * speedK * 0.06, -0.1, 0.1);
    const pitch = this.model === "jet" ? clamp(this.climb * 0.0035, -0.25, 0.3) : clamp(accel * 0.00012, -0.03, 0.03);
    g.rotation.set(roll, -v.heading, pitch, "YXZ");
    // A car that blew up stays as a charred wreck, thrown askew by the blast, which sinks out of sight in its last second.
    g.visible = v.wreck > 0.001;
    if (v.destroyed >= 0) {
      const settle = Math.min(1, v.destroyed / 0.25);
      g.rotation.set(roll + 0.2 * settle, -v.heading, pitch - 0.09 * settle, "YXZ");
      g.position.y = v.alt - 1.4 * (1 - v.wreck);
    }
    // Wheels turn with the road (not in the air) and the front pair steers with the car.
    if (dt > 0 && v.alt < 5) this.spin -= (v.speed * K * dt) / p.wheelR;
    const steer = clamp(this.yawRate * 0.08 * (v.speed < 0 ? -1 : 1), -0.45, 0.45);
    for (const w of p.wheels) {
      w.spin.rotation.z = this.spin;
      if (w.front) w.pivot.rotation.y = -steer;
    }
    // Turbo flame: a flickering cone out of the back.
    p.flame.visible = v.boosting && v.destroyed < 0;
    if (p.flame.visible) {
      const f = 0.85 + 0.3 * Math.sin(time * 55 + v.id) + 0.1 * Math.sin(time * 91);
      p.flame.scale.set(f, 1 + 0.2 * Math.sin(time * 40), 1 + 0.2 * Math.sin(time * 40));
    }
    // The Jet: wings swing out (and fill out), engine flames while it climbs.
    if (p.wings) {
      const w = clamp(v.wing, 0, 1);
      p.wings.forEach((pw, i) => {
        const s = i === 0 ? -1 : 1;
        pw.rotation.y = s * lerp(-1.25, 0, w);
        pw.scale.z = lerp(0.22, 1, w);
      });
      p.jetFlames?.forEach((f) => {
        f.visible = v.flame > 0.01;
        if (f.visible) f.scale.set((0.4 + v.flame * 0.8) * (0.9 + 0.2 * Math.sin(time * 70)), 0.8, 0.8);
      });
    }
    this.uniforms.uDamage.value = 1 - v.health >= 0.75 ? 1 : (1 - v.health) / 0.75;
  }

  /** Spot for the engine's smoke and flames, in scene metres. */
  engineSpot(v: CarView, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(v.heading), s = Math.sin(v.heading), back = this.parts.rear * 0.5;
    return out.set(v.x * K + c * back, v.alt + this.parts.engineY, v.y * K + s * back);
  }
}
