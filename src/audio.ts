// A soft synthesised engine hum and wind, so the drive has some life under the music.

export class EngineSound {
  private ctx: AudioContext | null = null;
  private gain!: GainNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  volume = 0.5;

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
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'triangle';
    this.osc1.connect(this.filter);
    this.osc2.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(ctx.destination);
    this.osc1.start();
    this.osc2.start();

    // Wind: filtered noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    noise.connect(this.windFilter);
    this.windFilter.connect(this.wind);
    this.wind.connect(ctx.destination);
    noise.start();
  }

  suspend() {
    void this.ctx?.suspend();
  }

  /** speed in m/s, throttle 0..1, vmax in m/s. */
  update(speed: number, throttle: number, vmax: number, running: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.abs(speed);
    // Fake gears: rpm climbs within each gear then drops
    const gears = 5;
    const gearSpan = vmax / gears;
    const gear = Math.min(gears - 1, Math.floor(s / gearSpan));
    const within = (s - gear * gearSpan) / gearSpan;
    const rpm = 0.25 + within * 0.6 + gear * 0.04;
    const f = 38 + rpm * 90;
    this.osc1.frequency.setTargetAtTime(f, t, 0.08);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.filter.frequency.setTargetAtTime(260 + throttle * 500 + rpm * 300, t, 0.1);
    const v = running ? this.volume : 0;
    this.gain.gain.setTargetAtTime(v * (0.05 + throttle * 0.05 + rpm * 0.03), t, 0.15);
    this.wind.gain.setTargetAtTime(v * Math.min(0.12, (s / 40) ** 2 * 0.1), t, 0.3);
    this.windFilter.frequency.setTargetAtTime(400 + s * 15, t, 0.3);
  }
}
