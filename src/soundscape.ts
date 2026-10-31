// Ambient soundscapes, made on the fly with Web Audio (no downloads): rain on the roof,
// ocean waves, a forest, a café, a crackling fire and a summer night.

export type ScapeId = 'rain' | 'ocean' | 'forest' | 'cafe' | 'fire' | 'night';

export const SCAPES: { id: ScapeId; name: string; icon: string }[] = [
  { id: 'rain', name: 'Rain on the roof', icon: '🌧️' },
  { id: 'ocean', name: 'Ocean waves', icon: '🌊' },
  { id: 'forest', name: 'Forest morning', icon: '🌲' },
  { id: 'cafe', name: 'Little café', icon: '☕' },
  { id: 'fire', name: 'Crackling fire', icon: '🔥' },
  { id: 'night', name: 'Summer night', icon: '🌙' },
];

function noise(ctx: AudioContext, seconds: number, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.997 * b0 + w * 0.029591;
        b1 = 0.985 * b1 + w * 0.032534;
        b2 = 0.95 * b2 + w * 0.048056;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.9;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private timers: number[] = [];
  current: ScapeId | null = null;
  private vol = 0.8;
  onChange: () => void = () => {};

  private ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.vol;
      this.out.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    return { ctx: this.ctx, out: this.out! };
  }

  setVolume(v: number) {
    this.vol = v;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  stop() {
    for (const t of this.timers) window.clearInterval(t);
    this.timers = [];
    for (const n of this.nodes) {
      try {
        (n as AudioScheduledSourceNode).stop?.();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
    this.nodes = [];
    this.current = null;
    this.onChange();
  }

  /** A looping noise bed through a filter, at a level. */
  private bed(kind: 'white' | 'pink' | 'brown', type: BiquadFilterType, freq: number, q: number, level: number): GainNode {
    const { ctx, out } = this.ensure();
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, 6, kind);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f).connect(g).connect(out);
    src.start();
    this.nodes.push(src, f, g);
    return g;
  }

  /** A slow swell on a gain (waves, wind). */
  private lfo(target: AudioParam, rate: number, depth: number) {
    const { ctx } = this.ensure();
    const o = ctx.createOscillator();
    o.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    this.nodes.push(o, g);
  }

  /** A short tone or click now (birds, drops, crickets, cups). */
  private blip(freq: number, dur: number, level: number, type: OscillatorType = 'sine', sweep = 0, pan = 0) {
    const { ctx, out } = this.ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private every(ms: number, f: () => void) {
    this.timers.push(window.setInterval(f, ms));
  }

  play(id: ScapeId) {
    this.stop();
    this.current = id;
    const R = Math.random;
    switch (id) {
      case 'rain': {
        this.bed('pink', 'lowpass', 2600, 0.5, 0.55);
        this.bed('white', 'highpass', 5200, 0.7, 0.08);
        // Fat drops on the roof
        this.every(45, () => R() < 0.5 && this.blip(900 + R() * 1800, 0.05, 0.05 + R() * 0.05, 'triangle', 0.4, R() * 2 - 1));
        // Distant thunder now and then
        this.every(9000, () => R() < 0.35 && this.blip(55, 3.5, 0.25, 'sine', 0.6));
        break;
      }
      case 'ocean': {
        const g = this.bed('brown', 'lowpass', 900, 0.4, 0.5);
        this.lfo(g.gain, 0.09, 0.42);
        const hiss = this.bed('pink', 'bandpass', 3000, 0.6, 0.12);
        this.lfo(hiss.gain, 0.09, 0.11);
        // Gulls
        this.every(5000, () => R() < 0.3 && [0, 0.25, 0.5].forEach((d) => setTimeout(() => this.blip(1400 + R() * 300, 0.22, 0.04, 'sine', 0.7, R() - 0.5), d * 1000)));
        break;
      }
      case 'forest': {
        const wind = this.bed('pink', 'lowpass', 700, 0.5, 0.25);
        this.lfo(wind.gain, 0.05, 0.15);
        this.bed('pink', 'bandpass', 4000, 1.2, 0.03);
        // Bird song: little trills and whistles from either side
        this.every(700, () => {
          if (R() > 0.55) return;
          const base = 2200 + R() * 2200, n = 2 + Math.floor(R() * 5), pan = R() * 2 - 1;
          for (let k = 0; k < n; k++) setTimeout(() => this.blip(base * (0.9 + R() * 0.25), 0.07 + R() * 0.06, 0.03, 'sine', 1.2, pan), k * (70 + R() * 50));
        });
        break;
      }
      case 'cafe': {
        // Murmur of voices: band-limited noise with a gentle wobble, plus clinks and the odd espresso hiss
        const m = this.bed('pink', 'bandpass', 520, 0.9, 0.5);
        this.lfo(m.gain, 0.6, 0.12);
        this.bed('brown', 'lowpass', 300, 0.5, 0.25);
        this.every(900, () => R() < 0.35 && this.blip(2400 + R() * 2400, 0.25, 0.03, 'triangle', 1, R() * 2 - 1));
        this.every(14000, () => {
          if (R() < 0.5) return;
          const s = this.bed('white', 'highpass', 3500, 0.8, 0.06);
          setTimeout(() => s.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.3), 2500);
        });
        break;
      }
      case 'fire': {
        const roar = this.bed('brown', 'lowpass', 400, 0.6, 0.55);
        this.lfo(roar.gain, 0.3, 0.15);
        this.every(60, () => R() < 0.3 && this.blip(1500 + R() * 4000, 0.015 + R() * 0.02, 0.04 + R() * 0.08, 'square', 0.5, R() * 1.2 - 0.6));
        this.every(1500, () => R() < 0.3 && this.blip(300 + R() * 300, 0.08, 0.12, 'triangle', 0.3));
        break;
      }
      case 'night': {
        this.bed('pink', 'lowpass', 500, 0.5, 0.14);
        // Crickets: fast chirps in pulses
        const cricket = (pan: number, f: number) =>
          this.every(800 + R() * 600, () => {
            for (let k = 0; k < 3; k++) setTimeout(() => this.blip(f, 0.025, 0.025, 'sine', 1, pan), k * 45);
          });
        cricket(-0.7, 4300);
        cricket(0.6, 4700);
        cricket(0.1, 5100);
        // An owl far off
        this.every(11000, () => R() < 0.4 && [0, 0.45, 0.75].forEach((d) => setTimeout(() => this.blip(400, 0.35, 0.05, 'sine', 0.92, -0.4), d * 1000)));
        break;
      }
    }
    this.onChange();
  }
}
