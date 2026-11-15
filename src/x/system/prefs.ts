/** Saved choices for this feature group (under `settings.x.system`). */
export interface SystemPrefs {
  [key: string]: unknown;
  /** Weather that changes by itself as you drive (overrides the weather chips while on). */
  changing: boolean;
  /** Time of day follows the game's own clock, or the phone's. */
  clock: 'game' | 'phone';
  /** Minutes a full day and night takes. */
  dayMinutes: number;
  /** The moon shows tonight's real phase, or is always full. */
  moon: 'real' | 'full';
  /** Comets and satellites in the night sky. */
  nightSky: boolean;
  /** Strong winds nudge the car. */
  gusts: boolean;
  /** Finer sound levels (1 = normal). */
  lvRoof: number;
  lvWind: number;
  lvTyres: number;
  lvTraffic: number;
  lvWildlife: number;
  quietCabin: boolean;
  /** Sleep sounds: the sounds of the place, or your own mix. */
  sleepMix: 'place' | 'own';
  slRain: number;
  slWind: number;
  slWaves: number;
  slCrickets: number;
  slBirds: number;
  slHum: number;
  /** Frame rate: 0 = full, 45, 30, or -1 = automatic (30 when the battery is low). */
  refresh: number;
  /** Minutes on auto-drive without a touch before the picture dims (0 = never). */
  dimAfter: number;
  /** Keep the screen on while driving. */
  awake: boolean;
  /** 0 normal, 1 large, 2 extra large. */
  textSize: number;
  showFps: boolean;
  /** The welcome cards have been shown. */
  welcomed: boolean;
  /** The last version whose "what's new" was shown. */
  seenVersion: string;
}

export const SYSTEM_DEFAULTS: SystemPrefs = {
  changing: false,
  clock: 'game',
  dayMinutes: 16,
  moon: 'real',
  nightSky: true,
  gusts: true,
  lvRoof: 1,
  lvWind: 1,
  lvTyres: 1,
  lvTraffic: 1,
  lvWildlife: 1,
  quietCabin: false,
  sleepMix: 'place',
  slRain: 0.6,
  slWind: 0.2,
  slWaves: 0,
  slCrickets: 0.3,
  slBirds: 0,
  slHum: 0.5,
  refresh: 0,
  dimAfter: 0,
  awake: true,
  textSize: 0,
  showFps: false,
  welcomed: false,
  seenVersion: '',
};
