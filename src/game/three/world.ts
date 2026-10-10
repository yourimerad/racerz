import { type Adapter3D, K } from "../adapter3d";
import { wallHeightOf } from "../flight";
import type { ThemeId } from "../themes";
import type { Track } from "../track";
import { type Disposer, type Quality, THREE, makeSky, paintTexture, hash2 } from "./core";
import { type ProfilePoint, DistField, ribbon, sweep } from "./terrain";
import { buildClassic } from "./classic";
import { buildDesert } from "./desert";
import { buildNorthpole } from "./northpole";
import { buildVolcano } from "./volcano";

// The 3D world of a mode: what is the same everywhere (the road as a ribbon, its kerbs and outline, the barriers, the invisible wall of the
// flight rules made visible, the finish line and its gantry, the sky, the fog, the light) is built here; each mode's own scenery lives in
// its own file (desert.ts, volcano.ts, northpole.ts, classic.ts).

export type WorldCtx = {
  adapter: Adapter3D;
  d: Disposer;
  group: THREE.Group;
  quality: Quality;
  /** Distance to the centre line (shared: the canyon and the cone are carved with it). */
  field: DistField;
};

/** What a mode's scenery can animate or react to each frame. */
export type Scenery = {
  update?(dt: number, time: number, adapter: Adapter3D): void;
  /** Receives the sun's light so a mode can tint it (the volcano's glow). */
  lights?: { glow?: THREE.PointLight };
  /** Height (m) of the ground at a world point where the mode has relief the effects must follow (the volcano's cone); 0 elsewhere. */
  heightAt?(x: number, y: number): number;
  /** Where the crater's lake is (m), for the eruption. */
  craterY?: number;
};

export type Look = {
  sky: [string, string, string];
  fog: string;
  near: number;
  far: number;
  sun: string;
  sunIntensity: number;
  hemi: [string, string, number];
  /** Tone mapping exposure. */
  exposure: number;
};

export const LOOKS: Record<ThemeId, Look> = {
  desert: { sky: ["#5f9bd6", "#bcd4e3", "#f2d5a6"], fog: "#f0d0a0", near: 90, far: 760, sun: "#fff1d2", sunIntensity: 2.9, hemi: ["#fff0d8", "#d9a070", 1.5], exposure: 1.05 },
  countryside: { sky: ["#4b8ad4", "#a8cbec", "#dcebf5"], fog: "#d0e2ef", near: 140, far: 980, sun: "#fff6e2", sunIntensity: 2.5, hemi: ["#e0f0ff", "#3f7a45", 0.9], exposure: 1.0 },
  northpole: { sky: ["#7aa4cc", "#cde2f0", "#eef6fb"], fog: "#e6f0f7", near: 70, far: 700, sun: "#fffaf0", sunIntensity: 2.1, hemi: ["#e8f4ff", "#dfe9f1", 1.05], exposure: 1.0 },
  volcano: { sky: ["#1c1016", "#4a2c28", "#a85a32"], fog: "#46302b", near: 100, far: 820, sun: "#ffe2cc", sunIntensity: 2.8, hemi: ["#e4c6b8", "#6a5e58", 1.5], exposure: 1.25 },
};

export const FLOOR_Y = 0.03;

// ---------- road textures ----------

type RoadStyle = { base: string; dash: string | null; kerbA: string; kerbB: string; kerbW: number; edge: string | null; edgeW: number };
function roadStyleOf(adapter: Adapter3D): RoadStyle {
  const c = adapter.race.theme.colors;
  const base = adapter.mode === "northpole" ? "#bcdcf0" : c.asphalt;
  return { base, dash: c.dash, kerbA: c.kerbA, kerbB: c.kerbB, kerbW: c.kerbWidth, edge: c.edge?.color ?? null, edgeW: c.edge?.width ?? 0 };
}

function paintRoad(g: CanvasRenderingContext2D, w: number, h: number, mode: ThemeId, st: RoadStyle, roadM: number) {
  g.fillStyle = st.base;
  g.fillRect(0, 0, w, h);
  const ppm = w / roadM; // pixels per metre across
  // Grain: tiny lighter and darker specks.
  for (let i = 0; i < 2600; i++) {
    const x = hash2(i, 1) * w, y = hash2(i, 2) * h, light = hash2(i, 3) > 0.5;
    g.fillStyle = light ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
    const s = 1 + hash2(i, 4) * (mode === "volcano" ? 3 : 2);
    g.fillRect(x, y, s, s);
  }
  if (mode === "northpole") {
    // Glossy streaks along the road and hairline cracks.
    for (let i = 0; i < 26; i++) {
      const x = hash2(i, 11) * w, y0 = hash2(i, 12) * h, l = 40 + hash2(i, 13) * 150;
      g.strokeStyle = `rgba(255,255,255,${0.12 + hash2(i, 14) * 0.25})`;
      g.lineWidth = 1 + hash2(i, 15) * 4;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + (hash2(i, 16) - 0.5) * 6, y0 + l);
      g.stroke();
    }
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      let x = hash2(i, 21) * w, y = hash2(i, 22) * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (hash2(i * 7 + k, 23) - 0.5) * 40;
        y += hash2(i * 7 + k, 24) * 26;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  if (st.dash) {
    // 40 units of dash, 40 of gap: half the 8 m repeat.
    g.fillStyle = st.dash;
    g.fillRect(w / 2 - 0.2 * ppm, 0, 0.4 * ppm, h / 2);
  }
  if (mode === "desert") {
    // Two fine continuous tyre tracks, 2.6 m either side of the centre.
    g.fillStyle = "#d3a96d";
    for (const s of [-1, 1]) g.fillRect(w / 2 + s * 2.6 * ppm - 0.15 * ppm, 0, 0.3 * ppm, h);
  }
  // The outer metre darkens a touch (wear at the edges).
  const edge = g.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, "rgba(0,0,0,0.12)");
  edge.addColorStop(0.07, "rgba(0,0,0,0)");
  edge.addColorStop(0.93, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.12)");
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
}

function paintKerb(g: CanvasRenderingContext2D, w: number, h: number, a: string, b: string) {
  g.fillStyle = a;
  g.fillRect(0, 0, w, h);
  if (a !== b) {
    // 30 units of one colour, 30 of the other: a 6 m repeat, half each.
    g.fillStyle = b;
    g.fillRect(0, h / 2, w, h / 2);
  }
}

// ---------- barriers ----------

/** Style of the low barriers along the road; the desert has none (its canyon wall is the barrier). */
const BARRIER: Partial<Record<ThemeId, { h: number; thick: number }>> = {
  countryside: { h: 0.9, thick: 0.5 }, northpole: { h: 1.2, thick: 0.9 }, volcano: { h: 1.4, thick: 1.0 },
};

/** The flight rules' "walls" made visible where the mode has no real one: a faint grid curtain at the barrier line, as high as the rule says. */
const CURTAIN: Partial<Record<ThemeId, { color: string; alpha: number }>> = {
  countryside: { color: "#cfe6ff", alpha: 0.07 }, northpole: { color: "#9fe3ff", alpha: 0.1 }, volcano: { color: "#ff8a4a", alpha: 0.05 },
};

function curtainMaterial(d: Disposer, color: string, alpha: number, height: number): THREE.ShaderMaterial {
  return d.add(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { color: { value: new THREE.Color(color) }, alpha: { value: alpha }, height: { value: height } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 color; uniform float alpha; uniform float height; varying vec2 vUv;
      void main(){
        float fx = min(fract(vUv.x), 1.0 - fract(vUv.x));
        float fy = min(fract(vUv.y * height / 5.0), 1.0 - fract(vUv.y * height / 5.0));
        float gx = 1.0 - smoothstep(0.0, 0.02, fx);
        float gy = 1.0 - smoothstep(0.0, 0.012, fy);
        float top = smoothstep(0.965, 1.0, vUv.y);
        float a = alpha * (0.5 + 1.5 * max(gx, gy) + 3.0 * top);
        gl_FragColor = vec4(color, clamp(a, 0.0, 0.7));
#include <colorspace_fragment>

      }`,
  }));
}

// ---------- finish line and gantry ----------

type FinishStyle = { a: string; b: string; post: string; beam: string; text: string; glow?: string; outline: string };
const FINISH: Record<string, FinishStyle> = {
  desert: { a: "#6b2f1a", b: "#f3dcae", post: "#c9a572", beam: "#b98a57", text: "#f9e9c4", outline: "#3a1a0e" },
  volcano: { a: "#15100e", b: "#e8461a", post: "#15100e", beam: "#1d1513", text: "#ff8a24", glow: "#e8461a", outline: "#5a1a10" },
  north: { a: "#7cc0e8", b: "#f5fbff", post: "#cfe8f7", beam: "#bfe0f4", text: "#1f5f8b", outline: "#5aa5d0" },
  classic: { a: "#111111", b: "#ffffff", post: "#e8e8e8", beam: "#161616", text: "#ffffff", outline: "#111111" },
};
const finishStyleOf = (mode: ThemeId) => FINISH[mode === "northpole" ? "north" : mode === "desert" || mode === "volcano" ? mode : "classic"];

function buildFinish(ctx: WorldCtx) {
  const { adapter, d, group } = ctx, track = adapter.race.track, st = finishStyleOf(adapter.mode);
  const p = track.path[0], t = track.tangents[0], heading = Math.atan2(t.y, t.x), W = track.width * K;
  const root = new THREE.Group();
  root.position.set(p.x * K, 0, p.y * K);
  root.rotation.y = -heading;
  group.add(root);

  // The checkered band on the road: 8 squares across, 2 along it, a quarter as long as it is wide (the 2D line's proportions). The texture
  // runs 2 squares along the road (u) and 8 across it (v).
  const len = W / 4, checker = paintTexture(d, 64, 256, (g, w, h) => {
    const cw = w / 2, ch = h / 8;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 2; i++) {
      g.fillStyle = (i + j) % 2 ? st.b : st.a;
      g.fillRect(i * cw, j * ch, cw, ch);
    }
    g.strokeStyle = st.outline;
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  });
  const bandGeo = d.add(new THREE.PlaneGeometry(len, W));
  bandGeo.rotateX(-Math.PI / 2);
  const band = new THREE.Mesh(bandGeo, d.add(new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, emissive: adapter.mode === "volcano" ? "#3a0f05" : "#000000", emissiveMap: adapter.mode === "volcano" ? checker : null })));
  band.position.y = FLOOR_Y + 0.02;
  band.receiveShadow = true;
  root.add(band);

  // The gantry: two pillars just outside the kerbs and a beam with the word, readable from both sides.
  const half = W / 2 + 2.4, H = 7.2, beamH = 1.8;
  const postMat = d.add(new THREE.MeshStandardMaterial({ color: st.post, roughness: 0.7, emissive: st.glow ?? "#000000", emissiveIntensity: st.glow ? 0.25 : 0, ...(adapter.mode === "northpole" ? { transparent: true, opacity: 0.92, roughness: 0.15 } : {}) }));
  const postGeo = d.add(new THREE.BoxGeometry(0.9, H, 0.9));
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(0, H / 2, s * half);
    post.castShadow = true;
    root.add(post);
  }
  const label = paintTexture(d, 1024, 160, (g, w, h) => {
    g.fillStyle = st.beam;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = st.outline;
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    // Chequered ends.
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? st.b : st.a;
      g.fillRect(14 + j * 22, 14 + i * 8.6, 22, 8.6);
      g.fillRect(w - 58 + j * 22, 14 + i * 8.6, 22, 8.6);
    }
    g.fillStyle = st.text;
    g.font = "900 104px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("ARRIVÉE", w / 2, h / 2 + 6);
  });
  const beamMat = d.add(new THREE.MeshStandardMaterial({ map: label, roughness: 0.6, emissive: st.glow ?? "#000000", emissiveMap: st.glow ? label : null, emissiveIntensity: st.glow ? 0.6 : 0 }));
  const sideMat = d.add(new THREE.MeshStandardMaterial({ color: st.beam, roughness: 0.7 }));
  const beamGeo = d.add(new THREE.BoxGeometry(0.5, beamH, half * 2 + 0.9));
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z: the two big faces (±x) carry the word.
  const beam = new THREE.Mesh(beamGeo, [beamMat, beamMat, sideMat, sideMat, sideMat, sideMat]);
  beam.position.set(0, H - beamH / 2 + 0.2, 0);
  beam.castShadow = true;
  root.add(beam);
}

// ---------- road, kerbs, barriers ----------

function buildRoad(ctx: WorldCtx) {
  const { adapter, d, group } = ctx, track: Track = adapter.race.track, mode = adapter.mode, st = roadStyleOf(adapter);
  const half = track.width / 2, roadM = track.width * K;
  const road = paintTexture(d, 512, 256, (g, w, h) => paintRoad(g, w, h, mode, st, roadM), { repeat: true, anisotropy: 8 });
  const roadMat = d.add(new THREE.MeshStandardMaterial({
    map: road, roughness: mode === "northpole" ? 0.18 : 0.88, metalness: mode === "northpole" ? 0.05 : 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    ...(road ? {} : { color: st.base }),
  }));
  const roadMesh = new THREE.Mesh(ribbon(d, track, -half, half, FLOOR_Y, 8), roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const kerbHalf = st.kerbW / 2;
  if (kerbHalf > 0) {
    const kerb = paintTexture(d, 16, 128, (g, w, h) => paintKerb(g, w, h, st.kerbA, st.kerbB), { repeat: true });
    const kerbMat = d.add(new THREE.MeshStandardMaterial({ map: kerb, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...(kerb ? {} : { color: st.kerbA }) }));
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(ribbon(d, track, s > 0 ? half : -half - kerbHalf, s > 0 ? half + kerbHalf : -half, FLOOR_Y + 0.005, 6), kerbMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }
  if (st.edge) {
    const edgeMat = d.add(new THREE.MeshStandardMaterial({ color: st.edge, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const o0 = half + kerbHalf, o1 = o0 + st.edgeW;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(ribbon(d, track, s > 0 ? o0 : -o1, s > 0 ? o1 : -o0, FLOOR_Y + 0.004, 8), edgeMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }
}

function buildBarriers(ctx: WorldCtx) {
  const { adapter, d, group } = ctx, track = adapter.race.track, mode = adapter.mode, spec = BARRIER[mode], c = adapter.race.theme.colors;
  if (spec) {
    // 22 units of the second colour then 26 of the first: a 4.8 m repeat along the barrier.
    const tex = paintTexture(d, 96, 8, (g, w, h) => {
      g.fillStyle = c.barrierA;
      g.fillRect(0, 0, w, h);
      g.fillStyle = c.barrierB;
      g.fillRect(0, 0, (w * 22) / 48, h);
    }, { repeat: true });
    const mat = d.add(new THREE.MeshStandardMaterial({ map: tex, roughness: mode === "countryside" ? 0.45 : 0.9, metalness: mode === "countryside" ? 0.5 : 0, side: THREE.DoubleSide, ...(tex ? {} : { color: c.barrierA }) }));
    for (const s of [-1, 1]) {
      const inner = s * (track.barrier - 3), outer = s * (track.barrier + spec.thick * 10 - 3);
      const geo = sweep(d, track, (): ProfilePoint[] => [[inner, 0], [inner, spec.h], [outer, spec.h], [outer, 0]], 0, track.path.length, 4.8);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }
  const curtain = CURTAIN[mode];
  if (curtain) {
    const H = wallHeightOf(mode), mat = curtainMaterial(d, curtain.color, curtain.alpha, H);
    for (const s of [-1, 1]) {
      const geo = sweep(d, track, (): ProfilePoint[] => [[s * track.barrier, 0], [s * track.barrier, H]], 0, track.path.length, 8);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 3;
      group.add(m);
    }
  }
}

// ---------- the whole world ----------

export type World = {
  group: THREE.Group;
  scenery: Scenery;
  sky: THREE.Mesh;
  look: Look;
};

/** Builds the mode's world into a group. Everything it makes is registered in `ctx.d`. */
export function buildWorld(ctx: WorldCtx): World {
  const { adapter, d } = ctx, mode = adapter.mode;
  buildRoad(ctx);
  buildBarriers(ctx);
  buildFinish(ctx);
  const scenery = mode === "desert" ? buildDesert(ctx) : mode === "volcano" ? buildVolcano(ctx) : mode === "northpole" ? buildNorthpole(ctx) : buildClassic(ctx);
  const look = LOOKS[mode];
  const sky = makeSky(d, ...look.sky);
  ctx.group.add(sky);
  return { group: ctx.group, scenery, sky, look };
}
