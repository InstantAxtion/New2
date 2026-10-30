import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, SEGMENT, STOP_INFO } from './world/world';
import { BIOMES } from './world/biomes';
import { hash1 } from './world/noise';

// Road signs on the verge, facing the traffic coming towards +z: speed limits and town
// names, a welcome board for each region, warnings for bends, deer and tunnels, and
// signs for the stops ahead.

type Draw = (g: CanvasRenderingContext2D, W: number, H: number) => void;

const texCache = new Map<string, THREE.MeshStandardMaterial>();
function face(key: string, W: number, H: number, draw: Draw): THREE.MeshStandardMaterial {
  let m = texCache.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  draw(g, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // Retro-reflective: a touch of glow so they read at night in the headlights
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, transparent: true, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12 });
  texCache.set(key, m);
  return m;
}

const font = (px: number, weight = 800) => `${weight} ${px}px Inter, system-ui, sans-serif`;
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string, maxW?: number) {
  g.fillStyle = color;
  g.font = font(px);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y, maxW);
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

const limitFace = (n: number, unit: string) =>
  face(`limit${n}${unit}`, 256, 256, (g, W) => {
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = '#d4202a';
    g.fill();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 30, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    text(g, String(n), W / 2, W / 2 - 4, n >= 100 ? 92 : 112, '#111');
    text(g, unit, W / 2, W / 2 + 64, 26, '#111');
  });

const townFace = (name: string, end: boolean) =>
  face(`town${name}${end}`, 512, 256, (g, W, H) => {
    roundRect(g, 4, 4, W - 8, H - 8, 18);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#1b1b1b';
    g.stroke();
    text(g, name, W / 2, H * 0.44, 88, '#111', W - 50);
    text(g, end ? 'Thanks for visiting' : 'Please drive carefully', W / 2, H * 0.78, 30, '#444');
    if (end) {
      g.strokeStyle = '#d4202a';
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(30, H - 30);
      g.lineTo(W - 30, 30);
      g.stroke();
    }
  });

const welcomeFace = (name: string, emoji: string) =>
  face(`welcome${name}`, 1024, 384, (g, W, H) => {
    roundRect(g, 6, 6, W - 12, H - 12, 30);
    g.fillStyle = '#5a3b22';
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = '#e8d9b8';
    g.stroke();
    text(g, 'Welcome to', W / 2, H * 0.24, 54, '#e8d9b8');
    text(g, `${emoji} ${name}`, W / 2, H * 0.62, 132, '#fff7e6', W - 60);
  });

const warnFace = (icon: string) =>
  face(`warn${icon}`, 256, 232, (g, W, H) => {
    g.beginPath();
    g.moveTo(W / 2, 4);
    g.lineTo(W - 4, H - 4);
    g.lineTo(4, H - 4);
    g.closePath();
    g.fillStyle = '#d4202a';
    g.fill();
    g.beginPath();
    g.moveTo(W / 2, 40);
    g.lineTo(W - 34, H - 22);
    g.lineTo(34, H - 22);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    text(g, icon, W / 2, H * 0.66, 92, '#111');
  });

const chevronFace = (dir: number) =>
  face(`chev${dir}`, 256, 256, (g, W, H) => {
    g.fillStyle = '#111';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd21f';
    for (let k = 0; k < 2; k++) {
      const x0 = 40 + k * 90;
      g.beginPath();
      if (dir > 0) {
        g.moveTo(x0, 40); g.lineTo(x0 + 60, H / 2); g.lineTo(x0, H - 40); g.lineTo(x0 + 34, H - 40); g.lineTo(x0 + 94, H / 2); g.lineTo(x0 + 34, 40);
      } else {
        g.moveTo(W - x0, 40); g.lineTo(W - x0 - 60, H / 2); g.lineTo(W - x0, H - 40); g.lineTo(W - x0 - 34, H - 40); g.lineTo(W - x0 - 94, H / 2); g.lineTo(W - x0 - 34, 40);
      }
      g.closePath();
      g.fill();
    }
  });

const infoFace = (lines: [string, string], bg: string) =>
  face(`info${lines.join()}${bg}`, 512, 256, (g, W, H) => {
    roundRect(g, 4, 4, W - 8, H - 8, 20);
    g.fillStyle = bg;
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
    text(g, lines[0], W / 2, H * 0.36, 70, '#ffffff', W - 40);
    text(g, lines[1], W / 2, H * 0.74, 46, '#ffffff', W - 40);
  });

interface Placed {
  mat: THREE.MeshStandardMaterial;
  w: number;
  h: number;
  /** Height of the panel centre above the road. */
  y: number;
  round?: boolean;
  /** Second panel stacked underneath (a speed limit under a town name). */
  under?: Placed;
}

function distLabel(m: number, units: 'mph' | 'kmh') {
  if (units === 'mph') {
    const mi = m / 1609;
    return mi < 0.4 ? `${Math.round(m * 1.094 / 50) * 50} yds` : `${mi < 1 ? (Math.round(mi * 4) / 4).toString().replace('0.25', '¼').replace('0.5', '½').replace('0.75', '¾') : mi.toFixed(1)} mi`;
  }
  return m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1)} km`;
}

export function buildSigns(w: World, z0: number, z1: number, origin: THREE.Vector3, units: 'mph' | 'kmh'): THREE.Group | null {
  const list: { z: number; side: number; sign: Placed }[] = [];
  const unit = units === 'mph' ? 'mph' : 'km/h';
  const lim = (mph: number) => limitFace(units === 'mph' ? mph : Math.round((mph * 1.609) / 10) * 10, unit);
  const ok = (z: number) => w.bridge(z) < 0.2 && w.tunnelAt(z) < 0.05;

  // Towns: name and limit coming in, end sign and the open-road limit going out
  for (const c of w.towns(z0 - 400, z1 + 400)) {
    const name = w.townName(c);
    const zin = c - 262, zout = c + 262;
    if (zin >= z0 && zin < z1 && ok(zin)) list.push({ z: zin, side: 1, sign: { mat: townFace(name, false), w: 2.6, h: 1.3, y: 2.9, under: { mat: lim(30), w: 0.9, h: 0.9, y: 1.6, round: true } } });
    if (zout >= z0 && zout < z1 && ok(zout)) list.push({ z: zout, side: 1, sign: { mat: townFace(name, true), w: 2.6, h: 1.3, y: 2.9, under: { mat: lim(60), w: 0.9, h: 0.9, y: 1.6, round: true } } });
  }
  // Region welcome boards
  for (let k = Math.ceil(z0 / SEGMENT); k * SEGMENT < z1; k++) {
    const a = w.regionBiome(k - 1), b = w.regionBiome(k);
    const z = k * SEGMENT - 160;
    if (a === b || !ok(z) || w.urban(z) > 0.05) continue;
    list.push({ z, side: 1, sign: { mat: welcomeFace(BIOMES[b].name, BIOMES[b].emoji), w: 5.4, h: 2.0, y: 2.6 } });
  }
  // Highways: the limit at the start
  for (let z = Math.ceil(z0 / 8) * 8; z < z1; z += 8) {
    if (w.highwayAt(z) > 0.98 && w.highwayAt(z - 8) <= 0.98) list.push({ z: z + 40, side: 1, sign: { mat: lim(70), w: 1.1, h: 1.1, y: 2.2, round: true } });
    // Tunnel ahead
    if (w.tunnelAt(z + 160) > 0.45 && w.tunnelAt(z + 152) <= 0.45 && ok(z)) {
      list.push({ z, side: 1, sign: { mat: infoFace(['⛰ Tunnel', distLabel(160, units)], '#1f4e9c'), w: 2.2, h: 1.1, y: 2.4 } });
    }
  }
  // Deer crossing warnings in the woods, now and then
  const cell = 900;
  for (let c = Math.floor(z0 / cell); c * cell < z1; c++) {
    const z = c * cell + 200;
    if (z < z0 || z >= z1 || hash1(c, w.seed + 701) > 0.5 || !ok(z) || w.urban(z) > 0.01) continue;
    const id = w.dominant(z).id;
    if (['forest', 'alpine', 'winter', 'autumn', 'hills', 'blossom'].includes(id)) list.push({ z, side: 1, sign: { mat: warnFace('🦌'), w: 1.15, h: 1.04, y: 2.2 } });
  }
  // Chevrons on the outside of sharp bends
  for (let z = Math.ceil(z0 / 18) * 18; z < z1; z += 18) {
    if (Math.abs(w.curvature(z)) < 0.014 || !ok(z) || w.urban(z) > 0.05) continue;
    const [tx, tz] = w.tangent(z);
    const dx = w.roadX(z + 25) - w.roadX(z), dz = 25;
    // Which way the road turns: + right, - left (right = (-tz, tx))
    const turn = Math.sign(dx * -tz + dz * tx);
    list.push({ z, side: -turn, sign: { mat: chevronFace(turn), w: 0.75, h: 0.75, y: 1.3 } });
  }
  // Stops ahead
  for (const st of w.stops(z0 - 1000, z1 + 1000)) {
    for (const d of [800, 250]) {
      const z = st.z - st.len / 2 - d;
      if (z < z0 || z >= z1 || !ok(z)) continue;
      const info = STOP_INFO[st.kind];
      list.push({ z, side: 1, sign: { mat: infoFace([`${info.icon} ${info.name}`, `${st.side > 0 ? '' : '← '}${distLabel(d, units)}${st.side > 0 ? ' →' : ''}`], st.kind === 'viewpoint' || st.kind === 'campsite' ? '#6b4a2c' : '#1f4e9c'), w: 2.6, h: 1.3, y: 2.6 } });
    }
  }
  if (!list.length) return null;

  const g = new THREE.Group();
  const poles: THREE.BufferGeometry[] = [];
  const backs: THREE.BufferGeometry[] = [];
  const panels = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
  for (const { z, side, sign } of list) {
    const [tx, tz] = w.tangent(z);
    const u = side * (w.roadHalf(z) + 1.9);
    const x = w.roadX(z) - tz * u, zz = z + tx * u;
    const y = w.roadY(z);
    const yaw = Math.atan2(-tx, -tz);
    const put = (p: Placed) => {
      const geo = p.round ? new THREE.CircleGeometry(p.w / 2, 28) : new THREE.PlaneGeometry(p.w, p.h);
      const back = geo.clone().rotateY(Math.PI);
      for (const [arr, gg, off] of [[null, geo, 0.03], [backs, back, -0.0]] as const) {
        gg.translate(0, p.y, off).rotateY(yaw).translate(x - origin.x, y - origin.y, zz - origin.z);
        if (arr) arr.push(gg);
        else {
          if (!panels.has(p.mat)) panels.set(p.mat, []);
          panels.get(p.mat)!.push(gg);
        }
      }
    };
    put(sign);
    if (sign.under) put(sign.under);
    // Posts: two for wide boards, one otherwise
    const legs = sign.w > 2 ? [-sign.w * 0.35, sign.w * 0.35] : [0];
    const top = sign.y + sign.h / 2 - 0.1;
    for (const lx of legs) {
      poles.push(new THREE.CylinderGeometry(0.05, 0.05, top, 6).translate(lx, top / 2, -0.04).rotateY(yaw).translate(x - origin.x, y - origin.y, zz - origin.z));
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.4, metalness: 0.6 });
  g.add(new THREE.Mesh(mergeGeometries(poles)!, metal));
  for (const b of backs) {
    b.deleteAttribute('uv');
  }
  g.add(new THREE.Mesh(mergeGeometries(backs.map((b) => { const n = b.toNonIndexed(); return n; }))!, metal));
  for (const [mat, geos] of panels) {
    g.add(new THREE.Mesh(mergeGeometries(geos.map((x) => x.toNonIndexed()))!, mat));
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}
