/** Saved choices for roadside scenery (under `settings.x.scenery`). */
export interface SceneryPrefs {
  [key: string]: unknown;
  /** How much roadside detail to show: 0.5 less, 1 normal, 1.6 more. */
  detail: number;
}

export const SCENERY_DEFAULTS: SceneryPrefs = { detail: 1 };
