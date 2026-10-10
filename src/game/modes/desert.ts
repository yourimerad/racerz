import { drift, dot, type Fx } from "../fx";
import { disc, ellipse, jagged, mulberry32, onTrackPoint, range, rock, scatter, TAU, type Circle, type Rng, type Scene } from "../scenery";
import type { Track, TrackLayout } from "../track";

// Desert: a red-sandstone canyon all the way round, with a natural rock bridge over the road at
// its straightest stretch. The road is a ribbon of pale sand at the
// bottom of a ravine; on each side a jagged cliff face (lighter brown, lit rim) rises to the
// plateau, which is dotted with cracks, boulders and top-down cacti. All edges are broken
// lines drawn from fixed seeds (scenery.jagged), so the canyon is identical every race.

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

export const layout: TrackLayout = {
  points: [
    [420, 1700], [420, 1200], [520, 820], [850, 600], [1300, 520], [1750, 500],
    [2200, 560], [2600, 780], [2820, 1150], [2650, 1550], [2150, 1700],
    [1700, 1550], [1200, 1700], [750, 1800],
  ],
  // The bridge: samples 149-163 are the straightest ~157 units of the whole lap.
  covers: [{ from: 3.725, to: 4.075 }],
};

const COL = {
  plateau: "#c4663a", patch: "#b25830", crack: "#7a3519", rockBase: "#98582f", rockLight: "#b06a3e",
  cliff: "#b06a3e", rim: "#e8a874", foot: "#6b2f1a", floor: "#d6ae74",
  cactus: "#4a6a2e", cactusCore: "#6f9446",
  // The bridge is the same rock as the cliff (COL.cliff), only its edges are lit or shaded.
  bridgeDark: "#5a2a16", bridgeShadow: "#6b2f1a", bridgeCrack: "#6b2f1a",
};
/** Cliff face width between the canyon floor and the plateau. */
const CLIFF = 25;
/** Distance from the centerline to the cliff foot, a little beyond the barrier. */
const footOffset = (track: Track) => track.barrier + 16;

/** One jagged edge of the canyon as a closed loop, `offset` from the centerline on `side`. */
function edgeLoop(track: Track, side: 1 | -1, offset: number, amp: number, seed: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < track.path.length; i += 4) {
    const p = onTrackPoint(track, i, side * offset);
    pts.push([p.x, p.y]);
  }
  pts.push(pts[0]);
  return jagged(pts, amp, seed);
}

function tracePoly(ctx: Ctx, pts: Pt[]) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** The ground between two edge loops (either may be the outer one: even-odd fill). */
function fillBetween(ctx: Ctx, a: Pt[], b: Pt[], fill: string) {
  ctx.beginPath();
  tracePoly(ctx, a);
  tracePoly(ctx, b);
  ctx.fillStyle = fill;
  ctx.fill("evenodd");
}

function strokeLoop(ctx: Ctx, pts: Pt[], width: number, style: string) {
  ctx.beginPath();
  tracePoly(ctx, pts);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/** An irregular flat stain on the plateau. */
function blotch(ctx: Ctx, rng: Rng, x: number, y: number, r: number, fill: string) {
  const n = 9;
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, rr = r * range(rng, 0.6, 1.1);
    const px = x + Math.cos(a) * rr * 1.5, py = y + Math.sin(a) * rr;
    if (k) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A hairline fissure: a short random walk. */
function crack(ctx: Ctx, rng: Rng, x: number, y: number) {
  let a = rng() * TAU;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let k = 0; k < 6; k++) {
    a += range(rng, -0.6, 0.6);
    x += Math.cos(a) * range(rng, 14, 36);
    y += Math.sin(a) * range(rng, 14, 36);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Cactus seen from above: a round green crown with a lighter heart. */
function cactus(ctx: Ctx, c: Circle) {
  ellipse(ctx, c.x + c.r * 0.35, c.y + c.r * 0.4, c.r, c.r * 0.9, 0, "rgba(60,20,8,0.28)");
  disc(ctx, c.x, c.y, c.r, COL.cactus);
  ctx.strokeStyle = "rgba(20,40,10,0.35)";
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    ctx.beginPath();
    ctx.moveTo(c.x + Math.cos(a) * c.r * 0.5, c.y + Math.sin(a) * c.r * 0.5);
    ctx.lineTo(c.x + Math.cos(a) * c.r * 0.95, c.y + Math.sin(a) * c.r * 0.95);
    ctx.stroke();
  }
  disc(ctx, c.x, c.y, c.r * 0.5, COL.cactusCore);
}

// ---------- natural rock bridge ----------

/** The bridge in its own frame: u runs along the road (travel direction), v across it (right = +v). */
type Bridge = {
  x: number; y: number; angle: number;
  /** Length along the road. */
  len: number;
  /** Half-span of the deck across the road; it ends inside the cliff face. */
  deckHalf: number;
  /** Half-span including the buttresses welded onto the plateau on both sides. */
  headHalf: number;
  /** Which of the two faces (+u or -u) catches the light from the top-left. */
  litSide: 1 | -1;
};

function bridgeOf(track: Track): Bridge | null {
  const cover = track.covers[0];
  if (!cover) return null;
  const n = track.path.length;
  const len = cover.start <= cover.end ? cover.end - cover.start : n - cover.start + cover.end;
  let arc = 0;
  for (let k = 0; k < len; k++) {
    const a = track.path[(cover.start + k) % n], b = track.path[(cover.start + k + 1) % n];
    arc += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const mid = (cover.start + Math.floor(len / 2)) % n;
  const p = track.path[mid], t = track.tangents[mid];
  const reach = footOffset(track) + CLIFF;
  return {
    x: p.x, y: p.y, angle: Math.atan2(t.y, t.x), len: arc,
    deckHalf: reach - 4, headHalf: reach + 46,
    litSide: t.x + t.y < 0 ? 1 : -1, // light comes from the top-left: (-1, -1)
  };
}

/** Runs `draw` in the bridge's local frame (origin on the centerline, u along the road). */
function inBridgeFrame(ctx: Ctx, br: Bridge, draw: () => void) {
  ctx.save();
  ctx.translate(br.x, br.y);
  ctx.rotate(br.angle);
  draw();
  ctx.restore();
}

/** Continues the current subpath through `pts`. */
function lineAll(ctx: Ctx, pts: Pt[]) {
  for (const [x, y] of pts) ctx.lineTo(x, y);
}

/** Starts a new subpath at the first point and runs through the rest. */
function polyline(ctx: Ctx, pts: Pt[]) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  lineAll(ctx, pts);
}

/** A face of the bridge (u = ±len/2) as a jagged line between v = -half and +half. */
function bridgeFace(br: Bridge, side: 1 | -1, half: number, seed: number): Pt[] {
  return jagged([[(side * br.len) / 2, -half], [(side * br.len) / 2, half]], 3, seed);
}

/** Three fissures zig-zagging across the whole bridge, from one plateau to the other. */
function bridgeCracks(br: Bridge): Pt[][] {
  const rng = mulberry32(1004);
  return [-0.28, 0.02, 0.3].map((f) => {
    let u = f * br.len;
    const out: Pt[] = [];
    for (let v = -br.headHalf + 8; v <= br.headHalf - 8; v += 22) {
      u = Math.max(-br.len / 2 + 14, Math.min(br.len / 2 - 14, u + range(rng, -9, 9)));
      out.push([u, v]);
    }
    return out;
  });
}

function strokeCracks(ctx: Ctx, cracks: Pt[][]) {
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.strokeStyle = COL.bridgeCrack;
  ctx.lineWidth = 2.5;
  for (const c of cracks) {
    ctx.beginPath();
    polyline(ctx, c);
    ctx.stroke();
  }
}

/** Static layer: the two rock buttresses that weld the bridge onto the plateau, and their cracks. */
function bridgeHeads(ctx: Ctx, br: Bridge) {
  inBridgeFrame(ctx, br, () => {
    const u0 = -br.len / 2 - 12, u1 = br.len / 2 + 12;
    for (const side of [-1, 1] as const) {
      const far = side * br.headHalf, near = side * (br.deckHalf - 14);
      const edge = jagged([[u1, far], [u0, far]], 5, side > 0 ? 71 : 73);
      ctx.beginPath();
      ctx.moveTo(u0, near);
      ctx.lineTo(u1, near);
      lineAll(ctx, edge);
      ctx.closePath();
      ctx.fillStyle = COL.cliff;
      ctx.fill();
      // The plateau-side edge sits in the shade of its own rock.
      ctx.beginPath();
      polyline(ctx, edge);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(90,42,22,0.4)";
      ctx.stroke();
    }
    // Cracks continue past the deck into the cliff and buttresses (the deck draws its own part).
    ctx.save();
    ctx.beginPath();
    for (const side of [-1, 1]) ctx.rect(u0 - 4, side > 0 ? br.deckHalf : -br.headHalf - 4, u1 - u0 + 8, br.headHalf - br.deckHalf + 4);
    ctx.clip();
    strokeCracks(ctx, bridgeCracks(br));
    ctx.restore();
  });
}

/** Static layer, on the road: the bridge's shadow just past its exit (sun top-left). */
function bridgeShadow(ctx: Ctx, br: Bridge, track: Track) {
  inBridgeFrame(ctx, br, () => {
    const u = br.len / 2, depth = 46, half = footOffset(track);
    const g = ctx.createLinearGradient(u, 0, u + depth, 0);
    g.addColorStop(0, `rgba(107,47,26,0.32)`);
    g.addColorStop(1, "rgba(107,47,26,0)");
    ctx.fillStyle = g;
    ctx.fillRect(u, -half, depth, half * 2);
  });
}

/** Overhead layer: the deck itself, drawn over the cars so they pass underneath. */
function bridgeDeck(ctx: Ctx, br: Bridge) {
  inBridgeFrame(ctx, br, () => {
    const h = br.deckHalf, L = br.len / 2;
    const faceP = bridgeFace(br, 1, h, 81), faceN = bridgeFace(br, -1, h, 83).reverse();
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(-L, -h);
      lineAll(ctx, faceP);
      ctx.lineTo(L, h);
      lineAll(ctx, faceN);
      ctx.closePath();
    };
    outline();
    ctx.fillStyle = COL.cliff;
    ctx.fill();

    ctx.save();
    outline();
    ctx.clip();
    // Barely visible stains in the rock.
    const rng = mulberry32(1005);
    for (let i = 0; i < 9; i++) {
      blotch(ctx, rng, range(rng, -L * 0.7, L * 0.7), range(rng, -h * 0.9, h * 0.9), range(rng, 14, 30),
        i % 2 ? `rgba(122,53,25,${range(rng, 0.25, 0.3).toFixed(2)})` : `rgba(232,168,116,${range(rng, 0.25, 0.3).toFixed(2)})`);
    }
    strokeCracks(ctx, bridgeCracks(br));
    ctx.restore();

    // Lit face and shaded face; the sides stay unlined: the rock just merges into the cliff.
    ctx.lineCap = ctx.lineJoin = "round";
    for (const side of [1, -1] as const) {
      const lit = side === br.litSide;
      ctx.beginPath();
      polyline(ctx, side > 0 ? [[L, -h], ...faceP, [L, h]] : [[-L, h], ...faceN, [-L, -h]]);
      ctx.lineWidth = lit ? 3 : 4;
      ctx.strokeStyle = lit ? COL.rim : COL.bridgeDark;
      ctx.stroke();
    }
  });
}

export function scene(track: Track): Scene {
  const rng = mulberry32(1001);
  const b = track.bounds;
  const n = track.path.length;
  const foot = footOffset(track);
  const bridge = bridgeOf(track);

  // Both sides' edge loops: cliff foot (floor edge) and cliff rim (plateau edge).
  const footL = edgeLoop(track, -1, foot, 8, 11), footR = edgeLoop(track, 1, foot, 8, 23);
  const rimL = edgeLoop(track, -1, foot + CLIFF, 10, 37), rimR = edgeLoop(track, 1, foot + CLIFF, 10, 53);

  // Props stay on the plateau, clear of the cliff.
  const occ: Circle[] = [];
  for (let i = 0; i < n; i += 8) {
    const p = track.path[i];
    occ.push({ x: p.x, y: p.y, r: foot + CLIFF + 40 });
  }
  const rocks = scatter(track, rng, occ, 50, 10, 30);
  const cacti = scatter(track, rng, occ, 34, 10, 16);
  const patches = Array.from({ length: 140 }, () => ({
    x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY), r: range(rng, 30, 90), light: rng() < 0.3,
  }));
  const cracks = Array.from({ length: 90 }, () => ({ x: range(rng, b.minX, b.maxX), y: range(rng, b.minY, b.maxY) }));

  return {
    props: [...rocks.map((c) => ({ kind: "rock" as const, ...c })), ...cacti.map((c) => ({ kind: "cactus" as const, ...c }))],
    lava: [],
    vents: [],
    under(ctx) {
      const d = mulberry32(1002);
      // 1. Plateau (the base fill): stains, fissures, boulders, cacti.
      for (const p of patches) blotch(ctx, d, p.x, p.y, p.r, p.light ? "rgba(214,128,80,0.35)" : COL.patch);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = COL.crack;
      ctx.lineWidth = 2;
      for (const c of cracks) crack(ctx, d, c.x, c.y);
      for (const r of rocks) rock(ctx, d, r, COL.rockBase, COL.rockLight);
      for (const c of [...cacti].sort((p, q) => p.y - q.y)) cactus(ctx, c);

      // 2. Cliff: a lighter brown face with a bright rim, then the canyon floor inside it.
      fillBetween(ctx, rimL, rimR, COL.cliff);
      fillBetween(ctx, footL, footR, COL.floor);
      for (const loop of [rimL, rimR]) strokeLoop(ctx, loop, 3, COL.rim);
      // Contact shadow where the cliff meets the floor.
      for (const loop of [footL, footR]) strokeLoop(ctx, loop, 7, "rgba(107,47,26,0.5)");
      if (bridge) bridgeHeads(ctx, bridge);
    },
    onTrack(ctx) {
      // Two fine, continuous tyre tracks along the whole lap.
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = onTrackPoint(track, i, side * 26);
          if (i) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#d3a96d";
        ctx.stroke();
      }
      if (bridge) bridgeShadow(ctx, bridge, track);
    },
    over() {},
    overhead(ctx) {
      if (bridge) bridgeDeck(ctx, bridge);
    },
  };
}

export const fx: Fx = {
  screen(ctx, v) {
    drift(ctx, v, 110, 11, 1, 90, 14, (x, y, s, _i, h) => dot(ctx, x, y, (1.5 + 2.5 * h) * s, `rgba(235,210,160,${(0.2 + 0.3 * h).toFixed(2)})`));
    // Long wind-blown wisps.
    ctx.lineCap = "round";
    drift(ctx, v, 16, 12, 1.05, 150, 22, (x, y, s, i, h) => {
      ctx.strokeStyle = `rgba(245,225,185,${(0.08 + 0.1 * h).toFixed(2)})`;
      ctx.lineWidth = (6 + 8 * h) * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 60 * s, y + Math.sin(v.t + i) * 14 * s, x + 140 * s, y + 18 * s);
      ctx.stroke();
    });
  },
};
