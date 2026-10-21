// Floating islands: solid landmasses in the sky you can land on, walk around and leave from.
//
// An island is a gently rolling top (its ground) over a rocky underside that hangs down to a
// point, with an irregular outline. Everything about it is a pure function of its spec (where,
// how big, a seed), so the physics, the network builder (which keeps streams clear of it and
// builds its docks, see Layer in trapar/layer.js) and the renderer all agree.
//
//   top(x, z)      ground height (hills, easing down to a rounded rim)
//   bottom(x, z)   underside height (deepest under the middle)
//   inside(...)    is a point in the rock
//
// Islands are placed per network face (layer.js: islandsOf): some sit in a layer, some between
// two layers.

import { TAU, sst, hashu } from '../sky/common.js';
import { mulberry32 } from '../sky/noise.js';

const NAME_A = ['Moss', 'Ash', 'Brine', 'Cinder', 'Dawn', 'Fern', 'Gale', 'Hollow', 'Iron', 'Kestrel', 'Lark', 'Mist',
  'North', 'Opal', 'Pike', 'Quill', 'Rook', 'Sable', 'Thorn', 'Umber', 'Vale', 'Wren', 'Yarrow', 'Cobalt', 'Drift',
  'Ember', 'Frost', 'Glimmer', 'Heron', 'Juniper', 'Kelp', 'Lumen', 'Marrow', 'Nettle', 'Osprey', 'Pebble'];
const NAME_B = ['reach', 'hold', 'stead', 'rock', 'crag', 'fold', 'mere', 'perch', 'rest', 'spire', 'shelf', 'knoll',
  'haven', 'tor', 'bluff', 'fell', 'watch', 'cairn'];

// Height of a dock stream's floor line above the ground it lies on (m): its ridable skin (about a
// meter under the floor line, where the density crosses the ride threshold) clears the ground.
export const DOCK_LIFT = 1.8;

export class Island {
  // spec: { li (layer, 0..2), kind ('layer' | 'between'), x, z, y (ground level), R (radius), seed }
  constructor(spec) {
    Object.assign(this, spec);
    const r = mulberry32(spec.seed >>> 0);
    this.id = spec.seed >>> 0;
    const R = this.R;
    // Outline: a wobbly circle.
    this.oa = []; this.op = [];
    let wob = 0;
    for (let k = 2; k <= 6; k++) { const a = (0.17 / Math.pow(k, 0.8)) * r(); this.oa.push(a); this.op.push(r() * TAU); wob += a; }
    this.Rmax = R * (1 + wob);
    // Hills: three crossing waves.
    this.H = 3 + 6 * r();
    this.hw = [];
    for (let k = 0; k < 3; k++) {
      const ang = r() * TAU, lam = 110 + 120 * r();
      this.hw.push({ cx: Math.cos(ang) * TAU / lam, cz: Math.sin(ang) * TAU / lam, ph: r() * TAU, a: this.H / 3 * (0.6 + 0.8 * r()) });
    }
    // Underside: deepest under the middle, with ridges round it.
    this.D = R * (0.55 + 0.5 * r());
    this.rk = 3 + Math.floor(r() * 4); this.rp = r() * TAU; this.ra = 0.12 + 0.12 * r();
    this.name = NAME_A[hashu(this.id) % NAME_A.length] + NAME_B[hashu(this.id ^ 0x9e3779b9) % NAME_B.length];
  }

  outline(th) {
    let f = 1;
    for (let k = 0; k < this.oa.length; k++) f += this.oa[k] * Math.sin((k + 2) * th + this.op[k]);
    return this.R * f;
  }
  // How far out from the middle (0) to the rim (1).
  rhat(x, z) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) return 0;
    return d / this.outline(Math.atan2(dz, dx));
  }
  _hills(x, z) {
    const lx = x - this.x, lz = z - this.z;
    let h = 0;
    for (const w of this.hw) h += w.a * Math.sin(lx * w.cx + lz * w.cz + w.ph);
    return h;
  }
  _top(x, z, rh) { return this.y + this._hills(x, z) * (1 - 0.6 * sst(0.7, 1, rh)) - 5 * sst(0.82, 1, rh); }
  _bottom(x, z, rh, top) {
    const th = Math.atan2(z - this.z, x - this.x);
    const deep = this.D * Math.pow(Math.max(0, 1 - rh * rh), 0.7) * (1 + this.ra * Math.sin(this.rk * th + this.rp) * (1 - rh));
    return Math.min(this.y - 2 - deep, top - 3);
  }
  // Ground height at (x, z), or null off the island.
  ground(x, z) {
    const rh = this.rhat(x, z);
    return rh <= 1 ? this._top(x, z, rh) : null;
  }
  top(x, z) { return this._top(x, z, Math.min(1, this.rhat(x, z))); }
  bottom(x, z) { const rh = Math.min(1, this.rhat(x, z)); return this._bottom(x, z, rh, this._top(x, z, rh)); }
  inside(x, y, z) {
    const rh = this.rhat(x, z);
    if (rh >= 1) return false;
    const t = this._top(x, z, rh);
    return y < t && y > this._bottom(x, z, rh, t);
  }
  // Upward normal of the ground at (x, z).
  groundNormal(x, z, out) {
    const h = 1.5, gx = (this.top(x + h, z) - this.top(x - h, z)) / (2 * h), gz = (this.top(x, z + h) - this.top(x, z - h)) / (2 * h);
    const l = Math.hypot(gx, 1, gz);
    out.x = -gx / l; out.y = 1 / l; out.z = -gz / l;
    return out;
  }
  // The rim point in the direction (from the middle) of angle th.
  rimAt(th, out = {}) { const r = this.outline(th); out.x = this.x + Math.cos(th) * r; out.z = this.z + Math.sin(th) * r; return out; }
  // Could anything at (x, y, z) be within m of the island? (quick reject)
  near(x, y, z, m) {
    const dx = x - this.x, dz = z - this.z;
    if (dx * dx + dz * dz > (this.Rmax + m) * (this.Rmax + m)) return false;
    return y < this.y + this.H + 2 + m && y > this.y - this.D * 1.3 - 4 - m;
  }
}

// Islands among `list` with (x, z) inside their outline, top first; and the one whose ground is
// just below y (within `below` m), if any.
export function islandUnder(list, x, y, z, below = Infinity) {
  let best = null, by = -Infinity;
  for (const I of list) {
    const g = I.ground(x, z);
    if (g === null || g > y + 0.01 || y - g > below) continue;
    if (g > by) { by = g; best = I; }
  }
  return best ? { island: best, y: by } : null;
}
