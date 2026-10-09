// Sound effects, synthesized with the Web Audio API (no audio files to ship): an engine whose
// pitch follows the car's speed with gear shifts, tyre squeal while sliding, gravel off the road,
// a crash on every impact, a victory fanfare and a click for the menus.
//
// Browsers only let audio start after a user gesture: nothing is created until `unlock()` is
// called from a key press or click (Game.tsx does it on the first one). Muting just closes the
// master gain, so un-muting needs no gesture.

const MASTER_GAIN = 0.8;

export type DriveState = {
  /** 0 = standing, 1 = the car's top speed. */
  speedRatio: number;
  throttle: boolean;
  /** Sideways slip speed (same units as car.ts slipOf). */
  slip: number;
  onRoad: boolean;
};

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private engine: { oscs: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private tyres: { src: AudioBufferSourceNode; squeal: GainNode; gravel: GainNode } | null = null;

  /** Creates the audio graph (first call) or resumes it. Must run inside a user gesture. */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      // One second of white noise, looped for tyres and reused for crashes.
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      document.addEventListener("visibilitychange", () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else void this.ctx.resume();
      });
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.03);
  }

  // ---------- engine and tyres (continuous) ----------

  startEngine() {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise || this.engine) return;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const oscs = (["sawtooth", "sawtooth", "sine"] as const).map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = i === 1 ? 9 : 0;
      o.frequency.value = 50;
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain);
    gain.connect(master);
    this.engine = { oscs, gain, filter };

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const squeal = ctx.createGain(), gravel = ctx.createGain();
    squeal.gain.value = gravel.gain.value = 0;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1700;
    band.Q.value = 1.1;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 550;
    src.connect(band).connect(squeal).connect(master);
    src.connect(low).connect(gravel).connect(master);
    src.start();
    this.tyres = { src, squeal, gravel };
  }

  stopEngine() {
    const ctx = this.ctx;
    if (!ctx) return;
    const e = this.engine, t = this.tyres;
    this.engine = this.tyres = null;
    const end = ctx.currentTime + 0.25;
    if (e) {
      e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      for (const o of e.oscs) o.stop(end);
    }
    if (t) {
      t.squeal.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      t.gravel.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      t.src.stop(end);
    }
  }

  /** Per-frame update of the engine note and the tyre noise. */
  drive(s: DriveState) {
    const ctx = this.ctx, e = this.engine, t = this.tyres;
    if (!ctx || !e || !t) return;
    const now = ctx.currentTime;
    const r = Math.min(1.1, Math.max(0, s.speedRatio));
    // Five "gears": the revs climb inside a gear, then drop at each shift.
    const gear = Math.min(4, Math.floor(r * 5));
    const revs = 0.2 + 0.8 * Math.min(1, r * 5 - gear);
    const freq = 46 + revs * 120 + gear * 9;
    e.oscs[0].frequency.setTargetAtTime(freq, now, 0.04);
    e.oscs[1].frequency.setTargetAtTime(freq * 1.004, now, 0.04);
    e.oscs[2].frequency.setTargetAtTime(freq * 0.5, now, 0.04);
    e.filter.frequency.setTargetAtTime(380 + revs * 900 + (s.throttle ? 700 : 0), now, 0.06);
    e.gain.gain.setTargetAtTime(0.05 + 0.04 * revs + (s.throttle ? 0.06 : 0), now, 0.06);

    const squeal = s.onRoad ? Math.min(1, Math.max(0, (s.slip - 140) / 280)) * 0.16 : 0;
    t.squeal.gain.setTargetAtTime(squeal, now, 0.05);
    const gravel = s.onRoad ? 0 : Math.min(1, r * 1.5) * 0.14;
    t.gravel.gain.setTargetAtTime(gravel, now, 0.08);
  }

  // ---------- one-shots ----------

  /** An impact; `power` 0..1 scales loudness. */
  crash(power: number) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const p = Math.min(1, Math.max(0.15, power)), now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2600, now);
    lp.frequency.exponentialRampToValueAtTime(260, now + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * p, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    src.connect(lp).connect(g).connect(master);
    src.start(now, Math.random() * 0.5, 0.45);
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(130, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.25);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.55 * p, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    thump.connect(tg).connect(master);
    thump.start(now);
    thump.stop(now + 0.32);
  }

  private note(freq: number, at: number, dur: number, gain: number, type: OscillatorType) {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** Winner's fanfare: a rising arpeggio, then a held major chord. */
  victory() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.note(f, t + i * 0.13, 0.22, 0.16, "square");
      this.note(f / 2, t + i * 0.13, 0.22, 0.12, "triangle");
    });
    for (const f of [523.25, 659.25, 783.99, 1046.5]) {
      this.note(f, t + 0.56, 1.1, 0.1, "triangle");
      this.note(f, t + 0.56, 1.1, 0.04, "square");
    }
  }

  /** Short jingle for finishing outside first place. */
  finish() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    this.note(392, t, 0.2, 0.12, "triangle");
    this.note(329.63, t + 0.18, 0.4, 0.12, "triangle");
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.note(880, t, 0.06, 0.07, "square");
    this.note(1320, t + 0.03, 0.05, 0.04, "square");
  }
}

export const sound = new Sound();
