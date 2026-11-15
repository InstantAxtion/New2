import type { Game, Phase } from '../game';
import type { UI } from '../ui';
import type { Controls } from '../drive';
import type { Biome } from '../world/biomes';
import { saveSettings } from '../settings';
import { STAMPS } from '../stats';

// The plumbing the add-on features (src/x/*) share: frame hooks, a hub screen of tiles, settings
// groups, sheets and toasts. Each feature group lives in its own folder and plugs in through here,
// so the core game loop and the main UI stay as they are.

/** A feature that takes part in the frame. Everything is optional. */
export interface Extra {
  /** Every frame, after the car has moved and before the camera. `dt` is game time (0 while frozen), `rdt` real time. */
  update?(dt: number, rdt: number): void;
  /** After the normal camera has been placed: move the camera if you like. Return true if you took it over. */
  camera?(dt: number, rdt: number): boolean | void;
  /** Just before the picture is drawn (set shader uniforms and the like). */
  preRender?(dt: number, rdt: number): void;
  /** Change the controls for this frame (drive modes, cruise…). Runs for manual and auto-drive. */
  controls?(c: Controls, dt: number): Controls;
  /** The world was rebuilt (new road, new regions, travelled somewhere). */
  onWorld?(): void;
}

export interface HubTile {
  id: string;
  icon: string;
  label: string;
  /** A short line under the label. */
  sub?: string;
  /** Where the tile makes sense. Default: both. */
  where?: ('garage' | 'drive')[];
  /** Order: lower comes first. */
  order?: number;
  run: () => void;
}

export interface Ctx {
  game: Game;
  ui: UI;
  /** Add a feature to the frame loop. */
  use(e: Extra): void;
  /** Listen for game events: 'phase' (Phase), 'region' (Biome), 'stamp' (key), 'world', 'refuel', 'ferry' (boolean), 'sleep', 'car' (id). */
  on(name: string, fn: (detail: unknown) => void): void;
  emit(name: string, detail?: unknown): void;
  /** A tile on the ✨ More screen. */
  tile(t: HubTile): void;
  /** A slide-in sheet (same look as Settings). Returns its body element. Open with `open(id)`. */
  sheet(id: string, title: string, bodyHtml?: string): HTMLElement;
  open(id: string): void;
  close(id: string): void;
  toast(html: string): void;
  /** A group in the Settings sheet. Returns the section to fill. */
  settingsGroup(title: string): HTMLElement;
  /** A row of choice chips bound to `settings.x[group][key]`. `onChange` runs after saving. */
  seg(parent: HTMLElement, label: string, group: string, key: string, options: [string | number | boolean, string][], onChange?: (v: unknown) => void): HTMLElement;
  /** A slider bound to `settings.x[group][key]`. */
  range(parent: HTMLElement, label: string, group: string, key: string, min: number, max: number, step: number, onChange?: (v: number) => void, fmt?: (v: number) => string): HTMLInputElement;
  /** Passport stamps this feature can award (shown in the passport). Award with `stamp(key)`. */
  stamps(list: { key: string; icon: string; name: string }[]): void;
  /** Award a stamp (toast the first time). True the first time. */
  stamp(key: string): boolean;
  save(): void;
  /** Miles or km text for a distance in metres, in the player's units. */
  dist(m: number, digits?: number): string;
  /** Speed text in the player's units from m/s. */
  speed(ms: number): string;
}

const listeners = new Map<string, ((d: unknown) => void)[]>();
const tiles: HubTile[] = [];

export function makeCtx(game: Game, ui: UI): Ctx {
  const root = document.getElementById('ui')!;
  const s = game.settings as unknown as { x: Record<string, Record<string, unknown>>; units: string };
  const u = ui as unknown as { toast(h: string): void; open(id: string): void; close(id: string): void };
  const refreshers: (() => void)[] = [];
  const ctx: Ctx = {
    game,
    ui,
    use: (e) => void game.extras.push(e),
    on: (name, fn) => void (listeners.get(name) ?? listeners.set(name, []).get(name)!).push(fn),
    emit: (name, detail) => {
      for (const fn of listeners.get(name) ?? []) {
        try { fn(detail); } catch (e) { console.warn('Listener error', name, e); }
      }
    },
    tile: (t) => void tiles.push(t),
    sheet: (id, title, bodyHtml = '') => {
      const el = document.createElement('aside');
      el.id = id;
      el.className = 'sheet hidden';
      el.innerHTML = `<div class="sheet-head"><h2>${title}</h2><button class="icon" aria-label="Close">✕</button></div><div class="sheet-body">${bodyHtml}</div>`;
      (el.querySelector('.sheet-head .icon') as HTMLElement).onclick = () => ctx.close(id);
      root.appendChild(el);
      return el.querySelector('.sheet-body') as HTMLElement;
    },
    open: (id) => u.open(id),
    close: (id) => u.close(id),
    toast: (html) => u.toast(html),
    settingsGroup: (title) => {
      const sec = document.createElement('section');
      sec.className = 'sgroup';
      sec.innerHTML = `<h3>${title}</h3>`;
      const body = document.querySelector('#settings .sheet-body')!;
      body.insertBefore(sec, body.querySelector('.version'));
      return sec;
    },
    seg: (parent, label, group, key, options, onChange) => {
      const row = document.createElement('div');
      row.className = 'srow' + (options.length > 4 ? ' col' : '');
      row.innerHTML = `<span>${label}</span><div class="seg${options.length > 4 ? ' wrap' : ''}">${options.map(([v, l]) => `<button class="chip" data-xv="${String(v)}">${l}</button>`).join('')}</div>`;
      const btns = [...row.querySelectorAll<HTMLElement>('[data-xv]')];
      const refresh = () => btns.forEach((b, i) => b.classList.toggle('on', s.x[group][key] === options[i][0]));
      btns.forEach((b, i) => {
        b.onclick = () => {
          s.x[group][key] = options[i][0];
          ctx.save();
          refresh();
          onChange?.(options[i][0]);
        };
      });
      refreshers.push(refresh);
      refresh();
      parent.appendChild(row);
      return row;
    },
    range: (parent, label, group, key, min, max, step, onChange, fmt) => {
      const row = document.createElement('label');
      row.className = 'srow';
      row.innerHTML = `<span>${label}</span><div class="range-row"><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label.replace(/<[^>]+>/g, '')}" /><span class="xr-val"></span></div>`;
      const el = row.querySelector('input')!;
      const val = row.querySelector('.xr-val') as HTMLElement;
      const refresh = () => {
        el.value = String(s.x[group][key]);
        val.textContent = fmt ? fmt(Number(s.x[group][key])) : '';
      };
      el.oninput = () => {
        s.x[group][key] = Number(el.value);
        ctx.save();
        val.textContent = fmt ? fmt(Number(el.value)) : '';
        onChange?.(Number(el.value));
      };
      refreshers.push(refresh);
      refresh();
      parent.appendChild(row);
      return el;
    },
    stamps: (list) => {
      for (const st of list) if (!STAMPS.some((x) => x.key === st.key)) STAMPS.push(st);
    },
    stamp: (key) => {
      if (!game.stats.stamp(key)) return false;
      game.onStamp(key);
      ctx.emit('stamp', key);
      return true;
    },
    save: () => saveSettings(game.settings),
    dist: (m, digits = 1) => (s.units === 'mph' ? `${(m / 1609.344).toFixed(digits)} mi` : `${(m / 1000).toFixed(digits)} km`),
    speed: (ms) => (s.units === 'mph' ? `${Math.round(ms * 2.23694)} mph` : `${Math.round(ms * 3.6)} km/h`),
  };
  // Pass the game's own callbacks on as events
  const g = game as unknown as Record<string, (...a: unknown[]) => unknown>;
  const wrap = (prop: string, name: string, after?: () => void) => {
    const old = g[prop];
    g[prop] = function (this: unknown, ...a: unknown[]) {
      const r = old.apply(game, a);
      ctx.emit(name, a[0]);
      after?.();
      return r;
    };
  };
  wrap('onFerry', 'ferry');
  wrap('onRefuel', 'refuel');
  wrap('onSleep', 'sleep');
  wrap('setCar', 'car');
  wrap('rebuildWorld', 'world', () => {
    for (const e of game.extras) {
      try { e.onWorld?.(); } catch (err) { console.warn('Extra error', err); }
    }
  });
  (ctx as unknown as { refreshAll: () => void }).refreshAll = () => refreshers.forEach((f) => f());
  return ctx;
}

/** Re-read every bound settings control (after a backup is restored, a preset applied…). */
export function refreshControls(ctx: Ctx) {
  (ctx as unknown as { refreshAll: () => void }).refreshAll();
}

/** Build the ✨ More screen and its buttons (called once every feature has registered its tiles). */
export function mountHub(ctx: Ctx) {
  const body = ctx.sheet('hub', '✨ More');
  body.classList.add('hub-body');
  const render = () => {
    const where = ctx.game.phase === 'garage' ? 'garage' : 'drive';
    const list = tiles.filter((t) => !t.where || t.where.includes(where)).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    body.innerHTML = `<div class="hub-grid">${list.map((t) => `<button class="tile hub-tile" data-hub="${t.id}"><i>${t.icon}</i><span>${t.label}</span>${t.sub ? `<small>${t.sub}</small>` : ''}</button>`).join('')}</div>`;
    for (const b of body.querySelectorAll<HTMLElement>('[data-hub]')) {
      b.onclick = () => {
        ctx.close('hub');
        tiles.find((t) => t.id === b.dataset.hub)?.run();
      };
    }
  };
  const openHub = () => {
    render();
    document.getElementById('hud-menu')?.classList.remove('on');
    ctx.open('hub');
  };
  // Garage header, the drive menu and the pause screen each get a way in
  const top = document.querySelector('#garage .top-btns');
  if (top) {
    const b = document.createElement('button');
    b.className = 'icon';
    b.id = 'hub-btn';
    b.setAttribute('aria-label', 'More');
    b.textContent = '✨';
    b.onclick = openHub;
    top.insertBefore(b, top.firstChild);
  }
  const grid = document.querySelector('#hud-menu .menu-grid');
  if (grid) {
    const b = document.createElement('button');
    b.className = 'pad small';
    b.id = 'hub-menu-btn';
    b.setAttribute('aria-label', 'More');
    b.innerHTML = '✨<span>More</span>';
    b.onclick = openHub;
    grid.insertBefore(b, grid.firstChild);
  }
  const pauseRow = document.querySelector('#pause .tile-row');
  if (pauseRow) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.id = 'hub-pause-btn';
    b.innerHTML = '<i>✨</i><span>More</span>';
    b.onclick = openHub;
    pauseRow.appendChild(b);
    pauseRow.classList.remove('four');
    pauseRow.classList.add('five');
  }
}

export type { Game, Phase, UI, Controls, Biome };
