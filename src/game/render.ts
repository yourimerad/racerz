import { CAR_LENGTH, CAR_WIDTH, speedOf } from "./car";
import type { FxView } from "./fx";
import { staticLayer, tracePath } from "./layer";
import { type Race, TOTAL_LAPS, standings } from "./race";

const VIEW_SIZE = 1000; // world units visible across the smaller screen dimension

export function formatTime(t: number | null): string {
  if (t === null || t < 0) return "--:--.---";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
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
  ctx.strokeStyle = race.theme.colors.minimap;
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
    `MODE ${race.theme.name}`,
    `POS  ${pos}/${race.cars.length}`,
    `TOUR ${lap}/${TOTAL_LAPS}`,
    `TEMPS ${formatTime(race.phase === "countdown" ? null : player.finishTime ?? race.time - player.lapStart)}`,
    `MEILL ${formatTime(player.bestLap)}`,
  ];
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.roundRect(12, 12, 210, lines.length * 22 + 14, 10);
  ctx.fill();
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? race.theme.colors.accent : "#fff";
    ctx.fillText(l, 24, 20 + i * 22);
  });

  const kmh = Math.round(Math.abs(speedOf(player)) * 0.45);
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.font = "700 44px ui-monospace, monospace";
  ctx.strokeText(String(kmh), w - 70, h - 18);
  ctx.fillText(String(kmh), w - 70, h - 18);
  ctx.font = "600 14px ui-monospace, monospace";
  ctx.strokeText("km/h", w - 22, h - 26);
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
    ctx.fillStyle = race.time < 0 ? race.theme.colors.accent : "#06d6a0";
    ctx.fillText(label, w / 2, h / 2 - 80);
  }
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, race: Race, w: number, h: number) {
  const { theme, scene, track } = race;
  const player = race.cars[0];
  const zoom = Math.min(w, h) / VIEW_SIZE;
  const view: FxView = {
    t: race.time + 10, cam: player.pos, zoom, sw: w, sh: h,
    minX: player.pos.x - w / 2 / zoom, maxX: player.pos.x + w / 2 / zoom,
    minY: player.pos.y - h / 2 / zoom, maxY: player.pos.y + h / 2 / zoom,
  };
  ctx.fillStyle = theme.colors.ground;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-player.pos.x, -player.pos.y);

  const b = track.bounds;
  ctx.drawImage(staticLayer(theme, track, scene), b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 12;
  ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

  theme.fx.ground?.(ctx, scene, view);

  ctx.lineCap = "round";
  ctx.lineWidth = 6;
  for (const s of race.skids) {
    ctx.strokeStyle = `rgba(${theme.colors.skid},${0.35 * s.life})`;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }

  for (const car of race.cars) drawCar(ctx, car.pos.x, car.pos.y, car.angle, car.color);
  theme.fx.air?.(ctx, scene, view);
  ctx.restore();

  theme.fx.screen?.(ctx, view);
  drawMinimap(ctx, race, w);
  drawHud(ctx, race, w, h);
}
