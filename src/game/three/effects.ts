import { K } from "../adapter3d";
import type { Race } from "../race";
import type { ThemeId } from "../themes";
import { type Disposer, type Quality, THREE, Particles, softDisc } from "./core";

// Visual effects, all pooled: the particle pools never grow (a full pool just drops new particles), the skid marks and speed lines are fixed
// buffers rewritten each frame, and nothing is allocated per frame.

const col = new THREE.Color();
/** sRGB hex → linear 0..1 triple (what the particle shader expects). */
export function rgb(hex: string): [number, number, number] {
  col.set(hex);
  return [col.r, col.g, col.b];
}

/** The four shared pools: soft smoke and dust (normal blending), sparks and flames (additive). */
export class Effects3D {
  readonly smoke: Particles;
  readonly dust: Particles;
  readonly sparks: Particles;
  readonly fire: Particles;
  readonly straw: Particles;
  private pools: Particles[];

  constructor(d: Disposer, scene: THREE.Scene, q: Quality) {
    const soft = softDisc(d, 64);
    this.smoke = new Particles(d, 420, soft, false);
    this.dust = new Particles(d, 320, soft, false);
    this.sparks = new Particles(d, 360, soft, true);
    this.fire = new Particles(d, 240, soft, true);
    this.straw = new Particles(d, 120, null, false);
    this.pools = [this.smoke, this.dust, this.sparks, this.fire, this.straw];
    for (const p of this.pools) scene.add(p.points);
    this.setQuality(q);
  }

  setQuality(q: Quality) {
    for (const p of this.pools) p.limit = q.particles;
  }

  update(dt: number, pixelScale: number) {
    for (const p of this.pools) p.update(dt, pixelScale);
  }

  dispose() {
    for (const p of this.pools) p.points.removeFromParent();
  }

  /** A puff of dust or snow kicked up at a point. */
  puff(x: number, y: number, z: number, color: [number, number, number], alpha: number, n: number, speed: number, size = 0.9, life = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.dust.emit(x, y, z, Math.cos(a) * s, 0.6 + Math.random() * speed * 0.3, Math.sin(a) * s, size * (0.7 + Math.random() * 0.6), 2.2, life * (0.7 + Math.random() * 0.6), color[0], color[1], color[2], alpha, -0.3, 1.8);
    }
  }

  /** Hot sparks (a scrape, an impact). */
  sparkBurst(x: number, y: number, z: number, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = 0.3 + Math.random() * 0.7;
      this.sparks.emit(x, y, z, Math.cos(a) * speed * u, speed * (0.2 + Math.random() * 0.6), Math.sin(a) * speed * u, 0.16 + Math.random() * 0.1, -0.1, 0.35 + Math.random() * 0.45, 1, 0.75 + Math.random() * 0.2, 0.3, 1, 12, 0.6);
    }
  }

  smokePuff(x: number, y: number, z: number, dark: boolean, vy = 2.2) {
    const c = dark ? 0.1 : 0.32;
    this.smoke.emit(x, y, z, (Math.random() - 0.5) * 0.8, vy + Math.random(), (Math.random() - 0.5) * 0.8, 0.6, 1.6, 1.4 + Math.random() * 0.8, c, c * 0.95, c * 0.92, 0.55, -0.2, 0.4);
  }

  flame(x: number, y: number, z: number, scale = 1) {
    this.fire.emit(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, 2.4 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6, 0.55 * scale, -0.6, 0.35 + Math.random() * 0.25, 1, 0.5, 0.12, 0.9, -0.5, 0.8);
  }
}

// ---------- the road's marks: skids ----------

/** Tyre marks: the race's own skid list, drawn as dark quads on the road (a fixed buffer, fades with the skid's life). */
export class Skids3D {
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private colr: Float32Array;
  private mesh: THREE.Mesh;
  private max: number;
  private rgb: [number, number, number];

  constructor(d: Disposer, scene: THREE.Scene, race: Race, max = 700) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.colr = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    this.geo = d.add(new THREE.BufferGeometry());
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.colr, 4); ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("color", ca);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    const [r, g, b] = race.theme.colors.skid.split(",").map((v) => Number(v) / 255);
    col.setRGB(r, g, b, THREE.SRGBColorSpace);
    this.rgb = [col.r, col.g, col.b];
    this.mesh = new THREE.Mesh(this.geo, d.add(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true })));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(race: Race) {
    const skids = race.skids, n = Math.min(this.max, skids.length), w = 0.32;
    for (let i = 0; i < n; i++) {
      const s = skids[skids.length - 1 - i], ax = s.a.x * K, az = s.a.y * K, bx = s.b.x * K, bz = s.b.y * K, dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * w, nz = (dx / l) * w;
      const p = i * 12, c = i * 16, y = 0.042;
      this.pos.set([ax - nx, y, az - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, bx + nx, y, bz + nz], p);
      const a = Math.max(0, Math.min(1, s.life)) * 0.55;
      for (let k = 0; k < 4; k++) this.colr.set([this.rgb[0], this.rgb[1], this.rgb[2], a], c + k * 4);
    }
    this.geo.setDrawRange(0, n * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
  }
}

// ---------- speed lines (turbo) ----------

/** Streaks flying past the camera while the turbo runs: line segments in the camera's own space, so they cost nothing to place. */
export class SpeedLines3D {
  private mesh: THREE.LineSegments;
  private pos: Float32Array;
  private seeds: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private strength = 0;

  constructor(d: Disposer, camera: THREE.Camera, n = 44) {
    this.pos = new Float32Array(n * 6);
    this.seeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.seeds.set([Math.random() * Math.PI * 2, 0.35 + Math.random() * 0.9, Math.random()], i * 3);
    const g = d.add(new THREE.BufferGeometry());
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pa);
    this.mat = d.add(new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    camera.add(this.mesh);
  }

  update(time: number, boosting: boolean, speedRatio: number, dt: number) {
    const target = boosting ? 1 : Math.max(0, (speedRatio - 1.05) * 0.8);
    this.strength += (target - this.strength) * Math.min(1, dt * 6);
    this.mat.opacity = Math.min(0.65, this.strength * 0.6);
    this.mesh.visible = this.strength > 0.02;
    if (!this.mesh.visible) return;
    const n = this.seeds.length / 3;
    for (let i = 0; i < n; i++) {
      const a = this.seeds[i * 3], r = this.seeds[i * 3 + 1], ph = this.seeds[i * 3 + 2];
      const z = -2 - ((time * (14 + ph * 10) + ph * 40) % 40), len = 2.5 + this.strength * 4;
      const x = Math.cos(a) * r * (2 + (-z) * 0.28), y = Math.sin(a) * r * (1.2 + (-z) * 0.16);
      this.pos.set([x, y, z, x, y, z - len], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
  }
}

// ---------- ambient: snow, ash and embers, blown sand ----------

type AmbientKind = { n: number; color: string; alpha: number; size: number; wind: [number, number, number]; box: [number, number, number]; spin: number };
const AMBIENT: Partial<Record<ThemeId, AmbientKind[]>> = {
  northpole: [{ n: 700, color: "#ffffff", alpha: 0.9, size: 0.09, wind: [2.5, -2.4, 1.2], box: [90, 40, 90], spin: 1 }],
  volcano: [
    { n: 360, color: "#6a5f5b", alpha: 0.6, size: 0.1, wind: [1.5, -1.2, 0.8], box: [90, 40, 90], spin: 1 },
    { n: 70, color: "#ff8a24", alpha: 0.95, size: 0.07, wind: [1.0, 2.2, 0.5], box: [70, 35, 70], spin: 2 },
  ],
  desert: [{ n: 260, color: "#f0d9ae", alpha: 0.5, size: 0.1, wind: [9, -0.2, 2], box: [90, 24, 90], spin: 1 }],
};

/** Flakes that live in world space on a repeating lattice around the camera (they drift with the wind, the car passes through them). */
export class Ambient3D {
  private meshes: THREE.Points[] = [];
  private mats: THREE.ShaderMaterial[] = [];

  constructor(d: Disposer, scene: THREE.Scene, mode: ThemeId, quality: Quality) {
    const soft = softDisc(d, 32);
    for (const k of AMBIENT[mode] ?? []) {
      const n = Math.max(20, Math.floor(k.n * (0.4 + 0.6 * quality.particles)));
      const p = new Float32Array(n * 3), s = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        p.set([Math.random(), Math.random(), Math.random()], i * 3);
        s[i] = Math.random();
      }
      const g = d.add(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.BufferAttribute(p, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(s, 1));
      const c = new THREE.Color(k.color);
      const mat = d.add(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: k.spin > 1 ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
        uniforms: { uMap: { value: soft }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...k.box) }, uWind: { value: new THREE.Vector3(...k.wind) }, uColor: { value: c }, uAlpha: { value: k.alpha }, uSize: { value: k.size }, uScale: { value: 600 } },
        vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uWind; uniform float uSize; uniform float uScale; varying float vFade;
          void main(){ vec3 w = position * uBox + uWind * uTime * (0.6 + aSeed * 0.8) + vec3(sin(uTime * 0.7 + aSeed * 30.0), 0.0, cos(uTime * 0.6 + aSeed * 20.0)) * 0.6;
            vec3 rel = mod(w - uCam + uBox * 0.5, uBox) - uBox * 0.5; vec3 world = uCam + rel;
            vFade = 1.0 - smoothstep(0.35, 0.5, max(abs(rel.x) / uBox.x, max(abs(rel.y) / uBox.y, abs(rel.z) / uBox.z)));
            vec4 mv = viewMatrix * vec4(world, 1.0); gl_PointSize = clamp(uSize * (0.5 + aSeed) * uScale / max(0.1, -mv.z), 1.0, 40.0); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uAlpha; varying float vFade;
          void main(){ float a = texture2D(uMap, gl_PointCoord).a * uAlpha * vFade; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
          }`,
      }));
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 4;
      scene.add(pts);
      this.meshes.push(pts);
      this.mats.push(mat);
    }
  }

  update(time: number, cam: THREE.Camera, pixelScale: number) {
    for (const m of this.mats) {
      m.uniforms.uTime.value = time;
      (m.uniforms.uCam.value as THREE.Vector3).copy(cam.position);
      m.uniforms.uScale.value = pixelScale;
    }
  }

  dispose() {
    for (const m of this.meshes) m.removeFromParent();
  }
}

// ---------- the winner's fireworks ----------

const FIREWORK_COLORS = ["#ff3b3b", "#ffd23b", "#3bd1ff", "#7bff3b", "#ff3bd4", "#ffffff", "#ff8a1f", "#b36bff"].map(rgb);
type Rocket = { x: number; y: number; z: number; vx: number; vy: number; vz: number; apex: number; c: [number, number, number]; kind: number };

/**
 * Fireworks over the finish for a winner: rockets climb from beside the road ahead of the car and burst into peonies, rings and willows
 * (additive sparks from the shared pool, so they are bounded like every other effect). Purely visual.
 */
export class Fireworks3D {
  private rockets: Rocket[] = [];
  private acc = 0;
  private scale = 1;
  private reduced: boolean;

  constructor(reduced: boolean) {
    this.reduced = reduced;
  }

  setQuality(q: Quality) {
    this.scale = q.particles;
  }

  /** `origin`: scene metres and the direction the car faces. Nothing is launched while `active` is false (rockets in flight still burst). */
  update(dt: number, fx: Effects3D, active: boolean, ox: number, oz: number, heading: number) {
    const fwdX = Math.cos(heading), fwdZ = Math.sin(heading);
    if (active) {
      this.acc += dt;
      const every = this.reduced ? 0.9 : 0.3;
      while (this.acc >= every) {
        this.acc -= every;
        if (this.rockets.length >= 8) break;
        const ahead = 35 + Math.random() * 55, side = (Math.random() - 0.5) * 110;
        this.rockets.push({
          x: ox + fwdX * ahead - fwdZ * side, y: 1.5, z: oz + fwdZ * ahead + fwdX * side, vx: (Math.random() - 0.5) * 3, vy: 30 + Math.random() * 14, vz: (Math.random() - 0.5) * 3,
          apex: 42 + Math.random() * 28, c: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)], kind: Math.floor(Math.random() * 3),
        });
      }
    } else this.acc = 0;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy -= 9 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      fx.sparks.emit(r.x, r.y, r.z, (Math.random() - 0.5) * 1.5, -3, (Math.random() - 0.5) * 1.5, 0.35, -0.2, 0.45, 1, 0.7, 0.3, 0.9, 4, 0.5);
      if (r.vy < 3 || r.y >= r.apex) {
        this.burst(fx, r);
        this.rockets.splice(i, 1);
      }
    }
  }

  private burst(fx: Effects3D, r: Rocket) {
    const n = Math.max(24, Math.round(90 * this.scale)), [cr, cg, cb] = r.c;
    fx.sparks.emit(r.x, r.y, r.z, 0, 0, 0, 9, 10, 0.22, 1, 0.95, 0.8, 0.8, 0, 0); // the flash
    for (let i = 0; i < n; i++) {
      let dx: number, dy: number, dz: number, life = 1.3 + Math.random() * 0.9, speed = 13 + Math.random() * 9, grav = 8;
      if (r.kind === 1) {
        // A ring in a tilted plane.
        const a = (i / n) * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a) * 0.35;
        dz = Math.sin(a) * 0.9;
        speed = 17;
      } else {
        // A ball (peony), or a willow whose sparks hang and droop.
        const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        dx = s * Math.cos(t);
        dy = u;
        dz = s * Math.sin(t);
        if (r.kind === 2) {
          life += 0.9;
          grav = 5;
          speed *= 0.75;
        }
      }
      fx.sparks.emit(r.x, r.y, r.z, dx * speed, dy * speed, dz * speed, 0.5 + Math.random() * 0.25, -0.15, life, cr, cg, cb, 1, grav, 0.9);
    }
  }
}
