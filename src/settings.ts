import type { BiomeId } from './world/biomes';
import type { TimeMode } from './sky';
import type { CamMode } from './camera';
import type { Custom } from './carspecs';

export interface Settings {
  car: string;
  colors: Record<string, number>;
  /** Per-car paint, wheels and interior choices. */
  custom: Record<string, Partial<Custom>>;
  themes: BiomeId[];
  time: TimeMode;
  auto: boolean;
  cam: CamMode;
  quality: 'low' | 'medium' | 'high';
  units: 'kmh' | 'mph';
  steering: 'buttons' | 'tilt';
  assist: boolean;
  volume: number;
  clouds: boolean;
  traffic: boolean;
  cruiseKmh: number;
  /** What the music panel plays. */
  musicMode: 'spotify' | 'videos';
  /** The player's own YouTube Data API key (for finding music videos). */
  youtubeKey: string;
  prefer: 'video' | 'lyrics';
  /** Show the video in a corner in the outside cameras too. */
  pip: boolean;
  orientation: 'auto' | 'landscape' | 'portrait';
  /** 0 = empty roads … 1 = busy. */
  trafficDensity: number;
  driveStyle: 'relaxed' | 'normal' | 'sporty';
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
  units: 'kmh',
  steering: 'buttons',
  assist: true,
  volume: 0.5,
  clouds: true,
  traffic: true,
  cruiseKmh: 80,
  musicMode: 'spotify',
  youtubeKey: '',
  prefer: 'video',
  pip: true,
  orientation: 'auto',
  trafficDensity: 0.45,
  driveStyle: 'normal',
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const s: Settings = { ...DEFAULTS, ...raw, colors: { ...(raw.colors || {}) }, custom: { ...(raw.custom || {}) } };
    // Colours picked before customisation existed
    for (const [id, color] of Object.entries(s.colors)) s.custom[id] = { color, ...(s.custom[id] || {}) };
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
