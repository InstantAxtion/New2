import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { App } from '@capacitor/app';
import type { Game } from './game';
import { CARS, COLORS } from './cars';
import { BIOMES, BIOME_IDS, type BiomeId } from './world/biomes';
import type { TimeMode } from './sky';
import { CAM_LABEL, CAM_MODES } from './camera';
import { saveSettings, type Settings } from './settings';
import { appUri, embedUrl, fetchTitle, loadSaved, parseSpotify, saveList, webUrl, type SpotifyRef } from './spotify';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TIMES: { id: TimeMode; label: string }[] = [
  { id: 'cycle', label: '🔄 Day cycle' },
  { id: 'dawn', label: '🌅 Dawn' },
  { id: 'day', label: '☀️ Day' },
  { id: 'sunset', label: '🌇 Sunset' },
  { id: 'night', label: '🌙 Night' },
];

export class UI {
  private s: Settings;
  private root = $('#ui');
  private zen = false;
  private toastTimer = 0;
  private current: SpotifyRef | null = null;
  private tiltZero: number | null = null;
  private tilt = 0;
  private keys = new Set<string>();
  private held = { left: false, right: false, gas: false, brake: false };

  constructor(private game: Game) {
    this.s = game.settings;
    this.root.innerHTML = this.template();
    this.bindGarage();
    this.bindHud();
    this.bindMusic();
    this.bindSettings();
    this.bindInput();
    this.refreshGarage();
    this.refreshHud();
    this.show('garage');
    game.onRegion = (b) => {
      $('#region').textContent = `${b.emoji} ${b.name}`;
      if (game.phase === 'drive') this.toast(`Now entering<b>${b.emoji} ${b.name}</b>`);
    };
    setInterval(() => this.tick(), 100);
    window.addEventListener('resize', () => this.frameGarage());
    requestAnimationFrame(() => this.frameGarage());
    if (Capacitor.isNativePlatform()) {
      void App.addListener('backButton', () => this.back());
      void App.addListener('pause', () => game.engine.suspend());
      void App.addListener('resume', () => game.phase === 'drive' && game.engine.start());
    }
  }

  private save() {
    saveSettings(this.s);
  }

  private template() {
    const themeChips = BIOME_IDS.map(
      (id) => `<button class="chip" data-theme="${id}">${BIOMES[id].emoji} ${BIOMES[id].name}</button>`,
    ).join('');
    const timeChips = TIMES.map((t) => `<button class="chip" data-time="${t.id}">${t.label}</button>`).join('');
    const swatches = COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${hex(c)}" aria-label="colour"></button>`).join('');
    return `
<section id="garage" class="screen">
  <header class="title"><h1>Endless Drive</h1><div class="top-btns">
    <button class="icon" data-open="music" aria-label="Music">🎵</button>
    <button class="icon" data-open="settings" aria-label="Settings">⚙️</button></div></header>
  <div class="garage-body">
    <div class="card car-card">
      <div class="car-pick">
        <button class="icon big" id="car-prev" aria-label="Previous car">‹</button>
        <div class="car-name"><h2 id="car-name"></h2><p id="car-blurb"></p></div>
        <button class="icon big" id="car-next" aria-label="Next car">›</button>
      </div>
      <div class="stats" id="car-stats"></div>
      <div class="swatches">${swatches}</div>
    </div>
    <div class="card world-card">
      <h3>World <small>pick one or more · none = all</small></h3>
      <div class="chips" id="themes"><button class="chip" data-theme="all">🌍 All</button>${themeChips}</div>
      <h3>Time of day</h3>
      <div class="chips" id="times">${timeChips}</div>
      <h3>How to drive</h3>
      <div class="chips" id="modes">
        <button class="chip" data-mode="cruise">🕹️ I drive</button>
        <button class="chip" data-mode="auto">🤖 Auto-drive</button>
      </div>
      <div class="go-row">
        <button class="ghost" id="new-world">🎲 New road</button>
        <button class="go" id="go">Drive ▶</button>
      </div>
    </div>
  </div>
</section>

<section id="hud" class="screen">
  <div class="hud-tl">
    <div class="pill" id="region"></div>
    <div class="pill small"><span id="odo">0.0 km</span> · <span id="clock">09:00</span></div>
  </div>
  <div class="hud-tr">
    <button class="icon" data-open="music" aria-label="Music">🎵</button>
    <button class="icon wide" id="cam-btn">🎥 <span id="cam-label"></span></button>
    <button class="icon wide" id="mode-btn"></button>
    <button class="icon" id="zen-btn" aria-label="Hide controls">👁️</button>
    <button class="icon" id="pause-btn" aria-label="Pause">⏸</button>
  </div>
  <div class="speedo"><b id="speed">0</b><span id="unit">km/h</span><em id="speed-note"></em></div>
  <div class="manual">
    <div class="steer" id="steer-btns">
      <button class="pad" data-hold="left" aria-label="Steer left">◀</button>
      <button class="pad" data-hold="right" aria-label="Steer right">▶</button>
    </div>
    <div class="tilt-note" id="tilt-note">Tilt to steer<button class="ghost small" id="tilt-zero">Re-centre</button></div>
    <div class="pedals">
      <button class="pad brake" data-hold="brake" aria-label="Brake">BRAKE</button>
      <button class="pad gas" data-hold="gas" aria-label="Gas">GAS</button>
    </div>
  </div>
  <div class="auto">
    <button class="pad small" id="lane-btn" aria-label="Change lane">⇆<span>Lane</span></button>
    <div class="cruise">
      <button class="pad small" id="slower" aria-label="Slower">−</button>
      <div class="cruise-val"><b id="cruise">80</b><span>cruise</span></div>
      <button class="pad small" id="faster" aria-label="Faster">+</button>
    </div>
  </div>
  <div class="toast" id="toast"></div>
</section>

<section id="pause" class="screen modal">
  <div class="card menu">
    <h2>Paused</h2>
    <button class="go" id="resume">Keep driving ▶</button>
    <button class="ghost" id="to-garage">🚗 Garage &amp; world</button>
    <button class="ghost" data-open="music">🎵 Music</button>
    <button class="ghost" data-open="settings">⚙️ Settings</button>
  </div>
</section>

<aside id="music" class="sheet hidden">
  <div class="sheet-head"><h2>🎵 Music</h2><button class="icon" data-close="music" aria-label="Close">✕</button></div>
  <div class="sheet-body">
    <div class="row"><input id="sp-input" type="url" inputmode="url" placeholder="Paste a Spotify playlist link" autocomplete="off" />
      <button class="go small" id="sp-load">Play</button></div>
    <div class="row"><button class="ghost small" id="sp-paste">📋 Paste</button>
      <button class="ghost small" id="sp-app" disabled>Open in Spotify app ↗</button></div>
    <p class="error" id="sp-error"></p>
    <div id="sp-player"><p class="hint">In Spotify, open a playlist → ⋯ → Share → <b>Copy link</b>, then paste it here.</p></div>
    <div id="sp-saved"></div>
    <p class="hint">The built-in player plays previews unless you're logged in to Spotify in it. For full songs tap <b>Open in Spotify app</b> and come back — the music keeps playing while you drive.</p>
  </div>
</aside>

<aside id="settings" class="sheet hidden">
  <div class="sheet-head"><h2>⚙️ Settings</h2><button class="icon" data-close="settings" aria-label="Close">✕</button></div>
  <div class="sheet-body">
    <h3>Graphics</h3>
    <div class="chips" data-set="quality"><button class="chip" data-v="low">Low</button><button class="chip" data-v="medium">Medium</button><button class="chip" data-v="high">High</button></div>
    <h3>Speed units</h3>
    <div class="chips" data-set="units"><button class="chip" data-v="kmh">km/h</button><button class="chip" data-v="mph">mph</button></div>
    <h3>Steering</h3>
    <div class="chips" data-set="steering"><button class="chip" data-v="buttons">◀ ▶ Buttons</button><button class="chip" data-v="tilt">📱 Tilt phone</button></div>
    <div class="chips" data-set="assist"><button class="chip" data-v="true">Lane assist on</button><button class="chip" data-v="false">Off</button></div>
    <h3>World</h3>
    <div class="chips" data-set="traffic"><button class="chip" data-v="true">🚙 Traffic</button><button class="chip" data-v="false">Empty roads</button></div>
    <div class="chips" data-set="clouds"><button class="chip" data-v="true">☁️ Clouds</button><button class="chip" data-v="false">Clear skies</button></div>
    <h3>Engine sound</h3>
    <input type="range" id="volume" min="0" max="1" step="0.05" />
  </div>
</aside>`;
  }

  // ---------- Screens ----------

  private show(id: 'garage' | 'hud' | 'pause') {
    for (const s of $$('.screen', this.root)) s.classList.toggle('on', s.id === id || (id === 'pause' && s.id === 'hud'));
    document.body.dataset.screen = id;
    if (id === 'garage') requestAnimationFrame(() => this.frameGarage());
  }

  /** Put the car in the biggest gap the garage menus leave. */
  private frameGarage() {
    const w = window.innerWidth, h = window.innerHeight;
    const head = $('#garage .title').getBoundingClientRect();
    const car = $('.car-card').getBoundingClientRect();
    const world = $('.world-card').getBoundingClientRect();
    const top = head.bottom;
    if (w > h) {
      // Landscape: above the car card, left of the world card
      const right = world.left;
      const bottom = car.top;
      this.game.rig.focus = { x: right / 2, y: (top + bottom) / 2, size: Math.min(right * 0.75, (bottom - top) * 1.5) };
    } else {
      const bottom = Math.min(car.top, world.top);
      this.game.rig.focus = { x: w / 2, y: (top + bottom) / 2, size: Math.min(w * 0.75, (bottom - top) * 1.5) };
    }
  }

  private open(id: string) {
    for (const s of $$('.sheet', this.root)) s.classList.toggle('hidden', s.id !== id);
  }

  private close(id: string) {
    $('#' + id).classList.add('hidden');
  }

  private back() {
    const openSheet = $$('.sheet', this.root).find((s) => !s.classList.contains('hidden'));
    if (openSheet) return this.close(openSheet.id);
    if (this.zen) return this.setZen(false);
    if (this.game.phase === 'drive') return this.pause();
    if (this.game.phase === 'paused') return this.resume();
    void App.exitApp();
  }

  private pause() {
    this.game.pause();
    this.show('pause');
  }

  private resume() {
    this.game.startDrive();
    this.show('hud');
  }

  private toast(html: string) {
    const t = $('#toast');
    t.innerHTML = html;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('on'), 3200);
  }

  private setZen(on: boolean) {
    this.zen = on;
    document.body.classList.toggle('zen', on);
    if (on && !this.s.auto) {
      this.s.auto = true;
      this.save();
      this.refreshHud();
    }
    if (on) this.game.vehicle.lane = this.game.vehicle.nearestLane();
  }

  // ---------- Garage ----------

  private bindGarage() {
    const r = this.root;
    const step = (d: number) => {
      const i = CARS.findIndex((c) => c.id === this.s.car);
      this.s.car = CARS[(i + d + CARS.length) % CARS.length].id;
      this.game.setCar(this.s.car);
      this.save();
      this.refreshGarage();
    };
    $('#car-prev', r).onclick = () => step(-1);
    $('#car-next', r).onclick = () => step(1);
    for (const b of $$('[data-color]', r)) {
      b.onclick = () => {
        const c = Number(b.dataset.color);
        this.s.colors[this.s.car] = c;
        this.game.setColor(c);
        this.save();
        this.refreshGarage();
      };
    }
    for (const b of $$('[data-theme]', r)) {
      b.onclick = () => {
        const id = b.dataset.theme!;
        if (id === 'all') this.s.themes = [];
        else {
          const t = new Set(this.s.themes);
          if (t.has(id as BiomeId)) t.delete(id as BiomeId);
          else t.add(id as BiomeId);
          this.s.themes = BIOME_IDS.filter((x) => t.has(x));
          if (this.s.themes.length === BIOME_IDS.length) this.s.themes = [];
        }
        this.game.setThemes(this.s.themes);
        this.save();
        this.refreshGarage();
      };
    }
    for (const b of $$('[data-time]', r)) {
      b.onclick = () => {
        this.s.time = b.dataset.time as TimeMode;
        if (this.s.time === 'cycle') this.game.hour = 9;
        this.save();
        this.refreshGarage();
      };
    }
    for (const b of $$('[data-mode]', r)) {
      b.onclick = () => {
        this.s.auto = b.dataset.mode === 'auto';
        this.save();
        this.refreshGarage();
        this.refreshHud();
      };
    }
    $('#new-world', r).onclick = () => {
      this.game.newWorld();
      this.toast('A brand new road 🎲');
    };
    $('#go', r).onclick = () => {
      this.game.startDrive();
      this.show('hud');
      this.recentreTilt();
      const b = this.game.region;
      if (b) this.toast(`${b.emoji} ${b.name}<b>${this.s.auto ? 'Sit back and enjoy the view' : 'Hold GAS to go'}</b>`);
    };
    for (const b of $$('[data-open]', r)) b.onclick = () => this.open(b.dataset.open!);
    for (const b of $$('[data-close]', r)) b.onclick = () => this.close(b.dataset.close!);
  }

  private refreshGarage() {
    const spec = CARS.find((c) => c.id === this.s.car) ?? CARS[0];
    $('#car-name').textContent = spec.name;
    $('#car-blurb').textContent = spec.blurb;
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`;
    $('#car-stats').innerHTML =
      bar('Top speed', (spec.top - 100) / 160) + bar('Acceleration', spec.accel / 8) + bar('Grip', spec.grip / 10);
    const col = this.s.colors[spec.id] ?? spec.defaultColor;
    for (const b of $$('[data-color]')) b.classList.toggle('on', Number(b.dataset.color) === col);
    for (const b of $$('[data-theme]')) {
      const id = b.dataset.theme!;
      b.classList.toggle('on', id === 'all' ? this.s.themes.length === 0 : this.s.themes.includes(id as BiomeId));
    }
    for (const b of $$('[data-time]')) b.classList.toggle('on', b.dataset.time === this.s.time);
    for (const b of $$('[data-mode]')) b.classList.toggle('on', (b.dataset.mode === 'auto') === this.s.auto);
  }

  // ---------- HUD ----------

  private bindHud() {
    const r = this.root;
    $('#pause-btn', r).onclick = () => this.pause();
    $('#resume', r).onclick = () => this.resume();
    $('#to-garage', r).onclick = () => {
      this.game.toGarage();
      this.show('garage');
      this.refreshGarage();
    };
    $('#cam-btn', r).onclick = () => {
      const i = CAM_MODES.indexOf(this.s.cam);
      this.s.cam = CAM_MODES[(i + 1) % CAM_MODES.length];
      this.game.rig.mode = this.s.cam;
      this.game.rig.reset();
      this.save();
      this.refreshHud();
    };
    $('#mode-btn', r).onclick = () => {
      this.s.auto = !this.s.auto;
      const v = this.game.vehicle;
      if (this.s.auto) {
        v.lane = v.nearestLane();
        if (v.v > 8) v.cruise = Math.round((v.v * 3.6) / 10) * 10 / 3.6 || v.cruise;
        this.s.cruiseKmh = Math.round(v.cruise * 3.6);
      }
      this.toast(this.s.auto ? '🤖 Auto-drive on' : '🕹️ You have the wheel');
      this.save();
      this.refreshHud();
    };
    $('#zen-btn', r).onclick = (e) => {
      e.stopPropagation();
      this.setZen(true);
      this.toast('Tap anywhere to bring the controls back');
    };
    const cruise = (d: number) => {
      this.s.cruiseKmh = Math.max(20, Math.min(Math.round(this.game.spec.top / 10) * 10, this.s.cruiseKmh + d));
      this.game.vehicle.cruise = this.s.cruiseKmh / 3.6;
      this.save();
      this.refreshHud();
    };
    $('#slower', r).onclick = () => cruise(-10);
    $('#faster', r).onclick = () => cruise(10);
    $('#lane-btn', r).onclick = () => (this.game.vehicle.lane *= -1);
    $('#tilt-zero', r).onclick = () => this.recentreTilt();
  }

  private refreshHud() {
    $('#cam-label').textContent = CAM_LABEL[this.s.cam];
    $('#mode-btn').textContent = this.s.auto ? '🤖 Auto' : '🕹️ Manual';
    document.body.classList.toggle('auto-mode', this.s.auto);
    document.body.classList.toggle('tilt-mode', this.s.steering === 'tilt');
    $('#unit').textContent = this.s.units === 'mph' ? 'mph' : 'km/h';
    const k = this.s.units === 'mph' ? 0.621371 : 1;
    $('#cruise').textContent = String(Math.round(this.s.cruiseKmh * k));
  }

  private tick() {
    const g = this.game;
    const v = g.vehicle;
    const k = this.s.units === 'mph' ? 0.621371 : 1;
    $('#speed').textContent = String(Math.round(Math.abs(v.v) * 3.6 * k));
    $('#speed-note').textContent = v.v < -0.5 ? 'R' : v.offroad ? 'off-road' : '';
    $('#odo').textContent = `${((v.odometer / 1000) * k).toFixed(1)} ${this.s.units === 'mph' ? 'mi' : 'km'}`;
    const h = g.hour;
    $('#clock').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    if (g.struggling() && this.s.quality !== 'low') {
      this.s.quality = this.s.quality === 'high' ? 'medium' : 'low';
      g.setQuality(this.s.quality);
      this.save();
      this.refreshSettings();
      this.toast(`Graphics lowered to ${this.s.quality} to keep things smooth`);
    }
  }

  // ---------- Input ----------

  private bindInput() {
    const r = this.root;
    for (const b of $$('[data-hold]', r)) {
      const key = b.dataset.hold as keyof UI['held'];
      const on = (e: PointerEvent) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        this.held[key] = true;
        b.classList.add('down');
        this.game.engine.start();
        this.updateInput();
      };
      const off = () => {
        this.held[key] = false;
        b.classList.remove('down');
        this.updateInput();
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Drag on the scene to look around; tap to leave zen mode
    const canvas = $('#view') as HTMLCanvasElement;
    let px = 0, py = 0, moved = 0, dragId = -1;
    canvas.addEventListener('pointerdown', (e) => {
      dragId = e.pointerId;
      px = e.clientX; py = e.clientY; moved = 0;
      this.game.rig.dragging = true;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      moved += Math.abs(dx) + Math.abs(dy);
      px = e.clientX; py = e.clientY;
      this.game.rig.drag(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      dragId = -1;
      this.game.rig.dragging = false;
      if (moved < 8 && this.zen) this.setZen(false);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'c') $('#cam-btn').click();
      if (e.key === 'h') this.setZen(!this.zen);
      if (e.key === 'm') this.open('music');
      if (e.key === ' ') $('#mode-btn').click();
      if (e.key === 'Escape') this.back();
      this.updateInput();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      this.updateInput();
    });

    window.addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      const angle = screen.orientation?.angle ?? 0;
      // Turning the phone like a steering wheel
      let raw: number;
      if (angle === 90) raw = e.beta;
      else if (angle === 270 || angle === -90) raw = -e.beta;
      else raw = e.gamma;
      if (this.tiltZero === null) this.tiltZero = raw;
      this.tilt = Math.max(-1, Math.min(1, (raw - this.tiltZero) / 22));
      if (this.s.steering === 'tilt') this.updateInput();
    });
  }

  private recentreTilt() {
    this.tiltZero = null;
  }

  private updateInput() {
    const k = this.keys;
    const left = this.held.left || k.has('arrowleft') || k.has('a');
    const right = this.held.right || k.has('arrowright') || k.has('d');
    const gas = this.held.gas || k.has('arrowup') || k.has('w');
    const brake = this.held.brake || k.has('arrowdown') || k.has('s');
    let steer = (right ? 1 : 0) - (left ? 1 : 0);
    if (this.s.steering === 'tilt' && !left && !right) {
      steer = Math.abs(this.tilt) < 0.06 ? 0 : this.tilt;
    }
    this.game.input = { steer, throttle: gas ? 1 : 0, brake: brake ? 1 : 0 };
  }

  // ---------- Music ----------

  private bindMusic() {
    const input = $<HTMLInputElement>('#sp-input');
    const load = () => {
      const r = parseSpotify(input.value);
      if (!r.ok) {
        $('#sp-error').textContent = r.error;
        return;
      }
      $('#sp-error').textContent = '';
      this.play(r.ref);
      input.value = '';
      input.blur();
    };
    $('#sp-load').onclick = load;
    input.addEventListener('keydown', (e) => e.key === 'Enter' && load());
    $('#sp-paste').onclick = async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (t) {
          input.value = t;
          load();
          return;
        }
      } catch {
        /* clipboard not allowed: fall back to the keyboard */
      }
      input.focus();
      $('#sp-error').textContent = 'Long-press the box and choose Paste.';
    };
    $('#sp-app').onclick = () => this.current && void this.openInApp(this.current);
    this.renderSaved();
    const last = loadSaved()[0];
    if (last) this.play(last.ref, false);
  }

  private play(ref: SpotifyRef, remember = true) {
    this.current = ref;
    const tall = window.innerHeight > 560;
    $('#sp-player').innerHTML = `<iframe title="Spotify player" src="${embedUrl(ref)}" width="100%" height="${tall ? 352 : 152}" frameborder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
    $<HTMLButtonElement>('#sp-app').disabled = false;
    if (!remember) return;
    const list = loadSaved().filter((x) => x.ref.id !== ref.id);
    list.unshift({ ref, name: `Spotify ${ref.kind}` });
    saveList(list);
    this.renderSaved();
    void fetchTitle(ref).then((title) => {
      if (!title) return;
      const l = loadSaved();
      const item = l.find((x) => x.ref.id === ref.id);
      if (item) {
        item.name = title;
        saveList(l);
        this.renderSaved();
      }
    });
  }

  private renderSaved() {
    const list = loadSaved();
    const el = $('#sp-saved');
    if (!list.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      '<h3>Your music</h3>' +
      list
        .map(
          (x, i) =>
            `<div class="saved"><button class="chip" data-play="${i}">▶ ${esc(x.name)}</button><button class="icon tiny" data-forget="${i}" aria-label="Remove">✕</button></div>`,
        )
        .join('');
    for (const b of $$('[data-play]', el)) b.onclick = () => this.play(list[Number(b.dataset.play)].ref);
    for (const b of $$('[data-forget]', el)) {
      b.onclick = () => {
        saveList(list.filter((_, i) => i !== Number(b.dataset.forget)));
        this.renderSaved();
      };
    }
  }

  private async openInApp(ref: SpotifyRef) {
    if (Capacitor.isNativePlatform()) {
      try {
        const r = await AppLauncher.openUrl({ url: appUri(ref) });
        if (r.completed) return;
      } catch {
        /* Spotify not installed: use the web link */
      }
      try {
        await AppLauncher.openUrl({ url: webUrl(ref) });
        return;
      } catch {
        /* fall through */
      }
    }
    window.open(webUrl(ref), '_blank');
  }

  // ---------- Settings ----------

  private bindSettings() {
    for (const group of $$('[data-set]', this.root)) {
      const key = group.dataset.set as keyof Settings;
      for (const b of $$('[data-v]', group)) {
        b.onclick = () => {
          const raw = b.dataset.v!;
          const val = raw === 'true' ? true : raw === 'false' ? false : raw;
          (this.s as unknown as Record<string, unknown>)[key] = val;
          this.save();
          this.applySetting(key);
          this.refreshSettings();
          this.refreshHud();
        };
      }
    }
    const vol = $<HTMLInputElement>('#volume');
    vol.oninput = () => {
      this.s.volume = Number(vol.value);
      this.game.engine.volume = this.s.volume;
      this.save();
    };
    this.game.engine.volume = this.s.volume;
    this.refreshSettings();
  }

  private applySetting(key: keyof Settings) {
    const g = this.game;
    if (key === 'quality') g.setQuality(this.s.quality);
    if (key === 'traffic') {
      g.traffic.enabled = this.s.traffic;
      if (!this.s.traffic) g.traffic.clear();
    }
    if (key === 'clouds') g.sky.setClouds(this.s.clouds);
    if (key === 'steering') this.recentreTilt();
  }

  private refreshSettings() {
    for (const group of $$('[data-set]', this.root)) {
      const key = group.dataset.set as keyof Settings;
      for (const b of $$('[data-v]', group)) b.classList.toggle('on', String(this.s[key]) === b.dataset.v);
    }
    $<HTMLInputElement>('#volume').value = String(this.s.volume);
  }
}
