/** Saved choices for the picture and the cameras (under `settings.x.look`). */
export interface LookPrefs {
  /** Picture style (see LOOKS). */
  style: string;
  /** Film grain: 0 off, 1 subtle, 2 strong. */
  grain: number;
  /** How dark the corners of the picture go (0.2 is the standard look). */
  vignette: number;
  /** Streaking at the edges of the screen at speed. */
  speedBlur: boolean;
  /** Black bars top and bottom in the cinematic camera. */
  bars: boolean;
  /** 3rd-person camera: extra field of view (degrees), distance and height (× the standard). */
  fov: number;
  dist: number;
  height: number;
  /** Photo mode: write the place and date on the picture. */
  caption: boolean;
  [key: string]: unknown;
}

export const LOOK_DEFAULTS: LookPrefs = {
  style: 'natural',
  grain: 0,
  vignette: 0.2,
  speedBlur: false,
  bars: true,
  fov: 0,
  dist: 1,
  height: 1,
  caption: true,
};
