// Map renderer for the Territorial-style game.
//
// The whole board is one small image (one pixel per cell). Each frame it's drawn scaled to
// the screen — crisp pixel-art when zoomed in — with names, troop counts and boats on top.
// Only pixels that changed owner are repainted, so it stays cheap while the map is busy.
import type { TerrGame } from '../terr/game';
import { fmtTroops } from '../terr/game';
import type { TerrMap } from '../terr/map';
import { cartoon } from './cartoon';

const OCEAN = '#2a5f9e';
const FOAM = '#5d93cc';
const EMPTY = '#ddd5bd';
const EMPTY_EDGE = '#b8ae93';
const VOID = '#3b4757';
const ME_EDGE = '#ffd23f';

interface View { x: number; y: number; k: number }

/** Any CSS colour → 0xAABBGGRR (ImageData order on little-endian). */
const colorCache = new Map<string, [number, number, number]>();
function rgbOf(c: string): [number, number, number] {
  let v = colorCache.get(c);
  if (v) return v;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const x = cv.getContext('2d')!;
  x.fillStyle = c;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  v = [d[0], d[1], d[2]];
  colorCache.set(c, v);
  return v;
}
const pack = (r: number, g: number, b: number) => (255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
const mix = ([r, g, b]: [number, number, number], [r2, g2, b2]: [number, number, number], t: number) => pack(r + (r2 - r) * t, g + (g2 - g) * t, b + (b2 - b) * t);

export class TerrRenderer {
  root: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private img: ImageData;
  private px: Uint32Array;
  private m: TerrMap;
  game: TerrGame | null = null;
  w = 1;
  h = 1;
  dpr = 1;
  lowDetail = false;
  view: View = { x: 0, y: 0, k: 1 };
  private dirty = true;
  private texDirty: [number, number, number, number] | null = null;
  private colors: { fill: number; edge: number; glow: number }[] = [];
  private glow: number[] = []; // cell, until(ms) pairs
  private glowHead = 0;
  private labels: { p: number; x: number; y: number; r: number }[] = [];
  private lastLabels = 0;
  private pings: { x: number; y: number; t0: number; color: string }[] = [];
  /** Cell the player is pointing at (highlighted in build-up to an attack). */
  hover = -1;

  constructor(parent: HTMLElement, m: TerrMap) {
    this.m = m;
    this.root = document.createElement('div');
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: OCEAN, touchAction: 'none' });
    this.cv = document.createElement('canvas');
    Object.assign(this.cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    this.root.appendChild(this.cv);
    parent.appendChild(this.root);
    this.ctx = this.cv.getContext('2d')!;
    this.tex = document.createElement('canvas');
    this.tex.width = m.w;
    this.tex.height = m.h;
    this.tctx = this.tex.getContext('2d')!;
    this.img = this.tctx.createImageData(m.w, m.h);
    this.px = new Uint32Array(this.img.data.buffer);
    this.paintWater();
    this.resize();
    this.fitWorld();
  }

  // ------------------------------------------------------------ setup
  resize() {
    const r = this.root.getBoundingClientRect();
    const dev = window.devicePixelRatio || 1;
    this.dpr = Math.min(dev, this.lowDetail ? 2 : 3);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
    this.clampView();
    this.dirty = true;
  }

  setGame(g: TerrGame | null) {
    this.game = g;
    this.glow = [];
    this.glowHead = 0;
    this.labels = [];
    this.lastLabels = 0;
    this.refreshColors();
    if (g) g.fullRedraw = true;
    this.dirty = true;
  }

  /** Player colours changed (e.g. the human picked a country). */
  refreshColors() {
    const g = this.game;
    this.colors = [];
    if (!g) return;
    const white: [number, number, number] = [255, 255, 255];
    const black: [number, number, number] = [10, 20, 40];
    for (const p of g.s.players) {
      const c = rgbOf(cartoon(p.color));
      const me = p.idx === g.s.player;
      this.colors.push({ fill: pack(...c), edge: me ? pack(...rgbOf(ME_EDGE)) : mix(c, black, 0.42), glow: mix(c, white, 0.55) });
    }
    if (g) g.fullRedraw = true;
  }

  private paintWater() {
    const { m, px } = this;
    const ocean = pack(...rgbOf(OCEAN)), foam = pack(...rgbOf(FOAM));
    for (let i = 0; i < m.w * m.h; i++) {
      if (m.prov[i] >= 0) continue;
      const x = i % m.w;
      const near = (x > 0 && m.prov[i - 1] >= 0) || (x < m.w - 1 && m.prov[i + 1] >= 0) || (i >= m.w && m.prov[i - m.w] >= 0) || (i < m.w * (m.h - 1) && m.prov[i + m.w] >= 0);
      px[i] = near ? foam : ocean;
    }
  }

  private paint(i: number, glow = false) {
    const m = this.m;
    if (m.prov[i] < 0) return;
    const own = this.game ? this.game.s.owner : null;
    const o = own ? own[i] : -1;
    if (o === -2) { this.px[i] = VOID_PX; return; }
    // edge = touches water, the board edge, or someone else
    const x = i % m.w;
    let edge = false;
    const chk = (j: number) => { if (!own ? m.prov[j] < 0 : own[j] !== o || m.prov[j] < 0) edge = true; };
    if (x > 0) chk(i - 1); else edge = true;
    if (x < m.w - 1) chk(i + 1); else edge = true;
    if (i >= m.w) chk(i - m.w); else edge = true;
    if (i < m.w * (m.h - 1)) chk(i + m.w); else edge = true;
    if (o < 0) { this.px[i] = edge ? EMPTY_EDGE_PX : EMPTY_PX; return; }
    const c = this.colors[o];
    this.px[i] = glow ? c.glow : edge ? c.edge : c.fill;
  }

  private touchTex(i: number) {
    const x = i % this.m.w, y = (i / this.m.w) | 0;
    const d = this.texDirty;
    if (!d) this.texDirty = [x, y, x, y];
    else {
      if (x < d[0]) d[0] = x;
      if (y < d[1]) d[1] = y;
      if (x > d[2]) d[2] = x;
      if (y > d[3]) d[3] = y;
    }
  }

  private updateTexture(now: number) {
    const g = this.game;
    const m = this.m;
    if (!g) return;
    if (g.fullRedraw) {
      g.fullRedraw = false;
      g.changed.length = 0;
      for (let i = 0; i < m.w * m.h; i++) this.paint(i);
      this.texDirty = [0, 0, m.w - 1, m.h - 1];
    }
    if (g.changed.length) {
      const glowing = g.changed.length < 3000; // skip the flash during huge sweeps
      for (const i of g.changed) {
        this.paint(i, glowing);
        this.touchTex(i);
        const x = i % m.w;
        if (x > 0) { this.paint(i - 1); this.touchTex(i - 1); }
        if (x < m.w - 1) { this.paint(i + 1); this.touchTex(i + 1); }
        if (i >= m.w) { this.paint(i - m.w); this.touchTex(i - m.w); }
        if (i < m.w * (m.h - 1)) { this.paint(i + m.w); this.touchTex(i + m.w); }
        if (glowing) this.glow.push(i, now + 260);
      }
      g.changed.length = 0;
    }
    // fade the capture flash
    while (this.glowHead < this.glow.length && this.glow[this.glowHead + 1] <= now) {
      const i = this.glow[this.glowHead];
      this.glowHead += 2;
      this.paint(i);
      this.touchTex(i);
    }
    if (this.glowHead > 20000) { this.glow = this.glow.slice(this.glowHead); this.glowHead = 0; }
    const d = this.texDirty;
    if (d) {
      this.tctx.putImageData(this.img, 0, 0, d[0], d[1], d[2] - d[0] + 1, d[3] - d[1] + 1);
      this.texDirty = null;
      this.dirty = true;
    }
  }

  // ------------------------------------------------------------ view
  minK() {
    return Math.max(this.w / this.m.w, this.h / (this.m.h * 0.82)) * 0.95;
  }
  clampView() {
    const k = (this.view.k = Math.max(this.minK(), Math.min(60, this.view.k)));
    const vw = this.w / k, vh = this.h / k;
    const W = this.m.w, H = this.m.h;
    this.view.x = vw >= W ? (W - vw) / 2 : Math.max(-vw * 0.45, Math.min(W - vw * 0.55, this.view.x));
    this.view.y = vh >= H ? (H - vh) / 2 : Math.max(-vh * 0.45, Math.min(H - vh * 0.6, this.view.y));
  }
  toScreen(x: number, y: number): [number, number] {
    return [(x - this.view.x) * this.view.k, (y - this.view.y) * this.view.k];
  }
  toWorld(sx: number, sy: number): [number, number] {
    return [sx / this.view.k + this.view.x, sy / this.view.k + this.view.y];
  }
  cellAt(sx: number, sy: number): number {
    const [x, y] = this.toWorld(sx, sy);
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.m.w || cy >= this.m.h) return -1;
    return cy * this.m.w + cx;
  }
  pan(dx: number, dy: number) {
    this.view.x -= dx / this.view.k;
    this.view.y -= dy / this.view.k;
    this.clampView();
    this.dirty = true;
  }
  zoomAt(sx: number, sy: number, f: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.k *= f;
    this.clampView();
    this.view.x = wx - sx / this.view.k;
    this.view.y = wy - sy / this.view.k;
    this.clampView();
    this.dirty = true;
  }
  centerOn(wx: number, wy: number, k?: number) {
    if (k) this.view.k = k;
    this.clampView();
    this.view.x = wx - this.w / 2 / this.view.k;
    this.view.y = wy - this.h / 2 / this.view.k;
    this.clampView();
    this.dirty = true;
  }
  fitWorld() {
    this.view.k = this.minK();
    this.centerOn(this.m.w / 2, this.m.h * 0.42);
  }

  // ------------------------------------------------------------ camera motion
  private vel = { x: 0, y: 0 };
  private anim: { from: View; to: View; t0: number; dur: number } | null = null;
  private lastMotion = 0;
  fling(vx: number, vy: number) {
    this.anim = null;
    const max = 4;
    this.vel = { x: Math.max(-max, Math.min(max, vx)), y: Math.max(-max, Math.min(max, vy)) };
    this.lastMotion = performance.now();
  }
  stopMotion() {
    this.vel = { x: 0, y: 0 };
    this.anim = null;
  }
  flyTo(wx: number, wy: number, k = this.view.k, dur = 550) {
    const from = { ...this.view };
    this.view.k = k;
    this.clampView();
    this.view.x = wx - this.w / 2 / this.view.k;
    this.view.y = wy - this.h / 2 / this.view.k;
    this.clampView();
    const to = { ...this.view };
    this.view = from;
    this.vel = { x: 0, y: 0 };
    this.anim = { from, to, t0: performance.now(), dur };
  }
  /** Fly to a player's land. */
  flyToPlayer(p: number, k?: number) {
    const spot = this.spotOf(p);
    if (spot) this.flyTo(spot.x, spot.y, k ?? Math.max(this.view.k, Math.min(12, 260 / Math.max(8, spot.r * 2.4))));
  }
  zoomSmooth(sx: number, sy: number, f: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    const k = Math.max(this.minK(), Math.min(60, this.view.k * f));
    this.flyTo(wx - (sx - this.w / 2) / k, wy - (sy - this.h / 2) / k, k, 350);
  }
  private stepMotion(now: number) {
    const dt = Math.min(50, now - (this.lastMotion || now));
    this.lastMotion = now;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const cf = [a.from.x + this.w / 2 / a.from.k, a.from.y + this.h / 2 / a.from.k];
      const ct = [a.to.x + this.w / 2 / a.to.k, a.to.y + this.h / 2 / a.to.k];
      const k = Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e);
      const cx = cf[0] + (ct[0] - cf[0]) * e, cy = cf[1] + (ct[1] - cf[1]) * e;
      this.view = { k, x: cx - this.w / 2 / k, y: cy - this.h / 2 / k };
      if (t >= 1) { this.view = { ...a.to }; this.anim = null; }
      this.dirty = true;
      return;
    }
    if (Math.abs(this.vel.x) + Math.abs(this.vel.y) > 0.01) {
      const before = { ...this.view };
      this.pan(this.vel.x * dt, this.vel.y * dt);
      const decay = Math.exp(-dt / 320);
      this.vel.x = before.x === this.view.x ? 0 : this.vel.x * decay;
      this.vel.y = before.y === this.view.y ? 0 : this.vel.y * decay;
    }
  }

  // ------------------------------------------------------------ effects
  ping(cell: number, color = '#ffffff') {
    this.pings.push({ x: (cell % this.m.w) + 0.5, y: Math.floor(cell / this.m.w) + 0.5, t0: performance.now(), color });
    this.dirty = true;
  }
  touch() {
    this.dirty = true;
  }
  spotOf(p: number) {
    return this.labels.find((l) => l.p === p) ?? null;
  }

  // ------------------------------------------------------------ frame
  frame(now: number, running: boolean) {
    this.stepMotion(now);
    this.updateTexture(now);
    const g = this.game;
    if (g && (now - this.lastLabels > (running ? 1200 : 4000) || !this.labels.length)) {
      this.labels = g.labelSpots(2);
      this.lastLabels = now;
      this.dirty = true;
    }
    if (this.pings.length || (g && (g.s.boats.length || this.glowHead < this.glow.length))) this.dirty = true;
    if (running) this.dirty = true; // troop counts tick up
    if (!this.dirty) return;
    this.dirty = false;
    this.draw(now);
  }

  private draw(now: number) {
    const ctx = this.ctx;
    const { k, x, y } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // crisp pixels when zoomed in, smooth when zoomed out
    ctx.imageSmoothingEnabled = k * this.dpr < 2.5;
    ctx.drawImage(this.tex, -x * k, -y * k, this.m.w * k, this.m.h * k);
    const g = this.game;
    if (!g) return;
    if (this.hover >= 0) {
      const [sx, sy] = this.toScreen((this.hover % this.m.w) + 0.5, Math.floor(this.hover / this.m.w) + 0.5);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawLabels(ctx);
    this.drawBoats(ctx);
    // pings: expanding rings where something happened
    this.pings = this.pings.filter((p) => now - p.t0 < 700);
    for (const p of this.pings) {
      const t = (now - p.t0) / 700;
      const [sx, sy] = this.toScreen(p.x, p.y);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 4 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 8 + t * 34, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawLabels(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    const k = this.view.k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of this.labels) {
      const p = g.s.players[l.p];
      if (!p?.alive) continue;
      const [sx, sy] = this.toScreen(l.x, l.y);
      const room = l.r * k; // radius in screen px
      if (room < 9 || sx < -100 || sy < -40 || sx > this.w + 100 || sy > this.h + 40) continue;
      let fs = Math.min(26, room * 0.55);
      fs = Math.min(fs, (room * 2.6) / Math.max(3, p.name.length) / 0.6);
      if (fs < 8) continue;
      const me = l.p === g.s.player;
      const troops = fmtTroops(p.troops);
      ctx.font = `700 ${fs}px Fredoka, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2.5, fs / 4.5);
      ctx.strokeStyle = 'rgba(12,28,54,0.85)';
      const ny = sy - fs * 0.45;
      ctx.strokeText(p.name, sx, ny);
      ctx.fillStyle = me ? '#ffe680' : '#ffffff';
      ctx.fillText(p.name, sx, ny);
      const ts = Math.max(8, fs * 0.82);
      ctx.font = `600 ${ts}px Fredoka, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2.5, ts / 4.5);
      ctx.strokeText(troops, sx, sy + ts * 0.62);
      ctx.fillStyle = me ? '#ffe680' : '#e8f1ff';
      ctx.fillText(troops, sx, sy + ts * 0.62);
    }
  }

  private drawBoats(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    for (const b of g.s.boats) {
      const [wx, wy] = g.boatXY(b);
      const [sx, sy] = this.toScreen(wx, wy);
      if (sx < -30 || sy < -30 || sx > this.w + 30 || sy > this.h + 30) continue;
      const p = g.s.players[b.from];
      const me = b.from === g.s.player;
      ctx.fillStyle = 'rgba(12,28,54,0.35)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 9, 13, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // hull
      ctx.fillStyle = cartoon(p.color);
      ctx.strokeStyle = me ? ME_EDGE : '#0c1c36';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx - 13, sy + 1);
      ctx.lineTo(sx + 13, sy + 1);
      ctx.lineTo(sx + 8, sy + 8);
      ctx.lineTo(sx - 8, sy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // sail
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0c1c36';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 14);
      ctx.lineTo(sx + 9, sy - 1);
      ctx.lineTo(sx, sy - 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = '700 11px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(12,28,54,0.9)';
      const t = fmtTroops(b.troops);
      ctx.strokeText(t, sx, sy + 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(t, sx, sy + 18);
    }
  }
}

let VOID_PX = 0, EMPTY_PX = 0, EMPTY_EDGE_PX = 0;
if (typeof document !== 'undefined') {
  VOID_PX = pack(...rgbOf(VOID));
  EMPTY_PX = pack(...rgbOf(EMPTY));
  EMPTY_EDGE_PX = pack(...rgbOf(EMPTY_EDGE));
}
