// Sound effects, synthesized with the Web Audio API (no audio files to ship): an engine whose
// pitch follows the car's speed with gear shifts, tyre squeal while sliding, gravel off the road,
// a crash on every impact, a victory fanfare and a click for the menus — plus a growl and a dull
// thud for the polar bear, a roar and a quake for the yeti, and the explosion of a car.
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

  /** A deep rumble from a big animal: a low voice with a wobble, run through a throaty filter. */
  growl(power = 1) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const now = ctx.currentTime, dur = 1;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(78, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + dur);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 17;
    lfoGain.gain.value = 9;
    lfo.connect(lfoGain).connect(osc.frequency);
    const throat = ctx.createBiquadFilter();
    throat.type = "bandpass";
    throat.frequency.setValueAtTime(260, now);
    throat.frequency.linearRampToValueAtTime(420, now + dur * 0.4);
    throat.frequency.linearRampToValueAtTime(200, now + dur);
    throat.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.28 * power, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(throat);
    // A breathy rasp on top.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const rasp = ctx.createBiquadFilter();
    rasp.type = "bandpass";
    rasp.frequency.value = 340;
    rasp.Q.value = 1.4;
    const rg = ctx.createGain();
    rg.gain.value = 0.35;
    src.connect(rasp).connect(rg).connect(throat);
    throat.connect(g).connect(master);
    osc.start(now);
    lfo.start(now);
    src.start(now, Math.random() * 0.4, dur);
    osc.stop(now + dur + 0.05);
    lfo.stop(now + dur + 0.05);
  }

  /** A dull, heavy knock (a car against something soft and big). */
  thud(power: number) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const p = Math.min(1, Math.max(0.2, power)), now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, now);
    o.frequency.exponentialRampToValueAtTime(34, now + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7 * p, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    o.connect(og).connect(master);
    o.start(now);
    o.stop(now + 0.37);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.28 * p, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(lp).connect(ng).connect(master);
    src.start(now, Math.random() * 0.5, 0.2);
  }

  /** A short two-tone alert: something is about to land. */
  warn(power = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.note(880, t, 0.1, 0.1 * power, "square");
    this.note(660, t + 0.12, 0.14, 0.1 * power, "square");
  }

  /** A crackling hiss: standing in burning lava. */
  sizzle(power = 1) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14 * power, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    src.connect(hp).connect(g).connect(master);
    src.start(now, Math.random() * 0.5, 0.5);
  }

  /** A rising "whoosh": a band of air sweeping up, over a short low swell (a car taking a boost pad). */
  whoosh(power = 1) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const now = ctx.currentTime, p = Math.min(1, Math.max(0.2, power));
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(350, now);
    bp.frequency.exponentialRampToValueAtTime(3200, now + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.32 * p, now + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    src.connect(bp).connect(g).connect(master);
    src.start(now, Math.random() * 0.4, 0.65);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, now);
    o.frequency.exponentialRampToValueAtTime(220, now + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.22 * p, now + 0.08);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    o.connect(og).connect(master);
    o.start(now);
    o.stop(now + 0.5);
  }

  /** A jet engine spooling up: a rising roar of air over a low whine (the Racerz Jet taking off). */
  takeoff() {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const now = ctx.currentTime, dur = 1.2;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(300, now);
    lp.frequency.exponentialRampToValueAtTime(2600, now + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.3, now + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(lp).connect(g).connect(master);
    src.start(now, Math.random() * 0.3, dur + 0.05);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, now);
    o.frequency.exponentialRampToValueAtTime(420, now + dur * 0.85);
    const ol = ctx.createBiquadFilter();
    ol.type = "lowpass";
    ol.frequency.value = 900;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.1, now + 0.4);
    og.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(ol).connect(og).connect(master);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  /** The wheels touching down: two short "clac". */
  land() {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const now = ctx.currentTime;
    for (const at of [0, 0.11]) {
      const t = now + at;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.07);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.35, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(og).connect(master);
      o.start(t);
      o.stop(t + 0.1);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.18, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(bp).connect(ng).connect(master);
      src.start(t, Math.random() * 0.5, 0.05);
    }
  }

  /** The yeti's roar on the massif: a huge, rough voice, much lower and longer than the bear's growl, with a snarling wobble and a gust of air. */
  roar(power = 1) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const p = Math.min(1, Math.max(0.25, power)), now = ctx.currentTime, dur = 1.4;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(48, now + dur);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 23;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);
    const throat = ctx.createBiquadFilter();
    throat.type = "bandpass";
    throat.Q.value = 2.4;
    throat.frequency.setValueAtTime(280, now);
    throat.frequency.linearRampToValueAtTime(760, now + 0.4);
    throat.frequency.linearRampToValueAtTime(240, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.4 * p, now + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(throat);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const rasp = ctx.createBiquadFilter();
    rasp.type = "bandpass";
    rasp.frequency.value = 520;
    rasp.Q.value = 1.1;
    const rg = ctx.createGain();
    rg.gain.value = 0.55;
    src.connect(rasp).connect(rg).connect(throat);
    throat.connect(g).connect(master);
    osc.start(now);
    lfo.start(now);
    src.start(now, Math.random() * 0.4, dur);
    osc.stop(now + dur + 0.05);
    lfo.stop(now + dur + 0.05);
  }

  /** Something huge landing: a deep boom that falls away, a rumble of snow and a few cracks of ice. */
  quake(power = 1) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const p = Math.min(1, Math.max(0.25, power)), now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(82, now);
    o.frequency.exponentialRampToValueAtTime(26, now + 0.7);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.95 * p, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    o.connect(og).connect(master);
    o.start(now);
    o.stop(now + 0.85);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + 0.9);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5 * p, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 1);
    src.connect(lp).connect(ng).connect(master);
    src.start(now, Math.random() * 0.4, 1);
    for (const at of [0.05, 0.14, 0.27]) {
      const t = now + at, c = ctx.createBufferSource();
      c.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400 + at * 3000;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.16 * p, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      c.connect(bp).connect(cg).connect(master);
      c.start(t, Math.random() * 0.5, 0.06);
    }
  }

  /** A car blowing up: a flash of noise that falls from a crack to a rumble, a heavy thump, and debris crackling after it. */
  explode(power = 1) {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise) return;
    const p = Math.min(1, Math.max(0.3, power)), now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(5200, now);
    lp.frequency.exponentialRampToValueAtTime(160, now + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.7 * p, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    src.connect(lp).connect(g).connect(master);
    src.start(now, Math.random() * 0.2, 1.2);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, now);
    o.frequency.exponentialRampToValueAtTime(30, now + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.85 * p, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    o.connect(og).connect(master);
    o.start(now);
    o.stop(now + 0.65);
    for (let i = 0; i < 7; i++) {
      const t = now + 0.2 + i * 0.09 + Math.random() * 0.05, c = ctx.createBufferSource();
      c.buffer = noise;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800 + Math.random() * 2500;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.1 * p * (1 - i / 9), t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      c.connect(hp).connect(cg).connect(master);
      c.start(t, Math.random() * 0.5, 0.06);
    }
  }

  /** Plays a sound requested by the simulation (see Cue in scenery.ts). */
  cue(kind: "growl" | "thud" | "warn" | "sizzle" | "boost" | "takeoff" | "land" | "roar" | "quake" | "explode", power: number) {
    if (kind === "growl") this.growl(power);
    else if (kind === "thud") this.thud(power);
    else if (kind === "warn") this.warn(power);
    else if (kind === "boost") this.whoosh(power);
    else if (kind === "takeoff") this.takeoff();
    else if (kind === "land") this.land();
    else if (kind === "roar") this.roar(power);
    else if (kind === "quake") this.quake(power);
    else if (kind === "explode") this.explode(power);
    else this.sizzle(power);
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.note(880, t, 0.06, 0.07, "square");
    this.note(1320, t + 0.03, 0.05, 0.04, "square");
  }
}

export const sound = new Sound();
