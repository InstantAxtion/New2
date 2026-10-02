// Glue between the simulation, the map renderer and the UI.
import { useEffect, useState } from 'preact/hooks';
import { UNITS } from '../data/units';
import { cancelScheduled, notify, onLifecycle } from '../platform/mobile';
import { listSaves, pref, readSave, setPref, writeSave } from '../platform/storage';
import { buildGeo, nearestCell, provinceAt, type MapGeo } from '../render/geo';
import { GlobeRenderer } from '../render/globe';
import { attachGestures } from '../render/input';
import { MapRenderer, type Layer } from '../render/renderer';
import { catchUp, createGame, deserialize, loadGame, serialize, SPEEDS, tickHour } from '../sim/engine';
import type { Game } from '../sim/ctx';
import { orderEncircle, orderFrontline, orderHold, orderMove, orderRetreat, setAirMission, setNavalMission, fireMissile } from '../sim/military';
import { pathFor } from '../sim/path';
import type { NewGameOptions } from '../sim/setup';
import type { AirMission, Loc, NavalMission, Unit } from '../sim/types';
import { seaLoc } from '../sim/types';
import type { WorldData } from '../sim/world';

export type Panel = null | 'nation' | 'economy' | 'military' | 'diplomacy' | 'research' | 'intel' | 'news' | 'menu' | 'province';
export type Tool = 'none' | 'frontline' | 'encircle';

export interface ContextMenu {
  x: number;
  y: number;
  loc: Loc;
}

class Controller {
  world!: WorldData;
  geo!: MapGeo;
  renderer: MapRenderer | null = null;
  globe: GlobeRenderer | null = null;
  canvas: HTMLCanvasElement | null = null;
  game: Game | null = null;
  speed = 0;
  lastSpeed = 1;
  mode: 'map' | 'globe' = 'map';
  tool: Tool = 'none';
  queueMode = false;
  panel: Panel = null;
  panelArg: number | null = null; // e.g. selected nation in diplomacy panel
  selected = new Set<number>();
  province = -1;
  menu: ContextMenu | null = null;
  layer: Layer = 'political';
  version = 0;
  screen: 'loading' | 'menu' | 'newgame' | 'game' = 'loading';
  loadError: string | null = null;
  private listeners = new Set<() => void>();
  private lastEmit = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastToastId = 0;
  private drawLine: number[] = [];
  private pausedAt = 0;
  private lastAutosaveDay = 0;
  private rafStarted = false;
  pendingEncircle = false;
  awayReport: string[] | null = null;
  /** In the new-game country picker, taps select a nation instead of issuing orders. */
  onPick: ((province: number) => void) | null = null;

  // ------------------------------------------------------------ reactivity
  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  emit() {
    this.version++;
    this.lastEmit = performance.now();
    for (const f of this.listeners) f();
  }

  // ------------------------------------------------------------ boot
  async boot(loadWorld: () => Promise<WorldData>) {
    try {
      this.world = await loadWorld();
      this.geo = buildGeo(this.world);
      this.screen = 'menu';
    } catch (e) {
      this.loadError = String(e);
    }
    onLifecycle(() => this.onPause(), () => this.onResume(), () => this.onBack());
    this.emit();
  }

  attachCanvas(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas) return;
    this.canvas = canvas;
    this.renderer = new MapRenderer(canvas, this.geo);
    this.renderer.lowDetail = pref('batterySaver', false);
    this.renderer.layer = this.layer;
    this.globe = new GlobeRenderer(canvas, this.world);
    this.renderer.setGame(this.game);
    this.renderer.showUnits = this.screen !== 'newgame';
    this.renderer.resize();
    if (this.game && this.screen === 'game') {
      const cap = this.game.player.capital;
      if (cap >= 0) this.renderer.centerOnProvince(cap, Math.max(this.renderer.minK() * 3, 2.5));
    } else this.renderer.fitWorld();
    new ResizeObserver(() => { this.renderer?.resize(); this.globe?.touch(); }).observe(canvas);
    attachGestures(canvas, {
      pan: (dx, dy) => {
        if (this.mode === 'globe') this.globe!.drag(dx, dy);
        else this.renderer!.pan(dx, dy);
        this.menu = null;
      },
      zoom: (x, y, f) => {
        if (this.mode === 'globe') {
          this.globe!.zoomBy(f);
          if (this.globe!.zoom > 2.1 && f > 1) this.exitGlobe(x, y);
        } else this.renderer!.zoomAt(x, y, f);
      },
      tap: (x, y) => this.onTap(x, y),
      doubleTap: (x, y) => (this.mode === 'globe' ? this.exitGlobe(x, y) : this.renderer!.zoomAt(x, y, 1.8)),
      longPress: (x, y) => this.onLongPress(x, y),
      isDrawing: () => this.tool === 'frontline' && this.mode === 'map',
      drawStart: (x, y) => { this.drawLine = []; this.addDraw(x, y); },
      drawMove: (x, y) => this.addDraw(x, y),
      drawEnd: () => this.finishDraw(),
      gestureEnd: () => this.emit(),
    });
    if (!this.rafStarted) {
      this.rafStarted = true;
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  // ------------------------------------------------------------ main loop
  private loop(now: number) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(250, now - (this.lastFrame || now));
    const saver = pref('batterySaver', false);
    if (saver && now - this.lastFrame < 30) return;
    this.lastFrame = now;
    const g = this.game;
    if (g && this.screen === 'game' && this.speed > 0 && !g.s.over && !this.awayReport) {
      this.acc += (dt / 1000) * SPEEDS[this.speed];
      this.acc = Math.min(this.acc, 24);
      const budget = now + (saver ? 6 : 10);
      let ticked = false;
      while (this.acc >= 1 && performance.now() < budget) {
        tickHour(g);
        this.acc -= 1;
        ticked = true;
      }
      if (ticked) this.afterTick();
    }
    if (this.screen === 'game' || this.screen === 'newgame') {
      if (this.mode === 'globe') this.globe?.frame(this.game, dt);
      else this.renderer?.frame(now);
    }
    if (g && performance.now() - this.lastEmit > 300) this.emit();
  }

  private afterTick() {
    const g = this.game!;
    // drop selection of dead units
    for (const id of this.selected) if (!g.rt.unitById.has(id)) this.selected.delete(id);
    // notifications for important toasts while backgrounded
    for (const t of g.s.toasts) {
      if (t.id <= this.lastToastId) continue;
      this.lastToastId = t.id;
      if (t.kind === 'danger' && document.hidden && g.s.settings.notifications) notify('Sovereign: World Command', t.text);
    }
    if (g.s.over) {
      this.speed = 0;
      this.emit();
    }
    // autosave every 60 game days
    if (g.day - this.lastAutosaveDay >= 60) {
      this.lastAutosaveDay = g.day;
      this.save('autosave');
    }
  }

  // ------------------------------------------------------------ game lifecycle
  newGame(opts: NewGameOptions) {
    const g = createGame(this.world, opts);
    this.onPick = null;
    this.startGame(g);
  }
  /** Show a scenario's starting map in the country picker. */
  preview(opts: NewGameOptions) {
    const g = createGame(this.world, opts);
    this.game = g;
    this.screen = 'newgame';
    this.mode = 'map';
    this.speed = 0;
    if (this.renderer) {
      this.renderer.setGame(g);
      this.renderer.showUnits = false;
      this.renderer.fitWorld();
    }
    this.emit();
    return g;
  }
  openNewGame() {
    this.screen = 'newgame';
    this.game = null;
    this.renderer?.setGame(null);
    this.emit();
  }
  startGame(g: Game) {
    this.game = g;
    this.selected.clear();
    this.province = -1;
    this.panel = null;
    this.menu = null;
    this.tool = 'none';
    this.mode = 'map';
    this.speed = 0;
    this.lastToastId = g.s.toasts.length ? g.s.toasts[g.s.toasts.length - 1].id : 0;
    this.lastAutosaveDay = g.day;
    this.screen = 'game';
    this.renderer?.setGame(g);
    if (this.renderer) {
      this.renderer.showUnits = true;
      const cap = g.player.capital;
      if (cap >= 0) this.renderer.centerOnProvince(cap, Math.max(this.renderer.minK() * 3, 2.5));
    }
    this.emit();
  }
  async save(slot: string) {
    const g = this.game;
    if (!g) return;
    const d = g.date();
    await writeSave({ slot, nation: g.player.name, scenario: g.s.scenario, date: d.toISOString().slice(0, 10), savedAt: Date.now() }, serialize(g));
  }
  async load(slot: string): Promise<string | null> {
    const r = await readSave(slot);
    if (!r) return 'Save not found';
    try {
      this.startGame(loadGame(this.world, deserialize(r.json)));
      return null;
    } catch (e) {
      return String(e);
    }
  }
  saves() {
    return listSaves();
  }
  quitToMenu() {
    if (this.game && !this.game.s.over) this.save('autosave');
    this.game = null;
    this.renderer?.setGame(null);
    this.screen = 'menu';
    this.speed = 0;
    this.emit();
  }

  setSpeed(s: number) {
    this.speed = s;
    if (s > 0) this.lastSpeed = s;
    this.emit();
  }
  togglePause() {
    this.setSpeed(this.speed > 0 ? 0 : this.lastSpeed);
  }

  // ------------------------------------------------------------ lifecycle
  private onPause() {
    if (!this.game || this.game.s.over) return;
    this.pausedAt = Date.now();
    this.save('autosave');
    if (this.game.s.settings.notifications) {
      cancelScheduled();
      notify('Your nation needs you', `${this.game.player.name} awaits your orders. Your advisors are holding the line.`, new Date(Date.now() + 6 * 3600 * 1000));
    }
  }
  private onResume() {
    cancelScheduled();
    const g = this.game;
    if (!g || !this.pausedAt || g.s.over) return;
    const minutes = (Date.now() - this.pausedAt) / 60000;
    this.pausedAt = 0;
    if (!g.s.settings.offlineProgress || minutes < 3 || this.speed === 0) return;
    // 1 real minute away = 1 game day, capped at 30 days
    const hours = Math.min(30, Math.floor(minutes)) * 24;
    this.awayReport = catchUp(g, hours);
    this.renderer?.invalidate();
    this.emit();
  }
  private onBack(): boolean {
    if (this.menu) { this.menu = null; this.emit(); return true; }
    if (this.panel) { this.panel = null; this.emit(); return true; }
    if (this.selected.size) { this.clearSelection(); return true; }
    if (this.screen === 'game') { this.panel = 'menu'; this.setSpeed(0); return true; }
    if (this.screen === 'newgame') { this.screen = 'menu'; this.emit(); return true; }
    return false;
  }

  // ------------------------------------------------------------ map modes
  setLayer(l: Layer) {
    this.layer = l;
    if (this.renderer) { this.renderer.layer = l; this.renderer.invalidate(); }
    this.emit();
  }
  enterGlobe() {
    this.mode = 'globe';
    if (this.globe) { this.globe.zoom = 1; this.globe.spin = true; this.globe.touch(); }
    this.emit();
  }
  exitGlobe(sx?: number, sy?: number) {
    this.mode = 'map';
    if (sx !== undefined && sy !== undefined && this.globe && this.renderer) {
      const ll = this.globe.invert(sx, sy);
      if (ll) {
        const p = this.geo.proj(ll);
        if (p) this.renderer.centerOn(p[0], p[1], Math.max(this.renderer.minK() * 2.5, 2));
      }
    }
    this.renderer?.invalidate();
    this.emit();
  }
  setTool(t: Tool) {
    this.tool = this.tool === t ? 'none' : t;
    this.emit();
  }

  // ------------------------------------------------------------ selection
  selectedUnits(): Unit[] {
    const g = this.game;
    if (!g) return [];
    return [...this.selected].map((id) => g.rt.unitById.get(id)).filter((u): u is Unit => !!u);
  }
  select(ids: number[], add = false) {
    if (!add) this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.syncSelection();
  }
  clearSelection() {
    this.selected.clear();
    this.syncSelection();
  }
  private syncSelection() {
    if (this.renderer) {
      this.renderer.selectedUnits = new Set(this.selected);
      this.renderer.previewPath = [];
      this.renderer.touch();
    }
    this.emit();
  }
  selectProvince(p: number) {
    this.province = p;
    if (this.renderer) { this.renderer.selectedProvince = p; this.renderer.touch(); }
    this.panel = p >= 0 ? 'province' : this.panel === 'province' ? null : this.panel;
    this.emit();
  }
  selectAllInView(domain: 'land' | 'air' | 'sea' = 'land') {
    const g = this.game, r = this.renderer;
    if (!g || !r) return;
    const ids: number[] = [];
    for (const u of g.s.units) {
      if (u.owner !== g.s.player || UNITS[u.type].domain !== domain) continue;
      const [sx, sy] = r.toScreen(...r.unitXY(u));
      if (sx >= 0 && sy >= 0 && sx <= r.w && sy <= r.h) ids.push(u.id);
    }
    this.select(ids);
    if (!ids.length) this.toast(`No ${domain} units on screen`);
  }
  focus(l: Loc) {
    if (!this.renderer) return;
    const [x, y] = this.renderer.locXY(l);
    this.renderer.centerOn(x, y, Math.max(this.renderer.view.k, 3));
    this.renderer.ping(l);
    if (this.mode === 'globe') this.mode = 'map';
    this.emit();
  }

  toast(text: string, kind: 'info' | 'warn' | 'danger' | 'good' = 'info') {
    this.game?.toast(text, kind);
    this.emit();
  }

  // ------------------------------------------------------------ map input
  private locAt(sx: number, sy: number): Loc | null {
    const [wx, wy] = this.renderer!.toWorld(sx, sy);
    const p = provinceAt(this.geo, wx, wy);
    if (p >= 0) return p;
    const c = nearestCell(this.geo, wx, wy, 30 / Math.max(0.5, this.renderer!.view.k) + 10);
    return c >= 0 ? seaLoc(c) : null;
  }

  private onTap(sx: number, sy: number) {
    const g = this.game;
    if (this.mode === 'globe') { this.exitGlobe(sx, sy); return; }
    if (!g || !this.renderer) return;
    this.menu = null;
    if (this.screen === 'newgame') {
      const l = this.locAt(sx, sy);
      if (l !== null && l >= 0) this.onPick?.(l);
      return;
    }
    const badge = this.renderer.badgeAt(sx, sy);
    const loc = this.locAt(sx, sy);
    if (this.pendingEncircle && loc !== null && loc >= 0) {
      this.onTapEncircle(loc);
      return;
    }
    if (this.selected.size) {
      if (badge) {
        const own = badge.units.filter((id) => g.rt.unitById.get(id)?.owner === g.s.player);
        if (own.length && !own.every((id) => this.selected.has(id)) && !this.queueMode) {
          // tapping another of our stacks while units are selected: if it's the same place, switch selection
          const sel = this.selectedUnits();
          if (sel.length && sel.every((u) => u.loc === badge.loc)) { this.select(own); return; }
        }
      }
      if (loc === null) { this.clearSelection(); return; }
      this.issueOrder(loc);
      return;
    }
    if (badge) {
      const own = badge.units.filter((id) => g.rt.unitById.get(id)?.owner === g.s.player);
      if (own.length) { this.select(own); this.selectProvince(-1); return; }
    }
    if (loc !== null && loc >= 0) this.selectProvince(loc);
    else this.selectProvince(-1);
  }

  onTapEncircle(loc: number) {
    const g = this.game!;
    this.pendingEncircle = false;
    const n = orderEncircle(g, this.selectedUnits(), loc);
    this.toast(n ? `Encircling ${g.w.provs[loc].name} with ${n} units` : 'Could not encircle that province', n ? 'good' : 'warn');
    this.renderer?.ping(loc);
  }

  issueOrder(loc: Loc) {
    const g = this.game!;
    const units = this.selectedUnits();
    let ok = 0;
    let err: string | null = null;
    for (const u of units) {
      const d = UNITS[u.type].domain;
      let e: string | null;
      if (d === 'air') {
        if (loc < 0) { e = 'Air units need a province target'; }
        else {
          const ctrl = g.s.provinces[loc].ctrl;
          const mission: AirMission = u.type === 'transport' ? 'airlift' : g.atWar(g.s.player, ctrl) ? (u.type === 'fighter' ? 'superiority' : 'bomb') : ctrl === g.s.player || g.allied(ctrl, g.s.player) ? (g.rt.battles.has(loc) && u.type !== 'fighter' ? 'cas' : 'superiority') : 'superiority';
          e = setAirMission(g, u, mission, loc);
          if (e && e.startsWith('Out of range')) e = orderMove(g, u, loc);
        }
      } else if (d === 'land' && loc < 0) e = 'Land units cannot move into open sea';
      else e = orderMove(g, u, loc, this.queueMode);
      if (e) err = err ?? e;
      else ok++;
    }
    if (ok) this.renderer?.ping(loc);
    if (err && !ok) this.toast(err, 'warn');
    else if (err) this.toast(`${ok} units ordered. Some could not: ${err}`, 'warn');
    this.renderer?.touch();
    this.emit();
  }

  private onLongPress(sx: number, sy: number) {
    if (this.mode === 'globe' || !this.game || this.screen !== 'game') return;
    const loc = this.locAt(sx, sy);
    if (loc === null) return;
    this.menu = { x: sx, y: sy, loc };
    if (loc >= 0 && this.renderer) { this.renderer.selectedProvince = loc; this.renderer.touch(); }
    if (this.selected.size && this.renderer) {
      const u = this.selectedUnits()[0];
      if (u && UNITS[u.type].domain !== 'air') this.renderer.previewPath = [u.loc, ...(pathFor(this.game, u, loc) || [])];
    }
    this.emit();
  }

  // context-menu actions
  hold() { for (const u of this.selectedUnits()) orderHold(this.game!, u); this.emit(); }
  retreat() {
    let err: string | null = null;
    for (const u of this.selectedUnits()) err = orderRetreat(this.game!, u) ?? err;
    if (err) this.toast(err, 'warn');
    this.emit();
  }
  airMission(m: AirMission, loc: Loc) {
    const g = this.game!;
    let err: string | null = null, ok = 0;
    for (const u of this.selectedUnits()) {
      if (UNITS[u.type].domain !== 'air') continue;
      const e = setAirMission(g, u, m, loc);
      if (e) err = e; else ok++;
    }
    this.toast(ok ? `${ok} air wings assigned: ${m}` : err ?? 'No air units selected', ok ? 'good' : 'warn');
  }
  navalMission(m: NavalMission, loc: Loc) {
    const g = this.game!;
    let err: string | null = null, ok = 0;
    for (const u of this.selectedUnits()) {
      if (UNITS[u.type].domain !== 'sea') continue;
      const e = setNavalMission(g, u, m, loc);
      if (e) err = e; else ok++;
    }
    this.toast(ok ? `${ok} fleets assigned: ${m}` : err ?? 'No ships selected', ok ? 'good' : 'warn');
  }
  fire(loc: number) {
    const g = this.game!;
    let err: string | null = null, ok = 0;
    for (const u of this.selectedUnits()) {
      if (u.type !== 'missile') continue;
      const e = fireMissile(g, u, loc);
      if (e) err = e; else ok++;
    }
    if (ok) this.renderer?.ping(loc, 'missile');
    this.toast(ok ? `${ok} missile strikes launched` : err ?? 'No missile batteries selected', ok ? 'good' : 'warn');
  }

  // front-line drawing
  private addDraw(sx: number, sy: number) {
    const [wx, wy] = this.renderer!.toWorld(sx, sy);
    const p = provinceAt(this.geo, wx, wy);
    if (p >= 0 && this.drawLine[this.drawLine.length - 1] !== p && !this.drawLine.includes(p)) {
      this.drawLine.push(p);
      this.renderer!.highlight = this.drawLine.slice();
      this.renderer!.touch();
    }
  }
  private finishDraw() {
    if (!this.drawLine.length) return;
    this.menu = { x: this.renderer!.w / 2, y: this.renderer!.h / 2, loc: -999 };
    this.emit();
  }
  get frontLine() {
    return this.drawLine;
  }
  applyFrontline(mode: 'hold' | 'advance') {
    const g = this.game!;
    let units = this.selectedUnits().filter((u) => UNITS[u.type].domain === 'land');
    if (!units.length) {
      // use all idle land units near the line
      const line = this.drawLine;
      units = g.unitsOf(g.s.player).filter((u) => UNITS[u.type].domain === 'land' && u.loc >= 0 && !u.path.length && u.type !== 'missile' && u.type !== 'airdef' && line.some((p) => g.dist(p, u.loc) < 1500));
    }
    const n = orderFrontline(g, units, this.drawLine, mode);
    this.toast(n ? `${n} units assigned to the front line (${mode})` : 'No units available for this front', n ? 'good' : 'warn');
    this.cancelDraw();
  }
  cancelDraw() {
    this.drawLine = [];
    if (this.renderer) { this.renderer.highlight = []; this.renderer.touch(); }
    this.menu = null;
    this.tool = 'none';
    this.emit();
  }

  closeMenu() {
    this.menu = null;
    if (this.renderer) { this.renderer.previewPath = []; this.renderer.touch(); }
    this.emit();
  }

  dismissAway() {
    this.awayReport = null;
    if (this.game) this.game.s.awayReport = null;
    this.emit();
  }

  setPref(key: string, v: unknown) {
    setPref(key, v);
    if (key === 'batterySaver' && this.renderer) { this.renderer.lowDetail = !!v; this.renderer.resize(); }
    this.emit();
  }
}

export const ctl = new Controller();

/** Re-render the calling component whenever the controller emits. */
export function useCtl() {
  const [, set] = useState(0);
  useEffect(() => ctl.subscribe(() => set((v) => v + 1)), []);
  return ctl;
}
