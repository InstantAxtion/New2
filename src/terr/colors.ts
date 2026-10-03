// Country colours (shared by every game mode).

export const FIXED_COLORS: Record<string, string> = {
  USA: '#3f6fb5', CAN: '#c0504d', MEX: '#3a8f5c', BRA: '#4caf50', ARG: '#79b6e3', GBR: '#c2414a', FRA: '#4a68b8',
  DEU: '#6d6d6d', ITA: '#4fa36b', ESP: '#e3b23c', PRT: '#2e7d55', RUS: '#7a4f9e', SOV: '#b22222', CHN: '#d9473b',
  JPN: '#e8e1d6', KOR: '#5b8fd1', PRK: '#8f3d3d', IND: '#f08c3a', PAK: '#2f7a3f', IRN: '#3c9a7e', TUR: '#b8463d',
  SAU: '#5c9e4a', EGY: '#d4b45e', ISR: '#5aa3d8', UKR: '#f0d040', POL: '#d95c6b', AUS: '#3d8c80', IDN: '#c24f3d',
  NGA: '#47915a', ZAF: '#e38b3c', ETH: '#9ac24e', VNM: '#c93b3b', THA: '#7d6bb3', TWN: '#57a35e', SWE: '#4f8cc9',
  NOR: '#b85c5c', FIN: '#e6e6f0', NLD: '#e8873a', BEL: '#d8b84a', CHE: '#c93f3f', AUT: '#e0e0e0', GRC: '#5d8cc9',
  KAZ: '#58b8c9', MNG: '#d26b5b', AFG: '#7a8f4f', IRQ: '#9a8f5a', SYR: '#8f7d5a', DZA: '#5f9e6b', LBY: '#4a7d4a',
  MAR: '#b5443c', COD: '#5fae9a', AGO: '#c7564a', SDN: '#b38f52', CUB: '#3f5fa8', VEN: '#e0b64c', COL: '#e8d45a',
  PER: '#c95a5a', CHL: '#a8526b', NZL: '#3a6fa0', PHL: '#4a62b5', MYS: '#c9a43c', MMR: '#4f9e8c', BLR: '#9eb84c',
};

export function hsl(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
}
export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

