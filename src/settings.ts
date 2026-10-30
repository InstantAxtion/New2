import type { BiomeId } from './world/biomes';
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
  musicMode: 'spotify' | 'videos' | 'radio';
  /** The player's own YouTube Data API key (for finding music videos). */
  youtubeKey: string;
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
  quality: 'high',
  units: 'mph',
  steering: 'buttons',
  assist: true,
  volume: 0.5,
  clouds: true,
  traffic: true,
  cruiseKmh: 96.56, // 60 mph
  musicMode: 'spotify',
  youtubeKey: '',
  prefer: 'video',
  pip: true,
  orientation: 'auto',
  trafficDensity: 0.45,
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
