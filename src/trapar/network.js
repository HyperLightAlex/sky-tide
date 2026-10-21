// The trapar network: three layers of root network stacked in the sky, and the vertical
// connectors between them.
//
// Each layer (layer.js) is a root system on its own rolling altitude field: trunk loops round
// the faces of a honeycomb, knots where trunks meet, roots filling each face. The fields keep
// the layers apart (about layerGap, never closer than layerMinGap) while letting them drift,
// roll and pinch together in places; a layer's roots stay on its side of the midline to its
// neighbors. Connectors (connectors.js) cross between neighboring layers everywhere.
//
// Everything is a pure function of the seed and the parameters, built on demand and cached.

import { sst, hashu } from '../sky/common.js';
import { Layer, LAYER_MUL, vnoise, smax } from './layer.js';
import { Connectors } from './connectors.js';

export { NET, CLS, TAG, TIER, LAYER_NAMES, frameAt } from './layer.js';

// The layers, their altitude fields, and the connectors between them.
export class Network {
  constructor(params) {
    this._P = params;
    this.layers = [0, 1, 2].map((li) => new Layer(this, li));
    this.conn = new Connectors(this);
    this._sig = ''; this._base = null;
    this._fc = new Map();
  }
  get P() { return this._P; }
  set P(v) { this._P = v; this._base = null; }

  signature() {
    const P = this.P;
    return [P.seed, P.netSpacing, P.netJitter, P.netBase, P.meanderAmp, P.trunkUndulation, P.bankMax,
      P.twinGap, P.twistRadius, P.twistChance, P.knotEye, P.knotCorner, P.knotLane,
      P.trunkFlow, P.rootFlow, P.rootletFlow, P.tendrilFlow,
      P.trunkWidth, P.trunkFloor, P.trunkWall, P.trunkThickness,
      P.rootWidth, P.rootFloor, P.rootletWidth, P.rootletFloor, P.tendrilWidth, P.tendrilFloor, P.rootWall, P.rootThickness,
      P.rootsPerFace, P.rootletsPerFace, P.tendrilsPerFace, P.rootSag, P.fuseChance, P.wrapChance, P.dropChance,
      P.cordChance, P.cordRadius, P.laneLength, P.helixRadius,
      P.pipeChance, P.pipeFloor, P.pipeRadius, P.pipeWall, P.barrelChance, P.barrelFloor, P.barrelRadius, P.barrelWall,
      P.spiralChance, P.spiralRadius, P.spiralClimb, P.corkscrewChance, P.gapChance, P.rapidsChance, P.gravity, P.floorAltitude,
      P.layersOn, P.layerGap, P.layerMinGap, P.layerPinch, P.layerRelief, P.layerJitter,
      P.connectorCell, P.connectorsPerCell, P.rampMix, P.updraftMix, P.spiralUpsMix, P.chuteMix, P.dropMix,
      P.cruiseSpeed, P.cruiseFromFlow, P.airDrag, P.terminalSpeed, P.fallGravity,
      P.islandsOn, P.islandChance, P.islandBetween, P.islandMin, P.islandMax].join('|');
  }

  sync() {
    const P = this.P, sig = this.signature();
    const changed = sig !== this._sig;
    if (changed || this._base !== P) {
      this._sig = sig; this._base = P;
      const seedH = hashu((Math.floor(P.seed) * 2654435761 + 977) >>> 0);
      this.seedH = seedH;
      if (changed) this._fc.clear();
      for (const L of this.layers) {
        const lp = Object.create(P), mul = LAYER_MUL[L.li];
        for (const k in mul) lp[k] = P[k] * mul[k];
        L._setup(lp, hashu((seedH + 7919 * L.li) >>> 0), changed);
      }
      this.conn._setup(Object.create(P), hashu((seedH + 104729) >>> 0), changed);
    }
    // Drop everything now and then (it is rebuilt on demand).
    let n = 0; for (const L of this.layers) n += L.cache.size;
    if (n > 6000) { for (const L of this.layers) L.cache.clear(); this.conn.cells.clear(); this.conn.cache.clear(); }
    if (this._fc.size > 80000) this._fc.clear();
    return sig;
  }

  // Which layers exist.
  get active() { return this.P.layersOn ? [0, 1, 2] : [1]; }
  layerOf(b) { return this.layers[b.layer]; }

  // Altitude of each layer's field at (x, z) (out[0..2]). The layers drift up and down
  // together, roll on their own, and pinch together in places (low and main in some, main and
  // crown in others), never closer than layerMinGap.
  fields(x, z, out) {
    // Cached on a 100 m grid and interpolated (the fields vary over kilometers).
    const C = 100, gx = Math.floor(x / C), gz = Math.floor(z / C), fx = x / C - gx, fz = z / C - gz;
    const a = this._fcell(gx, gz), b = this._fcell(gx + 1, gz), c = this._fcell(gx, gz + 1), d = this._fcell(gx + 1, gz + 1);
    for (let k = 0; k < 3; k++) out[k] = a[k] + (b[k] - a[k]) * fx + (c[k] - a[k]) * fz + (a[k] - b[k] - c[k] + d[k]) * fx * fz;
    return out;
  }
  _fcell(gx, gz) {
    const key = (gx + 100000) * 200003 + (gz + 100000);
    let v = this._fc.get(key);
    if (!v) { v = this._fieldsAt(gx * 100, gz * 100, new Float64Array(3)); this._fc.set(key, v); }
    return v;
  }
  _fieldsAt(x, z, out) {
    const P = this.P, s = this.seedH;
    const G = Math.max(0, P.layerGap), pin = Math.max(0, P.layerPinch), rel = Math.max(0, P.layerRelief), mg = Math.max(60, P.layerMinGap);
    const n = (sc, k) => 2 * vnoise(x / sc + k * 0.137, z / sc - k * 0.291, (s + k * 1013) >>> 0) - 1;
    const warp = rel * 110 * (n(17000, 1) + 1);
    const B1 = sst(0.55, 0.8, vnoise(x / 9000 + 3.1, z / 9000 + 7.7, (s + 2) >>> 0));
    const B2 = sst(0.55, 0.8, vnoise(x / 11000 + 5.3, z / 11000 + 1.9, (s + 3) >>> 0));
    // Each layer rolls on two scales: the tangle in tighter, lower swells, the crown in big
    // slow ones.
    const f0 = P.netBase + warp + rel * (95 * n(4500, 4) + 30 * n(1900, 7)) + pin * B1;
    let f1 = P.netBase + warp + G + rel * (135 * n(7000, 5) + 40 * n(2600, 8)) - pin * B1 + 0.7 * pin * B2;
    let f2 = P.netBase + warp + 2 * G + rel * (175 * n(10000, 6) + 50 * n(3400, 9)) - 0.7 * pin * B2;
    f1 = smax(f1, f0 + mg, 60); f2 = smax(f2, f1 + mg, 60);
    out[0] = f0; out[1] = f1; out[2] = f2;
    return out;
  }
  field(li, x, z) { return this.fields(x, z, this._fo || (this._fo = new Float64Array(3)))[li]; }

  // How low and high layer li's streams may reach at (x, z): the midlines to its neighbors.
  bounds(li, x, z) {
    const f = this.fields(x, z, this._fb || (this._fb = new Float64Array(3))), o = this._bo || (this._bo = {});
    o.lo = -Infinity; o.hi = Infinity;
    if (!this.P.layersOn) return o;
    if (li > 0) o.lo = (f[li - 1] + f[li]) / 2 + 6;
    if (li < 2) o.hi = (f[li] + f[li + 1]) / 2 - 6;
    return o;
  }
  // Bounds that hold everywhere in a box (for a quick test): the highest low bound and the
  // lowest high bound found on a coarse grid, padded.
  boundsBox(li, x0, x1, z0, z1) {
    if (!this.P.layersOn) return null;
    let loMax = -Infinity, hiMin = Infinity;
    const nx = Math.max(2, Math.ceil((x1 - x0) / 300) + 1), nz = Math.max(2, Math.ceil((z1 - z0) / 300) + 1);
    for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
      const B = this.bounds(li, x0 + ((x1 - x0) * a) / (nx - 1), z0 + ((z1 - z0) * c) / (nz - 1));
      loMax = Math.max(loMax, B.lo); hiMin = Math.min(hiMin, B.hi);
    }
    return { loMax: loMax + 25, hiMin: hiMin - 25 };
  }
  // Altitude range the network can occupy (for the density band).
  yRange() {
    const P = this.P, rel = Math.max(0, P.layerRelief), pin = Math.max(0, P.layerPinch);
    const lo = P.floorAltitude + 40;
    const top = P.netBase + 220 * rel + (P.layersOn ? 2 * Math.max(P.layerGap, P.layerMinGap) + 225 * rel + 2 * pin : P.layerGap + 175 * rel + pin) + 250;
    return { lo, hi: top };
  }

  // Islands near the box (all layers).
  islandsIn(x0, x1, z0, z1) {
    this.sync();
    const out = [];
    for (const li of this.active) for (const I of this.layers[li].islandsIn(x0, x1, z0, z1)) out.push(I);
    return out;
  }

  get stats() {
    const s = { tries: 0, built: 0, why: {} };
    for (const L of [...this.layers, this.conn]) {
      s.tries += L.stats.tries; s.built += L.stats.built;
      for (const k in L.stats.why) s.why[k] = (s.why[k] || 0) + L.stats.why[k];
    }
    return s;
  }

  bandsIn(x0, x1, z0, z1, fx = (x0 + x1) / 2, fz = (z0 + z1) / 2, rootRange = Infinity) {
    this.sync();
    const out = new Set();
    for (const li of this.active) this.layers[li].bandsIn(x0, x1, z0, z1, fx, fz, rootRange, out);
    if (this.P.layersOn) this.conn.bandsIn(x0, x1, z0, z1, fx, fz, rootRange, out);
    // Hosts that gained lanes since their walls were cut.
    for (const b of out) if (b.dirty) { this.layers[Math.min(2, Math.floor(b.layer))]._finalizeCut(b); b.dirty = false; }
    return [...out];
  }
}
