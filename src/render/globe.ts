// Rotating 3D globe overview.
//
// The world is painted once (when borders change) into a flat equirectangular texture.
// Each frame a WebGL shader wraps that texture onto a sphere, so spinning the globe
// costs almost nothing. Without WebGL we fall back to drawing vector shapes in 2D.
import { geoArea, geoEquirectangular, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import * as topojson from 'topojson-client';
import type { Game } from '../sim/ctx';
import { cartoon } from './renderer';
import type { WorldData } from '../sim/world';

/** Copy of a quantized topology keeping roughly every `step`-th point of each arc. */
function simplifyTopo(topo: any, step: number) {
  const arcs = topo.arcs.map((arc: [number, number][]) => {
    if (arc.length <= 4) return arc;
    const out: [number, number][] = [arc[0]];
    let ax = 0, ay = 0;
    for (let i = 1; i < arc.length; i++) {
      ax += arc[i][0];
      ay += arc[i][1];
      if (i % step === 0 || i === arc.length - 1) { out.push([ax, ay]); ax = 0; ay = 0; }
    }
    return out;
  });
  return { ...topo, arcs };
}

/** On a sphere a ring's winding decides which side is inside: repair rings flipped by simplification. */
function fixWinding(f: any) {
  const polys: number[][][][] = f.type === 'Polygon' ? [f.coordinates] : f.type === 'MultiPolygon' ? f.coordinates : [];
  const out: number[][][][] = [];
  for (const poly of polys) {
    if (!poly.length || poly[0].length < 4) continue;
    const a = geoArea({ type: 'Polygon', coordinates: [poly[0]] } as any);
    out.push(a > Math.PI * 2 ? poly.map((r) => r.slice().reverse()) : poly);
  }
  return { type: 'MultiPolygon', coordinates: out };
}

const VERT = `attribute vec2 p; varying vec2 v; void main() { v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
varying vec2 v;
uniform sampler2D tex;
uniform vec2 res;      // canvas size in px
uniform float radius;  // globe radius in px
uniform vec2 rot;      // d3-style rotation (lambda, phi) in radians
const float PI = 3.14159265;
float hash(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = (v * 0.5 + 0.5) * res;
  vec2 c = (px - res * 0.5) / radius; // x right, y up
  float r2 = dot(c, c);
  vec3 bg = vec3(0.02, 0.043, 0.086);
  if (hash(floor(px / 3.0)) > 0.9975) bg += vec3(0.5); // stars
  if (r2 > 1.0) {
    float d = sqrt(r2) - 1.0;
    gl_FragColor = vec4(bg + vec3(0.31, 0.63, 1.0) * exp(-d * 9.0) * 0.55, 1.0);
    return;
  }
  // inverse orthographic + inverse rotation (matches d3.geoOrthographic().rotate)
  float yp = c.x, zp = c.y, xp = sqrt(1.0 - r2);
  float cp = cos(rot.y), sp = sin(rot.y);
  float x = xp * cp + zp * sp;
  float z = -xp * sp + zp * cp;
  float lat = asin(clamp(z, -1.0, 1.0));
  float lon = atan(yp, x) - rot.x;
  vec2 uv = vec2(fract((lon + PI) / (2.0 * PI)), (PI * 0.5 - lat) / PI);
  vec3 col = texture2D(tex, uv).rgb;
  float light = 0.55 + 0.45 * clamp(dot(vec3(c.x, c.y, xp), normalize(vec3(-0.35, 0.4, 0.85))), 0.0, 1.0);
  col *= light;
  col = mix(col, vec3(0.3, 0.55, 0.9), pow(1.0 - xp, 3.0) * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

export class GlobeRenderer {
  rotate: [number, number] = [-10, -25];
  zoom = 1;
  spin = true;
  private topo: any;
  private obj: any;
  private nations: { color: string; f: GeoPermissibleObjects }[] = [];
  private borders: GeoPermissibleObjects | null = null;
  private coast: GeoPermissibleObjects;
  private ownersKey = '';
  private dirty = true;
  private lastDraw = 0;
  private glCanvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private texCanvas: HTMLCanvasElement | null = null;
  private texDirty = true;
  private visible = false;

  constructor(parent: HTMLElement, public canvas: HTMLCanvasElement, w: WorldData) {
    this.topo = simplifyTopo(w.raw.topo, 2);
    this.obj = Object.values(this.topo.objects)[0];
    this.coast = topojson.mesh(this.topo, this.obj, (a: unknown, b: unknown) => a === b);
    this.glCanvas = document.createElement('canvas');
    Object.assign(this.glCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '4', display: 'none', pointerEvents: 'none' });
    parent.appendChild(this.glCanvas);
    try { this.initGL(); } catch { this.gl = null; }
  }

  private initGL() {
    const gl = this.glCanvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.gl = gl;
    this.prog = prog;
  }

  /** Show or hide the globe (the map layers are hidden separately). */
  show(v: boolean) {
    this.visible = v;
    if (this.gl) this.glCanvas.style.display = v ? '' : 'none';
    this.dirty = true;
  }

  touch() {
    this.dirty = true;
  }

  private size() {
    const r = this.canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), radius: Math.min(r.width, r.height) * 0.44 * this.zoom };
  }

  private proj() {
    const { w, h, radius } = this.size();
    return geoOrthographic().scale(radius).translate([w / 2, h / 2]).rotate(this.rotate).clipAngle(90);
  }

  drag(dx: number, dy: number) {
    const k = 0.35 / this.zoom;
    this.rotate = [this.rotate[0] + dx * k, Math.max(-80, Math.min(80, this.rotate[1] - dy * k))];
    this.spin = false;
    this.dirty = true;
  }

  private vel = [0, 0];
  /** Keep spinning after a swipe. */
  fling(vx: number, vy: number) {
    this.vel = [vx, vy];
  }

  zoomBy(f: number) {
    this.zoom = Math.max(0.6, Math.min(2.2, this.zoom * f));
    this.dirty = true;
  }

  invert(sx: number, sy: number): [number, number] | null {
    const p = this.proj();
    const ll = p.invert?.([sx, sy]);
    if (!ll) return null;
    const back = p(ll);
    if (!back || Math.hypot(back[0] - sx, back[1] - sy) > 1) return null;
    return ll as [number, number];
  }

  /** Merge regions into one shape per controlling country (only when borders changed). */
  private updateNations(game: Game | null) {
    const ctrl = game ? game.s.provinces.map((p) => p.ctrl) : [];
    const key = ctrl.join(',');
    if (key === this.ownersKey && this.nations.length) return;
    this.ownersKey = key;
    const geoms = this.obj.geometries as any[];
    const groups = new Map<number, any[]>();
    geoms.forEach((gm, i) => {
      const c = game ? ctrl[i] : 0;
      let l = groups.get(c);
      if (!l) groups.set(c, (l = []));
      l.push(gm);
    });
    this.nations = [];
    for (const [c, list] of groups) {
      const n = game?.s.nations[c];
      this.nations.push({ color: !game ? '#7a8a6a' : n?.active ? cartoon(n.color) : '#2f3640', f: fixWinding(topojson.merge(this.topo, list)) as GeoPermissibleObjects });
    }
    const at = new Map<any, number>(geoms.map((gm, i) => [gm, i]));
    this.borders = game ? topojson.mesh(this.topo, this.obj, (a: any, b: any) => a !== b && ctrl[at.get(a)!] !== ctrl[at.get(b)!]) : null;
    this.texDirty = true;
    this.dirty = true;
  }

  /** Paint the flat world texture. */
  private paintTexture(game: Game | null) {
    const W = 2048, H = 1024;
    const cv = this.texCanvas ?? (this.texCanvas = document.createElement('canvas'));
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#2a5f9e';
    ctx.fillRect(0, 0, W, H);
    const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
    const path = geoPath(proj, ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    path(geoGraticule10());
    ctx.stroke();
    for (const n of this.nations) {
      ctx.beginPath();
      path(n.f);
      ctx.fillStyle = n.color;
      ctx.fill();
    }
    ctx.lineJoin = 'round';
    if (this.borders) {
      ctx.strokeStyle = '#0f1f3a';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      path(this.borders);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(190,220,250,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    path(this.coast);
    ctx.stroke();
    if (game) {
      const cap = game.player.capital;
      const p = cap >= 0 ? proj([game.w.provs[cap].lon, game.w.provs[cap].lat]) : null;
      if (p) {
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    this.texDirty = false;
  }

  frame(game: Game | null, dt: number, now = performance.now()): boolean {
    if (this.spin) {
      this.rotate = [this.rotate[0] + dt * 0.006, this.rotate[1]];
      this.dirty = true;
    }
    if (Math.abs(this.vel[0]) + Math.abs(this.vel[1]) > 0.01) {
      const k = 0.35 / this.zoom;
      this.rotate = [this.rotate[0] + this.vel[0] * dt * k, Math.max(-80, Math.min(80, this.rotate[1] - this.vel[1] * dt * k))];
      const d = Math.exp(-dt / 500);
      this.vel = [this.vel[0] * d, this.vel[1] * d];
      this.dirty = true;
    }
    if (!this.dirty || now - this.lastDraw < 16) return false;
    this.lastDraw = now;
    this.dirty = false;
    this.updateNations(game);
    if (this.gl && this.visible) return this.frameGL(game);
    return this.frame2D();
  }

  private frameGL(game: Game | null) {
    const gl = this.gl!;
    if (this.texDirty) this.paintTexture(game);
    const { w, h, radius } = this.size();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (this.glCanvas.width !== cw || this.glCanvas.height !== ch) { this.glCanvas.width = cw; this.glCanvas.height = ch; }
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.prog);
    gl.uniform2f(gl.getUniformLocation(this.prog!, 'res'), cw, ch);
    gl.uniform1f(gl.getUniformLocation(this.prog!, 'radius'), radius * dpr);
    gl.uniform2f(gl.getUniformLocation(this.prog!, 'rot'), (this.rotate[0] * Math.PI) / 180, (this.rotate[1] * Math.PI) / 180);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  /** Fallback when WebGL is not available. */
  private frame2D() {
    const ctx = this.canvas.getContext('2d')!;
    const { w } = this.size();
    const dpr = this.canvas.width / w;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050b16';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const proj = this.proj();
    const path = geoPath(proj, ctx);
    const [cx, cy] = proj.translate();
    ctx.fillStyle = '#2a5f9e';
    ctx.beginPath();
    ctx.arc(cx, cy, proj.scale(), 0, Math.PI * 2);
    ctx.fill();
    for (const n of this.nations) {
      ctx.beginPath();
      path(n.f);
      ctx.fillStyle = n.color;
      ctx.fill();
    }
    if (this.borders) {
      ctx.strokeStyle = 'rgba(10,10,15,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      path(this.borders);
      ctx.stroke();
    }
    return true;
  }
}
