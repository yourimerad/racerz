import { K } from "../adapter3d";
import { mulberry32 } from "../scenery";
import { THREE, type Placement, hash2, instanced, propMaterial, mat4, merge, part } from "./core";
import { faceRoad, placeOf, propsOf, texturedGround } from "./place";
import * as models from "./props";
import { coverSamples } from "./terrain";
import type { Scenery, WorldCtx } from "./world";

// The classic (countryside) circuit: a patchwork of fields on flat ground, trees along the road and a forest with two leafy canopies over
// the road, the start straight's grandstands and pits, the village's marquee and hay bales, a farm. The road's guardrails and the faint
// curtain that shows the flight rules' 35 m "wall" come from world.ts.

const FIELDS = [
  { fill: "#6aa84f", stripe: "rgba(255,255,255,0.06)" }, { fill: "#5e9a45", stripe: "rgba(0,0,0,0.05)" }, { fill: "#86b85e", stripe: "rgba(255,255,255,0.07)" },
  { fill: "#8b6b4a", stripe: "rgba(60,40,20,0.35)" }, { fill: "#d8c165", stripe: "rgba(255,240,170,0.45)" }, { fill: "#c9b052", stripe: "rgba(120,100,30,0.25)" },
];

export function buildClassic(ctx: WorldCtx): Scenery {
  const { adapter, d, group, field } = ctx, track = adapter.race.track, b = track.bounds, props = adapter.props, path = track.path;

  // ---- ground: jittered patchwork fields with stripes, plus grain ----
  texturedGround(d, group, b, "#2f6b3a", 2048, (g, w, h, sx, sy) => {
    g.fillStyle = "#3a7d44";
    g.fillRect(0, 0, w, h);
    const rng = mulberry32(2024), cw = 300, ch = 240;
    const cols = Math.ceil((b.maxX - b.minX) / cw) + 1, rows = Math.ceil((b.maxY - b.minY) / ch) + 1;
    const vtx = Array.from({ length: cols + 1 }, (_, i) => Array.from({ length: rows + 1 }, (_, j) => ({
      x: (b.minX + (i - 0.5) * cw + (rng() - 0.5) * 0.5 * cw - b.minX) * sx, y: (b.minY + (j - 0.5) * ch + (rng() - 0.5) * 0.5 * ch - b.minY) * sy,
    })));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const f = FIELDS[Math.floor(rng() * FIELDS.length)], q = [vtx[i][j], vtx[i + 1][j], vtx[i + 1][j + 1], vtx[i][j + 1]], gap = (9 + rng() * 5) * sx, ang = rng() * Math.PI;
      g.save();
      g.beginPath();
      q.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fillStyle = f.fill;
      g.fill();
      g.clip();
      g.translate(q[0].x, q[0].y);
      g.rotate(ang);
      g.strokeStyle = f.stripe;
      g.lineWidth = gap * 0.45;
      g.beginPath();
      for (let k = -900 * sx; k <= 900 * sx; k += gap) {
        g.moveTo(-900 * sx, k);
        g.lineTo(900 * sx, k);
      }
      g.stroke();
      g.restore();
    }
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = hash2(i, 5) > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,30,0,0.07)";
      g.fillRect(hash2(i, 6) * w, hash2(i, 7) * h, 1 + hash2(i, 8) * 2, 1 + hash2(i, 9) * 2);
    }
  });

  const matProp = propMaterial(d);
  const put = (mesh: THREE.Object3D | null) => {
    if (mesh) group.add(mesh);
  };
  const faced = (list: ReturnType<typeof propsOf>, modelR: number, stretch = 1): Placement[] =>
    list.map((p, i) => ({ ...placeOf(p, modelR, i, faceRoad(field, path, p.x, p.y)), s: stretch }));

  // ---- trees (broadleaf), pillars at the canopy entrances ----
  const trees = propsOf(props, "tree").map((p, i) => placeOf(p, 2.2, i));
  const pillars = propsOf(props, "pillar").map((p, i) => ({ ...placeOf(p, 2.2, i), s: 1.1 }));
  put(instanced(d, models.treeModel(), matProp, [...trees, ...pillars]));
  put(instanced(d, models.hedge(), matProp, propsOf(props, "hedge").slice(0, 900).map((p, i) => placeOf(p, 1, i)), false));

  // ---- hay: the square bales that line the village bend (the physical bumpers), irregular, and the round ones in the fields ----
  const straw = propsOf(props, "strawbale").map((p, i): Placement => {
    const v = 215 + Math.floor(hash2(i, 3, 1) * 40);
    return {
      x: p.x * K, z: p.y * K, ry: -(p.a ?? 0) + (hash2(i, 4, 1) - 0.5) * 0.35, sx: 0.92 + hash2(i, 5, 1) * 0.2, sy: 0.9 + hash2(i, 6, 1) * 0.25, sz: 0.9 + hash2(i, 7, 1) * 0.2,
      tint: (v << 16) | ((v - 8) << 8) | (v - 40),
    };
  });
  put(instanced(d, models.strawBale(), matProp, straw));
  put(instanced(d, models.roundBale(), matProp, propsOf(props, "bale").map((p, i) => placeOf(p, 1, i))));

  // ---- the start straight: grandstands, pits, tyre stacks, flags; the village marquee and stands; a farm and its cows ----
  put(instanced(d, models.grandstand(), matProp, faced(propsOf(props, "grandstand"), 6.9)));
  put(instanced(d, models.pitBuilding(), matProp, faced(propsOf(props, "pit"), 4.6)));
  put(instanced(d, models.tireStack(), matProp, propsOf(props, "tires").map((p, i) => placeOf(p, 1.4, i))));
  put(instanced(d, models.banner(), matProp, faced(propsOf(props, "banner"), 1.6)));
  put(instanced(d, models.marquee(), matProp, propsOf(props, "tent").map((p, i) => placeOf(p, 8, i))));
  put(instanced(d, models.villageStand(), matProp, faced(propsOf(props, "stand"), 4.6)));
  put(instanced(d, models.farm(), matProp, propsOf(props, "farm").map((p, i) => ({ ...placeOf(p, 17, i), s: 1.1 }))));
  put(instanced(d, models.cow(), matProp, propsOf(props, "cow").map((p, i) => placeOf(p, 1.5, i))));

  // ---- wooden fences between the fields: a post at each point and two rails between them ----
  const posts: Placement[] = [], rails: Placement[] = [];
  for (const run of adapter.race.scene.fences ?? []) {
    run.forEach((p, i) => {
      posts.push({ x: p.x * K, z: p.y * K });
      const q = run[i + 1];
      if (!q) return;
      const l = Math.hypot(q.x - p.x, q.y - p.y) * K, ry = -Math.atan2(q.y - p.y, q.x - p.x), mx = ((p.x + q.x) / 2) * K, mz = ((p.y + q.y) / 2) * K;
      rails.push({ x: mx, y: 0.5, z: mz, ry, sx: l }, { x: mx, y: 0.95, z: mz, ry, sx: l });
    });
  }
  put(instanced(d, part(new THREE.BoxGeometry(0.16, 1.25, 0.16), "#6b4f30", mat4(0, 0.62, 0)), matProp, posts.slice(0, 2500), false));
  put(instanced(d, part(new THREE.BoxGeometry(1, 0.1, 0.07), "#8a6a45"), matProp, rails.slice(0, 5000), false));

  // ---- the two leafy canopies over the road in the forest ----
  const blobs: Placement[] = [];
  const rng = mulberry32(2010);
  track.covers.forEach((c) => {
    const { from, count } = coverSamples(track, c);
    for (let k = -3; k <= count + 3; k += 5) {
      const i = (((from + k) % path.length) + path.length) % path.length, p = path[i], t = track.tangents[i];
      for (let s = 0; s < 3; s++) {
        if (rng() < 0.1) continue; // a gap: a shaft of light
        const lat = (s - 1) * track.barrier * 0.7 + (rng() - 0.5) * 80, r = (55 + rng() * 45) * K;
        const v = 150 + Math.floor(rng() * 70);
        blobs.push({ x: (p.x - t.y * lat + (rng() - 0.5) * 40) * K, y: 12.5, z: (p.y + t.x * lat + (rng() - 0.5) * 40) * K, s: r, sy: r * 0.5, ry: rng() * 6, tint: ((v * 0.55) << 16) | (v << 8) | (v * 0.45) });
      }
    }
  });
  const leaf = merge([part(new THREE.IcosahedronGeometry(1, 1), "#2f6b2a"), part(new THREE.IcosahedronGeometry(0.7, 1), "#3e7f33", mat4(-0.2, 0.35, 0.1))]);
  put(instanced(d, leaf, matProp, blobs));

  return {};
}
