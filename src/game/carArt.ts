import { CAR_LENGTH, CAR_WIDTH } from "./car";
import type { ModelId, Skin } from "./garage";

// Top-down car sprites drawn in code, nose pointing to +x, about CAR_LENGTH × CAR_WIDTH.

type Ctx = CanvasRenderingContext2D;
const L = CAR_LENGTH / 2, W = CAR_WIDTH / 2;

function poly(ctx: Ctx, pts: number[][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

const carbonCache = new WeakMap<Ctx, CanvasPattern | null>();
function carbon(ctx: Ctx): CanvasPattern | string {
  if (!carbonCache.has(ctx)) {
    const c = document.createElement("canvas");
    c.width = c.height = 4;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#24262a";
      g.fillRect(0, 0, 4, 4);
      g.fillStyle = "#34373c";
      g.fillRect(0, 0, 2, 2);
      g.fillRect(2, 2, 2, 2);
    }
    carbonCache.set(ctx, ctx.createPattern(c, "repeat"));
  }
  return carbonCache.get(ctx) ?? "#2a2c30";
}

/** Paint the current path with the skin: base, pattern, then gloss unless matte. */
function paint(ctx: Ctx, skin: Skin) {
  ctx.fillStyle = skin.pattern === "carbon" ? carbon(ctx) : skin.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (skin.pattern === "stripes") {
    ctx.fillStyle = skin.accent;
    ctx.fillRect(-L - 2, -4, CAR_LENGTH + 4, 3);
    ctx.fillRect(-L - 2, 1, CAR_LENGTH + 4, 3);
  }
  if (skin.pattern === "metal") {
    const g = ctx.createLinearGradient(0, -W, 0, W);
    g.addColorStop(0, "rgba(255,250,210,0.7)");
    g.addColorStop(0.5, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(90,60,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(-L, -W, CAR_LENGTH, CAR_WIDTH);
  }
  if (!skin.matte) {
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(-L, -W, CAR_LENGTH, W * 0.6);
  }
  ctx.restore();
  ctx.strokeStyle = skin.accent;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function wheels(ctx: Ctx, front: number, rear: number, half: number, w = 10, h = 6) {
  ctx.fillStyle = "#111";
  for (const x of [front, rear]) for (const y of [-half, half]) ctx.fillRect(x - w / 2, y - h / 2, w, h);
}

function gt(ctx: Ctx, skin: Skin) {
  wheels(ctx, 12, -12, 12);
  ctx.beginPath();
  ctx.roundRect(-L, -W, CAR_LENGTH, CAR_WIDTH, 6);
  paint(ctx, skin);
  ctx.fillStyle = "rgba(20,30,50,0.85)";
  ctx.fillRect(2, -W + 4, 9, CAR_WIDTH - 8);
  ctx.fillRect(-14, -W + 5, 6, CAR_WIDTH - 10);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(-4, -2, 6, 4);
}

/** Lamborghini Aventador SVJ: hexagonal wedge, Y lights, engine louvres, big rear wing. */
function aventador(ctx: Ctx, skin: Skin) {
  wheels(ctx, 12, -12, 12, 11, 7);
  const body = [[L + 1, -4], [L - 2, -W + 1], [6, -W - 0.5], [-13, -W - 0.5], [-L, -W + 2], [-L, W - 2], [-13, W + 0.5], [6, W + 0.5], [L - 2, W - 1], [L + 1, 4]];
  poly(ctx, body);
  paint(ctx, skin);
  // Side air intakes.
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  poly(ctx, [[-2, -W - 0.5], [-10, -W - 0.5], [-8, -W + 3]]);
  ctx.fill();
  poly(ctx, [[-2, W + 0.5], [-10, W + 0.5], [-8, W - 3]]);
  ctx.fill();
  // Angular canopy.
  ctx.fillStyle = "rgba(10,12,18,0.92)";
  poly(ctx, [[10, -5], [5, -7.5], [-6, -6.5], [-8, 0], [-6, 6.5], [5, 7.5], [10, 5]]);
  ctx.fill();
  ctx.fillStyle = "rgba(120,140,170,0.35)";
  poly(ctx, [[10, -5], [7, -6.5], [7, 6.5], [10, 5]]);
  ctx.fill();
  // Hexagonal engine cover louvres.
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1;
  for (let x = -16; x <= -10; x += 2) {
    ctx.beginPath();
    ctx.moveTo(x, -4.5);
    ctx.lineTo(x, 4.5);
    ctx.stroke();
  }
  // Y-shaped headlights.
  ctx.strokeStyle = "#fff6d8";
  ctx.lineWidth = 1.3;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(L - 1, s * 5.5);
    ctx.lineTo(L - 5, s * 7);
    ctx.lineTo(L - 3, s * 9.5);
    ctx.moveTo(L - 5, s * 7);
    ctx.lineTo(L - 8, s * 7.5);
    ctx.stroke();
  }
  // SVJ rear wing on two struts, wider than the body.
  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(-L + 2, -4, 3, 1.6);
  ctx.fillRect(-L + 2, 2.4, 3, 1.6);
  ctx.fillStyle = skin.matte ? "#111114" : skin.accent;
  ctx.fillRect(-L - 2, -W - 1.5, 4, CAR_WIDTH + 3);
  ctx.fillStyle = "#ff3b2f";
  ctx.fillRect(-L - 0.5, -W + 1, 1.2, 4);
  ctx.fillRect(-L - 0.5, W - 5, 1.2, 4);
}

/** Ferrari F8 Spider: curvy body, open cockpit with two seats, round taillights. */
function f8(ctx: Ctx, skin: Skin) {
  wheels(ctx, 12, -12, 12, 11, 7);
  ctx.beginPath();
  ctx.moveTo(L, -3);
  ctx.bezierCurveTo(L, -9, 12, -W + 1, 4, -W + 1.5);
  ctx.bezierCurveTo(-4, -W + 2, -8, -W - 1, -14, -W - 1);
  ctx.bezierCurveTo(-L, -W - 1, -L, -W + 3, -L, -6);
  ctx.lineTo(-L, 6);
  ctx.bezierCurveTo(-L, W - 3, -L, W + 1, -14, W + 1);
  ctx.bezierCurveTo(-8, W + 1, -4, W - 2, 4, W - 1.5);
  ctx.bezierCurveTo(12, W - 1, L, 9, L, 3);
  ctx.closePath();
  paint(ctx, skin);
  // S-duct on the bonnet and the yellow shield.
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(12, -4, 3, 8);
  ctx.fillStyle = "#ffd400";
  ctx.fillRect(16, -1, 2, 2);
  // Windscreen frame, then the open cockpit with two seats.
  ctx.fillStyle = "rgba(15,20,30,0.9)";
  ctx.beginPath();
  ctx.roundRect(5, -7, 3, 14, 1.5);
  ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.roundRect(-7, -7.5, 12, 15, 3);
  ctx.fill();
  ctx.fillStyle = "#c8a27a";
  for (const y of [-4.5, 0.8]) {
    ctx.beginPath();
    ctx.roundRect(-5, y, 7, 3.7, 1.5);
    ctx.fill();
  }
  // Roll hoops / headrests and engine louvres.
  ctx.fillStyle = skin.accent;
  ctx.beginPath();
  ctx.ellipse(-8.5, -3, 2, 2.6, 0, 0, Math.PI * 2);
  ctx.ellipse(-8.5, 3, 2, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  for (let x = -16; x <= -12; x += 2) {
    ctx.beginPath();
    ctx.moveTo(x, -5);
    ctx.lineTo(x, 5);
    ctx.stroke();
  }
  // Twin round taillights each side.
  ctx.fillStyle = "#ff2a1a";
  for (const y of [-8, -5, 5, 8]) {
    ctx.beginPath();
    ctx.arc(-L + 1.2, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ART: Record<ModelId, (ctx: Ctx, skin: Skin) => void> = { gt, aventador, f8 };

export function drawCarSprite(ctx: Ctx, model: ModelId, skin: Skin, x: number, y: number, angle: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.roundRect(-L + 3, -W + 3, CAR_LENGTH, CAR_WIDTH, 6);
  ctx.fill();
  ART[model](ctx, skin);
  ctx.restore();
}
