import { K } from "../adapter3d";
import { mulberry32 } from "../scenery";
import { makeBear } from "./bear";
import { THREE, type Placement, fbm, hash2, instanced, part, propMaterial, smoothstep } from "./core";
import { placeOf, propsOf, texturedGround } from "./place";
import * as models from "./props";
import { coverSamples, sweep } from "./terrain";
import type { Scenery, WorldCtx } from "./world";

// The north pole: a white snowfield with glossy ice for a road, firs, igloos and a penguin colony, ice blocks, a bear statue and — over
// the road — the ice massif with a tunnel bored through it: a vaulted tunnel with lamps and an ice portal at each end, under a rounded
// mountain whose two foothills run beside the approach roads. (The bear that walks across the road is hazards3d.ts.)

const ICE = "#a8d2ec", SNOW = "#f4fbff", DEEP = "#5f9fcb";

export function buildNorthpole(ctx: WorldCtx): Scenery {
  const { adapter, d, group } = ctx, track = adapter.race.track, b = track.bounds, props = adapter.props, n = track.path.length;

  // ---- the snowfield: soft drifts (white and shadowed blue) and wind-carved lines ----
  texturedGround(d, group, b, "#dfe9f1", 2048, (g, w, h, sx, sy) => {
    g.fillStyle = "#eef4f9";
    g.fillRect(0, 0, w, h);
    const rng = mulberry32(3001);
    for (let i = 0; i < 70; i++) {
      const x = rng() * w, y = rng() * h, rx = (120 + rng() * 260) * sx, ry = (40 + rng() * 110) * sy, rot = (rng() - 0.5) * 1.2, light = rng() < 0.55;
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.scale(1, ry / rx);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, light ? "rgba(255,255,255,0.9)" : "rgba(170,200,225,0.5)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.strokeStyle = "rgba(160,190,215,0.4)";
    g.lineWidth = 1.5;
    g.lineCap = "round";
    g.beginPath();
    for (let i = 0; i < 220; i++) {
      const x = rng() * w, y = rng() * h, l = (40 + rng() * 140) * sx, a = -0.5 + rng() * 0.3;
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
    g.stroke();
    for (let i = 0; i < 12000; i++) {
      g.fillStyle = hash2(i, 3) > 0.5 ? "rgba(255,255,255,0.4)" : "rgba(150,185,215,0.12)";
      g.fillRect(hash2(i, 4) * w, hash2(i, 5) * h, 1 + hash2(i, 6) * 2, 1 + hash2(i, 7) * 2);
    }
  }, 0.85);

  const matProp = propMaterial(d);
  const put = (m: THREE.Object3D | null) => {
    if (m) group.add(m);
  };
  // ---- firs, igloos, penguins, ice blocks ----
  put(instanced(d, models.firModel(), matProp, propsOf(props, "fir").map((p, i) => placeOf(p, 2.2, i))));
  put(instanced(d, models.igloo(), matProp, propsOf(props, "igloo").map((p, i) => placeOf(p, 4, i, -(p.a ?? 0)))));
  put(instanced(d, models.iceBlock(), matProp, propsOf(props, "iceblock").map((p, i) => placeOf(p, 1.5, i, -(p.a ?? 0)))));
  const penguins: Placement[] = [];
  for (const c of propsOf(props, "penguin")) for (let i = 0; i < 3; i++) penguins.push({ x: (c.x + (i - 1) * 14) * K, z: (c.y + (i % 2) * 10) * K, ry: (hash2(i, Math.round(c.x), 2) - 0.5) * 0.8, s: 1.1 });
  put(instanced(d, models.penguin(), matProp, penguins));
  // The bear that stands in the snow (a statue: it never moves).
  for (const p of propsOf(props, "polarbear")) {
    const bear = makeBear(d);
    bear.walk(0.3);
    bear.group.position.set(p.x * K, 0, p.y * K);
    bear.group.rotation.y = -(p.a ?? 0);
    bear.group.scale.setScalar(0.85);
    group.add(bear.group);
  }

  // ---- the massif and its tunnel ----
  const cover = track.covers[0];
  if (cover) {
    const { from, count } = coverSamples(track, cover);
    const iceMat = d.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.04, flatShading: true, side: THREE.DoubleSide }));
    const tint = (geo: THREE.BufferGeometry, m: number, innerFrom: number) => {
      const p = geo.attributes.position, cols = new Float32Array(p.count * 3), ice = new THREE.Color(ICE), snow = new THREE.Color(SNOW), deep = new THREE.Color(DEEP), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const row = i % m, y = p.getY(i);
        if (row >= innerFrom) c.copy(deep).lerp(ice, smoothstep(0, 8, y) * 0.5);
        else c.copy(ice).lerp(snow, smoothstep(6, 17, y));
        c.multiplyScalar(0.92 + hash2(i, 5) * 0.12);
        cols.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    };
    // Roof: an outer dome and an inner vault, closed into one cross-section; both ends taper so the mountain meets the foothills.
    const N = 12, M = (N + 1) * 2 + 1, Wi = (track.barrier + 12) / 1, Hi = 9.2;
    const roofGeo = sweep(d, track, (i, k) => {
      const t = k / Math.max(1, count - 1), e = smoothstep(0, 0.1, t) * smoothstep(0, 0.1, 1 - t);
      const Wo = (240 + 130 * e), Ho = 10.5 + 11.5 * e + (fbm(k * 0.12, 3, 4, 2) - 0.5) * 4 * e;
      const pts: [number, number][] = [];
      for (let j = 0; j <= N; j++) {
        const phi = (Math.PI * j) / N;
        pts.push([-Wo * Math.cos(phi), Ho * Math.pow(Math.sin(phi), 0.8) + (j > 0 && j < N ? (hash2(i, j, 7) - 0.5) * 1.1 * e : 0)]);
      }
      for (let j = 0; j <= N; j++) {
        const phi = (Math.PI * j) / N;
        pts.push([Wi * Math.cos(phi), Hi * Math.pow(Math.sin(phi), 0.55)]);
      }
      pts.push(pts[0]);
      return pts;
    }, from, count, 8);
    tint(roofGeo, M, N + 1);
    const roof = new THREE.Mesh(roofGeo, iceMat);
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    // The foothills either side of the approach roads, rising to the mountain over the tunnel.
    const pad = 60, hFrom = (((from - pad) % n) + n) % n, hCount = count + pad * 2;
    for (const s of [-1, 1]) {
      const geo = sweep(d, track, (i, k) => {
        const t = k / Math.max(1, hCount - 1), e = smoothstep(0, 0.28, t) * smoothstep(0, 0.28, 1 - t), B = track.barrier;
        const H = 3 + 19 * e;
        const jit = (j: number) => (hash2(i, j, 9) - 0.5) * 1.6 * e;
        return [[s * (B + 4), 0], [s * (B + 6), H * 0.55 + jit(1)], [s * (B + 90), H + jit(2)], [s * (B + 200), H * 0.6 + jit(3)], [s * (B + 330), 0]];
      }, hFrom, hCount, 8);
      tint(geo, 5, 99);
      const hill = new THREE.Mesh(geo, iceMat);
      hill.castShadow = true;
      hill.receiveShadow = true;
      group.add(hill);
    }

    // Lamps along the tunnel's crown, and the ice portal at each end.
    const lamp = new THREE.MeshStandardMaterial({ color: "#fff4cf", emissive: "#ffe9a8", emissiveIntensity: 2.4, roughness: 0.5 });
    d.add(lamp);
    const lamps: Placement[] = [];
    for (let k = 3; k < count - 2; k += 5) {
      const i = (from + k) % n, p = track.path[i], t = track.tangents[i];
      for (const s of [-1, 0, 1]) {
        const lat = s * 62;
        lamps.push({ x: (p.x - t.y * lat) * K, y: Hi * Math.pow(Math.sin((Math.PI * (s === 0 ? 0.5 : s < 0 ? 0.28 : 0.72))), 0.55) - 0.35 + (s === 0 ? 0.0 : -0.15), z: (p.y + t.x * lat) * K, ry: -Math.atan2(t.y, t.x) });
      }
    }
    put(instanced(d, part(new THREE.BoxGeometry(1.1, 0.12, 0.5), "#ffffff"), lamp, lamps, false));
    for (const [idx, flip] of [[from, 1], [(from + count - 1) % n, -1]] as const) {
      const p = track.path[idx], t = track.tangents[idx], shape = new THREE.Shape(), Wg = Wi * K + 2.4, Hg = 13;
      shape.moveTo(-Wg, 0);
      shape.lineTo(-Wg, Hg - 4);
      shape.quadraticCurveTo(-Wg, Hg, 0, Hg);
      shape.quadraticCurveTo(Wg, Hg, Wg, Hg - 4);
      shape.lineTo(Wg, 0);
      shape.lineTo(Wi * K, 0);
      for (let j = 0; j <= 16; j++) {
        const a = (j / 16) * Math.PI;
        shape.lineTo(Wi * K * Math.cos(a), Hi * Math.pow(Math.sin(a), 0.55));
      }
      shape.closePath();
      const g = d.add(new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 1, curveSegments: 6 }));
      g.rotateY(-Math.PI / 2);
      const frame = new THREE.Mesh(g, d.add(new THREE.MeshStandardMaterial({ color: "#e6f6ff", roughness: 0.2, metalness: 0.05, flatShading: true })));
      frame.position.set(p.x * K, 0, p.y * K);
      frame.rotation.y = -Math.atan2(t.y, t.x) + (flip < 0 ? Math.PI : 0);
      frame.castShadow = true;
      group.add(frame);
    }
  }
  return {};
}
