import { type Adapter3D, K } from "../adapter3d";
import { YETI } from "../modes/yeti";
import { angleDiff } from "../vec";
import { type Disposer, THREE, paintTexture, softDisc } from "./core";
import type { Effects3D } from "./effects";
import { type YetiMoment, makeYeti } from "./yeti";

// The yeti of the north pole in 3D: the animal itself (yeti.ts) following the game's jump — roaring on the massif, flying, standing where it
// landed, leaping away — the landing ring that closes in on the road before the impact, the shockwave and the snow of the landing, and the
// damage numbers over the cars it hurt. The jump, the damage and the timing are the game's (modes/yeti.ts): this only draws them.

const MOMENT: Record<"warn" | "flight" | "stand" | "leave", { moment: YetiMoment; length: number }> = {
  warn: { moment: "roar", length: YETI.WARN },
  flight: { moment: "leap", length: YETI.FLIGHT },
  stand: { moment: "stand", length: YETI.STAND },
  leave: { moment: "away", length: YETI.LEAVE },
};
/** Fade in on the perch and out at the end of the leap away (s). */
const FADE = 0.3;

const flat = (d: Disposer, g: THREE.BufferGeometry) => {
  g.rotateX(-Math.PI / 2);
  return d.add(g);
};

export class YetiFx {
  private root = new THREE.Group();
  private rig: ReturnType<typeof makeYeti>;
  private fx: Effects3D;
  private ring: THREE.Mesh;
  private disc: THREE.Mesh;
  private closing: THREE.Mesh;
  private wave: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private closeMat: THREE.MeshBasicMaterial;
  private waveMat: THREE.MeshBasicMaterial;
  private blob: THREE.Mesh;
  private blobMat: THREE.MeshBasicMaterial;
  private popups: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial }[] = [];
  private yaw = 0;
  private alpha = -1;
  private seen = { id: 0, phase: "" };
  private wavePos = { x: 0, z: 0, age: 9 };

  constructor(d: Disposer, scene: THREE.Scene, fx: Effects3D) {
    this.fx = fx;
    this.rig = makeYeti(d);
    const soft = softDisc(d, 64);
    this.rig.group.visible = false;
    this.root.add(this.rig.group);
    const R = YETI.LAND_R * K;
    this.ringMat = d.add(new THREE.MeshBasicMaterial({ color: "#ff8a1f", transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.discMat = d.add(new THREE.MeshBasicMaterial({ color: "#ff8a1f", transparent: true, opacity: 0.22, depthWrite: false, fog: false }));
    this.closeMat = d.add(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.waveMat = d.add(new THREE.MeshBasicMaterial({ color: "#eaf6ff", transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.ring = new THREE.Mesh(flat(d, new THREE.RingGeometry(R - 0.35, R, 56)), this.ringMat);
    this.disc = new THREE.Mesh(flat(d, new THREE.CircleGeometry(R - 0.35, 48)), this.discMat);
    this.closing = new THREE.Mesh(flat(d, new THREE.RingGeometry(R - 0.12, R, 64)), this.closeMat);
    this.wave = new THREE.Mesh(flat(d, new THREE.RingGeometry(0.9, 1, 64)), this.waveMat);
    for (const m of [this.ring, this.disc, this.closing, this.wave]) {
      m.visible = false;
      m.renderOrder = 3;
      this.root.add(m);
    }
    this.blobMat = d.add(new THREE.MeshBasicMaterial({ map: soft, color: "#000000", transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.blob = new THREE.Mesh(d.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.blobMat);
    this.blob.visible = false;
    this.blob.renderOrder = 2;
    this.root.add(this.blob);
    // The damage numbers.
    const text = "-" + YETI.DAMAGE;
    const tex = paintTexture(d, 128, 64, (g, w, h) => {
      g.font = "800 46px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 7;
      g.strokeStyle = "#ffffff";
      g.strokeText(text, w / 2, h / 2);
      g.fillStyle = "#ff3b2f";
      g.fillText(text, w / 2, h / 2);
    }, { mip: false });
    for (let i = 0; i < 4; i++) {
      const mat = d.add(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 30;
      this.root.add(sp);
      this.popups.push({ sprite: sp, mat });
    }
    scene.add(this.root);
  }

  update(dt: number, a: Adapter3D) {
    const y = a.dangers.yeti, pops = a.dangers.yetiPopups;
    // ---- the damage numbers ----
    this.popups.forEach((p, i) => {
      const o = pops[i];
      p.sprite.visible = !!o;
      if (!o) return;
      p.mat.opacity = Math.max(0, 1 - o.age / 0.9);
      p.sprite.position.set(o.x * K, 2.8 + o.age * 3.5, o.y * K);
      p.sprite.scale.set(2.6, 1.3, 1);
    });
    // ---- the shockwave of the landing keeps spreading after the yeti has gone ----
    this.wavePos.age += dt;
    const wu = this.wavePos.age / 0.55;
    this.wave.visible = wu < 1;
    if (this.wave.visible) {
      this.wave.position.set(this.wavePos.x, 0.12, this.wavePos.z);
      this.wave.scale.setScalar(1 + wu * (YETI.LAND_R * K * 1.5));
      this.waveMat.opacity = 0.7 * (1 - wu);
    }
    if (!y) {
      this.rig.group.visible = false;
      this.ring.visible = this.disc.visible = this.closing.visible = this.blob.visible = false;
      this.seen.phase = "";
      return;
    }
    const x = y.x * K, z = y.y * K;
    // ---- the animal ----
    const m = MOMENT[y.phase];
    this.rig.group.visible = true;
    this.rig.group.position.set(x, y.z, z);
    if (this.seen.id !== y.id) this.yaw = -y.heading;
    this.yaw += angleDiff(this.yaw, -y.heading) * Math.min(1, dt * 9);
    this.rig.group.rotation.y = this.yaw;
    this.rig.pose(m.moment, y.age / m.length, a.race.time);
    const alpha = y.phase === "warn" ? Math.min(1, y.age / FADE) : y.phase === "leave" ? Math.min(1, (YETI.LEAVE - y.age) / FADE) : 1;
    const q = Math.round(Math.max(0, alpha) * 10) / 10;
    if (q !== this.alpha) {
      this.alpha = q;
      this.rig.setAlpha(q);
    }
    // ---- its shadow on the ground while it flies ----
    const high = y.phase === "flight" || y.phase === "leave";
    this.blob.visible = high;
    if (high) {
      this.blob.position.set(x, 0.1, z);
      this.blob.rotation.y = this.yaw;
      this.blob.scale.set(7 + y.z * 0.15, 1, 6 + y.z * 0.12);
      this.blobMat.opacity = Math.max(0, 0.5 * (1 - y.z / 40)) * q;
    }
    // ---- the landing ring, closing in until the impact ----
    const warning = y.phase === "warn" || y.phase === "flight";
    this.ring.visible = this.disc.visible = this.closing.visible = warning;
    if (warning) {
      const tx = y.toX * K, tz = y.toY * K, blink = y.left < 0.5 && Math.floor(a.race.time * 12) % 2 === 0;
      this.ring.position.set(tx, 0.09, tz);
      this.disc.position.set(tx, 0.08, tz);
      this.closing.position.set(tx, 0.1, tz);
      this.ringMat.opacity = blink ? 0.3 : 0.95;
      this.discMat.opacity = blink ? 0.06 : 0.26 + 0.08 * Math.sin(a.race.time * 14);
      this.closing.scale.setScalar(1 + 1.4 * Math.min(1, y.left / (YETI.WARN + YETI.FLIGHT)));
    }
    // ---- what happens at each change of moment ----
    if (this.seen.id !== y.id || this.seen.phase !== y.phase) {
      if (y.phase === "warn") this.fx.puff(x, y.z, z, [1, 1, 1], 0.8, 14, 4, 1.6, 1.4); // snow shaken off the crown
      if (y.phase === "flight") this.fx.puff(x, y.z, z, [1, 1, 1], 0.85, 16, 6, 1.8, 1.2); // the spring
      if (y.phase === "stand") {
        this.fx.puff(x, 0.4, z, [1, 1, 1], 0.9, 40, 10, 2.4, 1.8); // the cloud of the landing
        this.fx.sparkBurst(x, 0.6, z, 18, 9);
        this.wavePos.x = x;
        this.wavePos.z = z;
        this.wavePos.age = 0;
      }
      if (y.phase === "leave") this.fx.puff(x, 0.4, z, [1, 1, 1], 0.7, 12, 5, 1.6, 1.2);
      this.seen.id = y.id;
      this.seen.phase = y.phase;
    }
  }

  dispose() {
    this.root.removeFromParent();
  }
}
