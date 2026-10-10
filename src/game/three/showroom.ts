import type { CarView } from "../adapter3d";
import { type ModelId, type Skin } from "../garage";
import { Lru, Orbit, carKey, carRadius, stageWing } from "../garageView";
import { Car3D } from "./cars";
import { Disposer, type Quality, type QualityLevel, THREE, paintTexture, qualityOf } from "./core";
import { makeEnvironment } from "./env";

// The 3D garage: a showroom stage for the lobby. A turntable under a key light and two coloured rim lights, the studio's soft boxes in the
// paint, the car on it in the skin being looked at; drag to turn it. The same renderer also takes the small pictures of every car and skin the
// lobby's lists show (rendered into a corner of the canvas, copied out, cached). Loaded on demand with Three.js: the 2D game and the lobby's
// first paint do not wait for it. `dispose()` frees every geometry, material, texture, render target and the GL context.

export type Showroom = {
  /** Puts this car, in this paint, on the turntable (a car built once is kept for a while: coming back to it is instant). */
  show(model: ModelId, skin: Skin): void;
  /** A small picture (data URL, transparent background) of a car in a paint, 3/4 view; null when it cannot be made. Queued, one per tick. */
  thumb(model: ModelId, skin: Skin, o?: { wing?: number; w?: number; h?: number }): Promise<string | null>;
  resize(): void;
  /** Frees everything; unusable afterwards. */
  dispose(): void;
  info(): { cars: number; resources: number; fps: number; level: QualityLevel; yaw: number };
};

/** Turntable radius and height (m). The car stands on it. */
export const TURNTABLE = { R: 3.3, H: 0.16 };
const LOW_FPS = 30, LOW_SECONDS = 3;

/** The stage: turntable, its light ring, the glow and the floor. Pure geometry, no GL needed (the checks build it in Node). */
export function buildStage(d: Disposer) {
  const group = new THREE.Group();
  const { R, H } = TURNTABLE;
  const top = paintTexture(d, 512, 512, (g, w, h) => {
    g.fillStyle = "#1f2731";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#3a4757";
    g.lineWidth = 2;
    for (const r of [0.28, 0.5, 0.74, 0.93]) {
      g.beginPath();
      g.arc(w / 2, h / 2, (r * w) / 2, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = 3;
    g.strokeStyle = "#566678";
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, r0 = i % 6 ? 0.9 : 0.86;
      g.beginPath();
      g.moveTo(w / 2 + Math.cos(a) * r0 * (w / 2), h / 2 + Math.sin(a) * r0 * (h / 2));
      g.lineTo(w / 2 + Math.cos(a) * 0.97 * (w / 2), h / 2 + Math.sin(a) * 0.97 * (h / 2));
      g.stroke();
    }
  });
  const topMat = d.add(new THREE.MeshStandardMaterial({ color: "#c9d3e0", roughness: 0.42, metalness: 0.8, ...(top ? { map: top } : {}) }));
  const sideMat = d.add(new THREE.MeshStandardMaterial({ color: "#10141a", roughness: 0.5, metalness: 0.8 }));
  const disc = new THREE.Mesh(d.add(new THREE.CylinderGeometry(R, R + 0.12, H, 96)), [sideMat, topMat, sideMat]);
  disc.position.y = H / 2;
  disc.receiveShadow = true;
  group.add(disc);

  // The ring of light round the edge, and the glow it throws on the floor.
  const ringMat = d.add(new THREE.MeshBasicMaterial({ color: "#8fd8ff", toneMapped: false }));
  const ring = new THREE.Mesh(d.add(new THREE.TorusGeometry(R + 0.02, 0.03, 8, 160).rotateX(Math.PI / 2)), ringMat);
  ring.position.y = H + 0.004;
  group.add(ring);
  const glowTex = paintTexture(d, 256, 256, (g, w) => {
    const c = w / 2, grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.62, "rgba(255,255,255,0)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  }, { mip: false });
  const glow = new THREE.Mesh(
    d.add(new THREE.PlaneGeometry((R + 3) * 2, (R + 3) * 2).rotateX(-Math.PI / 2)),
    d.add(new THREE.MeshBasicMaterial({ color: "#4fa8e8", transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...(glowTex ? { map: glowTex } : {}) })),
  );
  glow.position.y = 0.01;
  group.add(glow);

  // The floor: dark and a little glossy, fading into nothing at the edges so it sits on the page's own background.
  const fade = paintTexture(d, 256, 256, (g, w) => {
    const c = w / 2, grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.35, "#c8c8c8");
    grad.addColorStop(1, "#000000");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  }, { mip: false, srgb: false });
  const floor = new THREE.Mesh(
    d.add(new THREE.CircleGeometry(26, 64).rotateX(-Math.PI / 2)),
    d.add(new THREE.MeshStandardMaterial({ color: "#0d1219", roughness: 0.55, metalness: 0.65, transparent: true, ...(fade ? { alphaMap: fade } : { opacity: 0.6 }) })),
  );
  floor.receiveShadow = true;
  group.add(floor);
  return { group, ring, ringMat, floor };
}

type Entry = { key: string; model: ModelId; skin: Skin; car: Car3D; view: CarView; d: Disposer };

const blank = (model: ModelId, skin: Skin): CarView => ({
  id: 0, isPlayer: false, model, skin, x: 0, y: 0, heading: 0, alt: 0, speed: 0, boosting: false, health: 1, wing: 0, flame: 0, finished: false, stunned: false,
});

/** Asks for a throw-away context first: Three.js logs an error for every renderer it fails to make, and an old phone would log it on every visit. */
function webglAvailable(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** True when a WebGL context can be made; null is the lobby's repli to the 2D pictures. */
export function createShowroom(host: HTMLElement, onLost?: () => void): Showroom | null {
  if (!webglAvailable()) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    // preserveDrawingBuffer: the pictures are read back from the canvas right after they are drawn.
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "default", preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;
  return new Impl(host, renderer, onLost);
}

class Impl implements Showroom {
  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private onLostCb?: () => void;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);
  private tcam = new THREE.PerspectiveCamera(26, 1.6, 0.5, 120);
  private key = new THREE.DirectionalLight("#ffffff", 3.4);
  private d = new Disposer();
  private envD = new Disposer();
  private env: THREE.Texture | null = null;
  private stage;
  private thumbGround: THREE.Mesh;
  private pivot = new THREE.Group();
  private tpivot = new THREE.Group();
  private cars: Lru<Entry>;
  private shown: Entry | null = null;
  private orbit = new Orbit();
  private quality: Quality;
  private appear = 1;
  private shownAt = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  private lost = false;
  private disposed = false;
  private still: boolean;
  private frames = { acc: 0, n: 0, fps: 60, bad: 0 };
  private lastFrame = 0;
  private queue: { model: ModelId; skin: Skin; wing: number; w: number; h: number; done: (u: string | null) => void }[] = [];
  private pumping = false;
  private cache = new Map<string, string | null>();
  private pointer: { id: number; x: number; y: number; t: number } | null = null;

  constructor(host: HTMLElement, renderer: THREE.WebGLRenderer, onLost?: () => void) {
    this.host = host;
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.onLostCb = onLost;
    const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
    this.still = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.quality = qualityOf(coarse ? 1 : 0, window.devicePixelRatio || 1);
    Object.assign(this.canvas.style, { width: "100%", height: "100%", display: "block", touchAction: "pan-y", cursor: "grab" });
    this.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.canvas);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    // Studio: the soft boxes the paint reflects, a key light with soft shadows, two coloured rims from behind, a dim fill.
    const sunDir = new THREE.Vector3(-0.45, 0.82, 0.36);
    this.env = makeEnvironment(renderer, this.envD, "#0b1017", "#1a2430", "#3b516a", "#06080b", sunDir);
    this.key.position.set(-5, 9, 6.5);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -6;
    sc.right = sc.top = 6;
    sc.near = 2;
    sc.far = 30;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.intensity = 0.85;
    const rimA = new THREE.DirectionalLight("#5aa6ff", 2.4), rimB = new THREE.DirectionalLight("#ff9448", 1.9);
    rimA.position.set(-6, 3.5, -7);
    rimB.position.set(7, 3, -6);
    const hemi = new THREE.HemisphereLight("#a9bdd8", "#12171f", 0.55);
    this.scene.add(this.key, this.key.target, rimA, rimB, hemi);

    this.stage = buildStage(this.d);
    this.scene.add(this.stage.group, this.pivot, this.tpivot);
    // A shadow catcher for the pictures (they have no turntable under them).
    this.thumbGround = new THREE.Mesh(
      this.d.add(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2)),
      this.d.add(new THREE.ShadowMaterial({ opacity: 0.45 })),
    );
    this.thumbGround.receiveShadow = true;
    this.thumbGround.visible = false;
    this.scene.add(this.thumbGround);
    this.cars = new Lru<Entry>(10, (_k, e) => e.d.dispose(), (e) => e === this.shown);
    this.applyQuality();

    this.canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(host);
    }
    this.canvas.addEventListener("webglcontextlost", this.onLost);
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  private ro: ResizeObserver | null = null;
  private onResize = () => this.resize();
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.onLostCb?.();
  };

  private applyQuality() {
    const q = this.quality;
    this.renderer.setPixelRatio(q.pixelRatio);
    this.key.castShadow = q.shadows;
    if (this.key.shadow.mapSize.x !== q.shadowSize) {
      this.key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const w = Math.max(2, this.host.clientWidth), h = Math.max(2, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- the player turns the car ----
  private onDown = (e: PointerEvent) => {
    if (this.pointer) return;
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    this.orbit.grab();
    this.canvas.style.cursor = "grabbing";
  };
  private onMove = (e: PointerEvent) => {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    const now = performance.now();
    this.orbit.drag(e.clientX - p.x, e.clientY - p.y, (now - p.t) / 1000);
    p.x = e.clientX;
    p.y = e.clientY;
    p.t = now;
  };
  private onUp = (e: PointerEvent) => {
    if (!this.pointer || e.pointerId !== this.pointer.id) return;
    this.pointer = null;
    this.orbit.release();
    this.canvas.style.cursor = "grab";
  };

  // ---- cars ----
  private entry(model: ModelId, skin: Skin): Entry {
    const key = carKey(model, skin), hit = this.cars.get(key);
    if (hit) return hit;
    const d = new Disposer(), view = blank(model, skin);
    const e: Entry = { key, model, skin, car: new Car3D(d, view, this.env), view, d };
    this.cars.set(key, e);
    return e;
  }

  show(model: ModelId, skin: Skin) {
    if (this.disposed || this.lost) return;
    const e = this.entry(model, skin);
    if (e === this.shown) return;
    if (this.shown) this.pivot.remove(this.shown.car.group);
    const first = !this.shown, same = this.shown?.model === model;
    this.shown = e;
    this.pivot.add(e.car.group);
    if (!same) this.shownAt = this.time; // the Jet's wings start their demo again
    this.appear = first || same ? 1 : 0; // a different car grows in; a different paint on the same car just changes
  }

  // ---- the frame ----
  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden || this.lost) return;
    const now = performance.now(), dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.time += dt;
    this.draw(dt);
    this.watchFrameRate(now);
  };

  private draw(dt: number) {
    const e = this.shown;
    if (e) {
      const wing = e.model === "jet" ? stageWing(this.time - this.shownAt, this.still) : 0;
      e.view.wing = wing;
      e.view.alt = TURNTABLE.H;
      e.car.update(e.view, dt, this.time);
      this.appear = Math.min(1, this.appear + dt * 4);
      const s = 0.88 + 0.12 * (1 - Math.pow(1 - this.appear, 3));
      this.pivot.scale.setScalar(s);
      this.pivot.rotation.y = this.orbit.yaw;
      const want = Orbit.fit(carRadius(e.model, wing), this.camera.fov, this.camera.aspect);
      this.orbit.update(dt, !this.still, want);
    }
    const ty = 0.8, [px, py, pz] = this.orbit.position(ty);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(0, ty, 0);
    this.key.target.position.set(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Under 30 FPS for 3 seconds in a row: a lighter quality level. */
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

  // ---- the small pictures ----
  thumb(model: ModelId, skin: Skin, o: { wing?: number; w?: number; h?: number } = {}): Promise<string | null> {
    const wing = o.wing ?? 0, w = o.w ?? 240, h = o.h ?? 150, key = `${carKey(model, skin)}|${wing}|${w}x${h}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key) ?? null);
    return new Promise((done) => {
      this.queue.push({ model, skin, wing, w, h, done: (u) => {
        this.cache.set(key, u);
        done(u);
      } });
      this.pump();
    });
  }

  /** One picture per tick, so a lobby asking for twenty does not freeze the page. */
  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    const step = () => {
      const job = this.queue.shift();
      if (!job || this.disposed) {
        this.pumping = false;
        if (this.disposed) for (const j of this.queue) j.done(null);
        this.queue = [];
        return;
      }
      let url: string | null = null;
      try {
        url = this.snapshot(this.entry(job.model, job.skin), job.wing, job.w, job.h);
      } catch {
        url = null;
      }
      job.done(url);
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  private snapshot(e: Entry, wing: number, w: number, h: number): string | null {
    if (this.disposed || this.lost) return null;
    const r = this.renderer, pr = r.getPixelRatio(), cw = this.canvas.width, ch = this.canvas.height, wpx = Math.round(w * pr), hpx = Math.round(h * pr);
    if (wpx > cw || hpx > ch || wpx < 8 || hpx < 8) return null;
    const out = document.createElement("canvas");
    out.width = wpx;
    out.height = hpx;
    const g = out.getContext("2d");
    if (!g) return null;
    // Only the car (and a shadow catcher) in the scene, drawn into the canvas's top-left corner.
    const parent = e.car.group.parent;
    this.stage.group.visible = false;
    this.pivot.visible = false;
    this.thumbGround.visible = true;
    this.tpivot.add(e.car.group);
    this.tpivot.rotation.y = -0.62;
    e.view.wing = wing;
    e.view.alt = 0;
    e.car.update(e.view, 0, 0);
    const radius = carRadius(e.model, wing), dist = Orbit.fit(radius, this.tcam.fov, w / h, 0.95);
    this.tcam.aspect = w / h;
    this.tcam.updateProjectionMatrix();
    this.tcam.position.set(0, 0.62 + dist * Math.sin(0.2), dist * Math.cos(0.2));
    this.tcam.lookAt(0, 0.62, 0);
    const cssH = ch / pr, cssW = cw / pr;
    r.setScissorTest(true);
    r.setViewport(0, cssH - h, w, h);
    r.setScissor(0, cssH - h, w, h);
    r.clear();
    r.render(this.scene, this.tcam);
    g.drawImage(this.canvas, 0, 0, wpx, hpx, 0, 0, wpx, hpx);
    let url = out.toDataURL("image/webp", 0.92);
    if (!url.startsWith("data:image/webp")) url = out.toDataURL("image/png");
    // Back to the stage: the car where it was, then a whole frame so the canvas never keeps the picture's corner.
    r.setScissorTest(false);
    r.setViewport(0, 0, cssW, cssH);
    this.tpivot.remove(e.car.group);
    if (parent) parent.add(e.car.group);
    this.stage.group.visible = true;
    this.pivot.visible = true;
    this.thumbGround.visible = false;
    this.draw(0);
    return url;
  }

  info() {
    return { cars: this.cars.size, resources: this.d.size + this.envD.size, fps: this.frames.fps, level: this.quality.level, yaw: this.orbit.yaw };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("resize", this.onResize);
    this.ro?.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.cars.clear();
    this.shown = null;
    for (const j of this.queue) j.done(null);
    this.queue = [];
    this.envD.dispose();
    this.d.dispose();
    this.key.shadow.map?.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
