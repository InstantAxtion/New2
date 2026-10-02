// Canvas map renderer: political/thematic layers, borders, labels, units, battles, effects.
import { TERRAIN, UNITS } from '../data/units';
import type { Game } from '../sim/ctx';
import { edgeLen } from '../sim/military';
import type { Loc, Unit } from '../sim/types';
import { RESOURCES } from '../sim/types';
import { unitVisible } from '../sim/visibility';
import { W_HEAT, W_MONSOON, W_RAIN, W_SNOW, W_STORM } from '../sim/weather';
import type { MapGeo } from './geo';

export type Layer = 'political' | 'terrain' | 'resources' | 'supply' | 'unrest' | 'alliances' | 'weather';
export interface View { x: number; y: number; k: number }

export interface BadgeHit {
  x: number;
  y: number;
  r: number;
  units: number[];
  loc: Loc;
}

const RES_COLORS: Record<string, string> = { oil: '#1f2937', gas: '#f97316', steel: '#94a3b8', rare: '#a855f7', uranium: '#84cc16', food: '#eab308', electronics: '#06b6d4' };

export class MapRenderer {
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
  private base: HTMLCanvasElement;
  private baseView: View | null = null;
  private baseDirty = true;
  private dirty = true;
  private lastViewChange = 0;
  private borders: Path2D | null = null;
  private coast: Path2D;
  private patterns = new Map<string, CanvasPattern>();
  private prevRad: Float32Array | null = null;
  private nationLabels: { x: number; y: number; size: number; name: string; idx: number }[] = [];
  private labelsDirty = true;
  lowDetail = false;
  showUnits = true;

  constructor(public canvas: HTMLCanvasElement, public geo: MapGeo) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.base = document.createElement('canvas');
    this.coast = new Path2D();
    for (let a = 0; a < geo.arcs.length; a++) {
      if (geo.arcProvs[a * 2 + 1] >= 0) continue;
      this.addArc(this.coast, a);
    }
  }

  private addArc(path: Path2D, a: number) {
    const arc = this.geo.arcs[a];
    path.moveTo(arc[0], arc[1]);
    for (let k = 2; k < arc.length; k += 2) path.lineTo(arc[k], arc[k + 1]);
  }

  setGame(g: Game | null) {
    this.game = g;
    this.borders = null;
    this.labelsDirty = true;
    this.prevRad = null;
    this.invalidate();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.lowDetail ? 1.5 : 2.5);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.clampView();
    this.invalidate();
  }

  // ------------------------------------------------------------ view
  minK() {
    return Math.max(this.w / this.geo.width, this.h / this.geo.height) * 0.9;
  }
  clampView() {
    const k = (this.view.k = Math.max(this.minK(), Math.min(60, this.view.k)));
    const vw = this.w / k, vh = this.h / k;
    const padX = vw * 0.3, padY = vh * 0.3;
    this.view.x = Math.max(-padX, Math.min(this.geo.width - vw + padX, this.view.x));
    this.view.y = Math.max(-padY + 40, Math.min(this.geo.height - vh + padY - 60, this.view.y));
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
    this.centerOn(this.geo.width / 2, this.geo.height / 2 - 20);
  }
  private viewChanged() {
    this.lastViewChange = performance.now();
    this.dirty = true;
  }
  /** Data changed: redraw everything. */
  invalidate() {
    this.baseDirty = true;
    this.dirty = true;
  }
  /** Overlay-only change (units, selection). */
  touch() {
    this.dirty = true;
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
  /** Draw a frame if needed. Returns true if something was drawn. */
  frame(now: number): boolean {
    const g = this.game;
    if (g) {
      if (g.rt.dirtyOwners) {
        g.rt.dirtyOwners = false;
        this.borders = null;
        this.labelsDirty = true;
        this.baseDirty = true;
        this.dirty = true;
        this.detectEffects(now);
      }
      if (g.rt.dirtyUnits) {
        g.rt.dirtyUnits = false;
        this.dirty = true;
      }
    }
    const animating = this.effects.length > 0 || (g ? g.rt.battles.size > 0 : false);
    const idle = now - this.lastViewChange > 140;
    if (this.baseView && idle && (this.baseView.k !== this.view.k || this.baseView.x !== this.view.x || this.baseView.y !== this.view.y)) this.baseDirty = true;
    if (!this.dirty && !animating && !(this.baseDirty && idle)) return false;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.baseDirty && (idle || !this.baseView)) {
      this.renderBase();
      this.baseDirty = false;
    }
    // blit cached base with relative transform
    ctx.fillStyle = '#0b1a2e';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.baseView) {
      const s = this.view.k / this.baseView.k;
      const dx = (this.baseView.x - this.view.x) * this.view.k * this.dpr;
      const dy = (this.baseView.y - this.view.y) * this.view.k * this.dpr;
      ctx.drawImage(this.base, dx, dy, this.base.width * s, this.base.height * s);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderOverlay(now);
    this.dirty = false;
    return true;
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

  // ------------------------------------------------------------ base layer
  private provinceFill(i: number): string | CanvasPattern {
    const g = this.game;
    if (!g) return '#3a4a5c';
    const p = g.s.provinces[i];
    const owner = g.s.nations[p.owner];
    const ctrl = g.s.nations[p.ctrl];
    switch (this.layer) {
      case 'terrain':
        return TERRAIN[g.w.provs[i].terrain].color;
      case 'supply': {
        if (!(p.ctrl === g.s.player || g.friendly(g.s.player, p.ctrl))) return '#3d4552';
        const v = g.rt.supply[i];
        return `hsl(${Math.round(v * 120)}, 60%, ${35 + v * 15}%)`;
      }
      case 'unrest': {
        const v = Math.min(1, p.unrest / 80 + p.rebels / 200);
        return `hsl(${Math.round(120 - v * 120)}, 55%, ${30 + v * 18}%)`;
      }
      case 'alliances': {
        const bloc = g.blocOf(p.ctrl);
        if (bloc) return bloc.color;
        const ov = g.s.vassal[p.ctrl];
        if (ov !== undefined) return g.blocOf(ov)?.color ?? '#6b7280';
        return '#4b5563';
      }
      case 'resources': {
        let best = '', bv = 0;
        for (const r of RESOURCES) {
          const v = p.dep[r] / RES_AVG[r];
          if (v > bv) { bv = v; best = r; }
        }
        if (bv < 1.5) return '#4b5563';
        return RES_COLORS[best];
      }
      case 'weather':
      case 'political':
      default: {
        if (!owner?.active) return '#2f3640';
        if (p.ctrl !== p.owner && ctrl) return this.stripe(owner.color, ctrl.color);
        return owner.color;
      }
    }
  }

  private stripe(a: string, b: string): CanvasPattern {
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
    pat = this.ctx.createPattern(c, 'repeat')!;
    this.patterns.set(key, pat);
    return pat;
  }

  private buildBorders() {
    const g = this.game;
    const path = new Path2D();
    if (g) {
      const ap = this.geo.arcProvs;
      for (let a = 0; a < this.geo.arcs.length; a++) {
        const p1 = ap[a * 2], p2 = ap[a * 2 + 1];
        if (p1 < 0 || p2 < 0) continue;
        if (g.s.provinces[p1].ctrl !== g.s.provinces[p2].ctrl) this.addArc(path, a);
      }
    }
    this.borders = path;
  }

  private renderBase() {
    const g = this.game;
    const bctx = this.base.getContext('2d')!;
    const { k, x, y } = this.view;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    // ocean
    const grad = bctx.createLinearGradient(0, 0, 0, this.base.height);
    grad.addColorStop(0, '#0d2340');
    grad.addColorStop(1, '#0a1a30');
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, this.base.width, this.base.height);
    const s = k * this.dpr;
    bctx.setTransform(s, 0, 0, s, -x * s, -y * s);
    const vx0 = x, vy0 = y, vx1 = x + this.w / k, vy1 = y + this.h / k;
    const geo = this.geo;
    const P = geo.paths.length;
    for (let i = 0; i < P; i++) {
      const b = i * 4;
      if (geo.bbox[b + 2] < vx0 || geo.bbox[b] > vx1 || geo.bbox[b + 3] < vy0 || geo.bbox[b + 1] > vy1) continue;
      bctx.fillStyle = this.provinceFill(i);
      bctx.fill(geo.paths[i], 'evenodd');
    }
    // weather tint
    if (g && this.layer === 'weather') {
      const wcol: Record<number, string> = { [W_RAIN]: 'rgba(59,130,246,0.45)', [W_SNOW]: 'rgba(241,245,249,0.7)', [W_MONSOON]: 'rgba(20,184,166,0.55)', [W_STORM]: 'rgba(147,51,234,0.6)', [W_HEAT]: 'rgba(249,115,22,0.5)' };
      for (let i = 0; i < P; i++) {
        const c = wcol[g.rt.weather[i]];
        if (!c) continue;
        bctx.fillStyle = c;
        bctx.fill(geo.paths[i], 'evenodd');
      }
    }
    // fog of war tint for provinces we cannot see
    if (g && g.s.settings.fog && this.layer === 'political') {
      bctx.fillStyle = 'rgba(5,10,20,0.28)';
      for (let i = 0; i < P; i++) if (!g.rt.visible[i]) bctx.fill(geo.paths[i], 'evenodd');
    }
    // province borders (thin)
    const lw = 1 / s;
    if (k > 0.8) {
      bctx.strokeStyle = 'rgba(0,0,0,0.25)';
      bctx.lineWidth = lw * 0.8;
      for (let i = 0; i < P; i++) {
        const b = i * 4;
        if (geo.bbox[b + 2] < vx0 || geo.bbox[b] > vx1 || geo.bbox[b + 3] < vy0 || geo.bbox[b + 1] > vy1) continue;
        bctx.stroke(geo.paths[i]);
      }
    }
    // national borders
    if (!this.borders) this.buildBorders();
    bctx.strokeStyle = 'rgba(15,15,20,0.85)';
    bctx.lineWidth = lw * 1.6;
    bctx.lineJoin = 'round';
    bctx.stroke(this.borders!);
    bctx.strokeStyle = 'rgba(180,210,240,0.35)';
    bctx.lineWidth = lw * 1.2;
    bctx.stroke(this.coast);
    // player's nation outline
    if (g) {
      bctx.strokeStyle = 'rgba(255,215,0,0.9)';
      bctx.lineWidth = lw * 2;
      const ap = geo.arcProvs;
      const me = g.s.player;
      const path = new Path2D();
      for (let a = 0; a < geo.arcs.length; a++) {
        const p1 = ap[a * 2], p2 = ap[a * 2 + 1];
        const c1 = p1 >= 0 ? g.s.provinces[p1].ctrl === me : false;
        const c2 = p2 >= 0 ? g.s.provinces[p2].ctrl === me : false;
        if (c1 !== c2) this.addArc(path, a);
      }
      bctx.stroke(path);
    }
    this.baseView = { ...this.view };
  }

  // ------------------------------------------------------------ overlay
  private renderOverlay(now: number) {
    const ctx = this.ctx;
    const g = this.game;
    this.badges = [];
    const { k } = this.view;
    // selection / highlight outlines
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
      // use the area-weighted centre unless it is far from the main province (split nations)
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
    if (!showProvinces || k < 6) {
      for (const l of this.nationLabels) {
        const px = l.size * k;
        if (px < 9) continue;
        const fs = Math.min(px, 26);
        const [sx, sy] = this.toScreen(l.x, l.y);
        if (sx < -100 || sy < -30 || sx > this.w + 100 || sy > this.h + 30) continue;
        ctx.font = `700 ${fs}px system-ui, sans-serif`;
        const tw = ctx.measureText(l.name).width;
        const box: [number, number, number, number] = [sx - tw / 2, sy - fs / 2, sx + tw / 2, sy + fs / 2];
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
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
        const wpx = (geo.bbox[b + 2] - geo.bbox[b]) * k;
        if (wpx < 70) continue;
        const [sx, sy] = this.toScreen(geo.center[i * 2], geo.center[i * 2 + 1]);
        if (sx < -50 || sy < -20 || sx > this.w + 50 || sy > this.h + 20) continue;
        const name = g.w.provs[i].name;
        const tw = ctx.measureText(name).width;
        const box: [number, number, number, number] = [sx - tw / 2, sy - 22, sx + tw / 2, sy - 10];
        if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(name, sx, sy - 16);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(name, sx, sy - 16);
        // capital star
        const isCap = g.s.nations[g.s.provinces[i].owner]?.capital === i;
        if (isCap) {
          ctx.fillStyle = '#facc15';
          ctx.fillText('★', sx, sy - 30);
        }
      }
    }
    // capitals at mid zoom
    if (k > 1.6 && !showProvinces) {
      ctx.font = '12px system-ui, sans-serif';
      for (const n of g.s.nations) {
        if (!n.alive || n.capital < 0) continue;
        const [sx, sy] = this.toScreen(this.geo.center[n.capital * 2], this.geo.center[n.capital * 2 + 1]);
        if (sx < 0 || sy < 0 || sx > this.w || sy > this.h) continue;
        ctx.fillStyle = 'rgba(250,204,21,0.9)';
        ctx.fillText('★', sx, sy + 12);
      }
    }
  }

  private drawPaths(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    const me = g.s.player;
    ctx.lineCap = 'round';
    for (const u of g.s.units) {
      const sel = this.selectedUnits.has(u.id);
      if (u.owner !== me) continue;
      const domain = UNITS[u.type].domain;
      // air missions
      if (domain === 'air' && u.mission !== 'idle' && u.target >= 0 && (sel || this.view.k > 1.2)) {
        const [bx, by] = this.toScreen(...this.locXY(u.base));
        const [tx, ty] = this.toScreen(...this.locXY(u.target));
        if (Math.hypot(tx - bx, ty - by) > 4) {
          ctx.strokeStyle = u.mission === 'bomb' ? 'rgba(239,68,68,0.7)' : u.mission === 'airlift' ? 'rgba(34,197,94,0.7)' : 'rgba(96,165,250,0.6)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = sel ? 2.5 : 1.5;
          ctx.beginPath();
          const mx = (bx + tx) / 2, my = (by + ty) / 2 - Math.hypot(tx - bx, ty - by) * 0.2;
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(mx, my, tx, ty);
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
      this.arrowHead(ctx, px, py, ex, ey, sel ? 10 : 6);
    }
    // preview path while choosing a destination
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

  private arrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45));
    ctx.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45));
    ctx.closePath();
    ctx.fill();
  }

  private drawUnits(ctx: CanvasRenderingContext2D) {
    const g = this.game!;
    const me = g.s.player;
    const k = this.view.k;
    const bin = k < 1.2 ? 30 : 24;
    type Stack = { x: number; y: number; units: Unit[]; owner: number; loc: Loc };
    const bins = new Map<string, Stack>();
    for (const u of g.s.units) {
      if (u.carriedBy >= 0) continue;
      const domain = UNITS[u.type].domain;
      if (domain === 'air' && !this.selectedUnits.has(u.id) && u.owner !== me) continue;
      if (!unitVisible(g, u.owner, u.loc)) continue;
      if (k < 0.9 && u.owner !== me && !g.atWar(me, u.owner) && !g.allied(me, u.owner)) continue;
      const [wx, wy] = this.unitXY(u);
      let [sx, sy] = this.toScreen(wx, wy);
      if (domain === 'air') { sx += 12; sy -= 12; }
      if (sx < -30 || sy < -30 || sx > this.w + 30 || sy > this.h + 30) continue;
      const key = Math.floor(sx / bin) + ':' + Math.floor(sy / bin) + ':' + (domain === 'air' ? 'a' : domain === 'sea' ? 's' : 'l') + ':' + (u.owner === me ? 'm' : 'o' + u.owner);
      let st = bins.get(key);
      if (!st) bins.set(key, (st = { x: sx, y: sy, units: [], owner: u.owner, loc: u.loc }));
      st.units.push(u);
    }
    // draw non-player first so the player's units are on top
    const stacks = [...bins.values()].sort((a, b) => (a.owner === me ? 1 : 0) - (b.owner === me ? 1 : 0));
    for (const st of stacks) this.drawBadge(ctx, st.x, st.y, st.units, st.owner, st.loc);
  }

  private drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, units: Unit[], owner: number, loc: Loc) {
    const g = this.game!;
    const nation = g.s.nations[owner];
    const me = g.s.player;
    const sel = units.some((u) => this.selectedUnits.has(u.id));
    const counts = new Map<string, number>();
    for (const u of units) counts.set(u.type, (counts.get(u.type) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] as Unit['type'];
    const def = UNITS[top];
    const w = 30, h = 20;
    const enemy = g.atWar(me, owner);
    ctx.fillStyle = nation.color;
    ctx.strokeStyle = sel ? '#4ade80' : owner === me ? '#ffd700' : enemy ? '#ef4444' : 'rgba(0,0,0,0.8)';
    ctx.lineWidth = sel ? 3 : 2;
    ctx.beginPath();
    if (def.domain === 'sea') {
      ctx.moveTo(x - w / 2, y - h / 4);
      ctx.lineTo(x + w / 2, y - h / 4);
      ctx.lineTo(x + w / 2 - 5, y + h / 2);
      ctx.lineTo(x - w / 2 + 5, y + h / 2);
      ctx.closePath();
    } else if (def.domain === 'air') {
      ctx.arc(x, y, h / 2 + 1, 0, Math.PI * 2);
    } else {
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 4);
    }
    ctx.fill();
    ctx.stroke();
    // symbol
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.6;
    drawSymbol(ctx, top, x, y);
    // count
    const n = units.length;
    if (n > 1) {
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(x + w / 2, y - h / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), x + w / 2, y - h / 2 + 0.5);
    }
    // strength & organisation bars
    const str = units.reduce((a, u) => a + u.str, 0) / n / 100;
    const org = units.reduce((a, u) => a + u.org, 0) / n / 100;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y + h / 2 + 2, w, 5);
    ctx.fillStyle = str > 0.6 ? '#22c55e' : str > 0.3 ? '#eab308' : '#ef4444';
    ctx.fillRect(x - w / 2, y + h / 2 + 2, w * str, 2.5);
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(x - w / 2, y + h / 2 + 4.5, w * org, 2.5);
    this.badges.push({ x, y, r: 18, units: units.map((u) => u.id), loc });
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
      ctx.fillStyle = 'rgba(220,38,38,0.85)';
      ctx.beginPath();
      ctx.arc(sx, sy - 22, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('⚔', sx, sy - 22);
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
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 1.3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = e.kind === 'missile' ? `rgba(248,113,113,${1 - t})` : `rgba(250,204,21,${1 - t})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, 6 + t * 30, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** Units (ids) whose badge is under the screen point. */
  badgeAt(sx: number, sy: number): BadgeHit | null {
    let best: BadgeHit | null = null, bd = Infinity;
    for (const b of this.badges) {
      const d = Math.hypot(b.x - sx, b.y - sy);
      if (d < b.r && d < bd) { bd = d; best = b; }
    }
    return best;
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

/** NATO-style unit symbols. */
function drawSymbol(ctx: CanvasRenderingContext2D, type: Unit['type'], x: number, y: number) {
  ctx.beginPath();
  switch (type) {
    case 'infantry':
      ctx.moveTo(x - 9, y - 6); ctx.lineTo(x + 9, y + 6);
      ctx.moveTo(x + 9, y - 6); ctx.lineTo(x - 9, y + 6);
      ctx.stroke();
      return;
    case 'armor':
      ctx.ellipse(x, y, 9, 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    case 'artillery':
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'specops':
      ctx.moveTo(x - 9, y - 6); ctx.lineTo(x + 9, y + 6);
      ctx.moveTo(x + 9, y - 6); ctx.lineTo(x - 9, y + 6);
      ctx.stroke();
      ctx.font = '700 8px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SF', x, y + 0.5);
      return;
    default: {
      const glyph: Partial<Record<Unit['type'], string>> = { airdef: '⌃', missile: '▲', fighter: '✈', bomber: '✈', drone: '◇', transport: '✈', carrier: 'CV', battleship: 'BB', destroyer: 'DD', submarine: 'SS', amphib: 'LH' };
      ctx.font = `700 ${type === 'missile' || type === 'airdef' ? 12 : 10}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph[type] ?? '?', x, y + 0.5);
    }
  }
}

/** Average deposits per province (for the resource layer threshold), computed lazily. */
const RES_AVG: Record<string, number> = { oil: 0.66, gas: 0.66, steel: 0.66, rare: 0.66, uranium: 0.66, food: 0.66, electronics: 0.66 };
