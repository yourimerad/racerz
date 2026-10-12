import { K } from "../adapter3d";
import { mulberry32 } from "../scenery";
import { THREE, type Placement, hash2, instanced, propMaterial, mat4, part } from "./core";
import { faceRoad, placeOf, propsOf, texturedGround } from "./place";
import { barkMaterial, grassTexture, grassTuft, leafCanopy, leafMaterial, leafTexture, realisticTree } from "./foliage";
import * as models from "./props";
import { coverSamples } from "./terrain";
import type { Scenery, WorldCtx } from "./world";

// The classic (countryside) circuit: a patchwork of fields on flat ground, trees along the road and a forest with two leafy canopies over
// the road, the start straight's grandstands and pits, the village's marquee and hay bales, a farm. The road's guardrails and the faint
// curtain that shows the flight rules' 35 m "wall" come from world.ts.

const FIELDS = [
  { fill: "#6f9a4c", stripe: "rgba(255,255,255,0.05)" }, { fill: "#628c44", stripe: "rgba(0,0,0,0.05)" }, { fill: "#7fa857", stripe: "rgba(255,255,255,0.06)" },
  { fill: "#7d6446", stripe: "rgba(50,34,18,0.32)" }, { fill: "#c9b55f", stripe: "rgba(255,240,170,0.38)" }, { fill: "#b8a24f", stripe: "rgba(120,100,30,0.22)" },
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
    // Large soft patches (lusher and drier grass, damp ground) over the patchwork: the fields stop looking like flat paint.
    for (let i = 0; i < 260; i++) {
      const x = hash2(i, 31) * w, y = hash2(i, 32) * h, r = (30 + hash2(i, 33) * 110) * sx, warm = hash2(i, 34) > 0.5;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, warm ? "rgba(190,170,90,0.20)" : "rgba(20,60,20,0.20)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = hash2(i, 5) > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,30,0,0.07)";
      g.fillRect(hash2(i, 6) * w, hash2(i, 7) * h, 1 + hash2(i, 8) * 2, 1 + hash2(i, 9) * 2);
    }
  }, 1, { kind: "grass", normalScale: 1.0, albedo: 0.9 });

  const matProp = propMaterial(d);
  const put = (mesh: THREE.Object3D | null) => {
    if (mesh) group.add(mesh);
  };
  const faced = (list: ReturnType<typeof propsOf>, modelR: number, stretch = 1): Placement[] =>
    list.map((p, i) => ({ ...placeOf(p, modelR, i, faceRoad(field, path, p.x, p.y)), s: stretch }));

  // ---- trees: oaks, poplars and tall forest trees, a mix by position; the big trunks at the canopy entrances ----
  const wind = { time: { value: 0 } };
  const leaves = leafMaterial(d, leafTexture(d), wind, { swayFrom: 3, amp: 0.12 }), bark = barkMaterial(d);
  const byVariant: Placement[][] = [[], [], []];
  const autumn = [0xffffff, 0xf2f6dc, 0xe9f0c8, 0xfff2c0];
  propsOf(props, "tree").forEach((p, i) => {
    const h = hash2(i, Math.round(p.x), 77), variant = h < 0.45 ? 0 : h < 0.7 ? 1 : 2, pl = placeOf(p, 2.2, i);
    byVariant[variant].push({ ...pl, tint: autumn[Math.floor(hash2(i, Math.round(p.y), 78) * autumn.length)] });
  });
  byVariant[2].push(...propsOf(props, "pillar").map((p, i) => ({ ...placeOf(p, 2.2, i), s: 1.35 })));
  // Along the forest road (the two covered stretches): tall trunks either side of the barriers, holding up the canopy.
  track.covers.forEach((c, ci) => {
    const { from, count } = coverSamples(track, c);
    for (let k = -6; k <= count + 6; k += 11) {
      const i = (((from + k) % path.length) + path.length) % path.length, p = path[i], t = track.tangents[i];
      for (const side of [-1, 1]) {
        const lat = side * (track.barrier + 22 + hash2(k, side + 3, ci) * 90), jx = (hash2(k, side, ci + 5) - 0.5) * 60;
        byVariant[2].push({
          x: (p.x - t.y * lat + t.x * jx) * K, z: (p.y + t.x * lat + t.y * jx) * K, s: 1.1 + hash2(k, side + 9, ci) * 0.45, ry: hash2(k, side, ci) * 6.28,
          tint: autumn[Math.floor(hash2(k, side + 20, ci) * autumn.length)],
        });
      }
    }
  });
  // Real leaves: crowns of alpha-tested leaf cards lit by crown-round normals, over barked trunks (see foliage.ts).
  byVariant.forEach((list, v) => {
    const tree = realisticTree(v as 0 | 1 | 2);
    put(instanced(d, tree.trunk, bark, list));
    put(instanced(d, tree.leaves, leaves, list));
  });
  put(instanced(d, models.hedge(), matProp, propsOf(props, "hedge").slice(0, 900).map((p, i) => placeOf(p, 1, i)), false, 60, 170));

  // ---- hay: the square bales that line the village bend (the physical bumpers), irregular, and the round ones in the fields ----
  const straw = propsOf(props, "strawbale").map((p, i): Placement => {
    const v = 215 + Math.floor(hash2(i, 3, 1) * 40);
    return {
      x: p.x * K, z: p.y * K, ry: -(p.a ?? 0) + (hash2(i, 4, 1) - 0.5) * 0.35, sx: 0.92 + hash2(i, 5, 1) * 0.2, sy: 0.9 + hash2(i, 6, 1) * 0.25, sz: 0.9 + hash2(i, 7, 1) * 0.2,
      tint: (v << 16) | ((v - 8) << 8) | (v - 40),
    };
  });
  put(instanced(d, models.strawBale(), matProp, straw, true, 60, 220));
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
  put(instanced(d, part(new THREE.BoxGeometry(0.16, 1.25, 0.16), "#6b4f30", mat4(0, 0.62, 0)), matProp, posts.slice(0, 2500), false, 60, 150));
  put(instanced(d, part(new THREE.BoxGeometry(1, 0.1, 0.07), "#8a6a45"), matProp, rails.slice(0, 5000), false, 60, 150));

  // ---- the two leafy canopies over the road in the forest: masses of leaves held up by the trunks, with gaps for the light ----
  const blobs: Placement[] = [];
  const rng = mulberry32(2010);
  track.covers.forEach((c) => {
    const { from, count } = coverSamples(track, c);
    for (let k = -3; k <= count + 3; k += 4) {
      const i = (((from + k) % path.length) + path.length) % path.length, p = path[i], t = track.tangents[i];
      for (let s = 0; s < 3; s++) {
        if (rng() < 0.14) continue; // a gap: a shaft of light
        const lat = (s - 1) * track.barrier * 0.7 + (rng() - 0.5) * 80, r = (45 + rng() * 40) * K;
        const v = 215 + Math.floor(rng() * 40);
        blobs.push({ x: (p.x - t.y * lat + (rng() - 0.5) * 40) * K, y: 11.5 + rng() * 1.5, z: (p.y + t.x * lat + (rng() - 0.5) * 40) * K, s: r / 4.6, ry: rng() * 6, tint: ((v * 0.9) << 16) | (v << 8) | (v * 0.75) });
      }
    }
  });
  put(instanced(d, leafCanopy(), leaves, blobs));

  // ---- grass: tufts of blades along both sides of the road, thinning out with distance (hidden beyond 140 m) ----
  const tufts: Placement[] = [], grng = mulberry32(2077), tints = [0xffffff, 0xe6ecc4, 0xd2e0a4, 0xf2f0d0, 0xc8d89a];
  for (let i = 0; i < path.length; i += 2) {
    const p = path[i], t = track.tangents[i];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 8; k++) {
        const lat = side * (track.barrier + 14 + 380 * Math.pow(grng(), 2)), jx = (grng() - 0.5) * 30;
        const x = p.x - t.y * lat + t.x * jx, y = p.y + t.x * lat + t.y * jx;
        const dist = field.query(x, y, track.barrier + 40);
        if (isFinite(dist) && dist < track.barrier + 10) continue; // not on another stretch of the circuit
        tufts.push({ x: x * K, z: y * K, s: 0.8 + grng() * 1.0, ry: grng() * 6.28, tint: tints[Math.floor(grng() * tints.length)] });
      }
    }
  }
  put(instanced(d, grassTuft(), leafMaterial(d, grassTexture(d), wind, { swayFrom: 0, amp: 0.9, alphaTest: 0.4, glow: 0.12 }), tufts, false, 60, 140));

  return { update: (_dt, time) => { wind.time.value = time; } };
}
