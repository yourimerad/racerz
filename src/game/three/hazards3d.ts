import { type Adapter3D, K, eruptionToWorld } from "../adapter3d";
import { HZ, HZ_SCALE } from "../modes/volcano";
import { makeBear } from "./bear";
import { type Disposer, THREE, paintTexture, softDisc } from "./core";
import type { Effects3D } from "./effects";
import { rgb } from "./effects";

// The modes' dangers in 3D, mirroring the game's own state (the volcano's targets, bombs, pools and eruption; the polar bear and its alert).
// The timelines, spawns and damage are the game's: this only turns what they hold into things you can see.

const S = HZ_SCALE;
const TGT_R = HZ.TARGET_R * S * K;
const POOL_R = HZ.POOL_RADIUS * S * K;

type TargetMesh = { group: THREE.Group; fill: THREE.MeshBasicMaterial; ring: THREE.MeshBasicMaterial; closing: THREE.Mesh; bomb: THREE.Mesh; bombGlow: THREE.Mesh; shadow: THREE.Mesh; id: number };
type PoolMesh = { group: THREE.Group; crust: THREE.MeshStandardMaterial; layers: THREE.MeshStandardMaterial[]; halo: THREE.MeshBasicMaterial; id: number };
type Sprite = { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; age: number };

const flat = (d: Disposer, g: THREE.BufferGeometry) => {
  g.rotateX(-Math.PI / 2);
  return d.add(g);
};

/** The volcano's eruption and aimed bombs. */
export class VolcanoFx {
  private root = new THREE.Group();
  private bombs: THREE.InstancedMesh;
  private cores: THREE.InstancedMesh;
  private targets: TargetMesh[] = [];
  private pools: PoolMesh[] = [];
  private flashes: Sprite[] = [];
  private popups: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial }[] = [];
  private popTex: Record<string, THREE.Texture | null> = {};
  private rings: THREE.Mesh[] = [];
  private crater: THREE.Sprite;
  private craterMat: THREE.SpriteMaterial;
  private seen = new Set<number>();
  private last = { smoke: 0, sparks: 0, bubbles: 0, bombs: 0 };
  private m = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private craterPos: { x: number; z: number; y: number };
  private ember = rgb("#ff8a24");
  private shown = new Set<number>();

  private fx: Effects3D;
  private heightAt: (x: number, y: number) => number;
  private reduced: boolean;

  constructor(d: Disposer, scene: THREE.Scene, fx: Effects3D, heightAt: (x: number, y: number) => number, reduced: boolean, craterY: number) {
    this.fx = fx;
    this.heightAt = heightAt;
    this.reduced = reduced;
    const soft = softDisc(d, 64);
    const crater = eruptionToWorld(340, 225);
    this.craterPos = { x: crater.x * K, z: crater.y * K, y: craterY };
    // The eruption's bombs: glowing rocks (an outer orange body and a yellow heart), at most as many as the game's own cap.
    const bg = d.add(new THREE.IcosahedronGeometry(1, 1));
    this.bombs = new THREE.InstancedMesh(bg, d.add(new THREE.MeshBasicMaterial({ color: "#ff6a1a", fog: false })), 260);
    this.cores = new THREE.InstancedMesh(bg, d.add(new THREE.MeshBasicMaterial({ color: "#ffe28a", fog: false })), 260);
    for (const m of [this.bombs, this.cores]) {
      m.frustumCulled = false;
      m.count = 0;
      this.root.add(m);
    }
    // The shock wave of each blast: a flat ring that races outward.
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(flat(d, new THREE.RingGeometry(0.92, 1, 64)), d.add(new THREE.MeshBasicMaterial({ color: "#ffe4aa", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
      r.visible = false;
      r.position.set(this.craterPos.x, craterY + 1, this.craterPos.z);
      this.root.add(r);
      this.rings.push(r);
    }
    this.craterMat = d.add(new THREE.SpriteMaterial({ map: soft, color: "#ffd88a", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.crater = new THREE.Sprite(this.craterMat);
    this.crater.position.set(this.craterPos.x, craterY + 6, this.craterPos.z);
    this.root.add(this.crater);

    // Targets (red rings on the road, with the falling bomb and its growing shadow).
    const ringGeo = flat(d, new THREE.RingGeometry(TGT_R - 0.2, TGT_R, 40)), discGeo = flat(d, new THREE.CircleGeometry(TGT_R, 40));
    const closeGeo = flat(d, new THREE.RingGeometry(0.97, 1, 48)), crossGeo = flat(d, new THREE.PlaneGeometry(TGT_R * 0.5, 0.1)), bombGeo = d.add(new THREE.SphereGeometry(0.55, 12, 8));
    for (let i = 0; i < HZ.MAX_TARGETS + 1; i++) {
      const g = new THREE.Group();
      const ring = d.add(new THREE.MeshBasicMaterial({ color: "#ff3b2f", transparent: true, depthWrite: false, fog: false }));
      const fill = d.add(new THREE.MeshBasicMaterial({ color: "#ff3b2f", transparent: true, opacity: 0.2, depthWrite: false, fog: false }));
      const closing = new THREE.Mesh(closeGeo, d.add(new THREE.MeshBasicMaterial({ color: "#ff5a48", transparent: true, opacity: 0.6, depthWrite: false, fog: false })));
      const cross = d.add(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      const shadow = new THREE.Mesh(flat(d, new THREE.CircleGeometry(1, 20)), d.add(new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.4, depthWrite: false })));
      const bomb = new THREE.Mesh(bombGeo, d.add(new THREE.MeshBasicMaterial({ color: "#ff8a24", fog: false })));
      const bombGlow = new THREE.Mesh(bombGeo, d.add(new THREE.MeshBasicMaterial({ color: "#ffe28a", fog: false })));
      bombGlow.scale.setScalar(0.5);
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        m.renderOrder = 3;
        g.add(m);
      };
      mk(discGeo, fill, 0.06);
      mk(ringGeo, ring, 0.08);
      mk(crossGeo, cross, 0.09);
      const c2 = new THREE.Mesh(crossGeo, cross);
      c2.rotation.y = Math.PI / 2;
      c2.position.y = 0.09;
      g.add(c2);
      closing.position.y = 0.07;
      shadow.position.y = 0.05;
      g.add(closing, shadow);
      g.add(bomb, bombGlow);
      g.visible = false;
      this.root.add(g);
      this.targets.push({ group: g, fill, ring, closing, bomb, bombGlow, shadow, id: 0 });
    }

    // Pools of lava: a dark crust and three glowing layers, a halo; irregular by a per-pool stretch and turn.
    const layerGeo = flat(d, new THREE.CircleGeometry(1, 28)), haloGeo = flat(d, new THREE.PlaneGeometry(2, 2));
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const crust = d.add(new THREE.MeshStandardMaterial({ color: "#3a1410", roughness: 1 }));
      const rim = new THREE.Mesh(layerGeo, d.add(new THREE.MeshStandardMaterial({ color: "#1a0a07", roughness: 1 })));
      rim.scale.setScalar(POOL_R * 1.08);
      rim.position.y = 0.06;
      const base = new THREE.Mesh(layerGeo, crust);
      base.scale.setScalar(POOL_R);
      base.position.y = 0.07;
      g.add(rim, base);
      const layers: THREE.MeshStandardMaterial[] = [];
      ["#e8461a", "#ff8a24", "#ffd45a"].forEach((c, k) => {
        const mat = d.add(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2, roughness: 0.6, transparent: true }));
        const m = new THREE.Mesh(layerGeo, mat);
        m.scale.setScalar(POOL_R * [0.8, 0.55, 0.3][k]);
        m.position.y = 0.08 + k * 0.012;
        g.add(m);
        layers.push(mat);
      });
      const halo = d.add(new THREE.MeshBasicMaterial({ color: "#ff6a1f", map: soft, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const hm = new THREE.Mesh(haloGeo, halo);
      hm.scale.setScalar(POOL_R * 3);
      hm.position.y = 0.12;
      g.add(hm);
      g.visible = false;
      this.root.add(g);
      this.pools.push({ group: g, crust, layers, halo, id: 0 });
    }
    // Flashes (explosions) and the "-20" popups.
    for (let i = 0; i < 6; i++) {
      const mat = d.add(new THREE.SpriteMaterial({ map: soft, color: "#ffb347", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      this.root.add(sp);
      this.flashes.push({ sprite: sp, mat, age: 9 });
    }
    for (const t of ["-20", "-5"]) {
      this.popTex[t] = paintTexture(d, 128, 64, (g, w, h) => {
        g.font = "800 46px system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.lineWidth = 7;
        g.strokeStyle = "#ffffff";
        g.strokeText(t, w / 2, h / 2);
        g.fillStyle = "#ff3b2f";
        g.fillText(t, w / 2, h / 2);
      }, { mip: false });
    }
    for (let i = 0; i < 6; i++) {
      const mat = d.add(new THREE.SpriteMaterial({ map: this.popTex["-20"], transparent: true, depthTest: false, fog: false }));
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 30;
      this.root.add(sp);
      this.popups.push({ sprite: sp, mat });
    }
    scene.add(this.root);
  }

  private flash(x: number, y: number, z: number, size: number) {
    const f = this.flashes.find((s) => s.age > 0.3) ?? this.flashes[0];
    f.age = 0;
    f.sprite.position.set(x, y, z);
    f.sprite.userData.size = size;
    f.sprite.visible = true;
  }

  update(dt: number, time: number, a: Adapter3D) {
    const e = a.eruption(), hz = a.volcano(), dg = a.dangers, cp = this.craterPos;
    // ---- the eruption: bombs in flight ----
    const nb = Math.min(260, dg.bombs.length);
    for (let i = 0; i < nb; i++) {
      const b = dg.bombs[i], y = this.heightAt(b.x, b.y) + b.z + 0.4, r = Math.max(0.25, b.r * (1 + b.z / 40));
      this.pos.set(b.x * K, y, b.y * K);
      this.scl.setScalar(r);
      this.m.compose(this.pos, this.quat, this.scl);
      this.bombs.setMatrixAt(i, this.m);
      this.scl.setScalar(r * 0.55);
      this.m.compose(this.pos, this.quat, this.scl);
      this.cores.setMatrixAt(i, this.m);
      if (i < 24 && Math.random() < 0.25) this.fx.fire.emit(b.x * K, y, b.y * K, 0, 0.5, 0, r * 1.6, -0.8, 0.45, 1, 0.45, 0.1, 0.7, 0, 1);
    }
    this.bombs.count = this.cores.count = nb;
    this.bombs.instanceMatrix.needsUpdate = this.cores.instanceMatrix.needsUpdate = true;
    if (e) {
      // New smoke, sparks and lake bubbles the game spawned this step become a plume, a spray and pops of lava in 3D.
      const dSmoke = e.spawned.smoke - this.last.smoke, dSparks = e.spawned.sparks - this.last.sparks, dBub = e.spawned.bubbles - this.last.bubbles;
      this.last.smoke = e.spawned.smoke;
      this.last.sparks = e.spawned.sparks;
      this.last.bubbles = e.spawned.bubbles;
      for (let i = 0; i < Math.min(dSmoke, 40); i++) {
        const ang = Math.random() * Math.PI * 2, rr = Math.random() * 5, up = 7 + Math.random() * 12;
        const c = 0.22 + Math.random() * 0.1;
        this.fx.smoke.emit(cp.x + Math.cos(ang) * rr, cp.y + 3, cp.z + Math.sin(ang) * rr, Math.cos(ang) * 2.2, up, Math.sin(ang) * 2.2, 6 + Math.random() * 5, 4.5, 6 + Math.random() * 4, c * 1.3, c, c * 0.9, 0.5, -0.4, 0.15);
      }
      for (let i = 0; i < Math.min(dSparks, 60); i++) {
        const ang = Math.random() * Math.PI * 2, s = 6 + Math.random() * 20;
        this.fx.sparks.emit(cp.x, cp.y + 4, cp.z, Math.cos(ang) * s, 8 + Math.random() * 20, Math.sin(ang) * s, 0.35, -0.2, 0.7 + Math.random() * 0.6, 1, 0.65, 0.2, 1, 14, 0.2);
      }
      for (let i = 0; i < Math.min(dBub, 6); i++) {
        const ang = Math.random() * Math.PI * 2, rr = Math.random() * 12;
        this.fx.sparks.emit(cp.x + Math.cos(ang) * rr, cp.y + 0.6, cp.z + Math.sin(ang) * rr, 0, 2.5, 0, 0.9, -1.6, 0.5, this.ember[0], this.ember[1], this.ember[2], 0.9, 6, 0.5);
      }
      // A continuous light smoke from the crater, thicker in the fountain.
      const rate = e.erupted ? 0.5 : 0.12;
      if (Math.random() < rate * dt * 30) this.fx.smoke.emit(cp.x + (Math.random() - 0.5) * 8, cp.y + 2, cp.z + (Math.random() - 0.5) * 8, 0.6, 4 + Math.random() * 3, 0.4, 3.5, 2.2, 5, 0.2, 0.17, 0.16, 0.35, -0.2, 0.2);
      // The first blast's ring and the flash over the crater.
      e.rings.forEach((rg, i) => {
        const m = this.rings[i];
        if (!m) return;
        const u = rg.age;
        m.visible = u < 1;
        m.scale.setScalar((38 + u * 250) * 0.3);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.pow(Math.max(0, 1 - u), 1.5);
      });
      for (let i = e.rings.length; i < this.rings.length; i++) this.rings[i].visible = false;
      this.craterMat.opacity = Math.min(1, e.flash * (this.reduced ? 0.4 : 1));
      this.crater.scale.setScalar(20 + e.flash * 40);
    }
    // ---- aimed targets and the falling bombs ----
    const live = new Set<number>();
    dg.targets.forEach((t, i) => {
      const tm = this.targets[i];
      if (!tm) return;
      live.add(t.id);
      const gx = t.x * K, gz = t.y * K, gy = this.heightAt(t.x, t.y);
      tm.group.visible = true;
      tm.group.position.set(gx, gy, gz);
      tm.id = t.id;
      const left = t.left, blink = left < 0.5 && !this.reduced ? (Math.sin((HZ.WARN_TIME - left) * 40) > 0 ? 1 : 0.35) : 1;
      tm.ring.opacity = blink;
      tm.fill.opacity = 0.2 * blink;
      const closeR = TGT_R + (9 + 14 * (left / HZ.WARN_TIME)) * S * K;
      tm.closing.scale.set(closeR, 1, closeR);
      const falling = left < HZ.FALL_TIME, k = falling ? 1 - left / HZ.FALL_TIME : 0, z = 37 * (1 - k * k);
      tm.bomb.visible = tm.bombGlow.visible = falling;
      tm.shadow.visible = falling;
      if (falling) {
        tm.bomb.position.y = tm.bombGlow.position.y = 0.6 + z;
        const s = 0.4 + 1.3 * k;
        tm.shadow.scale.set(s, 1, s);
        this.fx.fire.emit(gx, gy + 0.6 + z, gz, 0, 1.5, 0, 0.9, -1, 0.4, 1, 0.5, 0.12, 0.8, 0, 1);
      }
    });
    for (let i = dg.targets.length; i < this.targets.length; i++) this.targets[i].group.visible = false;
    // A target that is gone has landed: the explosion.
    for (const id of this.seen) {
      if (live.has(id)) continue;
      const prev = this.lastTargets.get(id);
      if (!prev) continue;
      const y = this.heightAt(prev.x, prev.y);
      this.flash(prev.x * K, y + 1.2, prev.y * K, 9);
      this.fx.sparkBurst(prev.x * K, y + 0.6, prev.y * K, 16, 11);
      for (let j = 0; j < 5; j++) this.fx.smokePuff(prev.x * K + (Math.random() - 0.5) * 2, y + 0.8, prev.y * K + (Math.random() - 0.5) * 2, true, 2.5);
    }
    this.seen = live;
    this.lastTargets.clear();
    for (const t of dg.targets) this.lastTargets.set(t.id, { x: t.x, y: t.y });
    // ---- pools of lava ----
    const keep = new Set<number>();
    dg.pools.forEach((p) => {
      const pm = this.pools.find((q) => q.id === p.id && q.group.visible) ?? this.pools.find((q) => !q.group.visible);
      if (!pm) return;
      pm.id = p.id;
      keep.add(p.id);
      pm.group.visible = true;
      pm.group.position.set(p.x * K, this.heightAt(p.x, p.y), p.y * K);
      pm.group.rotation.y = (p.id * 2.399) % 6.28;
      pm.group.scale.set(0.9 + (p.shape[0] - 0.85) * 0.8, 1, 0.9 + (p.shape[3] - 0.85) * 0.8);
      const heat = p.heat;
      pm.layers.forEach((m, k) => {
        m.opacity = heat > 0.02 ? Math.min(1, heat * 1.3) * p.fade : 0;
        m.emissiveIntensity = (0.5 + heat * 1.6) * (1 + 0.1 * Math.sin(time * (3 + k) + p.id));
      });
      pm.crust.color.setRGB(0.04 + 0.05 * heat, 0.012 + 0.01 * heat, 0.008);
      pm.halo.opacity = 0.35 * heat * p.fade;
    });
    for (const pm of this.pools) if (!keep.has(pm.id) || !pm.group.visible) {
      if (!keep.has(pm.id)) pm.group.visible = false;
    }
    // ---- explosions' flashes and the damage numbers ----
    for (const f of this.flashes) {
      f.age += dt;
      const u = f.age / 0.28;
      f.sprite.visible = u < 1;
      if (f.sprite.visible) {
        f.mat.opacity = 1 - u;
        f.sprite.scale.setScalar((f.sprite.userData.size ?? 8) * (0.5 + u * 0.9));
      }
    }
    const pops = hz?.popups ?? [];
    this.popups.forEach((p, i) => {
      const o = pops[i];
      p.sprite.visible = !!o;
      if (!o) return;
      const key = o.text === "-5" ? "-5" : "-20";
      if (p.mat.map !== this.popTex[key]) {
        p.mat.map = this.popTex[key];
        p.mat.needsUpdate = true;
      }
      p.mat.opacity = Math.max(0, 1 - o.age / 0.9);
      p.sprite.position.set((o.x + 10) * S * K, 2.8 + o.age * 3.5, (o.y + 20) * S * K);
      p.sprite.scale.set(2.6, 1.3, 1);
    });
  }
  private lastTargets = new Map<number, { x: number; y: number }>();

  dispose() {
    this.root.removeFromParent();
  }
}

/** The polar bear that walks across the road, and the blinking alert before it appears. */
export class BearFx {
  private root = new THREE.Group();
  private rigs: { rig: ReturnType<typeof makeBear> }[] = [];
  private ring: THREE.Mesh;
  private disc: THREE.Mesh;
  private sign: THREE.Group;
  private ringMat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;

  private fx: Effects3D;

  constructor(d: Disposer, scene: THREE.Scene, fx: Effects3D) {
    this.fx = fx;
    for (let i = 0; i < 2; i++) {
      const rig = makeBear(d);
      rig.group.visible = false;
      this.root.add(rig.group);
      this.rigs.push({ rig });
    }
    this.ringMat = d.add(new THREE.MeshBasicMaterial({ color: "#ff8a1f", transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.discMat = d.add(new THREE.MeshBasicMaterial({ color: "#ff8a1f", transparent: true, opacity: 0.22, depthWrite: false, fog: false }));
    this.ring = new THREE.Mesh(flat(d, new THREE.RingGeometry(4.0, 4.7, 48)), this.ringMat);
    this.disc = new THREE.Mesh(flat(d, new THREE.CircleGeometry(4.0, 40)), this.discMat);
    this.ring.visible = this.disc.visible = false;
    this.ring.renderOrder = this.disc.renderOrder = 3;
    this.root.add(this.ring, this.disc);
    // The warning sign: a pole and an orange triangle with an exclamation mark, facing the road.
    this.sign = new THREE.Group();
    const post = new THREE.Mesh(d.add(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8)), d.add(new THREE.MeshStandardMaterial({ color: "#555a60", metalness: 0.6, roughness: 0.4 })));
    post.position.y = 1.7;
    const tex = paintTexture(d, 128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = "#2b2b2b";
      g.beginPath();
      g.moveTo(w / 2, 6);
      g.lineTo(w - 6, h - 12);
      g.lineTo(6, h - 12);
      g.closePath();
      g.fill();
      g.fillStyle = "#ff8a1f";
      g.beginPath();
      g.moveTo(w / 2, 20);
      g.lineTo(w - 22, h - 22);
      g.lineTo(22, h - 22);
      g.closePath();
      g.fill();
      g.fillStyle = "#2b2b2b";
      g.font = "900 60px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("!", w / 2, h * 0.64);
    }, { mip: false });
    const plate = new THREE.Mesh(d.add(new THREE.PlaneGeometry(2.4, 2.4)), d.add(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, fog: false })));
    plate.position.y = 3.7;
    this.sign.add(post, plate);
    this.sign.visible = false;
    this.root.add(this.sign);
    scene.add(this.root);
  }

  update(dt: number, a: Adapter3D) {
    const bears = a.dangers.bears;
    this.rigs.forEach((r, i) => {
      const b = bears[i];
      r.rig.group.visible = !!b;
      if (!b) return;
      r.rig.group.position.set(b.x * K, 0, b.y * K);
      r.rig.group.rotation.y = -b.angle;
      r.rig.walk(b.age * 4.6);
      r.rig.setAlpha(b.alpha);
    });
    const w = a.dangers.warning;
    const on = !!w && Math.floor(w.age * 5) % 2 === 0;
    this.ring.visible = this.disc.visible = this.sign.visible = !!w;
    if (w) {
      this.ring.position.set(w.x * K, 0.09, w.y * K);
      this.disc.position.set(w.x * K, 0.08, w.y * K);
      this.sign.position.set(w.signX * K, 0, w.signY * K);
      // The sign faces the road: from the bear's start toward it.
      this.sign.rotation.y = Math.atan2(w.signX - w.x, w.signY - w.y) + Math.PI;
      this.ringMat.opacity = on ? 0.95 : 0.15;
      this.discMat.opacity = on ? 0.28 : 0.04;
      const pulse = 1 + 0.08 * Math.sin(w.age * 12);
      this.ring.scale.set(pulse, 1, pulse);
    }
    void dt;
    void this.fx;
  }

  dispose() {
    this.root.removeFromParent();
  }
}
