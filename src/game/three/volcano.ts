import { K } from "../adapter3d";
import { CONE, LAKE_R, RING_R } from "../modes/volcano";
import { mulberry32 } from "../scenery";
import { type Key, spline } from "./carbody";
import { THREE, type Placement, fbm, hash2, instanced, lerp, part, smoothstep, vnoise } from "./core";
import { placeOf, propsOf, texturedGround } from "./place";
import * as models from "./props";
import { surface, triplanar } from "./pbr";
import { coverSamples, heightfield, sweep } from "./terrain";
import type { Scenery, WorldCtx } from "./world";

// The volcano: ONE big cone, with real volume — three rings of black rock with their ledges, a crater lip, steep inner walls and a lake of
// lava in layers (#9a2a12, #e8461a, #ff8a24, #ffd45a) that glows with the eruption's own timeline. The road is carved through the cone's
// flank (steep banks either side), the rest is flat black ash with scattered rocks and two lava pools in the corners. No lava flows, no
// lightning: only the cone, the crater, the lake and what the eruption throws up (see hazards3d.ts). The road also goes THROUGH the cone: a
// covered lava tube (the layout's cover) — the cone stays whole over it (a roof that follows the mountain's own surface closes the cut the road
// makes), a rock headwall with an arch and a glowing rim marks each mouth, and inside, a dark vaulted liner with lava-lit lamps and strips.

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
  }, 1, { kind: "ash", normalScale: 1.2 });

  // ---- the cone: a height field over the volcano's own square ----
  const half = Math.max(RING_R[0] * 2, 1580); // the whole map: the circuit runs round the cone at 1 100 u
  const wob = (a: number) => 1 + 0.06 * Math.sin(a * 2 + 1.3) + 0.04 * Math.sin(a * 3 + 0.4) + 0.025 * Math.sin(a * 5 + 2.0);
  const cRing = COL.rings.map((c) => new THREE.Color(c));
  const cAsh = new THREE.Color(COL.ash), cLip = new THREE.Color(COL.lip), cLipD = new THREE.Color(COL.lipDark), cWall = new THREE.Color(COL.wall), cGlow = new THREE.Color(COL.glowWall), cCut = new THREE.Color(COL.cut);
  const tmp = new THREE.Color();
  const cell = quality.level >= 1 ? 2.2 : 1.6;
  /** The mountain's own height at a world point (m) before the road cuts it, and the distance to its centre (wobbled, world units). */
  const natural = (x: number, y: number) => {
    const dx = x - CONE.x, dy = y - CONE.y, r = Math.hypot(dx, dy) / wob(Math.atan2(dy, dx));
    let h = spline(PROFILE, r);
    if (h > 0.01) h += (fbm(x * 0.05, y * 0.05, 5, 4) - 0.5) * 3.2 * smoothstep(0, 30, h) * smoothstep(165, 230, r) + (vnoise(x * 0.22, y * 0.22, 7) - 0.5) * 1.2 * smoothstep(0, 20, h);
    return { h, r };
  };
  /** Height of the ground at a world point (m), and how much the road's cut took off it (1 = nothing). */
  const terrain = (x: number, y: number) => {
    const { h, r } = natural(x, y);
    // The road cuts through the flank: flat inside the barriers, steep banks just beyond.
    const dist = field.query(x, y, 300);
    const dm = isFinite(dist) ? dist * K : 99, carve = smoothstep(barrierM + 0.3, barrierM + 6.5, dm);
    return { h: h * carve, carve, r };
  };
  /** The colour of the mountain at a point (rings, ledges, the lip, the inner wall warming toward the lake), left in `tmp`. */
  const paint = (x: number, y: number, r: number, h: number, carve: number) => {
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
  };
  const geo = heightfield(d, CONE.x - half, CONE.y - half, CONE.x + half, CONE.y + half, cell, (x, y, o) => {
    const { h, carve, r } = terrain(x, y);
    o.h = h;
    paint(x, y, r, h, carve);
    o.r = tmp.r;
    o.g = tmp.g;
    o.b = tmp.b;
  });
  // Smooth normals and a triplanar basalt grain (see pbr.ts) in place of the old flat facets.
  const basalt = surface(d, "rock", 256);
  const cone = new THREE.Mesh(geo, triplanar(d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })), basalt, { tile: 6, albedo: 0.7, normal: 1.0 }));
  cone.position.y = -0.0;
  cone.castShadow = true;
  cone.receiveShadow = true;
  group.add(cone);

  // ---- the lava tube: the road goes through the mountain ----
  // The cone is cut flat along the whole road (above), so over a covered stretch the cut is closed by a roof that follows the mountain's own
  // surface (`natural`, sinking out of sight at its edges where the real ground takes over), with a rock headwall and an arch at each mouth.
  const n = track.path.length, sinkFrom = 215, roofHalf = 225, archW = track.barrier + 12, archH = 9.2;
  const arch = (w: number, h: number, steps = 16): [number, number][] => {
    const out: [number, number][] = [];
    for (let j = 0; j <= steps; j++) {
      const phi = (Math.PI * j) / steps;
      out.push([-w * Math.cos(phi), h * Math.pow(Math.sin(phi), 0.55)]);
    }
    return out;
  };
  /** Moves an extruded 2D shape (x = lateral in m, y = up, z = along the road in m) onto the road at sample `i`. */
  const onRoad = (g: THREE.BufferGeometry, i: number) => {
    const p = track.path[i], t = track.tangents[i], pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const lat = pos.getX(v), along = pos.getZ(v);
      pos.setX(v, p.x * K + t.x * along - t.y * lat);
      pos.setZ(v, p.y * K + t.y * along + t.x * lat);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };
  const rockMat = triplanar(d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })), basalt, { tile: 6, albedo: 0.7, normal: 1.0 });
  const linerMat = d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }));
  const glowMat = d.add(new THREE.MeshStandardMaterial({ color: "#ff8a2a", emissive: "#ff6a1f", emissiveIntensity: 2.2, roughness: 0.6, side: THREE.DoubleSide }));
  const lampMat = d.add(new THREE.MeshStandardMaterial({ color: "#ffd9a0", emissive: "#ffb060", emissiveIntensity: 2.6, roughness: 0.5 }));
  const lamps: Placement[] = [];
  const cover = track.covers[0];
  if (cover) {
    const { from, count } = coverSamples(track, cover);
    const last = (from + count - 1) % n;
    // Roof: across the road, at the mountain's height (lateral steps of 1.8 m); the outer 1.2 m sink so the real ground hides the seam.
    const LAT = 25, lats = Array.from({ length: LAT }, (_, j) => ((j / (LAT - 1)) * 2 - 1) * roofHalf);
    const roofGeo = sweep(d, track, (i) => {
      const p = track.path[i], t = track.tangents[i];
      return lats.map((lat): [number, number] => {
        const x = p.x - t.y * lat, y = p.y + t.x * lat, edge = smoothstep(sinkFrom, roofHalf, Math.abs(lat));
        return [lat, natural(x, y).h - 0.05 - edge * 1.3];
      });
    }, from, count, 8, 4);
    const rp = roofGeo.attributes.position, rc = new Float32Array(rp.count * 3);
    for (let v = 0; v < rp.count; v++) {
      const x = rp.getX(v) / K, y = rp.getZ(v) / K, { r } = natural(x, y);
      paint(x, y, r, rp.getY(v), 1);
      rc.set([tmp.r, tmp.g, tmp.b], v * 3);
    }
    roofGeo.setAttribute("color", new THREE.BufferAttribute(rc, 3));
    const roof = new THREE.Mesh(roofGeo, rockMat);
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    // Liner: the dark vault the cars drive in, with a lava-lit strip along each wall and lamps along the crown.
    const N = 14;
    const linerGeo = sweep(d, track, () => arch(archW, archH, N), from, count, 8, 3);
    const lp = linerGeo.attributes.position, lc = new Float32Array(lp.count * 3), liner = new THREE.Color("#2a1f1a"), warm = new THREE.Color("#4a2a1c");
    for (let v = 0; v < lp.count; v++) {
      const row = v % (N + 1), c = tmp.copy(liner).lerp(warm, hash2(v, 9) * 0.5);
      c.multiplyScalar(0.8 + hash2(Math.floor(v / (N + 1)) >> 1, row, 5) * 0.5);
      lc.set([c.r, c.g, c.b], v * 3);
    }
    linerGeo.setAttribute("color", new THREE.BufferAttribute(lc, 3));
    const lin = new THREE.Mesh(linerGeo, linerMat);
    lin.receiveShadow = true;
    group.add(lin);
    for (const s of [-1, 1]) {
      const strip = sweep(d, track, () => [[s * (archW - 4), 2.2], [s * (archW - 4), 3.0]], from, count, 8, 3);
      group.add(new THREE.Mesh(strip, glowMat));
    }
    for (let k = 3; k < count - 2; k += 6) {
      const i = (from + k) % n, p = track.path[i], t = track.tangents[i];
      for (const s of [-1, 0, 1]) {
        const lat = s * 62;
        lamps.push({ x: (p.x - t.y * lat) * K, y: archH * Math.pow(Math.sin(Math.PI * (s === 0 ? 0.5 : s < 0 ? 0.28 : 0.72)), 0.55) - 0.35 - (s === 0 ? 0 : 0.15), z: (p.y + t.x * lat) * K, ry: -Math.atan2(t.y, t.x) });
      }
    }
    const lampMesh = instanced(d, part(new THREE.BoxGeometry(1.1, 0.12, 0.5), "#ffffff"), lampMat, lamps, false);
    if (lampMesh) group.add(lampMesh);

    // The mouths: a rock headwall (the roof's cross-section with the arch cut out) and a glowing rim round the arch.
    const rimMat = glowMat;
    for (const [idx, dir] of [[from, 1], [last, -1]] as const) {
      const p = track.path[idx], t = track.tangents[idx];
      const shape = new THREE.Shape(), top = lats.map((lat): [number, number] => [lat * K, natural(p.x - t.y * lat, p.y + t.x * lat).h - 0.05]);
      shape.moveTo(-roofHalf * K, -3);
      shape.lineTo(roofHalf * K, -3);
      for (let j = top.length - 1; j >= 0; j--) shape.lineTo(top[j][0], top[j][1] - smoothstep(sinkFrom * K, roofHalf * K, Math.abs(top[j][0])) * 1.3);
      shape.closePath();
      const hole = new THREE.Path();
      arch(archW * K, archH).forEach(([x, y], j) => (j ? hole.lineTo(x, y) : hole.moveTo(x, y)));
      hole.closePath();
      shape.holes.push(hole);
      const slab = d.add(new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false, curveSegments: 4 }));
      slab.translate(0, 0, dir > 0 ? 0 : -1.2);
      onRoad(slab, idx);
      const wp = slab.attributes.position, sc = new Float32Array(wp.count * 3);
      for (let v = 0; v < wp.count; v++) {
        const x = wp.getX(v) / K, y = wp.getZ(v) / K;
        paint(x, y, natural(x, y).r, wp.getY(v), 1);
        sc.set([tmp.r * 0.85, tmp.g * 0.85, tmp.b * 0.85], v * 3);
      }
      slab.setAttribute("color", new THREE.BufferAttribute(sc, 3));
      const wall = new THREE.Mesh(slab, rockMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);

      const rim = new THREE.Shape(), outer = arch(archW * K + 1.1, archH + 1.0);
      outer.forEach(([x, y], j) => (j ? rim.lineTo(x, y) : rim.moveTo(x, y)));
      rim.lineTo(archW * K, 0);
      arch(archW * K, archH).reverse().forEach(([x, y]) => rim.lineTo(x, y));
      rim.lineTo(-archW * K - 1.1, 0);
      rim.closePath();
      const rimGeo = d.add(new THREE.ExtrudeGeometry(rim, { depth: 0.5, bevelEnabled: false, curveSegments: 4 }));
      rimGeo.translate(0, 0, dir > 0 ? -0.4 : -0.1);
      group.add(new THREE.Mesh(onRoad(rimGeo, idx), rimMat));
    }
  }

  // ---- lava cracks: glowing fissures running down the cone from the crater (they pulse with the eruption) ----
  const crackMat = d.add(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  {
    const pos: number[] = [], col: number[] = [], idx: number[] = [], hot = new THREE.Color("#ffd45a"), mid = new THREE.Color("#ff7a24"), cool = new THREE.Color("#b3300f"), tint = new THREE.Color();
    for (let c = 0; c < 46; c++) {
      const ang = hash2(c, 1, 401) * Math.PI * 2, r = 200 + hash2(c, 2, 401) * 150;
      let x = CONE.x + Math.cos(ang) * r, y = CONE.y + Math.sin(ang) * r;
      const steps = 9 + Math.floor(hash2(c, 3, 401) * 9), width = 0.35 + hash2(c, 4, 401) * 0.5;
      let dir = ang; // heading down the slope, with wander
      let prev: [number, number, number, number] | null = null;
      let ok = true;
      for (let k = 0; k <= steps && ok; k++) {
        const dist = field.query(x, y, 300);
        if (isFinite(dist) && dist * K < barrierM + 9) { ok = false; break; } // keep clear of the road and the tube
        const h = terrain(x, y).h + 0.07, t = k / steps, nx = -Math.sin(dir), nz = Math.cos(dir), w = width * (1 - 0.65 * t) * (0.7 + 0.6 * hash2(c, k, 403));
        const a: [number, number, number] = [x * K + nx * w, h, y * K + nz * w], b: [number, number, number] = [x * K - nx * w, h, y * K - nz * w];
        tint.copy(t < 0.35 ? hot.clone().lerp(mid, t / 0.35) : mid.clone().lerp(cool, (t - 0.35) / 0.65));
        const base = pos.length / 3;
        pos.push(...a, ...b);
        col.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
        if (prev) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
        prev = [x, y, h, t];
        dir += (hash2(c, k, 405) - 0.5) * 0.9;
        const stepLen = 26 + hash2(c, k, 407) * 22;
        x += Math.cos(dir) * stepLen;
        y += Math.sin(dir) * stepLen;
      }
    }
    if (idx.length) {
      const g = d.add(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      group.add(new THREE.Mesh(g, crackMat));
    }
  }

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
  const rocks = propsOf(adapter.props, "rock").map((p, i): Placement => ({ ...placeOf(p, 1, i), s: p.r * K * 1.05, y: terrain(p.x, p.y).h - 0.1 }));
  const rockMesh = instanced(d, models.rockModel(2, "#1e1715", "#3a2e2a"), triplanar(d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })), basalt, { tile: 2.2, albedo: 0.75, normal: 1.1 }), rocks);
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
      crackMat.color.setScalar(0.65 + 0.5 * g + flash * 0.6 + Math.sin(time * 2.1) * 0.05);
      void dt;
    },
  };
}
