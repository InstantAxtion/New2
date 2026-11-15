import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { profile, surface, type BodyShape } from './carbody';
import type { CarSpec, Custom } from './carspecs';

// Garage extras: number plates with your own text, decals on the doors, and doors, a bonnet
// and a boot that open (with the engine bay or boot space behind them).

export type Decal = 'none' | 'number' | 'flames' | 'stripe' | 'stars' | 'endless';
export const DECALS: { id: Decal; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'number', name: 'Race number' },
  { id: 'flames', name: 'Flames' },
  { id: 'stripe', name: 'Side stripe' },
  { id: 'stars', name: 'Stars' },
  { id: 'endless', name: 'Endless Drive' },
];

/** A made-up registration for a car. */
export function defaultPlate(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const l = (n: number) => L[(h >>> n) % L.length];
  return `${l(0)}${l(5)}${10 + (h % 89)} ${l(10)}${l(15)}${l(20)}`;
}

const plateCache = new Map<string, THREE.Texture>();
export function plateTexture(text: string, rear: boolean): THREE.Texture {
  const key = text + rear;
  if (plateCache.has(key)) return plateCache.get(key)!;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = rear ? '#f6d44a' : '#f4f4ef';
  g.beginPath();
  g.roundRect(0, 0, 512, 128, 14);
  g.fill();
  g.strokeStyle = '#222';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(5, 5, 502, 118, 11);
  g.stroke();
  // A blue band on the left
  g.fillStyle = '#1f4ea3';
  g.fillRect(8, 8, 44, 112);
  g.fillStyle = '#ffd400';
  g.font = '700 22px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('ED', 30, 104);
  g.fillStyle = '#111';
  g.font = '800 84px Inter, system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase().slice(0, 9), 282, 68, 430);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  plateCache.set(key, t);
  return t;
}

function decalTexture(kind: Decal, color: number, num: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const col = '#' + color.toString(16).padStart(6, '0');
  if (kind === 'number') {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(256, 128, 110, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#111';
    g.stroke();
    g.fillStyle = '#111';
    g.font = '900 150px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), 256, 138);
  } else if (kind === 'flames') {
    // Licks of flame streaming back from the front
    for (let k = 0; k < 7; k++) {
      const y = 50 + k * 26;
      const len = 260 + Math.sin(k * 1.7) * 120;
      const grad = g.createLinearGradient(512, 0, 512 - len, 0);
      grad.addColorStop(0, '#ffd23a');
      grad.addColorStop(0.5, '#ff7a1a');
      grad.addColorStop(1, 'rgba(200,30,20,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(512, y - 18);
      g.bezierCurveTo(512 - len * 0.4, y - 30, 512 - len * 0.7, y + 10, 512 - len, y - 6);
      g.bezierCurveTo(512 - len * 0.6, y + 26, 512 - len * 0.3, y + 22, 512, y + 18);
      g.fill();
    }
  } else if (kind === 'stripe') {
    g.fillStyle = col;
    g.fillRect(0, 96, 512, 30);
    g.fillRect(0, 140, 512, 10);
  } else if (kind === 'stars') {
    g.fillStyle = col;
    for (let k = 0; k < 9; k++) {
      const x = 40 + k * 52, y = 128 + Math.sin(k * 1.3) * 60, r = 10 + (k % 3) * 8;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
    }
  } else if (kind === 'endless') {
    g.fillStyle = col;
    g.font = 'italic 900 92px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ENDLESS', 256, 110);
    g.font = 'italic 700 42px Inter, system-ui, sans-serif';
    g.fillText('— DRIVE —', 256, 180);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Stick a decal on both doors of the body shell. */
export function addDecals(shell: THREE.Mesh, s: CarSpec & BodyShape, kind: Decal, color: number, pbr: boolean): THREE.Mesh[] {
  if (kind === 'none') return [];
  const P = profile(s);
  const num = 2 + (s.id.length * 7) % 97;
  const tex = decalTexture(kind, color, num);
  const mat = pbr
    ? new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false })
    : new THREE.MeshLambertMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
  shell.updateMatrixWorld(true);
  const out: THREE.Mesh[] = [];
  const zc = (s.A + (s.doors === 4 ? s.C : s.D)) / 2 + 0.1;
  const sf = surface(s, P, zc);
  const y = (sf.bot + sf.belt) / 2 + 0.02;
  const len = kind === 'number' ? 0.62 : kind === 'stripe' ? s.length * 0.82 : 1.5;
  const hgt = kind === 'number' ? 0.62 : kind === 'stripe' ? (sf.belt - sf.bot) * 1.1 : 0.55;
  for (const side of [-1, 1]) {
    const pos = new THREE.Vector3(side * sf.sideAt(y), y, kind === 'stripe' ? 0 : zc);
    // Project inward from the side; the texture's +x runs towards the front
    const rot = new THREE.Euler(0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    const geo = new DecalGeometry(shell, pos, rot, new THREE.Vector3(side > 0 ? -len : len, hgt, 0.6));
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 1;
    out.push(m);
  }
  return out;
}

export interface Openings {
  group: THREE.Group;
  /** The door openings, for cutting out of the body (box: zFront, zBack, yLow, yHigh; sides beyond |x|). */
  doorBox?: { zF: number; zB: number; yLo: number; yHi: number; x: number };
  /** Called as the doors start to open (true) and once they're shut again (false). */
  onDoor?: (open: boolean) => void;
  set(door: boolean, bonnet: boolean, boot: boolean): void;
  update(dt: number): void;
  readonly moving: boolean;
}

/** Doors, a bonnet and a boot that swing open; shut, they're hidden and the body shows. */
export function buildOpenings(s: CarSpec & BodyShape, paint: THREE.Material, dark: THREE.Material, leather: number, electric: boolean, none = false): Openings {
  const group = new THREE.Group();
  if (none) return { group, set() {}, update() {}, moving: false };
  const P = profile(s);
  const scissor = s.features.includes('scissor');
  const inner = new THREE.MeshStandardMaterial({ color: leather, roughness: 0.8, side: THREE.DoubleSide });
  const black = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.9, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.4, metalness: 0.7 });
  const paintDS = (paint as THREE.MeshStandardMaterial).clone();
  paintDS.side = THREE.DoubleSide;

  // ---- Doors: a skin following the side of the body, hinged at the front edge ----
  const zF = s.open ? s.A - 0.05 : s.A - 0.02;
  const zB = s.doors === 4 ? zF - 1.05 : zF - 1.3;
  const doors: { pivot: THREE.Group; side: number; aperture: THREE.Mesh }[] = [];
  for (const side of [-1, 1]) {
    const pos: number[] = [];
    const idx: number[] = [];
    const NZ = 10, NY = 8;
    const sf0 = surface(s, P, zF);
    const hingeX = side * sf0.sideAt((sf0.bot + sf0.belt) / 2);
    for (let i = 0; i <= NZ; i++) {
      const z = zF + ((zB - zF) * i) / NZ;
      const sf = surface(s, P, z);
      const y0 = sf.bot + 0.06, y1 = sf.belt - 0.005;
      for (let j = 0; j <= NY; j++) {
        const y = y0 + ((y1 - y0) * j) / NY;
        pos.push(side * (sf.sideAt(y) + 0.006) - hingeX, y, z - zF);
      }
    }
    for (let i = 0; i < NZ; i++) for (let j = 0; j < NY; j++) {
      const a = i * (NY + 1) + j, b = a + 1, c = a + NY + 1, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
    const skin = new THREE.BufferGeometry();
    skin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    skin.setIndex(idx);
    skin.computeVertexNormals();
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, zF);
    pivot.add(new THREE.Mesh(skin, paintDS));
    // The door card on the inside, a little in from the skin
    const card = skin.clone();
    card.translate(-side * 0.07, 0, 0);
    pivot.add(new THREE.Mesh(card, inner));
    // The window frame above the belt (open cars have none)
    if (!s.open) {
      const sfm = surface(s, P, (zF + zB) / 2);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, sfm.top - sfm.belt - 0.08, Math.abs(zB - zF) - 0.12), dark);
      frame.position.set(-side * 0.04, (sfm.belt + sfm.top) / 2 - 0.04, (zB - zF) / 2);
      pivot.add(frame);
    }
    group.add(pivot);
    // What you see where the door was: the dark opening into the cabin, and a sill plate
    const ap = skin.clone();
    ap.translate(hingeX - side * 0.002, 0, zF);
    // (the body is cut away behind an open door, so the opening shows the real cabin: just the sill here)
    const aperture = new THREE.Mesh(ap, new THREE.MeshBasicMaterial({ visible: false }));
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, Math.abs(zB - zF) - 0.1), metal);
    sill.position.set(hingeX - side * 0.03, surface(s, P, (zF + zB) / 2).bot + 0.09, (zF + zB) / 2);
    aperture.add(sill);
    sill.position.sub(aperture.position);
    group.add(aperture);
    doors.push({ pivot, side, aperture });
  }

  // ---- Bonnet: the top of the nose, hinged at the windscreen ----
  const bonnetF = P.front - 0.22, bonnetR = s.A + (s.open ? -0.05 : 0.04);
  const panel = (z0: number, z1: number, lift: number) => {
    const pos: number[] = [];
    const idx: number[] = [];
    const NZ = 8, NX = 10;
    for (let i = 0; i <= NZ; i++) {
      const z = z0 + ((z1 - z0) * i) / NZ;
      const sf = surface(s, P, z);
      const w = sf.hw * 0.86;
      for (let j = 0; j <= NX; j++) {
        const t = j / NX * 2 - 1;
        const x = t * w;
        const y = sf.belt + Math.min(0.045, sf.top - sf.belt + 0.04) * (1 - t * t * 0.6) + lift;
        pos.push(x, y, z);
      }
    }
    for (let i = 0; i < NZ; i++) for (let j = 0; j < NX; j++) {
      const a = i * (NX + 1) + j, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const bonnetPivot = new THREE.Group();
  const bh = surface(s, P, bonnetR);
  bonnetPivot.position.set(0, bh.belt + 0.04, bonnetR);
  const bonnet = new THREE.Mesh(panel(bonnetF, bonnetR, 0.004).translate(0, -(bh.belt + 0.04), -bonnetR), paintDS);
  bonnetPivot.add(bonnet);
  group.add(bonnetPivot);
  // The engine bay (or a front boot on an electric car)
  const bay = new THREE.Group();
  const bayLen = bonnetR - bonnetF, bayW = surface(s, P, (bonnetF + bonnetR) / 2).hw * 1.6;
  // The body shell is closed underneath, so the bay is a dark recess laid over it with the parts on top
  bay.add(new THREE.Mesh(panel(bonnetF + 0.02, bonnetR - 0.02, 0.003), black));
  const sfc = surface(s, P, (bonnetF + bonnetR) / 2);
  const ty = sfc.belt + Math.min(0.045, sfc.top - sfc.belt + 0.04);
  const zc = (bonnetF + bonnetR) / 2;
  if (electric) {
    const liner = new THREE.Mesh(new THREE.BoxGeometry(bayW * 0.6, 0.012, bayLen * 0.6), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 1 }));
    liner.position.set(0, ty + 0.01, zc);
    bay.add(liner);
  } else {
    const block = new THREE.Mesh(new THREE.BoxGeometry(bayW * 0.5, 0.03, bayLen * 0.5), metal);
    block.position.set(0, ty + 0.015, zc - 0.05);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(bayW * 0.36, 0.035, bayLen * 0.36), new THREE.MeshStandardMaterial({ color: 0xa8231c, roughness: 0.4 }));
    cover.position.set(0, ty + 0.035, zc - 0.05);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.18), black);
    box.position.set(bayW * 0.33, ty + 0.02, bonnetR - 0.25);
    const res = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.6 }));
    res.position.set(-bayW * 0.32, ty + 0.025, bonnetR - 0.22);
    bay.add(block, cover, box, res);
  }
  bay.visible = false;
  group.add(bay);

  // ---- Boot: the rear deck (or tailgate), hinged at the front edge ----
  const bootR = P.rear + 0.15, bootF = s.open || s.bed ? P.rear + 0.9 : Math.max(s.D - 0.02, P.rear + 0.5);
  const bootPivot = new THREE.Group();
  const bh2 = surface(s, P, bootF);
  bootPivot.position.set(0, bh2.belt + 0.04, bootF);
  const lid = new THREE.Mesh(panel(bootR, bootF, 0.004).translate(0, -(bh2.belt + 0.04), -bootF), paintDS);
  bootPivot.add(lid);
  group.add(bootPivot);
  const space = new THREE.Mesh(panel(bootR + 0.03, bootF - 0.02, 0.003), black);
  space.visible = false;
  group.add(space);

  const target = { door: 0, bonnet: 0, boot: 0 };
  const now = { door: 0, bonnet: 0, boot: 0 };
  let doorWas = false;
  const apply = () => {
    const ease = (t: number) => t * t * (3 - 2 * t);
    const doorOpen = now.door > 0.001;
    if (doorOpen !== doorWas) {
      doorWas = doorOpen;
      result.onDoor?.(doorOpen);
    }
    for (const d of doors) {
      const a = ease(now.door);
      // Scissor doors swing up from the front; ordinary ones swing out
      if (scissor) d.pivot.rotation.set(a * 1.25, -d.side * a * 0.18, 0, 'YXZ');
      else d.pivot.rotation.y = -d.side * a * 1.05;
      d.pivot.visible = now.door > 0.001;
      d.aperture.visible = now.door > 0.001;
    }
    bonnetPivot.rotation.x = -ease(now.bonnet) * 0.95;
    bonnetPivot.visible = now.bonnet > 0.001;
    bay.visible = now.bonnet > 0.001;
    bootPivot.rotation.x = ease(now.boot) * 1.1;
    bootPivot.visible = now.boot > 0.001;
    space.visible = now.boot > 0.001;
  };
  let moving = false;
  const sfMid = surface(s, P, (zF + zB) / 2);
  const result: Openings = {
    group,
    doorBox: { zF: zF + 0.01, zB: zB - 0.01, yLo: sfMid.bot + 0.07, yHi: s.open ? sfMid.belt + 0.05 : sfMid.top - 0.03, x: sfMid.hw * 0.55 },
    get moving() {
      return moving;
    },
    set(door, bonnetOpen, boot) {
      target.door = door ? 1 : 0;
      target.bonnet = bonnetOpen ? 1 : 0;
      target.boot = boot ? 1 : 0;
    },
    update(dt) {
      moving = false;
      for (const k of ['door', 'bonnet', 'boot'] as const) {
        const d = target[k] - now[k];
        if (Math.abs(d) < 1e-4) continue;
        now[k] += Math.sign(d) * Math.min(Math.abs(d), dt * 1.4);
        moving = true;
      }
      if (moving) apply();
    },
  };
  apply();
  return result;
}
