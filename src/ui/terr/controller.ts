// App state for the Territorial-style game: screens, the running match, taps on the map.
import { useEffect, useState } from 'preact/hooks';
import { buzz, onLifecycle } from '../../platform/mobile';
import { listSaves, pref, readSave, setPref, writeSave } from '../../platform/storage';
import { buildGeo } from '../../render/geo';
import { attachGestures } from '../../render/input';
import { TerrRenderer } from '../../render/terr';
import type { WorldData } from '../../sim/world';
import { think } from '../../terr/ai';
import { deserialize, fmtTroops, serialize, TerrGame, type Difficulty, type Mode } from '../../terr/game';
import { buildTerrMap, type TerrMap } from '../../terr/map';
import { choosePlayer, MODE_BY_ID, newTerrGame, spawnHuman } from '../../terr/setup';

export type Panel = null | 'menu' | 'info' | 'news';
export const SPEEDS = [1, 2, 3];

export interface UiToast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'warn' | 'danger';
  at: number;
  cell?: number;
}

class Controller {
  world!: WorldData;
  map!: TerrMap;
  renderer: TerrRenderer | null = null;
  mapEl: HTMLElement | null = null;
  game: TerrGame | null = null;
  screen: 'loading' | 'menu' | 'newgame' | 'game' = 'loading';
  loadError: string | null = null;
  speed = 0;
  lastSpeed = 1;
  /** share of troops sent per attack, in % */
  pct = pref('attackPct', 30);
  panel: Panel = null;
  info = -1; // player shown in the info sheet
  // new game screen
  newMode: Mode = 'world';
  difficulty: Difficulty = pref('difficulty', 'normal');
  pick = -1; // country index (world modes) or cell (free-for-all)
  // feedback
  toasts: UiToast[] = [];
  breaking: { text: string; at: number; cell?: number } | null = null;
  tutorial = false;
  private toastSeen = 0;
  private newsSeen = 0;
  private nextToast = 1;
  private listeners = new Set<() => void>();
  private lastEmit = 0;
  private lastFrame = 0;
  private lastSave = 0;
  private rafStarted = false;
  private resumeSpeed = 0;

  // ------------------------------------------------------------ reactivity
  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  emit() {
    this.lastEmit = performance.now();
    for (const f of this.listeners) f();
  }

  // ------------------------------------------------------------ boot
  async boot(loadWorld: () => Promise<WorldData>) {
    try {
      this.world = await loadWorld();
      this.map = buildTerrMap(this.world, buildGeo(this.world));
      this.screen = 'menu';
    } catch (e) {
      this.loadError = String(e);
    }
    onLifecycle(() => this.onPause(), () => {}, () => this.onBack());
    this.emit();
  }

  attachMap(el: HTMLElement) {
    if (this.mapEl === el) return;
    this.mapEl = el;
    this.renderer = new TerrRenderer(el, this.map);
    this.renderer.lowDetail = pref('batterySaver', false);
    this.renderer.resize();
    this.renderer.setGame(this.game);
    if (this.game?.human) this.home(false);
    const root = this.renderer.root;
    new ResizeObserver(() => this.renderer?.resize()).observe(root);
    attachGestures(root, {
      pan: (dx, dy) => this.renderer!.pan(dx, dy),
      zoom: (x, y, f) => this.renderer!.zoomAt(x, y, f),
      tap: (x, y) => this.tap(x, y),
      doubleTap: (x, y) => this.renderer!.zoomSmooth(x, y, 2.2),
      longPress: (x, y) => this.longPress(x, y),
      isDrawing: () => false,
      fling: (vx, vy) => this.renderer!.fling(vx, vy),
      touchDown: () => this.renderer?.stopMotion(),
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
    const running = !!g && this.screen === 'game' && this.speed > 0 && !g.s.over && !this.popup() && !this.tutorial;
    if (running) {
      g!.advance((dt / 1000) * SPEEDS[this.speed - 1], think, saver ? 6 : 10);
      this.afterTick();
    }
    if (this.screen === 'game' || this.screen === 'newgame') this.renderer?.frame(now, running);
    if (g && performance.now() - this.lastEmit > (running ? 250 : 1000)) this.emit();
  }

  private afterTick() {
    const g = this.game!;
    // game toasts → UI toasts
    for (const t of g.toasts) {
      if (t.id <= this.toastSeen) continue;
      this.toastSeen = t.id;
      this.toast(t.text, t.kind, t.cell);
      if (t.kind === 'danger') buzz([40, 60, 40]);
    }
    // breaking news
    const news = g.s.news;
    if (this.newsSeen > news.length) this.newsSeen = 0;
    for (let i = this.newsSeen; i < news.length; i++) if (news[i].big) this.breaking = { text: news[i].text, at: performance.now(), cell: news[i].cell };
    this.newsSeen = news.length;
    if (g.s.over) {
      this.speed = 0;
      buzz(g.s.over.won ? [30, 50, 30, 50, 80] : [120]);
      this.emit();
    }
    if (this.popup() && this.speed > 0) buzz([30, 60, 30]);
    if (g.s.t - this.lastSave > 45 && !g.s.over) {
      this.lastSave = g.s.t;
      this.save('autosave');
    }
  }

  // ------------------------------------------------------------ feedback
  toast(text: string, kind: UiToast['kind'] = 'info', cell?: number) {
    this.toasts.push({ id: this.nextToast++, text, kind, at: performance.now(), cell });
    if (this.toasts.length > 3) this.toasts.shift();
    this.emit();
  }

  // ------------------------------------------------------------ screens
  openNewGame() {
    this.screen = 'newgame';
    this.panel = null;
    this.setNewMode(this.newMode);
  }
  /** New game screen: build a preview of the chosen mode to pick a country / spot on. */
  setNewMode(mode: Mode) {
    this.newMode = mode;
    this.pick = -1;
    this.game = newTerrGame(this.world, this.map, { mode, difficulty: this.difficulty });
    this.renderer?.setGame(this.game);
    if (this.renderer) {
      this.renderer.hover = -1;
      this.renderer.fitWorld();
      // continent modes: frame the part of the world in play
      if (mode !== 'world' && mode !== 'ffa') {
        const spots = this.game.labelSpots(8);
        if (spots.length) {
          const xs = spots.map((s) => s.x), ys = spots.map((s) => s.y);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          const k = Math.min(this.renderer.w / (x1 - x0 + 60), this.renderer.h / (y1 - y0 + 90));
          this.renderer.centerOn((x0 + x1) / 2, (y0 + y1) / 2 + 10, k);
        }
      }
    }
    this.emit();
  }
  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    setPref('difficulty', d);
    if (this.game) this.game.s.difficulty = d;
    this.emit();
  }
  /** Start the match with the picked country / spot. */
  play(): string | null {
    const g = this.game;
    if (!g) return 'No game';
    if (MODE_BY_ID[this.newMode].start === 'spawn') {
      if (this.pick < 0) return 'Tap empty land to choose where you start';
      const e = spawnHuman(g, this.pick, 'You', '#ff4fa3');
      if (e) return e;
    } else {
      if (this.pick < 0) return 'Tap a country to play as';
      choosePlayer(g, this.pick);
    }
    this.renderer?.refreshColors();
    this.startGame(g);
    return null;
  }
  startGame(g: TerrGame) {
    this.game = g;
    this.screen = 'game';
    this.panel = null;
    this.toasts = [];
    this.breaking = null;
    this.toastSeen = g.toasts.length ? g.toasts[g.toasts.length - 1].id : 0;
    this.newsSeen = g.s.news.length;
    this.lastSave = g.s.t;
    this.tutorial = !pref('terrTutorialDone', false);
    this.speed = 1;
    this.lastSpeed = 1;
    if (this.renderer) {
      this.renderer.hover = -1;
      this.renderer.setGame(g);
      this.home(true);
    }
    this.emit();
  }
  quitToMenu() {
    if (this.game && !this.game.s.over && this.game.human) this.save('autosave');
    this.game = null;
    this.renderer?.setGame(null);
    this.screen = 'menu';
    this.speed = 0;
    this.panel = null;
    this.emit();
  }
  finishTutorial() {
    this.tutorial = false;
    setPref('terrTutorialDone', true);
    this.emit();
  }

  // ------------------------------------------------------------ saves
  async save(slot: string) {
    const g = this.game;
    if (!g?.human) return;
    const t = Math.floor(g.s.t);
    await writeSave({ slot, nation: g.human.name, scenario: g.s.mode, date: `${Math.floor(t / 60)}m ${t % 60}s in`, savedAt: Date.now() }, serialize(g));
  }
  async load(slot: string): Promise<string | null> {
    const r = await readSave(slot);
    if (!r) return 'Save not found';
    try {
      const s = deserialize(r.json, this.map.w * this.map.h);
      this.newMode = s.mode;
      this.startGame(new TerrGame(s, this.map));
      this.tutorial = false;
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
  saves() {
    return listSaves();
  }
  setPref(k: string, v: unknown) {
    setPref(k, v);
    if (k === 'batterySaver' && this.renderer) { this.renderer.lowDetail = !!v; this.renderer.resize(); }
    this.emit();
  }

  // ------------------------------------------------------------ controls
  setSpeed(s: number) {
    this.speed = s;
    if (s > 0) this.lastSpeed = s;
    this.emit();
  }
  togglePause() {
    this.setSpeed(this.speed > 0 ? 0 : this.lastSpeed);
  }
  setPct(v: number) {
    this.pct = Math.max(1, Math.min(100, Math.round(v)));
    setPref('attackPct', this.pct);
    this.emit();
  }
  open(p: Panel, info = -1) {
    this.panel = this.panel === p && info === this.info ? null : p;
    this.info = info;
    this.emit();
  }
  /** Fly to the human's land. */
  home(zoom = true) {
    const g = this.game, r = this.renderer;
    if (!g?.human || !r) return;
    const spots = g.labelSpots(4);
    const s = spots.find((x) => x.p === g.s.player);
    if (!s) return;
    const k = zoom ? Math.max(r.minK() * 1.5, Math.min(14, 220 / Math.max(6, Math.sqrt(g.human.land) * 1.4))) : r.view.k;
    r.flyTo(s.x, s.y, k, zoom ? 700 : 400);
  }
  flyToPlayer(p: number) {
    this.renderer?.flyToPlayer(p);
  }
  troopsToSend() {
    const h = this.game?.human;
    return h ? (h.troops * this.pct) / 100 : 0;
  }

  // ------------------------------------------------------------ map taps
  private tap(sx: number, sy: number) {
    const g = this.game, r = this.renderer;
    if (!g || !r) return;
    const cell = r.cellAt(sx, sy);
    if (this.screen === 'newgame') return this.pickAt(cell);
    if (this.screen !== 'game' || this.panel) { if (this.panel) { this.panel = null; this.emit(); } return; }
    const me = g.s.player;
    const H = g.human;
    if (!H?.alive || g.s.over || cell < 0) return;
    if (this.map.prov[cell] < 0) return; // sea
    const o = g.s.owner[cell];
    if (o === -2) return this.toast('That land is not part of this match.', 'warn');
    if (o === me) { r.ping(cell, '#ffd23f'); return; }
    if (o >= 0 && g.allied(me, o)) { this.open('info', o); return; }
    const troops = this.troopsToSend();
    if (troops < 1) return this.toast('Not enough troops yet — wait a moment.', 'warn');
    let err: string | null;
    const name = o >= 0 ? g.s.players[o].name : 'empty land';
    if (g.borders(me, o)) {
      err = g.attack(me, o, troops);
      if (!err) this.toast(`⚔️ ${fmtTroops(troops)} troops attacking ${name}`, 'info');
    } else if (this.map.coast[cell]) {
      err = g.boat(me, cell, troops);
    } else {
      err = o >= 0 ? `You don't border ${name}. Tap one of their coasts to send a boat.` : 'Too far away. Tap a coast to send a boat.';
    }
    if (err) { this.toast(err, 'warn'); buzz(30); return; }
    r.ping(cell, o >= 0 ? '#ff6b6b' : '#ffffff');
    buzz(15);
    this.emit();
  }

  private longPress(sx: number, sy: number) {
    const g = this.game, r = this.renderer;
    if (!g || !r || this.screen !== 'game') return;
    const cell = r.cellAt(sx, sy);
    if (cell < 0) return;
    const o = g.s.owner[cell];
    if (o >= 0) { buzz(12); this.open('info', o); }
  }

  /** New game screen: choose a country (or a landing spot). */
  private pickAt(cell: number) {
    const g = this.game, r = this.renderer;
    if (!g || !r || cell < 0 || this.map.prov[cell] < 0) return;
    const o = g.s.owner[cell];
    if (MODE_BY_ID[this.newMode].start === 'spawn') {
      if (o !== -1) return this.toast(o >= 0 ? 'Someone already lives there — pick empty land.' : 'That land is not in play.', 'warn');
      this.pick = cell;
      r.hover = cell;
    } else {
      if (o < 0) return this.toast('That land is not in play — pick a highlighted country.', 'warn');
      this.pick = o;
      r.hover = -1;
      // light up the chosen country in gold
      const prev = g.s.player;
      g.s.player = o;
      r.refreshColors();
      g.s.player = prev;
    }
    r.ping(cell, '#ffd23f');
    buzz(10);
    r.touch();
    this.emit();
  }

  // ------------------------------------------------------------ popups
  popup() {
    const g = this.game;
    if (!g || this.screen !== 'game' || g.s.over) return null;
    return g.s.offers[0] ?? null;
  }
  answer(accept: boolean) {
    const g = this.game, o = this.popup();
    if (!g || !o) return;
    g.respondOffer(o.id, accept);
    this.toast(accept ? `🤝 You are now allied with ${g.s.players[o.from].name}.` : 'Maybe another time.', accept ? 'good' : 'info');
    buzz(12);
  }

  // ------------------------------------------------------------ lifecycle
  private onPause() {
    if (!this.game || this.game.s.over || this.screen !== 'game') return;
    this.save('autosave');
    if (this.speed > 0) { this.resumeSpeed = this.speed; this.speed = 0; this.emit(); }
  }
  resume() {
    if (this.resumeSpeed) { this.setSpeed(this.resumeSpeed); this.resumeSpeed = 0; }
  }
  private onBack(): boolean {
    if (this.panel) { this.panel = null; this.emit(); return true; }
    if (this.screen === 'game') { this.panel = 'menu'; this.setSpeed(0); return true; }
    if (this.screen === 'newgame') { this.quitToMenu(); return true; }
    return false;
  }
}

export const ctl = new Controller();

export function useCtl() {
  const [, set] = useState(0);
  useEffect(() => ctl.subscribe(() => set((v) => v + 1)), []);
  return ctl;
}
