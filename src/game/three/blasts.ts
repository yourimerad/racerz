import { type Adapter3D, K } from "../adapter3d";
import { type Disposer, THREE, softDisc } from "./core";
import type { Effects3D } from "./effects";

// The explosion of a car that ran out of points (race.blasts, one per car): a white flash, a fireball, sparks, flying debris, a black column of
// smoke and a shockwave on the ground. Everything goes through the shared pooled particles (so it is capped like the rest) and a few sprites; the
// wreck that keeps burning afterwards is gameplay.ts. The game decides when and where; this only draws it.

const FLASHES = 4;
const WAVE_LIFE = 0.7;

type Flash = { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; age: number; size: number };
type Wave = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; size: number };

export class Blasts3D {
  private root = new THREE.Group();
  private flashes: Flash[] = [];
  private waves: Wave[] = [];
  private seen = new Set<number>();
  private fx: Effects3D;

  constructor(d: Disposer, scene: THREE.Scene, fx: Effects3D) {
    this.fx = fx;
    const soft = softDisc(d, 64);
    for (let i = 0; i < FLASHES; i++) {
      const mat = d.add(new THREE.SpriteMaterial({ map: soft, color: "#ffd9a0", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.root.add(sprite);
      this.flashes.push({ sprite, mat, age: 9, size: 10 });
    }
    const ring = d.add(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2));
    for (let i = 0; i < FLASHES; i++) {
      const mat = d.add(new THREE.MeshBasicMaterial({ color: "#ffb15a", transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      const mesh = new THREE.Mesh(ring, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.waves.push({ mesh, mat, age: 9, size: 10 });
    }
    scene.add(this.root);
  }

  /** The blast of a car at (x, z) in scene metres; `power` 0..1 = how near it is to the player (its size, not its existence). */
  private go(x: number, z: number, power: number) {
    const fx = this.fx, p = 0.5 + 0.5 * power;
    const f = this.flashes.find((s) => s.age > 0.4) ?? this.flashes[0];
    f.age = 0;
    f.size = 16 * p;
    f.sprite.position.set(x, 1.4, z);
    f.sprite.visible = true;
    const w = this.waves.find((s) => s.age > WAVE_LIFE) ?? this.waves[0];
    w.age = 0;
    w.size = 15 * p;
    w.mesh.position.set(x, 0.15, z);
    w.mesh.visible = true;
    // The fireball: flames thrown out in every direction, quick and bright.
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, up = 0.2 + Math.random() * 0.9, s = (4 + Math.random() * 12) * p;
      fx.fire.emit(x, 0.8, z, Math.cos(a) * s, up * s * 0.7, Math.sin(a) * s, 1.1 + Math.random() * 1.2, 1.4, 0.4 + Math.random() * 0.6, 1, 0.45 + Math.random() * 0.3, 0.1, 0.95, -2, 1.6);
    }
    fx.sparkBurst(x, 1, z, 70, 24 * p);
    // Debris: dark bits thrown high that fall back (the straw pool draws plain squares).
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, s = (5 + Math.random() * 11) * p;
      fx.straw.emit(x, 0.8, z, Math.cos(a) * s, 7 + Math.random() * 9, Math.sin(a) * s, 0.28 + Math.random() * 0.2, 0, 1.4 + Math.random() * 0.6, 0.07, 0.07, 0.08, 1, 18, 0.2);
    }
    // The smoke: a black column that climbs and spreads.
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3.5 * p;
      fx.smoke.emit(x, 1 + Math.random(), z, Math.cos(a) * s, 3 + Math.random() * 6, Math.sin(a) * s, 1.4, 3.2, 2.4 + Math.random() * 1.8, 0.07, 0.07, 0.075, 0.75, -0.3, 0.5);
    }
    fx.puff(x, 0.4, z, [0.35, 0.33, 0.32], 0.7, 14, 8 * p, 2, 1.6);
  }

  update(dt: number, a: Adapter3D) {
    for (const b of a.blasts) {
      if (this.seen.has(b.id)) continue;
      this.seen.add(b.id);
      this.go(b.x * K, b.y * K, b.power);
    }
    for (const f of this.flashes) {
      f.age += dt;
      const u = f.age / 0.35;
      f.sprite.visible = u < 1;
      if (f.sprite.visible) {
        f.mat.opacity = 1 - u;
        f.sprite.scale.setScalar(f.size * (0.4 + u * 1.1));
      }
    }
    for (const w of this.waves) {
      w.age += dt;
      const u = w.age / WAVE_LIFE;
      w.mesh.visible = u < 1;
      if (w.mesh.visible) {
        w.mesh.scale.setScalar(1 + u * w.size);
        w.mat.opacity = 0.8 * (1 - u) * (1 - u);
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
  }
}
