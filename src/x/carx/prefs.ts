/** Saved choices for the car and controls add-ons (under `settings.x.carx`). */
export interface CarxPrefs {
  /** Drive mode: how eager the car feels and how much fuel it uses. */
  mode: 'eco' | 'comfort' | 'sport';
  /** Steering sensitivity (1 = standard). */
  sens: number;
  /** Left-handed layout: pedals on the left, steering on the right. */
  lefty: boolean;
  /** Steer with the ◀ ▶ buttons or by dragging a wheel. */
  steerWith: 'buttons' | 'wheel';
  /** Bigger driving buttons. */
  bigPads: boolean;
  /** Little buzzes from the phone on rough ground, scrapes, the horn and a full tank. */
  haptics: boolean;
  /** How the speed is shown. */
  speedo: 'number' | 'dial' | 'bar';
  /** Gear and revs under the speed (petrol and diesel cars). */
  gear: boolean;
  /** Resting: let the hours pass quickly. */
  restLapse: boolean;
}

export const CARX_DEFAULTS: CarxPrefs = {
  mode: 'comfort',
  sens: 1,
  lefty: false,
  steerWith: 'buttons',
  bigPads: false,
  haptics: true,
  speedo: 'number',
  gear: false,
  restLapse: false,
};
