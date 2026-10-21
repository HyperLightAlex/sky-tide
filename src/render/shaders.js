// Shaders: the sky pass (water clouds + trapar), composite, final tone map, debug slice,
// and trapar motes.
//
// Visual language:
//   clouds  white volumes lit by the sun, with self-shadowing (weather, not ridable)
//   trapar  translucent glowing skins on the ridable network (trunks teal; the smaller a root,
//           the bluer and brighter; cords paler), streaks that move with each stream's flow, a
//           faint inner glow, and streaming motes near you

import { SKY_GLSL } from '../sky/sky.js';

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// The sky's colour in a direction (also the haze everything fades into). Painted in bands, as a
// background artist would: deep blue overhead, a clean lighter blue below it, and a warm glow
// low on the horizon toward the sun, cooler and pinker on the far side; no muddy blend of the
// two. (Painted skies per time of day replace this later.)
export const SKY_COLOR_GLSL = /* glsl */ `
uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uAbyss, uSkyMid, uHorizonAnti;
vec3 skyColor(vec3 d) {
  float h = d.y;
  vec2 hz = normalize(d.xz + 1e-5), sz = normalize(uSunDir.xz + 1e-5);
  float toward = max(dot(hz, sz), 0.0);
  vec3 low = mix(uHorizonAnti, uHorizon, toward * toward * (3.0 - 2.0 * toward));
  vec3 c;
  if (h >= 0.0) {
    c = mix(uSkyMid, uZenith, smoothstep(0.06, 0.8, h));
    c = mix(c, low, pow(1.0 - smoothstep(0.0, 0.26, h), 1.8));
  } else c = mix(low, uAbyss, pow(clamp(-h, 0.0, 1.0), 0.32));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 1500.0) * 30.0 + pow(sd, 24.0) * 0.12 + pow(sd, 4.0) * 0.04);
  return c;
}
`;

const COMMON = /* glsl */ `
${SKY_COLOR_GLSL}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewRay(vec2 uv, mat4 projInv, mat4 camWorld) {
  vec4 vp = projInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize((camWorld * vec4(normalize(vp.xyz / vp.w), 0.0)).xyz);
}
`;

export const SKY_PASS_FRAG = /* glsl */ `
${SKY_GLSL}
${COMMON}
uniform sampler2D tDepth;
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uCamPos;
uniform int uSteps;
uniform float uExtinction, uFogDist, uRideThr, uBaseThr, uMaxDist, uMinT;
uniform vec2 uStepK;
uniform float uSkinOpacity, uSkinGlow, uStripes, uSwellHi, uInterior;
uniform float uOutline, uContours, uContourStep, uThin;
uniform vec3 uSkinA, uSkinB, uPlumeColor, uThinColor;
uniform vec3 uPulseOrigin;
uniform float uPulseRadius, uPulseStrength, uPulseWidth;
varying vec2 vUv;
// Second output: how far along the ray the clouds get thick (where what is behind them is 90%
// and 50% visible), so the translucent streams drawn after can be hidden by clouds in front;
// and, for painting the clouds (composite), how much sunlight reaches the cloud seen (0..1,
// before the phase) and how high in its layer it is (0 bottom, 1 top).
layout(location = 1) out highp vec4 pc_cloudDepth;
const float NO_CLOUD = 60000.0;

float hg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5);
}

void main() {
  vec3 rd = viewRay(vUv, uProjInv, uCamWorld);
  vec3 ro = uCamPos;
  float depth = texture2D(tDepth, vUv).r;
  float tEnd = uMaxDist;
  if (depth < 1.0) {
    vec4 sp = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    tEnd = min(tEnd, length(sp.xyz / sp.w));
  }
  float lo = min(uWxLo, uTrLo), hi = max(uWxHi, uTrHi);
  float t0 = 0.0, t1 = tEnd;
  if (abs(rd.y) > 1e-5) {
    float ta = (lo - ro.y) / rd.y, tb = (hi - ro.y) / rd.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = min(max(ta, tb), t1);
  } else if (ro.y < lo || ro.y > hi) {
    t1 = -1.0;
  }
  pc_cloudDepth = vec4(NO_CLOUD, NO_CLOUD, 0.0, 1.0);
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float t90 = NO_CLOUD, t50 = NO_CLOUD;
  float sumW = 0.0, sumL = 0.0, sumH = 0.0;

  float mu = dot(rd, uSunDir);
  float phase = mix(hg(mu, 0.6), hg(mu, -0.25), 0.35);
  vec3 fogCol = skyColor(rd);
  vec3 col = vec3(0.0);
  float T = 1.0;
  float t = t0 + clamp(t0 * 0.04, 1.5, 300.0) * ign(gl_FragCoord.xy);
  vec3 pPrev = ro + rd * t0;
  float prevTd = trDensityLite(pPrev);
  float entryT = prevTd >= uRideThr ? -1e9 : 1e9;   // where the ray last entered ridable trapar
  float wspan = max(uWxHi - uWxLo, 1.0);
  float emptyRun = 1.0;
  for (int i = 0; i < 512; i++) {
    if (i >= uSteps || t >= t1 || T < uMinT) break;   // (painted clouds need only the front: stop sooner)
    vec3 p = ro + rd * t;
    // Inside the trapar band, cap the step so thin layers are never stepped over.
#ifdef BR_DISABLE
    bool inTr = false;   // (no streams to find in this pass)
#else
    bool inTr = p.y > uTrLo && p.y < uTrHi;
#endif
    float dt = clamp(t * uStepK.x, uStepK.y, 300.0);   // (painted clouds step a little coarser)
    // Inside the trapar band, cap the step (streams are handled below by stepping only as far
    // as is safe from the nearest band).
    if (inTr) dt = min(dt, 30.0 + t * 0.03);
    float seg = min(dt, t1 - t);
    float fog = 1.0 - exp(-t / uFogDist);

    // --- Trapar ---
    float pl;
    float td = trDensityImpl(p, true, pl);
    float sw = gTrSwell;
    vec2 sFlow = gTrFlow;
    float sStr = gTrStream, sPool = gTrPool, sCls = gTrCls, sLayer = floor(gTrTier / 4.0 + 0.01), sTier = gTrTier - 4.0 * sLayer, sTags = gTrTags, sFoam = gTrFoam;
    float brSafe = gBrSafe; bool brIn = gBrInGrid; vec3 brMin = gBrCellMin, brMax = gBrCellMax;
    if (prevTd < uRideThr && td >= uRideThr) {
      // A ridable surface (at the rider's current threshold): bright, nearly solid, outlined,
      // with contour lines that show its shape and slope.
      float f = clamp((uRideThr - prevTd) / max(td - prevTd, 1e-4), 0.0, 1.0);
      vec3 ps = mix(pPrev, p, f);
      float ts = t - seg * (1.0 - f);
      float h = 2.0;
      vec3 g = vec3(trDensityLite(ps + vec3(h, 0, 0)) - trDensityLite(ps - vec3(h, 0, 0)),
                    trDensityLite(ps + vec3(0, h, 0)) - trDensityLite(ps - vec3(0, h, 0)),
                    trDensityLite(ps + vec3(0, 0, h)) - trDensityLite(ps - vec3(0, 0, h)));
      vec3 n = length(g) > 1e-5 ? -normalize(g) : vec3(0.0, 1.0, 0.0);
      float rim = 1.0 - abs(dot(n, rd));
      float edge = smoothstep(0.6, 0.97, rim);
      // Trunks teal; the smaller (and faster) a root, the bluer and brighter; cords paler.
      vec3 base = mix(uSkinA, uSkinB, rim * rim * 0.5 + 0.14 * sTier);
      base *= 1.0 + 0.08 * sTier;
      // Layers: the tangle a deeper green-teal, the crown paler and brighter; connectors
      // between layers by kind (updrafts warm gold, chutes violet, ramps pale).
      if (sLayer < 0.5) base *= vec3(0.78, 1.0, 0.86);
      else if (sLayer > 1.5 && sLayer < 2.5) base = mix(base, vec3(0.92, 1.0, 1.08) * length(base) * 0.62, 0.35);
      else if (sLayer > 2.5) {
        int tg = int(sTags + 0.5);
        vec3 acc = (tg & 256) != 0 ? vec3(1.0, 0.58, 0.1) : (tg & 512) != 0 ? vec3(0.62, 0.32, 1.0) : vec3(0.8, 0.88, 0.95);
        base = mix(base, acc, 0.85);
      }
      if (sCls > 2.5) base = mix(base, vec3(0.75, 1.0, 1.0), 0.25);
      vec2 q = ps.xz - uTrFlowOff;
      float stripe;
      if (sStr > 0.05) {
        // Streams: streaks that travel along each stream at its flow speed (a two-phase flow
        // map, so it follows curves without stretching).
        float fl = length(sFlow);
        vec2 fd = fl > 1e-5 ? sFlow / fl : uTrFlowDir;
        float fs = fl;
        const float PER = 5.0;
        float a1 = fract(uTrTime / PER), a2 = fract(uTrTime / PER + 0.5);
        vec2 q1 = (q - fd * fs * PER * a1) / 120.0, q2 = (q - fd * fs * PER * a2) / 120.0 + 0.37;
        float s1 = texture(uNoiseB, vec3(q1.x, ps.y / 300.0, q1.y)).r;
        float s2 = texture(uNoiseB, vec3(q2.x, ps.y / 300.0, q2.y)).r;
        float w1 = 1.0 - abs(2.0 * a1 - 1.0);
        stripe = smoothstep(0.3, 0.8, s1 * w1 + s2 * (1.0 - w1));
      } else stripe = 0.5 + 0.5 * sin(dot(q, uTrFlowDir) * 0.03);
      // Waves: crests paler and brighter, troughs deeper, so a stream reads as a train of
      // waves from far off (sw: wave height, about -1..1 on trunks, less on smaller streams).
      float crest = smoothstep(0.35, 1.0, sw);
      float spec = pow(max(dot(reflect(rd, n), uSunDir), 0.0), 40.0);
      float shade = exp(-wxCloud(ps + uSunDir * 150.0, false) * 1.5);
      float lit = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
      // Contour lines every uContourStep meters of height, kept about a pixel or two wide.
      float cy = ps.y / uContourStep;
      float fw = clamp(ts * 0.0016 / uContourStep, 0.015, 0.3);
      float fr = abs(fract(cy + 0.5) - 0.5);
      float line = (1.0 - smoothstep(fw * 0.5, fw, fr)) * (1.0 - smoothstep(1200.0, 2600.0, ts));
      // Sense pulse: a ring sweeping outward, leaving everything it passed brightened.
      float pd = length(ps - uPulseOrigin);
      float ring = (1.0 - smoothstep(0.0, uPulseWidth, abs(pd - uPulseRadius))) * uPulseStrength;
      float swept = (1.0 - smoothstep(uPulseRadius - 1.0, uPulseRadius, pd)) * uPulseStrength;
      vec3 c = base * uSkinGlow * lit * (0.7 + 0.3 * mix(1.0, stripe, uStripes)) * mix(0.6, 1.0, shade)
             + uSunColor * spec * 0.15 * shade;
      float wv = clamp(sw, -1.2, 1.2) * uSwellHi;
      c *= 1.0 + 0.4 * wv;
      c = mix(c, c * vec3(0.62, 0.85, 1.15), clamp(-wv, 0.0, 1.0) * 0.6);
      c = mix(c, vec3(0.85, 1.0, 1.0) * 1.3 * uSkinGlow * (0.75 + 0.35 * lit), crest * 0.4 * min(uSwellHi, 1.5));
      // White water (rapids, swell crests, slosh up a wall), boiling in place, broken up.
      float foam = 0.0;
      if (sFoam > 0.01) {
        float fnz = texture(uNoiseB, vec3(ps.x / 13.0, ps.y / 9.0 + uTrTime * 0.4, ps.z / 13.0)).r;
        float fnz2 = texture(uNoiseB, vec3(ps.x / 4.5 + 0.31, ps.y / 4.0 - uTrTime * 0.7, ps.z / 4.5)).r;
        foam = smoothstep(0.32, 0.72, sFoam * (0.45 + 0.75 * fnz + 0.35 * fnz2)) * (1.0 - smoothstep(900.0, 2200.0, ts));
        c = mix(c, vec3(0.95, 1.0, 1.0) * uSkinGlow * (0.75 + 0.35 * lit) * mix(0.7, 1.0, shade), foam * 0.85);
      }
      // Contour lines are drawn darker, like a topographic map, so the surface keeps its color.
      c *= 1.0 - 0.5 * line * min(uContours, 1.5);
      c += vec3(0.9, 1.0, 1.0) * (ring * 1.6 + swept * 0.35);
      float fogFade = max(1.0 - 0.8 * fog, ring + swept);
      float a = min(1.0, uSkinOpacity * (0.6 + 0.25 * rim) + line * 0.15 * uContours
                         + crest * 0.15 * uSwellHi + foam * 0.25 + ring * 0.6 + swept * 0.3) * smoothstep(1.5, 6.0, ts) * fogFade;
      col += T * c * a;
      T *= 1.0 - a * 0.75;
      entryT = ts;
    } else if (prevTd >= uRideThr && td < uRideThr) {
      // Leaving ridable trapar soon after entering it means the ray only clipped an edge:
      // a silhouette, a crest or the rim of a hole. Outline it.
      float through = t - entryT;
      float edgeLen = 18.0 + t * 0.02;
      if (through < edgeLen) {
        float k = (1.0 - through / edgeLen) * smoothstep(1.5, 6.0, t) * max(1.0 - 0.8 * fog, 0.0);
        col += T * vec3(0.8, 1.0, 0.95) * uSkinGlow * uOutline * 0.9 * k;
      }
    }
    if (td > 0.02) {
      // Ridable trapar glows teal from inside; thin trapar (not ridable now) is a dim blue haze.
      float ridable = smoothstep(0.85 * uRideThr, uRideThr, td);
      float ins = smoothstep(uRideThr, 1.8 * uRideThr, td);
      float thin = smoothstep(0.1 * uRideThr, 0.9 * uRideThr, td) * (1.0 - ridable);
      float thinVis = thin * smoothstep(0.35 * uRideThr, 0.8 * uRideThr, td);
      vec3 e = (uSkinA * ins * (1.0 + smoothstep(0.15, 0.9, sw) * uSwellHi) * 0.0015 * uInterior
              + uThinColor * thinVis * 0.0006 * uThin
              + uPlumeColor * pl * 0.0025 * uThin) * (1.0 - fog);
      col += T * e * seg;
      T *= exp(-td * uExtinction * mix(0.0, 0.12, ridable) * seg);
    }
    prevTd = td;
    pPrev = p;

    // --- Water clouds ---
    float cd = wxCloud(p, true);
    if (cd > 0.003) {
      emptyRun = 1.0;
      float sigma = cd * uExtinction;
      float l1 = wxCloud(p + uSunDir * 18.0, false);
      float l2 = wxCloud(p + uSunDir * 85.0, false);
      float l3 = wxCloud(p + uSunDir * 330.0, false);
      float tau = (l1 * 18.0 + l2 * 67.0 + l3 * 160.0) * uExtinction;
      float beer = max(exp(-tau), 0.22 * exp(-tau * 0.2));
      float powder = 1.0 - exp(-cd * 1.6);
      float hf = clamp((p.y - uWxLo) / wspan, 0.0, 1.0);
      vec3 amb = mix(uAbyss * 3.0 + uZenith * 0.12, uZenith * 0.55 + uHorizon * 0.18, hf);
      vec3 lit = uSunColor * beer * phase * mix(0.5, 1.0, powder) + amb;
      float segT = exp(-sigma * seg);
      col += T * mix(lit, fogCol, fog) * (1.0 - segT);
      float wgt = T * (1.0 - segT);
      sumW += wgt; sumL += wgt * beer * mix(0.5, 1.0, powder); sumH += wgt * hf;
      T *= segT;
    } else if (td < 0.02) {
      // Empty space: step faster (never past a thin layer inside the trapar band).
      dt = inTr ? max(dt, 6.0) : max(dt * 1.6 * emptyRun, 25.0);
      if (t > 450.0) emptyRun = min(emptyRun * 1.3, 5.0);   // (a long empty stretch far off: stride out further each step; near, keep the edges clean)
    }
    // Streams: never step past the nearest ribbon, nor out of this grid cell (the next cell
    // may list ribbons this one does not).
    if (brIn) {
      vec3 tb = (mix(brMin, brMax, step(0.0, rd)) - p) / (abs(rd) + 1e-6) * sign(rd + 1e-9);
      float tExit = max(min(min(tb.x, tb.y), tb.z), 0.0);
      dt = min(dt, min(max(brSafe, 0.8 + t * 0.0015), tExit + 0.5));
    }
    if (T < 0.9 && t90 >= NO_CLOUD) t90 = t;
    if (T < 0.5 && t50 >= NO_CLOUD) t50 = t;
    t += dt;
  }
  pc_cloudDepth = vec4(t90, t50, sumL / max(sumW, 1e-5), sumH / max(sumW, 1e-5));
  gl_FragColor = vec4(col, T);
}
`;

// Scene (or sky) with the sky pass over it, still linear HDR.
export const COMPOSITE_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tScene, tClouds, tCloudInfo;
uniform mat4 uProjInv, uCamWorld;
uniform vec2 uCloudTexel;
uniform float uFogDist, uCloudPaint, uCloudEdge, uCloudDbg;
uniform vec4 uCloudBands;
uniform vec3 uCamPos;
uniform sampler3D uNoiseB;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec3 rd = viewRay(vUv, uProjInv, uCamWorld);
  vec4 sc = texture2D(tScene, vUv);
  vec3 base = skyColor(rd) * (1.0 - clamp(sc.a, 0.0, 1.0)) + sc.rgb;
  // 3x3 tent filter over the low-res sky buffer (bilinear taps at offsets) hides ray jitter.
  vec2 o = uCloudTexel * 0.75;
  vec4 cl = texture2D(tClouds, vUv) * 0.36
          + (texture2D(tClouds, vUv + vec2(o.x, o.y)) + texture2D(tClouds, vUv + vec2(-o.x, o.y))
           + texture2D(tClouds, vUv + vec2(o.x, -o.y)) + texture2D(tClouds, vUv + vec2(-o.x, -o.y))) * 0.16;
  vec4 inf = texture2D(tCloudInfo, vUv);
  float cover = 1.0 - cl.a;
  vec3 phys = cl.rgb / max(cover, 1e-3);     // the cloud's own (physically lit) colour
  // Painted clouds: a clean silhouette where the cloud gets thick, thin wisps kept soft and
  // faint, and inside it five values blended with a soft brush rather than a gradient.
  // Shadows lean to the sky's blue, bottoms are darker, edges toward the sun light up.
  float w = max(fwidth(cover) * 0.9, 0.012) + uCloudEdge;
  float solid = smoothstep(0.3 - w, 0.3 + w, cover);
  float a = max(solid, cover * 0.45);
  if (cover < 0.004) { gl_FragColor = vec4(base, 1.0); return; }   // (no cloud here: most of the sky)
  float mu = dot(rd, uSunDir);
  // The shape of the cloud seen: its front surface rebuilt from where each ray met it (the sky
  // pass's cloud depth, a few texels apart), so each heap has a lit side and a shadow
  // side as a painter would give it. At the silhouette, the normal points outward.
  vec3 camR = vec3(uCamWorld[0][0], uCamWorld[0][1], uCamWorld[0][2]);
  vec3 camU = vec3(uCamWorld[1][0], uCamWorld[1][1], uCamWorld[1][2]);
  vec3 nrm = vec3(0.0);
  for (int k = 0; k < 1; k++) {
    vec2 tx = uCloudTexel * 3.5;
    vec2 uvL = vUv - vec2(tx.x, 0.0), uvR = vUv + vec2(tx.x, 0.0), uvD = vUv - vec2(0.0, tx.y), uvU = vUv + vec2(0.0, tx.y);
    float dL = texture2D(tCloudInfo, uvL).x, dR = texture2D(tCloudInfo, uvR).x;
    float dD = texture2D(tCloudInfo, uvD).x, dU = texture2D(tCloudInfo, uvU).x;
    vec3 nk;
    if (max(max(dL, dR), max(max(dD, dU), inf.x)) < 50000.0) {
      vec3 pL = viewRay(uvL, uProjInv, uCamWorld) * dL, pR = viewRay(uvR, uProjInv, uCamWorld) * dR;
      vec3 pD = viewRay(uvD, uProjInv, uCamWorld) * dD, pU = viewRay(uvU, uProjInv, uCamWorld) * dU;
      nk = normalize(cross(pR - pL, pU - pD) + 1e-6);
      if (dot(nk, rd) > 0.0) nk = -nk;
    } else {
      float cL = 1.0 - texture2D(tClouds, uvL).a, cR = 1.0 - texture2D(tClouds, uvR).a;
      float cD = 1.0 - texture2D(tClouds, uvD).a, cU = 1.0 - texture2D(tClouds, uvU).a;
      vec3 outw = -(camR * (cR - cL) + camU * (cU - cD));
      nk = normalize(outw * 4.0 - rd * 0.6 + 1e-6);
    }
    nrm += nk;
  }
  nrm = normalize(nrm + 1e-6);
  // Cauliflower: tilt the normal by a cellular noise at the surface, so the shading breaks
  // into rounded lobes.
  float bl = 0.5;
  if (inf.x < 50000.0) {
    vec3 cp = uCamPos + rd * inf.x;
    bl = texture(uNoiseB, cp / 700.0).r * 0.6 + texture(uNoiseB, cp / 220.0 + 0.3).r * 0.3 + texture(uNoiseB, cp / 70.0 + 0.6).r * 0.1;
    vec3 gb = vec3(texture(uNoiseB, cp / 420.0 + vec3(0.11, 0.0, 0.0)).r, texture(uNoiseB, cp / 420.0 + vec3(0.0, 0.23, 0.0)).r, texture(uNoiseB, cp / 420.0 + vec3(0.0, 0.0, 0.37)).r) - 0.5;
    nrm = normalize(nrm + gb * 0.45);
  }
  vec3 key = normalize(uSunDir + vec3(0.0, 0.35, 0.0));
  float shape = smoothstep(-0.35, 0.85, dot(nrm, key));
  float vol = clamp(inf.z / 0.38, 0.0, 1.3);               // light reaching it through the cloud
  float height = smoothstep(0.0, 0.65, inf.w);             // bases dark, tops bright
  float light = (0.45 * vol + 0.55 * shape) * mix(0.6, 1.1, height) * mix(0.9, 1.25, smoothstep(0.3, 0.95, mu));
  light += (bl - 0.5) * 0.4;
  // Five painted values, as in the reference: dark slate in the shadow core, slate, a light
  // blue-grey, the sunlit white and the hot white facing the sun. Shadows lean to the sky's
  // colour; the light ones to the sun's.
  vec3 sunN = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 1e-3));
  vec3 sunT = sunN * 1.6;
  vec3 dk = mix(vec3(0.11, 0.13, 0.19), uZenith * 0.8, 0.3);
  vec3 sl = mix(vec3(0.3, 0.34, 0.45), uSkyMid * 0.6, 0.3);
  vec3 lt = mix(vec3(0.72, 0.76, 0.85), sunN * 0.8, 0.25);
  vec3 litT = sunN * 1.45;
  float bw2 = 0.05;
  vec3 paint = dk;
  paint = mix(paint, sl, smoothstep(uCloudBands.x - bw2, uCloudBands.x + bw2, light));
  paint = mix(paint, lt, smoothstep(uCloudBands.y - bw2, uCloudBands.y + bw2, light));
  paint = mix(paint, litT, smoothstep(uCloudBands.z - bw2, uCloudBands.z + bw2, light));
  paint = mix(paint, sunT * 1.3, smoothstep(uCloudBands.w - bw2, uCloudBands.w + bw2, light));
  // Silver lining: the thin rim of a cloud against the sun is the brightest thing in it.
  float edge = smoothstep(0.4, 0.75, cover);
  paint = mix(paint, sunT * 1.25, (1.0 - edge) * smoothstep(0.3, 0.9, mu) * solid * 0.8);
  // Into the haze with distance.
  float d = inf.x < 50000.0 ? inf.x : 8000.0;
  float fog = 1.0 - exp(-d / uFogDist);
  paint = mix(paint, skyColor(rd), fog * 0.85);
  if (uCloudDbg > 0.5) {
    // Bands of the light value, in false colour: red < .2 < orange < .4 < yellow < .6 < green < .8 < cyan < 1 < blue.
    vec3 fc = light < 0.2 ? vec3(1, 0, 0) : light < 0.4 ? vec3(1, 0.5, 0) : light < 0.6 ? vec3(1, 1, 0) : light < 0.8 ? vec3(0, 1, 0) : light < 1.0 ? vec3(0, 1, 1) : vec3(0, 0, 1);
    gl_FragColor = vec4(mix(base, fc * 0.6, solid), 1.0); return;
  }
  vec3 cc = mix(phys, paint, uCloudPaint);
  float ca = mix(cover, a, uCloudPaint);
  gl_FragColor = vec4(base * (1.0 - ca) + cc * ca, 1.0);
}
`;

// Ink for the solid world (islands, rider), from its depth, before the sky goes behind it: an
// outline where it meets the sky, and lines at its creases (where the depth bends). Coloured
// lines, a deeper and cooler shade of the paint under them, fading with distance, as background
// artists drew them. (The rider's own contour is drawn on the model, cel.js; streams draw their
// own lines.)
export const INK_FRAG = /* glsl */ `
uniform sampler2D tScene, tDepth;
uniform vec2 uTexel;
uniform float uNear, uFar, uInk;
varying vec2 vUv;
float linDepth(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
void main() {
  vec4 sc = texture2D(tScene, vUv);
  float rawC = texture2D(tDepth, vUv).r;
  if (rawC < 1.0 && uInk > 0.0) {
    float rL = texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).r, rR = texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r;
    float rD = texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).r, rU = texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r;
    float dC = linDepth(rawC);
    float sil = step(0.99999, max(max(rL, rR), max(rD, rU)));
    float lap = (linDepth(rL) + linDepth(rR) + linDepth(rD) + linDepth(rU) - 4.0 * dC) / dC;
    float crease = smoothstep(0.012, 0.03, abs(lap)) * (1.0 - sil);
    float fade = 1.0 - smoothstep(250.0, 1400.0, dC);
    float ink = clamp(max(sil * 0.9, crease * 0.65) * fade * uInk, 0.0, 1.0);
    sc.rgb *= mix(vec3(1.0), vec3(0.32, 0.3, 0.42), ink);
  }
  gl_FragColor = sc;
}
`;

export const FINAL_FRAG = /* glsl */ `
uniform sampler2D tComp;
uniform float uExposure;
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec3 c = texture2D(tComp, vUv).rgb;
  c = aces(c * uExposure);
  c = pow(c, vec3(1.0 / 2.2));
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const SLICE_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SLICE_FRAG = /* glsl */ `
${SKY_GLSL}
uniform float uRideThr, uBaseThr, uMistMin;
uniform vec3 uRiderPos;
varying vec3 vWorld;
void main() {
  float pl;
  float rho = trDensityImpl(vWorld, true, pl);
  float sw = gTrSwell;
  float cd = wxCloud(vWorld, true);
  vec3 c = vec3(0.04, 0.05, 0.10);
  // Water clouds as a gray haze (not ridable).
  c = mix(c, vec3(0.45, 0.45, 0.5), clamp(cd * 0.35, 0.0, 0.6));
  if (rho > uMistMin) c = mix(vec3(0.10, 0.20, 0.45), vec3(0.35, 0.55, 0.95), clamp(rho / uRideThr, 0.0, 1.0));
  if (rho >= uRideThr) c = mix(vec3(0.6, 0.95, 0.9), vec3(0.9, 1.0, 0.98), clamp((rho - uRideThr) / 2.0, 0.0, 1.0));
  if (pl > 0.02) c = mix(c, vec3(0.55, 0.95, 1.0), pl * 0.6);
  if (rho >= uRideThr) c = mix(c, vec3(1.0, 0.85, 0.4), smoothstep(0.2, 1.0, sw) * 0.5);
  float w1 = max(fwidth(rho), 0.004);
  float l1 = 1.0 - smoothstep(0.0, w1 * 1.5, abs(rho - uRideThr));
  float l2 = 1.0 - smoothstep(0.0, w1 * 1.5, abs(rho - uBaseThr));
  c = mix(c, vec3(1.0, 0.72, 0.25), l2);
  c = mix(c, vec3(0.2, 1.0, 0.85), l1);
  float dr = length(vWorld - uRiderPos);
  c = mix(c, vec3(1.0, 0.35, 0.45), 1.0 - smoothstep(4.0, 6.0, dr));
  c = mix(c, vec3(1.0), (1.0 - smoothstep(0.0, 1.0, abs(dr - 9.0))) * 0.9);
  gl_FragColor = vec4(c, 1.0);
}
`;

// Trapar motes: points that live in the trapar medium's frame (so they stream with its flow),
// wrapped in a box around the camera, lit where trapar is present and rising in plumes.
export const MOTES_VERT = /* glsl */ `
${SKY_GLSL}
attribute vec4 aSeed;
uniform vec3 uCamPos;
uniform float uBox, uTime, uRideThr, uMistMin, uMotes, uUpdraft, uSize;
uniform vec3 uSkinA, uPlumeColor;
varying float vA;
varying vec3 vCol;
void main() {
  vec3 rel = aSeed.xyz * uBox + vec3(uTrFlowOff.x, 0.0, uTrFlowOff.y) - uCamPos;
  rel = mod(rel + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 wp = uCamPos + rel;
  float pl;
  float d = trDensityImpl(wp, true, pl);
  float crest = smoothstep(0.15, 0.9, gTrSwell);
  float life = 1.0;
  if (gTrStream > 0.02) {
    // In a stream, motes run along it: each one slides downstream over a short life and
    // fades in and out, so the stream visibly flows even where it curves.
    float fl = length(gTrFlow);
    vec2 fd = fl > 1e-5 ? gTrFlow / fl : vec2(1.0, 0.0);
    float fs = fl;
    float ph = fract(uTrTime / 4.0 + aSeed.w);
    rel.xz += fd * fs * 4.0 * (ph - 0.5);
    wp = uCamPos + rel;
    life = sin(3.14159265 * ph);
    d = min(d, trDensityImpl(wp, true, pl));
  }
  if (pl > 0.02) {
    rel.y = mod(rel.y + uTime * uUpdraft * 0.6 + 0.5 * uBox, uBox) - 0.5 * uBox;
    wp = uCamPos + rel;
  }
  float edge = 1.0 - smoothstep(0.3 * uBox, 0.5 * uBox, max(abs(rel.x), max(abs(rel.y), abs(rel.z))));
  float vis = smoothstep(uMistMin, uRideThr, d) * 0.06 + step(uRideThr, d) * 0.75;
  float tw = 0.6 + 0.4 * sin(uTime * (2.0 + 3.0 * aSeed.w) + aSeed.w * 40.0);
  vA = (vis * tw * (1.0 + crest * 1.5) * life + pl * 0.8) * edge * uMotes;
  vCol = mix(mix(uSkinA, uPlumeColor, clamp(pl * 2.0, 0.0, 1.0)), vec3(1.0, 0.9, 0.65), crest * 0.6);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_PointSize = vA > 0.004 ? clamp(uSize / -mv.z, 1.0, 5.0) : 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

export const MOTES_FRAG = /* glsl */ `
varying float vA;
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = dot(q, q) * 4.0;
  if (d > 1.0 || vA <= 0.004) discard;
  gl_FragColor = vec4(vCol * 2.0, vA * (1.0 - d));
}
`;
