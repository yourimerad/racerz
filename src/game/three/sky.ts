import { type Disposer, THREE, fbm, hash2, smoothstep } from "./core";
import { tfbm } from "./pbr";

// The sky of a mode: a dome that follows the camera with a sun disc and its glow, a layer of clouds drifting over it (lit from the side of the
// sun, thin and high or heavy and dark by mode), and — between the sky and the world — ranges of distant hills drawn in the colour of the
// haze: what makes a horizon read as far away instead of a flat line.

export type Clouds = {
  /** 0 clear .. 1 overcast. */
  cover: number;
  /** Lit and shaded sides of the clouds. */
  bright: string;
  shade: string;
  /** Drift speed (cloud-plane units per second) and size (bigger = smaller clouds). */
  speed: number;
  scale: number;
};

export type SkyLook = { sky: [string, string, string]; fog: string; sun: string; clouds: Clouds; /** 0..1: how far up the haze reaches from the horizon. */ haze: number };

/** The direction toward the sun for an azimuth and elevation in degrees (x east, z south as in the world; y up). */
export function sunDirection(az: number, el: number): THREE.Vector3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

/** A tileable noise texture (red channel) the sky samples for its clouds. */
function cloudNoise(d: Disposer): THREE.DataTexture {
  const n = 256, data = new Uint8Array(new ArrayBuffer(n * n * 4));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, (tfbm((i + 0.5) / n, (j + 0.5) / n, 6, 5, 7) - 0.18) * 1.6))), q = (j * n + i) * 4;
      data[q] = data[q + 1] = data[q + 2] = v;
      data[q + 3] = 255;
    }
  }
  const t = d.add(new THREE.DataTexture(data, n, n, THREE.RGBAFormat));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export type Sky = THREE.Mesh & { tick(time: number): void };

/** The sky dome (radius 1 200 m, follows the camera): call `tick(time)` each frame for the clouds' drift. */
export function makeSkyDome(d: Disposer, look: SkyLook, sunDir: THREE.Vector3): Sky {
  const geo = d.add(new THREE.SphereGeometry(1, 32, 20));
  const c = look.clouds;
  const mat = d.add(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(look.sky[0]) }, mid: { value: new THREE.Color(look.sky[1]) }, horizon: { value: new THREE.Color(look.sky[2]) },
      haze: { value: new THREE.Color(look.fog) }, hazeTop: { value: look.haze }, sunCol: { value: new THREE.Color(look.sun) }, sunDir: { value: sunDir.clone() },
      cBright: { value: new THREE.Color(c.bright) }, cShade: { value: new THREE.Color(c.shade) }, cover: { value: c.cover }, scale: { value: c.scale }, speed: { value: c.speed },
      time: { value: 0 }, noise: { value: cloudNoise(d) },
    },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 haze; uniform float hazeTop; uniform vec3 sunCol; uniform vec3 sunDir;
      uniform vec3 cBright; uniform vec3 cShade; uniform float cover; uniform float scale; uniform float speed; uniform float time; uniform sampler2D noise; varying vec3 vDir;
      float cloudField(vec2 uv){
        return texture2D(noise, uv).r * 0.62 + texture2D(noise, uv * 2.6 + 0.31).r * 0.28 + texture2D(noise, uv * 6.1 + 0.67).r * 0.10;
      }
      void main(){
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, -0.1, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.2, h));
        c = mix(c, top, smoothstep(0.14, 0.9, h));
        // Haze: the colour of the fog climbs the sky from the horizon.
        c = mix(c, haze, (1.0 - smoothstep(0.0, hazeTop, h)) * 0.85);
        float sd = max(dot(dir, sunDir), 0.0);
        // Clouds: a plane high above, projected; thinner toward the horizon; the side facing the sun is lit, the far side shaded.
        if (dir.y > 0.005) {
          vec2 uv = dir.xz / (dir.y + 0.16) * scale + vec2(time * speed, time * speed * 0.35);
          float n = cloudField(uv);
          float body = smoothstep(1.0 - cover, 1.0 - cover + 0.4, n);
          float n2 = cloudField(uv + sunDir.xz * 0.045);
          float lit = clamp((n - n2) * 3.4 + 0.6, 0.0, 1.0);
          vec3 cc = mix(cShade, cBright, lit);
          cc += sunCol * pow(sd, 6.0) * 0.35 * (1.0 - body * 0.4); // silver lining toward the sun
          float fade = smoothstep(0.0, 0.16, dir.y);
          c = mix(c, mix(c, cc, 0.94), body * fade);
        }
        // The sun: a hard disc, a tight glow and a wide warm bloom.
        c += sunCol * (pow(sd, 2400.0) * 6.0 + pow(sd, 90.0) * 0.5 + pow(sd, 7.0) * 0.16);
        gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
      }`,
  }));
  const mesh = new THREE.Mesh(geo, mat) as unknown as Sky;
  mesh.scale.setScalar(1200);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.tick = (time: number) => {
    mat.uniforms.time.value = time;
  };
  return mesh;
}

// ---------- distant hills ----------

export type Range = {
  /** Distance from the camera (m) and the height of its crest (m); ranges are drawn far to near. */
  radius: number;
  height: number;
  /** Base colour of the crest and how much of the haze colour it takes (0 none .. 1 all): the farther, the hazier. */
  color: string;
  haze: number;
  /** Ridge shape: low `freq` = broad hills, high = jagged; `ridged` makes sharp peaks, `plateau` flat-topped mesas, `peaks` a few isolated cones. */
  freq: number;
  seed: number;
  ridged?: boolean;
  plateau?: boolean;
  peaks?: { at: number; width: number; height: number }[];
  /** Colour of the highest part (snow caps). */
  cap?: string;
};

/** Rings of far ridges around the camera, tinted toward `fog` (not fogged themselves: their haze is chosen, so the silhouettes stay readable). */
export function makeHorizon(d: Disposer, ranges: readonly Range[], fog: string): THREE.Group {
  const group = new THREE.Group();
  const fogC = new THREE.Color(fog), N = 288;
  ranges.forEach((r, ri) => {
    const pos = new Float32Array((N + 1) * 2 * 3), col = new Float32Array((N + 1) * 2 * 3), idx: number[] = [];
    const base = new THREE.Color(r.color), cap = r.cap ? new THREE.Color(r.cap) : null, tmp = new THREE.Color();
    for (let i = 0; i <= N; i++) {
      const a = ((i % N) / N) * Math.PI * 2;
      // A ridge profile that closes on itself: noise sampled on a circle.
      const cx = Math.cos(a) * r.freq, cz = Math.sin(a) * r.freq;
      let n = fbm(cx + 40 + ri * 7, cz + 40, r.seed, 4);
      if (r.ridged) n = 1 - Math.abs(n * 2 - 1);
      let h = r.height * (0.25 + 0.75 * n);
      if (r.plateau) h = r.height * (0.15 + 0.85 * smoothstep(0.42, 0.52, n)) * (0.85 + 0.15 * hash2(Math.floor(a * 20), ri, r.seed));
      for (const p of r.peaks ?? []) {
        let da = Math.abs(a - p.at);
        da = Math.min(da, Math.PI * 2 - da);
        h += p.height * Math.exp(-(da * da) / (p.width * p.width));
      }
      const x = Math.cos(a) * r.radius, z = Math.sin(a) * r.radius;
      pos.set([x, -30, z, x, h, z], i * 6);
      // Hazier at the foot, clearer at the crest; snow caps on the tops.
      for (const [k, t] of [[0, 1], [1, 0]] as const) {
        tmp.copy(base);
        if (cap && k === 1) tmp.lerp(cap, smoothstep(0.55, 0.9, h / (r.height * 1.2)));
        tmp.lerp(fogC, Math.min(1, r.haze + t * (1 - r.haze) * 0.6));
        col.set([tmp.r, tmp.g, tmp.b], i * 6 + k * 3);
      }
      if (i < N) {
        const q = i * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
    const geo = d.add(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, d.add(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: true })));
    mesh.frustumCulled = false;
    mesh.renderOrder = -9 + ri * 0.01;
    group.add(mesh);
  });
  return group;
}
