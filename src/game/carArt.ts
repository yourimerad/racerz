import { CAR_LENGTH, CAR_WIDTH } from "./car";
import type { ModelId, Skin } from "./garage";
import { drawJetSprite } from "./jetArt";

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

/** Gradients in car-local space, built once per context (a gradient follows the transform active at fill time). */
type Shades = { metal: CanvasGradient; flanks: CanvasGradient; ends: CanvasGradient; gloss: CanvasGradient; satin: CanvasGradient };
const shadeCache = new WeakMap<Ctx, Shades>();
function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function shades(ctx: Ctx): Shades {
  let s = shadeCache.get(ctx);
  if (!s) {
    s = {
      metal: linear(ctx, 0, -W, 0, W, [[0, "rgba(255,250,210,0.7)"], [0.5, "rgba(255,255,255,0)"], [1, "rgba(90,60,0,0.45)"]]),
      // Darker flanks (the body curves away from the light), a little more on the shadow side.
      flanks: linear(ctx, 0, -W - 1, 0, W + 1, [[0, "rgba(0,0,0,0.3)"], [0.24, "rgba(0,0,0,0)"], [0.72, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.4)"]]),
      ends: linear(ctx, -L - 1, 0, L + 1, 0, [[0, "rgba(0,0,0,0.25)"], [0.1, "rgba(0,0,0,0)"], [0.92, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.2)"]]),
      // Light streak along the bonnet and roof, just off the centreline.
      gloss: linear(ctx, 0, -W, 0, W, [[0.2, "rgba(255,255,255,0)"], [0.36, "rgba(255,255,255,0.32)"], [0.44, "rgba(255,255,255,0.1)"], [0.58, "rgba(255,255,255,0)"]]),
      satin: linear(ctx, 0, -W, 0, W, [[0.08, "rgba(255,255,255,0)"], [0.38, "rgba(255,255,255,0.09)"], [0.7, "rgba(255,255,255,0)"]]),
    };
    shadeCache.set(ctx, s);
  }
  return s;
}

function wash(ctx: Ctx, g: CanvasGradient) {
  ctx.fillStyle = g;
  ctx.fillRect(-L - 2, -W - 2, CAR_LENGTH + 4, CAR_WIDTH + 4);
}

/** Paint the current path with the skin: base, pattern, body volume (diffuse if matte), then the outline. */
function paint(ctx: Ctx, skin: Skin) {
  const sh = shades(ctx);
  ctx.fillStyle = skin.pattern === "carbon" ? carbon(ctx) : skin.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (skin.pattern === "stripes") {
    ctx.fillStyle = skin.accent;
    ctx.fillRect(-L - 2, -4, CAR_LENGTH + 4, 3);
    ctx.fillRect(-L - 2, 1, CAR_LENGTH + 4, 3);
  }
  if (skin.pattern === "metal") wash(ctx, sh.metal);
  wash(ctx, sh.flanks);
  wash(ctx, sh.ends);
  wash(ctx, skin.matte ? sh.satin : sh.gloss);
  ctx.restore();
  ctx.strokeStyle = skin.accent;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Four tyres, with the silver rim and dark hub showing on the outer half (the body hides the rest). */
function wheels(ctx: Ctx, front: number, rear: number, half: number, w = 10, h = 6) {
  const rimY = half + h / 2 - 2.6;
  ctx.fillStyle = "#121214";
  ctx.beginPath();
  for (let i = 0; i < 4; i++) ctx.roundRect((i & 1 ? rear : front) - w / 2, (i & 2 ? half : -half) - h / 2, w, h, 1.5);
  ctx.fill();
  ctx.fillStyle = "#aeb4bc";
  for (let i = 0; i < 4; i++) ctx.fillRect((i & 1 ? rear : front) - w / 2 + 1.8, (i & 2 ? rimY : -rimY) - 1.1, w - 3.6, 2.2);
  ctx.fillStyle = "#4a4e55";
  for (let i = 0; i < 4; i++) ctx.fillRect((i & 1 ? rear : front) - 0.8, (i & 2 ? rimY : -rimY) - 1.1, 1.6, 2.2);
}

/** Tinted glass for the current path: dark fill, a diagonal reflection streak, a pale rim. */
function glass(ctx: Ctx, x0: number, x1: number, tint = "rgba(14,20,32,0.92)") {
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const d = (x1 - x0) * 0.45;
  ctx.fillStyle = "rgba(190,215,245,0.3)";
  poly(ctx, [[x1 - d * 0.2, -W], [x1 - d * 0.75, -W], [x0 + d * 0.25, W], [x0 + d * 0.8, W]]);
  ctx.fill();
  ctx.restore();
}

/** Door mirrors on stalks, body-coloured, at bonnet-side x, sticking out to ±y. */
function mirrors(ctx: Ctx, skin: Skin, x: number, y: number) {
  ctx.fillStyle = skin.pattern === "carbon" ? carbon(ctx) : skin.body;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 0.5;
  for (let s = -1; s <= 1; s += 2) {
    ctx.beginPath();
    ctx.ellipse(x, s * y, 1.1, 1.4, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Fine panel lines (doors, bonnet, boot): flat list of segments x0,y0,x1,y1. One path, one stroke. */
function seams(ctx: Ctx, segs: number[]) {
  ctx.strokeStyle = "rgba(0,0,0,0.38)";
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    ctx.moveTo(segs[i], segs[i + 1]);
    ctx.lineTo(segs[i + 2], segs[i + 3]);
  }
  ctx.stroke();
}

/** Lamp as an ellipse: warm glow ring plus a hot core. */
function lamp(ctx: Ctx, x: number, y: number, rx: number, ry: number, glow: string, core: string) {
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(x + (x > 0 ? 0.2 : -0.2), y, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}
const HEAD = "#ffe7a0", HEAD_CORE = "#fffdf4", TAIL = "#c8160c", TAIL_CORE = "#ff5a3c";

// Bonnet edges, door shuts, boot lid.
const GT_SEAMS = [12, -7, L - 2.5, -6, 12, 7, L - 2.5, 6, 2.5, -W + 0.6, 2.5, -7.8, 2.5, W - 0.6, 2.5, 7.8,
  -8, -W + 0.6, -8, -7.8, -8, W - 0.6, -8, 7.8, -15, -6.5, -15, 6.5];
function gt(ctx: Ctx, skin: Skin) {
  wheels(ctx, 12, -12, 12);
  ctx.beginPath();
  ctx.roundRect(-L, -W, CAR_LENGTH, CAR_WIDTH, 6);
  paint(ctx, skin);
  // Discreet twin bonnet stripes (the "stripes" skin already runs full-length ones).
  if (skin.pattern !== "stripes") {
    ctx.fillStyle = skin.accent;
    const a0 = ctx.globalAlpha; // the caller's alpha (ghost images of a turbo are drawn translucent)
    ctx.globalAlpha = a0 * 0.6;
    ctx.fillRect(12, -2.7, L - 13.5, 1.2);
    ctx.fillRect(12, 1.5, L - 13.5, 1.2);
    ctx.globalAlpha = a0;
  }
  seams(ctx, GT_SEAMS);
  // Greenhouse: windscreen, side windows, rear window; the roof between keeps the body colour.
  poly(ctx, [[11, -6.5], [3, -7.6], [3, 7.6], [11, 6.5]]);
  glass(ctx, 3, 11);
  poly(ctx, [[-8, -7.6], [-14, -6], [-14, 6], [-8, 7.6]]);
  glass(ctx, -14, -8);
  ctx.fillStyle = "rgba(14,20,32,0.92)";
  ctx.fillRect(-8, -7.6, 11, 1.3);
  ctx.fillRect(-8, 6.3, 11, 1.3);
  mirrors(ctx, skin, 3.5, W + 0.6);
  for (const s of [-1, 1]) {
    lamp(ctx, L - 1.8, s * 7.4, 1.3, 2.4, HEAD, HEAD_CORE);
    lamp(ctx, -L + 1, s * 7.6, 0.9, 2.6, TAIL, TAIL_CORE);
  }
}

// Front lid edges, scissor-door shuts, engine bay outline.
const AVENTADOR_SEAMS = [9, -5.5, L - 3, -4, 9, 5.5, L - 3, 4, 6.5, -W, 6.5, -7.3, 6.5, W, 6.5, 7.3,
  -8.5, -6.3, -L + 2.5, -5.5, -8.5, 6.3, -L + 2.5, 5.5];
/** Lamborghini Aventador SVJ Roadster: hexagonal wedge, open cockpit, Y lights, engine louvres, big rear wing. */
function aventador(ctx: Ctx, skin: Skin) {
  wheels(ctx, 12, -12, 12, 11, 7);
  const body = [[L + 1, -4], [L - 2, -W + 1], [6, -W - 0.5], [-13, -W - 0.5], [-L, -W + 2], [-L, W - 2], [-13, W + 0.5], [6, W + 0.5], [L - 2, W - 1], [L + 1, 4]];
  poly(ctx, body);
  paint(ctx, skin);
  seams(ctx, AVENTADOR_SEAMS);
  // Angular side air intakes in the flanks, lit on their leading edge.
  for (const s of [-1, 1]) {
    poly(ctx, [[0, s * (W + 0.4)], [-11, s * (W + 0.4)], [-9, s * (W - 3.4)], [-3.5, s * (W - 2.4)]]);
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, s * (W + 0.2));
    ctx.lineTo(-3.5, s * (W - 2.4));
    ctx.lineTo(-9, s * (W - 3.4));
    ctx.stroke();
  }
  // A Roadster: the open cockpit (tub, two bucket seats, the steering wheel, the driver's helmet), a raked windscreen in front of it.
  poly(ctx, [[8.6, -6], [-9, -5.6], [-9, 5.6], [8.6, 6]]);
  ctx.fillStyle = "#0b0c0e";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#262a30";
    ctx.beginPath();
    ctx.roundRect(-8.2, s * 2.9 - 2.1, 6.6, 4.2, 1.2); // seat: back and cushion
    ctx.fill();
    ctx.fillStyle = "#33383f";
    ctx.fillRect(-8.4, s * 2.9 - 1.1, 1.3, 2.2); // headrest
  }
  ctx.strokeStyle = "#1d1f23";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(3.6, -2.9, 0.7, 1.7, 0, 0, Math.PI * 2); // steering wheel
  ctx.stroke();
  ctx.fillStyle = skin.matte ? "#3a3a40" : skin.accent;
  ctx.beginPath();
  ctx.arc(-5.6, -2.9, 1.7, 0, Math.PI * 2); // the driver's helmet
  ctx.fill();
  poly(ctx, [[11.4, -6.5], [8.6, -6.1], [8.6, 6.1], [11.4, 6.5]]);
  glass(ctx, 8.6, 11.4);
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // The buttress fins either side of the engine cover.
  ctx.fillStyle = skin.pattern === "carbon" ? carbon(ctx) : skin.body;
  for (const s of [-1, 1]) {
    poly(ctx, [[-9, s * 5.2], [-9, s * 6.3], [-17, s * 5.7], [-17, s * 5.2]]);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
  mirrors(ctx, skin, 6, W + 0.4);
  // Hexagonal engine cover louvres.
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1;
  for (let x = -16; x <= -10; x += 2) {
    ctx.beginPath();
    ctx.moveTo(x, -4.5);
    ctx.lineTo(x, 4.5);
    ctx.stroke();
  }
  // Y-shaped headlights: warm glow, then a white core on the same path.
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(L - 1, s * 5.5);
    ctx.lineTo(L - 5, s * 7);
    ctx.lineTo(L - 3, s * 9.5);
    ctx.moveTo(L - 5, s * 7);
    ctx.lineTo(L - 8, s * 7.5);
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = HEAD;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.strokeStyle = HEAD_CORE;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.lineCap = "butt";
  // SVJ rear wing on two struts, wider than the body, with dark endplates.
  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(-L + 2, -4, 3, 1.6);
  ctx.fillRect(-L + 2, 2.4, 3, 1.6);
  ctx.fillStyle = skin.matte ? "#111114" : skin.accent;
  ctx.fillRect(-L - 2, -W - 1.5, 4, CAR_WIDTH + 3);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(-L + 1.3, -W - 1.5, 0.7, CAR_WIDTH + 3);
  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(-L - 2.3, -W - 1.8, 4.6, 1.1);
  ctx.fillRect(-L - 2.3, W + 0.7, 4.6, 1.1);
  ctx.fillStyle = TAIL;
  ctx.fillRect(-L - 0.5, -W + 1, 1.2, 4);
  ctx.fillRect(-L - 0.5, W - 5, 1.2, 4);
  ctx.fillStyle = TAIL_CORE;
  ctx.fillRect(-L - 0.2, -W + 1.6, 0.6, 2.8);
  ctx.fillRect(-L - 0.2, W - 4.4, 0.6, 2.8);
}

// Bonnet edges and door shuts.
const F8_SEAMS = [9, -6.5, 16.5, -4.2, 9, 6.5, 16.5, 4.2, 4.5, -W + 1.6, 4.5, -7.4, 4.5, W - 1.6, 4.5, 7.4];
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
  seams(ctx, F8_SEAMS);
  // Side scoops sweeping into the rear flanks ahead of the rear wheels, lit on their inner lip.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-2.5, s * (W - 2.2));
    ctx.quadraticCurveTo(-7, s * (W - 0.2), -11.5, s * (W + 0.6));
    ctx.lineTo(-11.5, s * (W - 2.6));
    ctx.quadraticCurveTo(-7, s * (W - 3.4), -2.5, s * (W - 2.2));
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2.5, s * (W - 2.4));
    ctx.quadraticCurveTo(-7, s * (W - 3.6), -11.5, s * (W - 2.8));
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  // S-duct on the bonnet and the yellow shield.
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(12, -4, 3, 8);
  ctx.fillStyle = "#ffd400";
  ctx.fillRect(16, -1, 2, 2);
  // Slim swept headlights.
  for (const s of [-1, 1]) {
    poly(ctx, [[L - 1.2, s * 4.6], [L - 5.4, s * 8.6], [L - 6.8, s * 8.2], [L - 2.4, s * 4]]);
    ctx.fillStyle = HEAD;
    ctx.fill();
    ctx.strokeStyle = HEAD_CORE;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(L - 1.9, s * 4.5);
    ctx.lineTo(L - 5.8, s * 8.2);
    ctx.stroke();
  }
  // Windscreen, then the open cockpit with two seats.
  ctx.beginPath();
  ctx.roundRect(5, -7, 3, 14, 1.5);
  glass(ctx, 5, 8);
  mirrors(ctx, skin, 5.5, W - 0.2);
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
  ctx.beginPath();
  for (let x = -15; x <= -11; x += 2) {
    ctx.moveTo(x, -5);
    ctx.lineTo(x, 5);
  }
  ctx.stroke();
  // Small lip spoiler across the tail, lit on its leading edge.
  ctx.fillStyle = skin.matte ? "#1a1a1c" : skin.accent;
  ctx.fillRect(-17.6, -7.4, 1.4, 14.8);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(-16.6, -7.4, 0.4, 14.8);
  // Twin round taillights each side.
  for (const y of [-8, -5, 5, 8]) lamp(ctx, -L + 1.2, y, 1.2, 1.2, TAIL, TAIL_CORE);
}

// Bonnet edges and the boot lid.
const MX5_SEAMS = [8.5, -6.4, 16, -4.6, 8.5, 6.4, 16, 4.6, -10.5, -5.5, -10.5, 5.5, -10.5, -5.5, -17, -3.6, -10.5, 5.5, -17, 3.6];
/** Mazda MX-5: small rounded roadster, long hood, open two-seat cockpit with roll hoops, round headlights, short tail. */
function mx5(ctx: Ctx, skin: Skin) {
  wheels(ctx, 10, -9, 10, 9, 6);
  const body = [
    [L, -4], [16, -7], [10, -9], [0, -9.5], [-8, -9], [-14, -8], [-18, -5], [-L, -2],
    [-L, 2], [-18, 5], [-14, 8], [-8, 9], [0, 9.5], [10, 9], [16, 7], [L, 4],
  ];
  poly(ctx, body);
  paint(ctx, skin);
  seams(ctx, MX5_SEAMS);
  // Low windscreen ahead of the open cockpit.
  ctx.beginPath();
  ctx.roundRect(5, -7, 3, 14, 1.5);
  glass(ctx, 5, 8);
  mirrors(ctx, skin, 5.5, 9.6);
  // Open cockpit: two seats side by side with a centre console, steering wheel on the left.
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.roundRect(-7, -8, 11, 16, 3);
  ctx.fill();
  ctx.fillStyle = "#2c2c2e";
  ctx.fillRect(-5, -0.8, 8, 1.6);
  ctx.fillStyle = "#c8a27a";
  ctx.beginPath();
  for (const y of [-4.8, 1.2]) ctx.roundRect(-4, y, 7, 3.6, 1.5);
  ctx.fill();
  ctx.fillStyle = "#9c7a56";
  ctx.beginPath();
  for (const y of [-4.6, 1.4]) ctx.roundRect(-4.6, y, 2, 3.2, 1);
  ctx.fill();
  ctx.strokeStyle = "#3a3a3c";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.ellipse(3.2, -3, 0.6, 1.9, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Roll hoops behind each seat: body-tone fairings crossed by a polished bar.
  ctx.fillStyle = skin.matte ? "#2a2a2c" : skin.accent;
  ctx.beginPath();
  ctx.ellipse(-6.5, -3, 1.6, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(-6.5, 3, 1.6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = "round";
  ctx.strokeStyle = "#c4c9d0";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-6.2, -5);
  ctx.lineTo(-6.2, -1);
  ctx.moveTo(-6.2, 1);
  ctx.lineTo(-6.2, 5);
  ctx.stroke();
  ctx.lineCap = "butt";
  // Round/oval headlights up front, short integrated rear with small taillights.
  for (const s of [-1, 1]) {
    lamp(ctx, 15.5, s * 5.5, 2, 1.6, HEAD, HEAD_CORE);
    lamp(ctx, -L + 1.2, s * 3, 0.9, 1.7, TAIL, TAIL_CORE);
  }
}

// Front lid between the fenders, door shuts, engine lid.
const P911_SEAMS = [9.5, -4.6, 17.5, -3, 9.5, 4.6, 17.5, 3, 5.5, -6.2, 5.5, -7.9, 5.5, 6.2, 5.5, 7.9,
  -3.5, -5.6, -3.5, -7.4, -3.5, 5.6, -3.5, 7.4, -10.5, -5, -10.5, 5];
/** Porsche 911 Carrera: bulging front fenders with round headlights, fastback roofline, wide rear haunches, ducktail spoiler, rear light bar. */
function p911(ctx: Ctx, skin: Skin) {
  wheels(ctx, 12, -12, 11, 10, 6);
  const body = [
    [L, -3], [16, -6], [12, -8.5], [6, -8], [-2, -7.5], [-8, -8], [-14, -9.5], [-18, -7.5], [-L, -4],
    [-L, 4], [-18, 7.5], [-14, 9.5], [-8, 8], [-2, 7.5], [6, 8], [12, 8.5], [16, 6], [L, 3],
  ];
  poly(ctx, body);
  paint(ctx, skin);
  seams(ctx, P911_SEAMS);
  // Fastback greenhouse, rear-biased (the engine sits behind the rear axle): windscreen, slim side
  // windows and a long sloping rear window; the roof between keeps the body colour.
  poly(ctx, [[9, -4], [5, -6], [5, 6], [9, 4]]);
  glass(ctx, 5, 9);
  poly(ctx, [[-3, -5.4], [-9, -3.8], [-9, 3.8], [-3, 5.4]]);
  glass(ctx, -9, -3);
  ctx.fillStyle = "rgba(14,20,32,0.92)";
  poly(ctx, [[5, -6], [-3, -5.4], [-3, -4.3], [5, -4.9]]);
  ctx.fill();
  poly(ctx, [[5, 6], [-3, 5.4], [-3, 4.3], [5, 4.9]]);
  ctx.fill();
  mirrors(ctx, skin, 5, 8.9);
  // Round headlights set in the bulging front fenders, with a chrome bezel.
  ctx.strokeStyle = "rgba(225,230,238,0.75)";
  ctx.lineWidth = 0.45;
  for (const s of [-1, 1]) {
    lamp(ctx, 16, s * 6, 1.8, 1.8, HEAD, HEAD_CORE);
    ctx.beginPath();
    ctx.arc(16, s * 6, 1.9, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Ducktail spoiler over the wide rear haunches: lit leading edge, dark trailing lip.
  ctx.fillStyle = skin.matte ? "#1a1a1c" : skin.accent;
  poly(ctx, [[-14, -7.6], [-17.6, -8.4], [-17.6, 8.4], [-14, 7.6]]);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(-14.8, -7.6, 0.6, 15.2);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(-17.6, -8.4, 0.7, 16.8);
  // Full-width rear light bar.
  ctx.fillStyle = TAIL;
  ctx.fillRect(-L + 0.5, -6.5, 1.4, 13);
  ctx.fillStyle = TAIL_CORE;
  ctx.fillRect(-L + 0.9, -5.8, 0.6, 11.6);
}

const ART: Record<Exclude<ModelId, "jet">, (ctx: Ctx, skin: Skin) => void> = { gt, mx5, p911, aventador, f8 };

/**
 * `wing` only matters for the Racerz Jet (0 = wings folded): its drawing, shadow included, lives in jetArt.ts, which paints it in the skin.
 */
export function drawCarSprite(ctx: Ctx, model: ModelId, skin: Skin, x: number, y: number, angle: number, wing = 0) {
  if (model === "jet") {
    drawJetSprite(ctx, x, y, angle, { wing, skin });
    return;
  }
  ctx.save();
  // Soft drop shadow, offset in world space (fixed light): a wide faint layer under a tighter darker one.
  ctx.translate(x + 2, y + 2.5);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.beginPath();
  ctx.roundRect(-L - 1.5, -W - 1.5, CAR_LENGTH + 3, CAR_WIDTH + 3, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.roundRect(-L + 1, -W + 1, CAR_LENGTH - 2, CAR_WIDTH - 2, 6);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ART[model](ctx, skin);
  ctx.restore();
}
