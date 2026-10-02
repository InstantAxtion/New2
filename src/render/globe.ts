// Rotating 3D globe overview (orthographic projection).
import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import * as topojson from 'topojson-client';
import type { Game } from '../sim/ctx';
import type { WorldData } from '../sim/world';

export class GlobeRenderer {
  rotate: [number, number] = [-10, -25];
  zoom = 1;
  private features: GeoPermissibleObjects[];
  private graticule = geoGraticule10();
  private dirty = true;
  spin = true;

  constructor(public canvas: HTMLCanvasElement, w: WorldData) {
    const topo = w.raw.topo;
    const obj = Object.values(topo.objects)[0] as any;
    this.features = (topojson.feature(topo, obj) as any).features;
  }

  touch() {
    this.dirty = true;
  }

  private proj() {
    const r = this.canvas.getBoundingClientRect();
    const size = Math.min(r.width, r.height) * 0.44 * this.zoom;
    return geoOrthographic().scale(size).translate([r.width / 2, r.height / 2]).rotate(this.rotate).clipAngle(90);
  }

  drag(dx: number, dy: number) {
    const k = 0.35 / this.zoom;
    this.rotate = [this.rotate[0] + dx * k, Math.max(-80, Math.min(80, this.rotate[1] - dy * k))];
    this.spin = false;
    this.dirty = true;
  }

  zoomBy(f: number) {
    this.zoom = Math.max(0.6, Math.min(2.2, this.zoom * f));
    this.dirty = true;
  }

  /** lon/lat under a screen point, or null if off the globe. */
  invert(sx: number, sy: number): [number, number] | null {
    const p = this.proj();
    const ll = p.invert?.([sx, sy]);
    if (!ll) return null;
    // invert returns a point even outside the disc: verify by re-projecting
    const back = p(ll);
    if (!back || Math.hypot(back[0] - sx, back[1] - sy) > 1) return null;
    return ll as [number, number];
  }

  frame(game: Game | null, dt: number): boolean {
    if (this.spin) {
      this.rotate = [this.rotate[0] + dt * 0.006, this.rotate[1]];
      this.dirty = true;
    }
    if (!this.dirty) return false;
    this.dirty = false;
    const ctx = this.canvas.getContext('2d')!;
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, r.width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050b16';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // stars
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 80; i++) {
      const x = (i * 9301 + 49297) % 233280 / 233280 * r.width;
      const y = (i * 4096 + 150889) % 714025 / 714025 * r.height;
      ctx.fillRect(x, y, 1, 1);
    }
    const proj = this.proj();
    const path = geoPath(proj, ctx);
    const size = proj.scale();
    const [cx, cy] = proj.translate();
    // atmosphere
    const glow = ctx.createRadialGradient(cx, cy, size * 0.95, cx, cy, size * 1.15);
    glow.addColorStop(0, 'rgba(80,160,255,0.45)');
    glow.addColorStop(1, 'rgba(80,160,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 1.15, 0, Math.PI * 2);
    ctx.fill();
    // ocean
    const ocean = ctx.createRadialGradient(cx - size * 0.3, cy - size * 0.3, size * 0.1, cx, cy, size);
    ocean.addColorStop(0, '#1d4f8a');
    ocean.addColorStop(1, '#0a2547');
    ctx.fillStyle = ocean;
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    path(this.graticule);
    ctx.stroke();
    // provinces by controller colour
    this.features.forEach((f, i) => {
      ctx.beginPath();
      path(f);
      if (game) {
        const p = game.s.provinces[i];
        const n = game.s.nations[p.ctrl];
        ctx.fillStyle = n?.active ? n.color : '#2f3640';
      } else ctx.fillStyle = '#7a8a6a';
      ctx.fill();
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const f of this.features) path(f);
    ctx.stroke();
    // shading
    const shade = ctx.createRadialGradient(cx - size * 0.35, cy - size * 0.35, size * 0.2, cx, cy, size * 1.02);
    shade.addColorStop(0, 'rgba(255,255,255,0.08)');
    shade.addColorStop(0.7, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, Math.PI * 2);
    ctx.fill();
    // player's capital marker
    if (game) {
      const cap = game.player.capital;
      if (cap >= 0) {
        const pr = game.w.provs[cap];
        const pt = proj([pr.lon, pr.lat]);
        const visible = pt && geoPath(proj).centroid({ type: 'Point', coordinates: [pr.lon, pr.lat] } as any);
        if (pt && visible && !Number.isNaN(visible[0])) {
          ctx.fillStyle = '#facc15';
          ctx.font = '16px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('★', pt[0], pt[1]);
        }
      }
    }
    return true;
  }
}
