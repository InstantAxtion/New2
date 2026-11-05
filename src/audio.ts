import type { Engine } from './carspecs';

// Synthesised sound: an engine per car type, wind, and the sounds of the place you're in.

interface Profile {
  /** Idle and redline pitch of the firing frequency (Hz). */
  idle: number;
  red: number;
  /** Oscillator shapes for the main tone and an octave below. */
  main: OscillatorType;
  sub: OscillatorType;
  /** Engine "beat": amplitude wobble at a share of the firing frequency (V8 burble). */
  beat: number;
  beatDepth: number;
  /** How open the exhaust sounds (filter cut-off scale). */
  bright: number;
  /** Mechanical noise mixed in (diesel clatter). */
  noise: number;
  gears: number;
  /** Electric: no gears, a rising whine. */
  electric?: boolean;
  loud: number;
  /** Turbocharged: a spooling whistle and a blow-off hiss when you lift. */
  turbo?: boolean;
}

const PROFILES: Record<Engine, Profile> = {
  v8: { idle: 32, red: 115, main: 'sawtooth', sub: 'square', beat: 0.5, beatDepth: 0.55, bright: 0.8, noise: 0.05, gears: 5, loud: 1.2 },
  v12: { idle: 60, red: 260, main: 'sawtooth', sub: 'sawtooth', beat: 0, beatDepth: 0, bright: 1.6, noise: 0.02, gears: 7, loud: 1.1 },
  flat6: { idle: 45, red: 200, main: 'square', sub: 'sawtooth', beat: 0.33, beatDepth: 0.2, bright: 1.3, noise: 0.03, gears: 6, loud: 1, turbo: true },
  i4: { idle: 40, red: 170, main: 'sawtooth', sub: 'triangle', beat: 0, beatDepth: 0, bright: 1.1, noise: 0.04, gears: 5, loud: 0.75, turbo: true },
  i6: { idle: 42, red: 175, main: 'sawtooth', sub: 'sawtooth', beat: 0, beatDepth: 0, bright: 1.15, noise: 0.02, gears: 6, loud: 0.9 },
  v6: { idle: 38, red: 150, main: 'sawtooth', sub: 'square', beat: 0.25, beatDepth: 0.2, bright: 0.95, noise: 0.03, gears: 6, loud: 0.85 },
  diesel: { idle: 26, red: 70, main: 'sawtooth', sub: 'square', beat: 0.5, beatDepth: 0.35, bright: 0.6, noise: 0.25, gears: 6, loud: 0.95, turbo: true },
  flat4: { idle: 24, red: 85, main: 'triangle', sub: 'square', beat: 0.5, beatDepth: 0.7, bright: 0.7, noise: 0.08, gears: 4, loud: 0.8 },
  twin: { idle: 34, red: 190, main: 'square', sub: 'sawtooth', beat: 0.5, beatDepth: 0.6, bright: 1.2, noise: 0.05, gears: 6, loud: 0.9 },
  ev: { idle: 0, red: 0, main: 'sine', sub: 'sine', beat: 0, beatDepth: 0, bright: 1, noise: 0, gears: 1, electric: true, loud: 0.5 },
};

/** How much of each ambient sound a place has (0..1 each). */
export interface AmbientMix {
  waves: number;
  birds: number;
  insects: number;
  wind: number;
  city: number;
  crickets: number;
  rain: number;
}

function noiseBuffer(ctx: AudioContext, seconds = 2, brown = false) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

export class EngineSound {
  private ctx: AudioContext | null = null;
  volume = 0.5;
  /** 1 = full, lower while music plays. */
  duck = 1;
  /** Mixer level for the world around you (ambience, animals, rain, tyres). */
  world = 1;
  /** Inside the cabin with the windows shut: outside sounds are muffled. */
  sealed = false;
  private profile: Profile = PROFILES.i4;
  private out!: GainNode;
  private cabin!: BiquadFilterNode;
  private eng!: { main: OscillatorNode; sub: OscillatorNode; whine: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; beat: OscillatorNode; beatGain: GainNode; noise: GainNode };
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private amb!: Record<keyof AmbientMix, GainNode>;
  private birdTimer = 0;
  private gearShift = 0;
  private lastGear = 0;
  private tyres!: { gain: GainNode; filter: BiquadFilterNode };
  private roof!: GainNode;
  private roofTimer = 0;
  private lastThrottle = 0;
  private popCool = 0;
  /** What the tyres are rolling on. */
  surface: 'road' | 'gravel' | 'grass' = 'road';
  wet = 0;
  /** Rain on the roof (0..1), heard from inside. */
  roofRain = 0;
  /** Listening from the driver's seat: the engine is heard through the bulkhead, deeper and softer. */
  inside = false;
  /** How hard the tyres are working sideways (0..1+): they squeal near the limit. */
  slip = 0;
  private turbo!: { gain: GainNode; filter: BiquadFilterNode; spool: number };
  private squeal!: { gain: GainNode; osc: OscillatorNode; filter: BiquadFilterNode };
  private bulkhead!: BiquadFilterNode;
  private stoneTimer = 0;

  setProfile(engine: Engine) {
    this.profile = PROFILES[engine] ?? PROFILES.i4;
    if (!this.ctx) return;
    this.eng.main.type = this.profile.main;
    this.eng.sub.type = this.profile.sub;
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    // Everything from outside the car goes through the "cabin" filter
    this.cabin = ctx.createBiquadFilter();
    this.cabin.type = 'lowpass';
    this.cabin.frequency.value = 20000;
    this.cabin.connect(this.out);

    // Engine
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const beatGain = ctx.createGain();
    const main = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.25;
    const beat = ctx.createOscillator();
    beat.type = 'sine';
    const beatDepth = ctx.createGain();
    beatDepth.gain.value = 0;
    beat.connect(beatDepth).connect(beatGain.gain);
    main.connect(filter);
    sub.connect(filter);
    whine.connect(whineGain).connect(filter);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer(ctx);
    noiseSrc.loop = true;
    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 1800;
    const noise = ctx.createGain();
    noise.gain.value = 0;
    noiseSrc.connect(noiseBand).connect(noise).connect(filter);
    this.bulkhead = ctx.createBiquadFilter();
    this.bulkhead.type = 'lowpass';
    this.bulkhead.frequency.value = 20000;
    filter.connect(beatGain).connect(gain).connect(this.bulkhead).connect(this.out);
    for (const o of [main, sub, whine, beat]) o.start();
    noiseSrc.start();
    this.eng = { main, sub, whine, filter, gain, beat, beatGain, noise };
    (this.eng as unknown as { beatDepth: GainNode }).beatDepth = beatDepth;
    this.setProfile(Object.keys(PROFILES).find((k) => PROFILES[k as Engine] === this.profile) as Engine);

    // Wind past the car
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = noiseBuffer(ctx);
    wsrc.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    wsrc.connect(wf).connect(wg).connect(this.cabin);
    wsrc.start();
    this.wind = { gain: wg, filter: wf };

    // Ambient beds
    const bed = (type: BiquadFilterType, freq: number, q: number, brown = false, lfo = 0, lfoDepth = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 3, brown);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      const shape = ctx.createGain();
      shape.gain.value = 1;
      if (lfo) {
        const o = ctx.createOscillator();
        o.frequency.value = lfo;
        const d = ctx.createGain();
        d.gain.value = lfoDepth;
        o.connect(d).connect(shape.gain);
        o.start();
      }
      src.connect(f).connect(shape).connect(g).connect(this.cabin);
      src.start();
      this.bedSrc.set(g, src);
      return g;
    };
    this.amb = {
      waves: bed('lowpass', 500, 0.7, true, 0.09, 0.8),
      birds: ctx.createGain(),
      insects: bed('bandpass', 5200, 8, false, 7, 0.6),
      wind: bed('bandpass', 380, 0.8, true, 0.13, 0.6),
      city: bed('lowpass', 220, 0.6, true, 0.05, 0.2),
      crickets: ctx.createGain(),
      rain: bed('highpass', 1200, 0.5),
    };
    // Tyres on the road surface
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 3, false);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 300;
      f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.cabin);
      src.start();
      this.tyres = { gain: g, filter: f };
    }
    // Turbo: a whistle of air that spools up with boost
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 3, false);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 3000;
      f.Q.value = 9;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.bulkhead);
      src.start();
      this.turbo = { gain: g, filter: f, spool: 0 };
    }
    // Tyre squeal: a wavering tone plus scrubbing noise
    {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 900;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1000;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(f).connect(g).connect(this.cabin);
      osc.start();
      this.squeal = { gain: g, osc, filter: f };
    }
    // Rain drumming on the roof: heard inside, so it skips the cabin filter
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 3, false);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2400;
      f.Q.value = 0.5;
      this.roof = ctx.createGain();
      this.roof.gain.value = 0;
      src.connect(f).connect(this.roof).connect(this.out);
      src.start();
    }
    this.amb.birds.gain.value = 0;
    this.amb.crickets.gain.value = 0;
    this.amb.birds.connect(this.cabin);
    this.amb.crickets.connect(this.cabin);
    void this.loadRecordings(ctx);
  }

  private bedSrc = new Map<GainNode, AudioBufferSourceNode>();
  /** Recorded ambience in use (CC0 recordings from OpenGameArt): these replace the synthesised versions. */
  private recorded = new Set<keyof AmbientMix>();
  private waveBufs: AudioBuffer[] = [];
  private waveTimer = 2;

  private async loadRecordings(ctx: AudioContext) {
    const get = async (name: string) => {
      const r = await fetch(`./sounds/${name}.ogg`);
      if (!r.ok) throw new Error('Missing sound ' + name);
      return ctx.decodeAudioData(await r.arrayBuffer());
    };
    // Each loop at a level that matches the old synthesised sound, starting somewhere random
    const loops: [keyof AmbientMix, string, number][] = [['rain', 'rain', 3.5], ['wind', 'wind', 1.1], ['birds', 'birds', 2.5], ['crickets', 'crickets', 0.7]];
    const waves = Promise.all(['wave01', 'wave02'].map((n) => get(n).catch(() => null)));
    await Promise.all(loops.map(async ([k, name, level]) => {
      try {
        const buf = await get(name);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = level;
        src.connect(g).connect(this.amb[k]);
        src.start(0, Math.random() * buf.duration);
        // Retire the synthesised bed it replaces
        const old = this.bedSrc.get(this.amb[k]);
        if (old) {
          old.stop();
          old.disconnect();
        }
        this.recorded.add(k);
      } catch (e) {
        console.warn(e);
      }
    }));
    this.waveBufs = (await waves).filter((b): b is AudioBuffer => !!b);
  }

  /** One wave breaking on the shore (a recording), over the synthesised wash of the sea. */
  private wave() {
    const ctx = this.ctx!;
    const buf = this.waveBufs[Math.floor(Math.random() * this.waveBufs.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.85 + Math.random() * 0.25;
    const g = ctx.createGain();
    g.gain.value = 1.4 + Math.random() * 0.8;
    src.connect(g).connect(this.amb.waves);
    src.start();
    src.onended = () => g.disconnect();
  }

  suspend() {
    void this.ctx?.suspend();
  }

  /** A rumble of thunder. */
  thunder(strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 4, true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.6 * strength * Math.max(this.volume, 0.35), t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 4);
    src.connect(lp).connect(g).connect(this.cabin);
    src.start();
  }

  /** A short shaped burst of filtered noise (thunks, pops, clicks, whooshes). */
  /** The turbo's blow-off valve: a sharp "pssh". */
  private blowOff(t: number, v: number) {
    this.turbo.spool = 0;
    this.burst(t, 0.35, 'highpass', 2600, 4200, 0.09 * v * (this.sealed ? 0.6 : 1), this.out, 0.7);
  }

  private burst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, dest: AudioNode = this.out, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, Math.max(0.2, dur + 0.1));
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private thump(t: number, freq: number, dur: number, peak: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A car door opening or shutting. */
  door(open: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.max(this.volume, 0.3);
    if (open) {
      this.burst(t, 0.05, 'highpass', 3000, 2500, 0.15 * v);
      this.burst(t + 0.05, 0.25, 'lowpass', 900, 300, 0.05 * v);
    } else {
      this.thump(t, 85, 0.22, 0.5 * v);
      this.burst(t, 0.12, 'lowpass', 700, 200, 0.25 * v);
      this.burst(t + 0.01, 0.04, 'highpass', 2500, 2000, 0.06 * v);
    }
  }

  /** Turning the key: the starter cranks and the engine catches (or an EV chimes). */
  startUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.max(this.volume, 0.3);
    if (this.profile.electric) {
      const ctx = this.ctx;
      for (const [f, dt] of [[880, 0], [1320, 0.14]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + dt);
        g.gain.linearRampToValueAtTime(0.06 * v, t + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0005, t + dt + 0.5);
        o.connect(g).connect(this.out);
        o.start(t + dt);
        o.stop(t + dt + 0.6);
      }
      return;
    }
    for (let i = 0; i < 6; i++) this.burst(t + i * 0.11, 0.09, 'lowpass', 380, 160, 0.22 * v);
    this.thump(t + 0.68, 60, 0.4, 0.35 * v);
    this.burst(t + 0.68, 0.5, 'lowpass', 600, 120, 0.25 * v);
    this.revBlip = 0.9;
  }
  private revBlip = 0;

  /** A whoosh as another vehicle goes past. */
  whoosh(level: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.max(this.volume, 0.25) * this.duck * Math.min(1, level);
    this.burst(t, 0.7, 'bandpass', 500, 1500, 0.22 * v, this.cabin, 1.2);
    this.burst(t + 0.25, 0.6, 'bandpass', 1400, 350, 0.16 * v, this.cabin, 1.2);
  }

  /** A call from an animal out in the world: an owl's hoot, a gull, an eagle's cry. */
  call(kind: 'owl' | 'gull' | 'eagle', level = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = Math.max(this.volume, 0.3) * this.duck * level * this.world;
    out.connect(this.cabin);
    const note = (type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, vib = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      if (vib) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 22;
        const d = ctx.createGain();
        d.gain.value = vib;
        lfo.connect(d).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + dur * 0.15);
      g.gain.setValueAtTime(peak, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (f0 + f1) / 2;
      bp.Q.value = type === 'sine' ? 0.5 : 2.5;
      o.connect(bp).connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    if (kind === 'owl') {
      note('sine', 400, 370, t0, 0.32, 0.09);
      note('sine', 390, 360, t0 + 0.55, 0.22, 0.06);
      note('sine', 400, 355, t0 + 0.85, 0.6, 0.08, 4);
    } else if (kind === 'gull') {
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) note('sawtooth', 1500, 1050, t0 + i * 0.24, 0.18, 0.03);
    } else {
      note('sawtooth', 2600, 1700, t0, 0.9, 0.025, 60);
    }
  }

  /** A short chirp from a bird (or a cricket). */
  private chirp(dest: GainNode, base: number, sweep: number, dur: number, n: number) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const t = t0 + i * dur * 1.3;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * sweep, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + dur * 0.2);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** speed in m/s, throttle 0..1, vmax in m/s. */
  update(speed: number, throttle: number, vmax: number, running: boolean, dt = 1 / 60, mix: AmbientMix | null = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = this.profile;
    const s = Math.abs(speed);
    const v = (running ? this.volume : 0) * this.duck;
    const e = this.eng;
    if (p.electric) {
      const f = 180 + (s / vmax) * 1500;
      e.whine.frequency.setTargetAtTime(f, t, 0.1);
      e.main.frequency.setTargetAtTime(f * 0.5, t, 0.1);
      e.sub.frequency.setTargetAtTime(f * 0.25, t, 0.1);
      e.filter.frequency.setTargetAtTime(2400, t, 0.1);
      e.gain.gain.setTargetAtTime(v * (0.012 + throttle * 0.02 + (s / vmax) * 0.02) * p.loud, t, 0.15);
      e.noise.gain.setTargetAtTime(0, t, 0.1);
    } else {
      // Gears: revs climb within each gear, drop on a shift
      const gearSpan = vmax / p.gears;
      const gear = Math.min(p.gears - 1, Math.floor(s / gearSpan));
      if (gear !== this.lastGear) {
        const up = gear > this.lastGear;
        this.gearShift = up ? 0.22 : 0.15;
        // Up: the revs fall as the clutch comes up; down: a quick blip of throttle
        if (!up && running && throttle < 0.3) this.revBlip = Math.max(this.revBlip, 0.35);
        if (up && p.turbo && this.turbo.spool > 0.5 && running) this.blowOff(t, v);
        this.lastGear = gear;
      }
      this.gearShift = Math.max(0, this.gearShift - dt);
      const within = (s - gear * gearSpan) / gearSpan;
      const rpm = Math.min(1, 0.18 + within * 0.7 + gear * 0.03);
      const f = p.idle + (p.red - p.idle) * rpm;
      // During a shift the revs swing quickly to the new gear
      const tc = this.gearShift > 0 ? 0.035 : 0.06;
      e.main.frequency.setTargetAtTime(f, t, tc);
      e.sub.frequency.setTargetAtTime(f * 0.5 * (1 + (p.beat ? 0.004 : 0)), t, tc);
      e.whine.frequency.setTargetAtTime(f * 6, t, 0.06);
      e.beat.frequency.setTargetAtTime(f * p.beat || 0.01, t, 0.06);
      (e as unknown as { beatDepth: GainNode }).beatDepth.gain.setTargetAtTime(p.beatDepth, t, 0.1);
      e.filter.frequency.setTargetAtTime((220 + throttle * 600 + rpm * 500) * p.bright, t, 0.08);
      const load = this.gearShift > 0 ? 0.3 : 1;
      e.gain.gain.setTargetAtTime(v * (0.045 + throttle * 0.06 * load + rpm * 0.03) * p.loud, t, 0.1);
      e.noise.gain.setTargetAtTime(p.noise * (0.6 + throttle), t, 0.1);
    }
    // Exhaust pops and crackles when lifting off at high revs (sporty engines)
    if (!p.electric) {
      this.popCool -= dt;
      if (running && this.lastThrottle > 0.55 && throttle < 0.1 && s > 12 && this.popCool <= 0 && p.bright >= 0.8 && p.loud >= 0.9) {
        this.popCool = 1.2;
        const n = 1 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.burst(t + 0.05 + i * (0.06 + Math.random() * 0.1), 0.06, 'bandpass', 420 + Math.random() * 300, 200, 0.35 * v * (this.sealed ? 0.6 : 1), this.out, 1.5);
      }
    }
    // Turbo spools with load and revs; lifting off at boost lets it go with a hiss
    if (p.turbo && !p.electric) {
      const want = running ? Math.min(1, throttle * Math.min(1, s / 12)) : 0;
      const before = this.turbo.spool;
      this.turbo.spool += (want - before) * (1 - Math.exp(-dt * (want > before ? 1.6 : 5)));
      if (running && before > 0.55 && throttle < 0.1 && this.lastThrottle > 0.5) this.blowOff(t, v);
      this.turbo.filter.frequency.setTargetAtTime(1800 + this.turbo.spool * 4200, t, 0.08);
      this.turbo.gain.gain.setTargetAtTime(v * this.turbo.spool * this.turbo.spool * 0.05, t, 0.08);
    } else this.turbo.gain.gain.setTargetAtTime(0, t, 0.1);
    // Tyres squeal near the limit of grip (and scrub on loose ground instead)
    {
      const crunchy = this.surface !== 'road';
      const sq = running && !crunchy && s > 6 ? Math.max(0, Math.min(1, (this.slip - 0.72) / 0.25)) : 0;
      this.squeal.osc.frequency.setTargetAtTime(820 + Math.sin(t * 23) * 60 + Math.sin(t * 7.3) * 40 + this.slip * 120, t, 0.03);
      this.squeal.gain.gain.setTargetAtTime(sq * 0.05 * Math.max(this.volume, 0.25) * this.world * (1 - this.wet * 0.7), t, 0.06);
      // Stones flicking up off a gravel road
      this.stoneTimer -= dt;
      if (running && this.surface === 'gravel' && s > 4 && this.stoneTimer <= 0) {
        this.stoneTimer = 0.04 + Math.random() * 0.4 / Math.min(1, s / 15);
        this.burst(t, 0.02, 'bandpass', 2400 + Math.random() * 3000, 2000, 0.05 * Math.max(this.volume, 0.25) * this.world * (this.sealed ? 0.7 : 1), this.cabin, 4);
      }
    }
    // From the driver's seat the engine comes through the bulkhead: deeper, softer
    this.bulkhead.frequency.setTargetAtTime(this.inside ? (this.sealed ? 1100 : 2600) : 20000, t, 0.2);
    this.lastThrottle = throttle;
    if (this.revBlip > 0) {
      this.revBlip = Math.max(0, this.revBlip - dt);
      e.gain.gain.setTargetAtTime(v * 0.12 * p.loud * (this.revBlip / 0.9), t, 0.08);
    }
    // Tyres: a low hum on asphalt, a hiss in the wet, crunching on gravel
    const crunch = this.surface === 'gravel' ? 1 : this.surface === 'grass' ? 0.6 : 0;
    const roll = Math.min(1, s / 30);
    this.tyres.filter.frequency.setTargetAtTime(crunch ? 900 + s * 20 : 180 + s * 6 + this.wet * 1600, t, 0.2);
    this.tyres.filter.Q.value = crunch ? 0.6 : this.wet > 0.3 ? 0.4 : 1.2;
    this.tyres.gain.gain.setTargetAtTime((running ? 1 : 0) * Math.max(this.volume, 0.25) * roll * (0.05 + crunch * 0.12 + this.wet * 0.08) * (this.sealed ? 0.6 : 1), t, 0.2);
    // Rain on the roof: louder inside, with the odd heavier drop
    this.roof.gain.setTargetAtTime(this.roofRain * (this.sealed ? 0.12 : 0.04) * Math.max(this.volume, 0.3) * this.world, t, 0.4);
    this.roofTimer -= dt;
    if (this.roofRain > 0.1 && this.roofTimer <= 0) {
      this.roofTimer = 0.03 + Math.random() * 0.2 / this.roofRain;
      this.burst(t, 0.03, 'bandpass', 1800 + Math.random() * 2500, 1500, 0.04 * this.roofRain * Math.max(this.volume, 0.3) * (this.sealed ? 1 : 0.4), this.out, 3);
    }
    // Wind grows with speed, and much louder with the windows open
    const open = this.sealed ? 0.35 : 1;
    this.wind.gain.gain.setTargetAtTime(v * Math.min(0.16, (s / 40) ** 2 * 0.12) * open, t, 0.3);
    this.wind.filter.frequency.setTargetAtTime(400 + s * 15, t, 0.3);
    this.cabin.frequency.setTargetAtTime(this.sealed ? 900 : 18000, t, 0.2);

    // The world around you
    if (mix) {
      const a = Math.max(this.volume, 0.25) * this.duck * this.world;
      const set = (k: keyof AmbientMix, level: number) => this.amb[k].gain.setTargetAtTime(mix[k] * level * a, t, 0.8);
      set('waves', 0.35);
      set('insects', 0.04);
      set('wind', 0.25);
      set('city', 0.3);
      set('rain', 0.22);
      this.amb.birds.gain.setTargetAtTime(mix.birds * 0.5 * a, t, 0.8);
      this.amb.crickets.gain.setTargetAtTime(mix.crickets * 0.35 * a, t, 0.8);
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 0.6 + Math.random() * 2.5;
        if (mix.birds > 0.05 && Math.random() < mix.birds && !this.recorded.has('birds')) {
          const base = 2200 + Math.random() * 2400;
          this.chirp(this.amb.birds, base, 0.7 + Math.random() * 0.8, 0.06 + Math.random() * 0.08, 1 + Math.floor(Math.random() * 4));
        }
        if (mix.crickets > 0.05 && !this.recorded.has('crickets')) this.chirp(this.amb.crickets, 4300, 1.02, 0.03, 3);
      }
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waveTimer = 3 + Math.random() * 5;
        if (mix.waves > 0.1 && this.waveBufs.length) this.wave();
      }
    }
  }
}
