import { Adapter3D, CAM, ChaseCamera, K, type CamTarget } from "./adapter3d";
import type { Race } from "./race";
import { Car3D } from "./three/cars";
import { Disposer, type Quality, type QualityLevel, THREE, liveResources, qualityOf } from "./three/core";
import { makeEnvironment } from "./three/env";
import { Gameplay3D } from "./three/gameplay";
import { type World, buildWorld } from "./three/world";
import { DistField } from "./three/terrain";

// The 3D view of a race: one WebGL canvas laid over the 2D canvas (which then only draws the HUD). It reads the race through the adapter and
// never writes to it, so the race is the same whichever view is on. Loaded on demand (this module and Three.js are a separate chunk): the
// 2D game does not pay for them. `dispose()` frees every geometry, material, texture and the GL context itself.

export type Renderer3D = {
  /** Draws the race as it is now; `lag` = seconds the simulation has not stepped yet (carries the cars forward). */
  render(race: Race, lag: number): void;
  resize(): void;
  /** Frees everything; the renderer cannot be used afterwards. */
  dispose(): void;
  /** For the checks: put the camera somewhere else (null = the chase camera again). Positions in metres. */
  debugCamera(pose: { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov?: number } | null): void;
  /** Quality level now (0 best .. 2 lightest) and the last measured frame rate. */
  info(): { level: QualityLevel; fps: number; mode: string | null; resources: number };
};

const LOW_FPS = 40, LOW_SECONDS = 3;

/** True when a WebGL context can be made; used as the repli to 2D. */
export function createRenderer3D(host: HTMLElement): Renderer3D | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;
  return new Impl(host, renderer);
}

class Impl implements Renderer3D {
  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(CAM.FOV, 1, 0.3, 2400);
  private chase = new ChaseCamera();
  private sun = new THREE.DirectionalLight("#ffffff", 2.5);
  private hemi = new THREE.HemisphereLight("#ffffff", "#444444", 0.9);
  private d = new Disposer();
  private worldD = new Disposer();
  private raceD = new Disposer();
  private envD = new Disposer();
  private env: THREE.Texture | null = null;
  private race: Race | null = null;
  private adapter: Adapter3D | null = null;
  private world: World | null = null;
  private worldMode: string | null = null;
  private cars: Car3D[] = [];
  private play: Gameplay3D | null = null;
  private snapNext = true;
  private last = 0;
  private time = 0;
  private quality: Quality;
  private frames = { acc: 0, n: 0, fps: 60, bad: 0 };
  private onResize = () => this.resize();
  private ro: ResizeObserver | null = null;
  private lost = false;
  private reduced: boolean;
  private disposed = false;
  private debugPose: { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov?: number } | null = null;
  private sunDir = new THREE.Vector3(-0.5, 0.78, -0.42).normalize();

  constructor(host: HTMLElement, renderer: THREE.WebGLRenderer) {
    this.host = host;
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
    this.reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.quality = qualityOf(coarse ? 1 : 0, window.devicePixelRatio || 1);
    Object.assign(this.canvas.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);
    host.style.display = "block";

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor("#000000");

    const sh = this.sun.shadow;
    sh.camera.left = sh.camera.bottom = -80;
    sh.camera.right = sh.camera.top = 80;
    sh.camera.near = 20;
    sh.camera.far = 520;
    sh.bias = -0.0004;
    sh.normalBias = 0.06;
    sh.intensity = 0.8; // shadows soft enough that a road under a canopy is still a road
    this.sun.castShadow = true;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.camera);
    this.applyQuality();

    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(host);
    }
    this.canvas.addEventListener("webglcontextlost", this.onLost);
    (globalThis as { __racerz3d?: () => unknown }).__racerz3d = () => {
      const i = renderer.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, calls: i.render.calls, triangles: i.render.triangles, live: liveResources(), level: this.quality.level, fps: this.frames.fps };
    };
    this.resize();
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private applyQuality() {
    const q = this.quality, r = this.renderer;
    r.setPixelRatio(q.pixelRatio);
    this.sun.castShadow = q.shadows;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadowSize) {
      sh.mapSize.set(q.shadowSize, q.shadowSize);
      sh.map?.dispose();
      sh.map = null;
    }
    this.play?.setQuality(q);
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const w = Math.max(2, this.host.clientWidth), h = Math.max(2, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  debugCamera(pose: { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov?: number } | null) {
    this.debugPose = pose;
  }

  info() {
    return { level: this.quality.level, fps: this.frames.fps, mode: this.worldMode, resources: liveResources() };
  }

  /** Builds (or keeps) the mode's world and builds this race's cars and gameplay pieces. */
  private setRace(race: Race) {
    this.raceD.dispose();
    this.raceD = new Disposer();
    this.play?.dispose();
    for (const c of this.cars) this.scene.remove(c.group);
    this.cars = [];
    this.race = race;
    this.adapter = new Adapter3D(race);
    if (this.worldMode !== race.theme.id || !this.world) {
      if (this.world) this.scene.remove(this.world.group);
      this.worldD.dispose();
      this.worldD = new Disposer();
      const group = new THREE.Group();
      this.scene.add(group);
      const field = new DistField(race.track, 40);
      this.world = buildWorld({ adapter: this.adapter, d: this.worldD, group, quality: this.quality, field });
      this.worldMode = race.theme.id;
      const look = this.world.look;
      this.scene.fog = new THREE.Fog(look.fog, look.near, look.far);
      this.sun.color.set(look.sun);
      this.sun.intensity = look.sunIntensity;
      this.hemi.color.set(look.hemi[0]);
      this.hemi.groundColor.set(look.hemi[1]);
      this.hemi.intensity = look.hemi[2];
      this.renderer.toneMappingExposure = look.exposure;
      // What the paint and glass reflect: this mode's own sky (the cars only; the world is lit by the sun and the sky light).
      this.envD.dispose();
      this.envD = new Disposer();
      this.env = makeEnvironment(this.renderer, this.envD, look.sky[0], look.sky[1], look.sky[2], look.hemi[1], this.sunDir);
    }
    for (const v of this.adapter.cars) {
      const c = new Car3D(this.raceD, v, this.env);
      this.cars.push(c);
      this.scene.add(c.group);
    }
    const sc = this.world.scenery;
    this.play = new Gameplay3D({ adapter: this.adapter, d: this.raceD, scene: this.scene, camera: this.camera, quality: this.quality, reduced: this.reduced, cars: this.cars, mode: race.theme.id, heightAt: sc.heightAt ?? (() => 0), craterY: sc.craterY ?? 25 });
    this.snapNext = true;
  }

  render(race: Race, lag: number) {
    if (this.disposed || this.lost) return;
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.time += dt;
    if (race !== this.race) this.setRace(race);
    const a = this.adapter!, world = this.world!;
    a.refresh(lag);
    const p = a.player;

    // The camera behind the car: its direction, lift and field of view are smoothed, never its distance.
    const tgt: CamTarget = { x: p.x, y: p.y, alt: p.alt, heading: p.heading, speedRatio: p.speedRatio, boosting: p.boosting, impact: this.reduced ? 0 : p.impact };
    const shake = this.reduced ? { x: 0, y: 0 } : a.hazardShake();
    if (this.snapNext) {
      this.chase.snap(tgt, shake);
      this.snapNext = false;
    } else this.chase.update(dt, tgt, shake);
    const c = this.debugPose ? { ...this.debugPose, fov: this.debugPose.fov ?? 60 } : this.chase.pose, cam = this.camera;
    cam.position.set(c.px, c.py, c.pz);
    cam.lookAt(c.lx, c.ly, c.lz);
    if (Math.abs(cam.fov - c.fov) > 0.01) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    world.sky.position.copy(cam.position);

    // The sun follows the car (its shadow map covers ~160 m around it); a high Jet's shadow lands far off, so aim between car and ground.
    const sx = p.x * K, sz = p.y * K, sy = p.alt * 0.5;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx + this.sunDir.x * 260, sy + this.sunDir.y * 260, sz + this.sunDir.z * 260);

    for (let i = 0; i < this.cars.length; i++) this.cars[i].update(a.cars[i], dt, this.time);
    world.scenery.update?.(dt, this.time, a);
    this.play?.update(dt, this.time, cam, this.renderer.domElement.height);

    this.renderer.render(this.scene, cam);
    this.watchFrameRate(now);
  }

  /** Under 40 FPS for 3 seconds in a row: a lighter quality level (lighter shadows and fewer particles, then no shadows). */
  private watchFrameRate(now: number) {
    const f = this.frames;
    if (this.lastFrame) {
      const dt = now - this.lastFrame;
      if (dt > 0 && dt < 1000) {
        f.acc += dt;
        f.n++;
      }
    }
    this.lastFrame = now;
    if (f.acc >= 1000) {
      f.fps = (f.n * 1000) / f.acc;
      f.bad = f.fps < LOW_FPS ? f.bad + 1 : 0;
      f.acc = 0;
      f.n = 0;
      if (f.bad >= LOW_SECONDS && this.quality.level < 2) {
        this.quality = qualityOf((this.quality.level + 1) as QualityLevel, window.devicePixelRatio || 1);
        f.bad = 0;
        this.applyQuality();
      }
    }
  }
  private lastFrame = 0;

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.ro?.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.play?.dispose();
    this.raceD.dispose();
    this.worldD.dispose();
    this.envD.dispose();
    this.d.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.host.style.display = "none";
    delete (globalThis as { __racerz3d?: unknown }).__racerz3d;
    this.race = null;
    this.adapter = null;
    this.world = null;
  }
}
