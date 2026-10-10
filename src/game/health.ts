// Hit points, in every mode that can hurt a car (the volcano's bombs and lava pools, the north pole's yeti). The points live on the car; a mode's
// hazard calls `hurt`. A worn car smokes (50 %), burns (25 %) and is slower (25 %); at 0 HP it blows up: it is out of the race, its wreck burns on
// the spot for a few seconds and is solid for nobody (nothing to get stuck on), it never finishes and ranks behind every car still in the race.
// The red screen, the bar and the "destroyed" message are drawn here, for the player's car only.

export const HEALTH = {
  MAX: 100,
  /** At or under this share of the points (%), the car is slowed to LOW_SLOW and burns. */
  LOW: 25,
  LOW_SLOW: 0.6,
  /** How long the wreck stays (s), the last second fading out. */
  WRECK_LIFE: 4,
  /** The white segment's catch-up speed (points per second). */
  CATCH_UP: 30,
  /** The red screen after a hit (s). */
  FLASH: 0.6,
};

/** Modes whose hazards can hurt a car: they show the HP bar. */
const MODES = new Set(["volcano", "northpole"]);
export const hasHealth = (modeId: string) => MODES.has(modeId);

export type HealthCar = { hp: number; hpShown: number; hurtAt: number; destroyedAt: number | null };

export const isDestroyed = (c: { destroyedAt: number | null }) => c.destroyedAt !== null;

/** Share of its top speed and acceleration a car keeps, from its points. */
export const healthSpeed = (c: { hp: number }) => (c.hp <= HEALTH.LOW ? HEALTH.LOW_SLOW : 1);

/** Takes `amount` points off a car (never below 0, nothing once it is destroyed); returns what it really lost. `time` = the race clock. */
export function hurt(c: HealthCar, amount: number, time: number): number {
  if (c.hp <= 0 || amount <= 0) return 0;
  const lost = Math.min(c.hp, amount);
  c.hp -= lost;
  c.hurtAt = time;
  return lost;
}

/** One step: the white segment catches up with the real value. */
export function stepHealth(c: HealthCar, dt: number) {
  c.hpShown = c.hp < c.hpShown ? Math.max(c.hp, c.hpShown - HEALTH.CATCH_UP * dt) : c.hp;
}

/** 1 while the wreck is fully there, fading to 0 over its last second, 0 once it is gone; 1 for a car still in the race. */
export function wreckAlpha(c: { destroyedAt: number | null }, time: number): number {
  if (c.destroyedAt === null) return 1;
  return Math.max(0, Math.min(1, (c.destroyedAt + HEALTH.WRECK_LIFE - time) / 1));
}

/** Seconds since the car blew up (0 for a car still in the race). */
export const wreckAge = (c: { destroyedAt: number | null }, time: number) => (c.destroyedAt === null ? 0 : Math.max(0, time - c.destroyedAt));

type Ctx = CanvasRenderingContext2D;

/** The player's HP bar (under the race panel), the slowdown badge, the red screen of a hit and the "destroyed" message; screen pixels. */
export function drawHealthHud(ctx: Ctx, car: HealthCar, time: number, W: number, H: number, calm = false) {
  ctx.save();
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  const ratio = car.hp / HEALTH.MAX;
  // Red edges: more and more as the points run out, a flash right after a hit.
  const flash = Math.max(0, 1 - (time - car.hurtAt) / HEALTH.FLASH);
  const v = Math.min(0.9, Math.max(0, 0.5 - ratio) * 1.8) + flash * (calm ? 0.2 : 0.5);
  if (v > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.65);
    g.addColorStop(0, "rgba(208,0,0,0)");
    g.addColorStop(1, `rgba(208,0,0,${Math.min(0.8, v)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const x = 58, y = 148;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(x, y, 240, 26, 10);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("PV", x + 12, y + 18);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(x + 36, y + 7, 150, 12, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.roundRect(x + 36, y + 7, Math.max(0, (150 * car.hpShown) / HEALTH.MAX), 12, 6); // white segment: the recent loss
  ctx.fill();
  if (car.hp > 0) {
    ctx.fillStyle = ratio > 0.5 ? "#3ddc84" : ratio > 0.25 ? "#ff9f1c" : "#d63a2f";
    ctx.beginPath();
    ctx.roundRect(x + 36, y + 7, 150 * ratio, 12, 6);
    ctx.fill();
  }
  ctx.fillStyle = ratio <= 0.25 ? "#ff6b5f" : "#fff";
  ctx.fillText(Math.round(ratio * 100) + "%", x + 198, y + 18);
  if (car.hp > 0 && ratio * 100 <= HEALTH.LOW) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(x, y + 34, 130, 24, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(`↓ Vitesse −${Math.round((1 - HEALTH.LOW_SLOW) * 100)} %`, x + 12, y + 51);
  }
  if (car.destroyedAt !== null) {
    const k = Math.min(1, (time - car.destroyedAt) / 0.5);
    ctx.globalAlpha = k;
    ctx.textAlign = "center";
    ctx.font = "900 44px sans-serif";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText("VOITURE DÉTRUITE", W / 2, H * 0.3);
    ctx.fillStyle = "#ff5a3c";
    ctx.fillText("VOITURE DÉTRUITE", W / 2, H * 0.3);
  }
  ctx.restore();
}
