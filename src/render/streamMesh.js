// Streams drawn as meshes: every snapshot segment (braids.js) is an instance of a small grid,
// bent in the vertex shader onto the segment's ridable skin. The vertex shader reads the same
// segment texture the physics and the old ray-marched path use, so the surface is the one you
// ride: the Hermite centerline, the channel's floor and walls (or a cord's tube), the depth
// where density crosses your current ride threshold, and the moving water.
//
// Three levels of detail by distance, culled to the view on the CPU each frame. Drawn in their
// own scene after the sky and clouds (pipeline.js) as translucent blue light: brushed streaks
// carried by the flow, white lines along the lips and crests, brighter up toward the lips,
// sparkles; hidden by
// clouds in front through the cloud depth the sky pass writes, and behind the solid world by
// its depth.

import * as THREE from 'three';
import { SKY_GLSL } from '../sky/sky.js';
import { BR, CLS } from '../trapar/braids.js';
import { SKY_COLOR_GLSL } from './shaders.js';

const COMMON = /* glsl */ `
${SKY_COLOR_GLSL}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const VERT = /* glsl */ `
${SKY_GLSL}
attribute vec2 aGrid;      // (tau along the segment 0..1, q across it -1..1)
attribute float aSeg;      // segment index (per instance)
uniform float uRideThr;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlpha;
varying vec4 vInfo;        // wave height, white water, tier + 4 * layer, tags
varying vec3 vFlow;        // flow direction * speed (world)
varying float vCls;
varying vec4 vSurf;        // along the stream (m, continuous along a band), across it (m), q, half-width

// x with smoothstep(0, 1, x) = y.
float ssInv(float y) { return 0.5 - sin(asin(1.0 - 2.0 * clamp(y, 0.0, 1.0)) / 3.0); }

void main() {
  int base = int(aSeg + 0.5) * BR_SEG_TEXELS;
  vec4 a0 = brTexel(tBrSeg, base), a1 = brTexel(tBrSeg, base + 1);
  vec4 a2 = brTexel(tBrSeg, base + 2), a3 = brTexel(tBrSeg, base + 3);
  vec4 a4 = brTexel(tBrSeg, base + 4), a5 = brTexel(tBrSeg, base + 5);
  vec4 a6 = brTexel(tBrSeg, base + 6), a7 = brTexel(tBrSeg, base + 7);
  float Lf = floor(a0.w / 1000.0);
  int L = int(Lf + 0.5);
  float w0 = a0.w - Lf * 1000.0, w1 = a1.w;
  float tau = aGrid.x, q = aGrid.y;
  vec3 e = a1.xyz - a0.xyz;
  float sl = length(e);
  vec3 T0 = a6.xyz, T1 = a7.xyz;
  float t = tau, t2 = t * t, t3 = t2 * t;
  float h00 = 2.0 * t3 - 3.0 * t2 + 1.0, h10 = t3 - 2.0 * t2 + t, h01 = -2.0 * t3 + 3.0 * t2, h11 = t3 - t2;
  float d00 = 6.0 * t2 - 6.0 * t, d10 = 3.0 * t2 - 4.0 * t + 1.0, d01 = -6.0 * t2 + 6.0 * t, d11 = 3.0 * t2 - 2.0 * t;
  vec3 C = h00 * a0.xyz + h10 * sl * T0 + h01 * a1.xyz + h11 * sl * T1;
  vec3 Tg = d00 * a0.xyz + d10 * sl * T0 + d01 * a1.xyz + d11 * sl * T1;
  Tg = length(Tg) > 1e-5 ? normalize(Tg) : normalize(e);
  vec3 U = a2.xyz + (a3.xyz - a2.xyz) * tau;
  U = normalize(U - dot(U, Tg) * Tg);
  vec3 Rt = cross(Tg, U);
  float w = w0 + (w1 - w0) * tau;
  float pres = a4.x + (a4.y - a4.x) * tau;
  float soft = uBrSoft, dens = uBrDensity;
  vec3 P, N;
  float alpha = 1.0;
  gWWave = 0.0; gWFoam = 0.0;
  vec4 a8 = brTexel(tBrSeg, base + 8);
  float sAlong = a8.x + (a8.y - a8.x) * tau;
  float sLat;
  if (L == BR_CORD) {
    // A cord: a tube of radius w, ridden on its outside; the skin is where density crosses the
    // threshold, just inside the radius.
    float k = uRideThr / max(1e-4, dens * pres);
    alpha = 1.0 - smoothstep(0.92, 1.0, k);
    float r = max(0.2, w - soft * ssInv(min(k, 0.999)));
    float th = q * 3.14159265;
    vec3 rad = Rt * sin(th) + U * cos(th);
    P = C + rad * r;
    N = rad;
    sLat = th * r;
  } else {
    // A channel: a flat floor of half-width wf, walls curving up (curvature kap) out to arc
    // length w; a lane cut flattens one side into a shelf.
    float kap0 = a2.w + (a3.w - a2.w) * tau;
    float wf = a5.x + (a5.y - a5.x) * tau;
    float cut = a5.z + (a4.w - a5.z) * tau;
    float sgn = q < 0.0 ? -1.0 : 1.0;
    float cutS = (cut != 0.0 && ((q >= 0.0) == (cut > 0.0))) ? min(1.0, abs(cut)) : 0.0;
    float kap = kap0 * (1.0 - cutS);
    float arc = abs(q) * w;
    float fadeW = min(0.25 * w, max(3.0, 0.25 * w - 0.4 * wf));
    float lat = 1.0 - smoothstep(w - fadeW, w, arc);
    float k = uRideThr / max(1e-4, dens * lat * pres);
    alpha = 1.0 - smoothstep(0.92, 1.0, k);
    float d = soft * ssInv(min(k, 0.999));
    float u, v;
    if (arc <= wf || kap < 1e-4) { u = sgn * arc; v = -d; N = U; }
    else {
      float R = 1.0 / kap, phi = (arc - wf) * kap;
      float sp = sin(phi), cp = cos(phi);
      u = sgn * (wf + (R + d) * sp);
      v = R - (R + d) * cp;
      N = normalize(U * cp - Rt * (sgn * sp));
    }
    P = C + Rt * u + U * v;
    sLat = sgn * arc;
    // The water moves the surface along the band's up (as in brDensity).
    if (uBrWater.w > 0.0) {
      float hw = brWater(base, tau, u, w, P.xz, cut);
      float wv = gWWave, fo = gWFoam;
      float dt = 0.03;
      float h2 = brWater(base, min(1.0, tau + dt), u, w, (P + Tg * sl * dt).xz, cut);
      float slope = (h2 - hw) / max(0.5, sl * dt);
      P += U * hw;
      N = normalize(N - Tg * slope * dot(N, U));
      gWWave = wv; gWFoam = fo;
    }
  }
  vAlpha = alpha;
  vWorld = P;
  vNormal = N;
  vInfo = vec4(gWWave, gWFoam, a5.w, a6.w);
  vFlow = Tg * a4.z;
  vCls = float(L);
  vSurf = vec4(sAlong, sLat, q, w);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAG = /* glsl */ `
${SKY_GLSL}
${COMMON}
uniform float uSkinOpacity, uSkinGlow, uStripes, uSwellHi, uOutline, uContours, uContourStep, uFogDist;
uniform vec3 uTrBody[6], uTrCore[6];     // per kind: tangle, main, crown, updraft, chute, other connector
uniform vec3 uPulseOrigin;
uniform float uPulseRadius, uPulseStrength, uPulseWidth;
uniform vec3 uRiderPos, uRiderUp;
uniform sampler2D tCloud, tCloudDepth;   // the sky pass: clouds (alpha: what shows through) and where they thicken
uniform vec2 uRes;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlpha;
varying vec4 vInfo;
varying vec3 vFlow;
varying float vCls;
varying vec4 vSurf;

// How much of the stream at distance ts shows through the clouds in front of it.
float cloudPass(float ts) {
  vec2 uv = gl_FragCoord.xy / uRes;
  float Tf = texture2D(tCloud, uv).a;
  Tf = Tf < 0.1 ? 0.0 : Tf;     // (the sky pass stops in thick cloud before it is fully opaque)
  vec2 cd = texture2D(tCloudDepth, uv).xy;
  float T;
  if (ts < cd.x) T = 1.0;
  else if (cd.y < 50000.0) T = ts < cd.y ? mix(0.9, 0.5, (ts - cd.x) / max(1.0, cd.y - cd.x)) : Tf;
  else T = mix(0.9, Tf, clamp((ts - cd.x) / 250.0, 0.0, 1.0));
  return max(T, Tf);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

void main() {
  if (vAlpha < 0.5) discard;
  vec3 ps = vWorld;
  vec3 toP = ps - cameraPosition;
  float ts = length(toP);
  vec3 rd = toP / max(ts, 1e-4);
  vec3 n = normalize(vNormal);
  bool under = dot(n, rd) > 0.0;     // seen from below (or a wall from outside)
  if (under) n = -n;
  float sw = vInfo.x, sFoam = vInfo.y, tierAll = vInfo.z, sTags = vInfo.w;
  float sLayer = floor(tierAll / 4.0 + 0.01), sTier = tierAll - 4.0 * sLayer;
  float rim = 1.0 - abs(dot(n, rd));
  float near = 1.0 - smoothstep(700.0, 2200.0, ts);   // fine detail fades with distance

  // Drawn as light: a body colour, rising to a paler core where it is most intense. Each layer
  // has its own blue; connectors their own colours.
  int kind = sLayer < 0.5 ? 0 : sLayer < 1.5 ? 1 : sLayer < 2.5 ? 2 : 5;
  if (kind == 5) { int tg = int(sTags + 0.5); kind = (tg & 256) != 0 ? 3 : (tg & 512) != 0 ? 4 : 5; }
  vec3 body = uTrBody[kind], core = uTrCore[kind];
  if (vCls > 2.5) body = mix(body, core, 0.25);

  // Brushed streaks along the flow: long and thin, carried downstream (two phases, crossfaded).
  float along = vSurf.x, lat = vSurf.y, qa = abs(vSurf.z);
  float spd = length(vFlow);
  const float PER = 4.0;
  float p1 = fract(uTrTime / PER), p2 = fract(uTrTime / PER + 0.5);
  float wa = 1.0 - abs(2.0 * p1 - 1.0);
  float seed = float(kind) * 0.137 + sTier * 0.071;
  float s1 = texture(uNoiseB, vec3(lat / 26.0, (along - spd * PER * p1) / 340.0, seed)).r;
  float s2 = texture(uNoiseB, vec3(lat / 26.0 + 0.41, (along - spd * PER * p2) / 340.0 + 0.27, seed + 0.5)).r;
  float br = s1 * wa + s2 * (1.0 - wa);
  float fine = 0.0;
  if (near > 0.0) {   // (fine streaks: close by only)
    float f1 = texture(uNoiseB, vec3(lat / 9.0, (along - spd * PER * p1 * 1.3) / 120.0, seed + 0.3)).r;
    float f2 = texture(uNoiseB, vec3(lat / 9.0 + 0.6, (along - spd * PER * p2 * 1.3) / 120.0 + 0.5, seed + 0.8)).r;
    fine = f1 * wa + f2 * (1.0 - wa);
  }
  float streak = smoothstep(0.4, 0.8, br) * 0.8 + smoothstep(0.5, 0.85, fine) * 0.5 * near;
  streak *= uStripes * 2.0;

  // How intense the light is here: a faint body, denser seen edge on, brighter up the walls
  // toward the lips, brightest on the wave crests and in white water.
  float crest = smoothstep(0.15, 1.0, sw * uSwellHi);
  float lipBand = smoothstep(0.5, 0.7, vAlpha) * (1.0 - smoothstep(0.8, 1.0, vAlpha));
  float wall = vCls < 0.5 ? 0.0 : smoothstep(0.35, 1.0, qa);
  float cshade = 1.0;   // (light is not shadowed by cloud; kept as a hook)
  float I = 0.12 + 0.2 * rim * rim * rim + 0.25 * wall + 0.7 * streak + 0.45 * crest + 0.3 * lipBand * uOutline;
  I += 0.06 * sTier;
  float trough = clamp(-sw * uSwellHi, 0.0, 1.0);
  I *= 1.0 - 0.3 * trough;
  I *= mix(0.78, 1.0, cshade) * (0.88 + 0.12 * max(dot(n, uSunDir), 0.0));
  // Height contours, as faint lines of light (to read the climb).
  float cy = ps.y / uContourStep;
  float fw = clamp(ts * 0.0016 / uContourStep, 0.015, 0.3);
  float fr = abs(fract(cy + 0.5) - 0.5);
  float line = (1.0 - smoothstep(fw * 0.5, fw, fr)) * (1.0 - smoothstep(1200.0, 2600.0, ts)) * min(uContours, 1.5);
  I += 0.12 * line;

  vec3 c = mix(body, core, smoothstep(0.35, 1.15, I));
  c *= uSkinGlow * (0.7 + 0.8 * min(I, 1.3));

  // White lines of light, as the wave's edges are drawn: along the lip, across each wave crest,
  // and a few kinked lines running lengthwise through the body (contours of the brushed
  // streaks). About a pixel or two at any distance, with a soft glow either side.
  float lw = max(fwidth(vAlpha), 1e-4);
  float lipLine = 1.0 - smoothstep(lw * 1.0, lw * 2.2, vAlpha - 0.5);
  float lipGlow = (1.0 - smoothstep(lw * 2.0, lw * 7.0, vAlpha - 0.5)) * 0.5;
  float cs = sw * uSwellHi;
  float cw = max(fwidth(cs), 1e-4);
  float crestLine = (1.0 - smoothstep(cw * 0.8, cw * 1.8, abs(cs - 0.62))) * step(0.0, sw) * near;
  float bw = max(fwidth(br), 1e-4);
  float bodyLine = (1.0 - smoothstep(bw * 0.7, bw * 1.6, abs(br - 0.62))) * near * (0.4 + 0.6 * wall) * min(uStripes * 2.0, 1.0);
  float far = 1.0 - smoothstep(250.0, 900.0, ts);
  float wline = clamp(max(max(lipLine * (0.45 + 0.55 * near), crestLine * 0.9), bodyLine * 0.7 * far) * uOutline, 0.0, 1.0);
  float wglow = clamp(lipGlow * uOutline * near, 0.0, 1.0);
  // Close by the lines are white; far off they take the stream's own colour.
  vec3 white = mix(core * 1.15, vec3(1.0) * 1.6, near) * uSkinGlow;
  c = mix(c, mix(core, white, 0.6) * uSkinGlow, wglow);
  c = mix(c, white, wline);

  // White water: where the wave breaks it goes white with a blush of pink.
  float foam = 0.0;
  if (sFoam > 0.01 && ts < 2200.0) {
    float fnz = texture(uNoiseB, vec3(ps.x / 13.0, ps.y / 9.0 + uTrTime * 0.4, ps.z / 13.0)).r;
    float fnz2 = texture(uNoiseB, vec3(ps.x / 4.5 + 0.31, ps.y / 4.0 - uTrTime * 0.7, ps.z / 4.5)).r;
    foam = smoothstep(0.35, 0.8, sFoam * (0.45 + 0.75 * fnz + 0.35 * fnz2)) * (1.0 - smoothstep(900.0, 2200.0, ts));
    c = mix(c, vec3(1.0, 0.9, 0.97) * uSkinGlow * 1.3, foam * 0.85);
  }

  // Sparkles: flecks of light riding the flow, thickest at the crests and lips, twinkling.
  float spark = 0.0;
  if (ts < 650.0) {
    vec2 g = vec2((along - spd * uTrTime * 1.05) / 2.6, lat / 1.6);
    vec2 cell = floor(g), fg = fract(g);
    vec2 h = hash22(cell + seed * 17.0);
    float keep = step(1.0 - (0.05 + 0.3 * crest + 0.25 * lipBand + 0.12 * wall + 0.25 * foam), hash12(cell + 3.1));
    float tw = 0.5 + 0.5 * sin(uTrTime * (5.0 + 6.0 * h.x) + h.y * 40.0);
    vec2 dd = (fg - (0.2 + 0.6 * h)) * vec2(2.6, 1.6);
    float rpx = max(0.09, ts * 0.0011);
    spark = keep * tw * (1.0 - smoothstep(rpx * 0.5, rpx, length(dd))) * (1.0 - smoothstep(380.0, 650.0, ts));
    c = mix(c, vec3(0.85, 0.95, 1.0) * uSkinGlow * 2.0, spark);
  }

  // The sense pulse sweeping out.
  float pd = length(ps - uPulseOrigin);
  float ring = (1.0 - smoothstep(0.0, uPulseWidth, abs(pd - uPulseRadius))) * uPulseStrength;
  float swept = (1.0 - smoothstep(uPulseRadius - 1.0, uPulseRadius, pd)) * uPulseStrength;
  c += vec3(0.9, 1.0, 0.8) * (ring * 1.6 + swept * 0.35);
  if (under) c *= 0.8;

  // How much it covers what is behind: light, so mostly it adds; the soft edge fades out.
  float a = uSkinOpacity * (0.25 + 2.0 * min(I, 1.2)) + foam * 0.4 + spark * 0.8 + ring * 0.6 + wline * 0.85 + wglow * 0.3;
  a *= smoothstep(0.5, 0.62, vAlpha);
  if (under) a *= 0.8;
  float fog = 1.0 - exp(-ts / uFogDist);
  c = mix(c, skyColor(rd) * 1.2, fog * 0.4);
  a *= max(1.0 - 0.85 * fog, ring + swept);

  // Keep the rider in sight: skin between the camera and the rider thins out, and so does skin
  // right in front of the camera.
  vec3 cr = uRiderPos - cameraPosition;
  float dcr = length(cr);
  if (dcr > 1.0 && ts < dcr - 1.2 && dot(ps - uRiderPos, uRiderUp) > -0.6) {   // (not the floor under you)
    float al = dot(toP, cr) / dcr;
    float perp = length(toP - cr * (al / dcr));
    float rad = 2.2 + 0.15 * al;
    a *= mix(0.15, 1.0, smoothstep(rad * 0.55, rad, perp));
  }
  a *= smoothstep(1.0, 5.0, ts);
  a = clamp(a, 0.0, 1.0) * cloudPass(ts);
  // Premultiplied, with the cover only partly blocking what is behind (light adds).
  gl_FragColor = vec4(c * a, a * 0.8);
}
`;

// The streams' colours (linear). Body: the thin light; core: where it is most intense.
// Translucent blues, like the sea-glass body of a breaking wave, so the green trapar the board
// throws up (riderView.js) stands out against them. Each layer its own blue so they read apart;
// the connectors their own colours (updrafts gold, chutes violet).
export const STREAM_PALETTE = {
  body: [[0.03, 0.32, 0.55], [0.06, 0.4, 0.95], [0.3, 0.6, 1.0], [0.95, 0.5, 0.06], [0.55, 0.22, 0.95], [0.4, 0.62, 0.8]],
  core: [[0.35, 0.85, 0.95], [0.55, 0.85, 1.0], [0.8, 0.93, 1.0], [1.0, 0.9, 0.5], [1.0, 0.75, 1.0], [0.85, 0.95, 1.0]],
};

function gridGeometry(na, nq) {
  const g = new THREE.InstancedBufferGeometry();
  const grid = new Float32Array((na + 1) * (nq + 1) * 2), idx = [];
  let k = 0;
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nq; j++) { grid[k++] = i / na; grid[k++] = -1 + (2 * j) / nq; }
  for (let i = 0; i < na; i++) for (let j = 0; j < nq; j++) {
    const a = i * (nq + 1) + j, b = a + nq + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
  // (three wants a position attribute; the vertex shader builds the real one)
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((na + 1) * (nq + 1) * 3), 3));
  g.setIndex(idx);
  return g;
}

export class StreamMesh {
  constructor(scene, skyUniforms, common, look) {
    this.uniforms = {
      ...skyUniforms, ...common,
      uTrBody: { value: STREAM_PALETTE.body.map((c) => new THREE.Vector3(...c)) },
      uTrCore: { value: STREAM_PALETTE.core.map((c) => new THREE.Vector3(...c)) },
      uRideThr: { value: 1 },
      uSkinOpacity: { value: 0.8 }, uSkinGlow: { value: 1 }, uStripes: { value: 0.5 }, uSwellHi: { value: 1 },
      uOutline: { value: 1 }, uContours: { value: 0.7 }, uContourStep: { value: 12 }, uFogDist: { value: 7000 },
      uPulseOrigin: { value: new THREE.Vector3() }, uPulseRadius: { value: 0 }, uPulseStrength: { value: 0 }, uPulseWidth: { value: 120 },
      uRiderPos: { value: new THREE.Vector3() }, uRiderUp: { value: new THREE.Vector3(0, 1, 0) },
      tCloud: { value: null }, tCloudDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    };
    // Translucent: drawn after the sky and clouds (pipeline.js), tested against the solid
    // world's depth but not writing it, premultiplied.
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.lods = [
      { geo: gridGeometry(10, 18), maxD: 900 },
      { geo: gridGeometry(5, 10), maxD: 2600 },
      { geo: gridGeometry(2, 6), maxD: Infinity },
    ];
    this.cap = 0;
    this.group = new THREE.Group();
    for (const L of this.lods) {
      L.mesh = new THREE.Mesh(L.geo, this.mat);
      L.mesh.frustumCulled = false;
      L.geo.instanceCount = 0;
      this.group.add(L.mesh);
    }
    scene.add(this.group);
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this.stats = { drawn: 0, lod: [0, 0, 0] };
  }

  _ensure(n) {
    if (n <= this.cap) return;
    this.cap = Math.max(n, Math.ceil(this.cap * 1.5), 4096);
    for (const L of this.lods) {
      L.ids = new Float32Array(this.cap);
      L.attr = new THREE.InstancedBufferAttribute(L.ids, 1);
      L.attr.setUsage(THREE.DynamicDrawUsage);
      L.geo.setAttribute('aSeg', L.attr);
    }
  }

  update(camera, braids, P, rideThr, pipeline, riderPos, riderUp) {
    const on = P.streamMesh && braids.S.uBrOn > 0;
    this.group.visible = on;
    if (!on) return;
    const u = this.uniforms;
    if (riderPos) {
      const up = riderUp || { x: 0, y: 1, z: 0 };
      u.uRiderPos.value.set(riderPos.x + up.x * 0.9, riderPos.y + up.y * 0.9, riderPos.z + up.z * 0.9);
      u.uRiderUp.value.set(up.x, up.y, up.z);
    }
    u.uRideThr.value = rideThr;
    u.uSkinOpacity.value = P.skinOpacity; u.uSkinGlow.value = P.skinGlow; u.uStripes.value = P.flowStripes;
    u.uSwellHi.value = P.waterOn ? P.waveShade : 0; u.uOutline.value = P.outline;
    u.uContours.value = P.contours; u.uContourStep.value = P.contourStep; u.uFogDist.value = P.fogDistance;
    u.tCloud.value = pipeline.cloudRT.textures[0];
    u.tCloudDepth.value = pipeline.cloudDepth;
    u.uRes.value.set(pipeline.compRT.width, pipeline.compRT.height);
    const su = pipeline.skyMat.uniforms;
    u.uPulseOrigin.value.copy(su.uPulseOrigin.value); u.uPulseRadius.value = su.uPulseRadius.value; u.uPulseStrength.value = su.uPulseStrength.value;
    // Cull to the view and sort into the levels of detail.
    const n = braids.nSeg, seg = braids.seg, FPS = BR.FPS;
    this._ensure(n);
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const pl = this._frustum.planes, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const maxD = Math.max(2000, P.fogDistance * 1.6);
    const c0 = [0, 0, 0];
    const l0 = this.lods[0].ids, l1 = this.lods[1].ids, l2 = this.lods[2].ids;
    const d0 = this.lods[0].maxD * P.streamDetail, d1 = this.lods[1].maxD * P.streamDetail;
    for (let i = 0; i < n; i++) {
      const o = i * FPS;
      const ax = seg[o], ay = seg[o + 1], az = seg[o + 2], bx = seg[o + 4], by = seg[o + 5], bz = seg[o + 6];
      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
      const half = 0.5 * Math.hypot(bx - ax, by - ay, bz - az);
      const w = Math.max(seg[o + 3] % 1000, seg[o + 7]);
      const r = half * 1.2 + w + 12;
      const dx = mx - cx, dy = my - cy, dz = mz - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      if (d > maxD) continue;
      let vis = true;
      for (let k = 0; k < 6; k++) { const p = pl[k]; if (p.normal.x * mx + p.normal.y * my + p.normal.z * mz + p.constant < -r) { vis = false; break; } }
      if (!vis) continue;
      if (seg[o + 16] < 0.02 && seg[o + 17] < 0.02) continue;
      if (d < d0) l0[c0[0]++] = i; else if (d < d1) l1[c0[1]++] = i; else l2[c0[2]++] = i;
    }
    for (let k = 0; k < 3; k++) {
      const L = this.lods[k];
      L.geo.instanceCount = c0[k];
      L.attr.clearUpdateRanges(); L.attr.addUpdateRange(0, c0[k]); L.attr.needsUpdate = true;
      this.stats.lod[k] = c0[k];
    }
    this.stats.drawn = c0[0] + c0[1] + c0[2];
  }
}
export { CLS };
