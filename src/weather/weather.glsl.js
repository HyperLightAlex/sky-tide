// GLSL mirror of Weather.fieldCloud() and Weather.pressure(). Keep in lockstep with weather.js.

import { WX_TILE, MAX_STORMS } from './weather.js';

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const WEATHER_UNIFORMS = [
  'uWxPressOff', 'uWxCuOff', 'uWxCuBase', 'uWxCuTop', 'uWxCuThr', 'uWxCuDensity',
  'uWxStOff', 'uWxStAlt', 'uWxStThick', 'uWxStThr', 'uWxStDensity',
  'uWxStormCount', 'uWxStormPos', 'uWxStormAmp', 'uWxStormRad', 'uWxStormBase', 'uWxStormTop', 'uWxStormDensity',
  'uWxDetailOff', 'uWxDetail', 'uWxLo', 'uWxHi',
];

// Requires: uNoiseA, uNoiseB, uNoiseC samplers declared (see NOISE_GLSL in sky.js).
export const WEATHER_GLSL = /* glsl */ `
#define WX_MAX_STORMS ${MAX_STORMS}
#define WX_T_PRESS ${f(WX_TILE.pressure)}
#define WX_T_CU ${f(WX_TILE.cumulus)}
#define WX_T_ST ${f(WX_TILE.stratus)}
#define WX_T_DETAIL ${f(WX_TILE.detail)}
#define WX_T_STORM ${f(WX_TILE.storm)}
uniform vec3 uWxPressOff;
uniform vec3 uWxCuOff;
uniform float uWxCuBase, uWxCuTop, uWxCuThr, uWxCuDensity;
uniform vec3 uWxStOff;
uniform float uWxStAlt, uWxStThick, uWxStThr, uWxStDensity;
uniform int uWxStormCount;
uniform vec2 uWxStormPos[WX_MAX_STORMS];
uniform float uWxStormAmp[WX_MAX_STORMS];
uniform float uWxStormRad[WX_MAX_STORMS];
uniform float uWxStormBase, uWxStormTop, uWxStormDensity;
uniform vec3 uWxDetailOff;
uniform float uWxDetail, uWxLo, uWxHi;

float wxPressure(vec2 xz) {
  float g = texture(uNoiseC, vec3(xz.x / WX_T_PRESS + uWxPressOff.x, uWxPressOff.y, xz.y / WX_T_PRESS + uWxPressOff.z)).g;
  return smoothstep(0.25, 0.75, g);
}

float wxStormNear(vec2 xz) {
  float c = 0.0;
  for (int i = 0; i < WX_MAX_STORMS; i++) {
    if (i >= uWxStormCount) break;
    float d = length(xz - uWxStormPos[i]);
    float R = uWxStormRad[i];
    c += uWxStormAmp[i] * (1.0 - smoothstep(0.6 * R, 1.4 * R, d));
  }
  return c;
}

float wxCloud(vec3 p, bool full) {
#ifdef WX_NO_CLOUDS
  return 0.0;   // (the clouds are painted cards now: render/cloudView.js)
#endif
  float y = p.y;
  if (y < uWxLo || y > uWxHi) return 0.0;
  float press = wxPressure(p.xz);
  float rho = 0.0;
  if (y > uWxCuBase && y < uWxCuTop) {
    float a = texture(uNoiseA, p / WX_T_CU + uWxCuOff).r;
    float env = smoothstep(uWxCuBase, uWxCuBase + 60.0, y) * (1.0 - smoothstep(uWxCuTop - 350.0, uWxCuTop, y));
    // Heaps: broad flat bases narrowing to rounded tops (cumulus), not even slabs.
    float hf = (y - uWxCuBase) / max(uWxCuTop - uWxCuBase, 1.0);
    float cov = a * env + (press - 0.5) * 0.35 + 0.05 - 0.2 * hf * hf;
    rho += uWxCuDensity * smoothstep(uWxCuThr, uWxCuThr + 0.12, cov);
  }
  float dy = abs(y - uWxStAlt);
  if (uWxStDensity > 0.0 && dy < uWxStThick) {
    float c = texture(uNoiseC, vec3(p.x / WX_T_ST + uWxStOff.x, uWxStOff.y, p.z / WX_T_ST + uWxStOff.z)).r;
    float env = 1.0 - smoothstep(uWxStThick * 0.3, uWxStThick, dy);
    rho += uWxStDensity * smoothstep(uWxStThr, uWxStThr + 0.1, c) * env;
  }
  float hy0 = (y - uWxStormBase) / (uWxStormTop - uWxStormBase);
  if (hy0 > 0.0 && hy0 < 1.0) {
    float st = 0.0;
    for (int i = 0; i < WX_MAX_STORMS; i++) {
      if (i >= uWxStormCount) break;
      float d = length(p.xz - uWxStormPos[i]);
      float Rr = uWxStormRad[i] * (0.45 + 0.25 * hy0 + 0.9 * smoothstep(0.75, 1.0, hy0));
      if (d >= Rr) continue;
      st += uWxStormAmp[i] * (1.0 - smoothstep(0.4 * Rr, Rr, d)) * smoothstep(0.0, 0.06, hy0) * (1.0 - smoothstep(0.9, 1.0, hy0));
    }
    if (st > 0.0) {
      float a = texture(uNoiseA, p / WX_T_STORM + uWxCuOff).r;
      rho += uWxStormDensity * st * (0.25 + 1.2 * smoothstep(0.3, 0.75, a));
    }
  }
  if (full && rho > 0.001 && uWxDetail > 0.001) {
    float dn = texture(uNoiseB, p / WX_T_DETAIL + uWxDetailOff).r;
    rho = max(0.0, rho - uWxDetail * (1.0 - dn) * 0.9);
  }
  return rho;
}
`;
