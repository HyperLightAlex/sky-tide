// The painted clouds (Zenith GP's approach, made to fly through), the cloud sea below, and what
// you see inside a cloud.
//
//   cards      each cloud (weather/cloudField.js) is a painted card standing on its flat base,
//              turned to face you (and leaning back as you rise above it, so from above it
//              never goes edge on), hazed with distance. Drawn after the sky and the solid
//              world; they write depth where they are solid, so streams behind them are hidden.
//   inside     as you near a cloud its card thins away and you are among painted puffs (round
//              windows onto the cloud sea's painting) inside its volume, and the deeper you go
//              the more the view goes to a mist: the set's painting of the inside of a cloud
//              (pipeline.js, the final pass), or a flat colour for Zenith's sets.
//   cloud sea  the painted sea of cloud far below, at the floor: fall that far and you are gone.
//   far islands  painted cards (art/island-sheets, sheet 4) for the islands past the meshes'
//              range, drawn and sorted with the clouds.

import * as THREE from 'three';
import { UNTONE_GLSL } from './painted.js';
import { SKY_COLOR_GLSL } from './shaders.js';
import { PAINTED_SETS } from '../world/paintedSets.js';
import { ISLAND_ART } from '../world/islandArt.js';

// Far islands: painted cards for the islands beyond the meshes' range (render/islandsView.js
// builds meshes within 7 km), fading in as the mesh goes and out into the haze.
const FAR_IN0 = 6500, FAR_IN1 = 7300, FAR_OUT0 = 15000, FAR_OUT1 = 17000;

const MAXSPRITES = 4600;        // cards and billows, drawn together
const BILLOW_BUDGET = 3000;     // billows at most (the clouds biggest in the view get them first; the rest ease back to cards)
// A cloud is its painted card while it is small in the view; from SPREAD_IN (its size over its
// distance) its billows spread out of the card, and by SPREAD_FULL they are in place.
const SPREAD_IN = 0.22, SPREAD_FULL = 0.6;
const FIELD_EDGE = 11500;       // how far round you the cloud field keeps heaps (weather/cloudField.js RANGE)
// The raised cloud sea: how far from you (m), how many cells across, how high its billows stand.
const SEA_NEAR = 2600, SEA_CELLS = 200, SEA_RELIEF = 150;
const PUFFS = 7 * 7 * 7;        // the lattice of puffs round the camera inside a cloud
const PUFF_CELL = 13;           // (m)
const ROWS = 32;

// Cards and billows. A card is the cloud's painting standing on its flat base, turned to face
// you about the upright and leaning back as you rise above it. A billow is a piece of that
// painting: flat on the card (its depth across the view dropped) it shows the painting where it
// lies, so a cloud of flat billows is its card; spread out (iMisc.w) it stands where it is in the
// cloud's volume, faces you, and keeps a piece of the painting of its own (from the same height
// of the cloud, so tops stay tops and the base stays flat), its edge the painting's own where it
// is at the cloud's outline. As it is relit (iPuff.y) it becomes one of the painted billows of
// sheet 4, in the light where it sits. Each billow is rounded in depth, like a ball, so where
// billows overlap the line between them slides as you move rather than one jumping in front of
// the other, and nothing about it switches at once: its lights, and the side-lit painting and its
// mirror, cross-fade.
const CARD_VERT = /* glsl */ `
attribute vec2 aCorner;         // x 0..1 across, y 0..1 up
attribute vec4 iPos;            // the cloud's base centre, its width
attribute vec4 iRect;           // its card in the atlas
attribute vec4 iMisc;           // its height, alpha, mirrored, how far its billows have spread
attribute vec4 iOff;            // a billow: where in the cloud (m from the base centre), its size (m); size 0: the card
attribute vec4 iPuff;           // a billow: the painting's shift off the upright at its height (m), how far it is relit, its own piece of the painting (card u, v)
attribute vec4 iBillA, iBillB, iBillC;  // a billow: the painted billows (sheet 4) it shows: lit from the side, the same mirrored, and lit from above or in shade
attribute vec4 iBill;           // ... how much of each, and their width over height (0: no billow sheet)
attribute vec4 iBillM;          // ... each mirrored
uniform vec3 uSunDir;
varying vec2 vUv, vCard, vC, vWin, vBillA, vBillB, vBillC;
varying vec3 vBillW, vViewC;
varying float vA, vPuff, vLit, vRelit, vBaseY, vHasBill, vRad;
varying vec3 vWorld;
void frameFor(vec3 at, out vec3 R, out vec3 U) {
  // facing the camera about the upright, leaning back as it rises above (forward below), so
  // the painting is never seen edge on
  vec3 to = cameraPosition - at;
  vec2 th = to.xz; float lh = length(th);
  vec3 fw = lh > 1e-3 ? vec3(th.x / lh, 0.0, th.y / lh) : vec3(0.0, 0.0, 1.0);
  R = vec3(fw.z, 0.0, -fw.x);
  float p = clamp(atan(to.y, max(lh, 1e-3)) * 0.85, -0.9, 1.25);
  U = vec3(0.0, cos(p), 0.0) - fw * sin(p);
}
void main() {
  vec3 base = iPos.xyz;
  float W = iPos.w, H = iMisc.x;
  vec3 R, U;
  frameFor(base + vec3(0.0, H * 0.45, 0.0), R, U);
  bool mir = iMisc.z > 0.5;
  vec3 pos; vec2 card;
  if (iOff.w <= 0.0) {
    pos = base + R * (aCorner.x - 0.5) * W + U * aCorner.y * H;
    card = aCorner;
    vPuff = 0.0; vC = vec2(0.0); vWin = vec2(0.0); vLit = 1.0; vRelit = 0.0;
    vBillA = vBillB = vBillC = vec2(0.0); vBillW = vec3(0.0); vHasBill = 0.0; vRad = -1.0; vViewC = vec3(0.0);
  } else {
    float sz = iOff.w, sp = iMisc.w;
    float across = dot(iOff.xyz, R) + (mir ? -iPuff.x : iPuff.x);
    vec3 onCard = base + R * across + U * iOff.y;
    vec3 c = mix(onCard, base + iOff.xyz, sp);
    vec3 R2, U2;
    frameFor(c, R2, U2);
    R2 = normalize(mix(R, R2, sp)); U2 = normalize(mix(U, U2, sp));
    // square while it is a piece of the card, the painted billow's shape as it becomes one
    float asp = iBill.w;
    vec2 dims = mix(vec2(sz), vec2(sz, sz / max(asp, 0.2)), asp > 0.0 ? iPuff.y : 0.0);
    pos = c + R2 * (aCorner.x - 0.5) * dims.x + U2 * (aCorner.y - 0.5) * dims.y;
    vBillA = iBillA.xy + vec2(iBillM.x > 0.5 ? 1.0 - aCorner.x : aCorner.x, aCorner.y) * iBillA.zw;
    vBillB = iBillB.xy + vec2(iBillM.y > 0.5 ? 1.0 - aCorner.x : aCorner.x, aCorner.y) * iBillB.zw;
    vBillC = iBillC.xy + vec2(iBillM.z > 0.5 ? 1.0 - aCorner.x : aCorner.x, aCorner.y) * iBillC.zw;
    vBillW = iBill.xyz; vHasBill = asp > 0.0 ? 1.0 : 0.0;
    // rounded in depth (toward you by up to about half its size at its middle)
    vViewC = (viewMatrix * vec4(c, 1.0)).xyz; vRad = 0.45 * min(dims.x, dims.y);
    // the piece of the painting it shows: where it lies on the card, sliding to its own as it spreads
    vec2 at = mix(vec2(across / W + 0.5, iOff.y / H), vec2(mir ? 1.0 - iPuff.z : iPuff.z, iPuff.w), sp);
    card = at + (aCorner - 0.5) * vec2(sz / W, sz / H);
    vPuff = 1.0; vC = aCorner - 0.5;
    vWin = c.xz;
    vBaseY = base.y;
    vec3 n = normalize(vec3(iOff.x / (0.5 * W), (iOff.y / H - 0.5) * 2.0, iOff.z / (0.5 * W)));
    vLit = dot(n, normalize(uSunDir + vec3(0.0, 0.6, 0.0)));
    vRelit = iPuff.y;
  }
  vCard = card;
  vUv = iRect.xy + vec2(mir ? 1.0 - card.x : card.x, card.y) * iRect.zw;
  vA = iMisc.y; vBaseY = base.y;
  vWorld = pos;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const CARD_FRAG = /* glsl */ `
uniform sampler2D tAtlas;
uniform float uFogDist, uDepthPass;
uniform vec2 uProjZ;            // the projection's depth terms
varying vec2 vUv, vCard, vC, vWin, vBillA, vBillB, vBillC;
varying vec3 vBillW, vViewC;
varying float vA, vPuff, vLit, vRelit, vBaseY, vHasBill, vRad;
varying vec3 vWorld;
${SKY_COLOR_GLSL}
${UNTONE_GLSL}
void main() {
  // A billow's depth: a ball's front, not its flat card.
  if (vRad > 0.0) {
    float zf = vViewC.z + vRad * sqrt(max(0.0, 1.0 - dot(vC, vC) * 4.0));
    gl_FragDepth = clamp(((uProjZ.x * zf + uProjZ.y) / -zf) * 0.5 + 0.5, 0.0, 1.0);
  } else gl_FragDepth = gl_FragCoord.z;
  vec4 t = texture2D(tAtlas, vUv);
  float a0;
  vec3 col;
  if (vPuff < 0.5) { a0 = t.a; col = t.rgb; }
  else {
    // its piece of the painting (nothing past its card's edge), a round billow cut along the
    // painting's own creases, so where billows overlap one sits over the next
    float inCard = step(0.0, vCard.x) * step(vCard.x, 1.0) * step(0.0, vCard.y) * step(vCard.y, 1.0);
    float l = dot(t.rgb, vec3(0.3, 0.55, 0.15));
    float r = length(vC) * 2.0;
    float m = (1.0 - smoothstep(0.58, 0.8, r + (0.7 - l) * 0.85)) * (1.0 - smoothstep(0.86, 0.99, r));
    float pa = m * t.a * inCard;
    if (vHasBill > 0.5) {
      // becoming a painted billow (its own outline), in the light where it sits
      vec4 A = texture2D(tAtlas, vBillA), B = texture2D(tAtlas, vBillB), C = texture2D(tAtlas, vBillC);
      float ba = A.a * vBillW.x + B.a * vBillW.y + C.a * vBillW.z;
      vec3 bp = A.rgb * A.a * vBillW.x + B.rgb * B.a * vBillW.y + C.rgb * C.a * vBillW.z;
      a0 = mix(pa, ba, vRelit);
      col = mix(t.rgb * pa, bp, vRelit) / max(a0, 1e-3);
    } else {
      // (no billow sheet: the side of the cloud away from the sun, toward lavender)
      float lit = smoothstep(-0.25, 0.15, vLit);
      col = mix(t.rgb, t.rgb * vec3(0.84, 0.8, 0.97), (1.0 - lit) * vRelit * 0.6);
      a0 = pa;
    }
    // a flat base: nothing below the cloud's bottom
    a0 *= smoothstep(vBaseY - 2.0, vBaseY + 5.0, vWorld.y);
  }
  if (uDepthPass > 0.5) { if (a0 < 0.6 || vA < 0.9) discard; gl_FragColor = vec4(0.0); return; }
  float a = a0 * vA;
  if (a < 0.004) discard;
  vec3 c = unTone(col);
  // Into the haze with distance.
  vec3 d = vWorld - cameraPosition;
  float L = length(d);
  float fog = 1.0 - exp(-L / uFogDist);
  c = mix(c, skyColor(d / L), fog * 0.85);
  gl_FragColor = vec4(c * a, a);
}
`;

// The cloud sea's painting, shared by the flat sea far off and the raised one near you.
const SEA_COMMON = /* glsl */ `
uniform sampler2D tSea, tSeaBroken, tSeaShade;
uniform float uTime, uVariants;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p) { return vnoise(p) * 0.65 + vnoise(p * 2.13 + 5.2) * 0.35; }
// one painting at two sizes, the second turned, blended by a slow noise so its billows never
// line up into a grid (at a mip level: the raised sea reads its heights from it, smoothed)
vec3 sea2(sampler2D t, vec2 q, float n, float lod) {
  vec3 a = textureLod(t, q / 1100.0, lod).rgb;
  vec3 b = textureLod(t, mat2(0.8, -0.6, 0.6, 0.8) * q / 1500.0 + 0.41, lod).rgb;
  return mix(a, b, smoothstep(0.3, 0.7, n));
}
vec3 sea2(sampler2D t, vec2 q, float n) {
  vec3 a = texture2D(t, q / 1100.0).rgb;
  vec3 b = texture2D(t, mat2(0.8, -0.6, 0.6, 0.8) * q / 1500.0 + 0.41).rgb;
  return mix(a, b, smoothstep(0.3, 0.7, n));
}
`;

const SEA_VERT = /* glsl */ `
uniform float uRelief, uReliefR;
varying vec3 vWorld, vNrm;
varying float vRel;
${SEA_COMMON}
// how high the painted sea stands at a point: its bright tops up, its creases down
float seaRise(vec2 xz) {
  vec2 q = xz + vec2(uTime * 3.6, uTime * 1.5);
  float n = vnoise(xz * 0.0011);
  vec3 c = sea2(tSea, q, n, 3.0);
  if (uVariants > 0.5) c = mix(c, sea2(tSeaBroken, q + 370.0, n, 3.0), smoothstep(0.56, 0.7, fbm2(q * 0.00028 + 11.0)));
  return (dot(c, vec3(0.3, 0.55, 0.15)) - 0.62) * uRelief;
}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vRel = 0.0; vNrm = vec3(0.0, 1.0, 0.0);
  if (uRelief > 0.0) {
    // Near you the sea is raised into its painted billows, flattening to the painting farther
    // off; shaded smoothly (its slope from the heights round it).
    float k = 1.0 - smoothstep(uReliefR * 0.5, uReliefR * 0.9, length(w.xz - cameraPosition.xz));
    float h = seaRise(w.xz), e = 18.0;
    vNrm = normalize(vec3(seaRise(w.xz - vec2(e, 0.0)) - seaRise(w.xz + vec2(e, 0.0)), 2.0 * e / max(k, 0.02), seaRise(w.xz - vec2(0.0, e)) - seaRise(w.xz + vec2(0.0, e))));
    w.y += h * k;
    vRel = k;
  }
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SEA_FRAG = /* glsl */ `
uniform float uFogDist, uWarm, uHoleR, uKeepR;
uniform vec3 uDeep;
varying vec3 vWorld, vNrm;
varying float vRel;
${SKY_COLOR_GLSL}
${UNTONE_GLSL}
${SEA_COMMON}
void main() {
  // (the flat sea gives way to the raised one near you, which ends where the flat one starts)
  float dc = length(vWorld.xz - cameraPosition.xz);
  if (uHoleR > 0.0 && dc < uHoleR) discard;
  if (uKeepR > 0.0 && dc > uKeepR) discard;
  // The painted cloud sea, drifting. A set's own sheets give three paintings of it: dense,
  // broken (the depth far below between the clumps) and shaded by a cloud above. They come and
  // go across it in wide patches, so it reads as weather rather than one tile over and over.
  vec2 q = vWorld.xz + vec2(uTime * 3.6, uTime * 1.5);
  float n = vnoise(vWorld.xz * 0.0011);
  vec3 col = sea2(tSea, q, n);
  if (uVariants > 0.5) {
    float br = fbm2(q * 0.00028 + 11.0);
    col = mix(col, sea2(tSeaBroken, q + 370.0, n), smoothstep(0.56, 0.7, br));
    float sh = fbm2(q * 0.00042 - 4.0);
    col = mix(col, sea2(tSeaShade, q + 820.0, n), smoothstep(0.58, 0.72, sh) * 0.9);
  }
  col *= 0.92 + 0.14 * smoothstep(0.35, 0.65, vnoise(vWorld.xz * 0.0004 + 3.0));
  // Golden hour: the lights warm, the shadows toward lavender (the painting is midday).
  float l = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, mix(vec3(0.62, 0.58, 0.8) * l * 1.15, vec3(1.0, 0.86, 0.68) * l * 1.08, smoothstep(0.55, 0.9, l)), uWarm * 0.75);
  // Raised: the billows' sides away from the sun toward lavender.
  if (vRel > 0.001) {
    vec3 nn = normalize(vNrm);
    float lit = smoothstep(0.32, 0.58, dot(nn, normalize(uSunDir + vec3(0.0, 0.6, 0.0))));
    col = mix(col, col * vec3(0.8, 0.76, 0.97), (1.0 - lit) * vRel * 0.75);
  }
  vec3 c = unTone(col);
  vec3 d = vWorld - cameraPosition;
  float L = length(d);
  // (soft with distance: the painting's billows would shimmer at a grazing angle)
  float fog = 1.0 - exp(-L / (uFogDist * 0.9));
  c = mix(c, skyColor(d / L), min(1.0, fog * 1.05));
  gl_FragColor = vec4(c, 1.0);
}
`;

const PUFF_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 iPos;            // centre, size
attribute vec4 iRect;
attribute vec2 iA;              // alpha, height in the cloud (0 bottom .. 1 top)
varying vec2 vUv, vC;
varying vec2 vA;
void main() {
  vec4 c = viewMatrix * vec4(iPos.xyz, 1.0);
  c.xy += (aCorner - 0.5) * iPos.w;
  vC = aCorner - 0.5;
  vUv = iRect.xy + aCorner * iRect.zw;
  vA = iA;
  gl_Position = projectionMatrix * c;
}
`;
const PUFF_FRAG = /* glsl */ `
uniform sampler2D tSea, tSeaShade;
uniform float uWarm;
varying vec2 vUv, vC;
varying vec2 vA;
${UNTONE_GLSL}
void main() {
  // A round puff of the painted cloud sea's billows (lit higher up; its shaded painting low
  // down, where a set has one), its edge broken up by the painting.
  vec3 t = mix(texture2D(tSeaShade, vUv).rgb, texture2D(tSea, vUv).rgb, smoothstep(0.15, 0.7, vA.y));
  float l = dot(t, vec3(0.3, 0.55, 0.15));
  float r = length(vC) * 2.0;
  float m = (1.0 - smoothstep(0.45, 0.95, r + (0.62 - l) * 0.5)) * (1.0 - smoothstep(0.7, 0.97, r));
  float a = m * vA.x;
  if (a < 0.004) discard;
  // Golden hour: lights warm, shadows lavender (the painting is midday); lighter higher up.
  vec3 col = mix(t, mix(vec3(0.66, 0.6, 0.82) * l * 1.15, vec3(1.0, 0.86, 0.7) * l * 1.08, smoothstep(0.5, 0.9, l)), uWarm * 0.75);
  vec3 c = unTone(col) * mix(0.85, 1.05, vA.y);
  gl_FragColor = vec4(c * a, a);
}
`;

const premult = {
  transparent: true, depthWrite: false, depthTest: true,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

function quad(instanced) {
  const g = instanced ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
  g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
const h3 = (i, j, k) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class CloudView {
  constructor(backScene, veilScene, common, exposure) {
    this.ready = false;
    this.common = common;
    this.uExposure = exposure;   // shared { value }
    this.backScene = backScene;
    this.veilScene = veilScene;   // (drawn after the glow is taken: puffs are not light)
    this.mist = 0; this.mistColor = new THREE.Color(0.9, 0.92, 0.98);
    this.mistTex = null; this.mistTexShade = null; this.mistLit = 1;
    this.camSdf = 1e9;
    this._near = { d: Infinity, s: null };
  }

  /** Called once the painted assets are in (painted.js loadPainted). */
  init(painted) {
    this.painted = painted;
    const U = (o) => ({ ...this.common, uExposure: this.uExposure, ...o });
    // The cloud sea, a wide plane that follows the camera (its painting is tied to the world).
    this.seaMat = new THREE.ShaderMaterial({
      vertexShader: SEA_VERT, fragmentShader: SEA_FRAG,
      uniforms: U({ tSea: { value: null }, tSeaBroken: { value: null }, tSeaShade: { value: null }, uVariants: { value: 0 }, uTime: { value: 0 }, uFogDist: { value: 7000 }, uWarm: { value: 1 }, uDeep: { value: new THREE.Color(0.1, 0.2, 0.5) },
        uRelief: { value: 0 }, uReliefR: { value: 1 }, uHoleR: { value: SEA_NEAR * 0.95 }, uKeepR: { value: 0 } }),
    });
    const sg = new THREE.PlaneGeometry(80000, 80000, 1, 1);
    sg.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(sg, this.seaMat);
    this.sea.frustumCulled = false;
    this.sea.renderOrder = -10;
    this.backScene.add(this.sea);
    // The raised sea near you: a grid that follows you (snapped to its cells, so its billows do
    // not swim), raised in the vertex shader, inside the hole it leaves in the flat sea.
    this.reliefMat = this.seaMat.clone();
    this.reliefMat.uniforms = U({ ...this.seaMat.uniforms });
    for (const k of ['tSea', 'tSeaBroken', 'tSeaShade', 'uVariants', 'uTime', 'uFogDist', 'uWarm']) this.reliefMat.uniforms[k] = this.seaMat.uniforms[k];
    this.reliefMat.uniforms.uRelief = { value: SEA_RELIEF };
    this.reliefMat.uniforms.uReliefR = { value: SEA_NEAR };
    this.reliefMat.uniforms.uKeepR = { value: SEA_NEAR * 0.95 };
    this.reliefMat.uniforms.uHoleR = { value: 0 };
    const rg = new THREE.PlaneGeometry(SEA_NEAR * 2, SEA_NEAR * 2, SEA_CELLS, SEA_CELLS);
    rg.rotateX(-Math.PI / 2);
    this.relief = new THREE.Mesh(rg, this.reliefMat);
    this.relief.frustumCulled = false;
    this.relief.renderOrder = -10;
    this.backScene.add(this.relief);

    // Cards and billows: a depth pass (solid parts only) and then the painting, back to front.
    const cg = quad(true);
    const mk = (a, n) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.cAttr = {};
    for (const k of ['iPos', 'iRect', 'iMisc', 'iOff', 'iPuff', 'iBillA', 'iBillB', 'iBillC', 'iBill', 'iBillM']) {
      this.cAttr[k] = mk(new Float32Array(MAXSPRITES * 4), 4);
      cg.setAttribute(k, this.cAttr[k]);
    }
    cg.instanceCount = 0;
    this.cardGeo = cg;
    const cardU = () => U({ tAtlas: { value: painted.atlas }, uFogDist: { value: 7000 }, uDepthPass: { value: 0 }, uProjZ: { value: new THREE.Vector2() } });
    this.cardDepthMat = new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms: cardU(), colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide });
    this.cardDepthMat.uniforms.uDepthPass.value = 1;
    this.cardMat = new THREE.ShaderMaterial({ vertexShader: CARD_VERT, fragmentShader: CARD_FRAG, uniforms: cardU(), ...premult, side: THREE.DoubleSide });
    this.cardMat.depthFunc = THREE.LessEqualDepth;
    this.cardsDepth = new THREE.Mesh(cg, this.cardDepthMat);
    this.cards = new THREE.Mesh(cg, this.cardMat);
    for (const m of [this.cardsDepth, this.cards]) { m.frustumCulled = false; this.backScene.add(m); }
    this.cardsDepth.renderOrder = -5; this.cards.renderOrder = -4;

    // Puffs inside a cloud.
    const pg = quad(true);
    this.pPos = new Float32Array(PUFFS * 4); this.pRect = new Float32Array(PUFFS * 4); this.pA = new Float32Array(PUFFS * 2);
    this.pPosA = mk(this.pPos, 4); this.pRectA = mk(this.pRect, 4); this.pAA = mk(this.pA, 2);
    pg.setAttribute('iPos', this.pPosA); pg.setAttribute('iRect', this.pRectA); pg.setAttribute('iA', this.pAA);
    pg.instanceCount = 0;
    this.puffGeo = pg;
    this.puffMat = new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: U({ tSea: { value: null }, tSeaShade: { value: null }, uWarm: { value: 1 } }), ...premult });
    this.puffs = new THREE.Mesh(pg, this.puffMat);
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 6;
    this.veilScene.add(this.puffs);
    this._order = []; this._pool = []; this._cands = [];
    this._billows = new Map();
    this.ready = true;
  }

  update(dt, camera, world, P) {
    if (!this.ready) return;
    const field = world.weather.field, cam = camera.position;
    this.seaMat.uniforms.uTime.value += dt;
    this.seaMat.uniforms.uFogDist.value = P.fogDistance;
    // The set for the light now: its cloud sea and puffs (Zenith's sets: their cloud sea for both,
    // Meridian's borrowed from Helios and warmed).
    const surf = this.painted.surfaces[field.set()] || Object.values(this.painted.surfaces)[0];
    const su = this.seaMat.uniforms;
    su.tSea.value = surf.cloudsea; su.tSeaBroken.value = surf.broken; su.tSeaShade.value = surf.shade;
    su.uVariants.value = surf.variants ? 1 : 0;
    su.uWarm.value = surf.warm ? 1 : 0;
    this.puffMat.uniforms.tSea.value = surf.cloudsea;
    this.puffMat.uniforms.tSeaShade.value = surf.shade;
    this.puffMat.uniforms.uWarm.value = surf.warm ? 1 : 0;
    this.mistTex = surf.inside; this.mistTexShade = surf.insideShade;
    this.sea.position.set(cam.x, P.floorAltitude - 15, cam.z);
    this.sea.visible = P.cloudSea !== false;
    const cell = (SEA_NEAR * 2) / SEA_CELLS, raised = this.sea.visible && P.cloudSeaRelief !== false;
    this.relief.position.set(Math.round(cam.x / cell) * cell, P.floorAltitude - 15, Math.round(cam.z / cell) * cell);
    this.relief.visible = raised;
    this.seaMat.uniforms.uHoleR.value = raised ? SEA_NEAR * 0.95 : 0;
    this.cardMat.uniforms.uFogDist.value = this.cardDepthMat.uniforms.uFogDist.value = P.fogDistance;
    const pe = camera.projectionMatrix.elements;
    this.cardMat.uniforms.uProjZ.value.set(pe[10], pe[14]); this.cardDepthMat.uniforms.uProjZ.value.set(pe[10], pe[14]);

    // The clouds, as cards or billows (the nearest, biggest in the view, first), and the far
    // islands' cards, all drawn farthest first.
    const rects = this.painted.rects, list = this._order;
    list.length = 0; this._np = 0;
    this._farIslands(dt, world, cam, P, list);
    let nearD = Infinity, nearS = null;
    const cands = this._cands;
    let nc = 0;
    field.each((s) => {
      if (s.alpha < 0.01 || !rects[s.set]) return;
      const sd = field.sdf(s, cam.x, cam.y, cam.z);
      if (sd < nearD) { nearD = sd; nearS = { ...s }; }
      const dx = s.x - cam.x, dz = s.z - cam.z, dy = s.y + s.H * 0.45 - cam.y;
      const d2 = dx * dx + dy * dy + dz * dz;
      const c = cands[nc] || (cands[nc] = {});
      nc++;
      Object.assign(c, s);
      // (clouds come and go at the edge of the field kept round you: fading, not appearing)
      if (!s.c.storm) c.alpha *= 1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dz), FIELD_EDGE - 2200, FIELD_EDGE - 300);
      c.d2 = d2;
      c.sd = sd;
      c.m = P.cloudBillows === false ? 0 : THREE.MathUtils.smoothstep(Math.max(s.W, s.H) / Math.max(1, Math.sqrt(d2)), SPREAD_IN, SPREAD_FULL);
    });
    // (billows for the clouds biggest in the view, up to the budget; the rest stay cards)
    const byM = cands.slice(0, nc).filter((c) => c.m > 0).sort((a, b) => b.m - a.m);
    // (past three quarters of the budget, clouds ease back toward their cards rather than drop)
    let used = 0;
    for (const c of byM) {
      used += this._billowsOf(c).length;
      c.m *= 1 - THREE.MathUtils.smoothstep(used, BILLOW_BUDGET * 0.75, BILLOW_BUDGET);
    }
    for (let k = 0; k < nc; k++) {
      const s = cands[k];
      // the card: the whole cloud far off; a solid core inside its billows as they spread (a
      // little smaller, on the same base), so the cloud is never see-through; thinning away as
      // you are about to enter
      const ca = s.alpha * THREE.MathUtils.smoothstep(s.sd, 2, 45);
      if (ca > 0.01) {
        const k = 1 - 0.22 * THREE.MathUtils.smoothstep(s.m, 0.25, 1);
        const e = this._entry(list);
        e.d2 = s.d2; e.x = s.x; e.y = s.y; e.z = s.z; e.W = s.W * k; e.H = s.H * k; e.a = ca; e.r = rects[s.set][s.card]; e.m = s.mirror;
      }
      if (s.m > 0.005) this._pushBillows(s, cam, list);
    }
    list.sort((a, b) => b.d2 - a.d2);
    const n = Math.min(MAXSPRITES, list.length);
    const A = this.cAttr, P4 = A.iPos.array, R4 = A.iRect.array, M4 = A.iMisc.array, O4 = A.iOff.array, U4 = A.iPuff.array;
    const BA = A.iBillA.array, BB = A.iBillB.array, BC = A.iBillC.array, BK = A.iBill.array, BM = A.iBillM.array;
    for (let i = 0; i < n; i++) {
      const c = list[i], o = i * 4;
      P4[o] = c.x; P4[o + 1] = c.y; P4[o + 2] = c.z; P4[o + 3] = c.W;
      R4[o] = c.r[0]; R4[o + 1] = c.r[1]; R4[o + 2] = c.r[2]; R4[o + 3] = c.r[3];
      M4[o] = c.H; M4[o + 1] = c.a; M4[o + 2] = c.m; M4[o + 3] = c.sp || 0;
      O4[o] = c.ox || 0; O4[o + 1] = c.oy || 0; O4[o + 2] = c.oz || 0; O4[o + 3] = c.size || 0;
      U4[o] = c.cxm || 0; U4[o + 1] = c.relit || 0; U4[o + 2] = c.wx || 0; U4[o + 3] = c.wy || 0;
      if (c.bA) {
        BA[o] = c.bA[0]; BA[o + 1] = c.bA[1]; BA[o + 2] = c.bA[2]; BA[o + 3] = c.bA[3];
        BB[o] = c.bB[0]; BB[o + 1] = c.bB[1]; BB[o + 2] = c.bB[2]; BB[o + 3] = c.bB[3];
        BC[o] = c.bC[0]; BC[o + 1] = c.bC[1]; BC[o + 2] = c.bC[2]; BC[o + 3] = c.bC[3];
        BK[o] = c.wA; BK[o + 1] = c.wB; BK[o + 2] = c.wC; BK[o + 3] = c.asp;
        BM[o] = 0; BM[o + 1] = 1; BM[o + 2] = c.mC;
      } else BK[o + 3] = 0;
    }
    this.cardGeo.instanceCount = n;
    for (const k in A) { A[k].clearUpdateRanges(); A[k].addUpdateRange(0, n * 4); A[k].needsUpdate = true; }
    this.stats = { sprites: n, billows: Math.min(used, BILLOW_BUDGET) };

    // Inside: puffs on a lattice tied to the world round the camera, shown where they are in
    // the nearest cloud; and the mist.
    this.camSdf = nearD;
    let np = 0;
    if (nearS && nearD < 60) {
      const s = nearS;
      const ci = Math.floor(cam.x / PUFF_CELL), cj = Math.floor(cam.y / PUFF_CELL), ck = Math.floor(cam.z / PUFF_CELL);
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) {
        const a = ci + i, b = cj + j, c = ck + k;
        const x = (a + h3(a, b, c)) * PUFF_CELL, y = (b + h3(b, c, a)) * PUFF_CELL, z = (c + h3(c, a, b)) * PUFF_CELL;
        const sd = field.sdf(s, x, y, z);
        if (sd > 6) continue;
        const dc = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
        const al = THREE.MathUtils.smoothstep(-sd, -6, 10) * THREE.MathUtils.smoothstep(dc, 2, 6) * (1 - THREE.MathUtils.smoothstep(dc, 28, 42)) * s.alpha;
        if (al < 0.01) continue;
        const hh = h3(c, b, a);
        const size = 5 + 8 * hh;
        // (a puff whose card would reach past the camera fades first, so none is cut by the near plane)
        const al2 = al * THREE.MathUtils.smoothstep(dc, size * 0.55, size * 0.55 + 5);
        if (al2 < 0.01) continue;
        // a window into the painted cloud sea's billows
        const fw = 0.16 + 0.12 * hh;
        this.pPos[np * 4] = x; this.pPos[np * 4 + 1] = y; this.pPos[np * 4 + 2] = z; this.pPos[np * 4 + 3] = size;
        this.pRect[np * 4] = h3(a + 7, b, c); this.pRect[np * 4 + 1] = h3(a, b + 7, c);
        this.pRect[np * 4 + 2] = fw; this.pRect[np * 4 + 3] = fw;
        this.pA[np * 2] = al2 * 0.92; this.pA[np * 2 + 1] = Math.min(1, Math.max(0, (y - s.y) / s.H));
        np++;
      }
      // back to front (by distance), so the puffs layer properly
      if (np > 1) this._sortPuffs(np, cam);
    }
    this.puffGeo.instanceCount = np;
    for (const A of [this.pPosA, this.pRectA, this.pAA]) { A.clearUpdateRanges(); A.addUpdateRange(0, np * A.itemSize); A.needsUpdate = true; }
    // Mist: the deeper in, the more the light goes to the cloud's own colour.
    this.mist = nearS ? THREE.MathUtils.smoothstep(-nearD, 0, 80) * 0.4 * nearS.alpha : 0;
    // (how high in the cloud you are: the mist's painting is lit above, in shade below)
    this.mistLit = nearS ? THREE.MathUtils.smoothstep((cam.y - nearS.y) / Math.max(1, nearS.H), 0.15, 0.7) : 1;
    if (nearS) this.mistColor.setRGB(...(PAINTED_SETS[nearS.set].light === 'golden' ? [0.96, 0.84, 0.78] : PAINTED_SETS[nearS.set].light === 'night' ? [0.32, 0.38, 0.55] : [0.86, 0.9, 0.98]));
  }

  // A reusable entry for the list of cards and billows (cleared of a billow's fields).
  _entry(list) {
    const e = this._pool[this._np] || (this._pool[this._np] = {});
    this._np++;
    e.sp = 0; e.ox = 0; e.oy = 0; e.oz = 0; e.size = 0; e.cxm = 0; e.relit = 0; e.wx = 0; e.wy = 0; e.bA = null;
    list.push(e);
    return e;
  }

  // A cloud's billows, made once per cloud (and card): where each sits in the volume (its height
  // up the cloud, how far out from the upright of the outline's half-width there, which way
  // round), its size, the painting's shift off the upright at that height, and its window onto
  // the billow paintings. More where the cloud is wide, most toward its surface; they overlap,
  // so the cloud has no holes.
  _billowsOf(s) {
    const c = s.c, key = `${c.id >>> 0}|${c.storm ? 1 : 0}|${s.set}|${s.card}`;
    let B = this._billows.get(key);
    if (B) return B;
    if (this._billows.size > 600) this._billows.clear();
    const C = PAINTED_SETS[s.set].cards[s.card];
    let seed = (c.id >>> 0) ^ 0x9e3779b9;
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const row = (t) => { const f = t * ROWS - 0.5, i = Math.max(0, Math.min(ROWS - 1, Math.floor(f))), j = Math.min(ROWS - 1, i + 1), u = Math.min(1, Math.max(0, f - i)); return [C.hw[i] * (1 - u) + C.hw[j] * u, C.cx[i] * (1 - u) + C.cx[j] * u]; };
    const tot = C.hw.reduce((a, b) => a + b + 0.02, 0);
    const N = Math.max(22, Math.min(60, Math.round(22 + (c.W || s.W) / 25)));
    B = [];
    for (let k = 0; k < N; k++) {
      // a row, more often where the cloud is wide
      let x = rnd() * tot, i = 0;
      for (; i < ROWS - 1; i++) { x -= C.hw[i] + 0.02; if (x <= 0) break; }
      const t = (i + rnd()) / ROWS;
      const [hw, cx] = row(t);
      if (hw <= 0.005) continue;
      const rho = 0.45 + 0.55 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
      // its own piece of the painting: at its height, as far out from the middle as it sits,
      // on the side it faces when seen from the front
      // which painted billow (sheet 4): flat-bottomed along the base, otherwise round, wide (more
      // in wide clouds) or a cluster
      const wide = (C.aspect || 1.5) > 2 ? 0.55 : 0.3, pick = rnd();
      const col = t < 0.16 ? 3 : pick < wide ? 1 : pick < wide + (1 - wide) / 2 ? 0 : 2;
      B.push({ t, rho, th, szK: (0.6 + 0.4 * rnd()) * Math.max(hw, 0.08) * 0.95, hw, cx, wx: 0.5 + cx + rho * hw * Math.cos(th), wy: t, col, mir: rnd() < 0.5 ? 1 : 0 });
    }
    this._billows.set(key, B);
    return B;
  }

  // A cloud's billows into the list: spread as far as the cloud is big in the view, and relit
  // later still; each faded where it would reach past the camera.
  _pushBillows(s, cam, list) {
    const B = this._billowsOf(s), r = this.painted.rects[s.set][s.card];
    const BR = this.painted.rects[s.set + '~billows'], BC = PAINTED_SETS[s.set].billows;
    const sun = this.common.uSunDir.value;
    const lx = sun.x, ly = sun.y + 0.6, lz = sun.z, ll = Math.hypot(lx, ly, lz);
    const sp = THREE.MathUtils.smoothstep(s.m, 0.25, 1), relit = THREE.MathUtils.smoothstep(s.m, 0.45, 1);
    const a = s.alpha * THREE.MathUtils.smoothstep(s.m, 0, 0.3);
    for (const b of B) {
      const R = b.rho * b.hw * s.W, ox = Math.cos(b.th) * R, oz = Math.sin(b.th) * R, oy = b.t * s.H;
      const size = b.szK * s.W;
      const x = s.x + ox, y = s.y + oy, z = s.z + oz;
      const dc = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      // (gone before it would fill much of the view: close up, the puffs inside take over)
      const ba = a * THREE.MathUtils.smoothstep(dc, size * 0.55, size * 0.55 + 15) * (1 - THREE.MathUtils.smoothstep(size / Math.max(dc, 1), 0.7, 1.3));
      if (ba < 0.01) continue;
      const e = this._entry(list);
      e.d2 = dc * dc; e.x = s.x; e.y = s.y; e.z = s.z; e.W = s.W; e.H = s.H; e.a = ba; e.r = r; e.m = s.mirror;
      e.sp = sp; e.ox = ox; e.oy = oy; e.oz = oz; e.size = size; e.cxm = b.cx * s.W; e.relit = relit; e.wx = b.wx; e.wy = b.wy;
      if (BR) {
        // Its light: which way it faces out of the cloud, against the sun (lifted, as cels are
        // lit). Facing it: lit from above; edge on: lit from the side (the painting's light is
        // from the left: mirrored when the sun is to your right of it); away: in shade.
        const nx = ox / (0.5 * s.W), ny = (oy / s.H - 0.5) * 2, nz = oz / (0.5 * s.W), nl = Math.hypot(nx, ny, nz) || 1;
        const d = (nx * lx + ny * ly + nz * lz) / (nl * ll);
        // (which side of it the sun is on, as you see it: -1 your left .. 1 your right)
        const fx = cam.x - x, fz = cam.z - z, fl = Math.hypot(fx, fz) || 1;
        const sg = (lx * (fz / fl) - lz * (fx / fl)) / (Math.hypot(lx, lz) || 1);
        const ss = THREE.MathUtils.smoothstep;
        const wShade = 1 - ss(d, -0.25, 0.05), wSide = (1 - wShade) * (1 - ss(d, 0.25, 0.55)), wTop = (1 - wShade) - wSide;
        const wRight = ss(sg, -0.25, 0.25);
        // side-lit as painted (light from the left), the same mirrored (from the right), and lit
        // from above or in shade (never both at once)
        e.bA = BR[4 + b.col]; e.wA = wSide * (1 - wRight);
        e.bB = BR[4 + b.col]; e.wB = wSide * wRight;
        if (d > 0.15) { e.bC = BR[b.col]; e.wC = wTop; } else { e.bC = BR[8 + b.col]; e.wC = wShade; }
        e.mC = b.mir;
        e.asp = BC.cards[b.col].aspect;
        // (a flat-bottomed billow stands on the cloud's base)
        if (b.col === 3) e.oy = Math.max(oy, (size / e.asp) * 0.5 * relit + oy * (1 - relit));
      }
    }
  }

  // The far islands' cards, into the list of cards to draw. Each island gets the card that suits
  // its shape (a deep one the spire, the widest ones the meadow or the arch, the rest one of the
  // others by its seed), stood with the card's ground rim at the island's ground and spanning its
  // width, and no taller than the island hangs (so the card and the mesh that takes over agree).
  _farIslands(dt, world, cam, P, list) {
    const rects = this.painted.rects.islands, far = ISLAND_ART.far;
    if (!rects || !far || !P.islandsOn) return;
    this._farT = (this._farT ?? 0) - dt;
    if (this._farT <= 0 || !this._far) {
      this._farT = 1.0;
      const R = FAR_OUT1;
      this._far = world.trapar.islandsIn(cam.x - R, cam.x + R, cam.z - R, cam.z + R).filter((I) => Math.hypot(I.x - cam.x, I.z - cam.z) > FAR_IN0 - I.Rmax);
    }
    const C = far.cards, by = (name) => C.findIndex((c) => c.name === name);
    for (const I of this._far) {
      const d = Math.hypot(I.x - cam.x, I.z - cam.z);
      const a = THREE.MathUtils.smoothstep(d, FAR_IN0, FAR_IN1) * (1 - THREE.MathUtils.smoothstep(d, FAR_OUT0, FAR_OUT1));
      if (a < 0.01) continue;
      const h = I.id >>> 0;
      let k;
      if (I.D > I.R * 0.95) k = by('spire');
      else if (I.R > 150) k = by(h % 3 === 0 ? 'arch' : 'meadow');
      else k = by(['meadow', 'waterfall', 'trees', 'tower', 'meadow'][h % 5]);
      if (k < 0) k = 0;
      const c = C[k];
      let W = (I.Rmax * 2) / c.rimW, H = W / c.aspect;
      const hang = c.rimV * H, deep = I.D * 1.5 + 30;
      if (hang > deep) { W *= deep / hang; H *= deep / hang; }
      const y = I.y - c.rimV * H;
      const dy = y + H * 0.45 - cam.y;
      const e = this._entry(list);
      e.d2 = d * d + dy * dy; e.x = I.x; e.y = y; e.z = I.z; e.W = W; e.H = H; e.a = a; e.r = rects[k]; e.m = h & 1;
    }
  }

  _sortPuffs(n, cam) {
    const idx = this._pi || (this._pi = []);
    idx.length = n;
    for (let i = 0; i < n; i++) idx[i] = i;
    const P = this.pPos;
    const d = (i) => (P[i * 4] - cam.x) ** 2 + (P[i * 4 + 1] - cam.y) ** 2 + (P[i * 4 + 2] - cam.z) ** 2;
    idx.sort((a, b) => d(b) - d(a));
    const pp = this.pPos.slice(0, n * 4), pr = this.pRect.slice(0, n * 4), pa = this.pA.slice(0, n * 2);
    for (let i = 0; i < n; i++) {
      const j = idx[i];
      for (let k = 0; k < 4; k++) { this.pPos[i * 4 + k] = pp[j * 4 + k]; this.pRect[i * 4 + k] = pr[j * 4 + k]; }
      this.pA[i * 2] = pa[j * 2]; this.pA[i * 2 + 1] = pa[j * 2 + 1];
    }
  }
}
