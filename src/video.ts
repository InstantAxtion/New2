// The YouTube player. It's a normal web iframe laid over the 3D view and bent with a
// CSS perspective transform so it sits exactly on the car's dashboard screen.

/* Minimal typings for the YouTube IFrame API */
interface YTPlayer {
  loadVideoById(id: string): void;
  loadPlaylist(o: { list: string; listType: 'playlist'; index?: number }): void;
  nextVideo(): void;
  previousVideo(): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  getPlayerState(): number;
  getVideoData(): { title: string; author: string; video_id: string };
  getPlaylist(): string[] | null;
  setVolume(v: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(s: number, allowSeekAhead: boolean): void;
  setPlaybackQuality?(q: string): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, o: object) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiReady = null;
      reject(new Error("Couldn't reach YouTube"));
    };
    document.head.appendChild(s);
  });
  return apiReady;
}

// A full HD-sized player (YouTube picks the stream quality from the player's size), scaled down to fit
export const VW = 1280;
export const VH = 720;

export type Corners = [number, number][]; // TL, TR, BR, BL in screen pixels

/** CSS matrix3d that maps a VW×VH box onto four screen points (a projective transform). */
export function quadMatrix(p: Corners, w = VW, h = VH): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, hh: number;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0;
    d = y1 - y0; e = y2 - y1; f = y0;
    g = 0; hh = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(8)).join(',')})`;
}

export type Placement = { kind: 'quad'; corners: Corners } | { kind: 'pip' | 'theatre'; x: number; y: number; width: number } | { kind: 'hidden' };

export class VideoScreen {
  readonly el: HTMLDivElement;
  private host: HTMLDivElement;
  private player: YTPlayer | null = null;
  private ready = false;
  private pending: (() => void) | null = null;
  onEnded: () => void = () => {};
  onError: (code: number) => void = () => {};
  onPlaying: () => void = () => {};
  /** Something is loaded (and should be shown). */
  active = false;
  paused = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'video';
    this.host = document.createElement('div');
    this.el.appendChild(this.host);
    document.body.insertBefore(this.el, document.getElementById('ui'));
    this.place({ kind: 'hidden' });
  }

  private async ensure(run: () => void) {
    if (this.player && this.ready) return run();
    this.pending = run;
    if (this.player) return;
    await loadApi();
    if (this.player) return;
    const PS = () => window.YT!.PlayerState;
    this.player = new window.YT!.Player(this.host, {
      width: VW,
      height: VH,
      playerVars: {
        autoplay: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
        origin: location.origin,
      },
      events: {
        onReady: () => {
          this.ready = true;
          const p = this.pending;
          this.pending = null;
          p?.();
        },
        onStateChange: (e: { data: number }) => {
          if (e.data === PS().ENDED) this.onEnded();
          if (e.data === PS().PLAYING) {
            this.paused = false;
            try {
              this.player?.setPlaybackQuality?.('hd1080');
            } catch {
              /* the player chooses */
            }
            this.onPlaying();
          }
          if (e.data === PS().PAUSED) this.paused = true;
        },
        onError: (e: { data: number }) => this.onError(e.data),
      },
    });
  }

  /** Seconds into the video (for lyrics), or -1 when nothing is playing. */
  time(): number {
    try {
      return this.player && this.ready && this.active ? this.player.getCurrentTime() : -1;
    } catch {
      return -1;
    }
  }

  duration(): number {
    try {
      return this.player && this.ready ? this.player.getDuration() : 0;
    } catch {
      return 0;
    }
  }

  play(id: string) {
    this.active = true;
    this.paused = false;
    return this.ensure(() => this.player!.loadVideoById(id));
  }

  playList(list: string, index = 0) {
    this.active = true;
    this.paused = false;
    return this.ensure(() => this.player!.loadPlaylist({ list, listType: 'playlist', index }));
  }

  next() {
    this.player?.nextVideo();
  }
  previous() {
    this.player?.previousVideo();
  }

  toggle() {
    if (!this.player) return;
    if (this.paused) this.player.playVideo();
    else this.player.pauseVideo();
    this.paused = !this.paused;
  }

  stop() {
    this.active = false;
    this.player?.stopVideo();
    this.place({ kind: 'hidden' });
  }

  /** Jump to a point in the video (seconds). */
  seek(t: number) {
    try {
      this.player?.seekTo(t, true);
    } catch {
      /* not ready */
    }
  }

  setVolume(v: number) {
    try {
      this.player?.setVolume(Math.round(v));
    } catch {
      /* not ready */
    }
  }

  info(): { title: string; author: string } | null {
    try {
      const d = this.player?.getVideoData();
      return d && d.title ? d : null;
    } catch {
      return null;
    }
  }

  /** Put the player on the dashboard, in a corner, or out of sight (it keeps playing). */
  place(p: Placement) {
    const s = this.el.style;
    this.el.classList.toggle('theatre', p.kind === 'theatre');
    document.body.classList.toggle('theatre-on', p.kind === 'theatre');
    if (p.kind === 'quad') {
      s.opacity = '1';
      s.transform = quadMatrix(p.corners);
      s.borderRadius = '0';
    } else if (p.kind === 'pip' || p.kind === 'theatre') {
      const k = p.width / VW;
      s.opacity = '1';
      s.transform = `translate(${p.x}px, ${p.y}px) scale(${k})`;
      s.borderRadius = p.kind === 'theatre' ? `${12 / k}px` : '18px';
    } else {
      s.opacity = '0';
      s.transform = 'translate(0px, 0px) scale(0.2)';
    }
  }
}
