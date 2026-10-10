import { CAR_LENGTH } from "./car";

// The Racerz Jet's drawing: a white and red plane-car whose wings fold away on the ground and spread in the air. It is drawn in a
// "design" frame — nose toward -y, a 20 × 66 body, 116 wide with the wings open — and scaled to be 25 % longer than a normal car.
// Purely visual: the hitbox is the same as every other car's (body only, never the wings).

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Length of the design body, and how much longer than a normal car the Jet is drawn. */
export const JET_DESIGN_LENGTH = 66;
export const JET_LENGTH_RATIO = 1.25;
/** Design units → world units (the drawn Jet is JET_LENGTH_RATIO × CAR_LENGTH long). */
export const JET_SCALE = (CAR_LENGTH * JET_LENGTH_RATIO) / JET_DESIGN_LENGTH;

export const JET_COLORS = { body: "#f2f6fa", accent: "#d63a2f" };

const JET_BODY: Pt[] = [[0, -36], [6, -28], [9, -10], [10, 10], [9, 26], [5, 30], [-5, 30], [-9, 26], [-10, 10], [-9, -10], [-6, -28]];

function fillPoly(ctx: Ctx, pts: Pt[], fill: string | null, stroke?: string, lw = 1) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.lineJoin = "miter";
    ctx.stroke();
  }
}

export type JetLook = {
  /** 0 = wings folded, 1 = wings open. */
  wing?: number;
  /** 0..1: the blue jet engines behind the car. */
  flame?: number;
  /** Draw a flat black silhouette instead (its shadow). */
  silhouette?: boolean;
  /** No flicker (prefers-reduced-motion). */
  steady?: boolean;
};

/** Draws the Jet at the origin, nose toward -y, in design units. */
export function drawJet(ctx: Ctx, o: JetLook = {}) {
  const w = clamp(o.wing ?? 0, 0, 1), sil = !!o.silhouette, c = (v: string) => (sil ? "#000000" : v);
  const T = performance.now() / 1000;
  const rF: Pt = [-9, -6], rR: Pt = [-9, 16]; // wing root (left)
  const F: Pt = [lerp(-13, -58, w), lerp(-4, 12, w)], Rr: Pt = [lerp(-13, -58, w), lerp(18, 20, w)]; // wing tip: folded -> open

  if (!sil && (o.flame ?? 0) > 0) {
    // blue jet engines, behind the car
    const f = (o.flame ?? 0) * (o.steady ? 1 : 0.85 + 0.3 * Math.sin(T * 40));
    ctx.fillStyle = "rgba(124,192,255,0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 50, 26, 30 * f, 0, 0, TAU);
    ctx.fill();
    fillPoly(ctx, [[-6.5, 30], [-2.5, 30 + 36 * f], [1.5, 30]], "#7cc0ff");
    fillPoly(ctx, [[1.5, 30], [5.5, 30 + 36 * f], [9.5, 30]], "#7cc0ff");
    fillPoly(ctx, [[-5, 30], [-2.5, 30 + 20 * f], [0, 30]], "#ffffff");
    fillPoly(ctx, [[3, 30], [5.5, 30 + 20 * f], [8, 30]], "#ffffff");
  }
  if (!sil) {
    // wheels: they tuck away as the wings open
    const wa = clamp(1 - w * 1.6, 0, 1);
    if (wa > 0) {
      ctx.save();
      ctx.globalAlpha *= wa;
      ctx.fillStyle = "#1b2430";
      for (const [x, y] of [[-14, -22], [9, -22], [-14, 16], [9, 16]]) {
        ctx.beginPath();
        ctx.roundRect(x, y, 5, 10, 1.5);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  for (const s of [1, -1]) {
    // tail plane, then the wings (left, then mirrored)
    ctx.save();
    ctx.scale(s, 1);
    fillPoly(ctx, [[-9, 22], [-26, 33], [-26, 37], [-9, 31]], c("#dfe7ef"), c("#8a99aa"), 1.2);
    fillPoly(ctx, [rF, F, Rr, rR], c("#dfe7ef"), c("#8a99aa"), 1.2);
    if (!sil && w > 0.3) {
      const t = 0.12;
      const a: Pt = [F[0] + (rF[0] - F[0]) * t, F[1] + (rF[1] - F[1]) * t], b: Pt = [Rr[0] + (rR[0] - Rr[0]) * t, Rr[1] + (rR[1] - Rr[1]) * t];
      fillPoly(ctx, [F, a, b, Rr], "#d63a2f"); // red wing tip
      if (w > 0.4) {
        // flaps
        ctx.strokeStyle = "#8a99aa";
        ctx.lineWidth = 1;
        for (const u of [0.3, 0.65]) {
          ctx.beginPath();
          ctx.moveTo(lerp(rF[0], F[0], u), lerp(rF[1], F[1], u));
          ctx.lineTo(lerp(rR[0], Rr[0], u), lerp(rR[1], Rr[1], u));
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  fillPoly(ctx, JET_BODY, c(JET_COLORS.body), c("#8a99aa"), 1.5); // fuselage
  if (!sil) {
    ctx.fillStyle = JET_COLORS.accent;
    ctx.fillRect(-1.8, -31, 3.6, 17);
    ctx.fillRect(-1.8, 10, 3.6, 18); // red stripes
    ctx.fillStyle = "#1f3a5a";
    ctx.strokeStyle = "#0f2238";
    ctx.lineWidth = 1; // canopy
    ctx.beginPath();
    ctx.ellipse(0, -5, 5.5, 9, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(124,192,232,0.7)";
    ctx.beginPath();
    ctx.ellipse(-1.8, -8, 1.8, 4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#444";
    ctx.beginPath();
    ctx.arc(-4, 29, 2.4, 0, TAU);
    ctx.arc(4, 29, 2.4, 0, TAU);
    ctx.fill();
  }
}

/**
 * Draws the Jet in the game's world frame: at (x, y), heading `angle` (0 = toward +x, like every car sprite).
 * `scale` multiplies the usual size (the garage showcase draws it bigger); `shadow` adds the soft ground shadow
 * the other cars have (the flight controller draws its own, detached one while airborne).
 */
export function drawJetSprite(ctx: Ctx, x: number, y: number, angle: number, look: JetLook & { scale?: number; shadow?: boolean } = {}) {
  const k = JET_SCALE * (look.scale ?? 1);
  if (look.shadow !== false) {
    ctx.save();
    ctx.globalAlpha *= 0.22;
    ctx.translate(x + 2, y + 2.5);
    ctx.rotate(angle + Math.PI / 2);
    ctx.scale(k, k);
    drawJet(ctx, { wing: look.wing, silhouette: true });
    ctx.restore();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.scale(k, k);
  drawJet(ctx, look);
  ctx.restore();
}
