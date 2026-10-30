import * as THREE from 'three';

/**
 * A smooth car body, lofted from cross-sections along the car's length. The side profile
 * (roof line, windscreen, bonnet, boot) is a spline through a few key points; each
 * cross-section is a rounded shape with a narrower glasshouse on top. Wheel arches are
 * cut by lifting the underside around each axle.
 */
export interface BodyShape {
  length: number;
  width: number;
  wheel: number;
  /** Axle positions (front, rear), metres from the centre. */
  axles: [number, number];
  /** Underside height between the wheels. */
  sill: number;
  /** Shoulder (belt line) height. */
  belt: number;
  /** Height of the very front and back. */
  nose: number;
  tail: number;
  /** Boot lid height (cars with a separate boot). */
  deck: number;
  /** Roof height. */
  roof: number;
  /** Windscreen base, roof front, roof back, rear-window base (x along the car, + is forward). */
  A: number;
  B: number;
  C: number;
  D: number;
  /** No roof (convertible) or a pickup bed behind the cab. */
  open?: boolean;
  bed?: boolean;
  /** How much the glasshouse narrows towards the roof (0.7..0.85). */
  tumble?: number;
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Catmull-Rom through (x, y) points sorted by x. */
function spline(pts: [number, number][]) {
  return (x: number) => {
    let i = 0;
    while (i < pts.length - 2 && x > pts[i + 1][0]) i++;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const t = Math.min(1, Math.max(0, (x - p1[0]) / (p2[0] - p1[0] || 1)));
    const t2 = t * t, t3 = t2 * t;
    // Uniform Catmull-Rom on y, tamed so it can't overshoot much
    const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    const lo = Math.min(p1[1], p2[1]) - 0.04, hi = Math.max(p1[1], p2[1]) + 0.04;
    return Math.min(hi, Math.max(lo, y));
  };
}

export interface BodyProfile {
  top: (x: number) => number;
  belt: (x: number) => number;
  bottom: (x: number) => number;
  half: (x: number) => number;
  front: number;
  rear: number;
}

export function profile(s: BodyShape): BodyProfile {
  const front = s.length / 2, rear = -s.length / 2;
  const pts: [number, number][] = [];
  if (s.open) {
    pts.push([rear, s.tail], [rear + 0.25, s.deck], [s.A, s.belt + 0.02], [front - 0.35, s.nose + 0.06], [front, s.nose]);
  } else if (s.bed) {
    pts.push([rear, s.belt], [s.D - 0.02, s.belt], [s.D, s.roof - 0.05], [s.C, s.roof], [s.B, s.roof], [s.A, s.belt + 0.03], [front - 0.3, s.nose + 0.05], [front, s.nose]);
  } else {
    if (s.D > rear + 0.12) pts.push([rear, s.tail], [rear + 0.18, s.deck], [s.D, s.deck + 0.02]);
    else pts.push([rear, s.tail]);
    pts.push([s.C, s.roof - 0.02], [(s.B + s.C) / 2, s.roof], [s.B, s.roof - 0.02], [s.A, s.belt + 0.02], [front - 0.3, s.nose + 0.05], [front, s.nose]);
  }
  const top = spline(pts);
  const beltAt = (x: number) => Math.min(top(x), s.belt + ((front - x) / s.length) * 0.05 - 0.02);
  const bottom = (x: number) => {
    let b = s.sill + Math.pow(Math.abs(x) / (s.length / 2), 6) * 0.12;
    for (const ax of s.axles) {
      const d = Math.abs(x - ax);
      const r = s.wheel + 0.1;
      if (d < r) b = Math.max(b, s.wheel + Math.sqrt(r * r - d * d) * 0.98);
    }
    return b;
  };
  const half = (x: number) => {
    const t = Math.abs(x) / (s.length / 2);
    return (s.width / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 9)));
  };
  return { top, belt: beltAt, bottom, half, front, rear };
}

/** Builds the body. Groups: 0 = paint, 1 = glass, 2 = trim (dark plastic). */
export function bodyGeometry(s: BodyShape): THREE.BufferGeometry {
  const P = profile(s);
  const N = 64;
  const xs: number[] = [];
  for (let i = 0; i <= N; i++) xs.push(-Math.cos((Math.PI * i) / N) * (s.length / 2));
  const tumble = s.tumble ?? 0.78;
  const HALF = 11; // points on one side, bottom centre to top centre
  const pos: number[] = [];
  const zone: number[] = []; // per station: 0 none, 1 side glass, 2 windscreen/rear glass
  const tubs: number[] = []; // per station: how deep the open cockpit is (0..1)
  for (const x of xs) {
    const hw = P.half(x);
    const top = P.top(x);
    const belt = Math.min(P.belt(x), top);
    const bot = Math.min(P.bottom(x), belt - 0.05);
    const cabin = !s.open && top > belt + 0.06 && x < s.A + 0.02 && x > (s.bed ? s.D - 0.01 : s.D - 0.02);
    zone.push(cabin ? (x > s.B || x < s.C ? 2 : 1) : 0);
    const mid = (bot + belt) / 2;
    const ring: [number, number][] = [
      [0, bot],
      [hw * 0.82, bot],
      [hw * 0.97, bot + Math.min(0.08, (belt - bot) * 0.2)],
      [hw * 1.0, mid],
      [hw * 0.99, belt - 0.06],
      [hw * 0.95, belt],
    ];
    // Open cars: the top dips into a cockpit tub between the windscreen and the rear deck
    const tub = s.open ? Math.min(smooth((s.A - x) / 0.18), smooth((x - (s.A - 1.75)) / 0.25)) : 0;
    tubs.push(tub);
    if (cabin) {
      const rw = hw * tumble;
      ring.push([hw * 0.9, belt + 0.02], [rw + (hw * 0.9 - rw) * 0.15, top - 0.06], [rw * 0.92, top - 0.01], [rw * 0.5, top + 0.015], [0, top + 0.02]);
    } else if (tub > 0) {
      const c = Math.min(0.045, (top - belt) + 0.04);
      const floor = Math.max(s.sill + 0.16, belt - 0.42);
      const dip = (y: number) => y + (floor - y) * tub;
      ring.push([hw * 0.88, belt + c * 0.6], [hw * 0.8, belt + c * 0.4 - 0.03 * tub], [hw * 0.78, dip(belt)], [hw * 0.5, dip(belt + c)], [0, dip(belt + c)]);
    } else {
      const c = Math.min(0.045, (top - belt) + 0.04);
      ring.push([hw * 0.86, belt + c * 0.5], [hw * 0.7, belt + c * 0.8], [hw * 0.5, belt + c * 0.95], [hw * 0.25, belt + c], [0, belt + c]);
    }
    // Right side (x negative in car space is the right; forward is +z after we swap axes)
    for (let k = 0; k < HALF; k++) pos.push(-ring[k][0], ring[k][1], x);
    for (let k = HALF - 2; k >= 1; k--) pos.push(ring[k][0], ring[k][1], x);
  }
  const R = HALF * 2 - 2; // ring size (bottom and top centres not duplicated)
  const groups: number[][] = [[], [], []];
  for (let i = 0; i < xs.length - 1; i++) {
    const za = zone[i], zb = zone[i + 1];
    for (let k = 0; k < R; k++) {
      const a = i * R + k, b = i * R + ((k + 1) % R);
      const c = a + R, d = b + R;
      // Which band of the ring this quad is on (0 = bottom … 10 = roof centre)
      const kk = k < HALF ? k : R - k - 1;
      let g = 0;
      if (kk === 0) g = 2;
      // Inside of an open cockpit is trim, not paint
      if (kk >= 7 && tubs[i] > 0.3 && tubs[i + 1] > 0.3) g = 2;
      if (za && zb) {
        if (kk === 6 || kk === 7) g = 1;
        if (kk >= 8 && za === 2 && zb === 2) g = 1;
        if (kk === 8 && (za === 2 || zb === 2)) g = 1;
      }
      groups[g].push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const idx = [...groups[0], ...groups[1], ...groups[2]];
  geo.setIndex(idx);
  geo.addGroup(0, groups[0].length, 0);
  geo.addGroup(groups[0].length, groups[1].length, 1);
  geo.addGroup(groups[0].length + groups[1].length, groups[2].length, 2);
  geo.computeVertexNormals();
  return geo;
}
