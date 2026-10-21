// The clouds as things, the way a background painter puts them in: cumulus heaps, a few
// flat stratus banks and the storms' towers, each one a painted card (render/cloudView.js) and
// a volume you can fly into (the card's silhouette turned round its upright, so the painting
// and the volume agree from every side).
//
// Heaps sit one to a cell of the moving air: they drift with the wind at their height, and
// each lives out a slow cycle (growing in, holding, thinning out) before the cell makes
// another. Everything is a function of the seed, the time and where the focus is, so the main
// thread, workers and tests all see the same sky. No three.js here.

import { PAINTED_SETS } from '../world/paintedSets.js';

const CELL = 1150;          // one heap at most per cell of moving air (m)
const RANGE = 11500;        // heaps kept within this of the focus (m)
const ST_CELL = 2300;       // stratus banks: their own, wider cells
const PERIOD = 840;         // seconds a heap lives, each cell on its own phase
const ROWS = 32;

const frac = (x) => x - Math.floor(x);
function hash(i, k, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(k, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const rnd = (h, n) => (hash(h, n, 0x9e37) & 0xffffff) / 0x1000000;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Cards by shape, for each painted set: towers (narrow), heaps, banks (wide); never the storm.
function sortCards(set) {
  const S = PAINTED_SETS[set];
  const cards = S.cards.map((c, i) => ({ i, a: c.aspect })).filter((c) => c.i !== S.anvil);
  return {
    tower: cards.filter((c) => c.a < 1.4).map((c) => c.i),
    heap: cards.filter((c) => c.a >= 1.2 && c.a < 1.8).map((c) => c.i),
    bank: cards.filter((c) => c.a >= 1.55).map((c) => c.i),
  };
}
const SETS = Object.keys(PAINTED_SETS);
const SHAPES = Object.fromEntries(SETS.map((n) => [n, sortCards(n)]));

/**
 * The painted set for the light now: Skytide's own for the time of day when it has been
 * made (tools/bg/build_painted.py), otherwise Zenith GP's (Meridian at golden hour, Helios
 * under a high sun).
 */
export function paintedSetFor(P) {
  const light = P.sunElevation < -3 ? 'night' : P.sunElevation < 28 ? 'golden' : 'midday';
  if (PAINTED_SETS[light]) return light;
  return light === 'midday' ? 'helios' : 'meridian';
}
/** The set whose storm card the storms use (the set's own, or Helios's). */
export function stormSetFor(P) {
  const s = paintedSetFor(P);
  return PAINTED_SETS[s].anvil != null ? s : 'helios';
}

export class CloudField {
  constructor(weather) {
    this.W = weather;
    this.list = [];          // { ax, az, y, W, H, layer, card: { helios, meridian }, life fns }
    this.storms = [];        // the storms' towers, rebuilt each update
    this.off = [{ x: 0, z: 0 }, { x: 0, z: 0 }];   // air drift: cumulus, stratus
    this.t = 0;
    this._fx = 1e9; this._fz = 1e9; this._ft = -1e9; this._sig = '';
    this._o = { x: 0, y: 0, z: 0 };
  }

  update(t, focus) {
    const W = this.W, P = W.P;
    this.t = t;
    const cuAlt = (P.cloudBase + P.cloudTop) / 2, stAlt = P.stratusAltitude;
    W.windOffset(cuAlt, t, this._o); this.off[0].x = this._o.x; this.off[0].z = this._o.z;
    W.windOffset(stAlt, t, this._o); this.off[1].x = this._o.x; this.off[1].z = this._o.z;
    // Storm towers follow the weather's living storms.
    this.storms.length = 0;
    const ss = stormSetFor(P), anvil = PAINTED_SETS[ss].anvil;
    for (const a of W.alive) {
      const C = PAINTED_SETS[ss].cards[anvil];
      const w = Math.max(900, a.R * 2.4);
      this.storms.push({ x: a.x, z: a.z, y: Math.max(0, P.cloudBase - 250), W: w, H: w / C.aspect, life: Math.min(1, a.amp), storm: true, card: { [ss]: anvil }, set: ss, mirror: (a.s && a.s.t0 ? (Math.floor(a.s.t0) & 1) : 0) });
    }
    // The heaps round the focus: rebuilt when the focus has moved through the air, or the
    // settings changed, or every few seconds (cells come and go).
    const sig = `${P.seed}|${P.cloudCover}|${P.cloudBase}|${P.cloudTop}|${P.stratusAmount}|${P.stratusAltitude}`;
    const ax = focus.x - this.off[0].x, az = focus.z - this.off[0].z;
    if (sig === this._sig && Math.hypot(ax - this._fx, az - this._fz) < 400 && Math.abs(t - this._ft) < 4) return;
    this._sig = sig; this._fx = ax; this._fz = az; this._ft = t;
    this._build(ax, az, focus.x - this.off[1].x, focus.z - this.off[1].z, t);
  }

  _build(ax, az, sx, sz, t) {
    const P = this.W.P, seed = Math.floor(P.seed) >>> 0;
    const out = this.list; out.length = 0;
    const n = Math.ceil(RANGE / CELL);
    const ci = Math.floor(ax / CELL), ck = Math.floor(az / CELL);
    const cover = P.cloudCover;
    for (let i = ci - n; i <= ci + n; i++) for (let k = ck - n; k <= ck + n; k++) {
      const h0 = hash(i, k, seed * 31 + 5);
      const ph = rnd(h0, 1);
      const epoch = Math.floor(t / PERIOD + ph);
      const h = hash(h0, epoch, 77);
      const x = (i + 0.15 + 0.7 * rnd(h, 2)) * CELL, z = (k + 0.15 + 0.7 * rnd(h, 3)) * CELL;
      if (Math.hypot(x - ax, z - az) > RANGE) continue;
      // More heaps where the pressure is low (the weather's own pattern), more with the cover.
      const press = this.W.pressure(x + this.off[0].x, z + this.off[0].z);
      const p = Math.min(0.92, Math.max(0, 0.12 + 1.4 * cover + (0.5 - press) * 0.7));
      if (rnd(h, 4) > p) continue;
      const kind = rnd(h, 5);
      const shape = kind < 0.16 ? 'tower' : kind < 0.62 ? 'heap' : 'bank';
      const size = shape === 'tower' ? 800 + 600 * rnd(h, 6) : shape === 'heap' ? 420 + 420 * rnd(h, 6) : 260 + 340 * rnd(h, 6);
      const card = this._cards(shape, h);
      out.push({ ax: x, az: z, y: P.cloudBase + rnd(h, 8) * 90, W: size, layer: 0, card, ph, mirror: rnd(h, 9) < 0.5 ? 1 : 0, squash: 1, id: h });
    }
    // Stratus banks: wide and flat, at their own height.
    if (P.stratusAmount > 0.01) {
      const m = Math.ceil(RANGE / ST_CELL);
      const si = Math.floor(sx / ST_CELL), sk = Math.floor(sz / ST_CELL);
      for (let i = si - m; i <= si + m; i++) for (let k = sk - m; k <= sk + m; k++) {
        const h0 = hash(i, k, seed * 17 + 9);
        const ph = rnd(h0, 1);
        const h = hash(h0, Math.floor(t / (PERIOD * 1.5) + ph), 91);
        if (rnd(h, 4) > P.stratusAmount * 0.9) continue;
        const x = (i + 0.2 + 0.6 * rnd(h, 2)) * ST_CELL, z = (k + 0.2 + 0.6 * rnd(h, 3)) * ST_CELL;
        if (Math.hypot(x - sx, z - sz) > RANGE) continue;
        const card = this._cards('bank', h);
        out.push({ ax: x, az: z, y: P.stratusAltitude - P.stratusThickness, W: 700 + 900 * rnd(h, 6), layer: 1, card, ph, mirror: rnd(h, 9) < 0.5 ? 1 : 0, squash: 0.32, id: h, period: PERIOD * 1.5 });
      }
    }
    this.version = (this.version || 0) + 1;
  }

  // A card of this shape from every set (so a cloud keeps its shape when the light changes).
  _cards(shape, h) {
    const out = {};
    SETS.forEach((n, k) => {
      const L = SHAPES[n][shape].length ? SHAPES[n][shape] : SHAPES[n].heap;
      out[n] = L[Math.floor(rnd(h, 11 + k) * L.length) % L.length];
    });
    return out;
  }

  /** Which painted set the sky uses now. */
  set() { return paintedSetFor(this.W.P); }

  /**
   * A cloud's state now: where (world), how big, and how far through its life (0..1, the
   * size), and how solid (fading in at birth and out at the end).
   */
  state(c, out = {}) {
    if (c.storm) {
      out.x = c.x; out.z = c.z; out.y = c.y; out.W = c.W * (0.6 + 0.4 * c.life); out.H = c.H * (0.6 + 0.4 * c.life);
      out.alpha = sst(0, 0.25, c.life); out.set = c.set; out.card = c.card[c.set]; out.mirror = c.mirror; out.c = c;
      return out;
    }
    const o = this.off[c.layer];
    const per = c.period || PERIOD;
    const phase = frac(this.t / per + c.ph);
    const life = Math.pow(Math.sin(Math.PI * phase), 0.5);
    const set = this.set(), C = PAINTED_SETS[set].cards[c.card[set]];
    out.x = c.ax + o.x; out.z = c.az + o.z; out.y = c.y;
    out.W = c.W * (0.55 + 0.45 * life);
    out.H = (out.W / C.aspect) * c.squash;
    out.alpha = sst(0.02, 0.3, life);
    out.card = c.card[set]; out.set = set; out.mirror = c.mirror; out.c = c;
    return out;
  }

  /**
   * Signed distance (about; metres) from a point to a cloud's volume: the card's silhouette
   * turned round its upright, on its flat base. Negative inside.
   */
  sdf(s, x, y, z) {
    const C = PAINTED_SETS[s.set].cards[s.card];
    const dy = y - s.y;
    const h01 = dy / s.H;
    const d = Math.hypot(x - s.x, z - s.z);
    let hw = 0;
    if (h01 > 0 && h01 < 1) {
      const f = h01 * ROWS - 0.5, i = Math.max(0, Math.min(ROWS - 1, Math.floor(f))), j = Math.min(ROWS - 1, i + 1), u = Math.min(1, Math.max(0, f - i));
      hw = (C.hw[i] * (1 - u) + C.hw[j] * u) * s.W;
    }
    const top = s.H - dy;
    return Math.max(d - hw, -dy, -top);
  }

  /** Every cloud now, with its state (for drawing). */
  each(fn) {
    const s = this._s || (this._s = {});
    for (const c of this.list) fn(this.state(c, s));
    for (const c of this.storms) fn(this.state(c, s));
  }

  /** The nearest cloud surface to a point: { d (signed), s (that cloud's state) }. */
  nearest(x, y, z, out = { d: Infinity, s: null }) {
    out.d = Infinity; out.s = null;
    const s = this._n || (this._n = {});
    const test = (c) => {
      // (cheap rejection first, before working out the cloud's state)
      if (!c.storm) {
        const o = this.off[c.layer];
        if (Math.hypot(x - c.ax - o.x, z - c.az - o.z) - c.W * 0.6 > out.d) return;
      }
      this.state(c, s);
      if (s.alpha < 0.05) return;
      const r = Math.hypot(x - s.x, z - s.z) - s.W * 0.6;
      if (r > out.d || y < s.y - out.d || y > s.y + s.H + out.d) return;
      const d = this.sdf(s, x, y, z);
      if (d < out.d) { out.d = d; out.s = Object.assign(out.s || {}, s); }
    };
    for (const c of this.list) test(c);
    for (const c of this.storms) test(c);
    return out;
  }

  /** Cloud density at a point (the old field's scale: turbulence, the HUD). */
  density(x, y, z) {
    const n = this.nearest(x, y, z, this._d || (this._d = { d: Infinity, s: null }));
    if (!n.s || n.d > 0) return 0;
    return this.W.P.cloudDensity * sst(0, 45, -n.d) * n.s.alpha * (n.s.c.storm ? 1.4 : 1);
  }
}
