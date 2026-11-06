import * as THREE from 'three';
import type { PropType } from './world/biomes';

// Trees photographed from 16 directions (baked offline from Poly Haven's scanned trees, CC0):
// each tree is drawn as one card that turns to face the camera and shows the photo nearest your
// view, blended with the next, lit with the normals baked alongside.

export const IMP_VIEWS = 16;
const COLS = 4;

export interface Impostor {
  map: THREE.Texture;
  normal: THREE.Texture;
  /** Card width and height in metres at scale 1. */
  w: number;
  h: number;
}

/** Each kind of tree and the baked trees that stand in for it, at the height (m) each is shown. */
export const IMPOSTOR_SETS: Partial<Record<PropType, [string, number][]>> = {
  tree: [['broad1', 7.5], ['broad2', 7], ['broad3', 9.5]],
  tree2: [['broad2', 7.5], ['broad3', 9], ['broad1', 7]],
  treeAutumn: [['broad1', 7.5], ['broad3', 9], ['broad2', 7]],
  cherry: [['broad1', 6.5], ['broad2', 6]],
  maple: [['broad3', 9], ['broad1', 7.5]],
  pine: [['fir1', 11], ['fir2', 9.5], ['fir3', 9.5]],
  pine2: [['fir2', 10], ['fir3', 10], ['fir1', 12]],
};

/** Leaf colour per kind (bark keeps its own colour). */
const LEAF_TINT: Partial<Record<PropType, number>> = { treeAutumn: 0xf0a040, cherry: 0xffc6d8 };

const impostors = new Map<string, Impostor>();
export const hasImpostors = () => impostors.size > 0;
/** The baked trees standing in for a kind of tree (only those that loaded), or undefined. */
export function impostorSet(type: PropType): [string, number][] | undefined {
  const set = IMPOSTOR_SETS[type]?.filter(([n]) => impostors.has(n));
  return set && set.length ? set : undefined;
}

export async function loadImpostors(base: string): Promise<void> {
  const meta: Record<string, { W: number; H: number }> = await (await fetch(`${base}impostors.json`)).json();
  const load = (url: string, srgb: boolean) =>
    new Promise<THREE.Texture>((res, rej) => {
      new THREE.TextureLoader().load(url, (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        res(t);
      }, undefined, rej);
    });
  await Promise.all(Object.entries(meta).map(async ([name, m]) => {
    const [map, normal] = await Promise.all([load(`${base}${name}.webp`, true), load(`${base}${name}_n.webp`, false)]);
    impostors.set(name, { map, normal, w: m.W / m.H, h: 1 });
  }));
}

/** A unit card standing on the ground: x -0.5..0.5, y 0..1. */
export const impostorGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
// (the card is stretched to the tree's size in the shader: give culling the real extent)
impostorGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), 11);
impostorGeometry.boundingBox = new THREE.Box3(new THREE.Vector3(-7, 0, -7), new THREE.Vector3(7, 13, 7));

/** Billboard maths shared by the colour and shadow materials. Defines bbWorld, bbR, bbF and the two frames' UVs. */
const BILLBOARD = /* glsl */ `
  vec3 iPos = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float iScale = length(instanceMatrix[1].xyz);
  float iYaw = atan(instanceMatrix[2].x, instanceMatrix[2].z);
  vec3 toCam = cameraPosition - iPos;
  vec2 fh = normalize(toCam.xz + vec2(1e-5, 0.0));
  bbF = vec3(fh.x, 0.0, fh.y);
  bbR = vec3(fh.y, 0.0, -fh.x);
  vec3 bbWorld = iPos + bbR * position.x * uSize.x * iScale + vec3(0.0, position.y * uSize.y * iScale, 0.0);
  // Which photo: the camera's direction round the tree, in the tree's own frame
  float a = atan(fh.x, fh.y) - iYaw;
  float f = fract(a / 6.2831853) * ${IMP_VIEWS.toFixed(1)};
  float f0 = floor(f);
  bbBlend = f - f0;
  float f1 = mod(f0 + 1.0, ${IMP_VIEWS.toFixed(1)});
  vec2 cellUv = vec2(position.x + 0.5, position.y);
  bbLocal = vec2(position.x * uSize.x / uSize.y, position.y);
  float rows = ${(IMP_VIEWS / COLS).toFixed(1)};
  bbUv0 = vec2((mod(f0, ${COLS.toFixed(1)}) + cellUv.x) / ${COLS.toFixed(1)}, (rows - 1.0 - floor(f0 / ${COLS.toFixed(1)}) + cellUv.y) / rows);
  bbUv1 = vec2((mod(f1, ${COLS.toFixed(1)}) + cellUv.x) / ${COLS.toFixed(1)}, (rows - 1.0 - floor(f1 / ${COLS.toFixed(1)}) + cellUv.y) / rows);
  vec4 mvPosition = viewMatrix * vec4(bbWorld, 1.0);
  gl_Position = projectionMatrix * mvPosition;
`;
const VARYINGS = /* glsl */ `
  uniform vec2 uSize;
  varying vec2 bbUv0;
  varying vec2 bbUv1;
  varying float bbBlend;
  varying vec3 bbR;
  varying vec3 bbF;
  varying vec2 bbLocal;
`;

const cache = new Map<string, { mat: THREE.Material; depth: THREE.Material }>();

/** Materials for one baked tree (and the leaf tint of the kind of tree it stands in for). */
export function impostorMaterials(name: string, type: PropType, height: number) {
  const key = `${name}:${type}:${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const imp = impostors.get(name)!;
  const size = { value: new THREE.Vector2(imp.w * height, height) };
  const tint = { value: new THREE.Color(LEAF_TINT[type] ?? 0xffffff) };
  const mat = new THREE.MeshStandardMaterial({ map: imp.map, alphaTest: 0.5, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSize = size;
    sh.uniforms.uNorm = { value: imp.normal };
    sh.uniforms.uLeafTint = tint;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS)
      .replace('#include <project_vertex>', BILLBOARD)
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(bbWorld, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS + '\nuniform sampler2D uNorm;\nuniform vec3 uLeafTint;\nfloat bbLeaf = 0.0;')
      .replace('#include <map_fragment>', /* glsl */ `
        vec4 bc0 = texture2D(map, bbUv0), bc1 = texture2D(map, bbUv1);
        vec4 bTex = mix(bc0, bc1, bbBlend);
        vec3 bn = mix(texture2D(uNorm, bbUv0).xyz, texture2D(uNorm, bbUv1).xyz, bbBlend);
        bbLeaf = bn.z;
        // Thin trunks and twigs fade out in the smaller mipmaps: keep them solid at a distance
        vec2 tsz = vec2(textureSize(map, 0));
        vec2 ddx = dFdx(bbUv0 * tsz), ddy = dFdy(bbUv0 * tsz);
        float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        bTex.a = clamp(bTex.a * (1.0 + 0.45 * lod), 0.0, 1.0);
        diffuseColor *= bTex;
        diffuseColor.rgb *= mix(vec3(1.0), uLeafTint, bbLeaf);`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 bn2 = mix(texture2D(uNorm, bbUv0).xyz, texture2D(uNorm, bbUv1).xyz, bbBlend);
          vec2 nxy = bn2.xy * 2.0 - 1.0;
          vec3 nb = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
          // Scanned leaves' own normals are noisy (and often face down): light the crown as a
          // rounded mass instead, keeping a little of the leaf detail
          vec3 crown = normalize(vec3(bbLocal.x * 1.6, (bbLocal.y - 0.6) * 1.6 + 0.35, 0.75));
          nb = normalize(mix(nb, crown, bbLeaf * 0.9));
          vec3 wN = bbR * nb.x + vec3(0.0, 1.0, 0.0) * nb.y + bbF * nb.z;
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`)
      // Leaves let light through: a little extra glow from behind the sun-facing side
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * bbLeaf * 0.08;');
  };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: imp.map, alphaTest: 0.5, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uSize = size;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS)
      .replace('#include <project_vertex>', BILLBOARD + '\n#ifdef USE_MAP\nvMapUv = bbUv0;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + VARYINGS);
  };
  const out = { mat, depth };
  cache.set(key, out);
  return out;
}
