import type { Settings } from '../../settings';

/** One-tap moods: a place, a time, some weather. */
export interface Mood {
  id: string;
  icon: string;
  name: string;
  themes: string[];
  time: Settings['time'];
  weather: Settings['weather'];
  season: Settings['season'];
}

export const MOODS: Mood[] = [
  { id: 'rainy-city', icon: '🌃', name: 'Rainy night city', themes: ['city', 'metro'], time: 'night', weather: 'rain', season: 'regions' },
  { id: 'golden-coast', icon: '🌅', name: 'Golden hour coast', themes: ['seaside'], time: 'sunset', weather: 'clear', season: 'regions' },
  { id: 'snowy-forest', icon: '🌲', name: 'Snowy forest dawn', themes: ['forest', 'winter'], time: 'dawn', weather: 'snow', season: 'winter' },
  { id: 'desert-sunset', icon: '🏜️', name: 'Desert sunset', themes: ['desert', 'canyon'], time: 'sunset', weather: 'clear', season: 'regions' },
  { id: 'misty-mountains', icon: '🏔️', name: 'Misty mountains', themes: ['alpine', 'pnw'], time: 'dawn', weather: 'fog', season: 'regions' },
  { id: 'tropical-noon', icon: '🏝️', name: 'Tropical noon', themes: ['tropical'], time: 'day', weather: 'clear', season: 'regions' },
  { id: 'autumn-drizzle', icon: '🍂', name: 'Autumn drizzle', themes: ['autumn', 'hills'], time: 'day', weather: 'rain', season: 'autumn' },
  { id: 'midnight-highway', icon: '🛣️', name: 'Midnight highway', themes: ['metro', 'flatlands'], time: 'night', weather: 'clear', season: 'regions' },
  { id: 'spring-morning', icon: '🌸', name: 'Spring morning', themes: ['blossom', 'vineyard'], time: 'dawn', weather: 'clear', season: 'spring' },
  { id: 'storm-chaser', icon: '⛈️', name: 'Storm chaser', themes: ['flatlands', 'hills'], time: 'sunset', weather: 'storm', season: 'regions' },
  { id: 'lakes-evening', icon: '🌉', name: 'Lakes at dusk', themes: ['lakes'], time: 'sunset', weather: 'clear', season: 'regions' },
  { id: 'jungle-rain', icon: '🌴', name: 'Rainforest shower', themes: ['rainforest'], time: 'day', weather: 'rain', season: 'regions' },
  { id: 'winter-night', icon: '❄️', name: 'Northern lights', themes: ['winter', 'alpine'], time: 'night', weather: 'clear', season: 'regions' },
  { id: 'summer-wander', icon: '☀️', name: 'Summer wander', themes: [], time: 'cycle', weather: 'clear', season: 'summer' },
];
