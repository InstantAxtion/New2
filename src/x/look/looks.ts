// Picture styles: each is a handful of numbers for the colour grade (high and ultra graphics), and
// a CSS filter that comes close for the simpler graphics levels, where there is no grade pass.

export interface Look {
  id: string;
  name: string;
  icon: string;
  tint: [number, number, number];
  sat: number;
  contrast: number;
  /** Lifted, milky blacks. */
  fade: number;
  mono: number;
  /** Soft glow. */
  soft: number;
  /** How strong the cool-shadows / warm-highlights split is (1 = standard). */
  split: number;
  css: string;
}

export const LOOKS: Look[] = [
  { id: 'natural', name: 'Natural', icon: '🌤️', tint: [1, 1, 1], sat: 1, contrast: 1, fade: 0, mono: 0, soft: 0, split: 1, css: '' },
  { id: 'vivid', name: 'Vivid', icon: '🌈', tint: [1, 1, 1], sat: 1.32, contrast: 1.1, fade: 0, mono: 0, soft: 0, split: 1, css: 'saturate(1.35) contrast(1.08)' },
  { id: 'film', name: 'Film', icon: '🎞️', tint: [1.03, 1, 0.95], sat: 0.88, contrast: 1.1, fade: 0.004, mono: 0, soft: 0, split: 2.6, css: 'saturate(0.85) contrast(1.1) sepia(0.12)' },
  { id: 'warm', name: 'Warm sunset', icon: '🌅', tint: [1.13, 1, 0.82], sat: 1.1, contrast: 1.03, fade: 0, mono: 0, soft: 0, split: 1, css: 'sepia(0.3) saturate(1.3) hue-rotate(-8deg)' },
  { id: 'cool', name: 'Cool blue', icon: '🧊', tint: [0.88, 1, 1.16], sat: 0.95, contrast: 1.03, fade: 0, mono: 0, soft: 0, split: 1, css: 'saturate(0.95) hue-rotate(12deg) brightness(1.02)' },
  { id: 'retro', name: 'Faded retro', icon: '📼', tint: [1.07, 1, 0.88], sat: 0.62, contrast: 0.88, fade: 0.012, mono: 0, soft: 0, split: 0.5, css: 'saturate(0.6) contrast(0.86) sepia(0.25) brightness(1.06)' },
  { id: 'bw', name: 'Black & white', icon: '🖤', tint: [1, 1, 1], sat: 1, contrast: 1.15, fade: 0, mono: 1, soft: 0, split: 0, css: 'grayscale(1) contrast(1.12)' },
  { id: 'dreamy', name: 'Dreamy soft', icon: '☁️', tint: [1.03, 1, 1.03], sat: 1.06, contrast: 0.94, fade: 0.004, mono: 0, soft: 0.65, split: 1, css: 'saturate(1.08) contrast(0.92) brightness(1.06)' },
];

export const lookOf = (id: string): Look => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

/** Grain strength in the shader for the off / subtle / strong setting. */
export const GRAIN = [0, 0.14, 0.3];

/** Edge streaking (0..1) for a speed in m/s: nothing below ~55 mph, full by ~125 mph. */
export function speedBlur(v: number): number {
  const k = (Math.abs(v) - 25) / 30;
  return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
}
