import type { World } from './world/world';
import type { Vehicle } from './drive';
import { BIOMES, type BiomeId } from './world/biomes';

// The car's navigation screen: the road ahead, coloured by region, with what's coming up.

const REGION_COLOR: Record<BiomeId, string> = {
  seaside: '#4fb3d9', hills: '#7cc46a', flatlands: '#d9c46a', desert: '#e0a060', forest: '#3f9a5a', alpine: '#b8c4d4',
  autumn: '#e0803a', winter: '#e8f0f8', city: '#c060ff', rainforest: '#2fbf6a', lakes: '#5aa0ff', canyon: '#d0603a', blossom: '#f29ab8', tropical: '#3fd6c8', vineyard: '#9a6ad0',
  pnw: '#2f7a4a', metro: '#ff8a3a',
};

export function drawNav(g: CanvasRenderingContext2D, w: World, v: Vehicle, mph: boolean, clock: string, music: string, fuel = 1) {
  const W = 512, H = 288;
  g.fillStyle = '#0b1220';
  g.fillRect(0, 0, W, H);
  const dir = Math.cos(v.heading) >= 0 ? 1 : -1;
  // Map frame: car near the bottom, heading up
  const cx = W * 0.5, cy = H * 0.8;
  const scale = 0.22; // px per metre
  const ch = Math.cos(v.heading), sh = Math.sin(v.heading);
  const toScreen = (x: number, z: number): [number, number] => {
    const dx = x - v.x, dz = z - v.z;
    const fwd = dx * sh + dz * ch;
    const right = dx * ch - dz * sh;
    return [cx - right * scale, cy - fwd * scale];
  };
  // Faint grid
  g.strokeStyle = 'rgba(120,150,200,0.08)';
  g.lineWidth = 1;
  for (let i = 0; i < W; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke();
  }
  for (let i = 0; i < H; i += 32) {
    g.beginPath(); g.moveTo(0, i); g.lineTo(W, i); g.stroke();
  }
  // The road, segment by segment
  let prev: [number, number] | null = null;
  for (let d = -250; d <= 1400; d += 25) {
    const z = v.z + d * dir;
    const p = toScreen(w.roadX(z), z);
    if (prev) {
      const b = w.dominant(z);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 11;
      g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke();
      g.strokeStyle = w.bridge(z) > 0.5 ? '#9fb4c9' : w.urban(z) > 0.5 ? '#cfd3da' : REGION_COLOR[b.id];
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke();
    }
    prev = p;
  }
  // Fuel stations (and chargers) along the way
  const za = Math.min(v.z - 250 * dir, v.z + 1400 * dir), zb = Math.max(v.z - 250 * dir, v.z + 1400 * dir);
  let nextFuel = Infinity;
  for (const st of w.stops(za, zb)) {
    if (st.kind !== 'fuel') continue;
    const d = (st.z - v.z) * dir;
    if (d > 0) nextFuel = Math.min(nextFuel, d);
    const [px, py] = toScreen(w.roadX(st.z), st.z);
    const ox = st.side * dir * 16;
    g.fillStyle = fuel < 0.25 ? '#ffb020' : '#3fb67a';
    g.beginPath(); g.arc(px - ox, py, 11, 0, Math.PI * 2); g.fill();
    g.font = '13px sans-serif';
    g.textAlign = 'center';
    g.fillText('⛽', px - ox, py + 5);
    g.textAlign = 'left';
  }
  // The car
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(cx, cy - 12);
  g.lineTo(cx + 8, cy + 8);
  g.lineTo(cx, cy + 3);
  g.lineTo(cx - 8, cy + 8);
  g.closePath();
  g.fill();

  // Top bar: speed, limit, clock
  g.fillStyle = 'rgba(8,12,22,0.85)';
  g.fillRect(0, 0, W, 46);
  const k = mph ? 2.237 : 3.6;
  g.fillStyle = '#f2f4f8';
  g.font = '700 30px Inter, system-ui, sans-serif';
  g.fillText(`${Math.round(Math.abs(v.v) * k)}`, 14, 33);
  g.font = '500 16px Inter, system-ui, sans-serif';
  g.fillStyle = '#8994a8';
  g.fillText(mph ? 'mph' : 'km/h', 70, 33);
  const limit = w.speedLimit(v.z);
  if (limit < 100) {
    g.strokeStyle = '#e03030';
    g.lineWidth = 4;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(150, 23, 17, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#111';
    g.font = '700 15px Inter, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(Math.round(limit * k)), 150, 29);
    g.textAlign = 'left';
  }
  g.fillStyle = '#c6cfdf';
  g.font = '500 20px Inter, system-ui, sans-serif';
  g.textAlign = 'right';
  g.fillText(clock, W - 14, 31);
  g.textAlign = 'left';

  // Bottom: what's next
  const here = w.dominant(v.z);
  let next = '';
  for (let d = 50; d <= 6000; d += 50) {
    const z = v.z + d * dir;
    const b = w.dominant(z);
    if (b !== here) {
      next = `${b.emoji} ${b.name} in ${fmt(d, mph)}`;
      break;
    }
  }
  if (!next) {
    for (let d = 100; d <= 3000; d += 50) {
      if (w.townAt(v.z + d * dir) > 0.5 && w.townAt(v.z) < 0.5) {
        next = `🏘️ Town in ${fmt(d, mph)}`;
        break;
      }
    }
  }
  g.fillStyle = 'rgba(8,12,22,0.85)';
  g.fillRect(0, H - 46, W, 46);
  g.fillStyle = '#f2f4f8';
  g.font = '600 19px Inter, system-ui, sans-serif';
  g.fillText(`${here.emoji} ${BIOMES[here.id].name}`, 14, H - 18);
  g.fillStyle = '#9fb0cc';
  g.font = '500 17px Inter, system-ui, sans-serif';
  g.textAlign = 'right';
  const lowFuel = fuel < 0.25 ? `⛽ ${Math.round(fuel * 100)}% · ${nextFuel < Infinity ? 'station in ' + fmt(nextFuel, mph) : 'find a station'}` : '';
  if (lowFuel) g.fillStyle = '#ffb020';
  g.fillText(lowFuel || next || music, W - 14, H - 18);
  g.textAlign = 'left';
}

function fmt(m: number, mph: boolean) {
  if (mph) {
    const mi = m / 1609.34;
    return mi < 0.2 ? `${Math.round(m * 1.094 / 50) * 50} yd` : `${mi.toFixed(1)} mi`;
  }
  return m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * A music visualizer for the dash screen: glowing bars that rise and fall with a beat.
 * (The players are embedded, so their audio can't be analysed; this follows a steady groove.)
 */
export function drawVisualizer(g: CanvasRenderingContext2D, t: number, song: string, clock: string) {
  const W = 512, H = 288;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#090b18');
  bg.addColorStop(1, '#170a22');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const N = 32;
  const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.02)), 8);
  const bw = W / N;
  for (let i = 0; i < N; i++) {
    const x = i / N;
    const low = Math.exp(-x * 2.4);
    const v = 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(t * (2.3 + i * 0.37) + i * 1.7)) * (0.5 + 0.5 * Math.sin(t * 0.9 + i * 0.5)) + beat * low * 0.5;
    const h = Math.min(1, v) * (H - 90);
    const grad = g.createLinearGradient(0, H - 40 - h, 0, H - 40);
    grad.addColorStop(0, `hsl(${300 - x * 140}, 90%, 65%)`);
    grad.addColorStop(1, `hsl(${260 - x * 140}, 90%, 40%)`);
    g.fillStyle = grad;
    g.fillRect(i * bw + 2, H - 40 - h, bw - 4, h);
    // Mirror on the "floor"
    g.globalAlpha = 0.18;
    g.fillRect(i * bw + 2, H - 38, bw - 4, h * 0.25);
    g.globalAlpha = 1;
  }
  g.fillStyle = '#fff';
  g.font = '600 20px Inter, system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText(song.length > 42 ? song.slice(0, 41) + '…' : song, 16, 30);
  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText(clock, W - 16, 30);
}
