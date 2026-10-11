import {
  type Kit, type Parts, type Spec, addExhausts, ball, box, decalMaterial, faceDecal, flameGroup, furniture, headlight, hexGrille, interior, planSlab, quadMap, ribbonMap, shell,
  sideDecal, topDecal,
} from "./carkit";
import { spline } from "./carbody";
import { THREE } from "./core";

// The Bugatti La Voiture Noire ("the black car"): the one-off hypercar built on the Chiron, drawn here at 4.5 m long, very wide, low and
// all black. What makes it itself: a long fastback tail that runs on in one line from the roof, a thin dorsal fin down the middle of the
// roof and the tail (the Type 57 Atlantic's spine), no wing at all, the horseshoe grille in its chrome frame with the red macaron, slim
// headlights, the "C" line of each flank round the side intake (a shade lighter than the paint: the skin's accent colour), one full-width
// light band across the tail, and the cluster of six big exhaust tips under it, over a carbon diffuser. Dark wheels with red calipers,
// thicker tyres at the back.

export const WHEEL: Spec["wheel"] = { xf: 1.36, xr: -1.35, r: 0.35, w: 0.29, z: 0.84, spokes: 10, rim: "#1d1e22", caliper: "#d8261c", rear: { r: 0.375, w: 0.35, z: 0.855 } };

export const SPEC: Spec = {
  x0: -2.3, x1: 2.2, eTop: 3.0, eBot: 7, tumble: 0.1,
  hw: [[-2.3, 0.8], [-2.1, 0.97], [-1.5, 1.04], [-0.7, 1.01], [0.2, 0.98], [1.0, 0.98], [1.45, 0.99], [1.85, 0.92], [2.2, 0.74]],
  yb: [[-2.3, 0.4], [-1.95, 0.28], [-1.3, 0.22], [1.4, 0.22], [1.95, 0.24], [2.2, 0.27]],
  yt: [[-2.3, 0.84], [-2.1, 0.96], [-1.7, 1.04], [-1.1, 1.08], [-0.3, 1.04], [0.5, 0.94], [1.0, 0.82], [1.6, 0.7], [2.0, 0.63], [2.2, 0.56]],
  cabin: {
    x0: -1.7, x1: 0.88, base: 0.78, tumble: 0.32,
    roof: [[-1.7, 1.08], [-1.3, 1.16], [-0.7, 1.21], [-0.15, 1.21], [0.35, 1.13], [0.65, 1.0], [0.88, 0.86]],
    side: [-1.15, 0.5], ws: 0.32, rw: -2, pillars: [[-1.7, -1.15]],
  },
  wheel: WHEEL,
};

/** The horseshoe: wider at the top than at the bottom, with rounded shoulders. `map(u, v)` → (z, y) on the nose. */
const horseshoe = (w0: number, w1: number, y0: number, y1: number, shoulder = 0.05) => (u: number, v: number): [number, number] => {
  const t = 2 * u - 1, w = w0 + (w1 - w0) * v, top = y1 - shoulder * Math.pow(Math.abs(t), 3);
  return [(t * w) / 2, y0 + v * (top - y0)];
};

export function buildVoitureNoire(kit: Kit): Parts {
  const g = new THREE.Group(), d = kit.d, spec = SPEC, cabin = spec.cabin!;
  const wheels = shell(kit, g, spec);

  const grille = hexGrille(d, 9);
  const dark = decalMaterial(kit, { color: "#07080a", roughness: 0.9 });
  const mesh2 = decalMaterial(kit, { color: "#ffffff", roughness: 0.55, metalness: 0.5, ...(grille ? { map: grille } : { color: "#15171b" }) });
  const chrome = decalMaterial(kit, { color: "#d8dde4", roughness: 0.15, metalness: 1, envMap: kit.env, envMapIntensity: 1.2 });
  const accent = decalMaterial(kit, { color: kit.skin.accent, roughness: 0.3, metalness: 0.45, envMap: kit.env, envMapIntensity: 1.1 });
  const seam = decalMaterial(kit, { color: "#020203", roughness: 1 });
  const macaron = decalMaterial(kit, { color: "#c4121c", roughness: 0.3, metalness: 0.4 });
  const tail = decalMaterial(kit, { color: "#5a0610", emissive: "#ff1a26", emissiveIntensity: 0.9, roughness: 0.3 });

  // ---- the cabin: seats and driver behind the glass, mirrors on stalks ----
  interior(kit, g, -0.25, 0.86, { seatX: -0.45, dashX: 0.62, hw: 0.76, head: 0.22 });
  furniture(kit, g, spec, 0.6, 1.0, 1.02);

  // ---- the dorsal fin: a thin ridge down the middle of the roof and the tail, rising toward the back and ending in a point ----
  const base = (x: number) => (x >= cabin.x0 ? spline(cabin.roof, x) : spline(spec.yt, x));
  const fin = new THREE.Shape(), xs: number[] = [];
  for (let x = -0.25; x >= -2.24; x -= 0.07) xs.push(x);
  const high = (x: number) => {
    const t = Math.max(0, Math.min(1, (-0.25 - x) / 2.05));
    return 0.01 + 0.1 * Math.pow(t, 1.2) * (1 - Math.pow(t, 10));
  };
  fin.moveTo(xs[0], base(xs[0]) - 0.03);
  for (const x of xs) fin.lineTo(x, base(x) + high(x));
  fin.lineTo(-2.27, spline(spec.yt, -2.27) - 0.02);
  fin.lineTo(-2.27, spline(spec.yt, -2.27) - 0.05);
  for (let i = xs.length - 1; i >= 0; i--) fin.lineTo(xs[i], base(xs[i]) - 0.03);
  const finGeo = d.add(new THREE.ExtrudeGeometry(fin, { depth: 0.045, bevelEnabled: false }));
  finGeo.translate(0, 0, -0.0225);
  const finMesh = new THREE.Mesh(finGeo, kit.paint);
  finMesh.castShadow = true;
  g.add(finMesh);

  // ---- the flanks: the C line, the intake it wraps, the carbon sills, the door ----
  const line = (pts: [number, number][], w: number, mat: THREE.Material, lift = 0.006) => sideDecal(kit, g, spec, mat, ribbonMap(pts, w), { nu: pts.length * 6, nv: 1, lift });
  line([[-1.55, 0.96], [-1.0, 0.95], [-0.55, 0.9], [-0.39, 0.74], [-0.37, 0.56], [-0.5, 0.41], [-0.84, 0.34]], 0.085, accent, 0.009); // the C
  sideDecal(kit, g, spec, mesh2, quadMap([-0.82, 0.46], [-0.46, 0.46], [-0.48, 0.82], [-0.86, 0.8]), { nu: 8, nv: 8, lift: 0.006, uv: [3, 3] }); // the intake inside it
  sideDecal(kit, g, spec, accent, quadMap([-0.84, 0.25], [0.9, 0.25], [0.9, 0.44], [-0.84, 0.44]), { nu: 14, nv: 1, lift: 0.01 }); // sills
  line([[0.62, 0.3], [0.67, 0.7], [0.5, 0.9]], 0.012, seam); // the door's front edge
  line([[0.1, 0.8], [0.34, 0.8]], 0.025, seam); // handle slot

  // ---- the nose: bonnet seams and vents, slim twin headlights, the horseshoe, the lower intakes, splitter ----
  for (const s of [-1, 1]) {
    topDecal(kit, g, spec, seam, ribbonMap([[2.15, s * 0.42], [1.5, s * 0.58], [0.95, s * 0.64]], 0.01), { nu: 24, nv: 1, lift: 0.005 });
    topDecal(kit, g, spec, dark, quadMap([1.1, s * 0.33], [1.45, s * 0.33], [1.45, s * 0.47], [1.1, s * 0.47]), { nu: 4, nv: 2, lift: 0.006 });
  }
  headlight(kit, g, spec, 2.05, 0.72, 0.2, [0.3, 0.035]);
  headlight(kit, g, spec, 2.07, 0.42, 0.3, [0.2, 0.03]);
  faceDecal(kit, g, spec, chrome, 1, horseshoe(0.4, 0.6, 0.285, 0.545), { nu: 12, nv: 6, lift: 0.003 }); // the frame
  faceDecal(kit, g, spec, mesh2, 1, horseshoe(0.34, 0.53, 0.31, 0.525, 0.045), { nu: 12, nv: 6, lift: 0.006, uv: [4, 3] }); // the mesh
  g.add(ball(kit, 0.05, spec.x1 + 0.012, 0.51, 0, 0.25, 1, 1.5, macaron)); // the red macaron
  for (const s of [-1, 1]) faceDecal(kit, g, spec, mesh2, 1, quadMap([s * 0.47, 0.3], [s * 0.68, 0.3], [s * 0.68, 0.46], [s * 0.47, 0.46]), { nu: 4, nv: 3, lift: 0.005, uv: [2, 2] });
  g.add(planSlab(kit, [[1.95, 0.85], [2.42, 0.72], [2.42, -0.72], [1.95, -0.85]], 0.2, 0.04, kit.accent));

  // ---- the tail: one light band right across, six exhaust tips in a cluster, a carbon diffuser, no wing ----
  faceDecal(kit, g, spec, tail, -1, quadMap([-0.7, 0.74], [0.7, 0.74], [0.7, 0.8], [-0.7, 0.8]), { nu: 10, nv: 1, lift: 0.005 });
  faceDecal(kit, g, spec, dark, -1, quadMap([-0.58, 0.42], [0.58, 0.42], [0.58, 0.7], [-0.58, 0.7]), { nu: 6, nv: 3, lift: 0.004 });
  addExhausts(kit, g, -2.36, 0.6, [-0.2, 0, 0.2], 0.065); // the six tips: two rows of three
  addExhausts(kit, g, -2.36, 0.47, [-0.2, 0, 0.2], 0.065);
  g.add(planSlab(kit, [[-1.9, 0.62], [-2.52, 0.72], [-2.52, -0.72], [-1.9, -0.62]], 0.13, 0.04, kit.accent));
  for (let i = -3; i <= 3; i++) g.add(box(kit, 0.5, 0.12, 0.014, -2.3, 0.2, i * 0.15, kit.trim));

  const flame = flameGroup(kit, spec.x0 - 0.05, 0.5);
  g.add(flame);
  return { group: g, wheels, wheelR: WHEEL.r, rear: spec.x0, flame, tail, engineY: 0.8 };
}
