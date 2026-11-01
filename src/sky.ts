import * as THREE from 'three';

export type TimeMode = 'cycle' | 'dawn' | 'day' | 'sunset' | 'night';
export const TIME_PRESETS: Record<Exclude<TimeMode, 'cycle'>, number> = { dawn: 6.4, day: 12.5, sunset: 17.6, night: 23 };

interface Key {
  t: number;
  top: number;
  horizon: number;
  sun: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
}

// Colours of the sky through the day
const KEYS: Key[] = [
  { t: 0, top: 0x040816, horizon: 0x111a33, sun: 0x8899cc, sunI: 0.25, hemiSky: 0x33456e, hemiGround: 0x0c0c14, hemiI: 0.55 },
  { t: 4.8, top: 0x0a1230, horizon: 0x2a2a4a, sun: 0x8899cc, sunI: 0.2, hemiSky: 0x3a4a78, hemiGround: 0x101018, hemiI: 0.55 },
  { t: 6.0, top: 0x2b3f78, horizon: 0xf2a06e, sun: 0xffa060, sunI: 1.1, hemiSky: 0x8a90c0, hemiGround: 0x3a3028, hemiI: 0.72 },
  { t: 7.5, top: 0x4f8fd8, horizon: 0xf5d8b0, sun: 0xffe0b0, sunI: 1.6, hemiSky: 0xbfd8ff, hemiGround: 0x5a5040, hemiI: 1.0 },
  { t: 12, top: 0x2f7fe0, horizon: 0xc4e2ff, sun: 0xfff8ec, sunI: 2.2, hemiSky: 0xcfe6ff, hemiGround: 0x6a6048, hemiI: 1.15 },
  { t: 16.5, top: 0x3c7ed4, horizon: 0xf5ddb0, sun: 0xffe6b8, sunI: 1.8, hemiSky: 0xc8dcff, hemiGround: 0x5e5240, hemiI: 1.05 },
  { t: 17.9, top: 0x3d4a8c, horizon: 0xff8f52, sun: 0xff8a4a, sunI: 1.55, hemiSky: 0xb09ad0, hemiGround: 0x4a3428, hemiI: 0.75 },
  { t: 19.0, top: 0x1a2050, horizon: 0x7a4a6a, sun: 0xd06a6a, sunI: 0.4, hemiSky: 0x5a5a90, hemiGround: 0x201820, hemiI: 0.65 },
  { t: 20.3, top: 0x060b20, horizon: 0x18203e, sun: 0x8899cc, sunI: 0.25, hemiSky: 0x33456e, hemiGround: 0x0c0c14, hemiI: 0.55 },
  { t: 24, top: 0x040816, horizon: 0x111a33, sun: 0x8899cc, sunI: 0.25, hemiSky: 0x33456e, hemiGround: 0x0c0c14, hemiI: 0.55 },
];

const ca = new THREE.Color(), cb = new THREE.Color();
function lerpHex(a: number, b: number, t: number, out: THREE.Color) {
  ca.setHex(a); cb.setHex(b);
  return out.copy(ca).lerp(cb, t);
}

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const frag = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float night;
uniform float time;
uniform float clouds;
uniform float cover;
uniform float flash;
uniform float aurora;
uniform float rainbow;
uniform float meteors;
varying vec3 vDir;

float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += n(p) * a; p *= 2.07; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = mix(horizon, top, pow(y, 0.55));
  if (d.y < 0.0) col = horizon;
  // Brighter, hazier band at the horizon
  col = mix(col, horizon * 1.06 + vec3(0.02), exp(-y * 14.0) * 0.45 * (1.0 - night));
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  float up = smoothstep(-0.12, 0.02, sunDir.y);
  col += sunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 64.0) * 0.5) * up;
  col += sunColor * smoothstep(0.99935, 0.9997, sd) * 6.0 * up;
  // Moon (opposite the sun)
  float md = max(dot(d, normalize(-sunDir)), 0.0);
  col += vec3(0.9, 0.92, 1.0) * smoothstep(0.9994, 0.9996, md) * night;
  // Stars
  if (night > 0.01 && d.y > 0.0) {
    vec2 sp = floor(d.xz / (d.y + 0.6) * 220.0);
    float s = h(sp);
    col += vec3(step(0.9965, s) * night * (0.5 + 0.5 * sin(time * 2.0 + s * 90.0)));
  }
  // Milky Way: a soft, dusty band of faint stars tilted across the sky
  if (night > 0.01 && d.y > 0.0) {
    vec3 axis = normalize(vec3(0.35, 0.55, -0.76));
    float band = 1.0 - abs(dot(d, axis));
    float core = pow(band, 9.0);
    vec2 mp = d.xz / (d.y + 0.5) * 9.0;
    float dust = fbm(mp * 1.3) * 0.75 + fbm(mp * 4.1) * 0.35;
    float lane = smoothstep(0.55, 0.75, fbm(mp * 2.2 + 7.0)) * pow(band, 22.0);
    vec3 mw = mix(vec3(0.55, 0.6, 0.85), vec3(0.95, 0.85, 0.75), pow(band, 30.0));
    col += mw * core * dust * 0.32 * night * (1.0 - lane * 0.8) * smoothstep(0.0, 0.25, d.y);
    vec2 sp2 = floor(d.xz / (d.y + 0.6) * 520.0);
    col += vec3(step(0.985, h(sp2 + 3.1)) * core * night * 0.7);
  }
  // Shooting stars: a quick streak every so often
  if (meteors > 0.01 && d.y > 0.12) {
    for (int k = 0; k < 2; k++) {
      float per = 5.5 + float(k) * 3.7;
      float slot = floor(time / per + float(k) * 0.37);
      float ph = fract(time / per + float(k) * 0.37);
      float r1 = h(vec2(slot, float(k) + 1.0)), r2 = h(vec2(slot + 4.0, float(k) + 7.0)), r3 = h(vec2(slot, 13.0));
      if (r3 > 0.55) continue;
      vec3 start = normalize(vec3(r1 * 2.0 - 1.0, 0.45 + r2 * 0.4, 0.6 + r2));
      vec3 dir = normalize(cross(start, vec3(r2 - 0.5, -1.0, r1 - 0.5)));
      float life = smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.08, 0.14, ph));
      vec3 head = normalize(start + dir * ph * 2.2);
      vec3 rel = d - head;
      float along = dot(rel, -dir);
      float across = length(rel + dir * along);
      float tail = smoothstep(0.12, 0.0, along) * step(0.0, along);
      col += vec3(0.9, 0.95, 1.0) * tail * smoothstep(0.0025, 0.0, across) * life * meteors * 1.6;
    }
  }
  // Northern lights: slow green curtains with violet tops, low in the sky ahead
  if (aurora > 0.01 && d.y > 0.0) {
    float az = atan(d.x, d.z);
    float facing = smoothstep(1.6, 0.4, abs(az));
    float y0 = 0.08 + n(vec2(az * 2.0, time * 0.05)) * 0.12;
    float curtain = smoothstep(y0, y0 + 0.05, d.y) * (1.0 - smoothstep(y0 + 0.08, y0 + 0.45, d.y));
    float rays = fbm(vec2(az * 14.0 + sin(az * 3.0 + time * 0.1) * 1.5, time * 0.08));
    rays = pow(rays, 1.6) * 1.8;
    float wave = 0.6 + 0.4 * sin(az * 5.0 - time * 0.3 + n(vec2(time * 0.1, az)) * 3.0);
    vec3 ac = mix(vec3(0.15, 1.0, 0.45), vec3(0.6, 0.25, 0.9), smoothstep(y0 + 0.08, y0 + 0.35, d.y));
    col += ac * curtain * rays * wave * facing * aurora * night * 0.7;
  }
  // A big warm glow round a low sun, spreading along the horizon
  {
    float g2 = smoothstep(0.3, 0.0, sunDir.y) * smoothstep(-0.16, -0.02, sunDir.y);
    float near = pow(max(dot(d, normalize(vec3(sunDir.x, max(sunDir.y, 0.0), sunDir.z))), 0.0), 6.0);
    float band = exp(-abs(d.y - max(sunDir.y, 0.0)) * 9.0);
    col += sunColor * (near * 0.45 + near * band * 0.35) * g2 * (1.0 - cover);
  }
  // Clouds
  if (d.y > 0.02 && clouds > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(time * 0.006, time * 0.002);
    float f = fbm(cp);
    float c = smoothstep(0.5 - cover * 0.42, 0.8 - cover * 0.3, f);
    // Thicker parts are darker underneath; edges near the sun glow
    float thick = smoothstep(0.6, 0.95, fbm(cp * 1.7 + 3.0) * 0.5 + f * 0.6);
    vec3 lit = mix(vec3(1.0), sunColor, 0.35) * (0.85 + 0.25 * (1.0 - night));
    vec3 shade = mix(horizon, top, 0.4) * 0.9 + vec3(0.06);
    vec3 cc = mix(lit, shade, thick * 0.75);
    cc += sunColor * pow(sd, 12.0) * (1.0 - thick) * 0.8 * up;
    // Golden hour: clouds catch fire, orange low down and pink higher up, brightest towards the sun
    float gold = smoothstep(0.32, 0.02, sunDir.y) * smoothstep(-0.14, 0.0, sunDir.y);
    vec3 warm = mix(vec3(1.0, 0.56, 0.3), vec3(0.98, 0.5, 0.62), smoothstep(0.08, 0.45, d.y));
    float facingSun = 0.45 + 0.55 * pow(max(sd, 0.0), 2.0);
    cc = mix(cc, warm * (0.55 + 0.7 * (1.0 - thick)) * facingSun + shade * 0.15, gold * 0.8);
    cc += sunColor * pow(max(sd, 0.0), 5.0) * gold * 0.7 * (1.0 - thick * 0.6);
    cc *= (1.0 - night * 0.85);
    col = mix(col, cc, c * clouds * smoothstep(0.02, 0.2, d.y));
    // Thin wispy high layer
    float wisp = smoothstep(0.55, 0.85, fbm(vec2(cp.x * 0.4, cp.y * 2.4) + 9.0));
    col = mix(col, lit * (1.0 - night * 0.85), wisp * 0.25 * clouds * smoothstep(0.05, 0.3, d.y));
  }
  // Overcast: a grey, flatter sky
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(lum) * 0.85, cover * 0.75);
  // A rainbow after the rain, opposite the sun (nudged so it rises ahead of the road)
  if (rainbow > 0.01 && d.y > -0.02) {
    vec3 anti = normalize(vec3(-sunDir.x * 0.5, -0.32, 1.0));
    float ang = acos(clamp(dot(d, anti), -1.0, 1.0));
    float r = (ang - 0.69) / 0.035;
    if (r > -0.2 && r < 1.2) {
      vec3 bow = clamp(vec3(abs(r * 6.0 - 3.0) - 1.0, 2.0 - abs(r * 6.0 - 2.0), 2.0 - abs(r * 6.0 - 4.0)), 0.0, 1.0);
      bow = bow.bgr;
      float edge = smoothstep(-0.2, 0.15, r) * (1.0 - smoothstep(0.85, 1.2, r));
      col += bow * edge * rainbow * 0.34 * smoothstep(-0.02, 0.1, d.y) * (1.0 - smoothstep(0.25, 0.5, d.y));
    }
    // Brighter sky inside the bow
    col += vec3(0.04) * rainbow * step(ang, 0.69) * smoothstep(-0.02, 0.1, d.y);
  }
  col += vec3(0.75, 0.8, 1.0) * flash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly fog: THREE.Fog;
  private uniforms;
  /** Hour of the day, 0..24. */
  hour = 12;
  /** 0 by day, 1 at night. */
  night = 0;
  private haze = new THREE.Color(1, 1, 1);
  private hazeAmt = 0;

  constructor(fogFar: number) {
    this.uniforms = {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      night: { value: 0 },
      time: { value: 0 },
      clouds: { value: 1 },
      cover: { value: 0 },
      flash: { value: 0 },
      aurora: { value: 0 },
      rainbow: { value: 0 },
      meteors: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 14), mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.fog = new THREE.Fog(0xffffff, fogFar * 0.25, fogFar);
    this.sun.castShadow = false;
  }

  setFogFar(far: number) {
    this.fog.near = far * 0.22;
    this.fog.far = far;
  }

  /** Tint the horizon with the current region's haze. */
  setHaze(r: number, g: number, b: number, amt: number) {
    this.haze.setRGB(r, g, b);
    this.hazeAmt = amt;
  }

  /** Weather on the sky and lights: cloud cover (0..1) and a lightning flash. */
  cover = 0;
  flash = 0;
  /** Night-sky extras, 0..1: northern lights, a rainbow, shooting stars. */
  aurora = 0;
  rainbow = 0;
  meteors = 0;

  update(hour: number, elapsed: number, target: THREE.Vector3, pbr = false) {
    this.hour = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= this.hour) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = (this.hour - a.t) / (b.t - a.t);
    const u = this.uniforms;
    lerpHex(a.top, b.top, t, u.top.value);
    lerpHex(a.horizon, b.horizon, t, u.horizon.value);
    u.horizon.value.lerp(this.haze, this.hazeAmt * (1 - this.night));
    // Thick haze (a sandstorm) fills the whole sky
    u.top.value.lerp(this.haze, Math.max(0, this.hazeAmt - 0.5) * 1.8 * (1 - this.night * 0.5));
    lerpHex(a.sun, b.sun, t, u.sunColor.value);

    // Sun path: rises in the east (+x), sets in the west
    const ang = ((this.hour - 6) / 12) * Math.PI;
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    u.sunDir.value.copy(dir);
    this.night = THREE.MathUtils.clamp(-dir.y * 4 + 0.2, 0, 1);
    u.night.value = this.night;
    u.time.value = elapsed;

    // The light comes from the sun by day and the moon by night
    const lightDir = dir.y > -0.05 ? dir : dir.clone().negate();
    this.sun.position.copy(target).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    lerpHex(a.sun, b.sun, t, this.sun.color);
    this.sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
    lerpHex(a.hemiSky, b.hemiSky, t, this.hemi.color);
    lerpHex(a.hemiGround, b.hemiGround, t, this.hemi.groundColor);
    // With sky reflections lighting the scene, the hemisphere light only fills in
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t) * (pbr ? 0.3 : 1);
    this.sun.intensity *= pbr ? 0.9 : 1;

    // Overcast skies dim the sun and grey the light; lightning lights everything up
    u.cover.value = this.cover;
    u.flash.value = this.flash;
    u.aurora.value = this.aurora * (1 - this.cover);
    u.rainbow.value = this.rainbow * (1 - this.night);
    u.meteors.value = this.meteors * this.night * (1 - this.cover);
    this.sun.intensity *= 1 - this.cover * 0.8;
    this.hemi.intensity *= 1 - this.cover * 0.25;
    this.hemi.intensity += this.flash * 3;
    const fogC = u.horizon.value.clone();
    const lum = fogC.r * 0.3 + fogC.g * 0.55 + fogC.b * 0.15;
    fogC.lerp(new THREE.Color(lum * 0.9, lum * 0.92, lum * 0.95), this.cover * 0.8);
    this.fog.color.copy(fogC);
  }

  follow(pos: THREE.Vector3) {
    this.mesh.position.copy(pos);
  }

  setClouds(on: boolean) {
    this.uniforms.clouds.value = on ? 1 : 0;
  }
}
