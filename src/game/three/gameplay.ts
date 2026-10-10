import { type Adapter3D, K } from "../adapter3d";
import { dustOf } from "../flight";
import { slipOf } from "../car";
import type { ThemeId } from "../themes";
import type { Car3D } from "./cars";
import { type Disposer, type Quality, THREE, softDisc } from "./core";
import { Ambient3D, Effects3D, Fireworks3D, Skids3D, SpeedLines3D, rgb } from "./effects";
import { Blasts3D } from "./blasts";
import { BearFx, VolcanoFx } from "./hazards3d";
import { Pads3D } from "./pads";
import { YetiFx } from "./yeti3d";

export type GameplayArgs = {
  adapter: Adapter3D;
  d: Disposer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: Quality;
  reduced: boolean;
  cars: Car3D[];
  mode: ThemeId;
  /** Height (m) of the ground under a world point (the volcano's cone), and the crater lake's height. */
  heightAt: (x: number, y: number) => number;
  craterY: number;
};

/** What a car kicks up when it leaves the road, by mode (linear colour, alpha). */
const OFFROAD: Record<ThemeId, { color: string; alpha: number }> = {
  desert: { color: "#e2bd84", alpha: 0.55 }, northpole: { color: "#ffffff", alpha: 0.7 }, volcano: { color: "#5a504c", alpha: 0.55 }, countryside: { color: "#8a8a5a", alpha: 0.4 },
};

/** The moving parts of a race in 3D: the boost pads, the mode's dangers, and every pooled effect. Built per race, driven by the adapter's views. */
export class Gameplay3D {
  private fx: Effects3D;
  private skids: Skids3D;
  private pads: Pads3D;
  private volcano: VolcanoFx | null = null;
  private bear: BearFx | null = null;
  private yeti: YetiFx | null = null;
  private blasts: Blasts3D;
  private ambient: Ambient3D;
  private lines: SpeedLines3D;
  private fireworks: Fireworks3D;
  private blob: THREE.Mesh;
  private blobMat: THREE.MeshBasicMaterial;
  private prev: { hits: number; alt: number; straw: number }[];
  private spot = new THREE.Vector3();
  private offroad: { color: [number, number, number]; alpha: number };
  private takeoffDust: { color: [number, number, number]; alpha: number };

  private a: GameplayArgs;

  constructor(a: GameplayArgs) {
    this.a = a;
    const { adapter, d, scene, quality, mode } = a;
    this.fx = new Effects3D(d, scene, quality);
    this.skids = new Skids3D(d, scene, adapter.race);
    const soft = softDisc(d, 64);
    this.pads = new Pads3D(d, scene, adapter, mode, soft);
    if (adapter.eruption()) this.volcano = new VolcanoFx(d, scene, this.fx, a.heightAt, a.reduced, a.craterY);
    if (mode === "northpole") {
      this.bear = new BearFx(d, scene, this.fx);
      this.yeti = new YetiFx(d, scene, this.fx);
    }
    this.blasts = new Blasts3D(d, scene, this.fx);
    this.ambient = new Ambient3D(d, scene, mode, quality);
    this.lines = new SpeedLines3D(d, a.camera);
    this.fireworks = new Fireworks3D(a.reduced);
    this.fireworks.setQuality(quality);
    this.blobMat = d.add(new THREE.MeshBasicMaterial({ map: soft, color: "#000000", transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.blob = new THREE.Mesh(d.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.blobMat);
    this.blob.visible = false;
    this.blob.renderOrder = 2;
    scene.add(this.blob);
    const o = OFFROAD[mode];
    this.offroad = { color: rgb(o.color), alpha: o.alpha };
    const t = dustOf(mode);
    const [r, g, b] = t.rgb.split(",").map((v) => Number(v) / 255);
    const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    this.takeoffDust = { color: [c.r, c.g, c.b], alpha: t.alpha };
    this.prev = adapter.race.cars.map((c0) => ({ hits: c0.hits, alt: c0.alt, straw: 0 }));
  }

  setQuality(q: Quality) {
    this.a.quality = q;
    this.fx.setQuality(q);
    this.fireworks.setQuality(q);
  }

  update(dt: number, time: number, cam: THREE.PerspectiveCamera, pixelHeight: number) {
    const { adapter: a, cars, reduced } = this.a, race = a.race;
    const pixelScale = pixelHeight / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.pads.update(time);
    this.volcano?.update(dt, time, a);
    this.bear?.update(dt, a);
    this.yeti?.update(dt, a);
    this.blasts.update(dt, a);
    this.skids.update(race);

    race.cars.forEach((c, i) => {
      const v = a.cars[i], p = this.prev[i];
      const h = v.heading, cx = Math.cos(h), cz = Math.sin(h), x = v.x * K, z = v.y * K, speed = Math.abs(v.speed);
      // Dust, snow or ash behind a car that is off the road; tyre smoke when it slides or brakes hard.
      if (v.alt < 2 && speed > 90 && c.surface !== "track" && Math.random() < dt * 45) {
        this.fx.puff(x - cx * 1.8, 0.2, z - cz * 1.8, this.offroad.color, this.offroad.alpha, 1, 3.2, 1.2, 1.1);
      }
      if (v.alt < 1 && c.surface === "track" && (slipOf(c) > 150 || (c.stun > 0 && speed > 150)) && !reduced && Math.random() < dt * 40) {
        for (const s of [-1, 1]) this.fx.smoke.emit(x - cx * 1.3 - cz * s * 0.9, 0.3, z - cz * 1.3 + cx * s * 0.9, -cx * 1.2, 0.8, -cz * 1.2, 0.5, 2.2, 0.8, 0.82, 0.82, 0.82, 0.3, -0.1, 0.8);
      }
      // The turbo's trail of sparks out of the exhaust.
      if (v.boosting && !reduced && Math.random() < dt * 60) {
        cars[i].engineSpot(v, this.spot);
        this.fx.fire.emit(this.spot.x, this.spot.y, this.spot.z, -cx * 8, 0.3, -cz * 8, 0.5, -0.4, 0.4, 1, 0.55, 0.15, 0.8, 0, 1.5);
      }
      // A wreck burns where it stopped, in thick black smoke, until it fades.
      if (v.destroyed >= 0 && v.wreck > 0.05) {
        if (Math.random() < dt * 24) this.fx.flame(x + (Math.random() - 0.5) * 2.2, 0.5 + Math.random() * 0.5, z + (Math.random() - 0.5) * 1.6, 1.5 * v.wreck + 0.4);
        if (Math.random() < dt * 16) this.fx.smokePuff(x + (Math.random() - 0.5) * 1.6, 1.2, z + (Math.random() - 0.5) * 1.2, true, 4.5);
      } else if (v.health <= 0.5) {
        // A worn-out car smokes at half health, and burns at a quarter (the damage of the volcano and the yeti).
        const rate = v.health <= 0.25 ? 14 : 4;
        if (Math.random() < dt * rate) {
          cars[i].engineSpot(v, this.spot);
          this.fx.smokePuff(this.spot.x, this.spot.y + 0.4, this.spot.z, v.health <= 0.25, 2.6);
          if (v.health <= 0.25 && Math.random() < 0.8) this.fx.flame(this.spot.x, this.spot.y + 0.2, this.spot.z);
        }
      }
      // Sparks where a car hit something (a wall, a bale, the bear); straw thrown by a bale.
      if (c.hits > p.hits) this.fx.sparkBurst(x, 0.6 + v.alt, z, 26, 11);
      p.hits = c.hits;
      // The Jet's takeoff and landing raise a cloud of the mode's dust.
      if (p.alt < 1 && v.alt >= 1) this.fx.puff(x, 0.3, z, this.takeoffDust.color, this.takeoffDust.alpha, 14, 6, 2, 1.6);
      if (p.alt >= 1 && v.alt < 1) this.fx.puff(x, 0.3, z, this.takeoffDust.color, this.takeoffDust.alpha, 10, 5, 1.8, 1.3);
      p.alt = v.alt;
    });
    // Straw: the game's own pieces, the ones just thrown.
    for (const s of race.straw) {
      if (s.life > 0.985) this.fx.straw.emit(s.x * K, 0.6, s.y * K, s.vx * K, 2 + Math.random() * 3, s.vy * K, 0.25, 0, 1.1, 0.92, 0.75, 0.3, 1, 7, 0.3);
    }

    // The Jet's shadow on whatever is under it: the road, or the wall it flies over.
    const me = a.player, up = me.alt > 1;
    this.blob.visible = up;
    if (up) {
      const size = 5.5 + me.alt * 0.05;
      this.blob.position.set(me.x * K, me.floorAlt + 0.08, me.y * K);
      this.blob.rotation.y = -me.heading;
      this.blob.scale.set(size * 1.5, 1, size);
      this.blobMat.opacity = Math.max(0, 0.5 * (1 - Math.max(0, me.alt - me.floorAlt) / 130));
    }

    // The winner's fireworks over the finish.
    const mine = race.cars[0];
    const won = mine.finishTime !== null && race.cars.every((c) => c === mine || c.finishTime === null || c.finishTime > (mine.finishTime as number));
    this.fireworks.update(dt, this.fx, won, me.x * K, me.y * K, me.heading);

    this.fx.update(dt, pixelScale);
    this.ambient.update(time, cam, pixelScale);
    this.lines.update(time, me.boosting, me.speedRatio, dt);
  }

  dispose() {
    this.pads.dispose();
    this.volcano?.dispose();
    this.bear?.dispose();
    this.yeti?.dispose();
    this.blasts.dispose();
    this.skids.dispose();
    this.ambient.dispose();
    this.lines.dispose();
    this.fx.dispose();
    this.blob.removeFromParent();
  }
}
