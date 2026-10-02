// Deterministic weather from date, latitude/longitude and seed (no state needed).
import type { Game } from './ctx';
import type { Weather } from './types';

export const WEATHERS: Weather[] = ['clear', 'rain', 'snow', 'monsoon', 'storm', 'heat'];
export const W_CLEAR = 0, W_RAIN = 1, W_SNOW = 2, W_MONSOON = 3, W_STORM = 4, W_HEAT = 5;

export const WEATHER_FX: Record<Weather, { move: number; atk: number; air: number; supply: number; attrition: number; icon: string; name: string }> = {
  clear: { move: 1, atk: 1, air: 1, supply: 1, attrition: 0, icon: '☀️', name: 'Clear' },
  rain: { move: 0.85, atk: 0.95, air: 0.8, supply: 0.95, attrition: 0, icon: '🌧️', name: 'Rain' },
  snow: { move: 0.6, atk: 0.85, air: 0.6, supply: 0.75, attrition: 1, icon: '❄️', name: 'Winter' },
  monsoon: { move: 0.55, atk: 0.85, air: 0.5, supply: 0.7, attrition: 0.5, icon: '🌀', name: 'Monsoon' },
  storm: { move: 0.5, atk: 0.8, air: 0.1, supply: 0.6, attrition: 0.5, icon: '⛈️', name: 'Storm' },
  heat: { move: 0.85, atk: 0.95, air: 0.95, supply: 0.85, attrition: 0.5, icon: '🔥', name: 'Extreme heat' },
};

function noise(seed: number, a: number, b: number, c: number) {
  let h = (seed ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function weatherAt(seed: number, day: number, month: number, lon: number, lat: number, terrain: string): number {
  const cx = Math.floor((lon + 180) / 8), cy = Math.floor((lat + 90) / 8);
  const period = Math.floor(day / 4); // weather systems last ~4 days
  const r = noise(seed, cx, cy, period);
  const north = lat >= 0;
  const alat = Math.abs(lat);
  const winter = north ? month === 11 || month <= 1 || (alat > 50 && (month === 10 || month === 2)) : month >= 5 && month <= 7;
  const summer = north ? month >= 5 && month <= 7 : month === 11 || month <= 1;
  if (terrain === 'arctic' && !summer) return W_SNOW;
  if (winter) {
    if (alat > 55) return W_SNOW;
    if (alat > 42 && r < 0.65) return W_SNOW;
    if (terrain === 'mountain' && alat > 30 && r < 0.6) return W_SNOW;
  }
  // monsoon: South & South-East Asia, June-September
  if (month >= 5 && month <= 8 && lon > 65 && lon < 125 && lat > 5 && lat < 30 && r < 0.7) return W_MONSOON;
  // tropical cyclones
  const tropStorm =
    (month >= 7 && month <= 9 && lon > -100 && lon < -50 && lat > 10 && lat < 35) ||
    (month >= 6 && month <= 9 && lon > 105 && lon < 150 && lat > 8 && lat < 35) ||
    (month >= 9 && month <= 10 && lon > 80 && lon < 95 && lat > 10 && lat < 25);
  if (tropStorm && r < 0.12) return W_STORM;
  if (summer && terrain === 'desert' && r < 0.6) return W_HEAT;
  if (r > 0.82) return W_RAIN;
  if (r < 0.015) return W_STORM;
  return W_CLEAR;
}

export function updateWeather(g: Game) {
  const month = g.month;
  const day = g.day;
  const { provs } = g.w;
  for (let i = 0; i < provs.length; i++) {
    const p = provs[i];
    g.rt.weather[i] = weatherAt(g.s.seed, day, month, p.lon, p.lat, p.terrain);
  }
}

export function weatherOf(g: Game, prov: number): Weather {
  return WEATHERS[g.rt.weather[prov]] || 'clear';
}
