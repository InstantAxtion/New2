import { Capacitor, registerPlugin } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { App } from '@capacitor/app';
import type { Game } from './game';
import { CARS, COLORS } from './cars';
import { AMBIENTS, LEATHERS, RIM_COLORS, STARTERS, UNLOCK_MILES, defaultCustom, type Custom } from './carspecs';
import { DECALS, defaultPlate } from './carextras';
import { BIOMES, BIOME_IDS, type BiomeId } from './world/biomes';
import type { TimeMode } from './sky';
import { CAM_LABEL, CAM_MODES } from './camera';
import { saveSettings, type Settings } from './settings';
import { appUri, embedUrl, fetchTitle, loadSaved, parseSpotify, saveList, webUrl, type SpotifyRef } from './spotify';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { MusicVideos } from './music';
import { fetchSongs } from './tracks';
import { KeyError, QuotaError, channelPlaylists, parseYouTube, searchYouTube, type YtResult } from './youtube';
import { Radio, STATIONS } from './radio';
import { SCAPES, Soundscape, type ScapeId } from './soundscape';
import { PodcastPlayer, loadEpisodes, searchBooks, searchShows } from './podcasts';
import { fetchLyrics, lineAt, type Line } from './lyrics';
import { STAMPS } from './stats';


const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Native in-app Spotify login (see SpotifyLoginPlugin.java). */
interface SpotifyLoginApi {
  status(): Promise<{ loggedIn: boolean }>;
  open(): Promise<{ loggedIn: boolean }>;
  logout(): Promise<{ loggedIn: boolean }>;
  addListener(e: 'loginFinished', f: (r: { loggedIn: boolean }) => void): Promise<unknown>;
}
const SpotifyLogin = registerPlugin<SpotifyLoginApi>('SpotifyLogin');

/** YouTube API key built into the app at build time (from .env.local or a CI secret). */
const BUILTIN_YT_KEY: string = import.meta.env.VITE_YOUTUBE_KEY ?? '';

/** A line under the region's name on its title card. */
const REGION_LINES: Partial<Record<BiomeId, string>> = {
  seaside: 'Salt air and an open horizon', hills: 'Green slopes, quiet lanes', flatlands: 'Fields as far as you can see',
  desert: 'Heat, dust and endless sky', forest: 'Deep in the pines', alpine: 'High passes and snowy peaks',
  autumn: 'Gold and red, all the way down', winter: 'Snow on the ground, frost in the air', city: 'Neon after dark',
  rainforest: 'Mist, ferns and birdsong', lakes: 'Bridges over still water', canyon: 'Red rock and deep gorges',
  blossom: 'Petals on the breeze', tropical: 'White sand and turquoise water', vineyard: 'Vines, lavender and long lunches',
  japan: 'Rice paddies, shrines and quiet lanes', pnw: 'Giant trees in the mist', savanna: 'Golden grass and acacia shade', arctic: 'Ice, silence and the northern lights',
};

/** A passport stamp's icon and name. */
function stampLabel(key: string): { icon: string; name: string } | null {
  if (key.startsWith('region:')) {
    const b = BIOMES[key.slice(7) as BiomeId];
    return b ? { icon: b.emoji, name: b.name } : null;
  }
  return STAMPS.find((x) => x.key === key) ?? null;
}

/** Shown in Settings. */
const APP_VERSION = '1.0';

/** A settings row: a label and a segmented control. */
const seg = (label: string, key: string, opts: [string, string][]) =>
  `<div class="srow"><span>${label}</span><div class="seg" data-set="${key}">${opts.map(([v, t]) => `<button class="chip" data-v="${v}">${t}</button>`).join('')}</div></div>`;

/** Car picker groups. */
const CAR_CATS: { id: string; label: string; cars: string[] }[] = [
  { id: 'all', label: 'All', cars: [] },
  { id: 'everyday', label: '🚗 Everyday', cars: ['hatch', 'ev', 'wagon', 'bubble'] },
  { id: 'sport', label: '🏁 Sporty', cars: ['gt', 'roadster', 'muscle', 'spider'] },
  { id: 'super', label: '🏎️ Super', cars: ['super', 'veloce', 'hyper'] },
  { id: 'classic', label: '🕰️ Classic', cars: ['classic', 'starliner', 'spider', 'bubble', 'kombi'] },
  { id: 'adventure', label: '🏕️ Adventure', cars: ['suv', 'pickup', 'offroad', 'nomad', 'van', 'wanderer', 'kombi', 'rig'] },
  { id: 'bike', label: '🏍️ Bike', cars: ['bike'] },
];

const STYLE_LABEL: Record<Settings['driveStyle'], string> = { relaxed: '🌿 Relaxed', normal: '🚗 Normal', sporty: '🏁 Sporty' };

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
  readonly videos = new MusicVideos();
  /** Camera to go back to when leaving the driver's seat view. */
  private prevCam: Settings['cam'] = 'chase';
  private songsFor = '';

  constructor(private game: Game) {
    this.s = game.settings;
    this.root.innerHTML = this.template();
    this.bindGarage();
    this.bindCustom();
    this.bindHud();
    this.bindMusic();
    this.bindVideos();
    this.bindRadio();
    this.bindPodcasts();
    this.bindSettings();
    this.applyOrientation();
    game.videos = this.videos;
    this.bindInput();
    this.refreshGarage();
    this.refreshHud();
    this.show('garage');
    game.onRegion = (b) => {
      $('#region').textContent = `${b.emoji} ${b.name}`;
      if (game.phase === 'drive') this.regionCard(`${b.emoji} ${b.name}`, REGION_LINES[b.id] ?? '');
    };
    game.onStamp = (key) => {
      const label = stampLabel(key);
      if (label) this.toast(`New passport stamp<b>${label.icon} ${label.name}</b>`);
    };
    game.onRefuel = (state) => {
      const ev = game.vehicle.spec.engine === 'ev';
      if (state === 'start') this.toast(ev ? 'Charging<b>⚡ Plugged in</b>' : 'Filling up<b>⛽ At the pump</b>');
      else this.toast(ev ? 'Fully charged<b>⚡ 100%</b>' : 'Tank full<b>⛽ 100%</b>');
    };
    setInterval(() => this.tick(), 100);
    window.addEventListener('resize', () => this.frameGarage());
    requestAnimationFrame(() => this.frameGarage());
    if (Capacitor.isNativePlatform()) {
      void App.addListener('backButton', () => this.back());
      void App.addListener('pause', () => {
        game.engine.suspend();
        game.stats.endJourney();
      });
      void App.addListener('resume', () => game.phase === 'drive' && game.engine.start());
    }
  }

  private save() {
    saveSettings(this.s);
  }

  private template() {
    const regionTiles = BIOME_IDS.map(
      (id) => `<button class="rtile" data-theme="${id}"><i>${BIOMES[id].emoji}</i><span>${BIOMES[id].name}</span></button>`,
    ).join('');
    const timeChips = TIMES.map((t) => `<button class="chip" data-time="${t.id}">${t.label}</button>`).join('');
    const swatches = COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${hex(c)}" aria-label="colour"></button>`).join('');
    return `
<section id="garage" class="screen">
  <header class="title"><h1>Endless Drive</h1><div class="top-btns">
    <button class="icon" data-open="stats" aria-label="Trip stats">📊</button>
    <button class="icon" data-open="music" aria-label="Music">🎵</button>
    <button class="icon" data-open="settings" aria-label="Settings">⚙️</button></div></header>
  <div class="garage-body">
    <div class="card gpanel">
      <nav class="gtabs" role="tablist">
        <button class="gtab" data-tab="car"><i>🚗</i><span>Car</span><small id="sum-car"></small></button>
        <button class="gtab" data-tab="world"><i>🗺️</i><span>Regions</span><small id="sum-world"></small></button>
        <button class="gtab" data-tab="sky"><i>🌤️</i><span>Sky</span><small id="sum-sky"></small></button>
        <button class="gtab" data-tab="road"><i>🚦</i><span>Road</span><small id="sum-road"></small></button>
      </nav>
      <div class="gpage" data-page="car">
        <div class="car-head">
          <div class="car-name"><h2 id="car-name"></h2><p id="car-blurb"></p></div>
          <div class="stats" id="car-stats"></div>
        </div>
        <div class="chips hscroll" id="car-cats">${CAR_CATS.map((c) => `<button class="chip" data-cat="${c.id}">${c.label}</button>`).join('')}</div>
        <div class="car-strip hscroll" id="car-strip"></div>
        <div class="paint-row"><div class="swatches hscroll">${swatches}</div>
          <button class="ghost small custom-btn" data-open="custom">🎨 More</button></div>
      </div>
      <div class="gpage" data-page="world">
        <div class="ghead"><p class="hint">Tap to mix regions. None picked = all of them.</p>
          <button class="chip" data-theme="all">🌍 All</button></div>
        <div class="region-grid" id="themes">${regionTiles}</div>
      </div>
      <div class="gpage" data-page="sky">
        <div class="sgroup flat">
          <div class="srow col"><span>Time of day</span><div class="seg wrap" id="times">${timeChips}</div></div>
          <div class="srow col"><span>Weather</span><div class="seg wrap icons" data-set="weather"><button class="chip" data-v="clear">☀️</button><button class="chip" data-v="rain">🌧️</button><button class="chip" data-v="storm">⛈️</button><button class="chip" data-v="snow">🌨️</button><button class="chip" data-v="fog">🌫️</button><button class="chip" data-v="hail">🧊</button><button class="chip" data-v="sleet">💧</button></div></div>
          ${seg('Season', 'season', [['regions', 'Auto'], ['spring', '🌱'], ['summer', '☀️'], ['autumn', '🍂'], ['winter', '❄️']])}
        </div>
      </div>
      <div class="gpage" data-page="road">
        <div class="sgroup flat">
          <div class="srow"><span>Traffic</span><div class="range-row"><input type="range" class="traffic-range" min="0" max="1" step="0.05" aria-label="Traffic density" /><span class="traffic-label"></span></div></div>
          ${seg('Auto-drive', 'driveStyle', [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['sporty', 'Sporty']])}
          ${seg('Steering', 'steering', [['buttons', 'Buttons'], ['tilt', 'Tilt']])}
          ${seg('Steering assist', 'assist', [['true', 'On'], ['false', 'Off']])}
        </div>
        <div class="tile-row"><button class="tile" id="new-world"><i>🎲</i><span>New road</span></button><button class="tile" data-open="places"><i>📍</i><span>Saved places</span></button></div>
      </div>
      <div class="go-row">
        <button class="go alt" id="go-auto">🤖 Auto-drive</button>
        <button class="go" id="go">Drive ▶</button>
      </div>
    </div>
  </div>
</section>

<section id="hud" class="screen">
  <div class="hud-tl">
    <div class="pill" id="region"></div>
    <div class="pill small info-pill"><span id="odo">0.0 mi</span> · <span id="clock">09:00</span> · <span id="fuel">⛽ 100%</span></div>
    <div class="pill small info-pill" id="compass-pill"><span id="compass">N</span> · <span id="alt">0 m</span>
      <button class="link-btn" id="trip-btn">TRIP <b id="trip">0.0</b></button>
      <button class="link-btn" id="fav-btn" aria-label="Save this place">☆</button></div>
    <div class="nowbar" id="nowbar"><span id="nowbar-text"></span>
      <button class="icon tiny" id="nb-toggle" aria-label="Play or pause">⏯</button>
      <button class="icon tiny" id="nb-next" aria-label="Next song">⏭</button></div>
  </div>
  <div class="hud-tr">
    <button class="icon" id="top-play" aria-label="Play or pause the music">⏯</button>
    <button class="icon" data-open="music" aria-label="Music">🎵</button>
    <button class="icon wide" id="cam-btn">🎥 <span class="lbl" id="cam-label"></span></button>
    <button class="icon" id="menu-btn" aria-label="Menu">☰</button>
  </div>
  <div class="hud-menu card" id="hud-menu">
    <div class="menu-grid">
      <button class="pad small" data-open="music" aria-label="Music">🎵<span>Music</span></button>
      <button class="pad small" id="tv-btn" aria-label="Watch the music video">📺<span>Watch</span></button>
      <button class="pad small" id="zen-btn" aria-label="Hide controls">👁️<span>Hide all</span></button>
      <button class="pad small" id="pause-btn" aria-label="Pause">⏸<span>Pause</span></button>
      <button class="pad small" id="lights-btn" aria-label="Headlights">💡<span id="lights-lbl">Auto</span></button>
      <button class="pad small" data-open="settings" aria-label="Settings">⚙️<span>Settings</span></button>
      <button class="pad small" data-open="stats" aria-label="Trips and passport">🛂<span>Passport</span></button>
      <button class="pad small" id="menu-garage" aria-label="Garage">🚗<span>Garage</span></button>
    </div>
    <div class="menu-auto">
      <div class="menu-grid">
        <button class="pad small" id="take-wheel" aria-label="Take the wheel">🕹️<span>Drive</span></button>
        <button class="pad small" id="style-btn" aria-label="Driving style"><b id="style-ico">🚗</b><span id="style-lbl">Normal</span></button>
        <button class="pad small" id="sleep-btn" aria-label="Sleep timer">🌙<span id="sleep-lbl">Sleep</span></button>
      </div>
      <div class="menu-cruise"><button class="pad small" id="m-slower" aria-label="Slower">−</button>
        <div class="cruise-val"><b id="m-cruise">80</b><span>cruise</span></div>
        <button class="pad small" id="m-faster" aria-label="Faster">+</button></div>
    </div>
  </div>
  <div class="lyrics" id="lyrics"><b id="ly-now"></b><span id="ly-next"></span></div>
  <div class="region-card" id="region-card"><small>Welcome to</small><b id="rc-name"></b><span id="rc-sub"></span></div>
  <div class="trip-card" id="trip-card"><small>Trip</small><b id="trip-big">0.0</b><span id="trip-unit">mi</span>
    <div class="row"><button class="ghost small" id="trip-reset">Reset</button><button class="ghost small" id="trip-close">Close</button></div></div>
  <div class="speedo"><b id="speed">0</b><span id="unit">mph</span><em id="speed-note"></em></div>
  <div class="manual">
    <div class="steer" id="steer-btns">
      <button class="pad" data-hold="left" aria-label="Steer left">◀</button>
      <button class="pad" data-hold="right" aria-label="Steer right">▶</button>
    </div>
    <div class="tilt-note" id="tilt-note">Tilt to steer<button class="ghost small" id="tilt-zero">Re-centre</button></div>
    <div class="mid-pads">
      <button class="pad auto-pad" id="auto-on" aria-label="Turn on auto-drive">🤖<span>AUTO</span></button>
      <button class="pad auto-pad" id="cc-btn" aria-label="Cruise control">⏱️<span>CRUISE</span></button>
      <button class="pad auto-pad" id="assist-btn" aria-label="Steering assist">🛟<span id="assist-lbl">ASSIST</span></button>
    </div>
    <div class="pedals">
      <button class="pad brake" data-hold="brake" aria-label="Brake">BRAKE</button>
      <button class="pad gas" data-hold="gas" aria-label="Gas">GAS</button>
    </div>
  </div>
  <div class="cruise" id="cruise-box">
    <button class="pad small" id="slower" aria-label="Slower">−</button>
    <div class="cruise-val"><b id="cruise">80</b><span id="cruise-lbl">cruise</span></div>
    <button class="pad small" id="faster" aria-label="Faster">+</button>
  </div>
  <div class="theatre-bar" id="theatre-bar">
    <div class="tb-top">
      <span class="tb-title" id="tb-title"></span>
      <span class="tb-time" id="tb-time"></span>
    </div>
    <input type="range" id="tb-seek" min="0" max="1000" value="0" aria-label="Seek" />
    <div class="tb-row">
      <div class="tb-btns">
        <button class="icon" id="tb-prev" aria-label="Previous">⏮</button>
        <button class="icon" id="tb-toggle" aria-label="Play or pause">⏸</button>
        <button class="icon" id="tb-next" aria-label="Next">⏭</button>
      </div>
      <label class="tb-vol">🔊<input type="range" id="tb-vol" min="0" max="1" step="0.05" aria-label="Volume" /></label>
      <div class="tb-btns">
        <button class="icon" id="tb-find" aria-label="Find something else">🔎</button>
        <button class="icon" id="tb-dash" aria-label="Watch on the car's screen">🚗</button>
        <button class="icon" id="tb-close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="tb-next" id="tb-upnext"></div>
  </div>
  <div class="toast" id="toast"></div>
  <div class="sleep-cover" id="sleep-cover"><div><b>Good night 🌙</b><span>Pulled over and stopped. The music has faded out.</span>
    <button class="go small" id="wake">Keep driving</button></div></div>
</section>

<section id="pause" class="screen modal">
  <div class="card menu pause-card scroll">
    <div class="pause-head"><h2>Paused</h2><button class="go" id="resume">Keep driving ▶</button></div>
    <div class="tile-row four">
      <button class="tile" id="to-garage"><i>🚗</i><span>Garage</span></button>
      <button class="tile" data-open="music"><i>🎵</i><span>Music</span></button>
      <button class="tile" data-open="stats"><i>🛂</i><span>Passport</span></button>
      <button class="tile" data-open="settings"><i>⚙️</i><span>Settings</span></button>
    </div>
    <div class="sgroup flat">
      <div class="srow col"><span>Time of day</span><div class="seg wrap">${timeChips}</div></div>
      <div class="srow col"><span>Weather</span><div class="seg wrap icons" data-set="weather"><button class="chip" data-v="clear">☀️</button><button class="chip" data-v="rain">🌧️</button><button class="chip" data-v="storm">⛈️</button><button class="chip" data-v="snow">🌨️</button><button class="chip" data-v="fog">🌫️</button><button class="chip" data-v="hail">🧊</button><button class="chip" data-v="sleet">💧</button></div></div>
      <div class="srow"><span>Traffic</span><div class="range-row"><input type="range" class="traffic-range" min="0" max="1" step="0.05" aria-label="Traffic density" /><span class="traffic-label"></span></div></div>
      ${seg('Auto-drive', 'driveStyle', [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['sporty', 'Sporty']])}
      <div class="srow"><span>Sleep timer</span><div class="seg" id="sleep-chips"><button class="chip" data-sleep="0">Off</button><button class="chip" data-sleep="30">30m</button><button class="chip" data-sleep="60">60m</button><button class="chip" data-sleep="90">90m</button></div></div>
    </div>
  </div>
</section>

<aside id="music" class="sheet hidden">
  <div class="sheet-head"><h2>Music</h2><button class="icon" data-close="music" aria-label="Close">✕</button></div>
  <div class="tabs">
    <button class="tab" data-mtab="spotify"><i>🎧</i>Spotify</button>
    <button class="tab" data-mtab="videos"><i>📺</i>Videos</button>
    <button class="tab" data-mtab="radio"><i>📻</i>Radio</button>
    <button class="tab" data-mtab="podcasts"><i>🎙️</i>Talk & books</button>
  </div>
  <div class="sheet-body">
    <div class="row"><input id="sp-input" type="url" inputmode="url" placeholder="Paste a Spotify or YouTube link" autocomplete="off" />
      <button class="go small" id="sp-load">Play</button></div>
    <p class="error" id="sp-error"></p>
    <div class="mpane" data-pane="spotify">
      <div class="login-row" id="sp-login-row">
        <span id="sp-login-state">Not logged in — the player plays 30-second previews.</span>
        <button class="go small" id="sp-login">Log in to Spotify</button>
        <button class="ghost small" id="sp-logout">Log out</button>
      </div>
      <div class="row"><input id="sps-q" type="search" placeholder="Search Spotify" autocomplete="off" /><button class="go small" id="sps-go">Search</button></div>
      <div class="row"><button class="ghost small" id="sp-paste">📋 Paste</button>
        <button class="ghost small" id="sp-app" disabled>Open in Spotify app ↗</button></div>
      <div id="sp-player"><p class="hint">In Spotify, open a playlist → ⋯ → Share → <b>Copy link</b>, then paste it here.</p></div>
      <details class="fix"><summary>Help with Spotify</summary><p class="hint">Log in once and the player plays full songs (free accounts may be shuffle-only). Use your Spotify email and password, or "Log in without password" — Google and Facebook buttons don't work inside apps. Or tap <b>Open in Spotify app</b> and come back: the music keeps playing while you drive.</p></details>
    </div>
    <div class="mpane" data-pane="podcasts">
      <div class="chips" id="pc-kind"><button class="chip on" data-pck="pod">🎙️ Podcasts</button><button class="chip" data-pck="book">📚 Audiobooks</button></div>
      <div class="row"><input id="pc-q" type="search" placeholder="Search podcasts" autocomplete="off" /><button class="go small" id="pc-go">Search</button></div>
      <div class="now-card" id="pc-now" style="display:none">
        <div class="now-song" id="pc-title"></div>
        <div class="now-video" id="pc-show"></div>
        <div class="now-status" id="pc-status"></div>
        <input type="range" id="pc-seek" min="0" max="1000" value="0" />
        <div class="row controls">
          <button class="icon" id="pc-back" aria-label="Back 15 seconds">⏪</button>
          <button class="icon" id="pc-toggle" aria-label="Play or pause">⏯</button>
          <button class="icon" id="pc-fwd" aria-label="Forward 30 seconds">⏩</button>
          <button class="chip" id="pc-rate">1×</button>
        </div>
      </div>
      <div id="pc-list"><p class="hint">Search for a show, then pick an episode. Episodes stream while you drive.</p></div>
    </div>
    <div class="mpane" data-pane="radio">
      <h3>Soundscapes <small>instead of music</small></h3>
      <div class="scapes">${SCAPES.map((x) => `<button class="rtile" data-scape="${x.id}"><i>${x.icon}</i><span>${x.name}</span></button>`).join('')}</div>
      <h3>Radio stations</h3>
      <p class="now-status" id="rd-status"></p>
      <div id="rd-list">${STATIONS.map((st) => `<button class="song" data-station="${st.id}"><b>${st.name}</b><span>${st.about}</span></button>`).join('')}</div>
      <div class="row"><button class="ghost small" id="rd-stop">⏹ Stop</button></div>
      <p class="hint">Free internet radio from <a href="#" id="rd-soma">SomaFM</a>, listener-supported and ad-free.</p>
    </div>
    <div class="mpane" data-pane="videos">
      <div class="row"><input id="yt-q" type="search" placeholder="Search YouTube" autocomplete="off" /><button class="go small" id="yt-go">Search</button></div>
      <div class="chips" id="yt-kind"><button class="chip" data-ytk="video">🎬 Videos</button><button class="chip" data-ytk="playlist">📃 Playlists</button><button class="chip" data-ytk="mine">👤 My YouTube</button></div>
      <div id="yt-results"></div>
      <div class="now-card">
        <div class="now-song" id="mv-song">Nothing playing yet</div>
        <div class="now-video" id="mv-video"></div>
        <div class="now-status" id="mv-status"></div>
        <div class="row controls">
          <button class="icon" id="mv-prev" aria-label="Previous">⏮</button>
          <button class="icon" id="mv-toggle" aria-label="Play or pause">⏯</button>
          <button class="icon" id="mv-next" aria-label="Next">⏭</button>
          <button class="ghost small" id="mv-other">🎞️ Other video</button>
        </div>
        <div class="row controls">
          <button class="chip" id="mv-shuffle">🔀 Shuffle</button>
          <button class="chip" id="mv-repeat">🔁 Repeat all</button>
          <button class="chip" id="mv-lyrics">🎤 Lyrics</button>
        </div>
        <button class="ghost small wide-btn" id="mv-watch">📺 Watch on the car's screen</button>
      </div>
      <details class="fix">
        <summary>Wrong video?</summary>
        <div class="row"><input id="mv-link" type="url" inputmode="url" placeholder="Paste a YouTube link for this song" autocomplete="off" />
          <button class="go small" id="mv-use">Use</button></div>
        <button class="ghost small" id="mv-search">🔎 Look it up on YouTube</button>
      </details>
      <p class="hint" id="mv-keyhint">To find each song's video automatically, add a free <b>YouTube API key</b> in ⚙️ Settings. Without one you can paste a YouTube playlist or video link above.</p>
      <div id="mv-list"></div>
    </div>
    <div id="sp-saved"></div>
  </div>
</aside>

<aside id="custom" class="sheet dock hidden">
  <div class="sheet-head"><h2>🎨 <span id="cu-car"></span></h2>
    <div class="row-btns"><button class="chip" data-openpart="door">🚪</button><button class="chip" data-openpart="bonnet">🔧</button><button class="chip" data-openpart="boot">🧳</button>
    <button class="icon" data-close="custom" aria-label="Close">✕</button></div></div>
  <nav class="cutabs">
    <button class="cutab" data-cutab="paint">🎨 Paint</button><button class="cutab" data-cutab="wheels">🛞 Wheels</button>
    <button class="cutab" data-cutab="style">✨ Style</button><button class="cutab" data-cutab="cabin">💺 Inside</button><button class="cutab" data-cutab="extras">🧳 Extras</button>
  </nav>
  <div class="sheet-body">
    <div class="cupage" data-cupage="paint">
      <h3>Colour</h3>
      <div class="swatches left">${COLORS.map((c) => `<button class="swatch" data-cu-color="${c}" style="background:${hex(c)}"></button>`).join('')}</div>
      <h3>Finish</h3>
      <div class="chips" data-cu="finish"><button class="chip" data-v="metallic">Metallic</button><button class="chip" data-v="solid">Gloss</button><button class="chip" data-v="matte">Matte</button><button class="chip" data-v="pearl">Pearl</button></div>
      <h3>Two-tone</h3>
      <div class="chips"><button class="chip" id="cu-twotone">Two-tone roof</button><button class="chip" id="cu-stripes">Racing stripes</button></div>
      <h3>Second colour <small>roof and stripes</small></h3>
      <div class="swatches left">${[0xf2f1ec, 0x1e1f22, ...COLORS.filter((c) => c !== 0xf2f1ec && c !== 0x1e1f22)].map((c) => `<button class="swatch" data-cu-color2="${c}" style="background:${hex(c)}"></button>`).join('')}</div>
    </div>
    <div class="cupage" data-cupage="wheels">
      <h3>Rims</h3>
      <div class="chips" data-cu="rim"><button class="chip" data-v="five">5-spoke</button><button class="chip" data-v="multi">Multi-spoke</button><button class="chip" data-v="turbine">Aero</button><button class="chip" data-v="steel">Classic steel</button><button class="chip" data-v="beadlock">Off-road</button></div>
      <h3>Rim colour</h3>
      <div class="swatches left">${RIM_COLORS.map((c) => `<button class="swatch" data-cu-rimcolor="${c}" style="background:${hex(c)}"></button>`).join('')}</div>
      <h3>Ride height</h3>
      <div class="range-row"><input type="range" id="cu-ride" min="-0.06" max="0.08" step="0.01" /><span id="cu-ride-lbl"></span></div>
    </div>
    <div class="cupage" data-cupage="style">
      <h3>Decals</h3>
      <div class="chips" data-cu="decal">${DECALS.map((d) => `<button class="chip" data-v="${d.id}">${d.name}</button>`).join('')}</div>
      <h3>Number plate</h3>
      <div class="range-row"><input type="text" id="cu-plate" maxlength="9" autocomplete="off" spellcheck="false" placeholder="Your plate" /></div>
    </div>
    <div class="cupage" data-cupage="extras">
      <h3>Tow</h3>
      <div class="chips" data-cu="tow"><button class="chip" data-v="none">Nothing</button><button class="chip" data-v="caravan">🚐 Caravan</button><button class="chip" data-v="boat">🚤 Boat</button></div>
      <h3>Carry</h3>
      <div class="chips" data-cu="rack"><button class="chip" data-v="none">Nothing</button><button class="chip" data-v="surf">🏄 Surfboards</button><button class="chip" data-v="bikes">🚲 Bikes</button></div>
      <p class="hint">Not on the motorbike.</p>
    </div>
    <div class="cupage" data-cupage="cabin">
      <h3>Seats</h3>
      <div class="swatches left">${LEATHERS.map((c) => `<button class="swatch" data-cu-leather="${c}" style="background:${hex(c)}"></button>`).join('')}</div>
      <h3>Trim</h3>
      <div class="chips" data-cu="trim"><button class="chip" data-v="black">Piano black</button><button class="chip" data-v="wood">Wood</button><button class="chip" data-v="carbon">Carbon</button><button class="chip" data-v="alu">Aluminium</button></div>
      <h3>Ambient lighting <small>at night</small></h3>
      <div class="swatches left">${AMBIENTS.map((c) => `<button class="swatch${c ? '' : ' off'}" data-cu-ambient="${c}" style="background:${c ? hex(c) : '#2a2b2f'}">${c ? '' : '✕'}</button>`).join('')}</div>
    </div>
    <button class="ghost small cu-reset" id="cu-reset">Reset to factory</button>
  </div>
</aside>

<aside id="places" class="sheet hidden">
  <div class="sheet-head"><h2>Places</h2><button class="icon" data-close="places" aria-label="Close">✕</button></div>
  <div class="sheet-body" id="places-body"></div>
</aside>

<aside id="stats" class="sheet stats-sheet hidden">
  <div class="sheet-head"><h2>Your drives</h2><button class="icon" data-close="stats" aria-label="Close">✕</button></div>
  <div class="sheet-body" id="stats-body"></div>
</aside>

<aside id="settings" class="sheet settings hidden">
  <div class="sheet-head"><h2>Settings</h2><button class="icon" data-close="settings" aria-label="Close">✕</button></div>
  <div class="sheet-body">
    <section class="sgroup"><h3>Display</h3>
      ${seg('Graphics', 'quality', [['low', 'Low'], ['medium', 'Med'], ['high', 'High'], ['ultra', 'Ultra']])}
      ${seg('Screen', 'orientation', [['auto', 'Auto'], ['landscape', 'Wide'], ['portrait', 'Tall']])}
      ${seg('Speed in', 'units', [['mph', 'mph'], ['kmh', 'km/h']])}
      ${seg('On-screen info', 'minimalHud', [['false', 'Full'], ['true', 'Minimal']])}
      ${seg('Compass & altitude', 'compass', [['true', 'Show'], ['false', 'Hide']])}
      ${seg('Car screen shows', 'dashScreen', [['map', 'Map'], ['visualizer', 'Visualizer']])}
      ${seg('Camera motion', 'reduceMotion', [['false', 'Normal'], ['true', 'Calm']])}
    </section>
    <section class="sgroup"><h3>Driving</h3>
      ${seg('Steering', 'steering', [['buttons', 'Buttons'], ['tilt', 'Tilt phone']])}
      ${seg('Steering assist', 'assist', [['true', 'On'], ['false', 'Off']])}
      ${seg('Auto-drive style', 'driveStyle', [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['sporty', 'Sporty']])}
      <div class="srow"><span>Traffic</span><div class="range-row"><input type="range" class="traffic-range" min="0" max="1" step="0.05" aria-label="Traffic density" /><span class="traffic-label"></span></div></div>
    </section>
    <section class="sgroup"><h3>World</h3>
      <div class="srow col"><span>Time of day</span><div class="seg wrap">${timeChips}</div></div>
      ${seg('Season', 'season', [['regions', 'Auto'], ['spring', '🌱'], ['summer', '☀️'], ['autumn', '🍂'], ['winter', '❄️']])}
      <div class="srow col"><span>Weather</span><div class="seg wrap" data-set="weather"><button class="chip" data-v="clear">☀️ Clear</button><button class="chip" data-v="rain">🌧️ Rain</button><button class="chip" data-v="storm">⛈️ Storm</button><button class="chip" data-v="snow">🌨️ Snow</button><button class="chip" data-v="fog">🌫️ Fog</button><button class="chip" data-v="hail">🧊 Hail</button><button class="chip" data-v="sleet">💧 Sleet</button></div></div>
      ${seg('Clouds', 'clouds', [['true', 'On'], ['false', 'Clear skies']])}
    </section>
    <details class="sgroup advanced"><summary>Advanced: sound mixer</summary>
      <label class="srow"><span>🚗 Engine</span><input type="range" id="volume" min="0" max="1" step="0.05" /></label>
      <label class="srow"><span>🌲 World</span><input type="range" id="vol-world" min="0" max="1" step="0.05" /></label>
      <label class="srow"><span>🎵 Music</span><input type="range" id="vol-music" min="0" max="1" step="0.05" /></label>
    </details>
    <p class="hint version">Endless Drive ${APP_VERSION}</p>
    <section class="sgroup"><h3>Music videos</h3>
      ${seg('Find', 'prefer', [['video', 'Music videos'], ['lyrics', 'Lyric videos']])}
      ${seg('Synced lyrics', 'lyrics', [['true', 'On'], ['false', 'Off']])}
      ${seg('Outside the car', 'pip', [['false', 'Hide video'], ['true', 'Small video']])}
      <label class="srow col"><span>YouTube API key</span><input id="yt-key" type="text" autocomplete="off" spellcheck="false" placeholder="AIza…" /></label>
      <p class="hint">Only needed if the built-in key runs out. Free from <a href="#" id="yt-help">console.cloud.google.com</a> → enable YouTube Data API v3 → Credentials → Create API key.</p>
    </section>
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
    // (layout box, ignoring the slide-in transform, so it's right even mid-animation)
    const el = document.body.classList.contains('customising') ? $('#custom') : $('.gpanel');
    const box = el.getBoundingClientRect();
    const panel = el.id === 'custom' ? { top: el.offsetTop, left: el.offsetLeft } : box;
    const top = head.bottom;
    if (w > h) {
      // Landscape: left of the panel
      const right = panel.left;
      this.game.rig.focus = { x: right / 2, y: (top + h) / 2, size: Math.min(right * 0.75, (h - top) * 1.5) };
    } else {
      const bottom = panel.top;
      this.game.rig.focus = { x: w / 2, y: (top + bottom) / 2, size: Math.min(w * 0.75, (bottom - top) * 1.5) };
    }
  }

  private open(id: string) {
    for (const s of $$('.sheet', this.root)) s.classList.toggle('hidden', s.id !== id);
    this.docked();
  }

  private close(id: string) {
    $('#' + id).classList.add('hidden');
    if (id === 'custom' && this.game.openState.door && this.cuTabId === 'cabin') this.game.setOpen('door', false);
    this.docked();
  }

  /** While customising, the garage menu steps aside and the car moves into the space left over. */
  private docked() {
    const on = !$('#custom').classList.contains('hidden');
    document.body.classList.toggle('customising', on);
    // (again once the sheet has finished sliding in)
    requestAnimationFrame(() => this.frameGarage());
    setTimeout(() => this.frameGarage(), 360);
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
    for (const b of $$('[data-tab]', r)) b.onclick = () => this.garageTab(b.dataset.tab!);
    for (const b of $$('[data-cat]', r)) {
      b.onclick = () => {
        this.carCat = b.dataset.cat!;
        this.renderCarStrip();
      };
    }
    this.garageTab(this.tab);
    for (const b of $$('[data-color]', r)) {
      b.onclick = () => {
        this.customise({ color: Number(b.dataset.color) });
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
    for (const b of $$('[data-open="places"]', r)) b.addEventListener('click', () => this.renderPlaces());
    $('#go-auto', r).onclick = () => {
      this.s.auto = true;
      this.save();
      this.refreshHud();
      this.start();
    };
    $('#go', r).onclick = () => {
      this.s.auto = false;
      this.save();
      this.refreshHud();
      this.start();
    };
    for (const b of $$('[data-open]', r)) b.onclick = () => this.open(b.dataset.open!);
    for (const b of $$('[data-close]', r)) b.onclick = () => this.close(b.dataset.close!);
  }

  /** Off we go, in whichever mode is set. */
  private start() {
    this.game.stats.newTrip();
    this.game.startDrive();
    this.game.ignition();
    this.show('hud');
    this.recentreTilt();
    const b = this.game.region;
    if (b) this.toast(`${b.emoji} ${b.name}<b>${this.s.auto ? 'Sit back and enjoy the view' : 'Hold GAS to go'}</b>`);
  }

  /** A cinematic title card when you cross into a new region. */
  private regionCard(name: string, sub: string) {
    const c = $('#region-card');
    $('#rc-name').textContent = name;
    $('#rc-sub').textContent = sub;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
    window.clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => c.classList.remove('show'), 4800);
  }
  private cardTimer = 0;
  private recentreHinted = false;
  private lastOdo = 0;
  private saveTimer = 10;
  private lyricsFor = '';
  private lyricLines: Line[] | null = null;

  private updateLyrics() {
    const el = $('#lyrics');
    const v = this.videos;
    const song = v.song;
    if (!this.s.lyrics || !v.active || !song || this.game.phase !== 'drive') {
      el.classList.remove('on');
      return;
    }
    const key = song.artist + '|' + song.title;
    if (key !== this.lyricsFor) {
      this.lyricsFor = key;
      this.lyricLines = null;
      void fetchLyrics(song).then((lines) => {
        if (this.lyricsFor === key) this.lyricLines = lines;
      });
    }
    const t = v.screen.time();
    if (!this.lyricLines || t < 0) {
      el.classList.remove('on');
      return;
    }
    const { now, next } = lineAt(this.lyricLines, t + 0.25);
    if ($('#ly-now').textContent !== now) {
      $('#ly-now').textContent = now || '♪';
      $('#ly-next').textContent = next;
    }
    el.classList.add('on');
  }

  /** Saved places: carry on where you stopped, or go back to a favourite spot. */
  private renderPlaces() {
    const body = $('#places-body');
    const mi = this.s.units === 'mph';
    const dist = (m: number) => (mi ? `${(m / 1609).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`);
    const when = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const sv = this.s.saved;
    let html = '';
    if (sv) {
      const car = CARS.find((c) => c.id === sv.car);
      html += `<h3>Carry on</h3><button class="song" id="pl-continue"><b>↩︎ Continue where you left off</b><span>${car ? car.name + ' · ' : ''}${dist(sv.odometer)} driven · ${when(sv.at)}</span></button>`;
    }
    html += `<h3>Favourites</h3>`;
    if (!this.s.favourites.length) html += `<p class="hint">While driving, tap <b>☆</b> by the compass to save a place you love. It'll be here to come back to.</p>`;
    this.s.favourites.forEach((f, i) => {
      html += `<div class="fav-row"><button class="song" data-fav="${i}"><b>★ ${esc(f.name)}</b><span>${esc(f.region)} · saved ${when(f.at)}</span></button><button class="icon" data-unfav="${i}" aria-label="Remove">🗑</button></div>`;
    });
    body.innerHTML = html;
    const go = (seed: number, themes: BiomeId[], z: number, hour: number) => {
      this.game.travelTo(seed, themes, z, hour);
      this.refreshGarage();
      this.close('places');
      $('#go').click();
    };
    const cont = $('#pl-continue', body);
    if (cont && sv) {
      cont.onclick = () => {
        if (sv.car !== this.s.car) {
          this.s.car = sv.car;
          this.game.setCar(sv.car);
        }
        this.game.fuel = sv.fuel;
        this.game.vehicle.odometer = sv.odometer;
        go(sv.seed, sv.themes, sv.z, sv.hour);
      };
    }
    for (const b of $$('[data-fav]', body)) {
      const f = this.s.favourites[Number(b.dataset.fav)];
      b.onclick = () => go(f.seed, f.themes, f.z, f.hour);
    }
    for (const b of $$('[data-unfav]', body)) {
      b.onclick = () => {
        this.s.favourites.splice(Number(b.dataset.unfav), 1);
        this.save();
        this.renderPlaces();
      };
    }
  }

  private customOf(id: string): Custom {
    const spec = CARS.find((c) => c.id === id) ?? CARS[0];
    return { ...defaultCustom(spec), ...(this.s.custom[id] ?? {}) };
  }

  /** Change the current car's look and rebuild it. */
  private customise(change: Partial<Custom>) {
    const id = this.s.car;
    this.s.custom[id] = { ...(this.s.custom[id] ?? {}), ...change };
    delete this.s.colors[id];
    this.save();
    this.game.setCar(id);
    this.refreshGarage();
  }

  private bindCustom() {
    const r = this.root;
    const nums = (attr: string, key: keyof Custom) => {
      for (const b of $$(`[data-${attr}]`, r)) b.onclick = () => this.customise({ [key]: Number(b.dataset[attr.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())]) } as Partial<Custom>);
    };
    nums('cu-color', 'color');
    nums('cu-color2', 'color2');
    nums('cu-rimcolor', 'rimColor');
    nums('cu-leather', 'leather');
    nums('cu-ambient', 'ambient');
    for (const g of $$('[data-cu]', r)) {
      const key = g.dataset.cu as keyof Custom;
      for (const b of $$('[data-v]', g)) b.onclick = () => this.customise({ [key]: b.dataset.v } as Partial<Custom>);
    }
    for (const b of $$('[data-cutab]', r)) b.onclick = () => this.cuTab(b.dataset.cutab!);
    this.cuTab('paint');
    for (const b of $$('[data-openpart]', r)) {
      b.onclick = () => {
        const part = b.dataset.openpart as 'door' | 'bonnet' | 'boot';
        this.game.setOpen(part, !this.game.openState[part]);
        this.refreshCustom();
      };
    }
    const plate = $<HTMLInputElement>('#cu-plate', r);
    plate.onchange = () => this.customise({ plate: plate.value.trim().toUpperCase().slice(0, 9) });
    $('#cu-twotone', r).onclick = () => this.customise({ twoTone: !this.customOf(this.s.car).twoTone });
    $('#cu-stripes', r).onclick = () => this.customise({ stripes: !this.customOf(this.s.car).stripes });
    const ride = $<HTMLInputElement>('#cu-ride', r);
    ride.onchange = () => this.customise({ ride: Number(ride.value) });
    ride.oninput = () => ($('#cu-ride-lbl').textContent = this.rideLabel(Number(ride.value)));
    $('#cu-reset', r).onclick = () => {
      delete this.s.custom[this.s.car];
      this.save();
      this.game.setCar(this.s.car);
      this.refreshGarage();
    };
  }

  private rideLabel(v: number) {
    return v === 0 ? 'Standard' : v < 0 ? `Lowered ${Math.round(-v * 100)} cm` : `Raised ${Math.round(v * 100)} cm`;
  }

  private cuTabId = 'paint';

  /** Customisation sections; the interior one opens the door so you can see in. */
  private cuTab(id: string) {
    const was = this.cuTabId;
    this.cuTabId = id;
    for (const b of $$('[data-cutab]')) b.classList.toggle('on', b.dataset.cutab === id);
    for (const p of $$('[data-cupage]')) p.classList.toggle('on', p.dataset.cupage === id);
    if (id === 'cabin' && !this.game.openState.door) this.game.setOpen('door', true);
    if (was === 'cabin' && id !== 'cabin' && this.game.openState.door) this.game.setOpen('door', false);
    this.refreshCustom();
  }

  private refreshCustom() {
    const spec = CARS.find((c) => c.id === this.s.car) ?? CARS[0];
    const cu = this.customOf(spec.id);
    $('#cu-car').textContent = spec.name;
    const mark = (attr: string, v: number) => {
      for (const b of $$(`[data-${attr}]`)) b.classList.toggle('on', Number(b.getAttribute(`data-${attr}`)) === v);
    };
    mark('cu-color', cu.color);
    mark('cu-color2', cu.color2);
    mark('cu-rimcolor', cu.rimColor);
    mark('cu-leather', cu.leather);
    mark('cu-ambient', cu.ambient);
    for (const g of $$('[data-cu]')) {
      const key = g.dataset.cu as keyof Custom;
      for (const b of $$('[data-v]', g)) b.classList.toggle('on', String(cu[key]) === b.dataset.v);
    }
    $('#cu-twotone').classList.toggle('on', cu.twoTone);
    $('#cu-stripes').classList.toggle('on', cu.stripes);
    $<HTMLInputElement>('#cu-ride').value = String(cu.ride);
    $('#cu-ride-lbl').textContent = this.rideLabel(cu.ride);
    const plate = $<HTMLInputElement>('#cu-plate');
    if (document.activeElement !== plate) plate.value = cu.plate || defaultPlate(spec.id);
    for (const b of $$('[data-openpart]')) b.classList.toggle('on', this.game.openState[b.dataset.openpart as 'door' | 'bonnet' | 'boot']);
  }

  private tab = 'car';
  private carCat = 'all';

  private garageTab(id: string) {
    this.tab = id;
    for (const b of $$('[data-tab]')) b.classList.toggle('on', b.dataset.tab === id);
    for (const p of $$('.gpage')) p.classList.toggle('on', p.dataset.page === id);
    if (id === 'car') this.renderCarStrip();
    requestAnimationFrame(() => this.frameGarage());
  }

  /** The car picker: a strip of little studio photos, filtered by group. */
  private renderCarStrip() {
    const cat = CAR_CATS.find((c) => c.id === this.carCat) ?? CAR_CATS[0];
    for (const b of $$('[data-cat]')) b.classList.toggle('on', b.dataset.cat === cat.id);
    const list = cat.cars.length ? CARS.filter((c) => cat.cars.includes(c.id)) : CARS;
    const strip = $('#car-strip');
    strip.innerHTML = list
      .map((c) => {
        const togo = this.milesToGo(c.id);
        const lock = togo > 0 ? `<i class="lock">🔒 ${this.s.units === 'kmh' ? Math.ceil(togo * 1.609) + ' km' : Math.ceil(togo) + ' mi'} to go</i>` : '';
        return `<button class="ctile${c.id === this.s.car ? ' on' : ''}${togo > 0 ? ' locked' : ''}" data-car="${c.id}"><img alt="" />${lock}<b>${esc(c.name)}</b><span>${this.speed(c.top)}</span></button>`;
      })
      .join('');
    for (const b of $$('[data-car]', strip)) {
      const spec = CARS.find((c) => c.id === b.dataset.car)!;
      const img = $<HTMLImageElement>('img', b);
      this.game.thumbs.get(spec, this.customOf(spec.id), (url) => (img.src = url));
      b.onclick = () => {
        if (this.s.car === spec.id) return;
        const togo = this.milesToGo(spec.id);
        if (togo > 0) {
          const d = this.s.units === 'kmh' ? `${Math.ceil(togo * 1.609)} km` : `${Math.ceil(togo)} miles`;
          this.toast(`🔒 ${esc(spec.name)}<b>Drive ${d} more to unlock it</b>`);
          return;
        }
        this.s.car = spec.id;
        this.game.setCar(spec.id);
        this.save();
        for (const t of $$('.ctile', strip)) t.classList.toggle('on', t === b);
        this.refreshGarage();
      };
    }
    const on = $('.ctile.on', strip);
    if (on) strip.scrollLeft = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
  }

  /** Miles still to drive before a car unlocks (0 = yours to drive). */
  private milesToGo(id: string): number {
    if (STARTERS.includes(id) || id === this.s.car) return 0;
    const st = this.game.stats.data;
    if ((st.perCar[id] ?? 0) > 0) return 0; // already driven it before unlocks existed
    const need = UNLOCK_MILES[id] ?? 0;
    return Math.max(0, need - st.totalM / 1609.34);
  }

  private speed(kmh: number) {
    return this.s.units === 'kmh' ? `${kmh} km/h` : `${Math.round(kmh / 1.609)} mph`;
  }

  /** One-line summaries under the garage tabs. */
  private refreshSummaries() {
    const spec = CARS.find((c) => c.id === this.s.car) ?? CARS[0];
    $('#sum-car').textContent = spec.name;
    const th = this.s.themes;
    $('#sum-world').textContent = !th.length ? 'All' : th.length === 1 ? BIOMES[th[0]].name : `${th.length} picked`;
    const time = TIMES.find((t) => t.id === this.s.time)?.label.replace(/^\S+\s/, '') ?? '';
    const wx: Record<string, string> = { clear: 'Clear', rain: 'Rain', storm: 'Storm', snow: 'Snow', fog: 'Fog', hail: 'Hail', sleet: 'Sleet' };
    $('#sum-sky').textContent = `${time} · ${wx[this.s.weather] ?? ''}`;
    const d = this.game.traffic.density;
    $('#sum-road').textContent = d < 0.01 ? 'No traffic' : d < 0.35 ? 'Quiet' : d < 0.7 ? 'Some traffic' : 'Busy';
  }

  private refreshGarage() {
    const spec = CARS.find((c) => c.id === this.s.car) ?? CARS[0];
    $('#car-name').textContent = spec.name;
    $('#car-blurb').textContent = spec.blurb;
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`;
    $('#car-stats').innerHTML =
      bar('Top speed', (spec.top - 100) / 240) + bar('Acceleration', spec.accel / 10) + bar('Grip', spec.grip / 12);
    const cu = this.customOf(spec.id);
    for (const b of $$('[data-color]')) b.classList.toggle('on', Number(b.dataset.color) === cu.color);
    this.refreshCustom();
    for (const b of $$('[data-theme]')) {
      const id = b.dataset.theme!;
      b.classList.toggle('on', id === 'all' ? this.s.themes.length === 0 : this.s.themes.includes(id as BiomeId));
    }
    for (const b of $$('[data-time]')) b.classList.toggle('on', b.dataset.time === this.s.time);
    for (const b of $$('[data-mode]')) b.classList.toggle('on', (b.dataset.mode === 'auto') === this.s.auto);
    this.refreshSummaries();
    if (this.tab === 'car') this.renderCarStrip();
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
      this.game.rig.screenFocus = false;
      this.game.rig.mode = this.s.cam;
      this.game.rig.reset();
      this.game.rig.recentre();
      this.save();
      this.refreshHud();
    };
    $('#auto-on', r).onclick = () => this.setAuto(true);
    $('#assist-btn', r).onclick = () => {
      this.s.assist = !this.s.assist;
      this.save();
      this.refreshHud();
      this.refreshSettings();
      this.toast(this.s.assist ? 'Steering assist on<b>Follows the bends, eases you into lane</b>' : 'Steering assist off<b>All yours</b>');
    };
    $('#take-wheel', r).onclick = () => this.setAuto(false);
    $('#style-btn', r).onclick = () => {
      const order: Settings['driveStyle'][] = ['relaxed', 'normal', 'sporty'];
      this.s.driveStyle = order[(order.indexOf(this.s.driveStyle) + 1) % 3];
      this.save();
      this.refreshHud();
      this.refreshSettings();
      this.toast(`Driving style<b>${STYLE_LABEL[this.s.driveStyle]}</b>`);
    };
    $('#sleep-btn', r).onclick = () => {
      const steps = [0, 30, 60, 90];
      this.setSleep(steps[(steps.indexOf(this.sleepMin) + 1) % steps.length]);
    };
    for (const b of $$('[data-sleep]', r)) b.onclick = () => this.setSleep(Number(b.dataset.sleep));
    $('#wake', r).onclick = () => this.wake();
    this.game.onSleep = () => this.fallAsleep();
    for (const el of $$<HTMLInputElement>('.traffic-range', r)) {
      el.oninput = () => {
        this.s.trafficDensity = Number(el.value);
        this.game.traffic.density = this.s.trafficDensity;
        if (!this.game.traffic.enabled) this.game.traffic.clear();
        this.save();
        this.refreshTraffic();
        this.refreshSummaries();
      };
    }
    this.refreshTraffic();
    $('#zen-btn', r).onclick = (e) => {
      e.stopPropagation();
      this.setZen(true);
      this.toast('Tap anywhere to bring the controls back');
    };
    // Cruise speed steps: 5 mph or 10 km/h, snapped to round numbers in the chosen unit
    const cruise = (dir: number) => {
      const mph = this.s.units === 'mph';
      const k = mph ? 0.621371 : 1;
      const step = mph ? 5 : 10;
      const now = Math.round((this.s.cruiseKmh * k) / step) * step;
      const max = Math.floor((this.game.spec.top * k) / step) * step;
      const next = Math.max(step * 3, Math.min(max, now + dir * step));
      this.s.cruiseKmh = next / k;
      this.game.vehicle.cruise = this.s.cruiseKmh / 3.6;
      this.save();
      this.refreshHud();
    };
    $('#cc-btn', r).onclick = () => this.setCruise(!this.game.ccOn);
    this.game.onCruise = (on) => {
      this.refreshHud();
      if (!on) this.toast('Cruise control off');
    };
    $('#slower', r).onclick = () => cruise(-1);
    $('#faster', r).onclick = () => cruise(1);
    $('#m-slower', r).onclick = () => cruise(-1);
    $('#m-faster', r).onclick = () => cruise(1);
    // The menu: everything that isn't speed, now playing or the camera
    const menu = $('#hud-menu', r);
    $('#menu-btn', r).onclick = (e) => {
      e.stopPropagation();
      menu.classList.toggle('on');
    };
    for (const b of $$('.menu-grid .pad', menu)) b.addEventListener('click', () => menu.classList.remove('on'));
    document.addEventListener('pointerdown', (e) => {
      if (menu.classList.contains('on') && !menu.contains(e.target as Node) && e.target !== $('#menu-btn')) menu.classList.remove('on');
    });
    $('#tilt-zero', r).onclick = () => this.recentreTilt();
    for (const b of $$('[data-open="stats"]', r)) b.addEventListener('click', () => this.renderStats());
    $('#tv-btn', r).onclick = () => this.tvButton();
    $('#nowbar-text', r).onclick = () => {
      if (this.videos.active) this.setTheatre(true);
    };
    $('#menu-garage', r).onclick = () => $<HTMLElement>('#to-garage').click();
    $('#lights-btn', r).onclick = () => {
      const order: Settings['lights'][] = ['auto', 'on', 'off'];
      this.s.lights = order[(order.indexOf(this.s.lights ?? 'auto') + 1) % 3];
      this.save();
      this.refreshHud();
      this.toast(`💡 Headlights<b>${this.s.lights === 'auto' ? 'Automatic' : this.s.lights === 'on' ? 'On' : 'Off'}</b>`);
    };
    $('#top-play', r).onclick = () => {
      if (this.audioSource()) this.toggleAudio();
      else this.open('music');
    };
    // Tap the small video in the corner to watch it big
    this.videos.screen.el.addEventListener('click', () => this.setTheatre(true));
    $('#tb-find', r).onclick = () => {
      this.open('music');
      $<HTMLElement>('[data-mtab="videos"]').click();
      setTimeout(() => $<HTMLInputElement>('#yt-q').focus(), 350);
    };
    let tbSeeking = false;
    const seek = $<HTMLInputElement>('#tb-seek', r);
    seek.oninput = () => (tbSeeking = true);
    seek.onchange = () => {
      const d = this.videos.screen.duration();
      if (d) this.videos.screen.seek((Number(seek.value) / 1000) * d);
      tbSeeking = false;
    };
    const vol = $<HTMLInputElement>('#tb-vol', r);
    vol.value = String(this.s.volMusic);
    vol.oninput = () => {
      this.s.volMusic = Number(vol.value);
      const el = document.getElementById('vol-music') as HTMLInputElement | null;
      if (el) el.value = vol.value;
      this.applyMix();
      this.save();
    };
    // Keep the time, seek bar and up-next list fresh while the cinema view is open
    setInterval(() => {
      if (!this.game.theatre) return;
      const scr = this.videos.screen;
      const t = Math.max(0, scr.time()), d = scr.duration();
      const f = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
      $('#tb-time').textContent = d ? `${f(t)} / ${f(d)}` : '';
      if (!tbSeeking && d) seek.value = String(Math.round((t / d) * 1000));
      $('#tb-toggle').textContent = scr.paused ? '▶' : '⏸';
      const v = this.videos;
      const html = v.songs.length > 1
        ? '<small>Up next</small>' + [1, 2, 3].map((k) => v.songs[(v.index + k) % v.songs.length]).filter(Boolean)
            .map((sg, k) => `<button class="chip" data-upnext="${(v.index + k + 1) % v.songs.length}">${esc(sg.title)}<i> · ${esc(sg.artist.split(',')[0])}</i></button>`).join('')
        : '';
      const box = $('#tb-upnext');
      if (box.dataset.k !== html) {
        box.dataset.k = html;
        box.innerHTML = html;
        for (const b of $$('[data-upnext]', box)) b.onclick = () => void v.playIndex(Number(b.dataset.upnext));
      }
    }, 500);
    $('#tb-close', r).onclick = () => this.setTheatre(false);
    $('#tb-toggle', r).onclick = () => this.videos.toggle();
    $('#tb-next', r).onclick = () => this.videos.next();
    $('#tb-prev', r).onclick = () => this.videos.previous();
    $('#tb-dash', r).onclick = () => {
      this.setTheatre(false);
      this.dashButton();
    };
    // Trip meter, favourite places
    $('#trip-btn', r).onclick = () => $('#trip-card').classList.toggle('show');
    $('#trip-close', r).onclick = () => $('#trip-card').classList.remove('show');
    $('#trip-reset', r).onclick = () => {
      this.s.tripMeter = 0;
      this.save();
    };
    $('#fav-btn', r).onclick = () => {
      const g = this.game, v = g.vehicle, b = g.region;
      const town = g.world.towns(v.z - 600, v.z + 600)[0];
      const near = town !== undefined ? `near ${g.world.townName(town)}` : b ? b.name : 'Somewhere nice';
      const st = g.world.stopNear(v.z, 80);
      const name = st ? `${b ? b.name + ' ' : ''}${st.kind === 'viewpoint' ? 'viewpoint' : st.kind === 'harbour' ? 'harbour' : st.kind === 'campsite' ? 'campsite' : st.kind === 'diner' ? 'diner' : st.kind === 'drivein' ? 'drive-in' : 'services'}` : near;
      this.s.favourites.unshift({ name, seed: g.seed, themes: [...this.s.themes], z: v.z, hour: g.hour, region: b ? `${b.emoji} ${b.name}` : '', at: Date.now() });
      this.s.favourites = this.s.favourites.slice(0, 30);
      this.save();
      $('#fav-btn').textContent = '★';
      window.setTimeout(() => ($('#fav-btn').textContent = '☆'), 2500);
      this.toast(`Saved<b>★ ${esc(name)}</b>`);
    };
    $('#nb-toggle', r).onclick = () => this.toggleAudio();
    $('#nb-next', r).onclick = () => {
      const src = this.audioSource();
      if (src === 'videos') this.videos.next();
      else if (src === 'podcasts') this.podcasts.skip(30);
      else if (src === 'radio' && this.radio.station) {
        const i = STATIONS.indexOf(this.radio.station);
        this.radio.play(STATIONS[(i + 1) % STATIONS.length]);
      }
    };
  }

  /** 📺: watch big in the middle of the screen (the car keeps driving behind). */
  private tvButton() {
    if (!this.videos.active) {
      this.setMusicMode('videos');
      if (!this.videos.songs.length && !this.videos.ytList) {
        this.open('music');
        return;
      }
    }
    this.setTheatre(!this.game.theatre);
  }

  private setTheatre(on: boolean) {
    this.game.theatre = on;
    // Let auto-drive take over while you watch
    if (on && !this.s.auto) this.setAuto(true);
    this.refreshHud();
  }

  /** Into the driver's seat to look at the dashboard screen (or back out). */
  private dashButton() {
    const rig = this.game.rig;
    if (this.s.cam !== 'hood') this.watchOnScreen(true);
    else if (!rig.screenFocus) {
      rig.screenFocus = true;
      this.refreshHud();
    } else this.watchOnScreen(false);
  }

  /** Jump into the driver's seat to watch the video on the dashboard (or back out). */
  private watchOnScreen(on: boolean) {
    const rig = this.game.rig;
    rig.screenFocus = false;
    if (on) {
      if (this.s.cam !== 'hood') this.prevCam = this.s.cam;
      this.s.cam = 'hood';
      if (!this.videos.active) {
        this.setMusicMode('videos');
        if (!this.videos.songs.length && !this.videos.ytList) this.open('music');
      }
    } else this.s.cam = this.prevCam === 'hood' ? 'chase' : this.prevCam;
    rig.mode = this.s.cam;
    rig.reset();
    this.save();
    this.refreshHud();
  }

  /** Cruise control in manual: hold the speed you're doing now (rounded to 5 mph / 10 km/h). */
  private setCruise(on: boolean) {
    const v = this.game.vehicle;
    if (on) {
      if (v.v < 4) {
        this.toast('Get moving first<b>then tap CRUISE to hold that speed</b>');
        return;
      }
      const k = this.s.units === 'mph' ? 0.621371 : 1;
      const step = this.s.units === 'mph' ? 5 : 10;
      v.cruise = Math.max(step, Math.round((v.v * 3.6 * k) / step) * step) / k / 3.6;
      this.s.cruiseKmh = v.cruise * 3.6;
      this.save();
    }
    this.game.ccOn = on;
    this.refreshHud();
    this.toast(on ? 'Cruise control on<b>GAS to go faster · BRAKE to cancel</b>' : 'Cruise control off');
  }

  private sleepMin = 0;
  private sleepVol = 1;

  private setAuto(on: boolean) {
    this.s.auto = on;
    this.game.ccOn = false;
    const v = this.game.vehicle;
    if (on) {
      v.lane = v.nearestLane();
      if (v.v > 8) {
        // Take over at the current speed, rounded to 5 mph / 10 km/h
        const k = this.s.units === 'mph' ? 0.621371 : 1;
        const step = this.s.units === 'mph' ? 5 : 10;
        v.cruise = (Math.round((v.v * 3.6 * k) / step) * step) / k / 3.6 || v.cruise;
      }
      this.s.cruiseKmh = v.cruise * 3.6;
    }
    this.toast(on ? `🤖 Auto-drive on<b>${STYLE_LABEL[this.s.driveStyle]}</b>` : '🕹️ You have the wheel');
    this.save();
    this.refreshHud();
    this.refreshGarage();
  }

  /** Sleep timer: after this many minutes of driving, pull over and fade the music out. */
  private setSleep(min: number) {
    this.sleepMin = min;
    const g = this.game;
    g.sleepAt = min ? g.driveTime + min * 60 : null;
    if (min && !this.s.auto) this.setAuto(true);
    this.toast(min ? `🌙 Sleep timer<b>${min} minutes</b>` : '🌙 Sleep timer off');
    this.refreshHud();
  }

  private fallAsleep() {
    // Fade the music over ~20 seconds, then stop it
    const step = () => {
      this.sleepVol = Math.max(0, this.sleepVol - 0.05);
      this.videos.screen.setVolume(this.sleepVol * 100);
      this.radioVolume?.(this.sleepVol);
      this.game.engine.volume = this.s.volume * this.sleepVol;
      if (this.sleepVol > 0) window.setTimeout(step, 1000);
      else {
        this.videos.stop();
        this.radioStop?.();
        if (this.s.musicMode === 'spotify') $('#sp-player').innerHTML = '<p class="hint">Stopped by the sleep timer.</p>';
        document.body.classList.add('asleep');
      }
    };
    step();
    $('#sleep-cover').classList.add('on');
  }

  private wake() {
    const g = this.game;
    g.sleeping = false;
    g.sleepAt = null;
    this.sleepMin = 0;
    this.sleepVol = 1;
    this.videos.screen.setVolume(100);
    this.radioVolume?.(1);
    g.engine.volume = this.s.volume;
    g.vehicle.lane = 1;
    document.body.classList.remove('asleep');
    $('#sleep-cover').classList.remove('on');
    if (this.s.musicMode === 'spotify' && this.current) this.embed(this.current);
    this.refreshHud();
  }

  /** Hooks for the radio (set up with the radio). */
  private radioVolume?: (v: number) => void;
  private radioStop?: () => void;

  /** (Windows, sunroof and demist work by themselves now: no buttons for them.) */
  private refreshCabin() {}

  private statsTab = 'trips';

  private renderStats() {
    const st = this.game.stats;
    const d = st.data;
    const mph = this.s.units === 'mph';
    const dist = (m: number) => (mph ? `${(m / 1609.34).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`);
    const hrs = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);
    const regions = Object.entries(d.perRegion).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const cars = Object.entries(d.perCar).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...regions.map((r) => r[1] ?? 0));
    $('#stats-body').innerHTML = `
      <nav class="ptabs"><button class="ptab${this.statsTab === 'trips' ? ' on' : ''}" data-ptab="trips">📊 Trips</button><button class="ptab${this.statsTab === 'passport' ? ' on' : ''}" data-ptab="passport">🛂 Passport</button><button class="ptab${this.statsTab === 'log' ? ' on' : ''}" data-ptab="log">📔 Log</button></nav>
      <div class="ppage${this.statsTab === 'trips' ? ' on' : ''}" data-ppage="trips">
      <div class="stat-grid">
        <div><b>${dist(st.tripM)}</b><span>This trip · ${hrs(st.tripS)}</span></div>
        <div><b>${dist(d.totalM)}</b><span>All time</span></div>
        <div><b>${hrs(d.totalS)}</b><span>Time driving</span></div>
        <div><b>${dist(d.longestM)}</b><span>Longest trip</span></div>
        <div><b>${Math.round(d.topSpeed * (mph ? 2.237 : 3.6))} ${mph ? 'mph' : 'km/h'}</b><span>Top speed</span></div>
        <div><b>${d.trips + (st.tripM > 100 ? 1 : 0)}</b><span>Trips</span></div>
      </div>
      <h3>By region</h3>
      ${regions.map(([id, m]) => `<div class="stat"><span>${BIOMES[id as BiomeId].emoji} ${BIOMES[id as BiomeId].name}</span><i><b style="width:${Math.round(((m ?? 0) / max) * 100)}%"></b></i><em>${dist(m ?? 0)}</em></div>`).join('') || '<p class="hint">Go for a drive!</p>'}
      <h3>By car</h3>
      ${cars.map(([id, m]) => `<div class="stat"><span>${CARS.find((c) => c.id === id)?.name ?? id}</span><em>${dist(m)}</em></div>`).join('')}
      </div>
      <div class="ppage${this.statsTab === 'passport' ? ' on' : ''}" data-ppage="passport">
      <div class="pp-head"><b>${Object.keys(d.stamps).length}</b><span>of ${BIOME_IDS.length + STAMPS.length} stamps collected</span>
        <i><em style="width:${Math.round((Object.keys(d.stamps).length / (BIOME_IDS.length + STAMPS.length)) * 100)}%"></em></i></div>
      <div class="passport">${[...BIOME_IDS.map((id) => ({ key: 'region:' + id, icon: BIOMES[id].emoji, name: BIOMES[id].name })), ...STAMPS]
        .map((x) => {
          const t = d.stamps[x.key];
          return `<div class="stamp${t ? ' got' : ''}"><i>${x.icon}</i><span>${esc(x.name)}</span><small>${t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}</small></div>`;
        })
        .join('')}</div>
      </div>
      <div class="ppage${this.statsTab === 'log' ? ' on' : ''}" data-ppage="log">
      ${d.journeys.length ? d.journeys.map((j, i) => `<div class="journey"><canvas width="120" height="80" data-jmap="${i}"></canvas><div>
        <b>${new Date(j.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${new Date(j.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b>
        <span>${dist(j.m)} · ${hrs(j.s)} · ${CARS.find((c) => c.id === j.car)?.name ?? j.car}</span>
        <span class="jregions">${j.regions.map((r) => BIOMES[r]?.emoji ?? '').join(' → ')}</span></div></div>`).join('') : '<p class="hint">Your trips are logged here: route, distance, time and the regions you passed through.</p>'}
      </div>
      <button class="ghost small" id="stats-reset">Reset stats</button>`;
    for (const b of $$('[data-ptab]', $('#stats-body'))) {
      b.onclick = () => {
        this.statsTab = b.dataset.ptab!;
        for (const x of $$('[data-ptab]')) x.classList.toggle('on', x === b);
        for (const pg of $$('[data-ppage]')) pg.classList.toggle('on', pg.dataset.ppage === this.statsTab);
      };
    }
    // Little route maps for the journey log
    for (const c of $$<HTMLCanvasElement>('[data-jmap]')) {
      const j = d.journeys[Number(c.dataset.jmap)];
      const g = c.getContext('2d')!;
      g.fillStyle = '#16203a';
      g.fillRect(0, 0, 120, 80);
      if (j.path.length < 2) continue;
      const xs = j.path.map((p) => p[0]), zs = j.path.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const sc = Math.min(100 / Math.max(1, maxZ - minZ), 60 / Math.max(1, maxX - minX));
      g.strokeStyle = '#f0b44c';
      g.lineWidth = 2.5;
      g.lineJoin = 'round';
      g.beginPath();
      j.path.forEach(([x, z], k) => {
        const px = 10 + (z - minZ) * sc, py = 40 - (x - (minX + maxX) / 2) * sc;
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.stroke();
      g.fillStyle = '#3ddc84';
      g.beginPath();
      g.arc(10, 40 - (j.path[0][0] - (minX + maxX) / 2) * sc, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    $('#stats-reset').onclick = () => {
      if (confirm('Reset all your trip stats?')) {
        st.reset();
        this.renderStats();
      }
    };
  }

  private refreshTraffic() {
    const d = this.s.trafficDensity;
    const label = d < 0.02 ? 'Empty roads' : d < 0.3 ? 'Light traffic' : d < 0.65 ? 'Normal traffic' : 'Busy roads';
    for (const el of $$<HTMLInputElement>('.traffic-range')) el.value = String(d);
    for (const el of $$('.traffic-label')) el.textContent = label;
  }

  private refreshHud() {
    $('#cam-label').textContent = CAM_LABEL[this.s.cam];
    $('#assist-btn').classList.toggle('on', this.s.assist);
    $('#assist-lbl').textContent = this.s.assist ? 'ASSIST' : 'NO ASSIST';
    $('#tv-btn').classList.toggle('on', this.game.theatre);
    $('#lights-lbl').textContent = this.s.lights === 'on' ? 'On' : this.s.lights === 'off' ? 'Off' : 'Auto';
    document.body.classList.toggle('driver-view', this.s.cam === 'hood');
    document.body.classList.toggle('minimal-hud', this.s.minimalHud);
    document.body.classList.toggle('no-compass', !this.s.compass);
    this.refreshCabin();
    $('#style-ico').textContent = STYLE_LABEL[this.s.driveStyle].split(' ')[0];
    $('#style-lbl').textContent = STYLE_LABEL[this.s.driveStyle].split(' ')[1];
    $('#sleep-lbl').textContent = this.sleepMin ? `${this.sleepMin}m` : 'Sleep';
    $('#sleep-btn').classList.toggle('on', this.sleepMin > 0);
    for (const b of $$('[data-sleep]')) b.classList.toggle('on', Number(b.dataset.sleep) === this.sleepMin);
    document.body.classList.toggle('auto-mode', this.s.auto);
    document.body.classList.toggle('tilt-mode', this.s.steering === 'tilt');
    $('#unit').textContent = this.s.units === 'mph' ? 'mph' : 'km/h';
    const k = this.s.units === 'mph' ? 0.621371 : 1;
    $('#cruise').textContent = String(Math.round(this.s.cruiseKmh * k));
    $('#m-cruise').textContent = String(Math.round(this.s.cruiseKmh * k));
    document.body.classList.toggle('cc-on', this.game.ccOn && !this.s.auto);
    $('#cc-btn').classList.toggle('on', this.game.ccOn);
  }

  private unlockedSeen: Set<string> | null = null;

  /** Tell the driver when their miles unlock a new car. */
  private checkUnlocks() {
    const now = new Set(CARS.filter((c) => this.milesToGo(c.id) === 0).map((c) => c.id));
    if (this.unlockedSeen) {
      for (const id of now) {
        if (!this.unlockedSeen.has(id)) {
          const c = CARS.find((x) => x.id === id)!;
          this.toast(`🔓 New car unlocked<b>${esc(c.name)}</b>`);
        }
      }
    }
    this.unlockedSeen = now;
  }

  private unlockTimer = 0;

  private tick() {
    const g = this.game;
    const v = g.vehicle;
    if (++this.unlockTimer % 50 === 0) this.checkUnlocks();
    const k = this.s.units === 'mph' ? 0.621371 : 1;
    $('#speed').textContent = String(Math.round(Math.abs(v.v) * 3.6 * k));
    // Say why auto-drive is under the set speed, so cruise control never seems broken
    const held = this.s.auto && v.v < v.cruise - 1.5 ? v.limitedBy : null;
    const why = held === 'bend' ? '↪ bend ahead' : held === 'limit' ? 'speed limit' : held === 'traffic' ? 'following traffic' : held === 'stop' ? 'stopping' : held === 'top' ? 'top speed' : '';
    $('#speed-note').textContent = v.v < -0.5 ? 'R' : v.offroad ? 'off-road' : why;
    $('#odo').textContent = `${((v.odometer / 1000) * k).toFixed(1)} ${this.s.units === 'mph' ? 'mi' : 'km'}`;
    // Fuel (or charge), and where the next station is when it's getting low
    const ev = v.spec.engine === 'ev';
    const fuelEl = $('#fuel');
    let ft = `${ev ? '⚡' : '⛽'} ${Math.round(g.fuel * 100)}%`;
    if (g.refuelling) ft = `${ev ? '⚡ Charging' : '⛽ Filling'} ${Math.round(g.fuel * 100)}%`;
    else if (g.fuel < 0.25) {
      const next = g.world.nextStop(v.z, 6000);
      let d = 0;
      for (let z = v.z, n = next; n && d < 6000; ) {
        if (n.kind === 'fuel') { d = n.z - v.z; break; }
        z = n.z + 1;
        n = g.world.nextStop(z, 6000 - (z - v.z));
      }
      if (d > 0) ft += ` · station ${this.s.units === 'mph' ? (d / 1609).toFixed(1) + ' mi' : (d / 1000).toFixed(1) + ' km'}`;
    }
    if (fuelEl.textContent !== ft) fuelEl.textContent = ft;
    fuelEl.classList.toggle('low', g.fuel < 0.2);
    // Compass, altitude and the trip meter
    const bearing = ((Math.atan2(Math.sin(v.heading), -Math.cos(v.heading)) * 180) / Math.PI + 360) % 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    $('#compass').textContent = `🧭 ${dirs[Math.round(bearing / 45) % 8]} ${Math.round(bearing)}°`;
    const mi = this.s.units === 'mph';
    $('#alt').textContent = `⛰ ${mi ? Math.round(Math.max(0, v.y) * 3.281) + ' ft' : Math.round(Math.max(0, v.y)) + ' m'}`;
    const moved = v.odometer - this.lastOdo;
    if (g.phase === 'drive' && moved > 0 && moved < 200) this.s.tripMeter += moved;
    this.lastOdo = v.odometer;
    const trip = ((this.s.tripMeter / 1000) * (mi ? 0.621371 : 1)).toFixed(1);
    $('#trip').textContent = trip;
    $('#trip-big').textContent = trip;
    $('#trip-unit').textContent = mi ? 'miles' : 'km';
    // Lyrics for the music video that's playing
    this.updateLyrics();
    // Remember where we are, to carry on from here next time
    this.saveTimer -= 0.1;
    if (this.saveTimer <= 0 && g.phase === 'drive') {
      this.saveTimer = 10;
      this.s.saved = { seed: g.seed, themes: [...this.s.themes], z: v.z, hour: g.hour, odometer: v.odometer, fuel: g.fuel, car: this.s.car, at: Date.now() };
      this.save();
    }
    const h = g.hour;
    $('#clock').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    // Music playing: quieter engine and world, and say what's on
    const musicOn = this.videos.active || this.radio.playing || this.podcasts.playing || (this.s.musicMode === 'spotify' && !!$('#sp-player iframe'));
    g.engine.duck = musicOn ? 0.45 : 1;
    g.nowPlaying = this.podcasts.playing && this.podcasts.episode ? `🎙️ ${this.podcasts.episode.title}` : this.radio.playing && this.radio.station ? `📻 ${this.radio.station.name}` : this.s.musicMode === 'spotify' && musicOn ? '🎧 Spotify' : '';
    const tl = $('.hud-tl').getBoundingClientRect();
    g.pipY = Math.round(tl.bottom + 8);
    const np = this.videos.now();
    // What's playing, with play/pause and next, whatever the source
    const bar = $('#nowbar');
    const src = this.audioSource();
    bar.classList.toggle('on', src !== null);
    const label =
      src === 'videos' ? (np.song ? `📺 ${np.song.title} · ${np.song.artist}` : np.video ? `📺 ${np.video.title}` : '📺 Music videos')
      : src === 'podcasts' ? `🎙️ ${this.podcasts.episode?.title ?? ''}`
      : src === 'radio' ? `📻 ${this.radio.station?.name ?? ''}`
      : src === 'scape' ? `${SCAPES.find((x) => x.id === (this.scape.current ?? this.scapePaused))?.icon ?? ''} ${SCAPES.find((x) => x.id === (this.scape.current ?? this.scapePaused))?.name ?? ''}`
      : src === 'spotify' ? '🎧 Spotify' : '';
    const txt = $('#nowbar-text');
    if (txt.textContent !== label) txt.textContent = label;
    if (g.theatre && !this.videos.active) this.setTheatre(false);
    document.body.classList.toggle('video-on', this.videos.active || this.s.musicMode === 'videos');
    const tt = $('#tb-title');
    if (g.theatre && tt.textContent !== label) tt.textContent = label;
    const paused = src === 'podcasts' ? !this.podcasts.playing : src === 'radio' ? !this.radio.playing : src === 'scape' ? !this.scape.current : src === 'spotify' ? this.spotifyPaused : false;
    const tb = $('#nb-toggle');
    const ico = paused ? '▶' : '⏸';
    if (tb.textContent !== ico && src !== 'videos') tb.textContent = ico;
    if (src === 'videos' && tb.textContent !== '⏯') tb.textContent = '⏯';
    const tp = $('#top-play');
    const tpIco = !src ? '▶' : src === 'videos' ? (this.videos.screen.paused ? '▶' : '⏸') : ico;
    if (tp.textContent !== tpIco) tp.textContent = tpIco;
    $('#nb-next').style.display = src === 'spotify' ? 'none' : '';
    if (g.struggling() && this.s.quality !== 'low') {
      this.s.quality = this.s.quality === 'ultra' ? 'high' : this.s.quality === 'high' ? 'medium' : 'low';
      g.setQuality(this.s.quality);
      this.save();
      this.refreshSettings();
      this.toast(`Graphics lowered to ${this.s.quality} to keep things smooth`);
    }
  }

  /** Which sound source the now-playing bar controls, if any. */
  private audioSource(): 'videos' | 'podcasts' | 'radio' | 'scape' | 'spotify' | null {
    if (this.videos.active) return 'videos';
    if (this.s.musicMode === 'podcasts' && this.podcasts.episode) return 'podcasts';
    if (this.s.musicMode === 'radio' && (this.scape.current || this.scapePaused)) return 'scape';
    if (this.s.musicMode === 'radio' && this.radio.station) return 'radio';
    if (this.s.musicMode === 'spotify' && $('#sp-player iframe')) return 'spotify';
    return null;
  }

  private spotifyPaused = false;
  private scapePaused: ScapeId | null = null;

  /** Play/pause for whatever's on: videos, a podcast, the radio or the Spotify player. */
  private toggleAudio() {
    const src = this.audioSource();
    if (src === 'videos') this.videos.toggle();
    else if (src === 'podcasts') this.podcasts.toggle();
    else if (src === 'radio') this.radio.toggle();
    else if (src === 'scape') {
      if (this.scape.current) {
        this.scapePaused = this.scape.current;
        this.scape.stop();
      } else if (this.scapePaused) {
        this.scape.play(this.scapePaused);
        this.scapePaused = null;
      }
    }
    else if (src === 'spotify') {
      // The Spotify embed listens for the same commands its own iframe API sends
      $<HTMLIFrameElement>('#sp-player iframe').contentWindow?.postMessage({ command: 'toggle' }, '*');
      this.spotifyPaused = !this.spotifyPaused;
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
    let lastTap = 0;
    const end = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      dragId = -1;
      this.game.rig.dragging = false;
      if (moved < 8) {
        // Double-tap: look straight ahead again
        const now = performance.now();
        if (now - lastTap < 350) {
          this.game.rig.recentre();
          lastTap = 0;
        } else lastTap = now;
        if (this.zen) this.setZen(false);
      } else if (!this.recentreHinted && this.game.phase === 'drive') {
        this.recentreHinted = true;
        this.toast('View stays where you leave it<b>Double-tap to look ahead</b>');
      }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'c') $('#cam-btn').click();
      if (e.key === 'h') this.setZen(!this.zen);
      if (e.key === 'm') this.open('music');
      if (e.key === ' ') this.setAuto(!this.s.auto);
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
      const yt = parseYouTube(input.value);
      if (yt && !/spotify/i.test(input.value)) {
        $('#sp-error').textContent = '';
        input.value = '';
        input.blur();
        this.setMusicMode('videos', false);
        this.videos.playYouTube(yt);
        return;
      }
      const r = parseSpotify(input.value);
      if (!r.ok) {
        $('#sp-error').textContent = r.error.replace('Spotify link', 'Spotify or YouTube link');
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
    this.bindSpotifyLogin();
    for (const b of $$('[data-mtab]')) b.onclick = () => this.setMusicMode(b.dataset.mtab as Settings['musicMode']);
    this.renderSaved();
    this.refreshMusicTabs();
    const last = loadSaved()[0];
    if (last) this.play(last.ref, false, false);
  }

  private bindSpotifyLogin() {
    const row = $('#sp-login-row');
    if (!Capacitor.isNativePlatform()) {
      row.style.display = 'none';
      return;
    }
    const show = (loggedIn: boolean) => {
      $('#sp-login-state').textContent = loggedIn ? '✓ Logged in to Spotify — full songs' : 'Not logged in — the player plays 30-second previews.';
      $('#sp-login').style.display = loggedIn ? 'none' : '';
      $('#sp-logout').style.display = loggedIn ? '' : 'none';
    };
    const reload = (r: { loggedIn: boolean }) => {
      show(r.loggedIn);
      // Reload the player so it picks up the login
      if (this.current && this.s.musicMode === 'spotify') this.embed(this.current);
    };
    void SpotifyLogin.status().then((r) => show(r.loggedIn)).catch(() => (row.style.display = 'none'));
    void SpotifyLogin.addListener('loginFinished', reload);
    $('#sp-login').onclick = () => void SpotifyLogin.open().catch(() => {});
    $('#sp-logout').onclick = () => void SpotifyLogin.logout().then(reload);
  }

  /** Switch between the Spotify player and music videos (only one plays at a time). */
  private setMusicMode(mode: Settings['musicMode'], autoplay = true) {
    const changed = mode !== this.s.musicMode;
    this.s.musicMode = mode;
    this.save();
    this.refreshMusicTabs();
    if (!changed) return;
    if (mode !== 'radio') {
      this.radio.stop();
      this.scape.stop();
    }
    if (mode !== 'podcasts') this.podcasts.stop();
    if (mode !== 'videos') this.videos.stop();
    if (mode === 'videos') {
      $('#sp-player').innerHTML = '<p class="hint">Spotify is paused while music videos play.</p>';
      if (autoplay && this.videos.songs.length && !this.videos.active) void this.videos.playIndex(Math.max(0, this.videos.index));
    } else if (mode === 'radio' || mode === 'podcasts') {
      $('#sp-player').innerHTML = `<p class="hint">Spotify is paused while the ${mode === 'radio' ? 'radio' : 'podcast'} plays.</p>`;
    } else if (this.current) this.embed(this.current);
  }

  private refreshMusicTabs() {
    for (const b of $$('[data-mtab]')) b.classList.toggle('on', b.dataset.mtab === this.s.musicMode);
    for (const p of $$('[data-pane]')) p.style.display = p.dataset.pane === this.s.musicMode ? '' : 'none';
    $('#mv-keyhint').style.display = this.s.youtubeKey || BUILTIN_YT_KEY ? 'none' : '';
  }

  private embed(ref: SpotifyRef) {
    const tall = window.innerHeight > 560;
    this.spotifyPaused = false;
    $('#sp-player').innerHTML = `<iframe title="Spotify player" src="${embedUrl(ref)}" width="100%" height="${tall ? 352 : 152}" frameborder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }

  private play(ref: SpotifyRef, remember = true, start = true) {
    this.current = ref;
    $<HTMLButtonElement>('#sp-app').disabled = false;
    if (this.s.musicMode === 'spotify') this.embed(ref);
    else $('#sp-player').innerHTML = '<p class="hint">Spotify is paused while music videos play.</p>';
    void this.loadSongs(ref, start && this.s.musicMode === 'videos');
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

  /** Get the playlist's songs so they can be played as videos. */
  private async loadSongs(ref: SpotifyRef, start: boolean) {
    const key = ref.kind + ref.id;
    if (this.songsFor === key) {
      if (start) void this.videos.playIndex(0);
      return;
    }
    this.songsFor = key;
    try {
      const { name, songs } = await fetchSongs(ref);
      if (this.songsFor !== key) return;
      this.videos.setSongs(name, songs);
      this.renderSongs();
      if (start) void this.videos.playIndex(0);
    } catch (e) {
      if (this.songsFor === key) this.songsFor = '';
      if (this.s.musicMode === 'videos') {
        this.videos.status = `Couldn't read the songs from Spotify (${(e as Error).message}).`;
        this.refreshVideos();
      }
    }
  }

  /** Apply the sound mixer levels. */
  private applyMix() {
    this.game.engine.world = this.s.volWorld;
    const m = this.s.volMusic * this.sleepVolNow();
    this.radio.setVolume(m);
    this.podcasts.setVolume(m);
    this.scape.setVolume(m);
    this.videos.screen.setVolume(m * 100);
  }

  private sleepVolNow() {
    return this.sleepVol;
  }

  // ---------- Podcasts ----------

  readonly podcasts = new PodcastPlayer();

  private bindPodcasts() {
    const pc = this.podcasts;
    const list = $('#pc-list');
    const fmt = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
    let seeking = false;
    pc.onChange = () => {
      const on = !!pc.episode;
      $('#pc-now').style.display = on ? '' : 'none';
      if (!on) return;
      $('#pc-title').textContent = pc.episode!.title;
      $('#pc-show').textContent = pc.show?.name ?? '';
      const { t, d } = pc.time;
      $('#pc-status').textContent = pc.error || `${pc.playing ? '▶' : '⏸'} ${fmt(t)}${d ? ' / ' + fmt(d) : ''}`;
      if (!seeking && d) $<HTMLInputElement>('#pc-seek').value = String(Math.round((t / d) * 1000));
      $('#pc-rate').textContent = `${pc.rate}×`;
    };
    // Podcasts, or free classic audiobooks from LibriVox
    let book = false;
    for (const b of $$('[data-pck]')) {
      b.onclick = () => {
        book = b.dataset.pck === 'book';
        for (const x of $$('[data-pck]')) x.classList.toggle('on', x === b);
        $<HTMLInputElement>('#pc-q').placeholder = book ? 'Search books or authors (e.g. Sherlock, Austen)' : 'Search podcasts';
        list.innerHTML = book
          ? '<p class="hint">Thousands of free classic audiobooks read by volunteers (LibriVox). Search, pick a book, then a chapter. They keep playing with the screen off.</p>'
          : '<p class="hint">Search for a show, then pick an episode. Episodes stream while you drive.</p>';
      };
    }
    const search = async () => {
      const q = $<HTMLInputElement>('#pc-q').value.trim();
      if (!q) return;
      list.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const shows = book ? await searchBooks(q) : await searchShows(q);
        if (!shows.length) {
          list.innerHTML = `<p class="hint">No ${book ? 'books' : 'shows'} found.</p>`;
          return;
        }
        list.innerHTML = shows.map((sh, i) => `<button class="song show" data-show="${i}"><img src="${esc(sh.art)}" alt="" /><b>${esc(sh.name)}</b><span>${esc(sh.author)}</span></button>`).join('');
        for (const b of $$('[data-show]', list)) {
          b.onclick = async () => {
            const sh = shows[Number(b.dataset.show)];
            list.innerHTML = `<p class="hint">Loading ${esc(sh.name)}…</p>`;
            try {
              const eps = await loadEpisodes(sh);
              list.innerHTML = `<button class="ghost small" id="pc-backlist">← Results</button><h3>${esc(sh.name)}</h3>` +
                eps.map((e, i) => `<button class="song" data-ep="${i}"><b>${esc(e.title)}</b><span>${e.date}${e.duration ? ' · ' + fmt(e.duration) : ''}</span></button>`).join('');
              $('#pc-backlist', list).onclick = () => void search();
              for (const eb of $$('[data-ep]', list)) {
                eb.onclick = () => {
                  this.setMusicMode('podcasts', false);
                  pc.play(sh, eps[Number(eb.dataset.ep)], eps);
                  this.applyMix();
                };
              }
            } catch (e) {
              list.innerHTML = `<p class="error">Couldn't load the episodes (${esc((e as Error).message)}).</p>`;
            }
          };
        }
      } catch (e) {
        list.innerHTML = `<p class="error">Couldn't search podcasts (${esc((e as Error).message)}).</p>`;
      }
    };
    $('#pc-go').onclick = () => void search();
    $<HTMLInputElement>('#pc-q').onkeydown = (e) => e.key === 'Enter' && void search();
    $('#pc-toggle').onclick = () => pc.toggle();
    $('#pc-back').onclick = () => pc.skip(-15);
    $('#pc-fwd').onclick = () => pc.skip(30);
    $('#pc-rate').onclick = () => pc.setRate(pc.rate >= 2 ? 0.8 : pc.rate >= 1.5 ? 2 : pc.rate >= 1.2 ? 1.5 : pc.rate >= 1 ? 1.2 : 1);
    const seek = $<HTMLInputElement>('#pc-seek');
    seek.oninput = () => (seeking = true);
    seek.onchange = () => {
      seeking = false;
      const { t, d } = pc.time;
      if (d) pc.skip((Number(seek.value) / 1000) * d - t);
    };
  }

  // ---------- Radio ----------

  readonly radio = new Radio();
  readonly scape = new Soundscape();

  private bindRadio() {
    const rd = this.radio;
    this.radioVolume = () => this.applyMix();
    this.radioStop = () => rd.stop();
    rd.onChange = () => {
      $('#rd-status').textContent = rd.error || (rd.station ? (rd.playing ? `▶ ${rd.station.name}` : `Tuning in to ${rd.station.name}…`) : '');
      for (const b of $$('[data-station]')) b.classList.toggle('on', rd.playing && b.dataset.station === rd.station?.id);
    };
    for (const b of $$('[data-station]')) {
      b.onclick = () => {
        this.setMusicMode('radio', false);
        this.scape.stop();
        rd.play(STATIONS.find((s) => s.id === b.dataset.station)!);
      };
    }
    $('#rd-stop').onclick = () => {
      rd.stop();
      this.scape.stop();
      this.scapePaused = null;
    };
    // Soundscapes: tap to play, tap again to stop
    this.scape.onChange = () => {
      for (const b of $$('[data-scape]')) b.classList.toggle('on', b.dataset.scape === this.scape.current);
    };
    for (const b of $$('[data-scape]')) {
      b.onclick = () => {
        if (this.scape.current === b.dataset.scape) return this.scape.stop();
        this.setMusicMode('radio', false);
        rd.stop();
        this.scape.setVolume(this.s.volMusic * this.sleepVolNow());
        this.scapePaused = null;
        this.scape.play(b.dataset.scape as ScapeId);
      };
    }
    $('#rd-soma').onclick = (e) => {
      e.preventDefault();
      void this.openExternal('https://somafm.com/support/');
    };
  }

  // ---------- Music videos ----------

  private bindVideos() {
    const v = this.videos;
    v.apiKey = this.s.youtubeKey || BUILTIN_YT_KEY;
    v.prefer = this.s.prefer;
    v.onChange = () => this.refreshVideos();
    v.shuffle = this.s.shuffle;
    v.repeat = this.s.repeat;
    const modes = () => {
      $('#mv-shuffle').classList.toggle('on', this.s.shuffle);
      $('#mv-repeat').classList.toggle('on', this.s.repeat !== 'off');
      $('#mv-repeat').textContent = this.s.repeat === 'one' ? '🔂 Repeat one' : this.s.repeat === 'all' ? '🔁 Repeat all' : '🔁 Repeat off';
      $('#mv-lyrics').classList.toggle('on', this.s.lyrics);
    };
    modes();
    $('#mv-shuffle').onclick = () => {
      v.shuffle = this.s.shuffle = !this.s.shuffle;
      this.save();
      modes();
    };
    $('#mv-repeat').onclick = () => {
      v.repeat = this.s.repeat = this.s.repeat === 'all' ? 'one' : this.s.repeat === 'one' ? 'off' : 'all';
      this.save();
      modes();
    };
    $('#mv-lyrics').onclick = () => {
      this.s.lyrics = !this.s.lyrics;
      this.save();
      modes();
      this.refreshSettings();
    };
    $('#mv-prev').onclick = () => v.previous();
    $('#mv-next').onclick = () => v.next();
    $('#mv-toggle').onclick = () => {
      if (!v.active && v.songs.length) void v.playIndex(Math.max(0, v.index));
      else v.toggle();
    };
    $('#mv-other').onclick = () => v.otherVideo();
    $('#mv-watch').onclick = () => {
      this.close('music');
      this.watchOnScreen(true);
      this.game.rig.screenFocus = true;
      if (this.game.phase === 'garage') $('#go').click();
    };
    $('#mv-use').onclick = () => {
      const link = parseYouTube($<HTMLInputElement>('#mv-link').value);
      if (!link?.videoId) {
        $('#sp-error').textContent = 'Paste a link to a single YouTube video.';
        return;
      }
      $('#sp-error').textContent = '';
      $<HTMLInputElement>('#mv-link').value = '';
      if (v.song) v.useLink(link.videoId);
      else v.playYouTube(link);
    };
    $('#mv-search').onclick = () => {
      const s = v.song;
      const q = s ? `${s.artist.split(',')[0]} ${s.title} ${this.s.prefer === 'lyrics' ? 'lyrics' : 'official video'}` : '';
      void this.openExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
    };
    this.refreshVideos();
    this.bindYouTubeSearch();
  }

  // ---------- YouTube search & your channel ----------

  private ytKind: 'video' | 'playlist' | 'mine' = 'video';
  private ytResults: YtResult[] = [];

  private bindYouTubeSearch() {
    const q = $<HTMLInputElement>('#yt-q');
    const go = () => {
      if (this.ytKind === 'mine') this.ytKind = 'video';
      void this.ytSearch(q.value.trim());
      q.blur();
    };
    $('#yt-go').onclick = go;
    q.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    for (const b of $$('[data-ytk]')) {
      b.onclick = () => {
        this.ytKind = b.dataset.ytk as typeof this.ytKind;
        if (this.ytKind === 'mine') void this.ytMine();
        else if (q.value.trim()) void this.ytSearch(q.value.trim());
        else this.renderYt();
      };
    }
    this.renderYt();
    // Spotify: search in the Spotify app (or the web player if the app isn't installed)
    const sq = $<HTMLInputElement>('#sps-q');
    const sgo = async () => {
      const term = sq.value.trim();
      if (!term) return;
      sq.blur();
      if (Capacitor.isNativePlatform()) {
        try {
          const r = await AppLauncher.openUrl({ url: `spotify:search:${encodeURIComponent(term)}` });
          if (r.completed) return;
        } catch {
          /* no app: use the web */
        }
      }
      void this.openExternal(`https://open.spotify.com/search/${encodeURIComponent(term)}`);
    };
    $('#sps-go').onclick = () => void sgo();
    sq.addEventListener('keydown', (e) => e.key === 'Enter' && void sgo());
  }

  private get ytKey() {
    return this.s.youtubeKey || BUILTIN_YT_KEY;
  }

  private ytError(e: unknown) {
    return e instanceof QuotaError ? "YouTube's daily search limit is used up. Try again tomorrow, or paste a link."
      : e instanceof KeyError ? 'The YouTube API key was rejected. Check it in ⚙️ Settings.'
      : e instanceof Error ? e.message : "Couldn't reach YouTube.";
  }

  private async ytSearch(term: string) {
    if (!term) return;
    const el = $('#yt-results');
    if (!this.ytKey) {
      el.innerHTML = '<p class="hint">Searching needs a YouTube API key (⚙️ Settings).</p>';
      return;
    }
    el.innerHTML = '<p class="hint">Searching…</p>';
    try {
      this.ytResults = await searchYouTube(term, this.ytKey, this.ytKind === 'playlist' ? 'playlist' : 'video');
      this.renderYt(term);
    } catch (e) {
      el.innerHTML = `<p class="error">${esc(this.ytError(e))}</p>`;
    }
  }

  /** Your own channel's playlists (public ones; YouTube needs a full Google sign-in for private lists). */
  private async ytMine() {
    const el = $('#yt-results');
    for (const b of $$('[data-ytk]')) b.classList.toggle('on', b.dataset.ytk === 'mine');
    const ask = (msg = '') => {
      el.innerHTML = `<p class="hint">Enter your YouTube channel's <b>@handle</b> (find it on your channel page) to play your playlists. Make playlists <b>Public</b> on YouTube for them to show up here.</p>
        <div class="row"><input id="yt-handle" type="search" placeholder="@yourname" autocomplete="off" value="${esc(this.s.ytChannel)}" /><button class="go small" id="yt-handle-go">Show</button></div>
        <p class="error">${esc(msg)}</p>`;
      const inp = $<HTMLInputElement>('#yt-handle');
      const go = () => {
        this.s.ytChannel = inp.value.trim();
        this.save();
        void this.ytMine();
      };
      $('#yt-handle-go').onclick = go;
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    };
    if (!this.s.ytChannel) return ask();
    if (!this.ytKey) return ask('Showing your playlists needs a YouTube API key (⚙️ Settings).');
    el.innerHTML = '<p class="hint">Loading your playlists…</p>';
    try {
      const { channel, lists } = await channelPlaylists(this.s.ytChannel, this.ytKey);
      this.ytResults = lists;
      this.renderYt('', `👤 ${channel} · <button class="link-btn" id="yt-change">change</button>`);
      const ch = document.getElementById('yt-change');
      if (ch) ch.onclick = () => {
        this.s.ytChannel = '';
        this.save();
        ask();
      };
    } catch (e) {
      ask(this.ytError(e));
    }
  }

  private renderYt(term = '', header = '') {
    for (const b of $$('[data-ytk]')) b.classList.toggle('on', b.dataset.ytk === this.ytKind);
    const el = $('#yt-results');
    if (!this.ytResults.length) {
      el.innerHTML = term ? '<p class="hint">Nothing found.</p>' : '';
      return;
    }
    const two = (n: number) => String(Math.floor(n)).padStart(2, '0');
    const dur = (s: number) => (!s ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${two((s % 3600) / 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`);
    el.innerHTML = (header ? `<p class="hint">${header}</p>` : '') + this.ytResults
      .map((r, i) => `<button class="yt-item" data-yti="${i}"><img src="${esc(r.thumb)}" alt="" loading="lazy" /><span><b>${esc(r.title)}</b><small>${esc(r.channel)}${r.kind === 'video' && r.duration ? ' · ' + dur(r.duration) : ''}${r.count ? ` · ${r.count} videos` : ''}${r.kind === 'playlist' ? ' · playlist' : ''}</small></span></button>`)
      .join('');
    for (const b of $$('[data-yti]', el)) {
      b.onclick = () => {
        const i = Number(b.dataset.yti);
        const r = this.ytResults[i];
        this.setMusicMode('videos', false);
        if (r.kind === 'playlist') this.videos.playYouTube({ listId: r.id });
        else {
          // Play this one, then carry on down the results
          const vids = this.ytResults.filter((x) => x.kind === 'video');
          this.videos.playResults(term ? `🔎 ${term}` : 'YouTube', vids, vids.indexOf(r));
        }
        this.toast(`📺 ${esc(r.title)}`);
      };
    }
  }

  private refreshVideos() {
    const np = this.videos.now();
    $('#mv-song').textContent = np.song ? `${np.song.title} — ${np.song.artist}` : this.videos.ytList ? 'YouTube playlist' : this.videos.active ? 'YouTube video' : 'Nothing playing yet';
    $('#mv-video').textContent = np.video ? `▶ ${np.video.title} · ${np.video.channel}` : '';
    $('#mv-status').textContent = np.status;
    $<HTMLButtonElement>('#mv-other').disabled = !this.videos.current;
    for (const el of $$('[data-song]')) el.classList.toggle('on', Number(el.dataset.song) === this.videos.index);
  }

  private renderSongs() {
    const v = this.videos;
    const el = $('#mv-list');
    if (!v.songs.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      `<h3>${esc(v.listName)} · ${v.songs.length} songs</h3>` +
      v.songs.map((s, i) => `<button class="song" data-song="${i}"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></button>`).join('');
    for (const b of $$('[data-song]', el)) {
      b.onclick = () => {
        this.setMusicMode('videos', false);
        void v.playIndex(Number(b.dataset.song));
      };
    }
    this.refreshVideos();
  }

  private async openExternal(url: string) {
    if (Capacitor.isNativePlatform()) {
      try {
        await AppLauncher.openUrl({ url });
        return;
      } catch {
        /* fall through */
      }
    }
    window.open(url, '_blank');
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
    for (const [id, k] of [['#vol-world', 'volWorld'], ['#vol-music', 'volMusic']] as const) {
      const el = $<HTMLInputElement>(id);
      el.value = String(this.s[k]);
      el.oninput = () => {
        this.s[k] = Number(el.value);
        this.applyMix();
        this.save();
      };
    }
    this.applyMix();
    const key = $<HTMLInputElement>('#yt-key');
    key.value = this.s.youtubeKey;
    if (BUILTIN_YT_KEY) key.placeholder = 'Built-in key in use';
    key.onchange = () => {
      this.s.youtubeKey = key.value.trim();
      this.videos.apiKey = this.s.youtubeKey || BUILTIN_YT_KEY;
      this.save();
      this.refreshMusicTabs();
    };
    $('#yt-help').onclick = (e) => {
      e.preventDefault();
      void this.openExternal('https://console.cloud.google.com/apis/library/youtube.googleapis.com');
    };
    this.refreshSettings();
  }

  private applySetting(key: keyof Settings) {
    const g = this.game;
    if (key === 'quality') g.setQuality(this.s.quality);
    if (key === 'season') {
      g.chunks.season = this.s.season;
      g.chunks.clear();
      g.chunks.fill(g.vehicle.z);
    }
    if (key === 'units') {
      g.chunks.units = this.s.units;
      g.chunks.clear();
      g.chunks.fill(g.vehicle.z);
    }

    if (key === 'clouds') g.sky.setClouds(this.s.clouds);
    if (key === 'steering') this.recentreTilt();
    if (key === 'orientation') this.applyOrientation();
    if (key === 'prefer') this.videos.prefer = this.s.prefer;
  }

  private applyOrientation() {
    if (!Capacitor.isNativePlatform()) return;
    const o = this.s.orientation;
    if (o === 'auto') void ScreenOrientation.unlock().catch(() => {});
    else void ScreenOrientation.lock({ orientation: o }).catch(() => {});
  }

  private refreshSettings() {
    for (const group of $$('[data-set]', this.root)) {
      const key = group.dataset.set as keyof Settings;
      for (const b of $$('[data-v]', group)) b.classList.toggle('on', String(this.s[key]) === b.dataset.v);
    }
    $<HTMLInputElement>('#volume').value = String(this.s.volume);
    this.refreshSummaries();
  }
}
