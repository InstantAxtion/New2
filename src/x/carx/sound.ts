import type { HornKind } from './logic';

// The car add-ons' own little sounds: the horn and the indicator tick. Their own audio context,
// started on the first touch and put to sleep when the app goes into the background.

export class CarSounds {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private horn: { gain: GainNode; stop: () => void } | null = null;
  private hornTimer = 0;
  /** 0..1, follows the game's engine volume. */
  volume = 0.5;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.hornOff();
        void this.ctx.suspend();
      } else void this.ctx.resume();
    });
  }

  private ready(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch {
        return null;
      }
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
    return this.ctx;
  }

  get sounding() {
    return !!this.horn;
  }

  /** Start the horn (it sounds until `hornOff`, or a few seconds at most). */
  hornOn(kind: HornKind) {
    if (this.horn) return;
    const ctx = this.ready();
    if (!ctx || !this.out) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    const level = 0.22 * Math.max(0.3, this.volume);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const oscs: OscillatorNode[] = [];
    const tone = (f: number, type: OscillatorType, g = 1, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(lp);
      o.start(t);
      oscs.push(o);
    };
    let attack = 0.02;
    switch (kind) {
      case 'classic':
        // Two notes a third apart, the sound of most cars
        tone(415, 'sawtooth');
        tone(522, 'sawtooth', 0.9);
        lp.frequency.value = 2200;
        break;
      case 'sporty':
        tone(494, 'sawtooth');
        tone(622, 'sawtooth', 0.9);
        tone(988, 'square', 0.12);
        lp.frequency.value = 3400;
        break;
      case 'truck':
        // A deep air horn that swells
        tone(155, 'sawtooth', 1.1);
        tone(196, 'sawtooth', 1, 6);
        tone(310, 'sawtooth', 0.4, -5);
        lp.frequency.value = 1100;
        attack = 0.12;
        break;
      case 'bike':
        tone(740, 'square', 0.7);
        tone(748, 'square', 0.4);
        lp.frequency.value = 2600;
        break;
      case 'ev':
        // A soft, friendly two-note chime
        tone(880, 'sine', 1.3);
        tone(1320, 'triangle', 0.5);
        lp.frequency.value = 3000;
        break;
    }
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + attack);
    lp.connect(gain).connect(this.out);
    const stop = () => {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.07);
      for (const o of oscs) o.stop(now + 0.1);
      window.setTimeout(() => gain.disconnect(), 250);
    };
    this.horn = { gain, stop };
    window.clearTimeout(this.hornTimer);
    this.hornTimer = window.setTimeout(() => this.hornOff(), 4000);
  }

  hornOff() {
    window.clearTimeout(this.hornTimer);
    this.horn?.stop();
    this.horn = null;
  }

  /** The indicator relay: tick on, tock off. */
  tick(on: boolean) {
    const ctx = this.ctx && this.ctx.state === 'running' ? this.ctx : null;
    if (!ctx || !this.out) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = on ? 1900 : 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05 * Math.max(0.3, this.volume), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.04);
  }

  /** Wake the audio on a touch (browsers only allow sound after one). */
  unlock() {
    this.ready();
  }
}
