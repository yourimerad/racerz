import { K } from "../adapter3d";
import { CONE, LAKE_R, RING_R } from "../modes/volcano";
import { mulberry32 } from "../scenery";
import { type Key, spline } from "./carbody";
import { THREE, type Placement, fbm, hash2, instanced, lerp, propMaterial, smoothstep, vnoise } from "./core";
import { placeOf, propsOf, texturedGround } from "./place";
import * as models from "./props";
import { heightfield } from "./terrain";
import type { Scenery, WorldCtx } from "./world";

// The volcano: ONE big cone, with real volume — three rings of black rock with their ledges, a crater lip, steep inner walls and a lake of
// lava in layers (#9a2a12, #e8461a, #ff8a24, #ffd45a) that glows with the eruption's own timeline. The road is carved through the cone's
// flank (steep banks either side), the rest is flat black ash with scattered rocks and two lava pools in the corners. No lava flows, no
// lightning: only the cone, the crater, the lake and what the eruption throws up (see hazards3d.ts).

/** Height (m) of the cone's profile by distance from its centre (world units): ledges at the ring edges (480, 340), a thin lip at 215. */
const PROFILE: Key[] = [
  [0, 25], [150, 25], [165, 33], [180, 52], [195, 67], [205, 72], [215, 72], [232, 70], [275, 64], [340, 55], [420, 45], [480, 38], [560, 30], [620, 24],
  [760, 15], [900, 8], [1100, 2.5], [1300, 0], [1600, 0],
];
const COL = {
  rings: ["#3a302d", "#4a3a34", "#5c453c"], lip: "#a08672", lipDark: "#7a5a4a", wall: "#3a1a14", glowWall: "#7a2a12", cut: "#24201e", ash: "#2a2220",
  lake: ["#9a2a12", "#e8461a", "#ff8a24", "#ffd45a"],
};

export function buildVolcano(ctx: WorldCtx): Scenery {
  const { adapter, d, group, field, quality } = ctx, track = adapter.race.track, b = track.bounds, barrierM = track.barrier * K;

  // ---- the ground: black ash with soft blotches and grit ----
  texturedGround(d, group, b, "#1c1514", 2048, (g, w, h, sx, sy) => {
    g.fillStyle = COL.ash;
    g.fillRect(0, 0, w, h);
    const rng = mulberry32(4001);
    for (let i = 0; i < 60; i++) {
      const x = (rng() * (b.maxX - b.minX)) * sx, y = (rng() * (b.maxY - b.minY)) * sy, rx = (120 + rng() * 240) * sx, ry = (50 + rng() * 120) * sy, light = rng() < 0.5;
      const gr = g.createRadialGradient(x, y, 0, x, y, rx);
      gr.addColorStop(0, light ? "rgba(105,95,92,0.32)" : "rgba(8,5,5,0.4)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.save();
      g.translate(x, y);
      g.scale(1, ry / rx);
      g.translate(-x, -y);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    for (let i = 0; i < 22000; i++) {
      g.fillStyle = hash2(i, 3) > 0.55 ? "rgba(150,138,132,0.10)" : "rgba(0,0,0,0.16)";
      g.fillRect(hash2(i, 4) * w, hash2(i, 5) * h, 1 + hash2(i, 6) * 2, 1 + hash2(i, 7) * 2);
    }
  });

  // ---- the cone: a height field over the volcano's own square ----
  const half = Math.max(RING_R[0] * 2, 1320);
  const wob = (a: number) => 1 + 0.06 * Math.sin(a * 2 + 1.3) + 0.04 * Math.sin(a * 3 + 0.4) + 0.025 * Math.sin(a * 5 + 2.0);
  const cRing = COL.rings.map((c) => new THREE.Color(c));
  const cAsh = new THREE.Color(COL.ash), cLip = new THREE.Color(COL.lip), cLipD = new THREE.Color(COL.lipDark), cWall = new THREE.Color(COL.wall), cGlow = new THREE.Color(COL.glowWall), cCut = new THREE.Color(COL.cut);
  const tmp = new THREE.Color();
  const cell = quality.level >= 1 ? 2.2 : 1.6;
  /** Height of the ground at a world point (m), and how much the road's cut took off it (1 = nothing). */
  const terrain = (x: number, y: number) => {
    const dx = x - CONE.x, dy = y - CONE.y, r = Math.hypot(dx, dy) / wob(Math.atan2(dy, dx));
    let h = spline(PROFILE, r);
    if (h > 0.01) h += (fbm(x * 0.05, y * 0.05, 5, 4) - 0.5) * 3.2 * smoothstep(0, 30, h) * smoothstep(165, 230, r) + (vnoise(x * 0.22, y * 0.22, 7) - 0.5) * 1.2 * smoothstep(0, 20, h);
    // The road cuts through the flank: flat inside the barriers, steep banks just beyond.
    const dist = field.query(x, y, 300);
    const dm = isFinite(dist) ? dist * K : 99, carve = smoothstep(barrierM + 0.3, barrierM + 6.5, dm);
    return { h: h * carve, carve, r };
  };
  const geo = heightfield(d, CONE.x - half, CONE.y - half, CONE.x + half, CONE.y + half, cell, (x, y, o) => {
    const { h, carve, r } = terrain(x, y);
    o.h = h;
    // Colour: rings, ledges, the lip, the inner wall warming toward the lake.
    const n = 0.88 + vnoise(x * 0.3, y * 0.3, 11) * 0.24 + (fbm(x * 0.06, y * 0.06, 2, 3) - 0.5) * 0.2;
    if (r < 195) tmp.copy(cWall).lerp(cGlow, smoothstep(185, 150, r) * 0.9);
    else if (r < 235) tmp.copy(cLipD).lerp(cLip, smoothstep(210, 218, r) * (1 - smoothstep(222, 235, r)));
    else if (r < 340) tmp.copy(cRing[2]);
    else if (r < 480) tmp.copy(cRing[1]);
    else if (r < 620) tmp.copy(cRing[0]);
    else tmp.copy(cRing[0]).lerp(cAsh, smoothstep(620, 900, r));
    // A pale edge on each ledge.
    for (const e of [480, 340]) if (Math.abs(r - e) < 6) tmp.lerp(cLip, 0.18 * (1 - Math.abs(r - e) / 6));
    tmp.lerp(cCut, (1 - carve) * 0.55 * smoothstep(1, 8, h));
    tmp.multiplyScalar(n * 1.3);
    o.r = tmp.r;
    o.g = tmp.g;
    o.b = tmp.b;
  });
  const cone = new THREE.Mesh(geo, d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })));
  cone.position.y = -0.0;
  cone.castShadow = true;
  cone.receiveShadow = true;
  group.add(cone);

  // ---- the crater lake: four layers of lava, irregular and slowly turning ----
  const lakeY = 25.1, R = LAKE_R * K, layers: THREE.Mesh[] = [], mats: THREE.MeshStandardMaterial[] = [];
  COL.lake.forEach((c, i) => {
    const r = R * [1.04, 0.78, 0.5, 0.24][i], segs = 40, pts = new Float32Array((segs + 2) * 3), idx: number[] = [];
    pts.set([0, 0, 0], 0);
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2, rr = r * (0.88 + hash2(k % segs, i, 3) * 0.24);
      pts.set([Math.cos(a) * rr, 0, Math.sin(a) * rr], (k + 1) * 3);
      if (k < segs) idx.push(0, k + 2, k + 1);
    }
    const g = d.add(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = d.add(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2, roughness: 0.6, side: THREE.DoubleSide }));
    const m = new THREE.Mesh(g, mat);
    m.position.set(CONE.x * K, lakeY + i * 0.06, CONE.y * K);
    group.add(m);
    layers.push(m);
    mats.push(mat);
  });
  const glow = new THREE.PointLight("#ff7a2a", 0, 260, 2);
  glow.position.set(CONE.x * K, 40, CONE.y * K);
  group.add(glow);

  // ---- black rocks, and the two lava pools in the corners ----
  const matProp = propMaterial(d);
  const rocks = propsOf(adapter.props, "rock").map((p, i): Placement => ({ ...placeOf(p, 1, i), s: p.r * K * 1.05, y: terrain(p.x, p.y).h - 0.1 }));
  const rockMesh = instanced(d, models.rockModel(2, "#1e1715", "#3a2e2a"), matProp, rocks);
  if (rockMesh) group.add(rockMesh);
  const pools = propsOf(adapter.props, "lavapool");
  pools.forEach((p, k) => {
    const pm: THREE.Mesh[] = [];
    COL.lake.forEach((c, i) => {
      const rr = p.r * K * [1.0, 0.72, 0.46, 0.22][i];
      const g = d.add(new THREE.CircleGeometry(rr, 28));
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, d.add(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.0, roughness: 0.6 })));
      m.position.set(p.x * K, 0.05 + i * 0.012 + k * 0.001, p.y * K);
      group.add(m);
      pm.push(m);
    });
    const rim = new THREE.Mesh(d.add(new THREE.RingGeometry(p.r * K * 1.0, p.r * K * 1.22, 28).rotateX(-Math.PI / 2)), d.add(new THREE.MeshStandardMaterial({ color: "#15100e", roughness: 1 })));
    rim.position.set(p.x * K, 0.045, p.y * K);
    group.add(rim);
  });

  return {
    lights: { glow },
    heightAt: (x, y) => terrain(x, y).h,
    craterY: lakeY,
    update(dt, time, a) {
      const e = a.eruption();
      const g = e ? e.glow() : 0.3, flash = e ? e.flash : 0;
      layers.forEach((m, i) => {
        m.rotation.y = time * (0.06 + i * 0.035) * (i % 2 ? -1 : 1);
        mats[i].emissiveIntensity = lerp(0.7, 2.0, g) + i * 0.15 + flash * 2 + Math.sin(time * (1.3 + i) + i) * 0.12;
      });
      glow.intensity = 14000 * g + 120000 * flash;
      void dt;
    },
  };
}
