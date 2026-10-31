import { BIOME_IDS, type BiomeId } from './world/biomes';
import type { TimeMode } from './sky';
import type { CamMode } from './camera';
import type { Custom } from './carspecs';
import type { WeatherKind } from './weather';

export interface Settings {
  car: string;
  colors: Record<string, number>;
  /** Per-car paint, wheels and interior choices. */
  custom: Record<string, Partial<Custom>>;
  themes: BiomeId[];
  time: TimeMode;
  auto: boolean;
  cam: CamMode;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  units: 'kmh' | 'mph';
  steering: 'buttons' | 'tilt';
  assist: boolean;
  volume: number;
  clouds: boolean;
  traffic: boolean;
  cruiseKmh: number;
  /** What the music panel plays. */
  musicMode: 'spotify' | 'videos' | 'radio' | 'podcasts';
  /** The player's own YouTube Data API key (for finding music videos). */
  youtubeKey: string;
  /** Headlights. */
  lights: 'auto' | 'on' | 'off';
  /** Your YouTube channel (@handle), for your playlists. */
  ytChannel: string;
  prefer: 'video' | 'lyrics';
  /** Show the video in a corner in the outside cameras too. */
  pip: boolean;
  orientation: 'auto' | 'landscape' | 'portrait';
  /** 0 = empty roads … 1 = busy. */
  trafficDensity: number;
  driveStyle: 'relaxed' | 'normal' | 'sporty';
  weather: WeatherKind;
  /** Music videos: shuffle and repeat, and synced lyrics on screen. */
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  lyrics: boolean;
  /** What the dash screen shows while music plays (when it isn't showing a video). */
  dashScreen: 'map' | 'visualizer';
  /** A clean screen: just the speed, no extra pills. */
  minimalHud: boolean;
  /** Compass and altitude on the HUD. */
  compass: boolean;
  /** Where you were when you last stopped (to carry on from there). */
  saved: SavedDrive | null;
  /** Places you've starred along the way. */
  favourites: Favourite[];
  /** Distance on the resettable trip meter (metres). */
  tripMeter: number;
  /** Season: each region's own look, or the whole world in one season. */
  season: 'regions' | 'spring' | 'summer' | 'autumn' | 'winter';
  /** Calmer cameras for motion-sensitive players. */
  reduceMotion: boolean;
  /** Head-up display on the windscreen (cars that have one). */
  hud: boolean;
  /** Sound mixer: the world around you, and music/podcasts (engine is `volume`). */
  volWorld: number;
  volMusic: number;
}

export interface SavedDrive {
  seed: number;
  themes: BiomeId[];
  z: number;
  hour: number;
  odometer: number;
  fuel: number;
  car: string;
  at: number;
}

export interface Favourite {
  name: string;
  seed: number;
  themes: BiomeId[];
  z: number;
  hour: number;
  region: string;
  at: number;
}

const KEY = 'endless-drive.settings';

export const DEFAULTS: Settings = {
  car: 'gt',
  colors: {},
  custom: {},
  themes: [],
  time: 'cycle',
  auto: false,
  cam: 'chase',
  quality: 'ultra',
  units: 'mph',
  steering: 'buttons',
  assist: true,
  volume: 0.5,
  clouds: true,
  traffic: true,
  cruiseKmh: 96.56, // 60 mph
  musicMode: 'spotify',
  youtubeKey: '',
  lights: 'auto',
  ytChannel: '',
  prefer: 'video',
  pip: true,
  orientation: 'auto',
  trafficDensity: 0,
  driveStyle: 'normal',
  weather: 'clear',
  shuffle: false,
  repeat: 'all',
  lyrics: true,
  dashScreen: 'map',
  minimalHud: false,
  compass: true,
  saved: null,
  favourites: [],
  tripMeter: 0,
  season: 'regions',
  reduceMotion: false,
  hud: true,
  volWorld: 1,
  volMusic: 1,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const s: Settings = { ...DEFAULTS, ...raw, colors: { ...(raw.colors || {}) }, custom: { ...(raw.custom || {}) }, favourites: [...(raw.favourites || [])] };
    // Colours picked before customisation existed
    for (const [id, color] of Object.entries(s.colors)) s.custom[id] = { color, ...(s.custom[id] || {}) };
    // The game switched to mph; move older saves over once (they can switch back)
    if (!raw.unitsV2) s.units = 'mph';
    (s as unknown as { unitsV2: boolean }).unitsV2 = true;
    // Only two cameras now: behind the car, or the driver's seat
    if (s.cam !== 'hood') s.cam = 'chase';
    // The video lives on the car's screen (or the Watch view), not floating over the outside cameras
    // The video shows small in a corner in 3rd person (tap it to watch big)
    if (!raw.pipV3) s.pip = true;
    (s as unknown as { pipV3: boolean }).pipV3 = true;
    // Options that no longer exist: buttons to steer, mph, normal camera motion; and the best graphics to start with
    s.steering = 'buttons';
    s.units = 'mph';
    s.reduceMotion = false;
    if (!raw.qualityV2) s.quality = 'ultra';
    (s as unknown as { qualityV2: boolean }).qualityV2 = true;
    // Regions that no longer exist
    s.themes = s.themes.filter((t) => (BIOME_IDS as string[]).includes(t));
    if (s.saved && !s.saved.themes.every((t) => (BIOME_IDS as string[]).includes(t))) s.saved = null;
    s.favourites = s.favourites.filter((f) => f.themes.every((t) => (BIOME_IDS as string[]).includes(t)));
    // Empty roads unless you turn traffic on
    if (!raw.trafficV2) s.trafficDensity = 0;
    (s as unknown as { trafficV2: boolean }).trafficV2 = true;
    // Older saves only had traffic on/off
    if (raw.trafficDensity === undefined && raw.traffic === false) s.trafficDensity = 0;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
