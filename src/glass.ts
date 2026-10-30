import * as THREE from 'three';

// The windscreen seen from the driver's seat: raindrops that build up and are swept away by
// the wipers, misting up in the cold and wet (cleared by the demister), and the glow of
// the dash lights reflected in the glass at night.
// A quad just beyond the cabin, so the dash, pillars and roof hide it and only the glass shows it.

const SECTORS = 16;

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform float uTime;
uniform float uRain;
uniform float uSec[${SECTORS}];
uniform float uAspect;
uniform float uFog;
uniform float uDemist;
uniform float uNight;
uniform vec3 uDash;
varying vec2 vUv;

float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  // Raindrops in two sizes; each appears some time after the wiper last passed over it
  if (uRain > 0.01) {
    for (int s = 0; s < 2; s++) {
      float scale = s == 0 ? 14.0 : 30.0;
      vec2 g = p * scale;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float r = h(id + float(s) * 17.0);
      vec2 off = (vec2(h(id + 1.3), h(id + 2.7)) - 0.5) * 0.5;
      vec2 c = (id + 0.5 + off) / scale;
      float ang = atan(c.y + 0.15, c.x - 0.5 * uAspect);
      int k = int(clamp(ang / 3.14159 * ${SECTORS.toFixed(1)}, 0.0, ${(SECTORS - 1).toFixed(1)}));
      float last = 0.0;
      for (int i = 0; i < ${SECTORS}; i++) if (i == k) last = uSec[i];
      float age = uTime - last;
      float appear = r * 5.0 / max(uRain, 0.05);
      float on = step(appear, age) * step(r, 0.25 + uRain * 0.7);
      float size = (s == 0 ? 0.16 : 0.22) + h(id + 5.1) * 0.12;
      vec2 d = (f - off) * vec2(1.0, 0.85);
      float m = smoothstep(size, size * 0.55, length(d)) * on;
      // A bright rim towards the light, darker centre (like a little lens)
      float rim = smoothstep(size * 0.4, size, length(d - vec2(0.03, 0.05)));
      vec3 dc = mix(vec3(0.6, 0.66, 0.72), vec3(0.95, 0.97, 1.0), rim) * (0.35 + 0.65 * (1.0 - uNight * 0.7));
      col = mix(col, dc, m);
      alpha = max(alpha, m * 0.55);
    }
  }
  // Mist on the glass; the demister clears it from the bottom up
  if (uFog > 0.01) {
    float clear = smoothstep(uDemist * 1.25 - 0.15, uDemist * 1.25, vUv.y);
    float n = h(floor(p * 90.0)) * 0.12;
    float fog = uFog * clear * (0.75 + n);
    vec3 fc = vec3(0.82, 0.85, 0.88) * (1.0 - uNight * 0.75);
    col = mix(col, fc, fog * (1.0 - alpha));
    alpha = max(alpha, fog * 0.62);
  }
  // Dash lights reflected low in the windscreen at night
  if (uNight > 0.01) {
    float cl = exp(-pow((vUv.x - 0.5) / 0.09, 2.0) - pow((vUv.y - 0.47) / 0.035, 2.0));
    float sc = exp(-pow((vUv.x - 0.66) / 0.08, 2.0) - pow((vUv.y - 0.46) / 0.03, 2.0));
    vec3 glow = uDash * cl * 0.5 + vec3(0.35, 0.55, 1.0) * sc * 0.45;
    col += glow * uNight;
    alpha = max(alpha, max(cl, sc) * uNight * 0.35);
  }
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(col, min(alpha, 1.0));
  #include <colorspace_fragment>
}`;

export class Windscreen {
  readonly mesh: THREE.Mesh;
  private u;
  private lastAngle = -1;
  /** Mist on the glass (0..1), and how far up the demister has cleared it (0..1). */
  fog = 0;
  demist = 0;
  demisting = false;

  constructor() {
    this.u = {
      uTime: { value: 0 }, uRain: { value: 0 }, uSec: { value: new Array(SECTORS).fill(-100) },
      uAspect: { value: 1 }, uFog: { value: 0 }, uDemist: { value: 0 }, uNight: { value: 0 },
      uDash: { value: new THREE.Color(1, 0.6, 0.25) },
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
  }

  /**
   * dist: how far beyond the eye to put the glass layer (just past the windscreen).
   * wiper: sweep angle 0..π (0 = parked), rain 0..1, cold/wet conditions for misting.
   */
  update(dt: number, time: number, cam: THREE.PerspectiveCamera, on: boolean, o: { rain: number; wiper: number; misty: boolean; night: number; open: boolean; dash: number }) {
    this.mesh.visible = on;
    const u = this.u;
    u.uTime.value = time;
    // The wiper sweeps: everything it passed over is wiped clean now
    const a = o.wiper;
    if (this.lastAngle >= 0 && Math.abs(a - this.lastAngle) > 1e-4) {
      const lo = Math.min(a, this.lastAngle), hi = Math.max(a, this.lastAngle);
      for (let i = 0; i < SECTORS; i++) {
        const s0 = (i / SECTORS) * Math.PI, s1 = ((i + 1) / SECTORS) * Math.PI;
        if (s1 >= lo && s0 <= hi) u.uSec.value[i] = time;
      }
    }
    this.lastAngle = a;
    u.uRain.value = o.rain;
    // Mist builds up slowly with the windows shut in cold or wet weather
    if (o.open) this.fog = Math.max(0, this.fog - dt * 0.2);
    else if (this.demisting) {
      this.demist = Math.min(1, this.demist + dt / 6);
      if (this.demist >= 1) this.fog = Math.max(0, this.fog - dt * 0.3);
    } else if (o.misty) this.fog = Math.min(0.85, this.fog + dt * 0.008);
    else this.fog = Math.max(0, this.fog - dt * 0.01);
    if (!this.demisting) this.demist = Math.max(0, this.demist - dt * 0.004);
    if (this.demisting && this.fog <= 0.001) this.demisting = false;
    u.uFog.value = this.fog;
    u.uDemist.value = this.demist;
    u.uNight.value = o.night;
    u.uDash.value.setHex(o.dash);
    if (!on) return;
    // Fill the view at this distance, facing the camera
    const d = 1.4;
    const hgt = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    this.mesh.position.copy(cam.position);
    this.mesh.quaternion.copy(cam.quaternion);
    this.mesh.translateZ(-d);
    this.mesh.scale.set(hgt * cam.aspect, hgt, 1);
    u.uAspect.value = cam.aspect;
  }
}
