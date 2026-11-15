import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// Audio that keeps playing with the screen off or the app in the background. On the phone the
// radio and podcasts play in a native media service (with a notification and lock-screen
// controls); in a browser it's a plain <audio>. Both look like the bits of HTMLAudioElement we use.

interface BackgroundAudioApi {
  play(o: { url: string; title: string; subtitle: string; live: boolean; position: number }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  seek(o: { position: number }): Promise<void>;
  setRate(o: { rate: number }): Promise<void>;
  setVolume(o: { volume: number }): Promise<void>;
  addListener(ev: 'state', f: (s: NativeState) => void): Promise<PluginListenerHandle>;
}
interface NativeState { active: boolean; playing: boolean; position: number; duration: number; error: string; ended?: boolean }

const Native = registerPlugin<BackgroundAudioApi>('BackgroundAudio');

export interface Track {
  volume: number;
  playbackRate: number;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  /** Stop for good. */
  stop(): void;
  onplaying: (() => void) | null;
  onpause: (() => void) | null;
  onerror: (() => void) | null;
  ontimeupdate: (() => void) | null;
  onended: (() => void) | null;
}

export interface TrackInfo {
  title: string;
  subtitle: string;
  /** A live stream (radio): no seeking or speed. */
  live: boolean;
}

/** Plays through the phone's media service when we're in the app, otherwise an <audio>. */
export function openTrack(url: string, info: TrackInfo): Track {
  return Capacitor.isNativePlatform() ? new NativeTrack(url, info) : webTrack(url);
}

function webTrack(url: string): Track {
  const a = new Audio(url) as HTMLAudioElement & Track;
  a.preload = 'none';
  a.stop = () => {
    a.pause();
    a.src = '';
  };
  return a;
}

let current = 0;
let sub: Promise<PluginListenerHandle> | null = null;
const listeners = new Set<(s: NativeState) => void>();

class NativeTrack implements Track {
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onended: (() => void) | null = null;
  private id = ++current;
  private started = false;
  private state: NativeState = { active: false, playing: false, position: 0, duration: 0, error: '', ended: false };
  private vol = 1;
  private rate = 1;
  private start = 0;
  private tick = 0;
  private listener = (s: NativeState) => this.update(s);

  constructor(private url: string, private info: TrackInfo) {
    sub ??= Native.addListener('state', (s) => listeners.forEach((f) => f(s)));
    listeners.add(this.listener);
  }

  private update(s: NativeState) {
    if (this.id !== current) return;
    const was = this.state;
    this.state = s;
    if (s.ended && !was.ended) this.onended?.();
    if (s.error && !was.error) this.onerror?.();
    else if (s.playing && !was.playing) this.onplaying?.();
    else if (!s.playing && was.playing) this.onpause?.();
    this.ontimeupdate?.();
  }

  async play() {
    if (this.id !== current) return;
    if (!this.started) {
      this.started = true;
      await Native.play({ url: this.url, title: this.info.title, subtitle: this.info.subtitle, live: this.info.live, position: this.start });
      void Native.setVolume({ volume: this.vol });
      if (this.rate !== 1) void Native.setRate({ rate: this.rate });
      // Keep the time display moving (the service only reports changes)
      this.tick = window.setInterval(() => {
        if (this.id !== current) return window.clearInterval(this.tick);
        if (this.state.playing) {
          this.state = { ...this.state, position: this.state.position + 1 * this.rate };
          this.ontimeupdate?.();
        }
      }, 1000);
    } else await Native.resume();
  }

  pause() {
    if (this.id === current) void Native.pause();
  }

  stop() {
    listeners.delete(this.listener);
    window.clearInterval(this.tick);
    // A newer track has already taken over the player: leave it be
    if (this.id === current) void Native.stop();
  }

  get paused() {
    return !this.state.playing;
  }
  get duration() {
    return this.state.duration;
  }
  get currentTime() {
    return this.started ? this.state.position : this.start;
  }
  set currentTime(t: number) {
    if (!this.started) this.start = t;
    else {
      this.state = { ...this.state, position: t };
      void Native.seek({ position: t });
    }
  }
  get volume() {
    return this.vol;
  }
  set volume(v: number) {
    this.vol = v;
    if (this.started && this.id === current) void Native.setVolume({ volume: v });
  }
  get playbackRate() {
    return this.rate;
  }
  set playbackRate(r: number) {
    this.rate = r;
    if (this.started && this.id === current) void Native.setRate({ rate: r });
  }
}
