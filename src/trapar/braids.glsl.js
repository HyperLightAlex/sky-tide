// GLSL mirror of the stream evaluation (braids.js: Braids.density and segFrame). Keep the
// two in lockstep. The segment snapshot, the per-cell index list and the cell table arrive as
// float textures.

import { BR, CLS } from './braids.js';

export const BRAID_UNIFORMS = ['uBrOn', 'uBrGridO', 'uBrCellSize', 'uBrDims', 'uBrThickC', 'uBrSoft', 'uBrDensity', 'uBrLo', 'uBrHi',
  'uBrWater', 'uBrWave', 'uBrWave2', 'uBrClock', 'uBrFoam'];

export const BRAIDS_GLSL = /* glsl */ `
#define BR_TEX_W ${BR.TEX_W}
#define BR_MAX_PER_CELL ${BR.MAX_PER_CELL}
#define BR_CLASSES ${BR.MAX_CLASS}
#define BR_SEG_TEXELS ${BR.SEG_TEXELS}
#define BR_CORD ${CLS.CORD}
#define BR_TWO_PI 6.283185307179586
uniform highp sampler2D tBrSeg;
uniform highp sampler2D tBrIdx;
uniform highp sampler2D tBrCell;
uniform int uBrOn;
uniform vec3 uBrGridO, uBrCellSize;
uniform ivec3 uBrDims;
uniform float uBrThickC[BR_CLASSES];
uniform float uBrSoft, uBrDensity, uBrLo, uBrHi;
uniform vec4 uBrWater, uBrWave, uBrWave2, uBrClock;
uniform float uBrFoam;

// The winning segment of the last brDensity() call (for flow, shading and step sizes).
int gBrCnt = 0;
float gBrSafe = 1e9;        // distance the next ray step can safely skip (rendering only)
bool gBrInGrid = false;
vec3 gBrCellMin = vec3(0.0), gBrCellMax = vec3(0.0);
vec3 gBrTan = vec3(1.0, 0.0, 0.0);
float gBrFlow = 0.0;
float gBrCls = 0.0;
float gBrCurl = 0.0;
float gBrTier = 0.0;        // tier + 4 * layer (3: connector)
float gBrTags = 0.0;
float gBrFoam = 0.0;         // white water at the winning point (0..1)
float gBrWave = 0.0;         // wave height there (relative to the biggest trunk waves)
float gWFoam = 0.0, gWWave = 0.0;

vec4 brTexel(highp sampler2D t, int i) { return texelFetch(t, ivec2(i % BR_TEX_W, i / BR_TEX_W), 0); }

// Water (mirrors waterAt in braids.js): the surface's offset along the band's up at parameter
// tau, lateral offset u (half-width w), world (x, z), from swells, rollers, chop, rapids and
// slosh. Sets gWFoam (white water) and gWWave (wave height, relative to the biggest trunk
// waves).
float brWater(int base, float tau, float u, float w, vec2 xz, float cut) {
  vec4 a8 = brTexel(tBrSeg, base + 8);
  vec4 a9 = brTexel(tBrSeg, base + 9);
  float t = uBrClock.x;
  float s = a8.x + (a8.y - a8.x) * tau;
  float a = a8.z + (a8.w - a8.z) * tau;
  float r0 = floor(a9.x / 1024.0), r1 = floor(a9.y / 1024.0);
  float l0 = a9.x - r0 * 1024.0, l1 = a9.y - r1 * 1024.0;
  float rapRel = ((r0 + (r1 - r0) * tau) / 1023.0) * 2.0;
  float sl = ((l0 + (l1 - l0) * tau) / 1023.0) * uBrWater.z * (1.0 - min(1.0, 2.0 * abs(cut)));
  float lam = a9.z, ph = a9.w;
  float q = clamp(u / max(1.0, w), -1.0, 1.0);
  // Patches of bigger and smaller swells.
  float G1 = 0.00698 * (0.8 * xz.x + 0.6 * xz.y) - 0.1142 * t, G2 = 0.00967 * (0.866 * xz.y - 0.5 * xz.x) - 0.1533 * t + 1.3;
  float m = 0.72 + 0.28 * (0.6 * sin(G1) + 0.4 * sin(G2));
  // Swells.
  float A = a * uBrWater.x;
  float th = BR_TWO_PI * fract((s - uBrWave.x * t) / lam);
  float sn = sin(th);
  float hs = A * m * (sn - 0.22 * m * cos(2.0 * th));
  // Rollers.
  float thr = BR_TWO_PI * fract((s - uBrWave.y * t) / (lam * 0.5)) + 2.1;
  float snr = sin(thr);
  float hro = a * uBrWave2.x * snr;
  // Chop.
  float thc = BR_TWO_PI * fract((s - uBrWave2.z * t) / (lam * 0.25)) + 4.1;
  float hc = a * uBrWave2.y * sin(thc);
  // Rapids.
  float lr = uBrWave.z * (0.8 + 0.4 * fract(ph * 1.1141));
  float hb = 0.5 - 0.5 * cos(BR_TWO_PI * fract(s / lr));
  float pulse = 1.0 + 0.12 * sin(uBrClock.z + s * 0.05);
  float hr = rapRel * uBrWater.y * hb * sqrt(hb) * pulse;
  // Slosh.
  float ts = uBrClock.y - BR_TWO_PI * fract(s / lam) + ph;
  float sq = sin(ts);
  float hl = sl * q * sq;
  gWWave = (hs + hro) / max(0.5, uBrWater.x + uBrWave2.x);
  // White water: on rapids (most on the humps' crests), breaking just ahead of the swells'
  // crests (most on the big ones), lightly on the rollers' crests, and where slosh runs up a
  // wall.
  float fr = min(1.0, rapRel) * (0.25 + 0.75 * smoothstep(0.45, 0.95, hb));
  float big = smoothstep(0.35, 0.9, a) * step(0.01, uBrWater.x);
  float fs = smoothstep(0.55, 0.97, sin(th - 0.35)) * smoothstep(0.45, 0.95, m) * big * 0.85;
  float fo = smoothstep(0.86, 1.0, sin(thr - 0.3)) * smoothstep(0.3, 0.8, a) * step(0.01, uBrWave2.x) * 0.35;
  float fl2 = smoothstep(0.55, 1.0, q * sq) * smoothstep(0.3, 0.8, uBrWater.z > 0.0 ? sl / uBrWater.z : 0.0) * 0.7;
  gWFoam = clamp(max(max(fr, fs), max(fo, fl2)), 0.0, 1.0) * uBrFoam;
  return hs + hro + hc + hr + hl;
}

float brDensity(vec3 p) {
  gBrCnt = 0; gBrSafe = 1e9; gBrInGrid = false; gBrFoam = 0.0; gBrWave = 0.0;
#ifdef BR_DISABLE
  return 0.0;   // (streams drawn as meshes, see render/streamMesh.js)
#endif
  if (uBrOn == 0 || p.y < uBrLo || p.y >= uBrHi) return 0.0;
  ivec3 g = ivec3(floor((p - uBrGridO) / uBrCellSize));
  if (any(lessThan(g, ivec3(0))) || any(greaterThanEqual(g, uBrDims))) return 0.0;
  gBrInGrid = true;
  gBrCellMin = uBrGridO + vec3(g) * uBrCellSize;
  gBrCellMax = gBrCellMin + uBrCellSize;
  int cid = g.x + uBrDims.x * (g.z + uBrDims.z * g.y);
  vec2 se = brTexel(tBrCell, cid).rg;
  int start = int(se.x + 0.5);
  int cnt = min(int(se.y + 0.5), BR_MAX_PER_CELL);
  gBrCnt = cnt;
  float best = 0.0;
  for (int j = 0; j < BR_MAX_PER_CELL; j++) {
    if (j >= cnt) break;
    int sid = int(brTexel(tBrIdx, start + j).r + 0.5);
    int base = sid * BR_SEG_TEXELS;
    vec4 a0 = brTexel(tBrSeg, base);
    vec4 a1 = brTexel(tBrSeg, base + 1);
    float Lf = floor(a0.w / 1000.0);
    int L = int(Lf + 0.5);
    float w0 = a0.w - Lf * 1000.0, w1 = a1.w;
    float T = uBrThickC[L];
    vec3 e = a1.xyz - a0.xyz;
    float ee = dot(e, e);
    float sl = sqrt(ee);
    float tauR = dot(p - a0.xyz, e) / ee;
    float tau = clamp(tauR, 0.0, 1.0);
    // Quick reject on the chord (with room for the curve's bulge).
    vec3 dc = p - (a0.xyz + e * tau);
    float lim = max(w0, w1) + T + 2.0 + 0.15 * sl + (L == BR_CORD ? 0.0 : uBrWater.w);
    float dd = dot(dc, dc);
    if (dd > lim * lim) { gBrSafe = min(gBrSafe, sqrt(dd) - lim); continue; }
    // The segment is a Hermite curve with the band's true tangents at its ends, so neighbors
    // meet with the same position, tangent and up (see segFrame in braids.js).
    vec4 a6 = brTexel(tBrSeg, base + 6);
    vec4 a7 = brTexel(tBrSeg, base + 7);
    vec3 T0 = a6.xyz, T1 = a7.xyz;
    vec3 C, Tg;
    if (tauR <= 0.0) { C = a0.xyz; Tg = T0; }
    else if (tauR >= 1.0) { C = a1.xyz; Tg = T1; }
    else {
      for (int it = 0; it < 2; it++) {
        float t = tau, t2 = t * t, t3 = t2 * t;
        float h00 = 2.0 * t3 - 3.0 * t2 + 1.0, h10 = t3 - 2.0 * t2 + t, h01 = -2.0 * t3 + 3.0 * t2, h11 = t3 - t2;
        float d00 = 6.0 * t2 - 6.0 * t, d10 = 3.0 * t2 - 4.0 * t + 1.0, d01 = -6.0 * t2 + 6.0 * t, d11 = 3.0 * t2 - 2.0 * t;
        C = h00 * a0.xyz + h10 * sl * T0 + h01 * a1.xyz + h11 * sl * T1;
        Tg = d00 * a0.xyz + d10 * sl * T0 + d01 * a1.xyz + d11 * sl * T1;
        if (it == 1) break;
        tau = clamp(tau + dot(p - C, Tg) / dot(Tg, Tg), 0.0, 1.0);
      }
      Tg = normalize(Tg);
    }
    vec3 d = p - C;
    vec4 a2 = brTexel(tBrSeg, base + 2);
    vec4 a3 = brTexel(tBrSeg, base + 3);
    vec4 a4 = brTexel(tBrSeg, base + 4);
    float w = w0 + (w1 - w0) * tau;
    float pres = a4.x + (a4.y - a4.x) * tau;
    vec3 U = a2.xyz + (a3.xyz - a2.xyz) * tau;
    U = normalize(U - dot(U, Tg) * Tg);
    vec3 Rt = cross(Tg, U);
    float u = dot(d, Rt), v = dot(d, U);
    vec4 a5 = brTexel(tBrSeg, base + 5);
    // Water moves a channel's surface along its up (by at most uBrWater.w). Over the floor and
    // well above or below it, it cannot reach: skip it there (the step size allows for it).
    gWFoam = 0.0; gWWave = 0.0;
    float slack = 0.0;
    if (L != BR_CORD && uBrWater.w > 0.0) {
      float wfw = a5.x + (a5.y - a5.x) * tau;
      if (abs(u) > wfw + 0.5 || (v < uBrWater.w + 0.5 && v > -T - uBrWater.w - 0.5)) v -= brWater(base, tau, u, w, p.xz, a5.z + (a4.w - a5.z) * tau);
      else slack = uBrWater.w;
    }
    float along = dot(d, Tg);
    float beyond = tauR > 1.0 ? max(along, 0.0) : tauR < 0.0 ? max(-along, 0.0) : 0.0;
    float alongTol = 0.6 + 0.06 * (abs(u) + abs(v));
    if (beyond > alongTol) { gBrSafe = min(gBrSafe, (beyond - alongTol) * 0.5); continue; }
    float bfade = beyond > 0.0 ? 1.0 - smoothstep(0.0, alongTol, beyond) : 1.0;
    float rho, kapE = 0.0, wfE = 0.0;
    if (L == BR_CORD) {
      // Solid round cord of radius w.
      float rr = sqrt(u * u + v * v);
      float depth = w - rr;
      gBrSafe = min(gBrSafe, 0.9 * max(-depth, 0.0));
      if (depth <= 0.0) continue;
      rho = uBrDensity * smoothstep(0.0, uBrSoft, depth) * pres * bfade;
    } else {
      // Channel: flat floor, walls curving up; a lane cut flattens one side into a shelf.
      float kap0 = a2.w + (a3.w - a2.w) * tau;
      float wf = a5.x + (a5.y - a5.x) * tau;
      float cut = a5.z + (a4.w - a5.z) * tau;
      float cutS = (cut != 0.0 && ((u >= 0.0) == (cut > 0.0))) ? min(1.0, abs(cut)) : 0.0;
      float kap = kap0 * (1.0 - cutS);
      float au = abs(u), ea = au - wf;
      float depth, arc;
      if (ea <= 0.0 || kap < 1e-4) { depth = -v; arc = au; }
      else {
        float R = 1.0 / kap;
        float rr = sqrt(ea * ea + (v - R) * (v - R));
        depth = (ea * ea + v * v - 2.0 * v * R) / (rr + R);
        arc = wf + R * atan(ea, R - v);
      }
      // Distance to this band's material (approximate, kept conservative) for ray stepping.
      float dv = max(abs(depth - 0.5 * T) - 0.5 * T, 0.0);
      float du = max(arc - w, 0.0) * (kap > 0.005 ? 0.6 : 1.0);
      gBrSafe = min(gBrSafe, 0.8 * max(sqrt(du * du + dv * dv) - slack, 0.0));
      if (depth <= 0.0 || depth >= T) continue;
      float prof = smoothstep(0.0, uBrSoft, depth) * smoothstep(0.0, uBrSoft, T - depth);
      float fadeW = min(0.25 * w, max(3.0, 0.25 * w - 0.4 * wf));
      float lat = 1.0 - smoothstep(w - fadeW, w, arc);
      rho = uBrDensity * prof * lat * pres * bfade;
      kapE = kap; wfE = wf;
    }
    if (rho > best) { best = rho; gBrTan = Tg; gBrFlow = a4.z; gBrCls = float(L); gBrCurl = kapE * (w - wfE); gBrTier = a5.w; gBrTags = a6.w; gBrFoam = gWFoam; gBrWave = gWWave; }
  }
  return best;
}
`;
