// Layered map renderer.
//
//   world layer   whole map at low resolution, always under everything (no black gaps while panning)
//   base layer    sharp map of the visible area (+ margin), re-rendered only when idle
//   overlay       units, labels, selection, battles, effects (transparent, cheap to redraw)
//
// The world and base layers are moved with CSS transforms during gestures, so panning
// and pinching cost almost nothing; they are re-rendered after the gesture ends.
import { TERRAIN, UNITS } from '../data/units';
import type { Game } from '../sim/ctx';
import { edgeLen } from '../sim/military';
import type { Loc, Unit } from '../sim/types';
import { unitVisible } from '../sim/visibility';
import { W_HEAT, W_MONSOON, W_RAIN, W_SNOW, W_STORM } from '../sim/weather';
import type { MapGeo } from './geo';

export type Layer = 'political' | 'terrain' | 'supply' | 'alliances' | 'weather';
export interface View { x: number; y: number; k: number }

export interface BadgeHit {
  x: number;
  y: number;
  r: number;
  units: number[];
  loc: Loc;
}

const OCEAN = '#0d2240';
const WORLD_SCALE = 1.024; // world layer pixels per map unit (2048 px wide)
const PAD = 140; // base layer margin around the screen (CSS px)

type Fill = string | { a: string; b: string };

export class MapRenderer {
  root: HTMLDivElement;
  private worldCv: HTMLCanvasElement;
  private baseCv: HTMLCanvasElement;
  overCv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  w = 0;
  h = 0;
  view: View = { x: 0, y: 0, k: 1 };
  layer: Layer = 'political';
  game: Game | null = null;
  selectedUnits = new Set<number>();
  selectedProvince = -1;
  highlight: number[] = [];
  previewPath: Loc[] = [];
  badges: BadgeHit[] = [];
  effects: { kind: 'nuke' | 'missile' | 'ping'; x: number; y: number; t0: number }[] = [];
  lowDetail = false;
  showUnits = true;
  /** When false the map layers are hidden and the overlay canvas is free for the globe. */
  mapVisible = true;

  private baseView: View | null = null;
  private baseDirty = true;
  private worldDirty = true;
  private overlayDirty = true;
  private lastViewChange = 0;
  private lastBaseRender = 0;
  private lastWorldRender = 0;
  private lastOverlay = 0;
  private cssView: View | null = null;
  private fills: Map<string, Path2D> | null = null;
  private fillStyles = new Map<string, Fill>();
  private weatherFills: Map<number, Path2D> | null = null;
  private borders: Path2D | null = null;
  private playerBorder: Path2D | null = null;
  private provBorders: Path2D;
  private coast: Path2D;
  private patterns = new Map<string, CanvasPattern>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private prevRad: Float32Array | null = null;
  private nationLabels: { x: number; y: number; size: number; name: string; idx: number }[] = [];
  private labelsDirty = true;

  constructor(parent: HTMLElement, public geo: MapGeo) {
    this.root = document.createElement('div');
    this.root.className = 'maproot';
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: OCEAN, touchAction: 'none' });
    const mk = (z: number) => {
      const c = document.createElement('canvas');
      Object.assign(c.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', zIndex: String(z), pointerEvents: 'none' });
      this.root.appendChild(c);
      return c;
    };
    this.worldCv = mk(1);
    this.baseCv = mk(2);
    this.overCv = mk(3);
    Object.assign(this.overCv.style, { width: '100%', height: '100%' });
    parent.appendChild(this.root);
    this.ctx = this.overCv.getContext('2d')!;
    this.worldCv.width = Math.round(geo.width * WORLD_SCALE);
    this.worldCv.height = Math.round(geo.height * WORLD_SCALE);
    Object.assign(this.worldCv.style, { width: geo.width + 'px', height: geo.height + 'px' });
    // static geometry: coastlines and internal province borders
    this.coast = new Path2D();
    this.provBorders = new Path2D();
    for (let a = 0; a < geo.arcs.length; a++) this.addArc(geo.arcProvs[a * 2 + 1] >= 0 ? this.provBorders : this.coast, a);
  }

  private addArc(path: Path2D, a: number) {
    const arc = this.geo.arcs[a];
    path.moveTo(arc[0], arc[1]);
    for (let k = 2; k < arc.length; k += 2) path.lineTo(arc[k], arc[k + 1]);
  }

  setGame(g: Game | null) {
    this.game = g;
    this.prevRad = null;
    this.invalidate(true);
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.lowDetail ? 1.25 : 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.overCv.width = Math.round(this.w * this.dpr);
    this.overCv.height = Math.round(this.h * this.dpr);
    this.baseCv.width = Math.round((this.w + PAD * 2) * this.dpr);
    this.baseCv.height = Math.round((this.h + PAD * 2) * this.dpr);
    Object.assign(this.baseCv.style, { width: this.w + PAD * 2 + 'px', height: this.h + PAD * 2 + 'px' });
    this.clampView();
    this.baseView = null;
    this.baseDirty = true;
    this.overlayDirty = true;
    this.cssView = null;
  }

  // ------------------------------------------------------------ view
  minK() {
    return Math.max(this.w / this.geo.width, this.h / (this.geo.height - 160)) * 0.95;
  }
  clampView() {
    const k = (this.view.k = Math.max(this.minK(), Math.min(40, this.view.k)));
    const vw = this.w / k, vh = this.h / k;
    const minY = 50, maxY = this.geo.height - 110;
    this.view.x = vw >= this.geo.width ? (this.geo.width - vw) / 2 : Math.max(0, Math.min(this.geo.width - vw, this.view.x));
    this.view.y = vh >= maxY - minY ? (minY + maxY - vh) / 2 : Math.max(minY, Math.min(maxY - vh, this.view.y));
  }
  toScreen(x: number, y: number): [number, number] {
    return [(x - this.view.x) * this.view.k, (y - this.view.y) * this.view.k];
  }
  toWorld(sx: number, sy: number): [number, number] {
    return [sx / this.view.k + this.view.x, sy / this.view.k + this.view.y];
  }
  pan(dx: number, dy: number) {
    this.view.x -= dx / this.view.k;
    this.view.y -= dy / this.view.k;
    this.clampView();
    this.viewChanged();
  }
  zoomAt(sx: number, sy: number, f: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.k *= f;
    this.clampView();
    this.view.x = wx - sx / this.view.k;
    this.view.y = wy - sy / this.view.k;
    this.clampView();
    this.viewChanged();
  }
  centerOn(wx: number, wy: number, k?: number) {
    if (k) this.view.k = k;
    this.clampView();
    this.view.x = wx - this.w / 2 / this.view.k;
    this.view.y = wy - this.h / 2 / this.view.k;
    this.clampView();
    this.viewChanged();
  }
  centerOnProvince(p: number, k?: number) {
    this.centerOn(this.geo.center[p * 2], this.geo.center[p * 2 + 1], k);
  }
  fitWorld() {
    this.view.k = this.minK();
    this.centerOn(this.geo.width / 2, this.geo.height / 2 - 30);
  }
  private viewChanged() {
    this.lastViewChange = performance.now();
    this.overlayDirty = true;
  }
  /** Map data changed (borders, layer). `now` forces an immediate redraw. */
  invalidate(now = false) {
    this.fills = null;
    this.weatherFills = null;
    this.borders = null;
    this.playerBorder = null;
    this.labelsDirty = true;
    this.baseDirty = true;
    this.worldDirty = true;
    this.overlayDirty = true;
    if (now) { this.lastBaseRender = 0; this.lastWorldRender = 0; }
  }
  /** Overlay-only change (units, selection). */
  touch() {
    this.overlayDirty = true;
  }

  locXY(l: Loc): [number, number] {
    if (l >= 0) return [this.geo.center[l * 2], this.geo.center[l * 2 + 1]];
    const c = -l - 1;
    return [this.geo.cellXY[c * 2], this.geo.cellXY[c * 2 + 1]];
  }

  unitXY(u: Unit): [number, number] {
    const [x, y] = this.locXY(u.loc);
    if (!u.path.length || !this.game) return [x, y];
    const [x2, y2] = this.locXY(u.path[0]);
    const len = UNITS[u.type].domain === 'air' ? Math.max(50, this.game.locDist(u.loc, u.path[0])) : edgeLen(this.game, u.loc, u.path[0]);
    const t = Math.min(1, u.progress / len) * (this.game.rt.battles.has(u.path[0]) && u.progress >= len ? 0.45 : 1);
    return [x + (x2 - x) * t, y + (y2 - y) * t];
  }

  // ------------------------------------------------------------ frame
  /** Draw what is needed this frame. `running` = simulation is advancing. */
  frame(now: number, running = false): boolean {
    const g = this.game;
    if (g) {
      if (g.rt.dirtyOwners) {
        g.rt.dirtyOwners = false;
        this.invalidate();
        this.detectEffects(now);
      }
      if (g.rt.dirtyUnits) {
        g.rt.dirtyUnits = false;
        this.overlayDirty = true;
      }
    }
    if (!this.mapVisible) return false;
    const gesturing = now - this.lastViewChange < 160;
    const useBase = this.view.k * this.dpr > WORLD_SCALE * 1.3;
    let drew = false;
    // world layer: re-render rarely (it is only a backdrop)
    if (this.worldDirty && !gesturing && now - this.lastWorldRender > (running ? 4000 : 600)) {
      this.renderWorld();
      this.lastWorldRender = now;
      this.worldDirty = false;
      drew = true;
    }
    // base layer: after gestures settle, or periodically when data changed
    if (useBase && !gesturing) {
      const moved = !this.baseView || this.baseView.k !== this.view.k || Math.abs(this.baseView.x - this.view.x) * this.view.k > PAD * 0.6 || Math.abs(this.baseView.y - this.view.y) * this.view.k > PAD * 0.6;
      if (moved || (this.baseDirty && now - this.lastBaseRender > (running ? 1500 : 200))) {
        this.renderBase();
        this.lastBaseRender = now;
        this.baseDirty = false;
        drew = true;
      }
    }
    this.baseCv.style.display = useBase && this.baseView ? '' : 'none';
    this.applyTransforms();
    // overlay: every frame while gesturing/animating, ~15 fps while the simulation runs
    const animating = this.effects.length > 0 || (g ? g.rt.battles.size > 0 && now - this.lastOverlay > 66 : false);
    if (this.overlayDirty && (gesturing || !running || now - this.lastOverlay > 66) || animating) {
      this.renderOverlay(now);
      this.lastOverlay = now;
      this.overlayDirty = false;
      drew = true;
    }
    return drew;
  }

  private applyTransforms() {
    const v = this.view;
    if (this.cssView && this.cssView.x === v.x && this.cssView.y === v.y && this.cssView.k === v.k) return;
    this.cssView = { ...v };
    this.worldCv.style.transform = `translate(${-v.x * v.k}px, ${-v.y * v.k}px) scale(${v.k})`;
    if (this.baseView) {
      const b = this.baseView;
      const s = v.k / b.k;
      const ox = (b.x - PAD / b.k - v.x) * v.k;
      const oy = (b.y - PAD / b.k - v.y) * v.k;
      this.baseCv.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
    }
  }

  private detectEffects(now: number) {
    const g = this.game!;
    const P = g.s.provinces.length;
    if (!this.prevRad) {
      this.prevRad = new Float32Array(P);
      g.s.provinces.forEach((p, i) => (this.prevRad![i] = p.rad));
      return;
    }
    for (let i = 0; i < P; i++) {
      const r = g.s.provinces[i].rad;
      if (r > 0.9 && this.prevRad[i] < 0.9) {
        const [x, y] = this.locXY(i);
        this.effects.push({ kind: 'nuke', x, y, t0: now });
      }
      this.prevRad[i] = r;
    }
  }

  ping(l: Loc, kind: 'ping' | 'missile' = 'ping') {
    const [x, y] = this.locXY(l);
    this.effects.push({ kind, x, y, t0: performance.now() });
    this.touch();
  }

  // ------------------------------------------------------------ map layers
  private fillKey(i: number): string {
    const g = this.game;
    if (!g) return '#3a4a5c';
    const p = g.s.provinces[i];
    switch (this.layer) {
      case 'terrain':
        return TERRAIN[g.w.provs[i].terrain].color;
      case 'supply': {
        if (!(p.ctrl === g.s.player || g.friendly(g.s.player, p.ctrl))) return '#3d4552';
        const v = Math.round(g.rt.supply[i] * 10) / 10;
        return `hsl(${Math.round(v * 120)}, 60%, ${35 + v * 15}%)`;
      }
      case 'alliances': {
        const bloc = g.blocOf(p.ctrl);
        if (bloc) return bloc.color;
        const ov = g.s.vassal[p.ctrl];
        if (ov !== undefined) return g.blocOf(ov)?.color ?? '#6b7280';
        return '#4b5563';
      }
      default: {
        const owner = g.s.nations[p.owner];
        if (!owner?.active) return '#2f3640';
        if (p.ctrl !== p.owner) {
          const key = 'stripe:' + owner.color + ':' + g.s.nations[p.ctrl].color;
          this.fillStyles.set(key, { a: owner.color, b: g.s.nations[p.ctrl].color });
          return key;
        }
        return owner.color;
      }
    }
  }

  private buildFills() {
    const fills = new Map<string, Path2D>();
    for (let i = 0; i < this.geo.paths.length; i++) {
      const key = this.fillKey(i);
      let p = fills.get(key);
      if (!p) fills.set(key, (p = new Path2D()));
      p.addPath(this.geo.paths[i]);
    }
    this.fills = fills;
    const g = this.game;
    if (g && this.layer === 'weather') {
      const wf = new Map<number, Path2D>();
      for (let i = 0; i < this.geo.paths.length; i++) {
        const w = g.rt.weather[i];
        if (!WEATHER_TINT[w]) continue;
        let p = wf.get(w);
        if (!p) wf.set(w, (p = new Path2D()));
        p.addPath(this.geo.paths[i]);
      }
      this.weatherFills = wf;
    }
  }

  private buildBorders() {
    const g = this.game;
    const path = new Path2D();
    const mine = new Path2D();
    if (g) {
      const ap = this.geo.arcProvs;
      const me = g.s.player;
      for (let a = 0; a < this.geo.arcs.length; a++) {
        const p1 = ap[a * 2], p2 = ap[a * 2 + 1];
        const c1 = p1 >= 0 ? g.s.provinces[p1].ctrl : -1;
        const c2 = p2 >= 0 ? g.s.provinces[p2].ctrl : -1;
        if (p1 >= 0 && p2 >= 0 && c1 !== c2) this.addArc(path, a);
        if ((c1 === me) !== (c2 === me)) this.addArc(mine, a);
      }
    }
    this.borders = path;
    this.playerBorder = mine;
  }

  private stripe(a: string, b: string, ctx: CanvasRenderingContext2D): CanvasPattern {
    const key = a + b;
    let pat = this.patterns.get(key);
    if (pat) return pat;
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const x = c.getContext('2d')!;
    x.fillStyle = a;
    x.fillRect(0, 0, 12, 12);
    x.strokeStyle = b;
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(-3, 15); x.lineTo(15, -3);
    x.moveTo(-3, 3); x.lineTo(3, -3);
    x.moveTo(9, 15); x.lineTo(15, 9);
    x.stroke();
    pat = ctx.createPattern(c, 'repeat')!;
    this.patterns.set(key, pat);
    return pat;
  }

  /** Draw the map in world coordinates; `px` = device pixels per map unit. */
  private drawMap(ctx: CanvasRenderingContext2D, px: number) {
    if (!this.fills) this.buildFills();
    if (!this.borders) this.buildBorders();
    for (const [key, path] of this.fills!) {
      const st = this.fillStyles.get(key);
      ctx.fillStyle = st && typeof st !== 'string' ? this.stripe(st.a, st.b, ctx) : key;
      ctx.fill(path, 'evenodd');
    }
    if (this.weatherFills) {
      for (const [w, path] of this.weatherFills) {
        ctx.fillStyle = WEATHER_TINT[w];
        ctx.fill(path, 'evenodd');
      }
    }
    const lw = 1 / px;
    ctx.lineJoin = 'round';
    if (px > 1.6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = lw * 0.8;
      ctx.stroke(this.provBorders);
    }
    ctx.strokeStyle = 'rgba(10,10,15,0.85)';
    ctx.lineWidth = lw * 1.5;
    ctx.stroke(this.borders!);
    ctx.strokeStyle = 'rgba(180,210,240,0.35)';
    ctx.lineWidth = lw * 1.1;
    ctx.stroke(this.coast);
    if (this.game) {
      ctx.strokeStyle = 'rgba(255,215,0,0.95)';
      ctx.lineWidth = lw * 2.2;
      ctx.stroke(this.playerBorder!);
    }
  }

  private renderWorld() {
    const ctx = this.worldCv.getContext('2d', { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, this.worldCv.width, this.worldCv.height);
    ctx.setTransform(WORLD_SCALE, 0, 0, WORLD_SCALE, 0, 0);
    this.drawMap(ctx, WORLD_SCALE);
  }

  private renderBase() {
    const ctx = this.baseCv.getContext('2d', { alpha: false })!;
    const { k, x, y } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, this.baseCv.width, this.baseCv.height);
    const s = k * this.dpr;
    const ox = x - PAD / k, oy = y - PAD / k;
    ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s);
    this.drawMap(ctx, s);
    this.baseView = { ...this.view };
    this.cssView = null;
  }

  // ------------------------------------------------------------ overlay
  private renderOverlay(now: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overCv.width, this.overCv.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.badges = [];
    const g = this.game;
    const { k } = this.view;
    ctx.save();
    ctx.translate(-this.view.x * k, -this.view.y * k);
    ctx.scale(k, k);
    if (this.selectedProvince >= 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5 / k;
      ctx.stroke(this.geo.paths[this.selectedProvince]);
    }
    if (this.highlight.length) {
      ctx.fillStyle = 'rgba(250,204,21,0.35)';
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2 / k;
      for (const p of this.highlight) {
        ctx.fill(this.geo.paths[p], 'evenodd');
        ctx.stroke(this.geo.paths[p]);
      }
    }
    ctx.restore();
    if (!g) return;
    this.drawLabels(ctx);
    if (!this.showUnits) return;
    this.drawPaths(ctx);
    this.drawUnits(ctx);
    this.drawBattles(ctx, now);
    this.drawEffects(ctx, now);
  }

  private computeLabels() {
    const g = this.game!;
    const geo = this.geo;
    // label each nation over its home territory: provinces near its capital
    const acc = new Map<number, { sx: number; sy: number; a: number; maxA: number; mx: number; my: number }>();
    g.s.provinces.forEach((p, i) => {
      const n = g.s.nations[p.ctrl];
      if (!n?.alive) return;
      const cx = geo.center[i * 2], cy = geo.center[i * 2 + 1];
      const cap = n.capital >= 0 && g.s.provinces[n.capital].ctrl === p.ctrl ? n.capital : -1;
      if (cap >= 0 && Math.hypot(cx - geo.center[cap * 2], cy - geo.center[cap * 2 + 1]) > 260) return;
      const b = i * 4;
      const area = (geo.bbox[b + 2] - geo.bbox[b]) * (geo.bbox[b + 3] - geo.bbox[b + 1]);
      let e = acc.get(p.ctrl);
      if (!e) acc.set(p.ctrl, (e = { sx: 0, sy: 0, a: 0, maxA: 0, mx: 0, my: 0 }));
      if (area > e.maxA) { e.maxA = area; e.mx = cx; e.my = cy; }
      e.sx += cx * area; e.sy += cy * area; e.a += area;
    });
    this.nationLabels = [];
    for (const [n, e] of acc) {
      let x = e.sx / e.a, y = e.sy / e.a;
      if (Math.hypot(x - e.mx, y - e.my) > Math.sqrt(e.maxA) * 0.8) { x = e.mx; y = e.my; }
      const size = Math.max(3, Math.min(26, Math.sqrt(e.a) * 0.11));
      this.nationLabels.push({ x, y, size, name: g.s.nations[n].name, idx: n });
    }
    this.nationLabels.sort((a, b) => b.size - a.size);
    this.labelsDirty = false;
  }

  private drawLabels(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    if (this.labelsDirty) this.computeLabels();
    const k = this.view.k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed: [number, number, number, number][] = [];
    const showProvinces = k > 3.2;
    const overlaps = (b: [number, number, number, number]) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
    if (!showProvinces || k < 6) {
      for (const l of this.nationLabels) {
        const px = l.size * k;
        if (px < 10) continue;
        const fs = Math.min(px, 24);
        const [sx, sy] = this.toScreen(l.x, l.y);
        if (sx < -100 || sy < -30 || sx > this.w + 100 || sy > this.h + 30) continue;
        ctx.font = `700 ${fs}px system-ui, sans-serif`;
        const tw = l.name.length * fs * 0.55; // estimate: avoids measureText every frame
        const box: [number, number, number, number] = [sx - tw / 2, sy - fs / 2, sx + tw / 2, sy + fs / 2];
        if (overlaps(box)) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(l.name, sx, sy);
        ctx.fillStyle = l.idx === g.s.player ? '#ffe066' : 'rgba(255,255,255,0.92)';
        ctx.fillText(l.name, sx, sy);
      }
    }
    if (showProvinces) {
      ctx.font = `600 11px system-ui, sans-serif`;
      const geo = this.geo;
      for (let i = 0; i < geo.paths.length; i++) {
        const b = i * 4;
        if ((geo.bbox[b + 2] - geo.bbox[b]) * k < 70) continue;
        const [sx, sy] = this.toScreen(geo.center[i * 2], geo.center[i * 2 + 1]);
        if (sx < -50 || sy < -20 || sx > this.w + 50 || sy > this.h + 20) continue;
        const name = g.w.provs[i].name;
        const tw = name.length * 6;
        const box: [number, number, number, number] = [sx - tw / 2, sy - 22, sx + tw / 2, sy - 10];
        if (overlaps(box)) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(name, sx, sy - 16);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(name, sx, sy - 16);
        if (g.s.nations[g.s.provinces[i].owner]?.capital === i) {
          ctx.fillStyle = '#facc15';
          ctx.fillText('★', sx, sy - 30);
        }
      }
    } else if (k > 1.6) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(250,204,21,0.9)';
      for (const n of g.s.nations) {
        if (!n.alive || n.capital < 0) continue;
        const [sx, sy] = this.toScreen(this.geo.center[n.capital * 2], this.geo.center[n.capital * 2 + 1]);
        if (sx < 0 || sy < 0 || sx > this.w || sy > this.h) continue;
        ctx.fillText('★', sx, sy + 12);
      }
    }
  }

  private drawPaths(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    const me = g.s.player;
    ctx.lineCap = 'round';
    for (const u of g.s.units) {
      if (u.owner !== me) continue;
      const sel = this.selectedUnits.has(u.id);
      const domain = UNITS[u.type].domain;
      if (domain === 'air' && sel && u.mission !== 'idle' && u.target >= 0) {
        const [bx, by] = this.toScreen(...this.locXY(u.base));
        const [tx, ty] = this.toScreen(...this.locXY(u.target));
        if (Math.hypot(tx - bx, ty - by) > 4) {
          ctx.strokeStyle = u.mission === 'bomb' ? 'rgba(239,68,68,0.8)' : 'rgba(96,165,250,0.8)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo((bx + tx) / 2, (by + ty) / 2 - Math.hypot(tx - bx, ty - by) * 0.2, tx, ty);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (!u.path.length || (!sel && this.view.k < 1.5)) continue;
      const pts = [this.unitXY(u), ...u.path.map((l) => this.locXY(l))];
      const last = u.path[u.path.length - 1];
      const hostile = last >= 0 && g.atWar(me, g.s.provinces[last].ctrl);
      ctx.strokeStyle = hostile ? 'rgba(248,113,113,0.95)' : sel ? 'rgba(74,222,128,0.95)' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const [sx, sy] = this.toScreen(x, y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      const [ex, ey] = this.toScreen(...pts[pts.length - 1]);
      const [px, py] = this.toScreen(...pts[pts.length - 2]);
      arrowHead(ctx, px, py, ex, ey, sel ? 10 : 6);
    }
    if (this.previewPath.length > 1) {
      ctx.strokeStyle = 'rgba(250,204,21,0.9)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      this.previewPath.forEach((l, i) => {
        const [sx, sy] = this.toScreen(...this.locXY(l));
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawUnits(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    const me = g.s.player;
    const k = this.view.k;
    const bin = k < 1.5 ? 34 : 26;
    type Stack = { x: number; y: number; units: Unit[]; owner: number; loc: Loc };
    const bins = new Map<string, Stack>();
    const vx0 = this.view.x - 30 / k, vy0 = this.view.y - 30 / k, vx1 = this.view.x + (this.w + 30) / k, vy1 = this.view.y + (this.h + 30) / k;
    for (const u of g.s.units) {
      const domain = UNITS[u.type].domain;
      const mine = u.owner === me;
      // keep the map readable: other nations' air units are never drawn, and when zoomed
      // out only our units and enemies at war are shown
      if (!mine && domain === 'air') continue;
      if (!mine && k < 2 && !g.atWar(me, u.owner)) continue;
      const [lx, ly] = this.locXY(u.loc);
      if (lx < vx0 - 60 || ly < vy0 - 60 || lx > vx1 + 60 || ly > vy1 + 60) continue;
      if (!unitVisible(g, u.owner, u.loc)) continue;
      const [wx, wy] = this.unitXY(u);
      let [sx, sy] = this.toScreen(wx, wy);
      if (domain === 'air') { sx += 12; sy -= 12; }
      if (sx < -30 || sy < -30 || sx > this.w + 30 || sy > this.h + 30) continue;
      const key = Math.floor(sx / bin) + ':' + Math.floor(sy / bin) + ':' + domain[0] + ':' + u.owner;
      let st = bins.get(key);
      if (!st) bins.set(key, (st = { x: sx, y: sy, units: [], owner: u.owner, loc: u.loc }));
      st.units.push(u);
    }
    const stacks = [...bins.values()].sort((a, b) => (a.owner === me ? 1 : 0) - (b.owner === me ? 1 : 0));
    for (const st of stacks) this.drawBadge(ctx, st);
  }

  private drawBadge(ctx: CanvasRenderingContext2D, st: { x: number; y: number; units: Unit[]; owner: number; loc: Loc }) {
    const g = this.game!;
    const { x, y, units, owner } = st;
    const me = g.s.player;
    const sel = units.some((u) => this.selectedUnits.has(u.id));
    const counts = new Map<Unit['type'], number>();
    for (const u of units) counts.set(u.type, (counts.get(u.type) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const ring = sel ? 'sel' : owner === me ? 'me' : g.atWar(me, owner) ? 'enemy' : 'other';
    const sprite = this.sprite(iconOf(top), g.s.nations[owner].color, ring);
    ctx.drawImage(sprite, x - 17, y - 13, 34, 26);
    const n = units.length;
    if (n > 1) {
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(x + 15, y - 11, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), x + 15, y - 10.5);
    }
    // health bar (strength)
    const str = units.reduce((a, u) => a + u.str * (0.5 + u.org / 200), 0) / n / 100;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 15, y + 12, 30, 4);
    ctx.fillStyle = str > 0.6 ? '#22c55e' : str > 0.3 ? '#eab308' : '#ef4444';
    ctx.fillRect(x - 15, y + 12, 30 * Math.min(1, str), 4);
    this.badges.push({ x, y, r: 20, units: units.map((u) => u.id), loc: st.loc });
  }

  /** Pre-rendered counter: coloured plate + white icon + ring showing whose it is. */
  private sprite(icon: Icon, color: string, ring: 'sel' | 'me' | 'enemy' | 'other') {
    const key = icon + color + ring;
    let c = this.sprites.get(key);
    if (c) return c;
    const s = 2;
    c = document.createElement('canvas');
    c.width = 34 * s;
    c.height = 26 * s;
    const x = c.getContext('2d')!;
    x.scale(s, s);
    x.fillStyle = color;
    x.strokeStyle = ring === 'sel' ? '#4ade80' : ring === 'me' ? '#ffd700' : ring === 'enemy' ? '#ef4444' : 'rgba(0,0,0,0.8)';
    x.lineWidth = ring === 'other' ? 1.5 : 2.5;
    x.beginPath();
    roundRect(x, 2, 2, 30, 20, 5);
    x.fill();
    x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.96)';
    x.strokeStyle = 'rgba(255,255,255,0.96)';
    x.lineWidth = 1.6;
    drawIcon(x, icon, 17, 12);
    this.sprites.set(key, c);
    return c;
  }

  private drawBattles(ctx: CanvasRenderingContext2D, now: number) {
    const g = this.game!;
    const pulse = 0.6 + 0.4 * Math.sin(now / 180);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [p] of g.rt.battles) {
      if (!g.rt.visible[p]) continue;
      const [sx, sy] = this.toScreen(...this.locXY(p));
      if (sx < -20 || sy < -20 || sx > this.w + 20 || sy > this.h + 20) continue;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(220,38,38,0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy - 24, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 29); ctx.lineTo(sx + 5, sy - 19);
      ctx.moveTo(sx + 5, sy - 29); ctx.lineTo(sx - 5, sy - 19);
      ctx.stroke();
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, now: number) {
    this.effects = this.effects.filter((e) => now - e.t0 < (e.kind === 'nuke' ? 4000 : 1500));
    for (const e of this.effects) {
      const t = (now - e.t0) / (e.kind === 'nuke' ? 4000 : 1500);
      const [sx, sy] = this.toScreen(e.x, e.y);
      if (e.kind === 'nuke') {
        const r = 10 + t * 120;
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        grad.addColorStop(0, `rgba(255,255,220,${1 - t})`);
        grad.addColorStop(0.3, `rgba(255,170,0,${0.9 * (1 - t)})`);
        grad.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = e.kind === 'missile' ? `rgba(248,113,113,${1 - t})` : `rgba(250,204,21,${1 - t})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, 6 + t * 30, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** Units (ids) whose counter is under the screen point. */
  badgeAt(sx: number, sy: number): BadgeHit | null {
    let best: BadgeHit | null = null, bd = Infinity;
    for (const b of this.badges) {
      const d = Math.hypot(b.x - sx, b.y - sy);
      if (d < b.r && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /** The overlay canvas is reused by the globe view. */
  setMapVisible(v: boolean) {
    this.mapVisible = v;
    this.worldCv.style.display = v ? '' : 'none';
    this.baseCv.style.display = v ? '' : 'none';
    if (v) { this.overlayDirty = true; this.cssView = null; }
  }
}

const WEATHER_TINT: Record<number, string> = {
  [W_RAIN]: 'rgba(59,130,246,0.45)',
  [W_SNOW]: 'rgba(241,245,249,0.7)',
  [W_MONSOON]: 'rgba(20,184,166,0.55)',
  [W_STORM]: 'rgba(147,51,234,0.6)',
  [W_HEAT]: 'rgba(249,115,22,0.5)',
};

type Icon = 'soldier' | 'tank' | 'gun' | 'plane' | 'ship' | 'rocket';
export function iconOf(t: Unit['type']): Icon {
  switch (t) {
    case 'armor': return 'tank';
    case 'artillery': return 'gun';
    case 'missile': case 'airdef': return 'rocket';
    case 'fighter': case 'bomber': case 'drone': case 'transport': return 'plane';
    case 'carrier': case 'battleship': case 'destroyer': case 'submarine': case 'amphib': return 'ship';
    default: return 'soldier';
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function arrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.fillStyle = ctx.strokeStyle as string;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45));
  ctx.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

/** Simple pictograms everyone can read: soldier, tank, cannon, plane, ship, rocket. */
export function drawIcon(ctx: CanvasRenderingContext2D, icon: Icon, x: number, y: number) {
  ctx.beginPath();
  switch (icon) {
    case 'soldier': // helmet
      ctx.arc(x, y + 3, 7, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 9, y + 2, 18, 2.2);
      return;
    case 'tank':
      ctx.fillRect(x - 9, y, 18, 5);
      ctx.fillRect(x - 5, y - 4, 9, 4);
      ctx.fillRect(x + 3, y - 3, 8, 1.8);
      return;
    case 'gun':
      ctx.arc(x - 3, y + 4, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.lineWidth = 2.6;
      ctx.moveTo(x - 3, y + 2);
      ctx.lineTo(x + 8, y - 5);
      ctx.stroke();
      return;
    case 'plane':
      ctx.moveTo(x + 9, y);
      ctx.lineTo(x - 7, y - 2);
      ctx.lineTo(x - 2, y - 8);
      ctx.lineTo(x - 5, y - 8);
      ctx.lineTo(x - 10, y - 2);
      ctx.lineTo(x - 10, y + 2);
      ctx.lineTo(x - 5, y + 8);
      ctx.lineTo(x - 2, y + 8);
      ctx.lineTo(x - 7, y + 2);
      ctx.closePath();
      ctx.fill();
      return;
    case 'ship':
      ctx.moveTo(x - 10, y + 1);
      ctx.lineTo(x + 10, y + 1);
      ctx.lineTo(x + 7, y + 6);
      ctx.lineTo(x - 7, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 3, y - 4, 6, 5);
      ctx.fillRect(x - 0.7, y - 8, 1.4, 4);
      return;
    case 'rocket':
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x + 3.5, y - 3);
      ctx.lineTo(x + 3.5, y + 5);
      ctx.lineTo(x + 6, y + 8);
      ctx.lineTo(x - 6, y + 8);
      ctx.lineTo(x - 3.5, y + 5);
      ctx.lineTo(x - 3.5, y - 3);
      ctx.closePath();
      ctx.fill();
      return;
  }
}
