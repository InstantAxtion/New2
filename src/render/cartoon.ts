// Cartoon colour helpers shared by the map and the UI.

export function toRgb(c: string): [number, number, number] {
  let r = 70, g = 80, b = 90;
  if (c.startsWith('#') && c.length === 7) {
    const n = parseInt(c.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = c.match(/\d+(\.\d+)?/g);
    if (c.startsWith('rgb') && m) [r, g, b] = m.slice(0, 3).map(Number);
    else if (c.startsWith('hsl') && m) {
      const [h, sat, l] = m.map(Number);
      const a = (sat / 100) * Math.min(l / 100, 1 - l / 100);
      const f = (k0: number) => { const k = (k0 + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      r = f(0); g = f(8); b = f(4);
    }
  }
  return [r, g, b];
}

const cartoonCache = new Map<string, string>();
/** Brighter, punchier version of a nation colour for the cartoon map. */
export function cartoon(c: string): string {
  let out = cartoonCache.get(c);
  if (out) return out;
  const [r0, g0, b0] = toRgb(c).map((v) => v / 255);
  const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0);
  let h = 0, sat = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r0 ? (g0 - b0) / d + (g0 < b0 ? 6 : 0) : max === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4;
    h *= 60;
  }
  const S = Math.min(0.88, sat * 1.25 + 0.1);
  const L = Math.max(0.46, Math.min(0.7, l * 1.05 + 0.05));
  out = `hsl(${h.toFixed(0)}, ${(S * 100).toFixed(0)}%, ${(L * 100).toFixed(0)}%)`;
  cartoonCache.set(c, out);
  return out;
}
