import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Shared tools of the 3D view: the registry that frees everything the view created (geometries, materials, textures), value noise, canvas
// textures, the sky dome and a pooled particle system. Nothing in here touches the game.

export { THREE };

// ---------- freeing what was created ----------

let live = 0;
/** How many resources the 3D view currently holds (the checks assert it falls back to 0 after `dispose`). */
export const liveResources = () => live;

/** Every geometry, material, texture, render target... of the view is registered here, and `dispose()` frees all of them at once. */
export class Disposer {
  private items = new Set<{ dispose(): void }>();
  add<T extends { dispose(): void }>(o: T): T {
    if (!this.items.has(o)) {
      this.items.add(o);
      live++;
    }
    return o;
  }
  dispose() {
    for (const o of this.items) o.dispose();
    live -= this.items.size;
    this.items.clear();
  }
  get size() {
    return this.items.size;
  }
}

// ---------- quality ----------

/** 0 = everything, 1 = lighter shadows and half the particles, 2 = no shadows, a quarter of the particles, no extra pixel ratio. */
export type QualityLevel = 0 | 1 | 2;
export type Quality = { level: QualityLevel; shadows: boolean; shadowSize: number; particles: number; pixelRatio: number };
export function qualityOf(level: QualityLevel, dpr: number): Quality {
  if (level === 0) return { level, shadows: true, shadowSize: 2048, particles: 1, pixelRatio: Math.min(dpr, 2) };
  if (level === 1) return { level, shadows: true, shadowSize: 1024, particles: 0.5, pixelRatio: Math.min(dpr, 1.5) };
  return { level, shadows: false, shadowSize: 512, particles: 0.25, pixelRatio: 1 };
}

// ---------- noise ----------

/** 0..1 hash of an integer lattice point. */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Smooth value noise, 0..1. */
export function vnoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Fractal noise, 0..1. */
export function fbm(x: number, y: number, seed = 0, octaves = 4): number {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x, y, seed + i * 17) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---------- canvas textures ----------

/** A 2D canvas, or null where there is no DOM (the checks run in Node and build geometry only). */
export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

export type TexOpts = { repeat?: boolean; anisotropy?: number; srgb?: boolean; mip?: boolean };
/** Paints a canvas texture; null when there is no canvas. `paint` runs once. */
export function paintTexture(d: Disposer, w: number, h: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, o: TexOpts = {}): THREE.CanvasTexture | null {
  const c = makeCanvas(w, h);
  if (!c) return null;
  paint(c.ctx, w, h);
  const t = d.add(new THREE.CanvasTexture(c.canvas));
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = o.anisotropy ?? 4;
  t.generateMipmaps = o.mip !== false;
  t.minFilter = o.mip === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A soft white disc (radial falloff) for sprites and particles. */
export function softDisc(d: Disposer, size = 64): THREE.CanvasTexture | null {
  return paintTexture(d, size, size, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.45, "rgba(255,255,255,0.55)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  }, { mip: false, anisotropy: 1 });
}

// ---------- geometry helpers ----------

/** Bakes a transform and a flat colour into a geometry, so a whole prop merges into one vertex-coloured geometry (one draw call per kind). */
export function part(g: THREE.BufferGeometry, color: string | number | THREE.Color, m?: THREE.Matrix4): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  if (m) out.applyMatrix4(m);
  const c = new THREE.Color(color), n = out.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  out.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  if (!out.attributes.uv) out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.dispose();
  return out;
}
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
/** Matrix from a position, an Euler rotation and a scale (a scratch matrix: use it at once). */
export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  P.set(x, y, z);
  S.set(sx, sy, sz);
  return M.compose(P, Q, S);
}
export function merge(parts: THREE.BufferGeometry[], keepNormals = false): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("merge failed");
  if (!keepNormals) g.computeVertexNormals();
  return g;
}

/** Shared material for vertex-coloured merged props (colours are in the geometry). */
export function propMaterial(d: Disposer, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true, ...o }));
}

/** An instanced mesh from per-instance placements (x, z in metres, y, heading about Y, scale, tint 0xRRGGBB or -1 for none). */
export type Placement = { x: number; y?: number; z: number; ry?: number; s?: number; sx?: number; sy?: number; sz?: number; tint?: number };
export function instanced(d: Disposer, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly Placement[], shadow = true): THREE.InstancedMesh | null {
  if (!list.length) return null;
  d.add(geo);
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const color = new THREE.Color();
  list.forEach((p, i) => {
    const s = p.s ?? 1;
    mesh.setMatrixAt(i, mat4(p.x, p.y ?? 0, p.z, 0, p.ry ?? 0, 0, p.sx ?? s, p.sy ?? s, p.sz ?? s));
    if (p.tint !== undefined && p.tint >= 0) mesh.setColorAt(i, color.setHex(p.tint));
    else mesh.setColorAt(i, color.setRGB(1, 1, 1));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // the instances are spread over the whole world: the single bounding sphere of the base geometry would cull them all
  return mesh;
}

// ---------- sky ----------

/** A gradient dome that follows the camera: zenith, middle, horizon (the horizon colour is the fog's). */
export function makeSky(d: Disposer, top: string, mid: string, horizon: string): THREE.Mesh {
  const geo = d.add(new THREE.SphereGeometry(1, 24, 16));
  const mat = d.add(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, horizon: { value: new THREE.Color(horizon) } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.1, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.18, 0.85, h));
        gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
 }`,
  }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(1200);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- pooled particles ----------

/**
 * A fixed-size pool of point sprites in one draw call: `emit` takes a free slot (and quietly drops the particle when the pool is full — a hard
 * ceiling on cost), `update` ages, moves and writes them. Nothing is allocated after construction.
 */
export class Particles {
  readonly points: THREE.Points;
  private n = 0;
  private readonly max: number;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private size: Float32Array;
  private age: Float32Array; private life: Float32Array; private grow: Float32Array; private grav: Float32Array; private drag: Float32Array; private a0: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  /** Share of the pool that may be used (the quality level lowers it). */
  limit = 1;

  constructor(d: Disposer, max: number, map: THREE.Texture | null, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.grow = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.geo = d.add(new THREE.BufferGeometry());
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.col, 4); ca.setUsage(THREE.DynamicDrawUsage);
    const sa = new THREE.BufferAttribute(this.size, 1); sa.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("aColor", ca);
    this.geo.setAttribute("aSize", sa);
    this.geo.setDrawRange(0, 0);
    this.mat = d.add(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
      uniforms: { uMap: { value: map }, uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
        void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 220.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec4 vColor;
        void main(){ float a = ${map ? "texture2D(uMap, gl_PointCoord).a" : "smoothstep(0.5, 0.2, length(gl_PointCoord - 0.5))"} * vColor.a; if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb, a);
#include <colorspace_fragment>
 }`,
    }));
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  get count() {
    return this.n;
  }

  /** World metres. `rgb` as 0..1 linear-ish floats (use `THREE.Color`), alpha at birth fading to 0 at the end of the life. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, r: number, g: number, b: number, a: number, grav = 0, drag = 0) {
    if (this.n >= Math.floor(this.max * this.limit)) return;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = a;
    this.size[i] = size; this.grow[i] = grow; this.age[i] = 0; this.life[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.a0[i] = a;
  }

  update(dt: number, pixelScale: number) {
    this.mat.uniforms.uScale.value = pixelScale;
    for (let i = 0; i < this.n; ) {
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) {
        this.remove(i);
        continue;
      }
      const i3 = i * 3, k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const u = a / this.life[i];
      this.col[i * 4 + 3] = this.a0[i] * (1 - u) * Math.min(1, u * 8);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  /** Swap-remove: the last particle takes the free slot. */
  private remove(i: number) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3, i4 = i * 4, j4 = j * 4;
    for (let k = 0; k < 3; k++) { this.pos[i3 + k] = this.pos[j3 + k]; this.vel[i3 + k] = this.vel[j3 + k]; }
    for (let k = 0; k < 4; k++) this.col[i4 + k] = this.col[j4 + k];
    this.size[i] = this.size[j]; this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.grow[i] = this.grow[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.a0[i] = this.a0[j];
  }

  clear() {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }
}
