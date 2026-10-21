// The trapar engine: the ridable medium.
//
// Trapar gathers into a root system of streams (see network.js): trunks (pairs of strands
// flowing opposite ways, each strand part of a loop round one face of a honeycomb), knots where
// three trunks meet, and roots, rootlets and tendrils filling each face, some of them round
// cords. Nothing else is ridable: the atmosphere (clouds, haze, wind) is weather, separate from
// trapar. The streams' courses are fixed; their surfaces move like water: swells, rollers and
// chop rolling downstream, slosh after bends, rapids (see waterAt in braids.js).
//
// Pure function of position, seed and parameters. IMPORTANT: _eval() must stay identical to
// TRAPAR_GLSL in trapar.glsl.js.

import { TAU, sst } from '../sky/common.js';
import { Braids, CLS, TAG } from './braids.js';

const TIER_NAMES = ['trunk', 'root', 'rootlet', 'tendril'];

export class Trapar {
  constructor(bank, params, weather) {
    this.P = params;
    this.weather = weather;
    this.S = {
      t: 0,
      uTrFlowOff: new Float32Array(2), uTrFlowDir: new Float32Array([1, 0]),
      uTrTime: 0,
      uTrLo: 0, uTrHi: 1000,
    };
    this.braids = new Braids(params);
    this._bi = {};
    // The first snapshot is built by the first update (or arrives from the worker first).
    this.S.uTrLo = 0; this.S.uTrHi = -1;
  }

  // The network does not drift (yet): its frame is the world frame.
  mediumOffset(y, t, out) { out.x = 0; out.y = 0; out.z = 0; return out; }
  mediumVelocity(y, t, out) { out.x = 0; out.y = 0; out.z = 0; return out; }

  // Height band the network occupies (all its layers, roots hanging below them).
  band() { const net = this.braids.net; net.sync(); return net.yRange(); }
  // Altitude of the main layer at (x, z) (where a rider starts).
  refAltitude(x = 0, z = 0) { const net = this.braids.net; net.sync(); return net.field(1, x, z); }
  // Islands near the box (see world/islands.js).
  islandsIn(x0, x1, z0, z1) { return this.braids.net.islandsIn(x0, x1, z0, z1); }
  // Typical height between routes worth climbing to within a layer (for boost suggestions).
  layerSpacing() { return 180; }

  update(t, focus) {
    const S = this.S;
    S.t = t;
    S.uTrTime = t % 20000;
    this.braids.update(t, focus);
    const BS = this.braids.S;
    S.uTrLo = BS.uBrOn ? BS.uBrLo - 10 : 0;
    S.uTrHi = BS.uBrOn ? BS.uBrHi + 10 : -1;
  }

  _eval(x, y, z, info) {
    const S = this.S;
    if (y < S.uTrLo || y > S.uTrHi) { if (info) info.rho = 0; return 0; }
    return this.braids.density(x, y, z, info);
  }

  density(x, y, z) { return this._eval(x, y, z, null); }

  // Full sample: density, flow (out.flow, velocity), flow direction and speed, the winning
  // band's class, its up (out.bandUp), its ridable face normal (out.face) and a feature name.
  sample(x, y, z, out) {
    if (!out.flowDir) out.flowDir = { x: 1, y: 0, z: 0 };
    if (!out.face) out.face = { x: 0, y: 1, z: 0 };
    if (!out.bandUp) out.bandUp = { x: 0, y: 1, z: 0 };
    if (!out.flow) out.flow = { x: 0, y: 0, z: 0 };
    const br = this._bi;
    out.rho = this._eval(x, y, z, br);
    out.flow.x = 0; out.flow.y = 0; out.flow.z = 0;
    out.flowSpeed = 0; out.stream = 0; out.cls = 0; out.tags = 0; out.tier = 0; out.layer = -1;
    out.surfV = 0; out.waterH = 0; out.swell = 0; out.rapids = 0; out.swellSlope = 0; out.swellSpeed = 0;
    out.waveK0 = 0; out.waveK1 = 0; out.waveK2 = 0;
    out.feature = 'none'; out.dominant = 'none';
    out.face.x = 0; out.face.y = 1; out.face.z = 0;
    out.bandUp.x = 0; out.bandUp.y = 1; out.bandUp.z = 0;
    out.swell = 0; out.chaos = 0;
    if (out.rho > 0) {
      const sg = br.flow < 0 ? -1 : 1, fs = Math.abs(br.flow);
      out.flowDir.x = br.tx * sg; out.flowDir.y = br.ty * sg; out.flowDir.z = br.tz * sg;
      out.flowSpeed = fs;
      // Flow fades in across the band's soft edge so it never jumps.
      const k = sst(0, 0.6, out.rho);
      out.flow.x = out.flowDir.x * fs * k; out.flow.y = out.flowDir.y * fs * k; out.flow.z = out.flowDir.z * fs * k;
      out.stream = sst(0.02, 0.3, out.rho);
      out.cls = br.cls; out.tags = br.tags; out.tier = (br.tier | 0) & 3; out.layer = (br.tier | 0) >> 2;
      out.face.x = br.fx; out.face.y = br.fy; out.face.z = br.fz;
      out.bandUp.x = br.ux; out.bandUp.y = br.uy; out.bandUp.z = br.uz;
      out.curl = br.curl;
      // Water: how fast the surface moves along the band's up, its offset, swell and rapids.
      out.surfV = br.hv || 0; out.waterH = br.h || 0; out.swell = br.swell || 0; out.rapids = br.rap || 0;
      out.swellSlope = br.hs || 0; out.swellSpeed = br.wc || 0;
      out.waveK0 = br.k0 || 0; out.waveK1 = br.k1 || 0; out.waveK2 = br.k2 || 0;
      out.dominant = 'stream';
      const tg = br.tags | 0;
      out.feature = br.cls === CLS.CORD ? 'cord'
        : tg & TAG.DOCK ? 'dock'
        : tg & TAG.UP ? (tg & TAG.SPIRAL ? 'spiral updraft' : 'updraft') : tg & TAG.CHUTE ? 'chute' : tg & TAG.RAMP ? 'ramp'
        : tg & TAG.RAPIDS ? 'rapids'
        : tg & TAG.BARREL ? 'barrel' : tg & TAG.PIPE ? 'pipe' : tg & TAG.SPIRAL ? 'spiral' : tg & TAG.TWIST ? 'twist'
        : tg & TAG.LANE ? 'lane' : tg & TAG.TWINE ? 'twine' : tg & TAG.KNOT ? 'knot' : tg & TAG.TIP ? 'tip'
        : TIER_NAMES[out.tier] || 'trunk';
    }
    return out;
  }

  gradient(x, y, z, h, g) {
    const inv = 1 / (2 * h);
    g.x = (this.density(x + h, y, z) - this.density(x - h, y, z)) * inv;
    g.y = (this.density(x, y + h, z) - this.density(x, y - h, z)) * inv;
    g.z = (this.density(x, y, z + h) - this.density(x, y, z - h)) * inv;
    return g;
  }

  // Every ridable top surface in a vertical column, top to bottom.
  findSkins(x, z, threshold, step = 4) {
    const S = this.S, skins = [];
    if (S.uTrHi <= S.uTrLo) return skins;
    let prev = this.density(x, S.uTrHi, z);
    for (let y = S.uTrHi - step; y >= S.uTrLo; y -= step) {
      const d = this.density(x, y, z);
      if (prev < threshold && d >= threshold) {
        let lo = y, hi = y + step;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) / 2;
          if (this.density(x, m, z) >= threshold) lo = m; else hi = m;
        }
        if (this.density(x, lo - 1.5, z) >= threshold) skins.push(hi);
      }
      prev = d;
    }
    return skins;
  }

  // Swell forecasts come back when swells act on the network.
  forecast() { return []; }
  swell() { return 0; }
}

export { TAU };
