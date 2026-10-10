import type { Skin } from "../garage";
import { type Arch, type Key, loft, makeWheel, spline } from "./carbody";
import { type Disposer, THREE, clamp, paintTexture } from "./core";

// What every car is made of: the paint (a clear-coated metallic with the skins' patterns as a shader), the materials, the common shell (a body
// lofted from cross-sections, a glass greenhouse, wheel arches and wheels) and the small parts all of them share (interiors, mirrors, plates,
// lights, exhausts). The cars themselves are in cars.ts and aventador.ts. Nose toward +X, origin on the ground.

export type Spec = {
  x0: number; x1: number;
  hw: Key[]; yb: Key[]; yt: Key[]; eTop: number; eBot: number; tumble: number;
  cabin?: {
    x0: number; x1: number; base: number; roof: Key[]; tumble: number;
    /** Where the side windows are, where the windscreen and rear window start (x), and the pillars (painted) in between. */
    side: [number, number]; ws: number; rw: number; pillars: [number, number][];
  };
  wheel: {
    xf: number; xr: number; r: number; w: number; z: number; spokes: number; rim: string; caliper: string;
    /** Rear tyres, when they differ from the front ones (radius, width, half track). */
    rear?: { r: number; w: number; z: number };
    /** "y": every spoke forks in two at the rim. */
    style?: "y";
  };
  /** Gap (m) between a tyre and its arch; default 0.07. */
  archGap?: number;
};

// ---------- materials ----------

/** A smooth 3D value noise for the shader (the camouflage). */
export const VNOISE = `
float hash31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

export type PaintUniforms = { uAccent: { value: THREE.Color }; uDamage: { value: number } };

export function paintMaterial(d: Disposer, skin: Skin, env: THREE.Texture | null): { mat: THREE.MeshPhysicalMaterial; uniforms: PaintUniforms } {
  const metal = skin.pattern === "metal", matte = !!skin.matte;
  const mat = d.add(new THREE.MeshPhysicalMaterial({
    color: skin.pattern === "carbon" ? "#2a2c30" : skin.body, roughness: metal ? 0.24 : matte ? 0.46 : 0.3, metalness: metal ? 1 : matte ? 0.35 : 0.55,
    clearcoat: matte ? 0 : metal ? 0.35 : 1, clearcoatRoughness: metal ? 0.18 : 0.05, envMap: env, envMapIntensity: metal ? 1.4 : matte ? 1.05 : 1.0,
  }));
  const uniforms: PaintUniforms = { uAccent: { value: new THREE.Color(skin.accent) }, uDamage: { value: 0 } };
  const pattern = skin.pattern;
  // Three.js caches compiled programs by this key, which defaults to the source of onBeforeCompile: the same text for every paint, so a
  // car with stripes, carbon or camo would share (or lend) its program with the plain ones. One key per pattern.
  mat.customProgramCacheKey = () => `racerz-paint-${pattern ?? "plain"}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAccent = uniforms.uAccent;
    sh.uniforms.uDamage = uniforms.uDamage;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLocal;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;");
    let extra = "";
    // Racing stripes: two bands 0.3 m wide either side of the centre line, over bonnet, roof and boot.
    if (pattern === "stripes") extra += "float sz = abs(vLocal.z); if (sz > 0.1 && sz < 0.4 && vLocal.y > 0.5) diffuseColor.rgb = uAccent;\n";
    // Carbon weave: a two-tone twill, 4 cm cells.
    if (pattern === "carbon") extra += "vec2 cc = floor(vec2(vLocal.x + vLocal.z * 0.5, vLocal.y + vLocal.z) / 0.04); diffuseColor.rgb = mix(vec3(0.012, 0.014, 0.017), vec3(0.04, 0.045, 0.052), mod(cc.x + cc.y, 2.0));\n";
    // Camouflage (the Jet's): three tones of blotches from a smooth 3D value noise, in the body colour, a darker one and the accent.
    if (pattern === "camo") extra += "float cn = vnoise3(vLocal * 1.7) * 0.65 + vnoise3(vLocal * 4.3 + 7.0) * 0.35; vec3 cb = diffuseColor.rgb; diffuseColor.rgb = mix(mix(cb, cb * 0.5 + vec3(0.07, 0.05, 0.01), smoothstep(0.5, 0.54, cn)), uAccent, smoothstep(0.62, 0.66, cn));\n";
    // A wrecked car (the volcano's damage) darkens toward soot.
    extra += "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.025, 0.025), uDamage * 0.7);\n";
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal; uniform vec3 uAccent; uniform float uDamage;" + (pattern === "camo" ? VNOISE : ""))
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + extra);
  };
  return { mat, uniforms };
}

export type Kit = {
  d: Disposer; skin: Skin; env: THREE.Texture | null;
  paint: THREE.MeshPhysicalMaterial; accent: THREE.MeshStandardMaterial; glass: THREE.MeshPhysicalMaterial; trim: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial; tyre: THREE.MeshStandardMaterial; rim: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; disc: THREE.MeshStandardMaterial;
  caliper: THREE.MeshStandardMaterial; lens: THREE.MeshStandardMaterial; housing: THREE.MeshStandardMaterial; tail: THREE.MeshStandardMaterial; interior: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial; plate: THREE.MeshStandardMaterial; helmet: THREE.MeshStandardMaterial; linerBack: THREE.MeshStandardMaterial;
};

export function makeKit(d: Disposer, skin: Skin, env: THREE.Texture | null, wheel?: Spec["wheel"]): { kit: Kit; uniforms: PaintUniforms } {
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
    rim: std({ color: wheel?.rim ?? "#c8ccd2", roughness: 0.28, metalness: 0.9, envMap: env, envMapIntensity: 1.0 }),
    dark: std({ color: "#101114", roughness: 0.8 }),
    disc: std({ color: "#7d838b", roughness: 0.4, metalness: 0.85 }),
    caliper: std({ color: wheel?.caliper ?? "#d62828", roughness: 0.4, metalness: 0.3 }),
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

export type Parts = {
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

export function mesh(kit: Kit, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadow = true): THREE.Mesh {
  kit.d.add(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
export const box = (kit: Kit, w: number, h: number, dp: number, x: number, y: number, z: number, mat: THREE.Material, shadow = false) => {
  const m = mesh(kit, new THREE.BoxGeometry(w, h, dp), mat, shadow);
  m.position.set(x, y, z);
  return m;
};
export const ball = (kit: Kit, r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, shadow = false) => {
  const m = mesh(kit, new THREE.SphereGeometry(r, 16, 12), mat, shadow);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
};
export const cylX = (kit: Kit, r: number, len: number, x: number, y: number, z: number, mat: THREE.Material) => {
  const m = mesh(kit, new THREE.CylinderGeometry(r, r, len, 14), mat, false);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};

/** Size and half track of the wheels of an axle (the rear ones may be bigger, see Spec). */
export const axleOf = (w: Spec["wheel"], front: boolean) => (front || !w.rear ? { r: w.r, w: w.w, z: w.z } : w.rear);

export function addWheels(kit: Kit, g: THREE.Group, w: Spec["wheel"]): Parts["wheels"] {
  const out: Parts["wheels"] = [];
  const wk = { tyre: kit.tyre, rim: kit.rim, dark: kit.dark, disc: kit.disc, caliper: kit.caliper };
  for (const x of [w.xf, w.xr]) {
    const front = x === w.xf, a = axleOf(w, front);
    // One set of geometry for the pair of wheels of an axle (the left one mirrored).
    const wg = makeWheel(kit.d, wk, a.r, a.w, w.spokes, w.style);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(), spin = new THREE.Group();
      pivot.position.set(x, a.r, s * a.z);
      const wheel = s > 0 ? wg : wg.clone();
      if (s < 0) wheel.rotation.y = Math.PI;
      spin.add(wheel);
      pivot.add(spin);
      g.add(pivot);
      out.push({ pivot, spin, front });
    }
  }
  return out;
}

/** The turbo flame: a two-layer cone out of the back (hidden unless boosting). */
export function flameGroup(kit: Kit, x: number, y: number, z = 0, color = "#ff9a2e", core = "#fff0b0", len = 3.2, r = 0.4): THREE.Group {
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
export function zAt(spec: Spec, x: number, y: number): number {
  const hw = spline(spec.hw, x), yb = spline(spec.yb, x), yt = spline(spec.yt, x), yc = (yb + yt) / 2, b = Math.max(0.001, (yt - yb) / 2);
  const py = clamp((y - yc) / b, -0.999, 0.999), e = py > 0 ? spec.eTop : spec.eBot;
  const px = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(py), e)), 1 / e);
  return hw * px * (1 - spec.tumble * Math.pow(Math.max(0, py), 2));
}
/** Height on the body at `x` at a fraction `f` (0 floor .. 1 deck) of its section. */
export const yAt = (spec: Spec, x: number, f: number) => spline(spec.yb, x) + f * (spline(spec.yt, x) - spline(spec.yb, x));

/** Interior seen through the glass: floor, dashboard, two seats with headrests, a steering wheel and the driver's helmet and shoulders. */
export function interior(kit: Kit, g: THREE.Group, x: number, belt: number, o: { seatX: number; dashX: number; hw: number; head?: number }) {
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
export function furniture(kit: Kit, g: THREE.Group, spec: Spec, mirrorX: number, mirrorY: number, mirrorZ: number) {
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

export function addExhausts(kit: Kit, g: THREE.Group, x: number, y: number, zs: number[], r = 0.05) {
  for (const z of zs) {
    g.add(cylX(kit, r, 0.14, x, y, z, kit.chrome));
    g.add(cylX(kit, r * 0.7, 0.16, x - 0.02, y, z, kit.dark));
  }
}

/** A headlight: a dark reflector bowl and a lens, set on the skin at `x`, at section fraction `f`, `z` in from the edge. */
export function headlight(kit: Kit, g: THREE.Group, spec: Spec, x: number, f: number, inset: number, size: [number, number]) {
  const y = yAt(spec, x, f);
  for (const s of [-1, 1]) {
    const z = s * (zAt(spec, x, y) - inset);
    g.add(ball(kit, 1, x, y, z, 0.08, size[1], size[0], kit.housing));
    g.add(ball(kit, 1, x + 0.045, y, z, 0.05, size[1] * 0.72, size[0] * 0.8, kit.lens));
  }
}
export function taillight(kit: Kit, g: THREE.Group, spec: Spec, x: number, f: number, inset: number, size: [number, number]) {
  const y = yAt(spec, x, f);
  for (const s of [-1, 1]) {
    const z = s * (zAt(spec, x, y) - inset);
    g.add(ball(kit, 1, x, y, z, 0.07, size[1], size[0], kit.housing));
    g.add(ball(kit, 1, x - 0.035, y, z, 0.045, size[1] * 0.75, size[0] * 0.85, kit.tail));
  }
}

/** The arches a shell is cut with, one per axle (see liftArches). */
export function wheelArches(wh: Spec["wheel"], gap: number): Arch[] {
  return [true, false].map((front) => {
    const a = axleOf(wh, front);
    return { x: front ? wh.xf : wh.xr, r: a.r + gap, hub: a.r, zIn: a.z - a.w / 2 - 0.1 };
  });
}

/** The wheel wells: a dark half-barrel inside each arch (from just inboard of the tyre out to the skin) and a black trim round its edge. */
export function wheelWells(kit: Kit, g: THREE.Group, wh: Spec["wheel"], gap: number, hw: (x: number) => number) {
  for (const front of [true, false]) {
    const a = axleOf(wh, front), x = front ? wh.xf : wh.xr, ra = a.r + gap;
    const zIn = a.z - a.w / 2 - 0.1, zOut = hw(x) - 0.012, len = Math.max(0.2, zOut - zIn);
    const linerGeo = kit.d.add(new THREE.CylinderGeometry(ra - 0.015, ra - 0.015, len, 20, 1, true, Math.PI / 2, Math.PI));
    linerGeo.rotateX(Math.PI / 2);
    const trimGeo = kit.d.add(new THREE.TorusGeometry(ra + 0.005, 0.018, 6, 24, Math.PI));
    for (const s of [-1, 1]) {
      const liner = new THREE.Mesh(linerGeo, kit.dark);
      liner.material = kit.linerBack;
      liner.position.set(x, a.r, s * (zIn + len / 2));
      g.add(liner);
      const trim = new THREE.Mesh(trimGeo, kit.trim);
      trim.position.set(x, a.r, s * (hw(x) * 0.985));
      g.add(trim);
    }
  }
}

/** Builds the common shell: body, greenhouse in glass, wheels. */
export function shell(kit: Kit, g: THREE.Group, spec: Spec) {
  const hw = (x: number) => spline(spec.hw, x), yb = (x: number) => spline(spec.yb, x), yt = (x: number) => spline(spec.yt, x);
  const gap = spec.archGap ?? 0.07;
  g.add(mesh(kit, loft(kit.d, { x0: spec.x0, x1: spec.x1, stations: 64, around: 44, hw, yb, yt, eTop: spec.eTop, eBot: spec.eBot, tumble: spec.tumble, caps: true, arches: wheelArches(spec.wheel, gap) }), kit.paint));
  wheelWells(kit, g, spec.wheel, gap, hw);
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

export function finish(kit: Kit, g: THREE.Group, spec: Spec, wheels: Parts["wheels"], flameX?: number): Parts {
  const flame = flameGroup(kit, flameX ?? spec.x0 - 0.05, 0.5);
  g.add(flame);
  return { group: g, wheels, wheelR: spec.wheel.r, rear: spec.x0, flame, tail: kit.tail, engineY: 0.8 };
}


// ---------- patches laid on the skin ----------

/** The skin of a body, for patches laid on it: the half width at height y (flank) and the height at lateral z (top). */
export type Surface = { x0: number; x1: number; zAt: (x: number, y: number) => number; topAt: (x: number, z: number) => number };
const surfaceOf = (s: Spec | Surface): Surface => ("zAt" in s ? s : { x0: s.x0, x1: s.x1, zAt: (x, y) => zAt(s, x, y), topAt: (x, z) => topAt(s, x, z) });

/** Height of the shell's upper surface at (x, z): the inverse of zAt on the top half (for panels on the bonnet, the roof and the engine cover). */
export function topAt(spec: Spec, x: number, z: number): number {
  const hw = spline(spec.hw, x), yb = spline(spec.yb, x), yt = spline(spec.yt, x), yc = (yb + yt) / 2, b = Math.max(0.001, (yt - yb) / 2);
  let py = 0.6;
  for (let i = 0; i < 6; i++) {
    const px = Math.min(0.9999, Math.abs(z) / Math.max(0.001, hw * (1 - spec.tumble * py * py)));
    py = Math.pow(Math.max(0, 1 - Math.pow(px, spec.eTop)), 1 / spec.eTop);
  }
  return yc + b * py;
}

/** A material for patches: double-sided and pulled toward the camera a little so it never fights with the paint under it. */
export function decalMaterial(kit: Kit, p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return kit.d.add(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...p }));
}

function gridMesh(kit: Kit, nu: number, nv: number, at: (u: number, v: number) => [number, number, number], mat: THREE.Material, uvs: [number, number] = [1, 1]): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      pos.push(...at(i / nu, j / nv));
      uv.push((i / nu) * uvs[0], (j / nv) * uvs[1]);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, e = c + 1;
      idx.push(a, b, c, b, e, c);
    }
  }
  const geo = kit.d.add(new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** A honeycomb grille texture (hexagon walls over a black void), `cells` hexagons across; null without a DOM. */
export function hexGrille(d: Disposer, cells = 10, wall = "#3b3f46", void_ = "#050607"): THREE.CanvasTexture | null {
  const tex = paintTexture(d, 256, 256, (g, w, h) => {
    g.fillStyle = void_;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = wall;
    g.lineWidth = 5;
    const r = w / cells / Math.sqrt(3), dx = r * Math.sqrt(3), dy = r * 1.5;
    for (let row = -1; row <= Math.ceil(h / dy); row++) {
      for (let col = -1; col <= cells + 1; col++) {
        const cx = col * dx + (row % 2 ? dx / 2 : 0), cy = row * dy;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        g.closePath();
        g.stroke();
      }
    }
  }, { repeat: true });
  return tex;
}

/**
 * A patch on the flank, on both sides: `map(u, v)` (u, v in 0..1) gives the point (x, y) of the side view; every vertex is put on the skin
 * (zAt) and lifted by `lift`, so the patch follows the body's curves. Keep it out of the wheel arches.
 */
export function sideDecal(kit: Kit, g: THREE.Group, spec: Spec | Surface, mat: THREE.Material, map: (u: number, v: number) => [number, number], o: { nu?: number; nv?: number; lift?: number; uv?: [number, number] } = {}) {
  const lift = o.lift ?? 0.004, sf = surfaceOf(spec);
  for (const s of [-1, 1]) {
    g.add(gridMesh(kit, o.nu ?? 8, o.nv ?? 6, (u, v) => {
      const [x, y] = map(u, v);
      return [x, y, s * (sf.zAt(x, y) + lift)];
    }, mat, o.uv));
  }
}

/** A patch on the upper surface (bonnet, roof, engine cover): `map(u, v)` gives (x, z) in plan; mirrored about the centre line when `both`. */
export function topDecal(kit: Kit, g: THREE.Group, spec: Spec | Surface, mat: THREE.Material, map: (u: number, v: number) => [number, number], o: { nu?: number; nv?: number; lift?: number; both?: boolean; uv?: [number, number] } = {}) {
  const lift = o.lift ?? 0.004, sf = surfaceOf(spec);
  for (const s of o.both ? [-1, 1] : [1]) {
    g.add(gridMesh(kit, o.nu ?? 8, o.nv ?? 6, (u, v) => {
      const [x, z] = map(u, v);
      return [x, sf.topAt(x, z) + lift, s * z];
    }, mat, o.uv));
  }
}

/** A flat patch on the end of the car (the shell's cap), facing `dir` (+1 front, -1 rear): `map(u, v)` gives (z, y). */
export function faceDecal(kit: Kit, g: THREE.Group, spec: Spec | Surface, mat: THREE.Material, dir: 1 | -1, map: (u: number, v: number) => [number, number], o: { nu?: number; nv?: number; lift?: number; uv?: [number, number] } = {}) {
  const x = (dir > 0 ? spec.x1 : spec.x0) + dir * (o.lift ?? 0.004);
  g.add(gridMesh(kit, o.nu ?? 2, o.nv ?? 2, (u, v) => {
    const [z, y] = map(u, v);
    return [x, y, z];
  }, mat, o.uv));
}

/** `map` for a thin ribbon along the polyline `pts` (x, y) with the given width: u runs along it, v across. For seams and slits. */
export function ribbonMap(pts: [number, number][], width: number): (u: number, v: number) => [number, number] {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1];
  return (u, v) => {
    const d = u * total;
    let i = 1;
    while (i < pts.length - 1 && d > len[i]) i++;
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], t = (d - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]), l = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / l, ny = (x1 - x0) / l;
    return [x0 + (x1 - x0) * t + nx * (v - 0.5) * width, y0 + (y1 - y0) * t + ny * (v - 0.5) * width];
  };
}

/** A bilinear quadrilateral: `map(u, v)` over the corners (a, b along the bottom/left, c, d along the top). */
export function quadMap(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): (u: number, v: number) => [number, number] {
  return (u, v) => [
    (1 - v) * ((1 - u) * a[0] + u * b[0]) + v * ((1 - u) * d[0] + u * c[0]),
    (1 - v) * ((1 - u) * a[1] + u * b[1]) + v * ((1 - u) * d[1] + u * c[1]),
  ];
}

/** A slab with the plan-view outline `pts` (x, z), from height `y` up by `t`: splitters, wing plates, diffusers. */
export function planSlab(kit: Kit, pts: [number, number][], y: number, t: number, mat: THREE.Material, shadow = true): THREE.Mesh {
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const m = mesh(kit, geo, mat, shadow);
  m.position.y = y;
  return m;
}

/** A hexagonal tube along x (the Lamborghini's exhaust tips). */
export function hexTube(kit: Kit, r: number, len: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = mesh(kit, new THREE.CylinderGeometry(r, r, len, 6), mat, false);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
