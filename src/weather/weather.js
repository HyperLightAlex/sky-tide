// The weather engine: wind, water clouds and storms.
//
// Weather is scenery and conditions. Clouds do not hold a rider; they block sight and
// shake you. Weather matters to trapar in three ways (see trapar.js): its wind pushes
// trapar, its storms generate trapar swells that travel far beyond them, and its large-scale
// pressure pattern nudges where trapar sheets are thick or thin.
//
// Like trapar, weather is a pure function of position, time, seed and parameters, plus a
// list of manually spawned storms. Storm cells are scheduled deterministically on a
// drifting grid, so every client sees the same storms.
//
// IMPORTANT: cloud() must stay identical to WEATHER_GLSL in weather.glsl.js.

import { sampleVolume, mulberry32 } from '../sky/noise.js';
import { TAU, DEG, frac, sst, cellHash3, lo16, hi16 } from '../sky/common.js';
import { CloudField } from './cloudField.js';

export const WX_TILE = { pressure: 16000, cumulus: 2600, stratus: 5200, detail: 420, turb: 260, storm: 3200 };
export const MAX_STORMS = 6;
export const STORM_EPOCH = 900;          // seconds per storm-scheduling slot per cell
const GUST_PERIOD = 45;
const REF_ALT = 800;                       // wind veer and shear are measured from here

export class Weather {
  constructor(bank, params) {
    this.A = bank.A; this.B = bank.B; this.C = bank.C;
    this.P = params;
    this._seed = null;
    this._a = [0, 0]; this._b = [0]; this._c = [0, 0];
    this._cache = new Map(); this._cacheSig = '';
    this._nearT = -1e9; this._nearX = 0; this._nearZ = 0; this._near = [];
    this.manual = [];      // spawned storms: { fx, fz, t0, D, I, R, manual: true }
    this.alive = [];       // storms currently alive near the focus (for clouds and near-field effects)
    this.S = {
      t: 0,
      uWxPressOff: new Float32Array(3),
      uWxCuOff: new Float32Array(3), uWxCuBase: 500, uWxCuTop: 1300, uWxCuThr: 0.7, uWxCuDensity: 1.6,
      uWxStOff: new Float32Array(3), uWxStAlt: 950, uWxStThick: 50, uWxStThr: 0.6, uWxStDensity: 1,
      uWxStormCount: 0,
      uWxStormPos: new Float32Array(MAX_STORMS * 2),
      uWxStormAmp: new Float32Array(MAX_STORMS),
      uWxStormRad: new Float32Array(MAX_STORMS),
      uWxStormBase: 250, uWxStormTop: 1700, uWxStormDensity: 2.2,
      uWxDetailOff: new Float32Array(3), uWxDetail: 0.4,
      uWxLo: 0, uWxHi: 2000,
    };
    this.field = new CloudField(this);   // the clouds as painted heaps you can fly into
    this.update(0, { x: 0, z: 0 });
  }

  _reseed() {
    const seed = Math.floor(this.P.seed) >>> 0;
    const r = mulberry32(seed * 104729 + 3);
    this.sv = { press: [r(), r(), r()], cu: [r(), r(), r()], st: [r(), r(), r()], detail: [r(), r(), r()], gust: r() * TAU, turb: [r(), r(), r()] };
    this.stormSeed = (seed * 2246822519 + 7) >>> 0;
    this._seed = this.P.seed;
  }

  // Mean wind (no gust) at altitude y, as m/s.
  windMean(y, out) {
    const P = this.P;
    const h = (y - REF_ALT) / 1000;
    const ang = (P.windDir + P.windVeer * h) * DEG;
    const spd = Math.max(0, P.windSpeed * (1 + P.windShear * h));
    out.x = Math.cos(ang) * spd; out.z = Math.sin(ang) * spd;
    return out;
  }

  // Wind velocity at altitude y and time t (mean plus a rotating gust). out.y is 0.
  windAt(y, t, out) {
    this.windMean(y, out);
    const om = TAU / GUST_PERIOD, ph = this.sv.gust + y * 0.002, g = this.P.gust;
    out.x += g * Math.cos(om * t + ph); out.z += g * Math.sin(om * t + ph); out.y = 0;
    return out;
  }

  // Closed-form drift of air at altitude y since time 0 (integral of windAt).
  windOffset(y, t, out) {
    this.windMean(y, out);
    const om = TAU / GUST_PERIOD, ph = this.sv.gust + y * 0.002, g = this.P.gust;
    out.x = out.x * t + (g / om) * (Math.sin(om * t + ph) - Math.sin(ph));
    out.z = out.z * t - (g / om) * (Math.cos(om * t + ph) - Math.cos(ph));
    out.y = 0;
    return out;
  }

  stormAltitude() { return (this.P.cloudBase + this.P.cloudTop) / 2; }

  // Storms whose frame position is within radius of (x, z) and that started within maxAge
  // seconds before t (or have not started yet, up to one epoch ahead).
  stormsAround(x, z, t, radius, maxAge, out = []) {
    const P = this.P;
    out.length = 0;
    const off = this.windOffset(this.stormAltitude(), t, { x: 0, y: 0, z: 0 });
    const fx = x - off.x, fz = z - off.z;
    if (P.stormFrequency > 0.0001) {
      const SS = Math.max(1000, P.stormSpacing);
      const cr = Math.ceil(radius / SS) + 1;
      const ci0 = Math.floor(fx / SS), ck0 = Math.floor(fz / SS);
      const e0 = Math.floor((t - maxAge) / STORM_EPOCH) - 1, e1 = Math.floor(t / STORM_EPOCH);
      for (let e = e0; e <= e1; e++) {
        for (let dk = -cr; dk <= cr; dk++) {
          for (let di = -cr; di <= cr; di++) {
            const s = this._storm(ci0 + di, ck0 + dk, e);
            if (!s) continue;
            if (s.t0 > t || t - s.t0 > maxAge + s.D) continue;
            if (Math.hypot(s.fx - fx, s.fz - fz) > radius) continue;
            out.push(s);
          }
        }
      }
    }
    for (const m of this.manual) {
      if (m.t0 > t || t - m.t0 > maxAge + m.D) continue;
      if (Math.hypot(m.fx - fx, m.fz - fz) > radius) continue;
      out.push(m);
    }
    return out;
  }

  _storm(ci, ck, e) {
    const P = this.P;
    const sig = `${this.stormSeed}|${P.stormFrequency}|${P.stormSpacing}|${P.stormDuration}|${P.stormIntensity}|${P.stormRadius}`;
    if (sig !== this._cacheSig || this._cache.size > 20000) { this._cache = new Map(); this._cacheSig = sig; }
    const key = `${ci},${ck},${e}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const s = this._makeStorm(ci, ck, e);
    this._cache.set(key, s);
    return s;
  }

  _makeStorm(ci, ck, e) {
    const P = this.P;
    const h = cellHash3(ci + 32768, ck + 32768, e + 1048576, this.stormSeed);
    if (lo16(h) >= P.stormFrequency) return null;
    const hA = cellHash3(ci, ck, e, h), hB = cellHash3(ck, e, ci, hA), hC = cellHash3(e, ci, ck, hB);
    const SS = Math.max(1000, P.stormSpacing);
    const D = Math.max(20, P.stormDuration * (0.7 + 0.6 * lo16(hB)));
    return {
      id: `${ci},${ck},${e}`,
      fx: (ci + 0.15 + 0.7 * lo16(hA)) * SS,
      fz: (ck + 0.15 + 0.7 * hi16(hA)) * SS,
      D,
      t0: e * STORM_EPOCH + hi16(hB) * Math.max(0, STORM_EPOCH - D),
      I: P.stormIntensity * (0.6 + 0.8 * lo16(hC)),
      R: P.stormRadius * (0.75 + 0.5 * hi16(hC)),
      manual: false,
    };
  }

  // World position of a storm at time t (storms ride the wind at storm altitude).
  stormPos(s, t, out) {
    const o = this.windOffset(this.stormAltitude(), t, out);
    out.x = s.fx + o.x; out.z = s.fz + o.z; out.y = 0;
    return out;
  }

  // Spawn a storm centered at world (x, z) starting at time t.
  spawnStorm(x, z, t, opts = {}) {
    const o = this.windOffset(this.stormAltitude(), t, { x: 0, y: 0, z: 0 });
    const s = {
      id: `m${this.manual.length}-${t.toFixed(1)}`, fx: x - o.x, fz: z - o.z, t0: t,
      D: opts.D ?? this.P.stormDuration, I: opts.I ?? this.P.stormIntensity * 1.2, R: opts.R ?? this.P.stormRadius, manual: true,
    };
    this.manual.push(s);
    this._dirty = true;
    return s;
  }
  clearSpawned() { this.manual.length = 0; this._dirty = true; }

  // Recompute time-dependent state and the list of living storms near the focus.
  update(t, focus) {
    const P = this.P, S = this.S;
    if (P.seed !== this._seed) this._reseed();
    const sv = this.sv, ev = P.evolve;
    S.t = t;
    const tmp = { x: 0, y: 0, z: 0 };

    this.windOffset(REF_ALT, t, tmp);
    S.uWxPressOff[0] = frac((-tmp.x * 0.6) / WX_TILE.pressure + sv.press[0]);
    S.uWxPressOff[1] = frac(t * ev * 0.00045 + sv.press[1]);
    S.uWxPressOff[2] = frac((-tmp.z * 0.6) / WX_TILE.pressure + sv.press[2]);

    S.uWxCuBase = P.cloudBase; S.uWxCuTop = Math.max(P.cloudBase + 100, P.cloudTop);
    this.windOffset((S.uWxCuBase + S.uWxCuTop) / 2, t, tmp);
    S.uWxCuOff[0] = frac(-tmp.x / WX_TILE.cumulus + sv.cu[0]);
    S.uWxCuOff[1] = frac((-P.cloudRise * ev * t) / WX_TILE.cumulus + sv.cu[1]);
    S.uWxCuOff[2] = frac(-tmp.z / WX_TILE.cumulus + sv.cu[2]);
    S.uWxCuThr = 0.92 - 0.42 * P.cloudCover;
    S.uWxCuDensity = P.cloudDensity;
    S.uWxDetailOff[0] = frac(-tmp.x / WX_TILE.detail + sv.detail[0]);
    S.uWxDetailOff[1] = frac(t * ev * 0.003 + sv.detail[1]);
    S.uWxDetailOff[2] = frac(-tmp.z / WX_TILE.detail + sv.detail[2]);
    S.uWxDetail = P.cloudDetail;

    S.uWxStAlt = P.stratusAltitude; S.uWxStThick = Math.max(5, P.stratusThickness);
    this.windOffset(S.uWxStAlt, t, tmp);
    S.uWxStOff[0] = frac(-tmp.x / WX_TILE.stratus + sv.st[0]);
    S.uWxStOff[1] = frac(t * ev * 0.0008 + sv.st[1]);
    S.uWxStOff[2] = frac(-tmp.z / WX_TILE.stratus + sv.st[2]);
    S.uWxStThr = 0.85 - 0.5 * P.stratusAmount;
    S.uWxStDensity = P.stratusAmount > 0.001 ? P.cloudDensity * 0.7 : 0;

    // Living storms near the focus, nearest first.
    S.uWxStormBase = Math.max(0, P.cloudBase - 250); S.uWxStormTop = P.cloudTop + 450;
    S.uWxStormDensity = P.stormDensity;
    // The candidate list is refreshed a few times a second; positions and strengths every call.
    if (Math.abs(t - this._nearT) > 0.25 || Math.hypot(focus.x - this._nearX, focus.z - this._nearZ) > 300 || this._dirty) {
      this.stormsAround(focus.x, focus.z, t, P.stormVisibleRange + 2000, 0, this._near);
      this._nearT = t; this._nearX = focus.x; this._nearZ = focus.z; this._dirty = false;
    }
    const near = this._near;
    const alive = this.alive; alive.length = 0;
    for (const s of near) {
      const tau = t - s.t0;
      if (tau < 0 || tau > s.D) continue;
      const life = Math.sin((Math.PI * tau) / s.D) ** 2;
      const p = this.stormPos(s, t, { x: 0, y: 0, z: 0 });
      if (Math.hypot(p.x - focus.x, p.z - focus.z) > P.stormVisibleRange) continue;
      alive.push({ s, x: p.x, z: p.z, amp: s.I * life, R: s.R, d: Math.hypot(p.x - focus.x, p.z - focus.z) });
    }
    alive.sort((a, b) => a.d - b.d);
    if (alive.length > MAX_STORMS) alive.length = MAX_STORMS;
    S.uWxStormCount = alive.length;
    for (let i = 0; i < MAX_STORMS; i++) {
      const a = alive[i];
      S.uWxStormPos[i * 2] = a ? a.x : 0; S.uWxStormPos[i * 2 + 1] = a ? a.z : 0;
      S.uWxStormAmp[i] = a ? a.amp : 0; S.uWxStormRad[i] = a ? a.R : 1;
    }

    S.uWxLo = Math.min(S.uWxCuBase, S.uWxStAlt - S.uWxStThick, alive.length ? S.uWxStormBase : 1e9) - 10;
    S.uWxHi = Math.max(S.uWxCuTop, S.uWxStAlt + S.uWxStThick, alive.length ? S.uWxStormTop : -1e9) + 10;
    this.field.update(t, focus);
  }

  // Large-scale pressure pattern in [0, 1]. Shared with trapar (regional modulation).
  pressure(x, z) {
    const S = this.S, c = this._c;
    sampleVolume(this.C, x / WX_TILE.pressure + S.uWxPressOff[0], S.uWxPressOff[1], z / WX_TILE.pressure + S.uWxPressOff[2], c);
    return sst(0.25, 0.75, c[1]);
  }

  // Storm proximity: how strongly the near field of living storms reaches this point.
  stormNear(x, z) {
    const S = this.S;
    let c = 0;
    for (let i = 0; i < S.uWxStormCount; i++) {
      const d = Math.hypot(x - S.uWxStormPos[i * 2], z - S.uWxStormPos[i * 2 + 1]);
      const R = S.uWxStormRad[i];
      c += S.uWxStormAmp[i] * (1 - sst(0.6 * R, 1.4 * R, d));
    }
    return c;
  }

  // Water-cloud density (not ridable): inside the painted clouds' volumes (cloudField.js).
  // This is what shakes you and what the HUD reports.
  cloud(x, y, z) {
    return this.field.density(x, y, z);
  }

  // The old noise-field clouds (the GLSL wxCloud mirrors this), kept for the ray-marched
  // comparison view only.
  fieldCloud(x, y, z, full = true) {
    const S = this.S;
    if (y < S.uWxLo || y > S.uWxHi) return 0;
    const press = this.pressure(x, z);
    let rho = 0;
    if (y > S.uWxCuBase && y < S.uWxCuTop) {
      const a = this._a;
      sampleVolume(this.A, x / WX_TILE.cumulus + S.uWxCuOff[0], y / WX_TILE.cumulus + S.uWxCuOff[1], z / WX_TILE.cumulus + S.uWxCuOff[2], a);
      const env = sst(S.uWxCuBase, S.uWxCuBase + 60, y) * (1 - sst(S.uWxCuTop - 350, S.uWxCuTop, y));
      const cov = a[0] * env + (press - 0.5) * 0.35;
      rho += S.uWxCuDensity * sst(S.uWxCuThr, S.uWxCuThr + 0.12, cov);
    }
    const dy = Math.abs(y - S.uWxStAlt);
    if (S.uWxStDensity > 0 && dy < S.uWxStThick) {
      const c = this._c;
      sampleVolume(this.C, x / WX_TILE.stratus + S.uWxStOff[0], S.uWxStOff[1], z / WX_TILE.stratus + S.uWxStOff[2], c);
      const env = 1 - sst(S.uWxStThick * 0.3, S.uWxStThick, dy);
      rho += S.uWxStDensity * sst(S.uWxStThr, S.uWxStThr + 0.1, c[0]) * env;
    }
    const hy0 = (y - S.uWxStormBase) / (S.uWxStormTop - S.uWxStormBase);
    if (hy0 > 0 && hy0 < 1) {
      let st = 0;
      for (let i = 0; i < S.uWxStormCount; i++) {
        const d = Math.hypot(x - S.uWxStormPos[i * 2], z - S.uWxStormPos[i * 2 + 1]);
        const Rr = S.uWxStormRad[i] * (0.45 + 0.25 * hy0 + 0.9 * sst(0.75, 1, hy0));
        if (d >= Rr) continue;
        st += S.uWxStormAmp[i] * (1 - sst(0.4 * Rr, Rr, d)) * sst(0, 0.06, hy0) * (1 - sst(0.9, 1, hy0));
      }
      if (st > 0) {
        // Billow the storm tower with the cumulus noise so it reads as cloud, not a cylinder.
        const a = this._a;
        sampleVolume(this.A, x / WX_TILE.storm + S.uWxCuOff[0], y / WX_TILE.storm + S.uWxCuOff[1], z / WX_TILE.storm + S.uWxCuOff[2], a);
        rho += S.uWxStormDensity * st * (0.25 + 1.2 * sst(0.3, 0.75, a[0]));
      }
    }
    if (full && rho > 0.001 && S.uWxDetail > 0.001) {
      sampleVolume(this.B, x / WX_TILE.detail + S.uWxDetailOff[0], y / WX_TILE.detail + S.uWxDetailOff[1], z / WX_TILE.detail + S.uWxDetailOff[2], this._b);
      rho = Math.max(0, rho - S.uWxDetail * (1 - this._b[0]) * 0.9);
    }
    return rho;
  }

  // Turbulent acceleration (m/s²) inside clouds and near storms. CPU only.
  turbulence(x, y, z, t, out) {
    const P = this.P;
    const k = P.turbulence * (Math.min(1.5, this.cloud(x, y, z)) + 1.5 * Math.min(2, this.stormNear(x, z)));
    if (k <= 0.001) { out.x = out.y = out.z = 0; return out; }
    const b = this._b, T = WX_TILE.turb, sv = this.sv.turb, s = t * 0.35;
    sampleVolume(this.B, x / T + sv[0] + s, y / T, z / T, b); out.x = (b[0] - 0.5) * 2 * k;
    sampleVolume(this.B, x / T, y / T + sv[1] + s, z / T, b); out.y = (b[0] - 0.5) * 2 * k;
    sampleVolume(this.B, x / T, y / T, z / T + sv[2] + s, b); out.z = (b[0] - 0.5) * 2 * k;
    return out;
  }
}
