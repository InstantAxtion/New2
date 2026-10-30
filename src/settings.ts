import type { BiomeId } from './world/biomes';
import type { TimeMode } from './sky';
import type { CamMode } from './camera';

export interface Settings {
  car: string;
  colors: Record<string, number>;
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
}

const KEY = 'endless-drive.settings';

export const DEFAULTS: Settings = {
  car: 'gt',
  colors: {},
  themes: [],
  time: 'cycle',
  auto: false,
  cam: 'chase',
  quality: 'medium',
  units: 'kmh',
  steering: 'buttons',
  assist: true,
  volume: 0.5,
  clouds: true,
  traffic: true,
  cruiseKmh: 80,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...raw, colors: { ...(raw.colors || {}) } };
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
