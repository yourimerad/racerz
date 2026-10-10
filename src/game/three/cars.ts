import type { CarView } from "../adapter3d";
import { K } from "../adapter3d";
import type { ModelId, Skin } from "../garage";
import { type Key, loft, makeWheel, spline } from "./carbody";
import { type Disposer, THREE, clamp, lerp, paintTexture } from "./core";

// The cars in 3D, sculpted like real ones: the body is lofted from cross-sections (width, floor and deck height as curves along its length)
// into one smooth shell; the greenhouse is a second loft in glass with painted pillars and roof; there are interiors with seats and a
// driver, headlights with reflectors, tail lights, mirrors, exhausts, a number plate, and wheels with tyres, spokes, brake discs and
// calipers. The paint is a clear-coated metallic that reflects the surroundings (the mode's sky), with the shop's skins as a shader on
// top (racing stripes, carbon weave, gold). Real size: about 4 m long; the Racerz Jet is 5 m. Nose toward +X, origin on the ground.

type Spec = {
  x0: number; x1: number;
  hw: Key[]; yb: Key[]; yt: Key[]; eTop: number; eBot: number; tumble: number;
  cabin?: {
    x0: number; x1: number; base: number; roof: Key[]; tumble: number;
    /** Where the side windows are, where the windscreen and rear window start (x), and the pillars (painted) in between. */
    side: [number, number]; ws: number; rw: number; pillars: [number, number][];
  };
  wheel: { xf: number; xr: number; r: number; w: number; z: number; spokes: number; rim: string; caliper: string };
};

const SPECS: Record<Exclude<ModelId, "jet">, Spec> = {
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
  aventador: {
    x0: -2.17, x1: 2.17, eTop: 4.2, eBot: 8, tumble: 0.06,
    hw: [[-2.17, 0.84], [-2.0, 0.96], [-1.5, 1.03], [-0.8, 1.0], [0, 0.96], [0.8, 0.98], [1.5, 0.96], [1.9, 0.86], [2.17, 0.72]],
    yb: [[-2.17, 0.38], [-1.9, 0.26], [-1.2, 0.2], [1.5, 0.2], [2.0, 0.2], [2.17, 0.24]],
    yt: [[-2.17, 0.8], [-1.9, 0.94], [-1.2, 0.98], [-0.4, 0.96], [0.5, 0.8], [1.2, 0.62], [1.8, 0.46], [2.17, 0.34]],
    cabin: { x0: -0.95, x1: 0.95, base: 0.72, tumble: 0.28, roof: [[-0.95, 0.95], [-0.7, 1.06], [-0.2, 1.14], [0.3, 1.12], [0.65, 1.0], [0.95, 0.72]], side: [-0.6, 0.62], ws: 0.4, rw: -2, pillars: [[-0.95, -0.6]] },
    wheel: { xf: 1.38, xr: -1.32, r: 0.36, w: 0.3, z: 0.86, spokes: 10, rim: "#34353a", caliper: "#f0c000" },
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

// ---------- materials ----------

type PaintUniforms = { uAccent: { value: THREE.Color }; uDamage: { value: number } };

function paintMaterial(d: Disposer, skin: Skin, env: THREE.Texture | null): { mat: THREE.MeshPhysicalMaterial; uniforms: PaintUniforms } {
  const metal = skin.pattern === "metal", matte = !!skin.matte;
  const mat = d.add(new THREE.MeshPhysicalMaterial({
    color: skin.pattern === "carbon" ? "#2a2c30" : skin.body, roughness: metal ? 0.24 : matte ? 0.7 : 0.3, metalness: metal ? 1 : matte ? 0.2 : 0.55,
    clearcoat: matte ? 0 : metal ? 0.35 : 1, clearcoatRoughness: metal ? 0.18 : 0.05, envMap: env, envMapIntensity: metal ? 1.4 : matte ? 0.5 : 1.0,
  }));
  const uniforms: PaintUniforms = { uAccent: { value: new THREE.Color(skin.accent) }, uDamage: { value: 0 } };
  const pattern = skin.pattern;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAccent = uniforms.uAccent;
    sh.uniforms.uDamage = uniforms.uDamage;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLocal;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;");
    let extra = "";
    // Racing stripes: two bands 0.3 m wide either side of the centre line, over bonnet, roof and boot.
    if (pattern === "stripes") extra += "float sz = abs(vLocal.z); if (sz > 0.1 && sz < 0.4 && vLocal.y > 0.5) diffuseColor.rgb = uAccent;\n";
    // Carbon weave: a two-tone twill, 4 cm cells.
    if (pattern === "carbon") extra += "vec2 cc = floor(vec2(vLocal.x + vLocal.z * 0.5, vLocal.y + vLocal.z) / 0.04); diffuseColor.rgb = mix(vec3(0.012, 0.014, 0.017), vec3(0.04, 0.045, 0.052), mod(cc.x + cc.y, 2.0));\n";
    // A wrecked car (the volcano's damage) darkens toward soot.
    extra += "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.025, 0.025), uDamage * 0.7);\n";
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal; uniform vec3 uAccent; uniform float uDamage;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + extra);
  };
  return { mat, uniforms };
}

type Kit = {
  d: Disposer; skin: Skin; env: THREE.Texture | null;
  paint: THREE.MeshPhysicalMaterial; accent: THREE.MeshStandardMaterial; glass: THREE.MeshPhysicalMaterial; trim: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial; tyre: THREE.MeshStandardMaterial; rim: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; disc: THREE.MeshStandardMaterial;
  caliper: THREE.MeshStandardMaterial; lens: THREE.MeshStandardMaterial; housing: THREE.MeshStandardMaterial; tail: THREE.MeshStandardMaterial; interior: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial; plate: THREE.MeshStandardMaterial; helmet: THREE.MeshStandardMaterial; linerBack: THREE.MeshStandardMaterial;
};

function makeKit(d: Disposer, skin: Skin, env: THREE.Texture | null, spec?: Spec): { kit: Kit; uniforms: PaintUniforms } {
  const { mat, uniforms } = paintMaterial(d, skin, env);
  const std = (p: THREE.MeshStandardMaterialParameters) => d.add(new THREE.MeshStandardMaterial(p));
  const plateTex = paintTexture(d, 256, 64, (g, w, h) => {
    g.fillStyle = "#f4f4ee";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#1a1a1a";
    g.lineWidth = 4;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = "#1d3fa6";
    g.fillRect(6, 6, 26, h - 12);
    g.fillStyle = "#1a1a1a";
    g.font = "700 40px ui-monospace, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("RACERZ", w / 2 + 12, h / 2 + 2);
  }, { anisotropy: 4 });
  const kit: Kit = {
    d, skin, env, paint: mat,
    accent: std({ color: skin.accent, roughness: 0.4, metalness: 0.3 }),
    glass: d.add(new THREE.MeshPhysicalMaterial({ color: "#0a1018", roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.62, envMap: env, envMapIntensity: 1.3, clearcoat: 1, clearcoatRoughness: 0.02 })),
    trim: std({ color: "#17191d", roughness: 0.55, metalness: 0.3 }),
    chrome: std({ color: "#d8dde4", roughness: 0.15, metalness: 1, envMap: env, envMapIntensity: 1.2 }),
    tyre: std({ color: "#0e0e10", roughness: 0.92 }),
    rim: std({ color: spec?.wheel.rim ?? "#c8ccd2", roughness: 0.28, metalness: 0.9, envMap: env, envMapIntensity: 1.0 }),
    dark: std({ color: "#101114", roughness: 0.8 }),
    disc: std({ color: "#7d838b", roughness: 0.4, metalness: 0.85 }),
    caliper: std({ color: spec?.wheel.caliper ?? "#d62828", roughness: 0.4, metalness: 0.3 }),
    lens: std({ color: "#fff8e6", emissive: "#fff2c8", emissiveIntensity: 1.8, roughness: 0.15 }),
    housing: std({ color: "#2a2d33", roughness: 0.25, metalness: 0.9, envMap: env }),
    tail: std({ color: "#6a0810", emissive: "#ff1c28", emissiveIntensity: 0.9, roughness: 0.3 }),
    interior: std({ color: "#1b1d21", roughness: 0.9 }),
    cloth: std({ color: "#2a2d33", roughness: 0.95 }),
    plate: std({ map: plateTex, roughness: 0.6, ...(plateTex ? {} : { color: "#f4f4ee" }) }),
    helmet: std({ color: skin.accent, roughness: 0.3, metalness: 0.2 }),
    linerBack: d.add(new THREE.MeshStandardMaterial({ color: "#0c0d0f", roughness: 0.95, side: THREE.DoubleSide })),
  };
  return { kit, uniforms };
}

// ---------- shared parts ----------

type Parts = {
  group: THREE.Group;
  /** Wheel hubs: `pivot` steers about y (the front pair), `spin` turns about z. */
  wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[];
  wheelR: number;
  rear: number;
  flame: THREE.Group;
  tail: THREE.MeshStandardMaterial;
  wings?: THREE.Object3D[];
  jetFlames?: THREE.Group[];
  engineY: number;
};

function mesh(kit: Kit, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
  kit.d.add(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const box = (kit: Kit, w: number, h: number, dp: number, x: number, y: number, z: number, mat: THREE.Material, shadow = false) => {
  const m = mesh(kit, new THREE.BoxGeometry(w, h, dp), mat, shadow);
  m.position.set(x, y, z);
  return m;
};
const ball = (kit: Kit, r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, shadow = false) => {
  const m = mesh(kit, new THREE.SphereGeometry(r, 16, 12), mat, shadow);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
};
const cylX = (kit: Kit, r: number, len: number, x: number, y: number, z: number, mat: THREE.Material) => {
  const m = mesh(kit, new THREE.CylinderGeometry(r, r, len, 14), mat, false);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};

function addWheels(kit: Kit, g: THREE.Group, w: Spec["wheel"]): Parts["wheels"] {
  const out: Parts["wheels"] = [];
  const wk = { tyre: kit.tyre, rim: kit.rim, dark: kit.dark, disc: kit.disc, caliper: kit.caliper };
  for (const x of [w.xf, w.xr]) {
    // One set of geometry for the pair of wheels of an axle (the left one mirrored).
    const wg = makeWheel(kit.d, wk, w.r, w.w, w.spokes);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(), spin = new THREE.Group();
      pivot.position.set(x, w.r, s * w.z);
      const wheel = s > 0 ? wg : wg.clone();
      if (s < 0) wheel.rotation.y = Math.PI;
      spin.add(wheel);
      pivot.add(spin);
      g.add(pivot);
      out.push({ pivot, spin, front: x === w.xf });
    }
  }
  return out;
}

/** The turbo flame: a two-layer cone out of the back (hidden unless boosting). */
function flameGroup(kit: Kit, x: number, y: number, z = 0, color = "#ff9a2e", core = "#fff0b0", len = 3.2, r = 0.4): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  const mk = (rad: number, l: number, c: string, o: number) => {
    const geo = kit.d.add(new THREE.ConeGeometry(rad, l, 12, 1, true));
    geo.rotateZ(Math.PI / 2);
    geo.translate(-l / 2, 0, 0);
    const m = new THREE.Mesh(geo, kit.d.add(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
    grp.add(m);
  };
  mk(r, len, color, 0.55);
  mk(r * 0.5, len * 0.6, core, 0.8);
  grp.visible = false;
  return grp;
}

/** Half width of the body's surface at height `y` (x along the car): lets lights, vents and intakes sit exactly on the skin. */
function zAt(spec: Spec, x: number, y: number): number {
  const hw = spline(spec.hw, x), yb = spline(spec.yb, x), yt = spline(spec.yt, x), yc = (yb + yt) / 2, b = Math.max(0.001, (yt - yb) / 2);
  const py = clamp((y - yc) / b, -0.999, 0.999), e = py > 0 ? spec.eTop : spec.eBot;
  const px = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(py), e)), 1 / e);
  return hw * px * (1 - spec.tumble * Math.pow(Math.max(0, py), 2));
}
/** Height on the body at `x` at a fraction `f` (0 floor .. 1 deck) of its section. */
const yAt = (spec: Spec, x: number, f: number) => spline(spec.yb, x) + f * (spline(spec.yt, x) - spline(spec.yb, x));

/** Interior seen through the glass: floor, dashboard, two seats with headrests, a steering wheel and the driver's helmet and shoulders. */
function interior(kit: Kit, g: THREE.Group, x: number, belt: number, o: { seatX: number; dashX: number; hw: number; head?: number }) {
  const head = o.head ?? 0.2;
  g.add(box(kit, 1.6, 0.04, o.hw * 1.7, x, belt - 0.4, 0, kit.interior));
  g.add(box(kit, 0.3, 0.26, o.hw * 1.7, o.dashX, belt - 0.16, 0, kit.interior));
  const wheel = mesh(kit, new THREE.TorusGeometry(0.16, 0.018, 8, 18), kit.trim, false);
  wheel.position.set(o.dashX - 0.26, belt + 0.02, -o.hw * 0.4);
  wheel.rotation.y = Math.PI / 2 - 0.35;
  g.add(wheel);
  for (const s of [-1, 1]) {
    g.add(box(kit, 0.16, 0.46, 0.42, o.seatX, belt - 0.06, s * o.hw * 0.4, kit.cloth));
    g.add(box(kit, 0.46, 0.14, 0.44, o.seatX + 0.24, belt - 0.26, s * o.hw * 0.4, kit.cloth));
    g.add(box(kit, 0.09, 0.18, 0.2, o.seatX - 0.03, belt + 0.26, s * o.hw * 0.4, kit.cloth));
  }
  // The driver (left seat when facing forward): torso, helmet, visor.
  g.add(box(kit, 0.2, 0.3, 0.4, o.seatX + 0.1, belt - 0.02 + head * 0.3, -o.hw * 0.4, kit.dark));
  g.add(ball(kit, 0.12, o.seatX + 0.1, belt + head, -o.hw * 0.4, 1, 1.05, 1, kit.helmet));
  g.add(box(kit, 0.05, 0.06, 0.14, o.seatX + 0.2, belt + head, -o.hw * 0.4, kit.glass));
}

/** Mirrors on stalks, the number plates and the underbody: what every car has. */
function furniture(kit: Kit, g: THREE.Group, spec: Spec, mirrorX: number, mirrorY: number, mirrorZ: number) {
  for (const s of [-1, 1]) {
    g.add(box(kit, 0.05, 0.035, 0.14, mirrorX, mirrorY - 0.03, s * (mirrorZ - 0.07), kit.paint));
    g.add(ball(kit, 0.085, mirrorX - 0.03, mirrorY, s * mirrorZ, 0.65, 0.55, 1.1, kit.paint, true));
  }
  const rc = (spec.yb[0][1] + spec.yt[0][1]) / 2, fc = (spec.yb[spec.yb.length - 1][1] + spec.yt[spec.yt.length - 1][1]) / 2;
  const plate = mesh(kit, new THREE.PlaneGeometry(0.52, 0.13), kit.plate, false);
  plate.position.set(spec.x0 - 0.012, rc - 0.07, 0);
  plate.rotation.y = -Math.PI / 2;
  g.add(plate);
  const front = mesh(kit, new THREE.PlaneGeometry(0.52, 0.13), kit.plate, false);
  front.position.set(spec.x1 + 0.012, fc - 0.1, 0);
  front.rotation.y = Math.PI / 2;
  g.add(front);
  g.add(box(kit, 2.8, 0.05, 1.2, 0, 0.22, 0, kit.dark)); // the underbody
}

function addExhausts(kit: Kit, g: THREE.Group, x: number, y: number, zs: number[], r = 0.05) {
  for (const z of zs) {
    g.add(cylX(kit, r, 0.14, x, y, z, kit.chrome));
    g.add(cylX(kit, r * 0.7, 0.16, x - 0.02, y, z, kit.dark));
  }
}

/** A headlight: a dark reflector bowl and a lens, set on the skin at `x`, at section fraction `f`, `z` in from the edge. */
function headlight(kit: Kit, g: THREE.Group, spec: Spec, x: number, f: number, inset: number, size: [number, number]) {
  const y = yAt(spec, x, f);
  for (const s of [-1, 1]) {
    const z = s * (zAt(spec, x, y) - inset);
    g.add(ball(kit, 1, x, y, z, 0.08, size[1], size[0], kit.housing));
    g.add(ball(kit, 1, x + 0.045, y, z, 0.05, size[1] * 0.72, size[0] * 0.8, kit.lens));
  }
}
function taillight(kit: Kit, g: THREE.Group, spec: Spec, x: number, f: number, inset: number, size: [number, number]) {
  const y = yAt(spec, x, f);
  for (const s of [-1, 1]) {
    const z = s * (zAt(spec, x, y) - inset);
    g.add(ball(kit, 1, x, y, z, 0.07, size[1], size[0], kit.housing));
    g.add(ball(kit, 1, x - 0.035, y, z, 0.045, size[1] * 0.75, size[0] * 0.85, kit.tail));
  }
}

/** Builds the common shell: body, greenhouse in glass, wheels. */
function shell(kit: Kit, g: THREE.Group, spec: Spec) {
  const hw = (x: number) => spline(spec.hw, x), yb = (x: number) => spline(spec.yb, x), yt = (x: number) => spline(spec.yt, x);
  const wh = spec.wheel, ra = wh.r + 0.07;
  const arches = [wh.xf, wh.xr].map((x) => ({ x, r: ra, hub: wh.r, zIn: wh.z - wh.w / 2 - 0.1 }));
  g.add(mesh(kit, loft(kit.d, { x0: spec.x0, x1: spec.x1, stations: 64, around: 44, hw, yb, yt, eTop: spec.eTop, eBot: spec.eBot, tumble: spec.tumble, caps: true, arches }), kit.paint));
  // The wheel wells: a dark half-barrel inside each arch, and a black trim round its edge.
  const linerGeo = kit.d.add(new THREE.CylinderGeometry(ra - 0.015, ra - 0.015, wh.w + 0.5, 20, 1, true, Math.PI / 2, Math.PI));
  linerGeo.rotateX(Math.PI / 2);
  const trimGeo = kit.d.add(new THREE.TorusGeometry(ra + 0.005, 0.018, 6, 24, Math.PI));
  for (const x of [wh.xf, wh.xr]) {
    for (const s of [-1, 1]) {
      const liner = new THREE.Mesh(linerGeo, kit.dark);
      liner.material = kit.linerBack;
      liner.position.set(x, wh.r, s * (wh.z - 0.05));
      g.add(liner);
      const trim = new THREE.Mesh(trimGeo, kit.trim);
      trim.position.set(x, wh.r, s * (hw(x) * 0.985));
      g.add(trim);
    }
  }
  const c = spec.cabin;
  if (c) {
    const roof = (x: number) => spline(c.roof, x);
    const geo = loft(kit.d, {
      x0: c.x0, x1: c.x1, stations: 30, around: 24, hw: () => c.base, yb: (x) => yt(x) - 0.05, yt: roof, eTop: 2.3, eBot: 6, tumble: c.tumble, caps: true,
      group: (x, j, m) => {
        const f = j / m;
        if (f >= 0.5) return 0; // under the belt line: hidden in the body
        const top = f > 0.17 && f < 0.33;
        if (c.pillars.some(([a, b]) => x >= a && x <= b)) return 0;
        if (top) return x >= c.ws || x <= c.rw ? 1 : 0;
        return x >= c.side[0] && x <= c.side[1] ? 1 : 0;
      },
    });
    g.add(mesh(kit, geo, [kit.paint, kit.glass]));
  }
  return addWheels(kit, g, spec.wheel);
}

// ---------- the five cars ----------

function finish(kit: Kit, g: THREE.Group, spec: Spec, wheels: Parts["wheels"], flameX?: number): Parts {
  const flame = flameGroup(kit, flameX ?? spec.x0 - 0.05, 0.5);
  g.add(flame);
  return { group: g, wheels, wheelR: spec.wheel.r, rear: spec.x0, flame, tail: kit.tail, engineY: 0.8 };
}

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

/** Lamborghini Aventador SVJ: a low wedge, Y-shaped light bars, side intakes, a big rear wing, three hexagonal exhausts. */
function buildAventador(kit: Kit): Parts {
  const g = new THREE.Group(), spec = SPECS.aventador, wheels = shell(kit, g, spec);
  interior(kit, g, -0.1, 0.76, { seatX: -0.3, dashX: 0.65, hw: 0.72, head: 0.17 });
  furniture(kit, g, spec, 0.5, 0.95, 0.98);
  for (const s of [-1, 1]) {
    const zi = zAt(spec, -0.35, 0.55);
    g.add(ball(kit, 1, -0.35, 0.55, s * (zi - 0.005), 0.45, 0.1, 0.04, kit.dark)); // the side air intakes
    g.add(ball(kit, 1, -0.35, 0.69, s * (zi - 0.002), 0.28, 0.018, 0.04, kit.trim));
    const y = yAt(spec, 2.05, 0.6), z = s * (zAt(spec, 2.05, y) - 0.12);
    g.add(ball(kit, 1, 2.05, y, z, 0.06, 0.03, 0.3, kit.lens)); // the Y light bars
    g.add(ball(kit, 1, 1.95, y + 0.005, z * 0.62, 0.05, 0.025, 0.2, kit.lens));
    g.add(ball(kit, 1, -2.15, yAt(spec, -2.15, 0.7), s * 0.55, 0.05, 0.03, 0.3, kit.tail));
    g.add(box(kit, 0.12, 0.42, 0.14, -1.92, 1.05, s * 0.72, kit.trim)); // the wing's struts
    g.add(box(kit, 0.4, 0.14, 0.2, 1.6, 0.34, s * 0.8, kit.dark)); // front splitter vents
  }
  g.add(ball(kit, 1, -2.17, yAt(spec, -2.17, 0.7), 0, 0.05, 0.03, 0.5, kit.tail));
  g.add(box(kit, 0.55, 0.07, 2.15, -2.3, 1.3, 0, kit.paint, true)); // the rear wing
  for (const s of [-1, 1]) g.add(box(kit, 0.58, 0.28, 0.05, -2.3, 1.28, s * 1.08, kit.accent));
  g.add(box(kit, 0.4, 0.1, 1.2, -2.0, 0.3, 0, kit.dark)); // diffuser
  g.add(box(kit, 0.4, 0.04, 2.0, 2.1, 0.2, 0, kit.dark)); // splitter
  addExhausts(kit, g, -2.2, 0.55, [-0.25, 0, 0.25], 0.07);
  return finish(kit, g, spec, wheels, -2.25);
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

const BUILDERS: Record<ModelId, (kit: Kit) => Parts> = { gt: buildGT, mx5: buildMX5, p911: buildP911, aventador: buildAventador, f8: buildF8, jet: buildJet };

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
    const spec = view.model === "jet" ? undefined : SPECS[view.model];
    const { kit, uniforms } = makeKit(d, view.skin, env, spec);
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
    p.tail.emissiveIntensity = 0.9 + this.brake * 2.6;
    const speedK = Math.min(1, Math.abs(v.speed) / 500);
    const roll = clamp(this.yawRate * speedK * 0.06, -0.1, 0.1);
    const pitch = this.model === "jet" ? clamp(this.climb * 0.0035, -0.25, 0.3) : clamp(accel * 0.00012, -0.03, 0.03);
    g.rotation.set(roll, -v.heading, pitch, "YXZ");
    // Wheels turn with the road (not in the air) and the front pair steers with the car.
    if (dt > 0 && v.alt < 5) this.spin -= (v.speed * K * dt) / p.wheelR;
    const steer = clamp(this.yawRate * 0.08 * (v.speed < 0 ? -1 : 1), -0.45, 0.45);
    for (const w of p.wheels) {
      w.spin.rotation.z = this.spin;
      if (w.front) w.pivot.rotation.y = -steer;
    }
    // Turbo flame: a flickering cone out of the back.
    p.flame.visible = v.boosting;
    if (v.boosting) {
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
