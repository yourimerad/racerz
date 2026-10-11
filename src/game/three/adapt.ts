import type { QualityLevel } from "./core";

// Keeping the game smooth on any device: the 3D view watches its own frame rate and trades picture for speed in small steps (the resolution first,
// then lighter shadows, then none), quickly when it is slow and carefully when it is fast again. Pure: the view feeds it the frame rate once every
// half second, it answers with the step to use. No THREE, no DOM, so the checks can replay a device.

export type Step = { level: QualityLevel; /** Multiplies the level's own pixel ratio. */ scale: number };

/**
 * From the best picture to the lightest, each step cheaper than the one before: the resolution drops, or (steps 2 and 4) the shadows get lighter
 * and then go. `level` picks the shadows and the particles (see `qualityOf`), `scale` multiplies the level's pixel ratio.
 */
export const LADDER: readonly Step[] = [
  { level: 0, scale: 1 }, { level: 0, scale: 0.85 }, { level: 1, scale: 0.85 }, { level: 1, scale: 0.7 }, { level: 2, scale: 0.7 }, { level: 2, scale: 0.6 }, { level: 2, scale: 0.5 },
];

export const GOV = {
  /** Seconds per measurement. */
  WINDOW: 0.5,
  /** Below this frame rate the picture gets lighter. */
  TARGET: 52,
  /** Windows in a row under the target before a step down (1 s). */
  DOWN: 2,
  /** Windows in a row at the target + 5 before a step up (10 s). */
  UP: 20,
  /** The first seconds of a race (compiling, uploading) do not count. */
  SETTLE: 2,
  /** A step down that cuts the pixels by at least this share and gains less than `MIN_GAIN` (×) did not help: the rate is capped by something else (a 30 Hz screen, a throttled tab). */
  BIG_CUT: 0.15,
  MIN_GAIN: 1.12,
  /** A step that was left because it was too heavy is not tried again for this long (s); doubled each time the retry fails at once. */
  RETRY: 60,
} as const;

export class QualityGovernor {
  index: number;
  /** The frame rate it tries to hold: lowered when the device turns out to be capped under it. */
  target: number = GOV.TARGET;
  private t = 0;
  private low = 0;
  private high = 0;
  private lowSum = 0;
  private probe: { before: number; sum: number; n: number } | null = null;
  private upAt = -1e9;
  /** When each step was left for being too heavy, and how long to wait before trying it again. */
  private leftAt: number[] = [];
  private wait: number[] = [];
  /** The pixel ratio of each step on this screen: tells which steps cut the picture enough for their effect on the frame rate to prove anything. */
  private ratios: readonly number[];

  constructor(start = 0, ratios: readonly number[] = []) {
    this.index = Math.max(0, Math.min(LADDER.length - 1, start));
    this.ratios = ratios;
  }

  /** Whether stepping down to `i` cuts the pixel count by at least BIG_CUT (unknown ratios: assume it does). */
  private big(i: number): boolean {
    const a = this.ratios[i - 1], b = this.ratios[i];
    return !a || !b || 1 - (b * b) / (a * a) >= GOV.BIG_CUT;
  }

  get step(): Step {
    return LADDER[this.index];
  }

  /** One measurement: the average frame rate over a window. Returns the new step when it changed, else null. */
  update(fps: number): Step | null {
    this.t += GOV.WINDOW;
    if (this.t <= GOV.SETTLE) return null;
    if (this.probe) {
      // Right after a step down: did it help? If not, the picture was not what held the frame rate back.
      this.probe.sum += fps;
      if (++this.probe.n < 2) return null;
      const after = this.probe.sum / this.probe.n, before = this.probe.before;
      this.probe = null;
      if (after < before * GOV.MIN_GAIN && after >= 18) {
        this.target = Math.min(this.target, after * 0.9);
        this.index = Math.max(0, this.index - 1);
        this.low = this.high = 0;
        return this.step;
      }
      return null;
    }
    if (fps < this.target) {
      this.high = 0;
      this.low++;
      this.lowSum += fps;
      if (this.low >= GOV.DOWN && this.index < LADDER.length - 1) {
        // Falling back soon after a step up: that step was too much for this device, wait longer before the next try.
        const i = this.index;
        this.wait[i] = this.t - this.upAt < 8 ? Math.min(480, (this.wait[i] ?? GOV.RETRY) * 2) : (this.wait[i] ?? GOV.RETRY);
        this.leftAt[i] = this.t;
        this.index++;
        this.probe = this.big(this.index) ? { before: this.lowSum / this.low, sum: 0, n: 0 } : null;
        this.low = 0;
        this.lowSum = 0;
        return this.step;
      }
    } else {
      this.low = 0;
      this.lowSum = 0;
      if (fps >= this.target + 5) this.high++;
      else this.high = 0;
      if (this.high >= GOV.UP && this.index > 0 && this.t - (this.leftAt[this.index - 1] ?? -1e9) >= (this.wait[this.index - 1] ?? GOV.RETRY)) {
        this.index--;
        this.high = 0;
        this.upAt = this.t;
        return this.step;
      }
    }
    return null;
  }
}
