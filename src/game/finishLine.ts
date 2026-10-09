// The start/finish line: a checkered band whose style follows the mode — stone (desert), basalt and
// lava (volcano), ice (north pole), classic black and white (every other mode, unknown ones included).
// Purely visual: where the line is and how a lap is detected (race.ts: the progress index crossing a
// multiple of the lap length) do not depend on this drawing in any way.
//
// Drawn in a "design" frame: a band of 128 × 32 (8 columns × 2 rows of 16 squares), origin in the
// middle of the band's left edge. Left-hand coordinates are relative to the left edge (x = 0), right-hand
// ones are mirrored from the right edge (x = 128) with `flip`.

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const FL = {
  desert: { A: "#6b2f1a", B: "#f3dcae", outline: "#3a1a0e" },
  // The volcano squares are drawn in layers (basalt / lava); A and B only name the two materials.
  volcano: { A: "#15100e", B: "#e8461a", outline: "#5a1a10" },
  north: { A: "#7cc0e8", B: "#f5fbff", outline: "#5aa5d0" },
  classic: { A: "#111111", B: "#ffffff", outline: "#111111" },
} as const;
type StyleKey = keyof typeof FL;

/** Theme id → style. Anything not listed (the other modes, and any unknown id) gets the classic line. */
const STYLE_OF: Record<string, StyleKey> = { desert: "desert", volcano: "volcano", north: "north", northpole: "north" };

function poly(ctx: Ctx, pts: Pt[], fill?: string, stroke?: string, lw?: number) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw || 1;
    ctx.lineJoin = "miter";
    ctx.stroke();
  }
}
/** Mirror of a left-hand shape onto the right-hand end of the band. */
const flip = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [128 - x, y]);

/** A small crack of a stone square, from a hash of its position (the same on every draw). */
function crack(ctx: Ctx, x: number, y: number, i: number, j: number, color: string) {
  const h = (i * 31 + j * 17) % 7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + 3 + h, y + 1.5);
  ctx.lineTo(x + 5 + (h % 3) * 2, y + 6);
  ctx.lineTo(x + 4 + h * 0.8, y + 9.5);
  ctx.lineTo(x + 8 + (h % 4), y + 14.5);
  ctx.stroke();
}

type Marker = { body: Pt[]; fill: string; stroke: string; shine?: { pts: Pt[]; fill: string }; glow?: Pt[] };

/** What stands at each end of the band, described on the left; the right-hand end is its mirror image (`flip`). */
const MARKERS: Partial<Record<StyleKey, Marker>> = {
  // A squared stone post with a lit edge.
  desert: {
    body: [[-9, -19], [1, -19], [1, 19], [-9, 19]], fill: "#c9a572", stroke: FL.desert.outline,
    shine: { pts: [[-8, -18], [-5, -18], [-5, 18], [-8, 18]], fill: "rgba(255,240,205,0.55)" },
  },
  // A hexagonal basalt column, glowing at both ends.
  volcano: {
    body: [[-9, -14], [-4, -19], [1, -14], [1, 14], [-4, 19], [-9, 14]], fill: "#15100e", stroke: "#2a2220",
    glow: [[-4, -14], [-4, 14]],
  },
  // An ice crystal, pale with a bright facet.
  north: {
    body: [[-8, -12], [-3, -20], [1, -12], [1, 12], [-3, 20], [-8, 12]], fill: "rgba(223,241,252,0.96)", stroke: FL.north.outline,
    shine: { pts: [[-3, -17], [0, -12], [0, 12], [-3, 17]], fill: "rgba(255,255,255,0.7)" },
  },
  // The classic line has no markers.
};

function endMarkers(ctx: Ctx, key: StyleKey) {
  const m = MARKERS[key];
  if (!m) return;
  for (const side of [(pts: Pt[]) => pts, flip]) {
    poly(ctx, side(m.body), m.fill, m.stroke, 1.2);
    if (m.shine) poly(ctx, side(m.shine.pts), m.shine.fill);
    for (const [x, y] of side(m.glow ?? [])) {
      ctx.fillStyle = "#ff8a24";
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd45a";
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * (cx, cy) = centre of the line in the game world
 * heading  = direction the cars travel, in radians (0 = to the right)
 * roadW    = width of the road; the band is 85 % of it
 * mode     = 'desert' | 'volcano' | 'north' (or 'northpole') | anything else → 'classic'
 */
export function drawFinishLine(ctx: Ctx, mode: string, cx: number, cy: number, heading: number, roadW: number) {
  const key = Object.hasOwn(STYLE_OF, mode) ? STYLE_OF[mode] : "classic";
  const bandW = roadW * 0.85, k = bandW / 128;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(heading - Math.PI / 2); // the local x axis now runs across the road
  ctx.scale(k, k);
  ctx.translate(-64, 0); // origin = left edge of the band, halfway up
  const c = FL[key];

  // --- behind the band ---
  if (key === "desert") {
    ctx.fillStyle = "rgba(107,47,26,0.18)";
    ctx.fillRect(-6, -22, 140, 44); // soft shadow
  }
  if (key === "volcano") {
    ctx.fillStyle = "rgba(255,106,31,0.20)";
    ctx.fillRect(-8, -26, 144, 52); // wide glow
    ctx.fillStyle = "rgba(255,106,31,0.25)";
    ctx.fillRect(-4, -21, 136, 42); // tight glow
  }
  if (key === "north") {
    ctx.fillStyle = "rgba(90,165,208,0.15)";
    ctx.fillRect(-6, -22, 140, 44);
    ctx.fillStyle = "#7ab4d6";
    ctx.fillRect(0, 16, 128, 7); // thickness of the ice slab
  }

  // --- checkerboard: 8 columns × 2 rows, square (i, j) is A when (i + j) is even, else B ---
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 2; j++) {
      const x = i * 16, y = -16 + j * 16, isA = (i + j) % 2 === 0;
      if (key === "volcano") {
        if (isA) {
          // basalt
          ctx.fillStyle = "#15100e";
          ctx.fillRect(x, y, 16, 16);
          ctx.strokeStyle = "#2a2220";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 1.5, y + 1.5, 13, 13);
        } else {
          // lava (3 layers)
          ctx.fillStyle = "#e8461a";
          ctx.fillRect(x, y, 16, 16);
          ctx.fillStyle = "#ff8a24";
          ctx.fillRect(x + 3, y + 3, 10, 10);
          ctx.fillStyle = "#ffd45a";
          ctx.fillRect(x + 6, y + 6, 4, 4);
        }
      } else if (key === "north") {
        ctx.fillStyle = isA ? c.A : c.B;
        ctx.fillRect(x, y, 16, 16);
        if (isA) {
          poly(ctx, [[x, y], [x + 10, y], [x, y + 10]], "rgba(255,255,255,0.35)");
        } else {
          ctx.strokeStyle = "#d9ecf7";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 1.5, y + 1.5, 13, 13);
        }
      } else {
        ctx.fillStyle = isA ? c.A : c.B;
        ctx.fillRect(x, y, 16, 16);
        if (key === "desert") {
          // Stone: a lit top-left edge, a shaded bottom-right edge and a crack.
          ctx.lineWidth = 1;
          ctx.strokeStyle = isA ? "rgba(243,220,174,0.35)" : "rgba(255,250,235,0.7)";
          ctx.beginPath();
          ctx.moveTo(x + 0.5, y + 15.5);
          ctx.lineTo(x + 0.5, y + 0.5);
          ctx.lineTo(x + 15.5, y + 0.5);
          ctx.stroke();
          ctx.strokeStyle = isA ? "rgba(30,12,6,0.55)" : "rgba(107,47,26,0.4)";
          ctx.beginPath();
          ctx.moveTo(x + 15.5, y + 0.5);
          ctx.lineTo(x + 15.5, y + 15.5);
          ctx.lineTo(x + 0.5, y + 15.5);
          ctx.stroke();
          crack(ctx, x, y, i, j, isA ? "rgba(243,220,174,0.3)" : "rgba(107,47,26,0.45)");
        }
      }
    }
  }

  // --- in front of the band: outline, then the markers at both ends ---
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = key === "classic" ? 1.5 : 2;
  ctx.lineJoin = "miter";
  ctx.strokeRect(0, -16, 128, 32);
  if (key === "north") {
    // A glint across the ice.
    poly(ctx, [[10, -16], [34, -16], [10, 8]], "rgba(255,255,255,0.18)");
    poly(ctx, [[96, 16], [118, 16], [118, -4]], "rgba(255,255,255,0.14)");
  }
  endMarkers(ctx, key);
  ctx.restore();
}
