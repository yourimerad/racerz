import { type Ring, loft, polyLoft, spline } from "./carbody";
import {
  type Kit, type Parts, type Spec, type Surface, addExhausts, addWheels, ball, box, decalMaterial, faceDecal, flameGroup, hexGrille, interior, mesh, planSlab, quadMap, ribbonMap,
  sideDecal, topDecal, wheelArches, wheelWells,
} from "./carkit";
import { THREE } from "./core";

// The Bugatti La Voiture Noire ("the black car"): the one-off hypercar built on the Chiron, drawn here at 4.5 m long, 2.04 m wide and 1.21 m
// high, all black (exposed carbon under a deep clear coat). The body is sculpted section by section (a smooth polygonal loft with the sill
// tucked, the haunches wide, the shoulder rolling into a narrow deck) under a long dark glass greenhouse whose roof runs on in one line into
// the tail. What makes it itself, and what is modelled here:
//   front: the horseshoe grille in its chrome frame with the red macaron, the two low air intakes, four slim LED bars in each headlight, the
//          hood's creases, the gills behind the front wheels, a short carbon splitter;
//   sides: the "C" line round the big side intake behind the door (louvred), the door's cut lines and its recessed handle, a chrome beltline
//          round the glass, black sills, mirrors on short stalks;
//   roof and tail: the dorsal fin down the middle of the roof and the tail (the Type 57 Atlantic's spine), NO rear wing at all, one light band
//          across the whole tail with the BUGATTI badge above its middle, a recessed carbon diffuser with its fins and, in it, the cluster of
//          six big exhaust tips (two rows of three);
//   wheels: dark ten-spoke wheels with red calipers, wider tyres at the back.

export const WHEEL: Spec["wheel"] = { xf: 1.36, xr: -1.35, r: 0.35, w: 0.29, z: 0.84, spokes: 10, rim: "#17181c", caliper: "#d8261c", rear: { r: 0.375, w: 0.35, z: 0.855 } };

// Body curves, along x (nose at +x): the underside, the half width at the widest point of a section, the height of the deck on the centre line.
const YB: [number, number][] = [[-2.3, 0.4], [-2.0, 0.26], [-1.3, 0.2], [1.4, 0.2], [1.95, 0.22], [2.2, 0.28]];
const HW: [number, number][] = [[-2.3, 0.7], [-2.15, 0.9], [-1.8, 1.02], [-1.4, 1.04], [-0.9, 1.01], [-0.2, 0.97], [0.5, 0.97], [1.0, 0.98], [1.4, 0.99], [1.85, 0.9], [2.2, 0.66]];
const YT: [number, number][] = [[-2.3, 0.8], [-2.1, 0.94], [-1.7, 1.04], [-1.1, 1.08], [-0.3, 1.04], [0.5, 0.94], [1.0, 0.82], [1.6, 0.7], [2.0, 0.62], [2.2, 0.54]];
const ROOF: [number, number][] = [[-1.7, 1.08], [-1.3, 1.16], [-0.7, 1.21], [-0.15, 1.21], [0.35, 1.13], [0.65, 1.0], [0.88, 0.86]];

export const SPEC: Spec = {
  x0: -2.3, x1: 2.2, eTop: 3.0, eBot: 7, tumble: 0.1, hw: HW, yb: YB, yt: YT,
  cabin: { x0: -1.7, x1: 0.88, base: 0.78, tumble: 0.32, roof: ROOF, side: [-1.15, 0.5], ws: 0.32, rw: -2, pillars: [[-1.7, -1.15]] },
  wheel: WHEEL,
};
const X0 = SPEC.x0, X1 = SPEC.x1, GAP = 0.07;
const yb = (x: number) => spline(YB, x), hw = (x: number) => spline(HW, x), yt = (x: number) => spline(YT, x);

/** How far (m) the lower flank is carved in at x: the scoop of the side intake behind the door. */
const carve = (x: number) => 0.05 * Math.exp(-(((x + 0.65) / 0.4) ** 2));

/** The section at x, right half from the bottom centre up and over to the top centre: belly, sill, flank (widest low), shoulder, deck edge, deck. */
function ring(x: number): Ring {
  const y0 = yb(x), top = yt(x), H = top - y0, w = hw(x), c = carve(x);
  return [
    [0, y0], [w * 0.5, y0], [w * 0.86, y0 + 0.035], [w * 0.975 - c * 0.6, y0 + 0.17 * H], [w - c, y0 + 0.4 * H], [w * 0.985 - c * 0.5, y0 + 0.62 * H],
    [w * 0.93, y0 + 0.8 * H], [w * 0.78, y0 + 0.93 * H], [w * 0.45, y0 + 0.985 * H], [0, top],
  ];
}
const DECK_EDGE = 7;

/** The skin of the body, for the patches laid on it (the same sections as `ring`). */
const SURFACE: Surface = {
  x0: X0, x1: X1,
  zAt: (x, y) => {
    const r = ring(x);
    for (let i = 1; i <= DECK_EDGE; i++) if (y <= r[i][1] && r[i][1] > r[i - 1][1] + 1e-9) return r[i - 1][0] + ((r[i][0] - r[i - 1][0]) * (y - r[i - 1][1])) / (r[i][1] - r[i - 1][1]);
    return r[DECK_EDGE][0];
  },
  topAt: (x, z) => {
    const r = ring(x), az = Math.abs(z);
    for (let i = DECK_EDGE; i < r.length - 1; i++) if (az >= r[i + 1][0]) return r[i][1] + ((r[i + 1][1] - r[i][1]) * (r[i][0] - az)) / (r[i][0] - r[i + 1][0] || 1);
    return r[r.length - 1][1];
  },
};

/** The horseshoe: wider at the top than at the bottom, with rounded shoulders. `map(u, v)` → (z, y) on the nose. */
const horseshoe = (w0: number, w1: number, y0: number, y1: number, shoulder = 0.05) => (u: number, v: number): [number, number] => {
  const t = 2 * u - 1, w = w0 + (w1 - w0) * v, top = y1 - shoulder * Math.pow(Math.abs(t), 3);
  return [(t * w) / 2, y0 + v * (top - y0)];
};

/** A height on the flank at x, as a share of the section (0 underside .. 1 deck). */
const at = (x: number, f: number) => yb(x) + f * (yt(x) - yb(x));

export function buildVoitureNoire(kit: Kit): Parts {
  const g = new THREE.Group(), d = kit.d, cabin = SPEC.cabin!;

  // ---- the body, section by section ----
  const xs: number[] = [];
  for (let x = X0; x < X1 - 1e-6; x += 0.05) xs.push(x);
  xs.push(X1);
  const body = new THREE.Mesh(polyLoft(d, { xs, ring, caps: true, crease: 1.05, arches: wheelArches(WHEEL, GAP) }), kit.paint);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  wheelWells(kit, g, WHEEL, GAP, (x) => hw(x) * 0.985);

  // ---- the greenhouse: dark glass wrapping from the windscreen to the tail, thin painted pillars ----
  const roof = (x: number) => spline(cabin.roof, x);
  const gh = loft(d, {
    x0: cabin.x0, x1: cabin.x1, stations: 36, around: 26, hw: () => cabin.base, yb: (x) => yt(x) - 0.05, yt: roof, eTop: 2.3, eBot: 6, tumble: cabin.tumble, caps: true,
    group: (x, j, m) => {
      const f = j / m;
      if (f >= 0.5) return 0;
      const top = f > 0.17 && f < 0.33;
      if (cabin.pillars.some(([a, b]) => x >= a && x <= b)) return 0;
      if (top) return x >= cabin.ws || x <= cabin.rw ? 1 : 0;
      return x >= cabin.side[0] && x <= cabin.side[1] ? 1 : 0;
    },
  });
  const ghMesh = new THREE.Mesh(gh, [kit.paint, kit.glass]);
  ghMesh.castShadow = true;
  g.add(ghMesh);
  const wheels = addWheels(kit, g, WHEEL);

  const grille = hexGrille(d, 9);
  const dark = decalMaterial(kit, { color: "#050607", roughness: 0.9 });
  const mesh2 = decalMaterial(kit, { color: "#ffffff", roughness: 0.55, metalness: 0.5, ...(grille ? { map: grille } : { color: "#15171b" }) });
  const chrome = decalMaterial(kit, { color: "#d8dde4", roughness: 0.15, metalness: 1, envMap: kit.env, envMapIntensity: 1.2 });
  const accent = decalMaterial(kit, { color: kit.skin.accent, roughness: 0.3, metalness: 0.45, envMap: kit.env, envMapIntensity: 1.1 });
  const seam = decalMaterial(kit, { color: "#010101", roughness: 1 });
  const macaron = decalMaterial(kit, { color: "#c4121c", roughness: 0.3, metalness: 0.4 });
  const lamp = decalMaterial(kit, { color: "#06090d", roughness: 0.08, metalness: 0.7, envMap: kit.env, envMapIntensity: 1.6 });
  const led = decalMaterial(kit, { color: "#eaf3ff", emissive: "#cfe4ff", emissiveIntensity: 2.4, roughness: 0.3 });
  const tail = decalMaterial(kit, { color: "#5a0610", emissive: "#ff1a26", emissiveIntensity: 0.9, roughness: 0.3 });

  // ---- the cabin: seats and driver behind the glass, mirrors on short stalks ----
  interior(kit, g, -0.25, 0.86, { seatX: -0.45, dashX: 0.62, hw: 0.76, head: 0.22 });
  for (const s of [-1, 1]) { // the mirrors, on short stalks
    g.add(box(kit, 0.05, 0.035, 0.14, 0.6, 0.97, s * 0.95, kit.paint));
    g.add(ball(kit, 0.085, 0.57, 1.0, s * 1.02, 0.65, 0.55, 1.1, kit.paint, true));
  }
  g.add(box(kit, 2.8, 0.05, 1.2, 0, 0.22, 0, kit.dark)); // the underbody

  // ---- the dorsal fin: a thin ridge from the windscreen header down the middle of the roof and the tail, rising toward the back ----
  const base = (x: number) => (x >= cabin.x0 ? roof(x) : yt(x));
  const fin = new THREE.Shape(), xsf: number[] = [];
  for (let x = 0.3; x >= -2.24; x -= 0.07) xsf.push(x);
  const high = (x: number) => {
    const t = Math.max(0, Math.min(1, (0.3 - x) / 2.55));
    return 0.008 + 0.1 * Math.pow(t, 1.2) * (1 - Math.pow(t, 10));
  };
  fin.moveTo(xsf[0], base(xsf[0]) - 0.03);
  for (const x of xsf) fin.lineTo(x, base(x) + high(x));
  fin.lineTo(-2.27, yt(-2.27) - 0.02);
  fin.lineTo(-2.27, yt(-2.27) - 0.05);
  for (let i = xsf.length - 1; i >= 0; i--) fin.lineTo(xsf[i], base(xsf[i]) - 0.03);
  const finGeo = d.add(new THREE.ExtrudeGeometry(fin, { depth: 0.04, bevelEnabled: false }));
  finGeo.translate(0, 0, -0.02);
  const finMesh = new THREE.Mesh(finGeo, kit.paint);
  finMesh.castShadow = true;
  g.add(finMesh);

  // ---- the flanks: beltline, door, the C line round the louvred side intake, the sills, the gills ahead of the door ----
  const line = (pts: [number, number][], w: number, mat: THREE.Material, lift = 0.006) => sideDecal(kit, g, SURFACE, mat, ribbonMap(pts, w), { nu: pts.length * 6, nv: 1, lift });
  line([[-1.2, at(-1.2, 0.9)], [-0.2, at(-0.2, 0.9)], [0.5, at(0.5, 0.9)], [0.8, at(0.8, 0.9)]], 0.014, chrome, 0.008); // the chrome beltline round the glass
  line([[0.62, at(0.62, 0.15)], [0.68, at(0.68, 0.6)], [0.52, at(0.52, 0.88)]], 0.011, seam); // the door's front edge
  line([[-0.36, at(-0.36, 0.15)], [-0.37, at(-0.37, 0.85)]], 0.01, seam); // its rear edge
  line([[0.0, at(0.0, 0.78)], [0.3, at(0.3, 0.78)]], 0.022, seam); // the recessed handle
  line([[-1.55, at(-1.55, 0.86)], [-1.0, at(-1.0, 0.85)], [-0.55, at(-0.55, 0.8)], [-0.39, at(-0.39, 0.64)], [-0.37, at(-0.37, 0.46)], [-0.5, at(-0.5, 0.3)], [-0.84, at(-0.84, 0.24)]], 0.085, accent, 0.009); // the C
  sideDecal(kit, g, SURFACE, dark, quadMap([-0.83, at(-0.83, 0.34)], [-0.46, at(-0.46, 0.34)], [-0.48, at(-0.48, 0.74)], [-0.87, at(-0.87, 0.72)]), { nu: 8, nv: 8, lift: 0.006 }); // the intake inside it
  for (let i = 0; i < 6; i++) { // its louvres
    const x = -0.52 - i * 0.065;
    line([[x, at(x, 0.36)], [x - 0.012, at(x - 0.012, 0.7)]], 0.014, accent, 0.008);
  }
  sideDecal(kit, g, SURFACE, accent, quadMap([-0.84, at(-0.84, 0.0)], [0.9, at(0.9, 0.0)], [0.9, at(0.9, 0.17)], [-0.84, at(-0.84, 0.17)]), { nu: 14, nv: 1, lift: 0.01 }); // the sills
  sideDecal(kit, g, SURFACE, dark, quadMap([0.62, at(0.62, 0.34)], [0.9, at(0.9, 0.34)], [0.9, at(0.9, 0.62)], [0.62, at(0.62, 0.62)]), { nu: 4, nv: 4, lift: 0.006 }); // the gills' opening
  for (let i = 0; i < 4; i++) line([[0.64, at(0.64, 0.4 + i * 0.07)], [0.88, at(0.88, 0.4 + i * 0.07)]], 0.012, accent, 0.008);

  // ---- the nose: bonnet creases and vents, the headlights' four LED bars, the horseshoe, the lower intakes, a short splitter ----
  for (const s of [-1, 1]) {
    topDecal(kit, g, SURFACE, seam, ribbonMap([[2.15, s * 0.4], [1.5, s * 0.55], [0.9, s * 0.62]], 0.01), { nu: 24, nv: 1, lift: 0.005 });
    topDecal(kit, g, SURFACE, seam, ribbonMap([[2.1, s * 0.12], [1.2, s * 0.14], [0.9, s * 0.14]], 0.008), { nu: 20, nv: 1, lift: 0.005 });
    topDecal(kit, g, SURFACE, dark, quadMap([1.1, s * 0.3], [1.45, s * 0.3], [1.45, s * 0.46], [1.1, s * 0.46]), { nu: 4, nv: 2, lift: 0.006 });
    topDecal(kit, g, SURFACE, lamp, quadMap([1.96, s * 0.33], [2.18, s * 0.38], [2.18, s * 0.63], [1.93, s * 0.68]), { nu: 6, nv: 3, lift: 0.006 });
    for (let i = 0; i < 4; i++) topDecal(kit, g, SURFACE, led, ribbonMap([[2.15 - i * 0.04, s * (0.4 + i * 0.015)], [2.0 - i * 0.04, s * (0.62 + i * 0.015)]], 0.012), { nu: 6, nv: 1, lift: 0.009 });
  }
  faceDecal(kit, g, SURFACE, chrome, 1, horseshoe(0.4, 0.6, 0.285, 0.52), { nu: 12, nv: 6, lift: 0.003 }); // the frame
  faceDecal(kit, g, SURFACE, mesh2, 1, horseshoe(0.34, 0.53, 0.305, 0.5, 0.045), { nu: 12, nv: 6, lift: 0.006, uv: [4, 3] }); // the mesh
  g.add(ball(kit, 0.05, X1 + 0.012, 0.485, 0, 0.25, 1, 1.5, macaron)); // the red macaron
  for (const s of [-1, 1]) faceDecal(kit, g, SURFACE, mesh2, 1, quadMap([s * 0.47, 0.3], [s * 0.68, 0.3], [s * 0.68, 0.44], [s * 0.47, 0.44]), { nu: 4, nv: 3, lift: 0.005, uv: [2, 2] });
  g.add(planSlab(kit, [[2.04, 0.66], [2.27, 0.56], [2.27, -0.56], [2.04, -0.66]], 0.2, 0.022, kit.accent)); // no front plate over the horseshoe

  // ---- the tail: one light band right across with the badge above its middle, a carbon diffuser with its fins, the six exhaust tips ----
  faceDecal(kit, g, SURFACE, tail, -1, quadMap([-0.58, 0.72], [0.58, 0.72], [0.58, 0.77], [-0.58, 0.77]), { nu: 12, nv: 1, lift: 0.005 });
  g.add(ball(kit, 0.04, X0 - 0.012, 0.8, 0, 0.3, 0.6, 1.6, chrome)); // the badge
  faceDecal(kit, g, SURFACE, dark, -1, quadMap([-0.56, 0.42], [0.56, 0.42], [0.56, 0.69], [-0.56, 0.69]), { nu: 6, nv: 3, lift: 0.004 }); // the recess round the exhausts
  addExhausts(kit, g, -2.36, 0.6, [-0.2, 0, 0.2], 0.068); // the six tips: two rows of three
  addExhausts(kit, g, -2.36, 0.47, [-0.2, 0, 0.2], 0.068);
  const plate = mesh(kit, new THREE.PlaneGeometry(0.52, 0.13), kit.plate, false); // the number plate, low in the diffuser
  plate.position.set(X0 - 0.014, 0.35, 0);
  plate.rotation.y = -Math.PI / 2;
  g.add(plate);
  g.add(planSlab(kit, [[-1.95, 0.56], [-2.34, 0.62], [-2.34, -0.62], [-1.95, -0.56]], 0.15, 0.025, kit.accent)); // the diffuser's tray
  for (let i = -3; i <= 3; i++) g.add(box(kit, 0.4, 0.1, 0.014, -2.22, 0.2, i * 0.15, kit.trim)); // and its fins

  const flame = flameGroup(kit, X0 - 0.05, 0.5);
  g.add(flame);
  return { group: g, wheels, wheelR: WHEEL.r, rear: X0, flame, tail, engineY: 0.8 };
}
