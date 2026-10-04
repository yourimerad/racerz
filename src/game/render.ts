import { CAR_LENGTH, CAR_WIDTH, speedOf } from "./car";
import { type Race, TOTAL_LAPS, standings } from "./race";
import type { Track } from "./track";

const VIEW_SIZE = 1000; // world units visible across the smaller screen dimension

export function formatTime(t: number | null): string {
  if (t === null || t < 0) return "--:--.---";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function tracePath(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.beginPath();
  track.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

let grassPattern: CanvasPattern | null = null;
function grass(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  if (grassPattern) return grassPattern;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return "#3a7d44";
  g.fillStyle = "#3a7d44";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#357240";
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  grassPattern = ctx.createPattern(c, "repeat");
  return grassPattern ?? "#3a7d44";
}

function drawTrack(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.lineJoin = ctx.lineCap = "round";
  // Kerbs: alternating red/white band just outside the asphalt.
  tracePath(ctx, track);
  ctx.lineWidth = track.width + 18;
  ctx.strokeStyle = "#f1f1f1";
  ctx.stroke();
  ctx.setLineDash([30, 30]);
  ctx.strokeStyle = "#d62828";
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = track.width;
  ctx.strokeStyle = "#4a4e57";
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.setLineDash([40, 40]);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
  ctx.setLineDash([]);

  // Checkered start/finish line at sample 0.
  const p = track.path[0], t = track.tangents[0];
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(t.y, t.x));
  const sq = 12, rows = Math.ceil(track.width / sq);
  for (let c = 0; c < 2; c++)
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = (r + c) % 2 ? "#111" : "#fff";
      ctx.fillRect(c * sq - sq, -track.width / 2 + r * sq, sq, sq);
    }
  ctx.restore();
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-CAR_LENGTH / 2 + 3, -CAR_WIDTH / 2 + 3, CAR_LENGTH, CAR_WIDTH);
  ctx.fillStyle = "#111";
  for (const [wx, wy] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) ctx.fillRect(wx - 5, wy - 3, 10, 6);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(20,30,50,0.85)";
  ctx.fillRect(2, -CAR_WIDTH / 2 + 4, 9, CAR_WIDTH - 8);
  ctx.fillRect(-14, -CAR_WIDTH / 2 + 5, 6, CAR_WIDTH - 10);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(-4, -2, 6, 4);
  ctx.restore();
}

function drawMinimap(ctx: CanvasRenderingContext2D, race: Race, w: number) {
  const { track } = race;
  const b = track.bounds;
  const size = Math.min(200, w * 0.28);
  const s = size / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const ox = w - size - 16, oy = 16;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.roundRect(ox - 8, oy - 8, size + 16, (b.maxY - b.minY) * s + 16, 10);
  ctx.fill();
  ctx.translate(ox - b.minX * s, oy - b.minY * s);
  ctx.scale(s, s);
  tracePath(ctx, track);
  ctx.lineWidth = track.width * 0.6;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.stroke();
  for (const car of race.cars) {
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.arc(car.pos.x, car.pos.y, (car.isPlayer ? 9 : 6) / s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, race: Race, w: number, h: number) {
  const player = race.cars[0];
  const order = standings(race);
  const pos = order.indexOf(player) + 1;
  const lap = Math.min(TOTAL_LAPS, Math.max(1, player.lap + 1));
  ctx.save();
  ctx.font = "600 15px ui-monospace, monospace";
  ctx.textBaseline = "top";
  const lines = [
    `POS  ${pos}/${race.cars.length}`,
    `TOUR ${lap}/${TOTAL_LAPS}`,
    `TEMPS ${formatTime(race.phase === "countdown" ? null : player.finishTime ?? race.time - player.lapStart)}`,
    `MEILL ${formatTime(player.bestLap)}`,
  ];
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.roundRect(12, 12, 210, lines.length * 22 + 14, 10);
  ctx.fill();
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, 24, 20 + i * 22));

  const kmh = Math.round(Math.abs(speedOf(player)) * 0.45);
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = "700 44px ui-monospace, monospace";
  ctx.fillText(String(kmh), w - 70, h - 18);
  ctx.font = "600 14px ui-monospace, monospace";
  ctx.fillText("km/h", w - 22, h - 26);

  if (race.phase === "countdown" || (race.time >= 0 && race.time < 0.8)) {
    const n = Math.ceil(-race.time);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 110px system-ui, sans-serif";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    const label = race.time < 0 ? String(n) : "GO!";
    ctx.strokeText(label, w / 2, h / 2 - 80);
    ctx.fillStyle = race.time < 0 ? "#ffd166" : "#06d6a0";
    ctx.fillText(label, w / 2, h / 2 - 80);
  }
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, race: Race, w: number, h: number) {
  const player = race.cars[0];
  const zoom = Math.min(w, h) / VIEW_SIZE;
  ctx.fillStyle = "#2f6b3a";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-player.pos.x, -player.pos.y);

  const b = race.track.bounds;
  ctx.fillStyle = grass(ctx);
  ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  ctx.strokeStyle = "#8d6e63";
  ctx.lineWidth = 12;
  ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

  drawTrack(ctx, race.track);

  ctx.lineCap = "round";
  ctx.lineWidth = 6;
  for (const s of race.skids) {
    ctx.strokeStyle = `rgba(20,20,20,${0.35 * s.life})`;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }

  for (const car of race.cars) drawCar(ctx, car.pos.x, car.pos.y, car.angle, car.color);
  ctx.restore();

  drawMinimap(ctx, race, w);
  drawHud(ctx, race, w, h);
}
