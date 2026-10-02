// Glue between the simulation, the map renderer and the UI.
import { useEffect, useState } from 'preact/hooks';
import { BUILDINGS, UNITS } from '../data/units';
import { cancelScheduled, notify, onLifecycle } from '../platform/mobile';
import { listSaves, pref, readSave, setPref, writeSave } from '../platform/storage';
import { buildGeo, nearestCell, provinceAt, type MapGeo } from '../render/geo';
import { GlobeRenderer } from '../render/globe';
import { attachGestures } from '../render/input';
import { MapRenderer, type Layer } from '../render/renderer';
import type { Game } from '../sim/ctx';
import { canConstruct, construct } from '../sim/economy';
import { catchUp, createGame, deserialize, loadGame, serialize, SPEEDS, tickHour } from '../sim/engine';
import { updateVisibility } from '../sim/fog';
import { inAirRange, isAir, orderMove, retreat, stop } from '../sim/military';
import { pathFor } from '../sim/path';
import type { NewGameOptions } from '../sim/setup';
import type { BuildingType, Loc, Unit } from '../sim/types';
import { seaLoc } from '../sim/types';
import type { WorldData } from '../sim/world';

export type Panel = null | 'country' | 'army' | 'world' | 'news' | 'menu' | 'province' | 'battle' | 'build';

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
  mapEl: HTMLElement | null = null;
  game: Game | null = null;
  speed = 0;
  lastSpeed = 1;
  mode: 'map' | 'globe' = 'map';
  panel: Panel = null;
  panelArg: number | null = null;
  selected = new Set<number>();
  province = -1;
  menu: ContextMenu | null = null;
  layer: Layer = 'political';
  /** Build mode: the building being placed. */
  building: BuildingType | null = null;
  /** Breaking-news banner (latest big headline) and when it appeared. */
  breaking: { text: string; at: number; loc?: number } | null = null;
  private newsSeen = 0;
  /** Message popup (e.g. alliance offer) currently shown, and the speed to resume afterwards. */
  popupDismissed = new Set<number>();
  private resumeSpeed = 0;
  version = 0;
  screen: 'loading' | 'menu' | 'newgame' | 'game' = 'loading';
  loadError: string | null = null;
  awayReport: string[] | null = null;
  onPick: ((province: number) => void) | null = null;
  private listeners = new Set<() => void>();
  private lastEmit = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastToastId = 0;
  private pausedAt = 0;
  private lastAutosaveDay = 0;
  private rafStarted = false;
  private dragUnits: number[] = [];

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

  attachMap(el: HTMLElement) {
    if (this.mapEl === el) return;
    this.mapEl = el;
    this.renderer = new MapRenderer(el, this.geo);
    this.renderer.lowDetail = pref('batterySaver', false);
    this.renderer.layer = this.layer;
    this.globe = new GlobeRenderer(this.renderer.root, this.renderer.overCv, this.world);
    this.renderer.setGame(this.game);
    this.renderer.showUnits = this.screen !== 'newgame';
    this.renderer.resize();
    if (this.game && this.screen === 'game') this.home();
    else this.renderer.fitWorld();
    const root = this.renderer.root;
    new ResizeObserver(() => { this.renderer?.resize(); this.globe?.touch(); }).observe(root);
    attachGestures(root, {
      pan: (dx, dy) => {
        if (this.mode === 'globe') this.globe!.drag(dx, dy);
        else this.renderer!.pan(dx, dy);
        if (this.menu) { this.menu = null; this.emit(); }
      },
      zoom: (x, y, f) => {
        if (this.mode === 'globe') {
          this.globe!.zoomBy(f);
          if (this.globe!.zoom > 2.1 && f > 1) this.exitGlobe(x, y);
        } else this.renderer!.zoomAt(x, y, f);
      },
      tap: (x, y) => this.onTap(x, y),
      doubleTap: (x, y) => (this.mode === 'globe' ? this.exitGlobe(x, y) : this.renderer!.zoomSmooth(x, y, 2)),
      longPress: (x, y) => this.onLongPress(x, y),
      isDrawing: () => false,
      fling: (vx, vy) => { if (this.mode === 'globe') this.globe!.fling(vx, vy); else this.renderer!.fling(vx, vy); },
      touchDown: () => { this.renderer?.stopMotion(); this.globe?.fling(0, 0); },
      gestureEnd: () => this.emit(),
      unitDragStart: (x, y) => this.dragStart(x, y),
      unitDragMove: (x, y) => this.dragMove(x, y),
      unitDragEnd: (x, y, moved) => this.dragEnd(x, y, moved),
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
      const budget = performance.now() + (saver ? 5 : 8);
      let ticked = false;
      while (this.acc >= 1 && performance.now() < budget) {
        tickHour(g);
        this.acc -= 1;
        ticked = true;
      }
      if (ticked) this.afterTick();
      if (this.renderer) this.renderer.tickFrac = Math.min(1, this.acc);
    } else if (this.renderer) this.renderer.tickFrac = 0;
    if (this.screen === 'game' || this.screen === 'newgame') {
      if (this.mode === 'globe') this.globe?.frame(this.game, dt, now);
      else this.renderer?.frame(now, this.speed > 0 && this.screen === 'game');
    }
    if (g && performance.now() - this.lastEmit > 300) this.emit();
  }

  private afterTick() {
    const g = this.game!;
    this.checkPopups();
    this.checkNews();
    let dropped = false;
    for (const id of this.selected) if (!g.rt.unitById.has(id)) { this.selected.delete(id); dropped = true; }
    if (dropped) this.syncSelection();
    if (this.building && g.s.hour % 24 === 5) this.refreshBuildTargets();
    for (const t of g.s.toasts) {
      if (t.id <= this.lastToastId) continue;
      this.lastToastId = t.id;
      if (t.kind === 'danger' && document.hidden && g.s.settings.notifications) notify('Sovereign: World Command', t.text);
    }
    if (g.s.over) { this.speed = 0; this.emit(); }
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
  preview(opts: NewGameOptions) {
    const g = createGame(this.world, opts);
    g.s.settings.fog = false;
    updateVisibility(g);
    this.game = g;
    this.screen = 'newgame';
    this.mode = 'map';
    this.globe?.show(false);
    this.renderer?.setMapVisible(true);
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
    this.building = null;
    this.mode = 'map';
    this.globe?.show(false);
    this.renderer?.setMapVisible(true);
    this.speed = 0;
    this.lastToastId = g.s.toasts.length ? g.s.toasts[g.s.toasts.length - 1].id : 0;
    this.newsSeen = g.s.news.length;
    this.breaking = null;
    this.popupDismissed.clear();
    this.resumeSpeed = 0;
    this.lastAutosaveDay = g.day;
    this.screen = 'game';
    this.renderer?.setGame(g);
    if (this.renderer) {
      this.renderer.showUnits = true;
      this.renderer.highlight = [];
      this.home();
    }
    this.emit();
  }
  home() {
    const g = this.game, r = this.renderer;
    if (!g || !r) return;
    const cap = g.player.capital;
    if (cap >= 0) r.flyToProvince(cap, Math.max(r.minK() * 3, 2.4));
    if (this.mode === 'globe') this.exitGlobe();
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
      return (e as Error).message;
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
    this.building = null;
    this.emit();
  }

  /** Open a bottom sheet (or close it if it is already open). */
  open(p: Panel, arg: number | null = null) {
    this.panel = this.panel === p && arg === this.panelArg ? null : p;
    this.panelArg = arg;
    this.menu = null;
    if (p !== 'build' && this.building) this.cancelBuild();
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
      notify('Your nation needs you', `${this.game.player.name} awaits your orders.`, new Date(Date.now() + 6 * 3600 * 1000));
    }
  }
  private onResume() {
    cancelScheduled();
    const g = this.game;
    if (!g || !this.pausedAt || g.s.over) return;
    const minutes = (Date.now() - this.pausedAt) / 60000;
    this.pausedAt = 0;
    if (!g.s.settings.offlineProgress || minutes < 3 || this.speed === 0) return;
    const hours = Math.min(30, Math.floor(minutes)) * 24;
    this.awayReport = catchUp(g, hours);
    this.renderer?.invalidate();
    this.emit();
  }
  private onBack(): boolean {
    if (this.menu) { this.menu = null; this.emit(); return true; }
    if (this.building) { this.cancelBuild(); this.emit(); return true; }
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
    this.renderer?.setMapVisible(false);
    if (this.globe) { this.globe.zoom = 1; this.globe.spin = true; this.globe.show(true); }
    this.emit();
  }
  exitGlobe(sx?: number, sy?: number) {
    this.mode = 'map';
    this.renderer?.setMapVisible(true);
    this.globe?.show(false);
    if (sx !== undefined && sy !== undefined && this.globe && this.renderer) {
      const ll = this.globe.invert(sx, sy);
      if (ll) {
        const p = this.geo.proj(ll);
        if (p) { this.renderer.centerOn(p[0], p[1], Math.max(this.renderer.minK() * 1.6, 1.4)); this.renderer.flyTo(p[0], p[1], Math.max(this.renderer.minK() * 2.5, 2)); }
      }
    }
    this.emit();
  }

  // ------------------------------------------------------------ build mode
  startBuild(t: BuildingType) {
    this.building = t;
    this.panel = 'build';
    this.clearSelection();
    this.refreshBuildTargets();
    if (this.renderer && !this.renderer.highlight.length) this.toast(`No region can take a ${BUILDINGS[t].name} right now.`, 'warn');
    this.emit();
  }
  refreshBuildTargets() {
    const g = this.game, r = this.renderer;
    if (!g || !r) return;
    const t = this.building;
    r.highlight = t ? g.s.provinces.map((_, i) => (canConstruct(g, g.s.player, t, i) ? -1 : i)).filter((i) => i >= 0) : [];
    r.highlightColor = '34,197,94';
    r.touch();
  }
  cancelBuild() {
    this.building = null;
    if (this.renderer) { this.renderer.highlight = []; this.renderer.touch(); }
    if (this.panel === 'build') this.panel = null;
    this.emit();
  }
  private placeBuilding(p: number) {
    const g = this.game!;
    const t = this.building!;
    const e = construct(g, g.s.player, t, p);
    if (e) this.toast(`${g.w.provs[p].name}: ${e}`, 'warn');
    else {
      this.toast(`${BUILDINGS[t].icon} ${BUILDINGS[t].name} started in ${g.w.provs[p].name}`, 'good');
      this.renderer?.ping(p);
    }
    this.refreshBuildTargets();
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
    if (this.selected.size && this.panel && this.panel !== 'army') this.panel = null;
    this.syncSelection();
  }
  toggleUnit(id: number) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
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
      const units = this.selectedUnits();
      const g = this.game;
      this.renderer.airRange = g && units.length && units.every(isAir) ? g.s.provinces.map((_, i) => (units.every((u) => inAirRange(g, u, i)) ? i : -1)).filter((i) => i >= 0) : [];
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
  focus(l: Loc) {
    if (!this.renderer) return;
    if (this.mode === 'globe') this.exitGlobe();
    const [x, y] = this.renderer.locXY(l);
    this.renderer.flyTo(x, y, Math.max(this.renderer.view.k, 3));
    this.renderer.ping(l);
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

  private battleAt(sx: number, sy: number): number {
    const g = this.game!, r = this.renderer!;
    for (const b of g.s.battles) {
      if (!g.rt.visible[b.loc]) continue;
      const [bx, by] = r.toScreen(...r.locXY(b.loc));
      if (Math.hypot(bx - sx, by - 50 - sy) < 24) return b.loc;
    }
    return -1;
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
    const loc = this.locAt(sx, sy);
    if (this.building) {
      if (loc !== null && loc >= 0) this.placeBuilding(loc);
      return;
    }
    const battle = this.battleAt(sx, sy);
    if (battle >= 0 && !this.selected.size) { this.open('battle', battle); return; }
    const mine = this.renderer.badgeAt(sx, sy, g.s.player);
    if (this.selected.size) {
      // tapping another of our stacks switches the selection
      if (mine && !mine.units.some((id) => this.selected.has(id))) { this.select(mine.units); return; }
      if (mine && mine.units.every((id) => this.selected.has(id)) && mine.loc === this.selectedUnits()[0]?.loc) { this.clearSelection(); return; }
      if (loc === null) { this.clearSelection(); return; }
      this.issueOrder(loc);
      return;
    }
    if (mine) { this.select(mine.units); this.selectProvince(-1); return; }
    if (battle >= 0) { this.open('battle', battle); return; }
    if (loc !== null && loc >= 0) this.selectProvince(loc);
    else this.selectProvince(-1);
  }

  issueOrder(loc: Loc, units = this.selectedUnits()) {
    const g = this.game!;
    const { ok, err } = orderMove(g, units, loc);
    if (ok) {
      this.renderer?.ping(loc);
      if (loc >= 0 && g.atWar(g.s.player, g.s.provinces[loc].ctrl)) {
        const air = units.every(isAir);
        if (!air) this.toast(`⚔️ ${ok} unit${ok > 1 ? 's' : ''} attacking ${g.w.provs[loc].name}`, 'info');
      }
    }
    if (err && !ok) this.toast(err, 'warn');
    else if (err) this.toast(`${ok} units on their way. Some could not go: ${err}`, 'warn');
    this.syncSelection();
  }

  private dragStart(sx: number, sy: number): boolean {
    const g = this.game, r = this.renderer;
    if (!g || !r || this.mode !== 'map' || this.screen !== 'game' || this.building) return false;
    const b = r.badgeAt(sx, sy, g.s.player);
    if (!b) return false;
    // drag the selected part of this stack if some of it is selected, else the whole stack
    const sel = b.units.filter((id) => this.selected.has(id));
    this.dragUnits = sel.length ? sel : b.units;
    r.drag = { x0: b.x, y0: b.y, x: sx, y: sy, target: null, hostile: false };
    return true;
  }
  private dragMove(sx: number, sy: number) {
    const g = this.game!, r = this.renderer!;
    if (!r.drag) return;
    const loc = this.locAt(sx, sy);
    r.drag.x = sx;
    r.drag.y = sy;
    r.drag.target = loc;
    r.drag.hostile = loc !== null && loc >= 0 && g.atWar(g.s.player, g.s.provinces[loc].ctrl);
    r.touch();
  }
  private dragEnd(sx: number, sy: number, moved: boolean) {
    const r = this.renderer!;
    const d = r.drag;
    r.drag = null;
    r.touch();
    if (!moved || !d) return;
    const g = this.game!;
    const units = this.dragUnits.map((id) => g.rt.unitById.get(id)).filter((u): u is Unit => !!u);
    // a tiny drag is just a slightly shaky tap: select the stack
    if (Math.hypot(sx - d.x0, sy - d.y0) < 28) { this.select(units.map((u) => u.id)); return; }
    const loc = this.locAt(sx, sy);
    if (loc === null || !units.length) return;
    this.select(units.map((u) => u.id));
    this.issueOrder(loc, units);
  }

  private onLongPress(sx: number, sy: number) {
    if (this.mode === 'globe' || !this.game || this.screen !== 'game' || this.building) return;
    const loc = this.locAt(sx, sy);
    if (loc === null) return;
    this.menu = { x: sx, y: sy, loc };
    if (loc >= 0 && this.renderer) { this.renderer.selectedProvince = loc; this.renderer.touch(); }
    if (this.selected.size && this.renderer) {
      const u = this.selectedUnits().find((x) => !isAir(x));
      if (u) this.renderer.previewPath = [u.loc, ...(pathFor(this.game, u, loc) || [])];
    }
    this.emit();
  }

  // actions
  stopSelected() {
    for (const u of this.selectedUnits()) stop(u);
    this.emit();
  }
  retreatSelected() {
    let err: string | null = null, ok = 0;
    for (const u of this.selectedUnits()) {
      const e = retreat(this.game!, u);
      if (e) err = e; else ok++;
    }
    if (!ok && err) this.toast(err, 'warn');
    this.emit();
  }
  /** Select every one of our troops (or planes, or ships) anywhere on the map. */
  selectAll(domain: 'land' | 'air' | 'sea') {
    const g = this.game;
    if (!g) return;
    const list = g.s.units.filter((u) => u.owner === g.s.player && UNITS[u.type].domain === domain);
    this.select(list.map((u) => u.id));
    const what = domain === 'land' ? 'troops' : domain === 'air' ? 'planes' : 'ships';
    if (!list.length) this.toast(`You have no ${what}.`);
    else this.toast(`🎯 All ${list.length} ${what} selected — tap a region to send them`, 'info');
  }

  // ------------------------------------------------------------ popups & breaking news
  /** The next message that should pop up on screen (alliance offers, peace offers...). */
  popup() {
    const g = this.game;
    if (!g || this.screen !== 'game') return null;
    // small stuff (no-attack pacts) waits in the News inbox; big decisions pop up
    return g.s.inbox.find((m) => m.to === g.s.player && !m.resolved && m.kind !== 'nap' && !this.popupDismissed.has(m.id)) ?? null;
  }
  private checkPopups() {
    const m = this.popup();
    if (m && this.speed > 0) {
      this.resumeSpeed = this.speed;
      this.speed = 0;
      this.emit();
    }
  }
  closePopup(id: number) {
    this.popupDismissed.add(id);
    if (!this.popup() && this.resumeSpeed) { this.speed = this.resumeSpeed; this.resumeSpeed = 0; }
    this.renderer?.invalidate(true);
    this.emit();
  }
  private checkNews() {
    const g = this.game!;
    const news = g.s.news;
    if (this.newsSeen > news.length) this.newsSeen = 0;
    for (let i = this.newsSeen; i < news.length; i++) if (news[i].big) this.breaking = { text: news[i].text, at: performance.now(), loc: news[i].loc };
    this.newsSeen = news.length;
  }

  closeMenu() {
    this.menu = null;
    if (this.renderer) { this.renderer.previewPath = []; this.renderer.selectedProvince = this.province; this.renderer.touch(); }
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
