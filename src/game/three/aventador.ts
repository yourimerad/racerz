import { type Ring, polyLoft } from "./carbody";
import {
  type Kit, type Parts, type Spec, type Surface, addWheels, ball, box, decalMaterial, faceDecal, flameGroup, hexGrille, hexTube, mesh, planSlab, quadMap, ribbonMap,
  sideDecal, topDecal, wheelArches, wheelWells,
} from "./carkit";
import { THREE } from "./core";

// The Lamborghini Aventador SVJ Roadster, about 4.6 m long (0.94 of the real car) and drawn the way the real one is: a wedge of planes and sharp
// edges, very wide and very low, with the roof off. A faceted body (shoulder, sill and the hood's facets stay crisp), a raked windscreen in its
// frame, an open cockpit with its two bucket seats and the driver, the humps behind the headrests and the buttress fins along the engine cover,
// huge intakes behind the scissor doors, Y-shaped daytime lights and tail lights, honeycomb grilles, three hexagonal exhaust tips, a carbon
// splitter, diffuser and the SVJ's big rear wing, Y-spoke wheels (wider tyres at the back). Meant to be seen in matte black.

/** Piecewise-linear curve through [x, value] keys, flat beyond the ends. */
const lin = (keys: [number, number][]) => (x: number) => {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) return keys[i - 1][1] + ((keys[i][1] - keys[i - 1][1]) * (x - keys[i - 1][0])) / (keys[i][0] - keys[i - 1][0]);
  }
  return keys[keys.length - 1][1];
};

export const X0 = -2.34, X1 = 2.32;
/** Underside height, half width at the sill, half width and height at the shoulder (the beltline; the widest point). */
const yb = lin([[-2.34, 0.3], [-2.22, 0.18], [-2.0, 0.12], [2.0, 0.11], [2.32, 0.15]]);
const hs = lin([[-2.34, 0.6], [-2.0, 0.8], [-1.5, 0.9], [-0.8, 0.86], [0.6, 0.86], [1.28, 0.87], [1.9, 0.74], [2.32, 0.56]]);
const hsh = lin([[-2.34, 0.74], [-2.2, 0.9], [-1.9, 1.0], [-1.28, 1.02], [-0.6, 0.99], [0.2, 0.96], [1.28, 0.95], [1.7, 0.9], [2.0, 0.8], [2.32, 0.64]]);
const ysh = lin([[-2.34, 0.72], [-2.22, 0.84], [-1.9, 0.9], [-1.5, 0.91], [-1.0, 0.88], [-0.3, 0.83], [0.4, 0.78], [0.95, 0.76], [1.3, 0.74], [1.9, 0.58], [2.32, 0.45]]);
const CROWN = 0.02, DECK = 0.045, TUMBLE = 0.07;
/** How far the flank is carved in (m) at x, under the shoulder: the scoop behind the door and the waist at the door. */
const waist = lin([[-2.0, 0], [-1.6, 0.05], [-0.8, 0.09], [-0.3, 0.06], [0.4, 0.05], [1.0, 0.03], [1.5, 0]]);

/** One section of the body (right half, bottom centre → top centre): belly, sill, the flank in 6 steps, shoulder, deck edge, the deck in 5. */
function ring(x: number): Ring {
  const y0 = yb(x), s = hs(x), h = hsh(x), ys = ysh(x), hd = h - TUMBLE, yd = ys + DECK, ysill = y0 + 0.13;
  const r: Ring = [[0, y0], [s - 0.07, y0], [s, ysill]];
  const carve = waist(x);
  for (let i = 1; i <= 5; i++) r.push([s + ((h - s) * i) / 6 - carve * Math.sin((Math.PI * i) / 6), ysill + ((ys - ysill) * i) / 6]);
  r.push([h, ys], [hd, yd]);
  for (let i = 1; i <= 4; i++) r.push([hd * (1 - i / 5), yd + (CROWN * i) / 5]);
  r.push([0, yd + CROWN]);
  return r;
}
const DECK_EDGE = 9;

/** The body's skin, for the patches laid on it. */
const SURFACE: Surface = {
  x0: X0, x1: X1,
  zAt: (x, y) => {
    const r = ring(x);
    for (let i = 1; i <= DECK_EDGE; i++) {
      if (y <= r[i][1] && r[i][1] > r[i - 1][1] + 1e-9) return r[i - 1][0] + ((r[i][0] - r[i - 1][0]) * (y - r[i - 1][1])) / (r[i][1] - r[i - 1][1]);
    }
    return r[DECK_EDGE][0];
  },
  topAt: (x, z) => {
    const r = ring(x), az = Math.abs(z);
    for (let i = DECK_EDGE; i < r.length - 1; i++) {
      if (az >= r[i + 1][0]) return r[i][1] + ((r[i + 1][1] - r[i][1]) * (r[i][0] - az)) / (r[i][0] - r[i + 1][0] || 1);
    }
    return r[r.length - 1][1];
  },
};

export const WHEEL: Spec["wheel"] = {
  xf: 1.28, xr: -1.28, r: 0.33, w: 0.27, z: 0.81, spokes: 5, rim: "#1b1c20", caliper: "#d8261c", rear: { r: 0.35, w: 0.34, z: 0.82 }, style: "y",
};
const GAP = 0.035;
/** The open cockpit: between the windscreen's base and the bulkhead behind the seats; as wide as the deck's three inner strips. */
const CABIN: [number, number] = [-0.9, 0.98];
const FLOOR = 0.34;

/** A box between two points (for pillars, frames, fins). */
function bar(kit: Kit, a: [number, number, number], b: [number, number, number], w: number, h: number, mat: THREE.Material, shadow = false): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  const m = mesh(kit, new THREE.BoxGeometry(len, h, w), mat, shadow);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), vb.clone().sub(va).normalize());
  return m;
}

/** A flat quadrilateral (corners in order), for glass. */
function pane(kit: Kit, c: [number, number, number][], mat: THREE.Material): THREE.Mesh {
  const geo = kit.d.add(new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(c.flat()), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

export function buildAventador(kit: Kit): Parts {
  const g = new THREE.Group(), d = kit.d;
  const xs: number[] = [];
  for (let x = X0; x < X1 - 1e-6; x += 0.045) xs.push(x);
  xs.push(X1, ...CABIN);
  xs.sort((a, b) => a - b);
  // The body: the deck's three inner strips are left open between the windscreen and the headrests (the cockpit).
  g.add(mesh(kit, polyLoft(d, { xs, ring, caps: true, arches: wheelArches(WHEEL, GAP), group: (x, k) => (k >= 11 && k <= 13 && x > CABIN[0] && x < CABIN[1] ? -1 : 0) }), kit.paint));
  wheelWells(kit, g, WHEEL, GAP, (x) => hsh(x) - 0.01);
  const wheels = addWheels(kit, g, WHEEL);

  const grille = hexGrille(d, 9);
  const dark = decalMaterial(kit, { color: "#07080a", roughness: 0.9 });
  const mesh2 = decalMaterial(kit, { color: "#ffffff", roughness: 0.55, metalness: 0.5, ...(grille ? { map: grille } : { color: "#15171b" }) });
  const carbon = decalMaterial(kit, { color: "#15171b", roughness: 0.4, metalness: 0.4 });
  const lamp = decalMaterial(kit, { color: "#06090d", roughness: 0.08, metalness: 0.7, envMap: kit.env, envMapIntensity: 1.6 });
  const drl = decalMaterial(kit, { color: "#e8f2ff", emissive: "#cfe4ff", emissiveIntensity: 2.2, roughness: 0.3 });
  const tail = decalMaterial(kit, { color: "#5a0610", emissive: "#ff1a26", emissiveIntensity: 0.9, roughness: 0.3 });
  const seam = decalMaterial(kit, { color: "#040405", roughness: 1 });
  const tub = d.add(new THREE.MeshStandardMaterial({ color: "#0b0c0e", roughness: 0.95, side: THREE.BackSide }));
  const trim = kit.trim, ysd = (x: number) => ysh(x) + DECK;

  // ---- the cockpit: a tub under the opening, a dashboard and its hood, a tunnel, two bucket seats, a steering wheel and the driver ----
  const tubBox = mesh(kit, new THREE.BoxGeometry(CABIN[1] - CABIN[0], 0.5, 1.08), tub, false);
  tubBox.position.set((CABIN[0] + CABIN[1]) / 2, FLOOR + 0.25, 0);
  g.add(tubBox);
  g.add(box(kit, 1.5, 0.22, 0.2, 0.0, FLOOR + 0.12, 0, kit.interior)); // the tunnel
  g.add(box(kit, 0.34, 0.2, 1.06, 0.84, 0.62, 0, kit.interior)); // dashboard
  g.add(box(kit, 0.16, 0.08, 0.5, 0.74, 0.74, -0.27, kit.interior)); // instrument hood
  for (const s of [-1, 1]) {
    const z = s * 0.28;
    g.add(box(kit, 0.5, 0.1, 0.42, -0.25, 0.42, z, kit.cloth)); // cushion
    const back = box(kit, 0.1, 0.5, 0.42, -0.52, 0.64, z, kit.cloth);
    back.rotation.z = -0.22;
    g.add(back);
    g.add(box(kit, 0.1, 0.2, 0.2, -0.6, 0.93, z, kit.cloth)); // headrest
    g.add(box(kit, 0.46, 0.06, 0.04, -0.28, 0.5, z + 0.2, kit.interior)); // side bolsters
    g.add(box(kit, 0.46, 0.06, 0.04, -0.28, 0.5, z - 0.2, kit.interior));
  }
  const wheelRim = mesh(kit, new THREE.TorusGeometry(0.17, 0.02, 8, 20), trim, false);
  wheelRim.position.set(0.5, 0.82, -0.28);
  wheelRim.rotation.y = Math.PI / 2 - 0.1;
  wheelRim.rotation.x = 0.35;
  g.add(wheelRim);
  g.add(bar(kit, [0.5, 0.82, -0.28], [0.72, 0.7, -0.28], 0.03, 0.03, trim));
  // the driver (left seat): torso, helmet, visor, arms to the wheel
  g.add(box(kit, 0.22, 0.34, 0.36, -0.5, 0.72, -0.28, kit.dark));
  g.add(ball(kit, 0.125, -0.52, 0.99, -0.28, 1, 1.05, 1, kit.helmet));
  g.add(box(kit, 0.05, 0.07, 0.15, -0.42, 0.99, -0.28, kit.glass));
  for (const s of [-1, 1]) g.add(bar(kit, [-0.45, 0.8, -0.28 + s * 0.2], [0.46, 0.8, -0.28 + s * 0.16], 0.06, 0.06, kit.dark));

  // ---- the windscreen in its frame, the door glass, the mirrors ----
  const base = 0.99, top = 0.36, yBase = ysd(base) + 0.02, yTop = 1.06;
  g.add(pane(kit, [[base, yBase, -0.66], [base, yBase, 0.66], [top, yTop, 0.6], [top, yTop, -0.6]], kit.glass));
  g.add(bar(kit, [top, yTop, -0.6], [top, yTop, 0.6], 0.03, 0.035, trim)); // header
  for (const s of [-1, 1]) {
    g.add(bar(kit, [base, yBase, s * 0.67], [top, yTop, s * 0.61], 0.04, 0.04, trim)); // A pillars
    g.add(pane(kit, [[base, yBase, s * 0.7], [top, yTop - 0.02, s * 0.64], [0.1, 1.0, s * 0.66], [-0.5, ysd(-0.5) + 0.04, s * 0.72]], kit.glass)); // door glass
    g.add(bar(kit, [-0.5, ysd(-0.5) + 0.04, s * 0.72], [0.1, 1.0, s * 0.66], 0.03, 0.03, trim));
    g.add(bar(kit, [0.84, ysd(0.84) + 0.04, s * 0.82], [0.8, 0.95, s * 0.93], 0.03, 0.03, trim)); // mirror stalk
    g.add(ball(kit, 0.085, 0.77, 0.95, s * 0.97, 0.7, 0.55, 1.15, kit.paint, true));
  }

  // ---- the buttress fins along the engine cover ----
  const finShape = new THREE.Shape();
  [[-0.9, 0], [-1.12, 0.13], [-1.55, 0.14], [-2.0, 0.03], [-2.0, 0]].forEach(([a, b], i) => (i ? finShape.lineTo(a, b) : finShape.moveTo(a, b)));
  finShape.closePath();
  const finGeo = d.add(new THREE.ExtrudeGeometry(finShape, { depth: 0.04, bevelEnabled: false }));
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, kit.paint);
    fin.position.set(0, ysd(-1.5) - 0.02, s * 0.55 - 0.02);
    fin.castShadow = true;
    g.add(fin);
  }

  // ---- the flanks: scissor-door outline, handle, skirts, the big intakes behind the door ----
  const line = (pts: [number, number][], w: number, mat: THREE.Material, lift = 0.006) => sideDecal(kit, g, SURFACE, mat, ribbonMap(pts, w), { nu: pts.length * 6, nv: 1, lift });
  line([[0.66, 0.3], [0.96, ysd(0.96) - 0.03], [0.3, ysd(0.3) - 0.03], [-0.5, ysd(-0.5) - 0.03], [-0.62, 0.3], [0, 0.3], [0.66, 0.3]], 0.012, seam);
  line([[-0.12, ysd(0) - 0.1], [0.14, ysd(0.14) - 0.1]], 0.03, dark); // door handle slot
  sideDecal(kit, g, SURFACE, carbon, quadMap([-0.86, 0.17], [0.9, 0.17], [0.9, 0.27], [-0.86, 0.27]), { nu: 10, nv: 1, lift: 0.01 }); // skirts
  sideDecal(kit, g, SURFACE, mesh2, quadMap([-0.62, 0.4], [-1.02, 0.4], [-1.04, ysd(-1.0) - 0.06], [-0.52, ysd(-0.52) - 0.06]), { nu: 8, nv: 8, lift: 0.008, uv: [5, 5] });
  line([[-0.55, 0.64], [-1.03, 0.62]], 0.02, carbon);

  // ---- the nose: hood seams, the headlights with their Y, the central grille and the outer intakes, splitter and canards ----
  for (const s of [-1, 1]) {
    topDecal(kit, g, SURFACE, seam, ribbonMap([[2.2, s * 0.5], [1.6, s * 0.6], [1.0, s * 0.64]], 0.01), { nu: 24, nv: 1, lift: 0.005 });
    topDecal(kit, g, SURFACE, seam, ribbonMap([[2.12, s * 0.15], [1.4, s * 0.2], [1.02, s * 0.2]], 0.008), { nu: 24, nv: 1, lift: 0.005 });
    topDecal(kit, g, SURFACE, lamp, quadMap([2.04, s * 0.3], [2.28, s * 0.35], [2.28, s * 0.5], [1.98, s * 0.64]), { nu: 6, nv: 4, lift: 0.006 });
    topDecal(kit, g, SURFACE, drl, ribbonMap([[2.22, s * 0.44], [2.08, s * 0.5]], 0.02), { nu: 4, nv: 1, lift: 0.01 });
    topDecal(kit, g, SURFACE, drl, ribbonMap([[2.08, s * 0.5], [2.0, s * 0.6]], 0.014), { nu: 4, nv: 1, lift: 0.01 });
    topDecal(kit, g, SURFACE, drl, ribbonMap([[2.08, s * 0.5], [2.02, s * 0.38]], 0.014), { nu: 4, nv: 1, lift: 0.01 });
    topDecal(kit, g, SURFACE, mesh2, quadMap([0.62, s * 0.7], [0.92, s * 0.7], [0.92, s * 0.9], [0.62, s * 0.9]), { nu: 4, nv: 3, lift: 0.006, uv: [2, 2] }); // fender vents
  }
  faceDecal(kit, g, SURFACE, mesh2, 1, quadMap([-0.42, 0.2], [0.42, 0.2], [0.42, 0.4], [-0.42, 0.4]), { nu: 8, nv: 3, uv: [4, 2] });
  faceDecal(kit, g, SURFACE, dark, 1, quadMap([-0.58, 0.19], [-0.46, 0.19], [-0.46, 0.4], [-0.58, 0.38]), { nu: 2, nv: 2 });
  faceDecal(kit, g, SURFACE, dark, 1, quadMap([0.46, 0.19], [0.58, 0.19], [0.58, 0.38], [0.46, 0.4]), { nu: 2, nv: 2 });
  g.add(planSlab(kit, [[1.95, 0.88], [2.5, 0.72], [2.5, -0.72], [1.95, -0.88]], 0.07, 0.045, trim));
  for (const s of [-1, 1]) g.add(box(kit, 0.3, 0.1, 0.02, 2.16, 0.2, s * 0.86, trim));

  // ---- the back: the engine cover's louvres, the Y tail lights, the exhaust, the diffuser and the wing ----
  topDecal(kit, g, SURFACE, mesh2, quadMap([-1.2, -0.42], [-2.2, -0.4], [-2.2, 0.4], [-1.2, 0.42]), { nu: 10, nv: 10, lift: 0.006, uv: [6, 6] });
  for (const s of [-1, 1]) {
    const y0 = 0.62, junction: [number, number] = [s * 0.4, y0];
    for (const arm of [[s * 0.6, y0 + 0.09], [s * 0.57, y0 - 0.09], [s * 0.24, y0]] as [number, number][]) {
      faceDecal(kit, g, SURFACE, tail, -1, ribbonMap([junction, arm], 0.045), { nu: 4, nv: 1, lift: 0.006 });
    }
  }
  faceDecal(kit, g, SURFACE, mesh2, -1, quadMap([-0.5, 0.34], [0.5, 0.34], [0.5, 0.54], [-0.5, 0.54]), { nu: 6, nv: 3, uv: [4, 2], lift: 0.003 });
  for (const [z, y] of [[0, 0.5], [-0.17, 0.39], [0.17, 0.39]]) {
    g.add(hexTube(kit, 0.082, 0.16, -2.4, y, z, kit.chrome));
    g.add(hexTube(kit, 0.06, 0.18, -2.41, y, z, kit.dark));
  }
  g.add(planSlab(kit, [[-1.85, 0.56], [-2.44, 0.64], [-2.44, -0.64], [-1.85, -0.56]], 0.13, 0.04, trim));
  for (let i = -3; i <= 3; i++) g.add(box(kit, 0.5, 0.12, 0.014, -2.18, 0.2, i * 0.15, trim));

  // The wing: an airfoil of carbon between small end plates, on two pylons.
  const chord = 0.44, span = 1.84, wy = 1.1, wx = -2.2;
  const foil = new THREE.Shape();
  [[0.5, 0], [0.42, 0.045], [0.2, 0.075], [-0.1, 0.07], [-0.5, 0.03], [-0.5, 0.0], [-0.1, -0.01], [0.2, -0.014], [0.42, -0.01]].forEach(([a, b], i) => (i ? foil.lineTo(a * chord, b * chord) : foil.moveTo(a * chord, b * chord)));
  foil.closePath();
  const foilGeo = d.add(new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false }));
  foilGeo.translate(0, 0, -span / 2);
  const wing = new THREE.Mesh(foilGeo, trim);
  wing.position.set(wx, wy, 0);
  wing.rotation.z = -0.1;
  wing.castShadow = true;
  g.add(wing);
  for (const s of [-1, 1]) {
    const plate = new THREE.Shape();
    [[0.26, -0.05], [0.26, 0.07], [-0.26, 0.15], [-0.28, -0.05]].forEach(([a, b], i) => (i ? plate.lineTo(a, b) : plate.moveTo(a, b)));
    plate.closePath();
    const pm = new THREE.Mesh(d.add(new THREE.ExtrudeGeometry(plate, { depth: 0.02, bevelEnabled: false })), kit.paint);
    pm.position.set(wx, wy, s * (span / 2));
    pm.castShadow = true;
    g.add(pm);
    g.add(bar(kit, [wx + 0.2, ysd(-1.95) + 0.02, s * 0.46], [wx + 0.02, wy - 0.02, s * 0.46], 0.05, 0.07, trim, true));
  }

  // number plates, and the turbo flame out of the back
  const rearPlate = mesh(kit, new THREE.PlaneGeometry(0.52, 0.13), kit.plate, false);
  rearPlate.position.set(X0 - 0.012, 0.64, 0);
  rearPlate.rotation.y = -Math.PI / 2;
  g.add(rearPlate);
  const frontPlate = mesh(kit, new THREE.PlaneGeometry(0.52, 0.13), kit.plate, false);
  frontPlate.position.set(X1 + 0.012, 0.3, 0);
  frontPlate.rotation.y = Math.PI / 2;
  g.add(frontPlate);
  const flame = flameGroup(kit, X0 - 0.1, 0.5);
  g.add(flame);
  return { group: g, wheels, wheelR: WHEEL.r, rear: X0, flame, tail, engineY: 0.8 };
}
