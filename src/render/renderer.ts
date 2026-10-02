// Layered map renderer.
//
//   world layer   whole map at low resolution, always under everything (no black gaps while panning)
//   base layer    sharp map of the visible area (+ margin), re-rendered only when idle
//   overlay       units, labels, battles, effects, arrows (transparent, cheap to redraw)
//
// The world and base layers are moved with CSS transforms during gestures, so panning
// and pinching cost almost nothing; they are re-rendered after the gesture ends.
import { BUILDINGS, BUILDING_TYPES, TERRAIN, UNITS } from '../data/units';
import type { Fx, Game } from '../sim/ctx';
import { locVisible, unitVisible } from '../sim/fog';
import { edgeLen, etaHours, unitSpeed } from '../sim/military';
import type { Loc, Unit, UnitType } from '../sim/types';
import type { MapGeo } from './geo';
import { buildRaster, poles, type Pole, type Raster } from './raster';

export type Layer = 'political' | 'terrain' | 'alliances' | 'resources';
export interface View { x: number; y: number; k: number }

export interface BadgeHit {
  x: number;
  y: number;
  r: number;
  units: number[];
  loc: Loc;
  owner: number;
}

const OCEAN = '#0f2747';
const WORLD_SCALE = 1.024; // world layer pixels per map unit (2048 px wide)
const PAD = 140; // base layer margin around the screen (CSS px)

type Fill = string | { a: string; b: string };
interface Effect { kind: Fx['kind'] | 'ping' | 'confetti'; x: number; y: number; t0: number; dur: number; value?: number; color?: string; seed: number }

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
  /** Regions to glow (e.g. where a building can go). */
  highlight: number[] = [];
  highlightColor = '34,197,94';
  /** Regions selected planes can reach (faint blue tint). */
  airRange: number[] = [];
  previewPath: Loc[] = [];
  /** Finger-drag order in progress: from a unit stack to the finger. */
  drag: { x0: number; y0: number; x: number; y: number; target: Loc | null; hostile: boolean } | null = null;
  badges: BadgeHit[] = [];
  lowDetail = false;
  showUnits = true;
  mapVisible = true;

  private effects: Effect[] = [];
  private fxSeen = 0;
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
  private fog: Path2D | null = null;
  private visKey = '';
  private borders: Path2D | null = null;
  private playerBorder: Path2D | null = null;
  private provBorders: Path2D;
  private coast: Path2D;
  private patterns = new Map<string, CanvasPattern>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private nationLabels: { x: number; y: number; size: number; name: string; idx: number }[] = [];
  private labelsDirty = true;
  private labelRaster: Raster | null = null;

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
    this.effects = [];
    this.fxSeen = g ? g.rt.fx.length : 0;
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
    this.sprites.clear();
  }

  // ------------------------------------------------------------ view
  minK() {
    return Math.max(this.w / this.geo.width, this.h / (this.geo.height * 0.82)) * 0.95;
  }
  clampView() {
    const k = (this.view.k = Math.max(this.minK(), Math.min(40, this.view.k)));
    const vw = this.w / k, vh = this.h / k;
    const W = this.geo.width, H = this.geo.height;
    // any point of the map can be brought to the middle of the screen (clear of the top bar)
    this.view.x = vw >= W ? (W - vw) / 2 : Math.max(-vw * 0.45, Math.min(W - vw * 0.55, this.view.x));
    this.view.y = vh >= H ? (H - vh) / 2 : Math.max(-vh * 0.45, Math.min(H - vh * 0.6, this.view.y));
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
    this.centerOn(this.geo.width / 2, this.geo.height * 0.42);
  }
  private viewChanged() {
    this.lastViewChange = performance.now();
    this.overlayDirty = true;
  }

  // ------------------------------------------------------------ camera motion
  private vel = { x: 0, y: 0 }; // fling velocity, CSS px per ms
  private anim: { from: View; to: View; t0: number; dur: number } | null = null;
  private lastMotion = 0;
  /** Keep gliding after a swipe. */
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
  get moving() {
    return this.anim !== null || Math.abs(this.vel.x) + Math.abs(this.vel.y) > 0.01;
  }
  /** Smoothly fly the camera to centre a map point (and zoom). */
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
  flyToProvince(p: number, k?: number) {
    this.flyTo(this.geo.center[p * 2], this.geo.center[p * 2 + 1], k);
  }
  /** Smooth zoom around a screen point (double tap). */
  zoomSmooth(sx: number, sy: number, f: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    const k = Math.max(this.minK(), Math.min(40, this.view.k * f));
    // keep the tapped point under the finger: centre = point shifted by its offset from the screen centre
    this.flyTo(wx - (sx - this.w / 2) / k, wy - (sy - this.h / 2) / k, k, 350);
  }
  private stepMotion(now: number) {
    const dt = Math.min(50, now - (this.lastMotion || now));
    this.lastMotion = now;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // interpolate the screen centre and zoom (in log space) so flights look natural
      const cf = [a.from.x + this.w / 2 / a.from.k, a.from.y + this.h / 2 / a.from.k];
      const ct = [a.to.x + this.w / 2 / a.to.k, a.to.y + this.h / 2 / a.to.k];
      const k = Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e);
      const cx = cf[0] + (ct[0] - cf[0]) * e, cy = cf[1] + (ct[1] - cf[1]) * e;
      this.view = { k, x: cx - this.w / 2 / k, y: cy - this.h / 2 / k };
      if (t >= 1) { this.view = { ...a.to }; this.anim = null; }
      this.viewChanged();
      return;
    }
    if (Math.abs(this.vel.x) + Math.abs(this.vel.y) > 0.01) {
      const before = { ...this.view };
      this.pan(this.vel.x * dt, this.vel.y * dt);
      const decay = Math.exp(-dt / 320);
      // stop dead against the map edge
      this.vel.x = before.x === this.view.x ? 0 : this.vel.x * decay;
      this.vel.y = before.y === this.view.y ? 0 : this.vel.y * decay;
    }
  }
  /** Map data changed (borders, layer). `now` forces an immediate redraw. */
  invalidate(now = false) {
    this.fills = null;
    this.borders = null;
    this.playerBorder = null;
    this.fog = null;
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

  /** Fraction of a game hour that has passed since the last tick (for smooth movement). */
  tickFrac = 0;

  /** Map position of a unit, part-way along its current step. Attackers stop at the border. */
  unitXY(u: Unit): [number, number] {
    const [x, y] = this.locXY(u.loc);
    const g = this.game;
    if (!u.path.length || !g || UNITS[u.type].domain === 'air') return [x, y];
    const next = u.path[0];
    const [x2, y2] = this.locXY(next);
    const len = edgeLen(g, u.loc, next);
    const hostile = next >= 0 && (g.atWar(u.owner, g.s.provinces[next].ctrl) || g.rt.battleAt.has(next));
    const prog = u.progress + (u.progress < len ? unitSpeed(g, u, next) * this.tickFrac : 0);
    const t = Math.min(1, prog / len) * (hostile ? 0.45 : 1);
    return [x + (x2 - x) * t, y + (y2 - y) * t];
  }

  // ------------------------------------------------------------ frame
  frame(now: number, running = false): boolean {
    const g = this.game;
    if (g) {
      if (g.rt.dirtyOwners) {
        g.rt.dirtyOwners = false;
        this.invalidate();
      }
      if (g.rt.dirtyUnits || g.rt.dirtyBuildings) {
        g.rt.dirtyUnits = false;
        g.rt.dirtyBuildings = false;
        this.overlayDirty = true;
      }
      this.pullFx(now);
      if (g.s.settings.fog) {
        const key = this.visibilityKey();
        if (key !== this.visKey) {
          this.visKey = key;
          this.fog = null;
          this.fills = null;
          this.baseDirty = true;
          this.worldDirty = true;
        }
      }
    }
    if (!this.mapVisible) return false;
    this.stepMotion(now);
    const gesturing = now - this.lastViewChange < 160;
    const useBase = this.view.k * this.dpr > WORLD_SCALE * 1.3;
    let drew = false;
    if (this.worldDirty && !gesturing && now - this.lastWorldRender > (!running ? 600 : useBase ? 15000 : 3000)) {
      this.renderWorld();
      this.lastWorldRender = now;
      this.worldDirty = false;
      drew = true;
    }
    if (useBase && !gesturing) {
      const moved = !this.baseView || this.baseView.k !== this.view.k || Math.abs(this.baseView.x - this.view.x) * this.view.k > PAD * 0.6 || Math.abs(this.baseView.y - this.view.y) * this.view.k > PAD * 0.6;
      if (moved || (this.baseDirty && now - this.lastBaseRender > (running ? 2000 : 150))) {
        this.renderBase();
        this.lastBaseRender = now;
        this.baseDirty = false;
        drew = true;
      }
    }
    this.baseCv.style.display = useBase && this.baseView ? '' : 'none';
    this.applyTransforms();
    const animating = this.effects.length > 0 || this.drag !== null || this.selectedUnits.size > 0 || running || (g ? g.s.battles.length > 0 : false);
    const interval = gesturing ? 0 : animating ? 33 : 0;
    if ((this.overlayDirty || animating) && now - this.lastOverlay >= interval) {
      this.renderOverlay(now);
      this.lastOverlay = now;
      this.overlayDirty = false;
      drew = true;
    }
    return drew;
  }

  private visibilityKey() {
    const v = this.game!.rt.visible;
    let h = 0;
    for (let i = 0; i < v.length; i++) h = (Math.imul(h, 31) + v[i] * (i + 1)) | 0;
    return String(h);
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

  /** Turn new simulation events into on-map effects. */
  private pullFx(now: number) {
    const g = this.game!;
    const fx = g.rt.fx;
    if (this.fxSeen > fx.length) this.fxSeen = 0;
    for (let i = this.fxSeen; i < fx.length; i++) {
      const e = fx[i];
      if (!locVisible(g, e.loc)) continue;
      const [x, y] = this.locXY(e.loc);
      const color = g.s.nations[e.owner]?.color;
      const dur = { hit: 900, boom: 1300, capture: 1800, bomb: 1100, sunk: 1500, built: 1500 }[e.kind];
      if (e.kind === 'capture' && e.owner === g.s.player) this.effects.push({ kind: 'confetti', x, y, t0: now, dur: 2200, seed: Math.random() });
      if (e.kind === 'hit') {
        // one explosion burst and one damage number per place at a time: add up the rest
        const live = this.effects.find((x2) => x2.kind === 'hit' && x2.x === x && x2.y === y && now - x2.t0 < 450);
        if (live) { live.value = (live.value ?? 0) + (e.value ?? 0); continue; }
      }
      if (this.effects.length < 120) this.effects.push({ kind: e.kind, x, y, t0: now + (e.kind === 'hit' ? Math.random() * 120 : 0), dur, value: e.value, color, seed: Math.random() });
    }
    this.fxSeen = fx.length;
  }

  ping(l: Loc) {
    const [x, y] = this.locXY(l);
    this.effects.push({ kind: 'ping', x, y, t0: performance.now(), dur: 900, seed: 0 });
    this.touch();
  }

  // ------------------------------------------------------------ map layers
  private fillKey(i: number): string {
    const g = this.game;
    if (!g) return '#4a5a4a';
    const p = g.s.provinces[i];
    switch (this.layer) {
      case 'terrain':
        return TERRAIN[g.w.provs[i].terrain].color;
      case 'alliances': {
        const bloc = g.blocOf(p.ctrl);
        return bloc ? bloc.color : '#4b5563';
      }
      case 'resources': {
        const m = Math.min(1, p.res / 3);
        return `hsl(${42 - m * 20}, ${35 + m * 50}%, ${20 + m * 40}%)`;
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
    const g = this.game;
    const fog = !!g?.s.settings.fog;
    for (let i = 0; i < this.geo.paths.length; i++) {
      let key = this.fillKey(i);
      if (fog && !g!.rt.visible[i]) {
        // fogged: washed-out, darker version of the same colour
        const st = this.fillStyles.get(key);
        const fk = 'fog:' + key;
        if (!this.fillStyles.has(fk)) this.fillStyles.set(fk, st && typeof st !== 'string' ? { a: fogColor(st.a), b: fogColor(st.b) } : fogColor(key));
        key = fk;
      }
      let p = fills.get(key);
      if (!p) fills.set(key, (p = new Path2D()));
      p.addPath(this.geo.paths[i]);
    }
    this.fills = fills;
  }

  private buildFog() {
    const g = this.game;
    const fog = new Path2D();
    if (g && g.s.settings.fog) for (let i = 0; i < this.geo.paths.length; i++) if (!g.rt.visible[i]) fog.addPath(this.geo.paths[i]);
    this.fog = fog;
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

  private pattern(key: string, ctx: CanvasRenderingContext2D, draw: (x: CanvasRenderingContext2D) => void, size = 12): CanvasPattern {
    let pat = this.patterns.get(key);
    if (pat) return pat;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d')!);
    pat = ctx.createPattern(c, 'repeat')!;
    this.patterns.set(key, pat);
    return pat;
  }

  private stripe(a: string, b: string, ctx: CanvasRenderingContext2D) {
    return this.pattern('s' + a + b, ctx, (x) => {
      x.fillStyle = a;
      x.fillRect(0, 0, 12, 12);
      x.strokeStyle = b;
      x.lineWidth = 4;
      x.beginPath();
      x.moveTo(-3, 15); x.lineTo(15, -3);
      x.moveTo(-3, 3); x.lineTo(3, -3);
      x.moveTo(9, 15); x.lineTo(15, 9);
      x.stroke();
    });
  }

  /** Draw the map in world coordinates; `px` = device pixels per map unit. */
  private drawMap(ctx: CanvasRenderingContext2D, px: number, detail: boolean) {
    if (!this.fills) this.buildFills();
    if (!this.borders) this.buildBorders();
    if (!this.fog) this.buildFog();
    // shallow water glow around every coast
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(96,165,250,0.16)';
    ctx.lineWidth = 9 / px;
    ctx.stroke(this.coast);
    ctx.strokeStyle = 'rgba(147,197,253,0.14)';
    ctx.lineWidth = 4 / px;
    ctx.stroke(this.coast);
    for (const [key, path] of this.fills!) {
      const st = this.fillStyles.get(key);
      ctx.fillStyle = st && typeof st !== 'string' ? this.stripe(st.a, st.b, ctx) : typeof st === 'string' ? st : key;
      ctx.fill(path, 'evenodd');
    }
    const lw = 1 / px;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // fog of war: hatch what we can't see (sharp layer only)
    if (detail && this.game?.s.settings.fog) {
      const hatch = this.pattern('fog', ctx, (x) => {
        x.strokeStyle = 'rgba(255,255,255,0.16)';
        x.lineWidth = 1.5;
        x.beginPath();
        x.moveTo(-2, 12); x.lineTo(12, -2);
        x.moveTo(8, 12); x.lineTo(12, 8);
        x.stroke();
      }, 10);
      hatch.setTransform?.(new DOMMatrix().scale(1 / px)); // keep the hatch at screen resolution
      ctx.fillStyle = hatch;
      ctx.fill(this.fog!, 'evenodd');
    }
    // region borders (faint), coast, country borders (strong), our border (gold)
    if (detail && px > 1.2) {
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = lw * 0.9;
      ctx.stroke(this.provBorders);
    }
    ctx.strokeStyle = 'rgba(190,220,250,0.55)';
    ctx.lineWidth = lw * 1.2;
    ctx.stroke(this.coast);
    if (detail) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = lw * 4;
      ctx.stroke(this.borders!);
    }
    ctx.strokeStyle = 'rgba(12,14,20,0.95)';
    ctx.lineWidth = lw * (detail ? 1.7 : 1.4);
    ctx.stroke(this.borders!);
    if (this.game) {
      if (detail) {
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = lw * 4.2;
        ctx.stroke(this.playerBorder!);
      }
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = lw * 2.4;
      ctx.stroke(this.playerBorder!);
    }
  }

  private renderWorld() {
    const ctx = this.worldCv.getContext('2d', { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, this.worldCv.width, this.worldCv.height);
    ctx.setTransform(WORLD_SCALE, 0, 0, WORLD_SCALE, 0, 0);
    this.drawMap(ctx, WORLD_SCALE, false);
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
    this.drawMap(ctx, s, true);
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
    if (this.airRange.length) {
      ctx.fillStyle = 'rgba(56,189,248,0.16)';
      for (const p of this.airRange) ctx.fill(this.geo.paths[p], 'evenodd');
    }
    if (this.highlight.length) {
      const pulse = 0.25 + 0.12 * Math.sin(now / 250);
      ctx.fillStyle = `rgba(${this.highlightColor},${pulse})`;
      ctx.strokeStyle = `rgba(${this.highlightColor},0.95)`;
      ctx.lineWidth = 2 / k;
      for (const p of this.highlight) {
        ctx.fill(this.geo.paths[p], 'evenodd');
        ctx.stroke(this.geo.paths[p]);
      }
    }
    if (this.selectedProvince >= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill(this.geo.paths[this.selectedProvince], 'evenodd');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5 / k;
      ctx.stroke(this.geo.paths[this.selectedProvince]);
    }
    if (this.drag?.target !== null && this.drag?.target !== undefined && this.drag.target >= 0) {
      ctx.fillStyle = this.drag.hostile ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.3)';
      ctx.strokeStyle = this.drag.hostile ? '#ef4444' : '#4ade80';
      ctx.lineWidth = 3 / k;
      ctx.fill(this.geo.paths[this.drag.target], 'evenodd');
      ctx.stroke(this.geo.paths[this.drag.target]);
    }
    ctx.restore();
    if (!g) return;
    this.drawLabels(ctx);
    if (!this.showUnits) return;
    this.drawBuildings(ctx);
    this.drawCaptures(ctx);
    this.drawPaths(ctx, now);
    this.drawUnits(ctx, now);
    this.drawBattles(ctx, now);
    this.drawEffects(ctx, now);
    this.drawDrag(ctx);
  }

  private computeLabels() {
    const g = this.game!;
    // a coarser grid is plenty for country names and 2.5x cheaper
    const r = this.labelRaster ?? (this.labelRaster = buildRaster(this.geo, 4));
    const label = new Int32Array(r.id.length);
    for (let i = 0; i < r.id.length; i++) {
      const p = r.id[i];
      label[i] = p < 0 ? -1 : g.s.provinces[p].ctrl;
    }
    const pl = poles(r, label, g.N);
    this.nationLabels = [];
    pl.forEach((p: Pole | null, n) => {
      const nat = g.s.nations[n];
      if (!p || !nat.alive || !nat.active) return;
      const name = nat.name.toUpperCase();
      // as big as fits inside the country: limited by its depth and its width
      const size = Math.max(1.5, Math.min(p.r * 1.25, (p.span * 0.9) / (name.length * 0.72 + 0.6), 34));
      this.nationLabels.push({ x: p.x, y: p.y, size, name, idx: n });
    });
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
    const overlaps = (b: [number, number, number, number]) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
    const nationAlpha = k > 5 ? 0.35 : 1;
    try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '1px'; } catch { /* old webview */ }
    for (const l of this.nationLabels) {
      const fs = Math.min(l.size * k, 30);
      if (fs < 8.5) continue;
      const [sx, sy] = this.toScreen(l.x, l.y);
      if (sx < -200 || sy < -40 || sx > this.w + 200 || sy > this.h + 40) continue;
      const tw = l.name.length * fs * 0.72;
      const box: [number, number, number, number] = [sx - tw / 2, sy - fs / 2, sx + tw / 2, sy + fs / 2];
      if (overlaps(box)) continue;
      placed.push(box);
      ctx.globalAlpha = nationAlpha;
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(l.name, sx, sy);
      ctx.fillStyle = l.idx === g.s.player ? '#ffe680' : 'rgba(255,255,255,0.93)';
      ctx.fillText(l.name, sx, sy);
    }
    ctx.globalAlpha = 1;
    try { (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'; } catch { /* old webview */ }
    // region names when zoomed in
    if (k > 2.6) {
      ctx.font = `600 11px system-ui, sans-serif`;
      const geo = this.geo;
      for (let i = 0; i < geo.paths.length; i++) {
        const b = i * 4;
        if ((geo.bbox[b + 2] - geo.bbox[b]) * k < 60) continue;
        const [sx, sy] = this.toScreen(geo.center[i * 2], geo.center[i * 2 + 1]);
        if (sx < -50 || sy < -30 || sx > this.w + 50 || sy > this.h + 30) continue;
        const cap = g.s.nations[g.s.provinces[i].owner]?.capital === i;
        const name = (cap ? '★ ' : '') + g.w.provs[i].name;
        const tw = name.length * 6;
        const box: [number, number, number, number] = [sx - tw / 2, sy - 34, sx + tw / 2, sy - 22];
        if (overlaps(box)) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.strokeText(name, sx, sy - 28);
        ctx.fillStyle = cap ? '#ffe680' : 'rgba(255,255,255,0.88)';
        ctx.fillText(name, sx, sy - 28);
      }
    } else if (k > 1.4) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#ffd34d';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      for (const n of g.s.nations) {
        if (!n.alive || n.capital < 0) continue;
        const [sx, sy] = this.toScreen(this.geo.center[n.capital * 2], this.geo.center[n.capital * 2 + 1]);
        if (sx < 0 || sy < 0 || sx > this.w || sy > this.h) continue;
        ctx.strokeText('★', sx, sy - 22);
        ctx.fillText('★', sx, sy - 22);
      }
    }
  }

  /** Building icons under each region when zoomed in (our own, or enemy ones we can see). */
  private drawBuildings(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    const k = this.view.k;
    if (k < 3.4) return;
    const me = g.s.player;
    for (let i = 0; i < g.s.provinces.length; i++) {
      const p = g.s.provinces[i];
      if (p.ctrl !== me && !g.rt.visible[i]) continue;
      const bb = i * 4;
      if ((this.geo.bbox[bb + 2] - this.geo.bbox[bb]) * k < 90) continue;
      const list = BUILDING_TYPES.filter((t) => (p.b[t] ?? 0) > 0);
      if (!list.length && !p.build) continue;
      const [sx, sy] = this.toScreen(this.geo.center[i * 2], this.geo.center[i * 2 + 1]);
      if (sx < -80 || sy < -40 || sx > this.w + 80 || sy > this.h + 40) continue;
      const n = list.length + (p.build ? 1 : 0);
      const step = 17;
      let x = sx - ((n - 1) * step) / 2;
      const y = sy + 33;
      ctx.fillStyle = 'rgba(10,15,25,0.72)';
      ctx.beginPath();
      roundRect(ctx, x - 10, y - 9, (n - 1) * step + 20, 18, 9);
      ctx.fill();
      for (const t of list) {
        ctx.drawImage(this.emoji(BUILDINGS[t].icon, 13), x - 7, y - 7, 14, 14);
        const lvl = p.b[t] ?? 0;
        if (BUILDINGS[t].max > 1 && lvl > 1) {
          ctx.font = '700 8px system-ui';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(String(lvl), x + 6, y + 6);
        }
        x += step;
      }
      if (p.build) {
        const prog = 1 - p.build.days / p.build.total;
        ctx.drawImage(this.emoji('🔨', 13), x - 7, y - 7, 14, 14);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 9, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawCaptures(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    for (let i = 0; i < g.s.provinces.length; i++) {
      const p = g.s.provinces[i];
      if (p.cap <= 0 || p.capBy < 0 || !g.rt.visible[i]) continue;
      const [sx, sy] = this.toScreen(this.geo.center[i * 2], this.geo.center[i * 2 + 1]);
      if (sx < -40 || sy < -40 || sx > this.w + 40 || sy > this.h + 40) continue;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(sx, sy, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = g.s.nations[p.capBy].color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, 22, -Math.PI / 2, -Math.PI / 2 + Math.min(1, p.cap) * Math.PI * 2);
      ctx.stroke();
      ctx.drawImage(this.emoji('🚩', 12), sx + 14, sy - 30, 13, 13);
    }
  }

  private drawPaths(ctx: CanvasRenderingContext2D, now: number) {
    const g = this.game!;
    const me = g.s.player;
    const k = this.view.k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const done = new Set<string>();
    for (const u of g.s.units) {
      if (u.owner !== me) continue;
      const sel = this.selectedUnits.has(u.id);
      const air = UNITS[u.type].domain === 'air';
      if (air) {
        if (u.target >= 0 && (sel || k > 1.3)) this.drawAirMission(ctx, u, now, sel);
        continue;
      }
      if (!u.path.length || (!sel && k < 1.3)) continue;
      const key = u.loc + '>' + u.path.join(',') + (sel ? 's' : '');
      if (done.has(key)) continue;
      done.add(key);
      const pts = [this.unitXY(u), ...u.path.map((l) => this.locXY(l))].map(([x, y]) => this.toScreen(x, y));
      const last = u.path[u.path.length - 1];
      const hostile = last >= 0 && g.atWar(me, g.s.provinces[last].ctrl);
      const color = hostile ? '239,68,68' : sel ? '74,222,128' : '255,255,255';
      ctx.strokeStyle = `rgba(0,0,0,${sel ? 0.5 : 0.3})`;
      ctx.lineWidth = sel ? 7 : 4;
      this.polyline(ctx, pts);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${color},${sel ? 0.95 : 0.55})`;
      ctx.lineWidth = sel ? 4 : 2;
      ctx.setLineDash(sel ? [10, 7] : [6, 6]);
      ctx.lineDashOffset = -now / 40;
      this.polyline(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
      const [ex, ey] = pts[pts.length - 1];
      const [px, py] = pts[pts.length - 2];
      ctx.fillStyle = `rgba(${color},${sel ? 1 : 0.7})`;
      arrowHead(ctx, px, py, ex, ey, sel ? 14 : 9);
      if (sel) {
        const h = etaHours(g, u);
        const label = h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`;
        this.pill(ctx, ex, ey + 16, (hostile ? '⚔ ' : '') + label, hostile ? '#7f1d1d' : '#14532d');
      }
    }
    if (this.previewPath.length > 1) {
      ctx.strokeStyle = 'rgba(250,204,21,0.9)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 3;
      this.polyline(ctx, this.previewPath.map((l) => this.toScreen(...this.locXY(l))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawAirMission(ctx: CanvasRenderingContext2D, u: Unit, now: number, sel: boolean) {
    const g = this.game!;
    const [bx, by] = this.toScreen(...this.locXY(u.base));
    const [tx, ty] = this.toScreen(...this.locXY(u.target));
    const d = Math.hypot(tx - bx, ty - by);
    if (d < 6) return;
    const bomb = u.type === 'bomber';
    const cx = (bx + tx) / 2, cy = (by + ty) / 2 - d * 0.25;
    ctx.strokeStyle = bomb ? `rgba(248,113,113,${sel ? 0.95 : 0.6})` : `rgba(125,211,252,${sel ? 0.95 : 0.6})`;
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -now / 50;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(cx, cy, tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    // a plane circling over the target
    const a = now / 700 + u.id;
    const r = 14;
    const px = tx + Math.cos(a) * r, py = ty + Math.sin(a) * r * 0.6;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + Math.PI);
    ctx.scale(0.55, 0.55);
    ctx.fillStyle = bomb ? '#fecaca' : '#e0f2fe';
    drawIcon(ctx, u.type, 0, 0);
    ctx.restore();
    void g;
  }

  private polyline(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  }

  private pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string) {
    ctx.font = '700 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = bg;
    ctx.beginPath();
    roundRect(ctx, x - w / 2, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  private drawUnits(ctx: CanvasRenderingContext2D, now: number) {
    const g = this.game!;
    const me = g.s.player;
    const k = this.view.k;
    type Stack = { wx: number; wy: number; units: Unit[]; owner: number; loc: Loc; moving: boolean; air: boolean };
    const stacks = new Map<string, Stack>();
    const vx0 = this.view.x - 40 / k, vy0 = this.view.y - 40 / k, vx1 = this.view.x + (this.w + 40) / k, vy1 = this.view.y + (this.h + 40) / k;
    for (const u of g.s.units) {
      const mine = u.owner === me;
      const air = UNITS[u.type].domain === 'air';
      if (!mine && air) continue;
      if (!mine && k < 1.2 && !g.atWar(me, u.owner)) continue;
      if (!unitVisible(g, u.owner, u.loc)) continue;
      const moving = !air && u.path.length > 0 && u.progress > 0;
      const [wx, wy] = moving ? this.unitXY(u) : this.locXY(air ? u.base : u.loc);
      if (wx < vx0 || wy < vy0 || wx > vx1 || wy > vy1) continue;
      const key = (moving ? u.loc + '>' + u.path[0] : String(air ? u.base : u.loc)) + ':' + u.owner + (air ? 'a' : '');
      let st = stacks.get(key);
      if (!st) stacks.set(key, (st = { wx: 0, wy: 0, units: [], owner: u.owner, loc: air ? u.base : u.loc, moving, air }));
      st.wx += wx;
      st.wy += wy;
      st.units.push(u);
    }
    // several owners in one region sit side by side
    const perLoc = new Map<string, number>();
    const list = [...stacks.values()].sort((a, b) => (a.owner === me ? 1 : 0) - (b.owner === me ? 1 : 0));
    for (const st of list) {
      st.wx /= st.units.length;
      st.wy /= st.units.length;
      let [sx, sy] = this.toScreen(st.wx, st.wy);
      if (st.air) { sx += 20; sy -= 14; }
      else if (!st.moving) {
        const lk = String(st.loc);
        const n = perLoc.get(lk) || 0;
        perLoc.set(lk, n + 1);
        if (n) sx += n % 2 ? 30 * Math.ceil(n / 2) : -30 * Math.ceil(n / 2);
      }
      this.drawStack(ctx, sx, sy, st.units, st.owner, st.loc, st.air, now);
    }
  }

  private drawStack(ctx: CanvasRenderingContext2D, x: number, y: number, units: Unit[], owner: number, loc: Loc, air: boolean, now: number) {
    const g = this.game!;
    const me = g.s.player;
    const sel = units.some((u) => this.selectedUnits.has(u.id));
    const counts = new Map<UnitType, number>();
    for (const u of units) counts.set(u.type, (counts.get(u.type) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || UNITS[b[0]].cost - UNITS[a[0]].cost)[0][0];
    const ring = owner === me ? 'me' : g.atWar(me, owner) ? 'enemy' : g.allied(me, owner) ? 'ally' : 'other';
    const R = air ? 11 : Math.max(12, Math.min(16, 12 + this.view.k));
    if (sel) {
      const pulse = 1 + 0.12 * Math.sin(now / 180);
      ctx.fillStyle = 'rgba(74,222,128,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, (R + 7) * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    const sp = this.counter(top, g.s.nations[owner].color, sel ? 'sel' : ring, R);
    ctx.drawImage(sp, x - sp.width / this.dpr / 2, y - sp.height / this.dpr / 2, sp.width / this.dpr, sp.height / this.dpr);
    // health bar under the counter
    const hp = units.reduce((a, u) => a + u.hp, 0) / units.length / 100;
    const bw = R * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - bw / 2 - 1, y + R + 2, bw + 2, 5);
    ctx.fillStyle = hp > 0.6 ? '#4ade80' : hp > 0.3 ? '#facc15' : '#f87171';
    ctx.fillRect(x - bw / 2, y + R + 3, bw * Math.max(0.04, hp), 3);
    // unit count
    const n = units.length;
    if (n > 1) {
      ctx.font = '800 10px system-ui, sans-serif';
      const label = String(n);
      const w = Math.max(15, label.length * 6 + 8);
      ctx.fillStyle = '#0b1220';
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      roundRect(ctx, x + R - 7, y - R - 6, w, 14, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + R - 7 + w / 2, y - R + 1.5);
    }
    this.badges.push({ x, y, r: R + 8, units: units.map((u) => u.id), loc, owner });
  }

  /** Pre-rendered counter: round badge in the nation's colour with a white unit icon. */
  private counter(type: UnitType, color: string, ring: 'sel' | 'me' | 'enemy' | 'ally' | 'other', R: number) {
    const key = type + color + ring + R + this.dpr;
    let c = this.sprites.get(key);
    if (c) return c;
    const s = this.dpr;
    const size = Math.ceil((R * 2 + 10) * s);
    c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d')!;
    x.scale(s, s);
    const m = size / s / 2;
    const r = R * 0.38;
    const tok = () => { x.beginPath(); roundRect(x, m - R, m - R, R * 2, R * 2, r); };
    // drop shadow
    x.save();
    x.translate(0, 2);
    x.fillStyle = 'rgba(0,0,0,0.45)';
    tok();
    x.fill();
    x.restore();
    // body: nation colour, lit from the top
    const grad = x.createLinearGradient(0, m - R, 0, m + R);
    grad.addColorStop(0, shade(color, 0.32));
    grad.addColorStop(0.55, color);
    grad.addColorStop(1, shade(color, -0.35));
    x.fillStyle = grad;
    tok();
    x.fill();
    // glossy highlight
    x.save();
    tok();
    x.clip();
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.beginPath();
    x.ellipse(m, m - R * 0.75, R * 1.1, R * 0.55, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
    // ownership rim
    x.lineWidth = ring === 'other' ? 1.5 : 3;
    x.strokeStyle = ring === 'sel' ? '#4ade80' : ring === 'me' ? '#ffd34d' : ring === 'enemy' ? '#ef4444' : ring === 'ally' ? '#7dd3fc' : 'rgba(0,0,0,0.85)';
    tok();
    x.stroke();
    if (ring === 'enemy') {
      x.lineWidth = 1;
      x.beginPath();
      roundRect(x, m - R - 2.5, m - R - 2.5, R * 2 + 5, R * 2 + 5, r + 2);
      x.stroke();
    }
    // icon with a dark outline so it reads on any colour
    x.save();
    x.translate(m, m + 0.5);
    x.scale(R / 14, R / 14);
    x.fillStyle = 'rgba(0,0,0,0.55)';
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1.4]]) drawIcon(x, type, ox, oy);
    x.fillStyle = '#ffffff';
    drawIcon(x, type, 0, 0, color);
    x.restore();
    this.sprites.set(key, c);
    return c;
  }

  private emoji(ch: string, size: number) {
    const key = 'e' + ch + size + this.dpr;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const px = Math.ceil(size * 1.3 * this.dpr);
    c.width = c.height = px;
    const x = c.getContext('2d')!;
    x.font = `${size * this.dpr}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(ch, px / 2, px / 2 + this.dpr);
    this.sprites.set(key, c);
    return c;
  }

  /** Battles: crossed swords and a tug-of-war bar showing who is winning. */
  private drawBattles(ctx: CanvasRenderingContext2D, now: number) {
    const g = this.game!;
    for (const b of g.s.battles) {
      if (!g.rt.visible[b.loc]) continue;
      const [sx, sy] = this.toScreen(...this.locXY(b.loc));
      if (sx < -60 || sy < -60 || sx > this.w + 60 || sy > this.h + 60) continue;
      const y = sy - 44;
      const W = 64, H = 8;
      const odds = Math.max(0.04, Math.min(0.96, b.odds));
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      roundRect(ctx, sx - W / 2 - 2, y - H / 2 - 2, W + 4, H + 4, 6);
      ctx.fill();
      ctx.fillStyle = g.s.nations[b.att].color;
      ctx.fillRect(sx - W / 2, y - H / 2, W * odds, H);
      ctx.fillStyle = g.s.nations[b.def].color;
      ctx.fillRect(sx - W / 2 + W * odds, y - H / 2, W * (1 - odds), H);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx - W / 2 + W * odds - 1, y - H / 2 - 2, 2, H + 4);
      // swords badge
      const pulse = 1 + 0.15 * Math.sin(now / 160);
      ctx.fillStyle = 'rgba(185,28,28,0.95)';
      ctx.beginPath();
      ctx.arc(sx, y - 15, 11 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      swords(ctx, sx, y - 15, 6.5);
      // ambient explosions
      const t = now / 1000;
      for (let i = 0; i < 2; i++) {
        const ph = (t * (1.3 + i * 0.4) + b.loc * 0.37 + i * 0.5) % 1;
        const ox = Math.sin(b.loc * 12.9 + Math.floor(t * (1.3 + i * 0.4) + i) * 78.2) * 16;
        const oy = Math.cos(b.loc * 4.1 + Math.floor(t * (1.3 + i * 0.4) + i) * 37.7) * 10;
        this.explosion(ctx, sx + ox, sy + oy, ph, 9);
      }
    }
  }

  private explosion(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, size: number) {
    if (t < 0 || t > 1) return;
    const r = size * (0.4 + t);
    const a = 1 - t;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,250,210,${a})`);
    grad.addColorStop(0.35, `rgba(255,170,40,${a * 0.9})`);
    grad.addColorStop(0.75, `rgba(220,60,20,${a * 0.6})`);
    grad.addColorStop(1, 'rgba(80,20,10,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (t > 0.3) {
      ctx.fillStyle = `rgba(60,60,60,${(1 - t) * 0.5})`;
      ctx.beginPath();
      ctx.arc(x + 2, y - r * 0.6, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, now: number) {
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of this.effects) {
      const t = (now - e.t0) / e.dur;
      if (t < 0) continue;
      const [sx, sy] = this.toScreen(e.x, e.y);
      if (sx < -150 || sy < -150 || sx > this.w + 150 || sy > this.h + 150) continue;
      switch (e.kind) {
        case 'hit': {
          const ox = (e.seed - 0.5) * 30, oy = ((e.seed * 7) % 1 - 0.5) * 16;
          this.explosion(ctx, sx + ox, sy + oy, t * 1.4, 11);
          this.explosion(ctx, sx - ox * 0.6, sy - oy + 4, t * 1.6 - 0.15, 8);
          if (e.value && e.value >= 1) {
            ctx.globalAlpha = Math.min(1, 2 * (1 - t));
            ctx.font = '800 13px system-ui, sans-serif';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.strokeText('−' + Math.round(e.value), sx + 16, sy - 20 - t * 22);
            ctx.fillStyle = '#fca5a5';
            ctx.fillText('−' + Math.round(e.value), sx + 16, sy - 20 - t * 22);
            ctx.globalAlpha = 1;
          }
          break;
        }
        case 'boom':
          this.explosion(ctx, sx, sy, t, 24);
          this.explosion(ctx, sx + 10, sy - 6, t * 1.3 - 0.1, 14);
          this.explosion(ctx, sx - 9, sy + 5, t * 1.3 - 0.2, 14);
          break;
        case 'bomb':
          for (let i = 0; i < 3; i++) this.explosion(ctx, sx - 14 + i * 14, sy + (i % 2) * 6, t * 1.8 - i * 0.25, 10);
          break;
        case 'sunk':
          ctx.strokeStyle = `rgba(186,230,253,${1 - t})`;
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(sx, sy, 6 + t * 30 + i * 7, 0, Math.PI * 2);
            ctx.stroke();
          }
          this.explosion(ctx, sx, sy, t * 1.5, 16);
          break;
        case 'capture': {
          const c = e.color ?? '#fff';
          ctx.strokeStyle = c;
          ctx.globalAlpha = 1 - t;
          ctx.lineWidth = 5 * (1 - t) + 1;
          ctx.beginPath();
          ctx.arc(sx, sy, 10 + t * 70, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = '800 15px system-ui, sans-serif';
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText('🚩 Captured!', sx, sy - 30 - t * 20);
          ctx.fillStyle = '#fff';
          ctx.fillText('🚩 Captured!', sx, sy - 30 - t * 20);
          ctx.globalAlpha = 1;
          break;
        }
        case 'built':
          ctx.globalAlpha = 1 - t;
          ctx.font = '800 13px system-ui, sans-serif';
          ctx.fillStyle = '#86efac';
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = 3;
          ctx.strokeText('✔ Built', sx, sy + 46 - t * 18);
          ctx.fillText('✔ Built', sx, sy + 46 - t * 18);
          ctx.globalAlpha = 1;
          break;
        case 'confetti': {
          // a burst of colourful paper for our victories
          const cols = ['#facc15', '#f87171', '#60a5fa', '#4ade80', '#f472b6', '#fff'];
          for (let i = 0; i < 26; i++) {
            const a = (i / 26) * Math.PI * 2 + e.seed * 6;
            const v = 50 + ((i * 37) % 23) * 3;
            const px = sx + Math.cos(a) * v * t;
            const py = sy - 20 + Math.sin(a) * v * t * 0.8 + 90 * t * t;
            ctx.globalAlpha = Math.max(0, 1 - t);
            ctx.fillStyle = cols[i % cols.length];
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(a + t * 8);
            ctx.fillRect(-3, -1.5, 6, 3);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'ping':
          ctx.strokeStyle = `rgba(250,204,21,${1 - t})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(sx, sy, 8 + t * 34, 0, Math.PI * 2);
          ctx.stroke();
          break;
      }
    }
  }

  private drawDrag(ctx: CanvasRenderingContext2D) {
    const d = this.drag;
    if (!d) return;
    const color = d.target === null ? '255,255,255' : d.hostile ? '239,68,68' : '74,222,128';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(d.x0, d.y0);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${color},0.95)`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(d.x0, d.y0);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
    ctx.fillStyle = `rgba(${color},1)`;
    arrowHead(ctx, d.x0, d.y0, d.x, d.y, 18);
    if (d.target !== null) this.pill(ctx, d.x, d.y - 34, d.hostile ? '⚔ Attack' : '➜ Move here', d.hostile ? '#991b1b' : '#166534');
  }

  /** Our unit stack (or any stack) under a screen point. */
  badgeAt(sx: number, sy: number, owner?: number): BadgeHit | null {
    let best: BadgeHit | null = null, bd = Infinity;
    for (const b of this.badges) {
      if (owner !== undefined && b.owner !== owner) continue;
      const d = Math.hypot(b.x - sx, b.y - sy);
      if (d < b.r && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  setMapVisible(v: boolean) {
    this.mapVisible = v;
    this.worldCv.style.display = v ? '' : 'none';
    this.baseCv.style.display = v ? '' : 'none';
    if (v) { this.overlayDirty = true; this.cssView = null; }
  }
}

/** Lighten (amt > 0) or darken a hex colour. */
/** Washed-out, darker version of a colour for regions hidden by fog of war. */
function fogColor(c: string) {
  let r = 70, g = 80, b = 90;
  if (c.startsWith('#') && c.length === 7) {
    const n = parseInt(c.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = c.match(/\d+(\.\d+)?/g);
    if (c.startsWith('hsl') && m) {
      const [h, sat, l] = m.map(Number);
      const a = (sat / 100) * Math.min(l / 100, 1 - l / 100);
      const f = (k0: number) => { const k = (k0 + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      r = f(0); g = f(8); b = f(4);
    }
  }
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (v: number) => Math.round((v * 0.35 + grey * 0.65) * 0.62 + 12);
  return `rgb(${mix(r)},${mix(g)},${mix(b) + 6})`;
}

/** Two crossed swords. */
function swords(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    ctx.save();
    ctx.rotate(a);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.1);
    ctx.lineTo(0, s * 0.7);
    ctx.stroke();
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, s * 0.55);
    ctx.lineTo(s * 0.45, s * 0.55);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt));
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
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
  ctx.beginPath();
  ctx.moveTo(x2 + Math.cos(a) * 2, y2 + Math.sin(a) * 2);
  ctx.lineTo(x2 - size * Math.cos(a - 0.5), y2 - size * Math.sin(a - 0.5));
  ctx.lineTo(x2 - size * Math.cos(a + 0.5), y2 - size * Math.sin(a + 0.5));
  ctx.closePath();
  ctx.fill();
}

/** Unit pictograms (filled with the current fillStyle), centred on (x, y), about 22 px wide. */
export function drawIcon(ctx: CanvasRenderingContext2D, type: UnitType, x: number, y: number, hole?: string) {
  ctx.save();
  ctx.translate(x, y);
  const P = (pts: number[]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fill();
  };
  const C = (cx: number, cy: number, r: number) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); };
  const R = (rx: number, ry: number, w: number, h: number, rr = 0) => { ctx.beginPath(); roundRect(ctx, rx, ry, w, h, rr); ctx.fill(); };
  // details punched out of the shape (wheels...) are painted in the background colour
  const holes = (f: () => void) => {
    if (!hole) return;
    ctx.save();
    ctx.fillStyle = hole;
    f();
    ctx.restore();
  };
  switch (type) {
    case 'infantry': // soldier: helmet, head, shoulders and a rifle
      ctx.beginPath();
      ctx.ellipse(0, -5.2, 6.4, 4.6, 0, Math.PI, 0);
      ctx.fill();
      R(-7.6, -5.6, 15.2, 1.8, 0.9);
      C(0, -2.2, 3.3);
      ctx.beginPath();
      ctx.moveTo(-8, 10);
      ctx.quadraticCurveTo(-7.5, 2.5, 0, 2);
      ctx.quadraticCurveTo(7.5, 2.5, 8, 10);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.rotate(-0.55);
      R(1, -11, 1.8, 15, 0.6);
      ctx.restore();
      break;
    case 'tank': // side view: tracks, hull, turret, gun
      R(-11, 2.5, 22, 6.5, 3.25);
      P([-10, 2.8, -7, -1.5, 8.5, -1.5, 10.5, 2.8]);
      R(-5.5, -6, 10, 5, 2.2);
      R(3.5, -4.8, 9.5, 2, 1);
      holes(() => { for (const wx of [-7, -2.4, 2.2, 6.8]) C(wx, 5.75, 1.6); });
      break;
    case 'artillery': // big gun on wheels
      ctx.save();
      ctx.translate(-2, 2);
      ctx.rotate(-0.55);
      R(-2, -2.1, 15, 4.2, 1.5);
      R(11, -2.6, 2.5, 5.2, 0.8);
      ctx.restore();
      P([-1, 2, -11, 8.5, -10, 10, 1, 4.5]);
      C(-1.5, 5.5, 4.4);
      holes(() => C(-1.5, 5.5, 1.6));
      break;
    case 'antiair': // truck with twin barrels aimed at the sky
      R(-11, 3, 22, 4.5, 1.5);
      C(-6.5, 8.5, 2.3);
      C(6.5, 8.5, 2.3);
      ctx.beginPath();
      ctx.arc(-1, 3, 4.8, Math.PI, 0);
      ctx.fill();
      ctx.save();
      ctx.translate(-1, 0.5);
      ctx.rotate(-0.95);
      R(0, -3.4, 13, 1.9, 0.9);
      R(0, 0.6, 13, 1.9, 0.9);
      ctx.restore();
      break;
    case 'fighter': // swept-wing jet, nose up
      P([0, -12, 2.2, -5, 2.4, -1.5, 11, 4.5, 11, 6.5, 2.4, 4, 2.2, 7.5, 5.5, 10.5, 5.5, 11.8, 0, 10.3, -5.5, 11.8, -5.5, 10.5, -2.2, 7.5, -2.4, 4, -11, 6.5, -11, 4.5, -2.4, -1.5, -2.2, -5]);
      break;
    case 'bomber': // long straight wings with engines
      P([0, -11, 1.9, -7, 1.9, -2.5, 12.5, 0.5, 12.5, 3.3, 1.9, 2.3, 1.9, 7.5, 6, 10, 6, 11.5, 0, 10.2, -6, 11.5, -6, 10, -1.9, 7.5, -1.9, 2.3, -12.5, 3.3, -12.5, 0.5, -1.9, -2.5, -1.9, -7]);
      for (const ex of [-7.5, -4.2, 4.2, 7.5]) R(ex - 0.9, -2.6, 1.8, 4, 0.9);
      break;
    case 'warship': // destroyer side view
      P([-12.5, 2.5, 12.5, 2.5, 9.5, 8, -9.5, 8]);
      R(-6, -2.5, 9, 5.2, 1);
      R(-3.5, -6.5, 4.5, 4.2, 0.8);
      R(-1.9, -11, 1.4, 5, 0.5);
      R(3, -1.2, 8.5, 1.6, 0.8);
      R(-11, 0, 4.5, 1.4, 0.7);
      break;
    case 'carrier': // flat-top with an island
      P([-13.5, -0.5, 13.5, -0.5, 13.5, 2.5, 10, 8.5, -10, 8.5, -13.5, 2.5]);
      R(5.5, -7.5, 4, 7, 0.8);
      R(6.8, -10.5, 1.3, 3.5, 0.5);
      holes(() => R(-11, 0.6, 14, 0.9));
      break;
  }
  ctx.restore();
}
