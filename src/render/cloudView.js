// The painted clouds (Zenith GP's approach, made to fly through), the cloud sea below, and what
// you see inside a cloud.
//
//   cards      each cloud (weather/cloudField.js) is a painted card standing on its flat base,
//              turned to face you (and leaning back as you rise above it, so from above it
//              never goes edge on), hazed with distance. Drawn after the sky and the solid
//              world; they write depth where they are solid, so streams behind them are hidden.
//   inside     as you near a cloud its card thins away and you are among painted puffs (cut
//              from the same painting) inside its volume, the light dimming to a mist the
//              deeper you go.
//   cloud sea  the painted sea of cloud far below, at the floor: fall that far and you are gone.

import * as THREE from 'three';
import { UNTONE_GLSL } from './painted.js';
import { SKY_COLOR_GLSL } from './shaders.js';
import { PAINTED_SETS } from '../world/paintedSets.js';

const MAXCARDS = 512;
const PUFFS = 7 * 7 * 7;        // the lattice of puffs round the camera inside a cloud
const PUFF_CELL = 13;           // (m)

const CARD_VERT = /* glsl */ `
attribute vec2 aCorner;         // x 0..1 across, y 0..1 up
attribute vec4 iPos;            // base centre, card width
attribute vec4 iRect;           // in the atlas
attribute vec3 iMisc;           // height, alpha, mirror
varying vec2 vUv;
varying float vA;
varying vec3 vWorld;
void main() {
  vec3 base = iPos.xyz;
  float W = iPos.w, H = iMisc.x;
  // Face the camera about the upright, leaning back as the camera rises above (and forward
  // as it drops below), so the painting is never seen edge on.
  vec3 mid = base + vec3(0.0, H * 0.45, 0.0);
  vec3 to = cameraPosition - mid;
  vec2 th = to.xz; float lh = length(th);
  vec3 fw = lh > 1e-3 ? vec3(th.x / lh, 0.0, th.y / lh) : vec3(0.0, 0.0, 1.0);
  vec3 R = vec3(fw.z, 0.0, -fw.x);
  float el = atan(to.y, max(lh, 1e-3));
  float p = clamp(el * 0.85, -0.9, 1.25);
  vec3 U = vec3(0.0, cos(p), 0.0) - fw * sin(p);
  vec3 pos = base + R * (aCorner.x - 0.5) * W + U * aCorner.y * H;
  vWorld = pos;
  float u = iMisc.z > 0.5 ? 1.0 - aCorner.x : aCorner.x;
  vUv = iRect.xy + vec2(u, aCorner.y) * iRect.zw;
  vA = iMisc.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const CARD_FRAG = /* glsl */ `
uniform sampler2D tAtlas;
uniform float uFogDist, uDepthPass;
varying vec2 vUv;
varying float vA;
varying vec3 vWorld;
${SKY_COLOR_GLSL}
${UNTONE_GLSL}
void main() {
  vec4 t = texture2D(tAtlas, vUv);
  if (uDepthPass > 0.5) { if (t.a < 0.6 || vA < 0.9) discard; gl_FragColor = vec4(0.0); return; }
  float a = t.a * vA;
  if (a < 0.004) discard;
  vec3 c = unTone(t.rgb);
  // Into the haze with distance.
  vec3 d = vWorld - cameraPosition;
  float L = length(d);
  float fog = 1.0 - exp(-L / uFogDist);
  c = mix(c, skyColor(d / L), fog * 0.85);
  gl_FragColor = vec4(c * a, a);
}
`;

const SEA_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SEA_FRAG = /* glsl */ `
uniform sampler2D tSea;
uniform float uTime, uFogDist, uWarm;
uniform vec3 uDeep;
varying vec3 vWorld;
${SKY_COLOR_GLSL}
${UNTONE_GLSL}
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  // The painted cloud sea (Zenith's Helios), drifting, at two sizes blended by a slow noise so
  // its billows never line up into a grid.
  vec2 q = vWorld.xz + vec2(uTime * 3.6, uTime * 1.5);
  vec3 a = texture2D(tSea, q / 1100.0).rgb;
  vec3 b = texture2D(tSea, mat2(0.8, -0.6, 0.6, 0.8) * q / 1500.0 + 0.41).rgb;
  float n = vnoise(vWorld.xz * 0.0011);
  vec3 col = mix(a, b, smoothstep(0.3, 0.7, n));
  col *= 0.92 + 0.14 * smoothstep(0.35, 0.65, vnoise(vWorld.xz * 0.0004 + 3.0));
  // Golden hour: the lights warm, the shadows toward lavender (the painting is midday).
  float l = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, mix(vec3(0.62, 0.58, 0.8) * l * 1.15, vec3(1.0, 0.86, 0.68) * l * 1.08, smoothstep(0.55, 0.9, l)), uWarm * 0.75);
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
uniform sampler2D tSea;
uniform float uWarm;
varying vec2 vUv, vC;
varying vec2 vA;
${UNTONE_GLSL}
void main() {
  // A round puff of the painted cloud sea's billows, its edge broken up by the painting.
  vec3 t = texture2D(tSea, vUv).rgb;
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
      uniforms: U({ tSea: { value: null }, uTime: { value: 0 }, uFogDist: { value: 7000 }, uWarm: { value: 1 }, uDeep: { value: new THREE.Color(0.1, 0.2, 0.5) } }),
    });
    const sg = new THREE.PlaneGeometry(80000, 80000, 1, 1);
    sg.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(sg, this.seaMat);
    this.sea.frustumCulled = false;
    this.sea.renderOrder = -10;
    this.backScene.add(this.sea);

    // Cards: a depth pass (solid parts only) and then the painting, back to front.
    const cg = quad(true);
    this.cPos = new Float32Array(MAXCARDS * 4); this.cRect = new Float32Array(MAXCARDS * 4); this.cMisc = new Float32Array(MAXCARDS * 3);
    const mk = (a, n) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.cPosA = mk(this.cPos, 4); this.cRectA = mk(this.cRect, 4); this.cMiscA = mk(this.cMisc, 3);
    cg.setAttribute('iPos', this.cPosA); cg.setAttribute('iRect', this.cRectA); cg.setAttribute('iMisc', this.cMiscA);
    cg.instanceCount = 0;
    this.cardGeo = cg;
    const cardU = () => U({ tAtlas: { value: painted.atlas }, uFogDist: { value: 7000 }, uDepthPass: { value: 0 } });
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
    this.puffMat = new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: U({ tSea: { value: null }, uWarm: { value: 1 } }), ...premult });
    this.puffs = new THREE.Mesh(pg, this.puffMat);
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 6;
    this.veilScene.add(this.puffs);
    this._order = [];
    this.ready = true;
  }

  update(dt, camera, world, P) {
    if (!this.ready) return;
    const field = world.weather.field, cam = camera.position;
    this.seaMat.uniforms.uTime.value += dt;
    this.seaMat.uniforms.uFogDist.value = P.fogDistance;
    // The set for the light now: its cloud sea and puffs (Zenith's Meridian borrows Helios's, warmed).
    const surf = this.painted.surfaces[field.set()] || Object.values(this.painted.surfaces)[0];
    this.seaMat.uniforms.tSea.value = surf.cloudsea;
    this.seaMat.uniforms.uWarm.value = surf.warm ? 1 : 0;
    this.puffMat.uniforms.tSea.value = surf.puffs;
    this.puffMat.uniforms.uWarm.value = surf.warm ? 1 : 0;
    this.sea.position.set(cam.x, P.floorAltitude - 15, cam.z);
    this.sea.visible = P.cloudSea !== false;
    this.cardMat.uniforms.uFogDist.value = this.cardDepthMat.uniforms.uFogDist.value = P.fogDistance;

    // The cards, farthest first; the one you are about to enter thins away.
    const rects = this.painted.rects, list = this._order;
    list.length = 0;
    let nearD = Infinity, nearS = null;
    field.each((s) => {
      if (s.alpha < 0.01) return;
      const dx = s.x - cam.x, dz = s.z - cam.z, dy = s.y + s.H * 0.45 - cam.y;
      const d2 = dx * dx + dy * dy + dz * dz;
      const sd = field.sdf(s, cam.x, cam.y, cam.z);
      if (sd < nearD) { nearD = sd; nearS = { ...s }; }
      const fade = THREE.MathUtils.smoothstep(sd, 2, 45);
      if (fade * s.alpha < 0.01) return;
      if (!rects[s.set]) return;
      list.push({ d2, x: s.x, y: s.y, z: s.z, W: s.W, H: s.H, a: s.alpha * fade, r: rects[s.set][s.card], m: s.mirror });
    });
    list.sort((a, b) => b.d2 - a.d2);
    const n = Math.min(MAXCARDS, list.length);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      this.cPos[i * 4] = c.x; this.cPos[i * 4 + 1] = c.y; this.cPos[i * 4 + 2] = c.z; this.cPos[i * 4 + 3] = c.W;
      this.cRect[i * 4] = c.r[0]; this.cRect[i * 4 + 1] = c.r[1]; this.cRect[i * 4 + 2] = c.r[2]; this.cRect[i * 4 + 3] = c.r[3];
      this.cMisc[i * 3] = c.H; this.cMisc[i * 3 + 1] = c.a; this.cMisc[i * 3 + 2] = c.m;
    }
    this.cardGeo.instanceCount = n;
    for (const A of [this.cPosA, this.cRectA, this.cMiscA]) { A.clearUpdateRanges(); A.addUpdateRange(0, n * A.itemSize); A.needsUpdate = true; }

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
    if (nearS) this.mistColor.setRGB(...(PAINTED_SETS[nearS.set].light === 'golden' ? [0.96, 0.84, 0.78] : PAINTED_SETS[nearS.set].light === 'night' ? [0.32, 0.38, 0.55] : [0.86, 0.9, 0.98]));
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
