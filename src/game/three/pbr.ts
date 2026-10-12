import { type Disposer, THREE, hash2, smoothstep } from "./core";

// Procedural PBR surfaces: tileable height-derived normal maps, roughness maps and a small albedo "detail" multiplier, generated once from
// typed arrays (no canvas: this works in Node too, where the checks build the worlds). They give the road, the ground and the rock the
// close-up grain, cracks, ripples and glints that a flat colour cannot: the normal map catches the sun, the roughness map breaks the
// reflections up. Everything wraps, so a small tile covers a whole map.

export type SurfaceKind = "asphalt" | "sand" | "grass" | "dirt" | "snow" | "ice" | "rock" | "ash" | "gravel" | "bark";

export type Surface = {
  /** Albedo detail: near-white greys (the base colour or the vertex colours multiply it), sRGB. */
  map: THREE.DataTexture;
  /** Tangent-space normals. */
  normal: THREE.DataTexture;
  /** Roughness in the green channel (multiplied by the material's `roughness`). */
  rough: THREE.DataTexture;
  /** Metres of ground one tile covers (the recipe's natural scale). */
  tile: number;
};

// ---------- tileable noise ----------

/** Value noise on a lattice that wraps every `period` cells: 0..1. */
function tnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period, x1 = (x0 + 1) % period, y0 = ((iy % period) + period) % period, y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise over the unit square, tileable: `base` cells at the first octave, doubling. 0..1. */
export function tfbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, p = base;
  for (let i = 0; i < octaves; i++) {
    sum += tnoise(u * p, v * p, p, seed + i * 31) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Cellular noise over the unit square on an `n` × `n` grid that wraps: distance to the nearest (f1) and second nearest (f2) feature point, in cells. */
function worley(u: number, v: number, n: number, seed: number): { f1: number; f2: number; id: number } {
  const x = u * n, y = v * n, cx = Math.floor(x), cy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
      const px = gx + hash2(wx, wy, seed), py = gy + hash2(wx, wy, seed + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 13);
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

// ---------- recipes ----------

type Texel = { h: number; a: number; r: number };
type Recipe = { tile: number; strength: number; texel: (u: number, v: number, o: Texel) => void; hueShift?: [number, number, number] };

const RECIPES: Record<SurfaceKind, Recipe> = {
  // Worn asphalt: bitumen with pale aggregate showing through, hairline cracks and a few darker patches of tar.
  asphalt: {
    tile: 1.6, strength: 2.6,
    texel(u, v, o) {
      const grain = worley(u, v, 72, 3), fine = tfbm(u, v, 96, 2, 5), blot = tfbm(u, v, 5, 3, 9);
      const stone = 1 - smoothstep(0.05, 0.5, grain.f1);
      const crack = worley(u, v, 5, 21), seam = 1 - smoothstep(0.0, 0.045, crack.f2 - crack.f1);
      const speck = grain.id > 0.8 ? 1 : 0;
      o.h = 0.45 * stone + 0.25 * fine + 0.2 * blot - 0.5 * seam * (0.4 + 0.6 * fine);
      o.a = 0.74 + 0.25 * stone * (0.5 + 0.5 * grain.id) + 0.14 * speck + 0.12 * (blot - 0.5) - 0.4 * seam;
      o.r = 0.86 + 0.14 * (1 - stone) + 0.1 * (blot - 0.5) - 0.2 * speck;
    },
  },
  // Packed desert sand: wind ripples bent by noise over a fine grain, tiny pebbles.
  sand: {
    tile: 2.4, strength: 1.5,
    texel(u, v, o) {
      const warp = tfbm(u, v, 6, 3, 11), fine = tfbm(u, v, 128, 2, 13), rip = Math.sin((v * 9 + warp * 2.4 + tfbm(u, v, 3, 2, 17) * 1.5) * Math.PI * 2) * 0.5 + 0.5;
      const peb = worley(u, v, 40, 23), pebble = peb.id > 0.86 ? 1 - smoothstep(0.0, 0.32, peb.f1) : 0;
      o.h = 0.5 * rip * (0.55 + 0.45 * warp) + 0.25 * fine + 0.45 * pebble;
      o.a = 0.9 + 0.14 * (fine - 0.5) + 0.1 * (rip - 0.5) - 0.18 * pebble;
      o.r = 0.9 + 0.1 * fine;
    },
  },
  // Short grass: dense blade-scale noise in clumps.
  grass: {
    tile: 1.4, strength: 2.0,
    texel(u, v, o) {
      const blades = tfbm(u * 1.0, v * 6.0, 64, 3, 31), clump = tfbm(u, v, 9, 3, 33), fine = tfbm(u, v, 160, 2, 35);
      o.h = 0.55 * blades + 0.3 * fine + 0.25 * clump;
      o.a = 0.92 + 0.4 * (blades - 0.5) + 0.3 * (clump - 0.5) + 0.12 * (fine - 0.5);
      o.r = 0.9 + 0.1 * fine;
    },
  },
  // Bare earth: clods and small stones.
  dirt: {
    tile: 2.0, strength: 2.2,
    texel(u, v, o) {
      const clod = tfbm(u, v, 14, 4, 41), fine = tfbm(u, v, 128, 2, 43), st = worley(u, v, 28, 45), stone = st.id > 0.82 ? 1 - smoothstep(0.0, 0.34, st.f1) : 0;
      o.h = 0.7 * clod + 0.25 * fine + 0.5 * stone;
      o.a = 0.82 + 0.3 * (clod - 0.5) + 0.12 * (fine - 0.5) + 0.14 * stone;
      o.r = 0.94 + 0.06 * fine;
    },
  },
  // Snow: soft drifts, wind crust, and sparse crystals that glint (low roughness points).
  snow: {
    tile: 2.2, strength: 1.1,
    texel(u, v, o) {
      const drift = tfbm(u, v, 5, 4, 51), crust = tfbm(u * 1.0, v * 3.0, 24, 3, 53), fine = tfbm(u, v, 180, 2, 55);
      const sp = worley(u, v, 150, 57), glint = sp.id > 0.9 ? 1 - smoothstep(0.0, 0.28, sp.f1) : 0;
      o.h = 0.55 * drift + 0.25 * crust + 0.12 * fine;
      o.a = 0.96 + 0.06 * (drift - 0.5) + 0.04 * glint;
      o.r = 0.82 - 0.55 * glint + 0.1 * (fine - 0.5);
    },
  },
  // Road ice: very smooth, scratched, with a web of cracks under the surface (few and faint: a road, not a tiled floor).
  ice: {
    tile: 2.6, strength: 0.8,
    texel(u, v, o) {
      const wide = tfbm(u, v, 4, 3, 61), scratch = tfbm(u * 1.0, v * 24.0, 18, 2, 63);
      const web = worley(u, v, 3, 65), crack = (1 - smoothstep(0.0, 0.03, web.f2 - web.f1)) * (0.4 + 0.6 * tfbm(u, v, 6, 2, 67));
      o.h = 0.3 * wide + 0.14 * (scratch > 0.6 ? scratch : 0.4) - 0.18 * crack;
      o.a = 0.94 + 0.06 * wide - 0.1 * crack;
      o.r = 0.36 + 0.3 * (scratch - 0.5) + 0.2 * (wide - 0.5) + 0.25 * crack;
    },
  },
  // Rock face: weathered stone with faint horizontal strata, erosion pits and a few fractures.
  rock: {
    tile: 7.0, strength: 2.6,
    texel(u, v, o) {
      const warp = tfbm(u, v, 4, 3, 71), layer = Math.sin((v * 14 + warp * 2.2) * Math.PI * 2) * 0.5 + 0.5, big = tfbm(u, v, 5, 4, 73), fine = tfbm(u, v, 72, 3, 75);
      const ridge = 1 - Math.abs(tfbm(u, v, 8, 3, 79) * 2 - 1), fr = worley(u, v, 4, 77), fracture = (1 - smoothstep(0.0, 0.035, fr.f2 - fr.f1)) * smoothstep(0.35, 0.6, big);
      o.h = 0.4 * big + 0.3 * ridge + 0.12 * layer * (0.4 + 0.6 * warp) + 0.2 * fine - 0.35 * fracture;
      o.a = 0.8 + 0.3 * (big - 0.5) + 0.12 * (layer - 0.5) + 0.14 * (fine - 0.5) + 0.1 * (ridge - 0.5) - 0.3 * fracture;
      o.r = 0.9 + 0.1 * fine;
    },
  },
  // Tree bark: deep vertical fissures with ridged plates between them (more cells around the trunk than along it, so the streaks run up).
  bark: {
    tile: 1.2, strength: 3.0,
    texel(u, v, o) {
      const ridge = 1 - Math.abs(tfbm(u * 6, v, 5, 3, 101) * 2 - 1), fine = tfbm(u * 12, v * 2, 8, 2, 103), plate = tfbm(u * 4, v, 6, 3, 105);
      const fis = 1 - smoothstep(0.0, 0.18, Math.abs(tfbm(u * 8, v, 6, 2, 107) - 0.5));
      o.h = 0.55 * ridge + 0.25 * plate + 0.15 * fine - 0.45 * fis;
      o.a = 0.7 + 0.3 * (plate - 0.5) + 0.2 * (fine - 0.5) - 0.38 * fis;
      o.r = 0.95;
    },
  },
  // Volcanic ash and basalt grit: coarse, dark, with glassy flecks.
  ash: {
    tile: 3.0, strength: 2.6,
    texel(u, v, o) {
      const drift = tfbm(u, v, 8, 4, 81), fine = tfbm(u, v, 110, 2, 83), g = worley(u, v, 60, 85), fleck = g.id > 0.88 ? 1 - smoothstep(0.0, 0.3, g.f1) : 0;
      o.h = 0.55 * drift + 0.3 * fine + 0.3 * (1 - smoothstep(0.0, 0.5, g.f1));
      o.a = 0.78 + 0.34 * (drift - 0.5) + 0.12 * (fine - 0.5) + 0.2 * fleck;
      o.r = 0.9 - 0.4 * fleck + 0.1 * fine;
    },
  },
  // Loose gravel: round stones of several sizes.
  gravel: {
    tile: 1.8, strength: 3.0,
    texel(u, v, o) {
      const a = worley(u, v, 24, 91), b = worley(u, v, 56, 93), dome = (w: { f1: number }, rad: number) => Math.sqrt(Math.max(0, 1 - (w.f1 / rad) * (w.f1 / rad)));
      const s1 = dome(a, 0.62), s2 = dome(b, 0.62), fine = tfbm(u, v, 120, 2, 95);
      o.h = 0.6 * Math.max(s1, 0.8 * s2) + 0.15 * fine;
      o.a = 0.66 + 0.5 * (a.id - 0.5) * s1 + 0.2 * (b.id - 0.5) * s2 + 0.1 * (fine - 0.5) - 0.2 * (1 - Math.max(s1, s2));
      o.r = 0.88 + 0.1 * fine;
    },
  },
};

// ---------- building ----------

const cache = new WeakMap<Disposer, Map<string, Surface>>();
/** The generated pixels, kept for the session: leaving a mode and coming back (or another mode asking for the same surface) only re-uploads them. */
const pixels = new Map<string, { col: Uint8Array<ArrayBuffer>; nor: Uint8Array<ArrayBuffer>; rou: Uint8Array<ArrayBuffer> }>();

function generate(kind: SurfaceKind, n: number) {
  const key = `${kind}:${n}`, hit = pixels.get(key);
  if (hit) return hit;
  const rec = RECIPES[kind], h = new Float32Array(n * n), a = new Float32Array(n * n), r = new Float32Array(n * n), o: Texel = { h: 0, a: 1, r: 1 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      rec.texel((i + 0.5) / n, (j + 0.5) / n, o);
      const k = j * n + i;
      h[k] = o.h;
      a[k] = o.a;
      r[k] = o.r;
    }
  }
  const col = new Uint8Array(new ArrayBuffer(n * n * 4)), nor = new Uint8Array(new ArrayBuffer(n * n * 4)), rou = new Uint8Array(new ArrayBuffer(n * n * 4));
  const at = (i: number, j: number) => h[((j + n) % n) * n + ((i + n) % n)];
  const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, q = k * 4;
      const dx = (at(i + 1, j) - at(i - 1, j)) * rec.strength * (n / 128), dy = (at(i, j + 1) - at(i, j - 1)) * rec.strength * (n / 128);
      const len = Math.hypot(dx, dy, 1);
      nor[q] = byte((-dx / len) * 0.5 + 0.5);
      nor[q + 1] = byte((-dy / len) * 0.5 + 0.5);
      nor[q + 2] = byte((1 / len) * 0.5 + 0.5);
      nor[q + 3] = 255;
      const g = byte(a[k]);
      col[q] = col[q + 1] = col[q + 2] = g;
      col[q + 3] = 255;
      const rv = byte(r[k]);
      rou[q] = rou[q + 1] = rou[q + 2] = rv;
      rou[q + 3] = 255;
    }
  }
  const out = { col, nor, rou };
  pixels.set(key, out);
  return out;
}

/** Builds (or returns, per disposer) a surface of `kind`, `size` px square. */
export function surface(d: Disposer, kind: SurfaceKind, size = 256): Surface {
  let byKind = cache.get(d);
  if (!byKind) cache.set(d, (byKind = new Map()));
  const key = `${kind}:${size}`, hit = byKind.get(key);
  if (hit) return hit;
  const { col, nor, rou } = generate(kind, size), n = size;
  const tex = (data: Uint8Array<ArrayBuffer>, srgb: boolean) => {
    const t = d.add(new THREE.DataTexture(data, n, n, THREE.RGBAFormat));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const s: Surface = { map: tex(col, true), normal: tex(nor, false), rough: tex(rou, false), tile: RECIPES[kind].tile };
  byKind.set(key, s);
  return s;
}

/** The raw pixels of a surface (normals, albedo, roughness), for the checks. */
export const surfacePixels = (kind: SurfaceKind, size = 256) => generate(kind, size);

/**
 * Puts a surface on a material as a *detail* layer on the second UV set (`uv1`, in tiles): its normal and roughness maps always, its albedo
 * only when `albedo` is set (then it multiplies the colour or the vertex colours, so give the material a mid-bright base).
 */
export function detail(mat: THREE.MeshStandardMaterial, s: Surface, o: { normalScale?: number; albedo?: number; roughness?: boolean; channel?: number } = {}): THREE.MeshStandardMaterial {
  const ch = o.channel ?? 1;
  s.normal.channel = ch;
  s.rough.channel = ch;
  s.map.channel = ch;
  mat.normalMap = s.normal;
  mat.normalScale.set(o.normalScale ?? 1, o.normalScale ?? 1);
  if (o.roughness !== false) mat.roughnessMap = s.rough;
  if (o.albedo) {
    // The albedo detail multiplies the colour (whatever feeds it: a painted map, vertex colours) at the normal map's own tiling.
    const k = o.albedo;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.detailAlbedo = { value: s.map };
      shader.uniforms.detailMix = { value: k };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D detailAlbedo; uniform float detailMix;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), texture2D(detailAlbedo, vNormalMapUv).rgb, detailMix);");
    };
    mat.customProgramCacheKey = () => `detailAlbedo:${k}`;
  }
  mat.needsUpdate = true;
  return mat;
}

/** Adds a `uv1` attribute (world metres / tile size) to a geometry whose vertices carry world x, z in their positions (terrain, ground planes). */
export function planarUv1(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / tile;
    uv[i * 2 + 1] = p.getZ(i) / tile;
  }
  g.setAttribute("uv1", new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Triplanar detail for rock and terrain whose UVs would smear on steep faces: the surface's albedo, normals and roughness are projected along
 * the three world axes and blended by the face's direction (strata stay horizontal on a cliff, grain stays fine on a slope). The geometry's own
 * smooth normals carry the large shapes; this adds the grain. `tile` is the metres one repeat covers; `albedo` how strongly the detail
 * multiplies the vertex colours (0 none .. 1 full); `normal` the bump strength. Needs world-space geometry (or a mesh with a transform: the
 * projection uses the world position).
 */
export function triplanar(mat: THREE.MeshStandardMaterial, s: Surface, o: { tile?: number; albedo?: number; normal?: number } = {}): THREE.MeshStandardMaterial {
  const tile = o.tile ?? s.tile, albedo = o.albedo ?? 0.8, normal = o.normal ?? 1;
  mat.flatShading = false;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tpAlbedo = { value: s.map };
    shader.uniforms.tpNormal = { value: s.normal };
    shader.uniforms.tpRough = { value: s.rough };
    shader.uniforms.tpTile = { value: tile };
    shader.uniforms.tpMix = { value: new THREE.Vector2(albedo, normal) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTpPos; varying vec3 vTpNor;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
mat4 tpM = modelMatrix * instanceMatrix;
#else
mat4 tpM = modelMatrix;
#endif
vTpPos = (tpM * vec4(transformed, 1.0)).xyz; vTpNor = normalize(mat3(tpM) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vTpPos; varying vec3 vTpNor;
uniform sampler2D tpAlbedo; uniform sampler2D tpNormal; uniform sampler2D tpRough; uniform float tpTile; uniform vec2 tpMix;
vec3 tpW; vec2 tpUx; vec2 tpUy; vec2 tpUz;
void tpSetup(){
  tpW = pow(abs(normalize(vTpNor)), vec3(4.0)); tpW /= (tpW.x + tpW.y + tpW.z);
  // Side faces take (horizontal, height) so strata stay level; the top takes (x, z).
  tpUx = vec2(vTpPos.z, vTpPos.y) / tpTile; tpUy = vec2(vTpPos.x, vTpPos.z) / tpTile; tpUz = vec2(vTpPos.x, vTpPos.y) / tpTile;
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
tpSetup();
{
  vec3 d = texture2D(tpAlbedo, tpUx).rgb * tpW.x + texture2D(tpAlbedo, tpUy).rgb * tpW.y + texture2D(tpAlbedo, tpUz).rgb * tpW.z;
  diffuseColor.rgb *= mix(vec3(1.0), d * 1.12, tpMix.x);
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor *= texture2D(tpRough, tpUx).g * tpW.x + texture2D(tpRough, tpUy).g * tpW.y + texture2D(tpRough, tpUz).g * tpW.z;`)
      .replace("#include <normal_fragment_maps>", `{
  vec3 gn = normalize(vTpNor) * faceDirection; // two-sided shells: the face we see is the one that counts, whatever the winding
  vec3 tx = texture2D(tpNormal, tpUx).xyz * 2.0 - 1.0, ty = texture2D(tpNormal, tpUy).xyz * 2.0 - 1.0, tz = texture2D(tpNormal, tpUz).xyz * 2.0 - 1.0;
  tx.xy *= tpMix.y; ty.xy *= tpMix.y; tz.xy *= tpMix.y;
  // Whiteout blend: each projection's tilt added to the geometric normal's components along its plane.
  tx = vec3(tx.xy + gn.zy, abs(tx.z) * gn.x);
  ty = vec3(ty.xy + gn.xz, abs(ty.z) * gn.y);
  tz = vec3(tz.xy + gn.xy, abs(tz.z) * gn.z);
  vec3 wn = normalize(tx.zyx * tpW.x + ty.xzy * tpW.y + tz.xyz * tpW.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => `triplanar:${tile}:${albedo}:${normal}`;
  mat.needsUpdate = true;
  return mat;
}
