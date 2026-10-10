import { BOOST } from "./boost";
import { type Car, isAirborne, speedOf } from "./car";
import { drawCarSprite } from "./carArt";
import type { FxView } from "./fx";
import { overheadLayer, staticLayer, tracePath } from "./layer";
import { type Race, TOTAL_LAPS, standings } from "./race";

const VIEW_SIZE = 1000; // world units visible across the smaller screen dimension

/**
 * Frame-rate watchdog for the turbo's optional effects: a second under BOOST.LOW_FPS drops the ghost images (level 1),
 * the next one the speed streaks (level 2); three good seconds in a row bring one level back. Render side only.
 */
const frames = { last: 0, acc: 0, n: 0, level: 0, good: 0 };
function watchFrameRate(): number {
  const now = performance.now();
  const dt = now - frames.last;
  frames.last = now;
  if (dt > 0 && dt < 1000) {
    frames.acc += dt;
    frames.n++;
  }
  if (frames.acc >= 1000) {
    const fps = (frames.n * 1000) / frames.acc;
    if (fps < BOOST.LOW_FPS) {
      frames.level = Math.min(2, frames.level + 1);
      frames.good = 0;
    } else if (fps > BOOST.LOW_FPS + 15 && frames.level > 0 && ++frames.good >= 3) {
      frames.level--;
      frames.good = 0;
    }
    frames.acc = 0;
    frames.n = 0;
  }
  return frames.level;
}

/** Draws a car like the normal sprite (skin included), translucent: the turbo's ghost images (a Jet keeps its wings as they are). */
function drawGhost(ctx: CanvasRenderingContext2D, car: Car, x: number, y: number, angle: number, alpha: number, wing: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawCarSprite(ctx, car.model, car.skin, x, y, angle, wing);
  ctx.restore();
}

/** Same scale the volcano's overlays use: the design car is 16 × 28, ours 40 × 22 (front toward +x). */
const DESIGN_SCALE = BOOST.SCALE;

export function formatTime(t: number | null): string {
  if (t === null || t < 0) return "--:--.---";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Draws the minimap; returns the y of its lower edge (the flight HUD hangs its altitude gauge under it). */
function drawMinimap(ctx: CanvasRenderingContext2D, race: Race, w: number): number {
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

  // Covered sections (tunnels, crater…): darker and dashed over the base line.
  ctx.lineCap = "round";
  ctx.lineWidth = track.width * 0.6;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.setLineDash([track.width * 0.25, track.width * 0.25]);
  for (const cover of track.covers) {
    ctx.beginPath();
    const n = track.path.length;
    const len = cover.start <= cover.end ? cover.end - cover.start : n - cover.start + cover.end;
    for (let k = 0; k <= len; k++) {
      const p = track.path[(cover.start + k) % n];
      if (k) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const car of race.cars) {
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.arc(car.pos.x, car.pos.y, (car.isPlayer ? 9 : 6) / s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return oy + 8 + (b.maxY - b.minY) * s;
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
  // A mode's hazard may shake the whole view (cars and ground together, so nothing slides under the cars).
  const shake = race.hazard?.shake?.(player.pos);
  if (shake) ctx.translate(shake.x, shake.y);

  const b = track.bounds;
  ctx.drawImage(staticLayer(theme, track, scene), b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 12;
  ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

  // Boost pads: over the track and the finish line, under everything that moves.
  const boost = race.boost;
  boost.quality = watchFrameRate();
  boost.drawGround(ctx, view);
  theme.fx.ground?.(ctx, scene, view);
  race.hazard?.drawGround?.(ctx, race.time, view);

  ctx.lineCap = "round";
  ctx.lineWidth = 6;
  for (const s of race.skids) {
    ctx.strokeStyle = `rgba(${theme.colors.skid},${0.35 * s.life})`;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }

  // The Jet's shadow slides away from it while it climbs (before the cars; only above 1 m).
  const flight = race.flight;
  flight?.drawShadow(ctx, player);
  flight?.drawDust(ctx); // the takeoff's cloud of sand, snow or ash
  boost.drawBehind(ctx, (car, x, y, angle, alpha) => drawGhost(ctx, car, x, y, angle, alpha, car.isPlayer && flight ? flight.look(car).wing : 0), race.cars);
  for (const car of race.cars) {
    if (car.isPlayer && flight && isAirborne(car)) continue; // drawn in the high layer below, over the scenery
    if (boost.isBoosting(car)) {
      // The flame comes out of the rear, under the body (local frame: front toward -y).
      ctx.save();
      ctx.translate(car.pos.x, car.pos.y);
      ctx.rotate(car.angle + Math.PI / 2);
      ctx.scale(DESIGN_SCALE, DESIGN_SCALE);
      boost.drawCarFlame(ctx, car);
      ctx.restore();
    }
    if (car.isPlayer && flight) flight.drawCar(ctx, car);
    else drawCarSprite(ctx, car.model, car.skin, car.pos.x, car.pos.y, car.angle);
    race.hazard?.drawCarOverlay?.(ctx, car.id, car.pos.x, car.pos.y, car.angle);
  }
  for (const p of race.straw) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot + p.life * 4);
    ctx.globalAlpha = Math.min(1, p.life * 1.5);
    ctx.fillStyle = "#e9cf6f";
    ctx.fillRect(-4, -1, 8, 2);
    ctx.restore();
  }
  race.hazard?.draw(ctx, race.time, view);
  theme.fx.air?.(ctx, scene, view);

  // Covered-section ceiling: fades out over the player (race.overheadOpacity) so they can
  // still see their car and the road while a bot elsewhere stays hidden under it.
  const overhead = overheadLayer(theme, track, scene);
  if (overhead) {
    ctx.globalAlpha = race.overheadOpacity;
    ctx.drawImage(overhead, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.globalAlpha = 1;
  }

  // High layer: a Jet above 20 m flies over everything (bridge, eruption, tunnel ceiling), below only the HUD.
  if (flight && isAirborne(player)) {
    flight.drawCar(ctx, player);
    race.hazard?.drawCarOverlay?.(ctx, player.id, player.pos.x, player.pos.y, player.angle);
    flight.drawWingTrails(ctx, player);
  }
  ctx.restore();

  theme.fx.screen?.(ctx, view);
  drawOverlay(ctx, race, w, h);
}

/** The HUD over the world: minimap, race readouts, turbo gauge, the mode's own readouts (HP, alerts), the Jet's energy. Screen space. */
function drawOverlay(ctx: CanvasRenderingContext2D, race: Race, w: number, h: number) {
  const player = race.cars[0];
  const mapBottom = drawMinimap(ctx, race, w);
  drawHud(ctx, race, w, h);
  race.boost.drawHud(ctx, player, w, h);
  race.hazard?.drawHud?.(ctx, w, h);
  race.flight?.drawHud(ctx, player, w, h, mapBottom, race.guard?.pill(player) ?? null);
}

/**
 * The same HUD alone, on a cleared (transparent) canvas: the 3D view draws the world in WebGL underneath and this canvas goes on top of it.
 * The 2D world is not drawn at all in this mode.
 */
export function renderHud(ctx: CanvasRenderingContext2D, race: Race, w: number, h: number) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  drawOverlay(ctx, race, w, h);
  ctx.restore();
}
