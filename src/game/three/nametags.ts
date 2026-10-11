import { type Adapter3D } from "../adapter3d";
import type { Car3D } from "./cars";
import { type Disposer, THREE, clamp, paintTexture } from "./core";

// Name tags over the other players' cars in an online race: a small pill with the pilot's colour and name, always facing the camera and kept at
// a steady size on the screen. Only cars moved by the network have one (solo races have none), and only while the car is still in the race.

const W = 320, H = 64;
/** How far (m) a tag is still shown. */
const FAR = 450;

function paintName(g: CanvasRenderingContext2D, w: number, h: number, name: string, color: string) {
  g.clearRect(0, 0, w, h);
  g.font = "700 30px system-ui, sans-serif";
  g.textAlign = "left";
  g.textBaseline = "middle";
  const text = name.length > 24 ? `${name.slice(0, 23)}…` : name;
  const tw = Math.min(w - 24, g.measureText(text).width);
  const pw = tw + 58, x0 = (w - pw) / 2;
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.beginPath();
  g.roundRect(x0, 6, pw, h - 12, (h - 12) / 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x0 + 26, h / 2, 10, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.fillText(text, x0 + 46, h / 2 + 1, tw);
}

type Tag = { car: number; sprite: THREE.Sprite; tex: THREE.CanvasTexture | null; drawn: string };

export class NameTags3D {
  private adapter: Adapter3D;
  private cars: Car3D[];
  private scene: THREE.Scene;
  private tags: Tag[] = [];

  constructor(d: Disposer, scene: THREE.Scene, adapter: Adapter3D, cars: Car3D[]) {
    this.adapter = adapter;
    this.cars = cars;
    this.scene = scene;
    adapter.race.cars.forEach((c, i) => {
      if (!c.remote) return;
      const tex = paintTexture(d, W, H, (g, w, h) => paintName(g, w, h, c.name, c.color), { mip: false, anisotropy: 1 });
      const mat = d.add(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      const sprite = new THREE.Sprite(mat);
      sprite.center.set(0.5, 0);
      sprite.renderOrder = 12;
      sprite.visible = false;
      scene.add(sprite);
      this.tags.push({ car: i, sprite, tex, drawn: c.name });
    });
  }

  update(cam: THREE.Camera) {
    for (const t of this.tags) {
      const c = this.adapter.race.cars[t.car], v = this.adapter.cars[t.car], g = this.cars[t.car]?.group;
      if (!g) continue;
      if (c.name !== t.drawn && t.tex) {
        // The pilot left: the tag says so.
        t.drawn = c.name;
        const canvas = t.tex.image as HTMLCanvasElement;
        const ctx = canvas.getContext("2d");
        if (ctx) paintName(ctx, W, H, c.name, c.color);
        t.tex.needsUpdate = true;
      }
      const dist = g.position.distanceTo(cam.position);
      t.sprite.visible = v.destroyed < 0 && dist < FAR && dist > 4;
      if (!t.sprite.visible) continue;
      t.sprite.position.set(g.position.x, g.position.y + 2.5, g.position.z);
      const s = clamp(dist * 0.045, 0.9, 20); // height in metres: about the same on the screen at any distance
      t.sprite.scale.set(s * (W / H), s, 1);
    }
  }

  dispose() {
    for (const t of this.tags) this.scene.remove(t.sprite);
    this.tags = [];
  }
}
