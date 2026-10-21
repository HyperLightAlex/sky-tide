// The trapar network: a root system in the sky.
//
//   nodes    a jittered honeycomb: every node joins three trunks.
//   trunks   each trunk is a pair of strands flowing opposite ways, side by side, now and then
//            twined once round each other. Each strand belongs to the face (the cell) on its
//            side, and the strands round a face join into one closed loop that circulates
//            round it, so neighboring loops run past each other in opposite directions.
//   knots    near a node the two strands of each trunk splay apart into an eye and each face
//            loop turns its corner round the node. Three connectors cross the middle, weaving
//            over and under each other: each takes you off one loop just before its corner and
//            onto the trunk you could not reach by staying on it.
//   roots    inside every face, roots of three sizes, the narrower the faster:
//              roots     span the face from trunk to trunk, or fuse into another root;
//              rootlets  link roots, wrap round them, or end in a drop onto a lower stream;
//              tendrils  the same, smaller and faster, often wrapping round rootlets as cords.
//            Wherever two of them would meet they pass over and under each other instead.
// A branch leaves or joins its host through a lane: the host's wall on that side lowers into a
// flat shelf, the branch lies on it, and the two split apart (or come together). You choose by
// steering.
//
// The sky holds three such networks stacked as layers, each on its own rolling altitude field
// and each with its own character:
//   tangle (low)   tight cells, slower, dense hanging roots, wraps and cords; below it only
//                  the floor.
//   main   (mid)   the reference network.
//   crown  (high)  wide cells, faster, long sweeping trunks, spirals and drops; open sky.
// The layers drift about 430 m apart and pinch together (to about 180 m) in places. A layer's
// roots stay on its side of the midline to the next layer, so layers never tangle; vertical
// connectors (connectors.js) cross between them everywhere.
//
// Each band is a polyline sampled every STEP meters with its frame (up vector), cross-section
// (floor half-width, wall curvature, extent, side cuts), presence, flow and feature tags. Bands
// are pure functions of the seed and parameters, built on demand and cached; the snapshot
// builder (braids.js) turns them into segments.

import { TAU, DEG, sst, hashu, cellHash3, lo16 } from '../sky/common.js';
import { mulberry32 } from '../sky/noise.js';
import { Island, DOCK_LIFT } from '../world/islands.js';

export const NET = {
  STEP: 12,       // spacing of band samples (m)
  FINE: 3,        // spacing while building (m)
  TSECTION: 380,  // feature section length along a trunk (m)
  BSECTION: 280,  // feature section length along a root (m)
  TWIST: 900,     // length of a twining (one full turn of a trunk's strands round each other)
  EYE: 260,       // length over which a trunk's strands splay apart near a node (m)
};
export const CLS = { TRUNK: 1, ROOT: 2, CORD: 3 };
export const TAG = { PIPE: 1, SPIRAL: 2, BARREL: 4, TWIST: 8, LANE: 16, KNOT: 32, TWINE: 64, TIP: 128, UP: 256, CHUTE: 512, RAMP: 1024, RAPIDS: 2048, DOCK: 4096 };
export const TIER = { TRUNK: 0, ROOT: 1, ROOTLET: 2, TENDRIL: 3 };
export const LAYER_NAMES = ['tangle', 'main', 'crown'];

// Per-layer character: multipliers on the base parameters, and how each layer's lattice is
// turned and shifted (so the layers' cells never line up).
export const LAYER_MUL = [
  { netSpacing: 0.75, trunkFlow: 0.85, rootFlow: 0.85, rootletFlow: 0.85, tendrilFlow: 0.85,
    rootsPerFace: 0.7, rootletsPerFace: 0.8, tendrilsPerFace: 0.9, rootSag: 1.3, wrapChance: 1.3, dropChance: 0.5,
    meanderAmp: 0.8, twistChance: 1.3, spiralChance: 0.5, cordChance: 1.5, trunkWidth: 0.9, trunkUndulation: 0.8, layerJitter: 0.85 },
  {},
  { netSpacing: 1.35, trunkFlow: 1.2, rootFlow: 1.2, rootletFlow: 1.2, tendrilFlow: 1.2,
    rootsPerFace: 1.2, rootletsPerFace: 0.8, tendrilsPerFace: 0.5, rootSag: 0.8, wrapChance: 0.8, dropChance: 1.2,
    meanderAmp: 1.5, twistChance: 0.8, spiralChance: 2, pipeChance: 0.6, barrelChance: 0.6, cordChance: 0.6, trunkUndulation: 1.4, layerJitter: 1.15 },
];
export const LAYER_XFORM = [{ rot: 0.41, ox: 0.37, oz: 0.21 }, { rot: 0, ox: 0, oz: 0 }, { rot: -0.33, ox: 0.61, oz: 0.47 }];

export const mod2 = (k) => ((k % 2) + 2) % 2;
// Smooth maximum (blend width k).
export const smax = (a, b, k) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
export const wrapS = (d, L) => { d %= L; if (d > L / 2) d -= L; else if (d < -L / 2) d += L; return d; };
const CH = 12;   // fine channels: LW DL HUX HUY HUZ HCX HCY HCZ MID STEEP WMUL TIPD

// Value noise on the node lattice (node altitudes).
export function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => lo16(cellHash3(a, b, 91, seed));
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Resample a fine polyline (plus extra channels) at even spacing close to `step`.
export function resample(px, py, pz, chs, step) {
  const m = px.length;
  const cum = new Float64Array(m);
  for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(px[k] - px[k - 1], py[k] - py[k - 1], pz[k] - pz[k - 1]);
  const L = cum[m - 1];
  const n = Math.max(2, Math.round(L / step) + 1);
  const sp = L / (n - 1);
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const ch = chs.map(() => new Float64Array(n));
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = i * sp;
    while (k < m - 2 && cum[k + 1] < s) k++;
    const sg = cum[k + 1] - cum[k], f = sg > 1e-9 ? Math.min(1, Math.max(0, (s - cum[k]) / sg)) : 0;
    x[i] = px[k] + (px[k + 1] - px[k]) * f;
    y[i] = py[k] + (py[k + 1] - py[k]) * f;
    z[i] = pz[k] + (pz[k + 1] - pz[k]) * f;
    for (let c = 0; c < chs.length; c++) ch[c][i] = chs[c][k] + (chs[c][k + 1] - chs[c][k]) * f;
  }
  return { n, L, sp, x, y, z, ch, cum };
}

// Cross-section from floor half-width, wall radius and wall angle.
export function xsec(out, wf, R, phi) { out.wf = wf; out.kap = 1 / Math.max(1, R); out.w = wf + Math.max(1, R) * phi; return out; }
// Height a channel's wall rises above its floor.
export function wallH(w, wf, kap) {
  if (kap < 1e-4) return 0;
  return (1 - Math.cos(Math.min(Math.PI, (w - wf) * kap))) / kap;
}

let BAND_ID = 0;
export class Band {
  constructor(kind, rs, closed = false) {
    const n = rs.n;
    this.id = ++BAND_ID;
    this.kind = kind; this.n = n; this.L = rs.L; this.sp = rs.sp; this.closed = closed;
    this.x = rs.x; this.y = rs.y; this.z = rs.z;
    this.ux = new Float32Array(n); this.uy = new Float32Array(n); this.uz = new Float32Array(n);
    this.wf = new Float32Array(n); this.kap = new Float32Array(n); this.w = new Float32Array(n);
    this.cut = new Float32Array(n); this.cut0 = null;
    this.pres = new Float32Array(n).fill(1); this.cord = new Float32Array(n);
    this.rap = new Float32Array(n);    // rapids strength (0..1, up to 2 at a kicker hump)
    this.slosh = new Float32Array(n);  // slosh amplitude (0..1), built up by bends
    this.tag = new Uint16Array(n);
    this.layer = 1; this.dirty = false;
    this.cls = CLS.TRUNK; this.tier = TIER.TRUNK; this.flow = 0;
    this.lanes = [];                 // lanes of branches leaving or joining this band
    this.attach = null;              // this band's own lanes on its hosts [{host, ln, atStart}]
    this.res = { 1: [], [-1]: [] };  // stretches taken by those lanes, per side
    this.free = [];                  // stretches where branches may attach [s0, s1, side (0: both)]
  }
  idx(k) {
    if (this.closed) { const m = this.n - 1; return ((k % m) + m) % m; }
    return k < 0 ? 0 : k >= this.n ? this.n - 1 : k;
  }
  bbox(pad) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i], z = this.z[i], y = this.y[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    this.box = [x0 - pad, x1 + pad, z0 - pad, z1 + pad, y0 - pad, y1 + pad];
  }
  hits(x0, x1, z0, z1) { const b = this.box; return b[1] >= x0 && b[0] <= x1 && b[3] >= z0 && b[2] <= z1; }
}

// Frame of band b at arclength s: position, tangent, up, right (banked), cross-section.
export function frameAt(b, s, o) {
  if (b.closed) s = ((s % b.L) + b.L) % b.L;
  const fi = Math.min(b.n - 1.000001, Math.max(0, s / b.sp));
  const i = Math.floor(fi), f = fi - i, j = i + 1;
  o.x = b.x[i] + (b.x[j] - b.x[i]) * f; o.y = b.y[i] + (b.y[j] - b.y[i]) * f; o.z = b.z[i] + (b.z[j] - b.z[i]) * f;
  const ia = b.idx(i - 1), ib = b.idx(j + 1);
  let tx = b.x[ib] - b.x[ia], ty = b.y[ib] - b.y[ia], tz = b.z[ib] - b.z[ia];
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  let ux = b.ux[i] + (b.ux[j] - b.ux[i]) * f, uy = b.uy[i] + (b.uy[j] - b.uy[i]) * f, uz = b.uz[i] + (b.uz[j] - b.uz[i]) * f;
  const ut = ux * tx + uy * ty + uz * tz; ux -= ut * tx; uy -= ut * ty; uz -= ut * tz;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  o.tx = tx; o.ty = ty; o.tz = tz; o.ux = ux; o.uy = uy; o.uz = uz;
  o.rx = ty * uz - tz * uy; o.ry = tz * ux - tx * uz; o.rz = tx * uy - ty * ux;
  o.wf = b.wf[i] + (b.wf[j] - b.wf[i]) * f; o.w = b.w[i] + (b.w[j] - b.w[i]) * f;
  return o;
}

// Up vectors from the path: world up made perpendicular to the tangent, banked into turns
// (bank from the turn's curvature at speed vb), then rolled. bankMul, roll, steep: per sample.
// hostU / hostW: lanes lie flat on their host's floor (its up), blending back to their own.
export function computeUps(b, P, bankMul, roll, steep, hostU, hostW) {
  const n = b.n, sp = b.sp, G = Math.max(1, P.gravity || 22), vb = 28, closed = b.closed;
  const bankMax = Math.max(0, P.bankMax) * DEG;
  const bank = new Float64Array(n);
  const k = Math.max(1, Math.round(36 / sp));
  for (let i = 0; i < n; i++) {
    let a, c, h1, h2;
    if (closed) { a = b.idx(i - k); c = b.idx(i + k); h1 = h2 = k * sp; }
    else {
      a = Math.max(0, i - k); c = Math.min(n - 1, i + k);
      if (c - i < 1 || i - a < 1) { bank[i] = 0; continue; }
      h1 = (i - a) * sp; h2 = (c - i) * sp;
    }
    let tx = b.x[c] - b.x[a], tz = b.z[c] - b.z[a];
    const tl = Math.hypot(tx, b.y[c] - b.y[a], tz) || 1; tx /= tl; tz /= tl;
    let rx = -tz, rz = tx; const rl = Math.hypot(rx, rz);
    if (rl < 0.2) { bank[i] = 0; continue; }
    rx /= rl; rz /= rl;
    const accx = (2 * ((b.x[c] - b.x[i]) / h2 - (b.x[i] - b.x[a]) / h1)) / (h1 + h2);
    const accz = (2 * ((b.z[c] - b.z[i]) / h2 - (b.z[i] - b.z[a]) / h1)) / (h1 + h2);
    const kr = accx * rx + accz * rz;
    let bk = Math.atan((kr * vb * vb) / G);
    const st = steep ? steep[i] : 0;
    if (st > 0) bk += (Math.atan((kr * 48 * 48) / G) - bk) * st;
    const bm = bankMax + (75 * DEG - bankMax) * st;
    bank[i] = Math.max(-bm, Math.min(bm, bk)) * (bankMul ? bankMul[i] : 1);
  }
  // Light smoothing (curvature from a resampled polyline is a little noisy).
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let d = -2; d <= 2; d++) {
      const q = closed ? b.idx(i + d) : i + d;
      if (q >= 0 && q < n) { s += bank[q]; c++; }
    }
    sm[i] = s / c;
  }
  for (let i = 0; i < n; i++) {
    const a = closed ? b.idx(i - 1) : Math.max(0, i - 1), c = closed ? b.idx(i + 1) : Math.min(n - 1, i + 1);
    let tx = b.x[c] - b.x[a], ty = b.y[c] - b.y[a], tz = b.z[c] - b.z[a];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let ux0 = -tx * ty, uy0 = 1 - ty * ty, uz0 = -tz * ty;
    const ul = Math.hypot(ux0, uy0, uz0);
    if (ul < 0.15) { ux0 = -tz; uy0 = 0; uz0 = tx; const l2 = Math.hypot(ux0, uz0) || 1; ux0 /= l2; uz0 /= l2; } else { ux0 /= ul; uy0 /= ul; uz0 /= ul; }
    const psi = sm[i] + (roll ? roll[i] : 0);
    const cs = Math.cos(psi), sn = Math.sin(psi);
    const cx = ty * uz0 - tz * uy0, cy = tz * ux0 - tx * uz0, cz = tx * uy0 - ty * ux0;
    let ux = ux0 * cs + cx * sn, uy = uy0 * cs + cy * sn, uz = uz0 * cs + cz * sn;
    if (hostU && hostW[i] > 0) {
      const w = hostW[i];
      ux += (hostU[0][i] - ux) * w; uy += (hostU[1][i] - uy) * w; uz += (hostU[2][i] - uz) * w;
      const ut = ux * tx + uy * ty + uz * tz; ux -= ut * tx; uy -= ut * ty; uz -= ut * tz;
      const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    }
    b.ux[i] = ux; b.uy[i] = uy; b.uz[i] = uz;
  }
  // Slosh: bends set the water sloshing from wall to wall; it builds through a bend and dies
  // away downstream after it.
  const bm = Math.max(0.1, (P.bankMax || 35) * DEG), decay = Math.exp(-sp / 260);
  let acc = 0;
  for (let pass = 0; pass < (closed ? 2 : 1); pass++) {
    for (let i = 0; i < n; i++) {
      acc = Math.max(Math.min(1, Math.abs(sm[i]) / bm), acc * decay);
      b.slosh[i] = acc;
    }
  }
}

// Spatial hash of band samples, for keeping streams clear of each other while they are built.
export class Index {
  constructor(cell) { this.c = cell; this.m = new Map(); this.maxAh = 0; }
  _k(gx, gz) { return (gx + 32768) * 65536 + (gz + 32768); }
  add(e) {
    const k = this._k(Math.floor(e.x / this.c), Math.floor(e.z / this.c));
    let a = this.m.get(k);
    if (!a) { a = []; this.m.set(k, a); }
    a.push(e);
    if (e.ah > this.maxAh) this.maxAh = e.ah;
  }
  query(x, z, r, fn) {
    const c = this.c;
    const gx0 = Math.floor((x - r) / c), gx1 = Math.floor((x + r) / c), gz0 = Math.floor((z - r) / c), gz1 = Math.floor((z + r) / c);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const a = this.m.get(this._k(gx, gz));
      if (a) for (let q = 0; q < a.length; q++) fn(a[q]);
    }
  }
  all(fn) { for (const a of this.m.values()) for (const e of a) fn(e); }
}

// Fine point list with channels (see CH).
export class Fine {
  constructor() { this.x = []; this.y = []; this.z = []; this.ch = []; for (let c = 0; c < CH; c++) this.ch.push([]); }
  get n() { return this.x.length; }
  push(x, y, z, lw, dl, hux, huy, huz, hcx, hcy, hcz, mid, steep, wmul, tipd) {
    this.x.push(x); this.y.push(y); this.z.push(z);
    const ch = this.ch;
    ch[0].push(lw); ch[1].push(dl); ch[2].push(hux); ch[3].push(huy); ch[4].push(huz);
    ch[5].push(hcx); ch[6].push(hcy); ch[7].push(hcz); ch[8].push(mid); ch[9].push(steep); ch[10].push(wmul); ch[11].push(tipd);
  }
  // Copy point k of another Fine, with its steep / wmul / tipd overridden if given.
  copy(F, k, x, y, z, steep, wmul, tipd) {
    const c = F.ch;
    this.push(x, y, z, c[0][k], c[1][k], c[2][k], c[3][k], c[4][k], c[5][k], c[6][k], c[7][k], c[8][k], steep, wmul, tipd);
  }
}

// Launch lips (see Layer._launchLip): their flow (fast, and pushing hard like an updraft) and
// about the speed you leave the kicker at.
const LIP_FLOW = 30, LIP_SPEED = 38;

// One layer of the network (see network.js for the stack).
export class Layer {
  constructor(net, li) {
    this.net = net; this.li = li; this.P = null;
    this.cache = new Map();
    this._f = {}; this._f2 = {}; this._f3 = {};
    this.stats = { tries: 0, built: 0, why: {} };
  }

  // Parameters (the base ones with this layer's multipliers) and seed; set by Network.sync.
  _setup(P, seedH, clear) {
    this.P = P; this.seedH = seedH;
    if (clear) this.cache.clear();
    const a = this.dims().a, t = LAYER_XFORM[this.li];
    this.cr = Math.cos(t.rot); this.sr = Math.sin(t.rot); this.ox = t.ox * a; this.oz = t.oz * a;
    this.sc = a / 2400;   // distances inside a face scale with its size
  }
  // Lattice <-> world (horizontal).
  toWorld(lx, lz) { return [this.ox + lx * this.cr - lz * this.sr, this.oz + lx * this.sr + lz * this.cr]; }
  toLattice(x, z) { const dx = x - this.ox, dz = z - this.oz; return [dx * this.cr + dz * this.sr, -dx * this.sr + dz * this.cr]; }

  _get(key, make) {
    let v = this.cache.get(key);
    if (v === undefined) { v = make(); this.cache.set(key, v); }
    return v;
  }

  _why(w) { this.stats.why[w] = (this.stats.why[w] || 0) + 1; return null; }

  // --- lattice -------------------------------------------------------------------------------

  // A honeycomb drawn as a brick wall: node (i, j) joins (i - 1, j), (i + 1, j) and (i, j + 1)
  // if i + j is even, else (i, j - 1). Faces are the bricks: face (i, j) (i + j even) has the
  // nodes (i..i+2, j) and (i..i+2, j+1).
  dims() { const a = Math.max(800, this.P.netSpacing); return { a, Sx: 0.8660254 * a, Sz: 1.5 * a, q: 0.25 * a }; }

  node(i, j) {
    return this._get(`n|${i}|${j}`, () => {
      const P = this.P, { a, Sx, Sz, q } = this.dims(), J = Math.max(0, Math.min(0.25, P.netJitter)) * a;
      const r = mulberry32(cellHash3(i, j, 17, this.seedH));
      const lx = (i + 0.5) * Sx + J * (r() * 2 - 1);
      const lz = (j + 0.5) * Sz + (mod2(i + j) === 0 ? q : -q) + J * (r() * 2 - 1);
      const [x, z] = this.toWorld(lx, lz);
      // On the layer's altitude field, give or take a little.
      const y = this.net.field(this.li, x, z) + Math.max(0, P.layerJitter) * (r() * 2 - 1);
      return { i, j, x, z, y };
    });
  }
  nbrs(i, j) { return [[i - 1, j], [i + 1, j], [i, j + (mod2(i + j) === 0 ? 1 : -1)]]; }
  faceNodes(fi, fj) { return [[fi, fj], [fi + 1, fj], [fi + 2, fj], [fi + 2, fj + 1], [fi + 1, fj + 1], [fi, fj + 1]]; }
  facesAt(i, j) { return mod2(i + j) === 0 ? [[i - 2, j], [i, j], [i - 1, j - 1]] : [[i - 2, j - 1], [i, j - 1], [i - 1, j]]; }

  // The trunk between two neighboring nodes, and whether it runs from the first to the second.
  edgeOf(i1, j1, i2, j2) {
    if (j1 === j2) { const i = Math.min(i1, i2); return { E: this.edge('h', i, j1), fwd: i1 === i }; }
    const j = Math.min(j1, j2);
    return { E: this.edge('v', i1, j), fwd: j1 === j };
  }

  // Corner of a face loop at node X, arriving from neighbor `pin` and leaving toward `pout`:
  // the loop runs Rn inside each trunk's line and turns on an arc of radius rc. t: distance
  // from the node, along each trunk, of the arc's ends.
  _corner(X, pin, pout) {
    const P = this.P, Rn = Math.max(20, P.knotEye), rc = Math.max(40, P.knotCorner), K = Rn + rc;
    let bix = pin.x - X.x, biz = pin.z - X.z; const bil = Math.hypot(bix, biz); bix /= bil; biz /= bil;
    let box = pout.x - X.x, boz = pout.z - X.z; const bol = Math.hypot(box, boz); box /= bol; boz /= bol;
    const nix = biz, niz = -bix;        // right of the arriving travel (-b_in)
    const nox = -boz, noz = box;        // right of the departing travel (b_out)
    const dbx = box - bix, dbz = boz - biz, dnx = nix - nox, dnz = niz - noz;
    const t = (K * (dnx * dbx + dnz * dbz)) / Math.max(1e-9, dbx * dbx + dbz * dbz);
    const cx = X.x + t * bix + K * nix, cz = X.z + t * biz + K * niz;
    const tin = { x: X.x + t * bix + Rn * nix, z: X.z + t * biz + Rn * niz };
    const tout = { x: X.x + t * box + Rn * nox, z: X.z + t * boz + Rn * noz };
    const b0 = Math.atan2(tin.z - cz, tin.x - cx), b1 = Math.atan2(tout.z - cz, tout.x - cx);
    let sweep = b1 - b0; while (sweep < 0) sweep += TAU; while (sweep >= TAU) sweep -= TAU;
    return { X, t, cx, cz, rc, b0, sweep, tin, tout, y: X.y };
  }

  // Per node: how far each of its trunks must run straight (the corners and the knot's lanes).
  knotGeo(i, j) {
    return this._get(`g|${i}|${j}`, () => {
      const P = this.P, K = Math.max(20, P.knotEye) + Math.max(40, P.knotCorner);
      const X = this.node(i, j), nb = this.nbrs(i, j).map(([a, c]) => this.node(a, c));
      const ang = nb.map((N) => Math.atan2(N.z - X.z, N.x - X.x));
      const straight = [0, 0, 0];
      const md = (a) => ((a % TAU) + TAU) % TAU;
      for (let k = 0; k < 3; k++) for (let m = k + 1; m < 3; m++) {
        // The wedge between trunks k and m that does not hold the third: a face's corner.
        const th = 3 - k - m, d = md(ang[m] - ang[k]), dr = md(ang[th] - ang[k]);
        const alpha = dr < d ? TAU - d : d;
        const t = K / Math.tan(Math.max(0.2, Math.min(Math.PI - 0.05, alpha)) / 2);
        straight[k] = Math.max(straight[k], t); straight[m] = Math.max(straight[m], t);
      }
      return { X, nb, straight: straight.map((t) => t + 30) };
    });
  }
  _straightTo(i, j, ni, nj) {
    const g = this.knotGeo(i, j);
    for (let k = 0; k < 3; k++) if (g.nb[k].i === ni && g.nb[k].j === nj) return g.straight[k];
    return 300;
  }

  // --- trunks ----------------------------------------------------------------------------------

  // Trunk ('h', i, j): node (i, j) to (i + 1, j); ('v', i, j): node (i, j) to (i, j + 1). Its
  // centerline runs straight and level out of each node, then meanders, rises and falls.
  edge(kind, i, j) { return this._get(`e|${kind}|${i}|${j}`, () => this._buildEdge(kind, i, j)); }

  _buildEdge(kind, i, j) {
    const P = this.P;
    const A = this.node(i, j), B = kind === 'h' ? this.node(i + 1, j) : this.node(i, j + 1);
    const SA = this._straightTo(A.i, A.j, B.i, B.j), SB = this._straightTo(B.i, B.j, A.i, A.j);
    const dx = B.x - A.x, dz = B.z - A.z, D = Math.hypot(dx, dz);
    const hx = dx / D, hz = dz / D, rx = -hz, rz = hx;
    const r = mulberry32(cellHash3(i, j, kind === 'h' ? 51 : 53, this.seedH));
    const Am = Math.max(0, P.meanderAmp) * (0.4 + 0.6 * r()), n1 = 1 + (r() < 0.25 ? 1 : 0), ph1 = r() * TAU, ph2 = r() * TAU;
    const Au = Math.max(0, P.trunkUndulation) * (0.3 + 0.7 * r()), nv = 1 + Math.floor(r() * 2), phv = r() * TAU;
    const FA = SA + 200, FB = SB + 200;
    // The centerline stays straight until the strands have closed up after the eye.
    const MA = SA + 160 + NET.EYE + 20, MB = SB + 160 + NET.EYE + 20;
    const NF = Math.max(50, Math.ceil(D / 2));
    const fx = new Float64Array(NF + 1), fy = new Float64Array(NF + 1), fz = new Float64Array(NF + 1);
    // Meander: a bow and an S across the middle (both start and end level, so the bends stay
    // gentle); undulation the same up and down.
    const Lm = Math.max(1, D - MA - MB), Lv = Math.max(1, D - FA - FB);
    // Keep the bends gentle (radius 250 m or more) on short trunks.
    const Amx = Math.min(Am, (Lm * Lm) / (44 * 250));
    const a1 = Math.cos(ph1) * (n1 === 1 ? 1 : 0.5), a2 = Math.sin(ph1) * (n1 === 1 ? 0.5 : 1);
    const b1 = Math.cos(phv) * (nv === 1 ? 1 : 0.4), b2 = Math.sin(phv) * (nv === 1 ? 0.4 : 1);
    void ph2;
    // Between its ends the trunk also follows the layer's altitude field (its bend away from
    // the straight line between the nodes).
    const fA = this.net.field(this.li, A.x, A.z), fB = this.net.field(this.li, B.x, B.z);
    // (sampled every ~50 m along the straight line between the nodes: the field is smooth)
    const NC = Math.max(4, Math.ceil(D / 50)), fc = new Float64Array(NC + 1);
    for (let c = 0; c <= NC; c++) { const t = (D * c) / NC; fc[c] = this.net.field(this.li, A.x + hx * t, A.z + hz * t); }
    for (let k = 0; k <= NF; k++) {
      const t = (D * k) / NF;
      const v = Math.min(1, Math.max(0, (t - MA) / Lm)), sv = Math.sin(Math.PI * v);
      const m = Amx * (a1 * sv * sv + a2 * sv * Math.sin(TAU * v));
      const w = Math.min(1, Math.max(0, (t - FA) / Lv)), sw = Math.sin(Math.PI * w);
      fx[k] = A.x + hx * t + rx * m; fz[k] = A.z + hz * t + rz * m;
      const e = sst(FA, Math.max(FA + 1, D - FB), t);
      let dev = 0;
      if (sw > 0) {
        const cf = (t / D) * NC, ci = Math.min(NC - 1, Math.floor(cf));
        dev = (fc[ci] + (fc[ci + 1] - fc[ci]) * (cf - ci) - (fA + (fB - fA) * e)) * sw * sw;
      }
      fy[k] = A.y + (B.y - A.y) * e + dev + Au * (b1 * sw * sw + b2 * sw * Math.sin(TAU * w));
    }
    const rs = resample(fx, fy, fz, [], NET.FINE);
    const n = rs.n, E = { kind, i, j, A, B, n, Lc: rs.L, sp: rs.sp, cx: rs.x, cy: rs.y, cz: rs.z, SA, SB };
    E.tx = new Float64Array(n); E.ty = new Float64Array(n); E.tz = new Float64Array(n);
    E.ux = new Float64Array(n); E.uy = new Float64Array(n); E.uz = new Float64Array(n);
    E.rx = new Float64Array(n); E.ry = new Float64Array(n); E.rz = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), c = Math.min(n - 1, k + 1);
      let tx = rs.x[c] - rs.x[a], ty = rs.y[c] - rs.y[a], tz = rs.z[c] - rs.z[a];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let ux = -tx * ty, uy = 1 - ty * ty, uz = -tz * ty; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      E.tx[k] = tx; E.ty[k] = ty; E.tz[k] = tz; E.ux[k] = ux; E.uy[k] = uy; E.uz[k] = uz;
      E.rx[k] = ty * uz - tz * uy; E.ry[k] = tz * ux - tx * uz; E.rz[k] = tx * uy - ty * ux;
    }
    // The eye (strands splayed apart near each node) and twinings in the middle.
    E.eyeA = SA + 160; E.eyeB = SB + 160;
    const m0 = E.eyeA + NET.EYE + 80, m1 = E.Lc - E.eyeB - NET.EYE - 80, TW = NET.TWIST;
    E.twists = [];
    E.mid = [m0, m1];
    if (m1 - m0 > TW + 40 && r() < P.twistChance) {
      if (m1 - m0 > 2 * TW + 300 && r() < 0.35) {
        const h = (m1 - m0) / 2;
        E.twists.push({ s0: m0 + r() * (h - TW), dir: r() < 0.5 ? 1 : -1 });
        E.twists.push({ s0: m0 + h + r() * (h - TW), dir: r() < 0.5 ? 1 : -1 });
      } else E.twists.push({ s0: m0 + r() * (m1 - m0 - TW), dir: r() < 0.5 ? 1 : -1 });
      for (const t of E.twists) t.s1 = t.s0 + TW;
    }
    return E;
  }

  // Strand on side sig (+1: right of A -> B) of trunk E at centerline arclength s.
  strandAt(E, s, sig, o) {
    const P = this.P;
    const fi = Math.min(E.n - 1.000001, Math.max(0, s / E.sp)), k = Math.floor(fi), f = fi - k;
    const L = (a) => a[k] + (a[k + 1] - a[k]) * f;
    const Rn = Math.max(20, P.knotEye), Rs = Math.max(8, P.twinGap), Rt = Math.max(Rs, P.twistRadius);
    const eye = Math.max(1 - sst(E.eyeA, E.eyeA + NET.EYE, s), 1 - sst(E.eyeB, E.eyeB + NET.EYE, E.Lc - s));
    let psi = 0;
    for (const t of E.twists) psi += t.dir * TAU * sst(t.s0, t.s1, s);
    const sp2 = Math.sin(psi);
    const R = Rs + (Rn - Rs) * eye + (Rt - Rs) * sp2 * sp2;
    const c = Math.cos(psi) * R * sig, sn = Math.sin(psi) * R * sig;
    o.x = L(E.cx) + L(E.rx) * c + L(E.ux) * sn;
    o.y = L(E.cy) + L(E.ry) * c + L(E.uy) * sn;
    o.z = L(E.cz) + L(E.rz) * c + L(E.uz) * sn;
    o.twine = Math.abs(Math.sin(psi / 2)) > 0.02 ? 1 : 0;
    o.psi = psi; o.R = R;
    return o;
  }
  _inTwist(E, s, pad = 0) { for (const t of E.twists) if (s > t.s0 - pad && s < t.s1 + pad) return true; return false; }

  // --- face loops ------------------------------------------------------------------------------

  // The closed loop of strands round face (fi, fj), turning a corner round each node. It runs
  // N0 -> N1 -> ... -> N5 with the face on its right (+1 side); the knots attach on its left.
  faceLoop(fi, fj) { return this._get(`L|${fi}|${fj}`, () => this._buildLoop(fi, fj)); }

  _buildLoop(fi, fj) {
    const P = this.P;
    const ids = this.faceNodes(fi, fj), N = ids.map(([a, b]) => this.node(a, b));
    const corners = [];
    for (let k = 0; k < 6; k++) corners.push(this._corner(N[k], N[(k + 5) % 6], N[(k + 1) % 6]));
    const r = mulberry32(cellHash3(fi, fj, 61, this.seedH));
    const fx = [], fy = [], fz = [], pipe = [], barrel = [], twine = [];
    const portions = [], cornerS = [];
    const o = {};
    let cum = 0, px = null, py = 0, pz = 0;
    const push = (x, y, z, pi, ba, tw) => {
      if (px !== null) cum += Math.hypot(x - px, y - py, z - pz);
      fx.push(x); fy.push(y); fz.push(z); pipe.push(pi); barrel.push(ba); twine.push(tw);
      px = x; py = y; pz = z;
    };
    const phiV = Math.max(5, P.trunkWall) * DEG;
    for (let k = 0; k < 6; k++) {
      const [ia, ja] = ids[k], [ib, jb] = ids[(k + 1) % 6];
      const { E, fwd } = this.edgeOf(ia, ja, ib, jb);
      const sig = fwd ? 1 : -1;
      const tk = corners[k].t, tk1 = corners[(k + 1) % 6].t;
      const s0 = fwd ? tk : E.Lc - tk, s1 = fwd ? E.Lc - tk1 : tk1;
      // Feature sections along the middle of this strand: pipes and barrels.
      const secs = [];
      const fr = mulberry32(cellHash3(E.i * 2 + (E.kind === 'h' ? 0 : 1), E.j, 70 + (sig > 0 ? 1 : 0), this.seedH));
      for (let s = E.mid[0] + 60; s + NET.TSECTION < E.mid[1] - 60; s += NET.TSECTION) {
        const t = fr();
        let ty = 0;
        if (t < P.pipeChance) ty = 3; else if (t < P.pipeChance + P.barrelChance) ty = 2;
        if (ty && !this._inTwist(E, s, 60) && !this._inTwist(E, s + NET.TSECTION, 60)) secs.push({ s0: s, s1: s + NET.TSECTION, ty });
      }
      const nq = Math.max(2, Math.ceil(Math.abs(s1 - s0) / NET.FINE));
      const portion = { k, E, fwd, sig, ea: cum, sc: [], ls: [] };
      for (let q = 0; q < nq; q++) {
        const s = s0 + ((s1 - s0) * q) / nq;
        this.strandAt(E, s, sig, o);
        let pi = 0, ba = 0;
        for (const S of secs) {
          if (s < S.s0 || s > S.s1) continue;
          const u = (s - S.s0) / NET.TSECTION;
          if (S.ty === 3) pi = sst(0.06, 0.2, u) * (1 - sst(0.8, 0.94, u));
          else ba = sst(0.08, 0.3, u) * (1 - sst(0.7, 0.92, u));
        }
        push(o.x, o.y, o.z, pi, ba, o.twine);
        portion.sc.push(s); portion.ls.push(cum);
      }
      portion.secs = secs;
      // Corner at the next node.
      const c = corners[(k + 1) % 6];
      const sIn = cum + Math.hypot(c.tin.x - px, c.y - py, c.tin.z - pz);
      portion.eb = sIn;
      portions.push(portion);
      const m = Math.max(2, Math.ceil((c.rc * c.sweep) / NET.FINE));
      for (let q = 0; q < m; q++) {
        const b = c.b0 + (c.sweep * q) / m;
        push(c.cx + c.rc * Math.cos(b), c.y, c.cz + c.rc * Math.sin(b), 0, 0, 0);
      }
      cornerS[(k + 1) % 6] = { sIn, len: c.rc * c.sweep };
    }
    push(fx[0], fy[0], fz[0], pipe[0], barrel[0], twine[0]);
    const rs = resample(fx, fy, fz, [pipe, barrel, twine], NET.STEP);
    const b = new Band(`loop ${fi},${fj}`, rs, true);
    b.cls = CLS.TRUNK; b.tier = TIER.TRUNK; b.flow = Math.max(0.5, P.trunkFlow);
    // Rescale bookkeeping from the fine path's arclength to the resampled band's.
    const sc = rs.L / Math.max(1e-9, cum);
    for (const p of portions) { p.ea *= sc; p.eb *= sc; for (let q = 0; q < p.ls.length; q++) p.ls[q] *= sc; }
    for (let k = 0; k < 6; k++) { cornerS[k].sIn *= sc; cornerS[k].sOut = (cornerS[k].sIn + cornerS[k].len * sc) % rs.L; }
    cornerS[0].sOut = 0;
    const [PI, BA, TW] = rs.ch;
    const xs = {}, xp = {}, xb = {};
    const RV = Math.max(2, (P.trunkWidth - P.trunkFloor) / phiV);
    const phiP = Math.max(5, P.pipeWall) * DEG, phiB = Math.max(5, P.barrelWall) * DEG;
    const bankMul = new Float64Array(b.n);
    for (let i = 0; i < b.n; i++) {
      xsec(xs, P.trunkFloor, RV, phiV);
      const pi = PI[i], ba = BA[i];
      if (pi > 0) { xsec(xp, P.pipeFloor, P.pipeRadius, phiP); xs.wf += (xp.wf - xs.wf) * pi; xs.w += (xp.w - xs.w) * pi; xs.kap = 1 / (1 / xs.kap + (1 / xp.kap - 1 / xs.kap) * pi); }
      if (ba > 0) { xsec(xb, P.barrelFloor, P.barrelRadius, phiB); xs.wf += (xb.wf - xs.wf) * ba; xs.w += (xb.w - xs.w) * ba; xs.kap = 1 / (1 / xs.kap + (1 / xb.kap - 1 / xs.kap) * ba); }
      b.wf[i] = xs.wf; b.kap[i] = xs.kap; b.w[i] = xs.w;
      bankMul[i] = 1 - pi;
      b.tag[i] = (pi > 0.3 ? TAG.PIPE : 0) | (ba > 0.3 ? TAG.BARREL : 0) | (TW[i] > 0.5 ? TAG.TWINE : 0);
    }
    computeUps(b, P, bankMul, null, null, null, null);
    b.cut0 = new Float32Array(b.n);
    b.bbox(Math.max(P.trunkWidth, P.pipeFloor + P.pipeRadius * 2, P.barrelFloor + P.barrelRadius * 2) + P.trunkThickness + P.twistRadius + 10);
    // Where roots may attach (the face side, +1): the middle of each strand, clear of corners,
    // twinings and features.
    for (const p of portions) {
      const cuts = [];
      for (const t of p.E.twists) cuts.push([t.s0 - 80, t.s1 + 80]);
      for (const S of p.secs) cuts.push([S.s0 - 40, S.s1 + 40]);
      // Convert to loop arclength along this portion.
      const toLoop = (s) => this._interp(p.sc, p.ls, s);
      let a0 = p.ea + 240, a1 = p.eb - 240;
      const ivs = [[a0, a1]];
      for (const [c0, c1] of cuts) {
        let l0 = toLoop(c0), l1 = toLoop(c1); if (l0 > l1) [l0, l1] = [l1, l0];
        for (let q = ivs.length - 1; q >= 0; q--) {
          const [u0, u1] = ivs[q];
          if (l1 <= u0 || l0 >= u1) continue;
          ivs.splice(q, 1);
          if (l0 > u0) ivs.push([u0, l0]);
          if (l1 < u1) ivs.push([l1, u1]);
        }
      }
      for (const [u0, u1] of ivs) if (u1 - u0 > 200) b.free.push([u0, u1, 1]);
    }
    // 2D outline for inside tests.
    const poly = { x: [], z: [] };
    for (let i = 0; i < b.n - 1; i += 2) { poly.x.push(b.x[i]); poly.z.push(b.z[i]); }
    poly.raster = this._raster(b, poly);
    return { fi, fj, ids, nodes: N, band: b, corners, cornerS, portions, poly, finalized: 0 };
  }

  // A raster of a face's inside (20 m cells) with each cell's depth (distance to the outline), for
  // fast inside tests.
  _raster(b, poly) {
    const cs = 20, x0 = b.box[0], z0 = b.box[2], nx = Math.ceil((b.box[1] - x0) / cs), nz = Math.ceil((b.box[3] - z0) / cs);
    const bits = new Uint8Array(nx * nz);
    // Scanline fill: for each row, crossings of the outline.
    const X = poly.x, Z = poly.z, m = X.length;
    for (let gz = 0; gz < nz; gz++) {
      const z = z0 + (gz + 0.5) * cs, xs = [];
      for (let i = 0, j = m - 1; i < m; j = i++) if ((Z[i] > z) !== (Z[j] > z)) xs.push(((X[j] - X[i]) * (z - Z[i])) / (Z[j] - Z[i]) + X[i]);
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil((xs[k] - x0) / cs - 0.5)), c = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cs - 0.5));
        for (let gx = a; gx <= c; gx++) bits[gx + nx * gz] = 1;
      }
    }
    // Depth: distance (m) to the outside, by a two-pass chamfer transform.
    const dep = new Float32Array(nx * nz);
    for (let k = 0; k < nx * nz; k++) dep[k] = bits[k] ? 1e9 : 0;
    const d1 = cs, d2 = cs * Math.SQRT2;
    for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      const k = gx + nx * gz; if (!bits[k]) continue;
      let v = dep[k];
      if (gx > 0) v = Math.min(v, dep[k - 1] + d1); else v = Math.min(v, d1);
      if (gz > 0) { v = Math.min(v, dep[k - nx] + d1); if (gx > 0) v = Math.min(v, dep[k - nx - 1] + d2); if (gx < nx - 1) v = Math.min(v, dep[k - nx + 1] + d2); } else v = Math.min(v, d1);
      dep[k] = v;
    }
    for (let gz = nz - 1; gz >= 0; gz--) for (let gx = nx - 1; gx >= 0; gx--) {
      const k = gx + nx * gz; if (!bits[k]) continue;
      let v = dep[k];
      if (gx < nx - 1) v = Math.min(v, dep[k + 1] + d1); else v = Math.min(v, d1);
      if (gz < nz - 1) { v = Math.min(v, dep[k + nx] + d1); if (gx < nx - 1) v = Math.min(v, dep[k + nx + 1] + d2); if (gx > 0) v = Math.min(v, dep[k + nx - 1] + d2); } else v = Math.min(v, d1);
      dep[k] = v;
    }
    let dmax = 0; for (let k = 0; k < nx * nz; k++) dmax = Math.max(dmax, dep[k]);
    return { cs, x0, z0, nx, nz, bits, dep, dmax };
  }

  // Linear interpolation of ys over increasing (or decreasing) xs.
  _interp(xs, ys, x) {
    const n = xs.length;
    if (n === 0) return 0;
    const inc = xs[n - 1] >= xs[0];
    let lo = 0, hi = n - 1;
    if (inc ? x <= xs[0] : x >= xs[0]) return ys[0];
    if (inc ? x >= xs[n - 1] : x <= xs[n - 1]) return ys[n - 1];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((xs[m] <= x) === inc) lo = m; else hi = m; }
    const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return ys[lo] + (ys[hi] - ys[lo]) * f;
  }

  _inside(poly, x, z) {
    const R = poly.raster;
    if (R) {
      const gx = Math.floor((x - R.x0) / R.cs), gz = Math.floor((z - R.z0) / R.cs);
      if (gx < 0 || gz < 0 || gx >= R.nx || gz >= R.nz) return false;
      return R.bits[gx + R.nx * gz] === 1;
    }
    return this._insidePoly(poly, x, z);
  }
  // Distance (m) from (x, z) to the face's outline (0 outside).
  _depth(poly, x, z) {
    const R = poly.raster;
    const gx = Math.floor((x - R.x0) / R.cs), gz = Math.floor((z - R.z0) / R.cs);
    if (gx < 0 || gz < 0 || gx >= R.nx || gz >= R.nz) return 0;
    return R.dep[gx + R.nx * gz];
  }
  // A random point at least `minDepth` inside the face.
  _deepPoint(poly, minDepth, rng) {
    const R = poly.raster;
    for (let t = 0; t < 40; t++) {
      const gx = Math.floor(rng() * R.nx), gz = Math.floor(rng() * R.nz);
      if (R.dep[gx + R.nx * gz] >= minDepth) return { x: R.x0 + (gx + 0.5) * R.cs, z: R.z0 + (gz + 0.5) * R.cs };
    }
    return null;
  }

  _insidePoly(poly, x, z) {
    const X = poly.x, Z = poly.z, n = X.length;
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if ((Z[i] > z) !== (Z[j] > z) && x < ((X[j] - X[i]) * (z - Z[i])) / (Z[j] - Z[i]) + X[i]) c = !c;
    }
    return c;
  }

  // --- lanes -----------------------------------------------------------------------------------

  _thick(b) { return b.cls === CLS.TRUNK ? this.P.trunkThickness : this.P.rootThickness; }

  // A lane point: the branch beside (or on) the host's floor, d meters from where it attaches.
  _lane(host, ln, d, wb, out) {
    const s = ln.sAtt + ln.delta * d;
    const fr = frameAt(host, s, this._f2);
    // The branch starts lying over the host's channel (centered on the edge of its floor, so
    // it covers the floor and the flattened shelf), then slides out sideways.
    const aIn = fr.wf;
    const R = fr.w + this._thick(host) + wb + 4;
    const X = ln.side * (aIn + (R - aIn) * sst(0, ln.len, d));
    out.x = fr.x + fr.rx * X; out.y = fr.y + fr.ry * X; out.z = fr.z + fr.rz * X;
    out.ux = fr.ux; out.uy = fr.uy; out.uz = fr.uz;
    out.tx = fr.tx * ln.delta; out.ty = fr.ty * ln.delta; out.tz = fr.tz * ln.delta;
    out.hx = fr.x; out.hy = fr.y; out.hz = fr.z;
    return out;
  }
  _laneSpan(ln) {
    return ln.delta > 0 ? [ln.sAtt - 40, ln.sAtt + ln.len + 30] : [ln.sAtt - ln.len - 30, ln.sAtt + 40];
  }
  _resFree(host, ln) {
    const a = ln.delta > 0 ? ln.sAtt - 40 : ln.sAtt - ln.len - 30, b = ln.delta > 0 ? ln.sAtt + ln.len + 30 : ln.sAtt + 40;
    if (!host.closed && (a < 0 || b > host.L)) return false;
    for (const [c, d] of host.res[ln.side]) {
      if (host.closed) { if (Math.abs(wrapS((a + b) / 2 - (c + d) / 2, host.L)) < (b - a + d - c) / 2) return false; }
      else if (a < d && b > c) return false;
    }
    return true;
  }
  _inFree(host, ln) {
    const a = ln.delta > 0 ? ln.sAtt - 40 : ln.sAtt - ln.len - 30, b = ln.delta > 0 ? ln.sAtt + ln.len + 30 : ln.sAtt + 40;
    for (const [c, d, side] of host.free) if ((side === 0 || side === ln.side) && a >= c && b <= d) return true;
    return false;
  }
  _reserve(host, ln) { host.res[ln.side].push(this._laneSpan(ln)); host.lanes.push(ln); }

  // Cut the host's walls for its lanes: the wall on a lane's side lowers into a flat shelf
  // while the branch is on it, and curls back up as the branch moves off.
  _finalizeCut(b) {
    const n = b.n;
    for (let i = 0; i < n; i++) {
      const s = i * b.sp;
      let c = b.cut0 ? b.cut0[i] : 0;
      for (const ln of b.lanes) {
        let ds = s - ln.sAtt;
        if (b.closed) ds = wrapS(ds, b.L);
        const d = ds * ln.delta;
        if (d < -26 || d > ln.len) continue;
        c += ln.side * sst(-25, 35, d) * (1 - sst(0.5 * ln.len, ln.len, d));
      }
      b.cut[i] = Math.max(-1, Math.min(1, c));
      if (Math.abs(b.cut[i]) > 0.2) b.tag[i] |= TAG.LANE;
    }
  }

  // --- building branches --------------------------------------------------------------------------

  _dims(tier) {
    const P = this.P;
    if (tier === TIER.ROOT) return { w: P.rootWidth, wf: P.rootFloor, lane: Math.max(80, P.laneLength), flow: P.rootFlow, rmin: 75, grade: 0.16 };
    if (tier === TIER.ROOTLET) return { w: P.rootletWidth, wf: P.rootletFloor, lane: Math.max(70, P.laneLength * 0.75), flow: P.rootletFlow, rmin: 48, grade: 0.2 };
    return { w: P.tendrilWidth, wf: P.tendrilFloor, lane: Math.max(60, P.laneLength * 0.55), flow: P.tendrilFlow, rmin: 34, grade: 0.24 };
  }

  // Fine points of a lane (d from 0 to len, or back), with its channels.
  // Forward: d from 0 up to (not including) len; back: from just under len down to 0, so the
  // free middle (which starts and ends at d = len) joins on.
  _pushLane(F, host, ln, wb, back) {
    const o = this._f3, n = Math.max(2, Math.ceil(ln.len / NET.FINE));
    for (let q = 0; q < n; q++) {
      const d = back ? ln.len - (ln.len * (q + 1)) / n : (ln.len * q) / n;
      this._lane(host, ln, d, wb, o);
      F.push(o.x, o.y, o.z, 1, d, o.ux, o.uy, o.uz, o.hx, o.hy, o.hz, 0, 0, 1, 1e9);
    }
  }
  _laneEnd(host, ln, wb) {
    const o = this._lane(host, ln, ln.len, wb, {});
    const hl = Math.hypot(o.tx, o.tz) || 1;
    return { x: o.x, y: o.y, z: o.z, hx: o.tx / hl, hz: o.tz / hl, g: o.ty / hl, ux: o.ux, uy: o.uy, uz: o.uz, cx: o.hx, cy: o.hy, cz: o.hz };
  }

  // A smooth horizontal path from E to M (each {x, z, hx, hz}) through waypoints: Hermite
  // pieces with Catmull-Rom headings. Returns points about FINE apart.
  _path2D(E, M, wps, tk = 1, step = NET.FINE) {
    const pts = [{ x: E.x, z: E.z }, ...wps, { x: M.x, z: M.z }];
    const hs = pts.map((p, i) => {
      if (i === 0) return { x: E.hx, z: E.hz };
      if (i === pts.length - 1) return { x: M.hx, z: M.hz };
      const dx = pts[i + 1].x - pts[i - 1].x, dz = pts[i + 1].z - pts[i - 1].z, l = Math.hypot(dx, dz) || 1;
      return { x: dx / l, z: dz / l };
    });
    const X = [], Z = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], c = Math.hypot(b.x - a.x, b.z - a.z);
      const m0x = hs[i].x * c * tk, m0z = hs[i].z * c * tk, m1x = hs[i + 1].x * c * tk, m1z = hs[i + 1].z * c * tk;
      const N = Math.max(6, Math.ceil((c * 1.2) / step));
      for (let q = 0; q < N; q++) {
        const u = q / N, u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        X.push(h00 * a.x + h10 * m0x + h01 * b.x + h11 * m1x);
        Z.push(h00 * a.z + h10 * m0z + h01 * b.z + h11 * m1z);
      }
    }
    X.push(M.x); Z.push(M.z);
    // Even out the spacing.
    const S = [0];
    for (let i = 1; i < X.length; i++) S.push(S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]));
    const L = S[S.length - 1], n = Math.max(3, Math.round(L / step) + 1);
    const x = new Float64Array(n), z = new Float64Array(n), s = new Float64Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t = (L * i) / (n - 1);
      while (k < X.length - 2 && S[k + 1] < t) k++;
      const f = (t - S[k]) / Math.max(1e-9, S[k + 1] - S[k]);
      x[i] = X[k] + (X[k + 1] - X[k]) * f; z[i] = Z[k] + (Z[k + 1] - Z[k]) * f; s[i] = t;
    }
    return { x, z, s, L };
  }

  // Largest curvature of a horizontal path (ignoring `skip` meters at each end).
  _maxCurv(p, skip = 0) {
    let km = 0;
    for (let i = 1; i < p.x.length - 1; i++) {
      if (p.s[i] < skip || p.L - p.s[i] < skip) continue;
      const ax = p.x[i] - p.x[i - 1], az = p.z[i] - p.z[i - 1], bx = p.x[i + 1] - p.x[i], bz = p.z[i + 1] - p.z[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6) continue;
      const cr = (ax * bz - az * bx) / (la * lb), dt = (ax * bx + az * bz) / (la * lb);
      const k = Math.abs(Math.atan2(cr, dt)) / (0.5 * (la + lb));
      if (k > km) km = k;
    }
    return km;
  }

  // Probes of a band for clearance checks: footprint half-width and how far it reaches above
  // and below its axis.
  _probes(b, mid0 = 0, mid1 = Infinity) {
    // Whole-band probes are the same every time (loops are probed by every knot round them).
    const whole = mid0 === 0 && mid1 === Infinity;
    if (whole && b._pr) return b._pr;
    const P = this.P, out = [], T = this._thick(b), cordR = Math.max(1.5, P.cordRadius);
    if (whole) b._pr = out;
    for (let i = 0; i < b.n; i++) {
      if (b.pres[i] < 0.3 && b.cord[i] < 0.3) continue;
      const uy = Math.min(1, Math.abs(b.uy[i])), tilt = Math.sqrt(Math.max(0, 1 - uy * uy));
      const w = b.w[i], wall = wallH(w, b.wf[i], b.kap[i]);
      const c = b.cord[i];
      const s = i * b.sp;
      out.push({
        x: b.x[i], y: b.y[i], z: b.z[i],
        ah: w * uy + tilt * Math.max(wall, T) + 2,
        va: wall + tilt * w, vb: (c > 0.3 ? Math.max(T, 2 * cordR) : T) + tilt * w,
        b, s, i, mid: s >= mid0 && s <= mid1,
      });
    }
    return out;
  }

  // Do probes p and q (from different bands) leave too little room between them? Returns how
  // far p would have to rise (up) or drop (dn) to clear q, or null if they are clear.
  _clash(p, q) {
    const dx = p.x - q.x, dz = p.z - q.z, lim = p.ah + q.ah + 4;
    if (dx * dx + dz * dz > lim * lim) return null;
    const up = 8 - ((p.y - p.vb) - (q.y + q.va));
    const dn = 8 - ((q.y - q.vb) - (p.y + p.va));
    if (up <= 0 || dn <= 0) return null;
    return { up, dn };
  }

  _check(probes, idx, skip, selfSep) {
    const hits = [], cs = idx.c, m = idx.m;
    for (let pi = 0; pi < probes.length; pi++) {
      const p = probes[pi], r = p.ah + idx.maxAh + 4;
      const gx0 = Math.floor((p.x - r) / cs), gx1 = Math.floor((p.x + r) / cs), gz0 = Math.floor((p.z - r) / cs), gz1 = Math.floor((p.z + r) / cs);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const a = m.get(idx._k(gx, gz));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const q = a[k];
          const dx = p.x - q.x, dz = p.z - q.z, lim = p.ah + q.ah + 4;
          if (dx * dx + dz * dz > lim * lim) continue;
          const up = 8 - ((p.y - p.vb) - (q.y + q.va));
          const dn = 8 - ((q.y - q.vb) - (p.y + p.va));
          if (up <= 0 || dn <= 0) continue;
          if (skip(p, q)) continue;
          hits.push({ p, q, up, dn });
        }
      }
    }
    for (let a = 0; a < probes.length; a += 2) for (let c = a + 2; c < probes.length; c += 2) {
      const p = probes[a], q = probes[c];
      if (q.s - p.s < selfSep) continue;
      const k = this._clash(p, q);
      if (k) hits.push({ p, q, up: k.up, dn: k.dn, self: true });
    }
    return hits;
  }

  // Build a band from fine points (see Fine) and its description.
  _finish(key, F, d) {
    const P = this.P;
    const rs = resample(F.x, F.y, F.z, F.ch, NET.STEP);
    const b = new Band(key, rs);
    const [LW, DL, HUX, HUY, HUZ, HCX, HCY, HCZ, MID, STEEP, WMUL, TIPD] = rs.ch;
    b.cls = CLS.ROOT; b.tier = d.tier; b.flow = Math.max(0.5, d.flow);
    const n = b.n, Lane = d.lane;
    const r = mulberry32(d.seed);
    // Feature sections in the free middle: corkscrews and gaps.
    const roll = new Float64Array(n), gap = new Float64Array(n).fill(1), gaps = [];
    if (d.features) {
      const nb = Math.floor(b.L / NET.BSECTION) + 1;
      for (let q = 0; q < nb; q++) {
        const t = r(), sign = r() < 0.5 ? 1 : -1;
        const rc = d.cord ? 0 : Math.max(0, P.rapidsChance || 0) * (d.tier === TIER.ROOT ? 0.5 : 1);
        const ty = t < P.corkscrewChance && d.tier === TIER.ROOTLET ? 1 : t < P.corkscrewChance + P.gapChance ? 2
          : t < P.corkscrewChance + P.gapChance + rc ? 3 : 0;
        if (!ty) continue;
        const a = Math.round((q * NET.BSECTION) / b.sp), c = Math.round(((q + 1) * NET.BSECTION) / b.sp);
        if (c >= n) continue;
        let ok = true;
        for (let i = a; i <= c; i++) if (MID[i] < 0.99 || STEEP[i] > 0.01 || TIPD[i] < 200) { ok = false; break; }
        if (!ok) continue;
        if (ty === 2) {
          // A gap: 12 m of open air with a small kicker before it and the far side a little
          // lower, so a rider at any normal speed comes down onto it. Only where the band runs
          // about level or climbs.
          const g0 = q * NET.BSECTION + NET.BSECTION / 2 - 6, g1 = g0 + 12;
          const ia = Math.max(0, Math.round((g0 - 60) / b.sp)), ib = Math.min(n - 1, Math.round((g1 + 80) / b.sp));
          const slope = (b.y[ib] - b.y[ia]) / Math.max(1, (ib - ia) * b.sp);
          if (slope < -0.05 || slope > 0.15) continue;
          gaps.push([g0, g1]);
          continue;
        }
        for (let i = a; i <= c; i++) {
          const u = (i * b.sp - q * NET.BSECTION) / NET.BSECTION;
          if (ty === 1 && !d.cord) roll[i] = sign * TAU * sst(0.15, 0.85, u);
          // Rapids: standing waves building through the section, with one big hump (a kicker)
          // near its end.
          if (ty === 3) b.rap[i] = Math.max(b.rap[i], sst(0, 0.18, u) * (1 - sst(0.88, 1, u)) + Math.exp(-(((u - 0.8) / 0.05) ** 2)));
        }
      }
    }
    for (const [g0, g1] of gaps) {
      for (let i = 0; i < n; i++) {
        const s = i * b.sp;
        if (s > g0 - 45 && s < g0) b.y[i] += 1.6 * sst(g0 - 45, g0, s);
        if (s > g1 && s < g1 + 80) b.y[i] -= 4 * (1 - sst(g1, g1 + 80, s));
        gap[i] *= 1 - sst(g0 - 2, g0, s) * (1 - sst(g1, g1 + 2, s));
      }
    }
    computeUps(b, P, null, roll, STEEP, [HUX, HUY, HUZ], LW);
    const phi = Math.max(5, d.wallDeg || P.rootWall) * DEG;
    const xs = {};
    b.cut0 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * b.sp;
      const wm = WMUL[i];
      const w = d.w * wm, wf = d.wf * wm;
      xsec(xs, wf, Math.max(2, (w - wf) / phi), phi);
      // A branch emerges from (and sinks back into) its host's floor flat: it lies on the
      // host's shelf as a flat plate, and its outer wall curls up as it moves off.
      let wall = 1;
      if (d.attachStart) wall *= 0.25 + 0.75 * sst(0, 70, s);
      if (d.attachEnd) wall *= 0.25 + 0.75 * sst(0, 70, b.L - s);
      b.wf[i] = xs.wf; b.kap[i] = xs.kap * Math.max(0.002, wall); b.w[i] = xs.w;
      // The inner side lies flat on the host's floor while in a lane.
      if (DL[i] < Lane) {
        const ia = Math.max(0, i - 1), ic = Math.min(n - 1, i + 1);
        let tx = b.x[ic] - b.x[ia], ty = b.y[ic] - b.y[ia], tz = b.z[ic] - b.z[ia];
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const rx = ty * b.uz[i] - tz * b.uy[i], ry = tz * b.ux[i] - tx * b.uz[i], rz = tx * b.uy[i] - ty * b.ux[i];
        const toHost = (HCX[i] - b.x[i]) * rx + (HCY[i] - b.y[i]) * ry + (HCZ[i] - b.z[i]) * rz;
        // In step with the host's wall curling back up (see _finalizeCut), so the two part as a
        // V, never a ridge across a shared floor.
        b.cut0[i] = (toHost >= 0 ? 1 : -1) * (1 - sst(0.5 * Lane, Lane, DL[i]));
      }
      let pr = gap[i];
      if (d.attachStart) pr *= sst(0, 4, s);
      if (d.fadeStart) pr *= sst(0, 12, s);   // (a dock rising out of an island's ground)
      if (d.attachEnd) pr *= sst(0, 4, b.L - s);
      if (d.tip) pr *= 1 - sst(b.L - 14, b.L - 1, s);
      b.pres[i] = pr;
      if (d.cord) b.cord[i] = sst(Lane + 20, Lane + 90, Math.min(s, b.L - s)) * MID[i];
      // Chutes run white where they are steep.
      if (d.rapids === 'steep') {
        const ia = Math.max(0, i - 1), ic = Math.min(n - 1, i + 1);
        const gr = Math.abs(b.y[ic] - b.y[ia]) / Math.max(1, Math.hypot(b.x[ic] - b.x[ia], b.z[ic] - b.z[ia]));
        b.rap[i] = 0.75 * MID[i] * sst(0.22, 0.38, gr);
      }
      b.tag[i] = (LW[i] > 0.5 ? TAG.LANE : 0) | (Math.abs(roll[i]) > 0.3 && Math.abs(roll[i]) < TAU - 0.3 ? TAG.TWIST : 0)
        | (STEEP[i] > 0.3 ? TAG.SPIRAL : 0) | (d.knot ? TAG.KNOT : 0) | (TIPD[i] < 160 || gaps.some(([g0]) => s > g0 - 120 && s < g0) ? TAG.TIP : 0)
        | (b.rap[i] > 0.3 ? TAG.RAPIDS : 0) | (d.tag || 0);
    }
    b.cut.set(b.cut0);
    // (how far into its lanes each sample is: the water in a lane follows the host's, see
    // bandWater in braids.js)
    b.dl = Float32Array.from(DL);
    b.bbox(d.w + this.P.rootThickness + Math.max(1.5, P.cordRadius) * 2 + 10);
    // Where its own branches may attach: the free middle, clear of corkscrews, gaps, spirals,
    // cords and the tip.
    const okAt = (i) => MID[i] > 0.99 && Math.abs(roll[i]) < 1e-3 && gap[i] > 0.999 && STEEP[i] < 0.01 && TIPD[i] > 220 && b.cord[i] < 0.01 && b.rap[i] < 0.05;
    let a = -1;
    for (let i = 0; i <= n; i++) {
      const ok = i < n && okAt(i);
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) { const s0 = a * b.sp + 30, s1 = (i - 1) * b.sp - 30; if (s1 - s0 > 120) b.free.push([s0, s1, 0]); a = -1; }
    }
    return b;
  }

  // Try a candidate: build it, keep it clear of everything already in idx (lifting or lowering
  // its free middle over or under whatever it would hit), and on success register its lanes.
  // spec: { key, tier, F (Fine), mid0, mid1 (free middle, fine arclength), lanes: [{host, ln}],
  //         d (finish options), idx, inside (poly or null), weave (+1 prefer over, -1 under) }
  _commit(spec) {
    const P = this.P;
    this.stats.tries++;
    const why = (w) => { this.stats.why[w] = (this.stats.why[w] || 0) + 1; return null; };
    const F = spec.F;
    const cum = new Float64Array(F.n);
    for (let k = 1; k < F.n; k++) cum[k] = cum[k - 1] + Math.hypot(F.x[k] - F.x[k - 1], F.y[k] - F.y[k - 1], F.z[k] - F.z[k - 1]);
    const L = cum[F.n - 1];
    const y0 = F.y.slice();
    const bumps = [];
    const skip = (p, q) => {
      // A wrap keeps its own distance from its host (by construction).
      if (spec.skipHost && q.b === spec.skipHost) return true;
      if (spec.skipIsland && q.isl === spec.skipIsland) return true;   // (a dock and its island)
      for (const l of spec.lanes) {
        if (q.b !== l.host) continue;
        // In its lane a branch lies on its host; leaving (or joining) it, it runs beside it for
        // a while (side by side is fine there, on top of it is not).
        const inLane = l.atStart ? p.s < l.ln.len + 12 : p.s > L - l.ln.len - 12;
        const near = l.atStart ? p.s < l.ln.len + 150 : p.s > L - l.ln.len - 150;
        if (!near) continue;
        let ds = q.s - l.ln.sAtt;
        if (l.host.closed) ds = wrapS(ds, l.host.L);
        if (Math.abs(ds) > l.ln.len + 190) continue;
        if (inLane) return true;
        if (Math.hypot(p.x - q.x, p.z - q.z) > Math.max(p.ah, q.ah) + 2) return true;
      }
      return false;
    };
    const minY = P.floorAltitude + 70;
    for (let it = 0; it < 4; it++) {
      // Apply bumps to the free middle.
      if (bumps.length) {
        for (let k = 0; k < F.n; k++) {
          const s = cum[k];
          if (s < spec.mid0 || s > spec.mid1) { F.y[k] = y0[k]; continue; }
          const mask = sst(spec.mid0, spec.mid0 + 30, s) * sst(spec.mid1, spec.mid1 - 30, s);
          let dy = 0;
          for (const B of bumps) dy += B.amp * sst(B.s0 - B.r, B.s0, s) * (1 - sst(B.s1, B.s1 + B.r, s));
          F.y[k] = y0[k] + dy * mask;
        }
      }
      // Grade and floor.
      let bad = false;
      for (let k = 1; k < F.n && !bad; k++) {
        if (F.y[k] < minY) bad = true;
        const ds = Math.hypot(F.x[k] - F.x[k - 1], F.z[k] - F.z[k - 1]);
        if (ds > 0.5 && Math.abs(F.y[k] - F.y[k - 1]) / ds > spec.grade + 0.08 && cum[k] > spec.mid0 && cum[k] < spec.mid1) bad = true;
      }
      if (bad) {
        if (globalThis.__gradeDbg) { let gm = 0, ym = 1e9; for (let k = 1; k < F.n; k++) { const ds = Math.hypot(F.x[k] - F.x[k - 1], F.z[k] - F.z[k - 1]); if (ds > 0.5 && cum[k] > spec.mid0 && cum[k] < spec.mid1) gm = Math.max(gm, Math.abs(F.y[k] - F.y[k - 1]) / ds); ym = Math.min(ym, F.y[k]); } globalThis.__gradeDbg.push([spec.key, spec.grade, +gm.toFixed(2), +ym.toFixed(0), bumps.length, +(spec.mid1 - spec.mid0).toFixed(0)]); }
        return why('grade/floor');
      }
      const b = this._finish(spec.key, F, spec.d);
      const sc = b.L / Math.max(1e-9, L);
      const probes = this._probes(b, spec.mid0 * sc, spec.mid1 * sc);
      // Stay on this layer's side of the midlines to the layers above and below.
      const bd = spec.bounds;
      if (bd) {
        for (let k = 0; k < probes.length; k += 2) {
          const p = probes[k], top = p.y + p.va, bot = p.y - p.vb;
          if (bot > bd.loMax && top < bd.hiMin) continue;
          const B = this.net.bounds(this.li, p.x, p.z);
          if (bot < B.lo || top > B.hi) return why('layer bounds');
        }
      }
      if (spec.inside) {
        for (const p of probes) if (p.mid && (p.i % 3 === 0) && !this._inside(spec.inside, p.x, p.z)) return why('outside');
      }
      if (spec.rect) {
        const r = spec.rect;
        for (const p of probes) if (p.x < r[0] || p.x > r[1] || p.z < r[2] || p.z > r[3]) return why('outside');
      }
      const hits = this._check(probes, spec.idx, skip, 3 * (spec.d.w + P.rootThickness) + 60);
      if (!hits.length) {
        for (const l of spec.lanes) this._reserve(l.host, l.ln);
        b.attach = spec.lanes;   // (its hosts and lanes, for its water)
        if (spec.span) { const [h, a, c] = spec.span; h.res[1].push([a, c]); h.res[-1].push([a, c]); }
        for (const p of probes) spec.idx.add(p);
        this.stats.built++;
        return b;
      }
      if (it === 3 || spec.noBump) return why(spec.noBump ? 'clash(wrap)' : 'clash after bumps');
      // Group the hits into runs along the candidate and lift or lower each run.
      const runs = [];
      for (const h of hits) {
        if (h.self) return why('self');
        if (!h.p.mid) return why('clash in lane');
        const s = h.p.s / sc;
        let R = runs.find((u) => s > u.s0 - 40 && s < u.s1 + 40);
        if (!R) { R = { s0: s, s1: s, up: 0, dn: 0 }; runs.push(R); }
        R.s0 = Math.min(R.s0, s); R.s1 = Math.max(R.s1, s);
        R.up = Math.max(R.up, h.up); R.dn = Math.max(R.dn, h.dn);
      }
      if (globalThis.__bumpDbg) for (const R of runs) globalThis.__bumpDbg.push([spec.key, it, +R.s0.toFixed(0), +R.s1.toFixed(0), +(spec.mid0).toFixed(0), +(spec.mid1).toFixed(0), +R.up.toFixed(0), +R.dn.toFixed(0), hits.filter((h) => Math.abs(h.p.s / sc - R.s0) < R.s1 - R.s0 + 50).map((h) => h.q.b ? h.q.b.kind : 'twin')[0]]);
      for (const R of runs) {
        const pref = spec.weave || 0;
        const goUp = pref > 0 ? R.up < R.dn * 1.6 : pref < 0 ? R.up * 1.6 < R.dn : R.up <= R.dn;
        const amp = goUp ? R.up + 3 : -(R.dn + 3);
        const r = Math.max(100, Math.abs(amp) / 0.11);
        bumps.push({ s0: R.s0 - 10, s1: R.s1 + 10, r, amp });
        if (R.s0 - 10 - r < spec.mid0 - 10 || R.s1 + 10 + r > spec.mid1 + 10) {
          // Too close to a lane: squeeze the ramp (steeper) if there is room at all.
          const room = Math.min(R.s0 - 10 - spec.mid0, spec.mid1 - R.s1 - 10);
          if (room < Math.max(60, Math.abs(amp) / 0.24)) return why('bump near lane');
          bumps[bumps.length - 1].r = Math.min(r, room);
        }
      }
    }
    return null;
  }

  // --- knots -----------------------------------------------------------------------------------

  // Three connectors at node (i, j), weaving over and under each other in the middle.
  knot(i, j) { return this._get(`K|${i}|${j}`, () => this._buildKnot(i, j)); }

  _buildKnot(i, j) {
    const P = this.P;
    const X = this.node(i, j);
    const fs = this.facesAt(i, j).map(([a, b]) => {
      const L = this.faceLoop(a, b);
      const c = L.ids.findIndex(([p, q]) => p === i && q === j);
      return { L, c, from: L.ids[(c + 5) % 6], to: L.ids[(c + 1) % 6] };
    });
    const idx = new Index(40);
    for (const f of fs) {
      const b = f.L.band;
      for (const p of this._probes(b)) if (Math.hypot(p.x - X.x, p.z - X.z) < 900) idx.add(p);
    }
    const r = mulberry32(cellHash3(i, j, 83, this.seedH));
    const dm = this._dims(TIER.ROOT);
    const LaneK = Math.max(60, P.knotLane);
    const bounds = this.net.boundsBox(this.li, X.x - 900, X.x + 900, X.z - 900, X.z + 900);
    const bands = [];
    let weave = r() < 0.5 ? 1 : -1;
    for (const f of fs) {
      // The trunk f's loop does not touch at this node: the connector goes onto it.
      const nbs = this.nbrs(i, j);
      const third = nbs.find(([p, q]) => !(p === f.from[0] && q === f.from[1]) && !(p === f.to[0] && q === f.to[1]));
      const g = fs.find((h) => h.to[0] === third[0] && h.to[1] === third[1]);
      if (!g) continue;
      const LF = f.L.band, LG = g.L.band;
      const lnA = { sAtt: ((f.L.cornerS[f.c].sIn - 12 - LaneK) % LF.L + LF.L) % LF.L, delta: 1, side: -1, len: LaneK };
      const lnB = { sAtt: (g.L.cornerS[g.c].sOut + 12 + LaneK) % LG.L, delta: -1, side: -1, len: LaneK };
      const F = new Fine();
      this._pushLane(F, LF, lnA, dm.w, false);
      const E = this._laneEnd(LF, lnA, dm.w), Mr = this._laneEnd(LG, lnB, dm.w);
      const M = { ...Mr, hx: -Mr.hx, hz: -Mr.hz, g: -Mr.g };
      const path = this._path2D(E, M, [], 0.9);
      const mid0 = this._arclen(F);
      for (let q = 0; q < path.x.length; q++) {
        const u = path.s[q] / path.L, y = E.y + (M.y - E.y) * sst(0, 1, u);
        const away = Math.min(path.s[q], path.L - path.s[q]);
        const hu = u < 0.5 ? E : Mr;
        F.push(path.x[q], y, path.z[q], 1 - sst(0, 70, away), 1e9, hu.ux, hu.uy, hu.uz, hu.cx, hu.cy, hu.cz, sst(30, 90, away), 0, 1, 1e9);
      }
      const mid1 = mid0 + path.L;
      this._pushLane(F, LG, lnB, dm.w, true);
      const b = this._commit({
        key: `knot ${i},${j}`, F, mid0: mid0 + 10, mid1: mid1 - 10, lanes: [{ host: LF, ln: lnA, atStart: true }, { host: LG, ln: lnB, atStart: false }],
        d: { tier: TIER.ROOT, w: dm.w, wf: dm.wf, lane: LaneK, flow: dm.flow, seed: cellHash3(i, j, 90 + bands.length, this.seedH), attachStart: true, attachEnd: true, knot: true, features: false },
        idx, inside: null, grade: 0.32, weave, bounds,
      });
      weave = -weave;
      if (b) bands.push(b);
    }
    return { bands, X };
  }

  // --- roots inside a face ---------------------------------------------------------------------

  faceRoots(fi, fj) { return this._get(`R|${fi}|${fj}`, () => this._buildRoots(fi, fj)); }

  _buildRoots(fi, fj) {
    const P = this.P;
    const L = this.faceLoop(fi, fj), lb = L.band;
    const rng = mulberry32(cellHash3(fi, fj, 77, this.seedH));
    const idx = new Index(40);
    for (const p of this._probes(lb)) idx.add(p);
    // The other strand of each trunk (it swings onto this side where they twine).
    const o = {};
    for (const p of L.portions) {
      const E = p.E;
      for (let s = E.SA; s <= E.Lc - E.SB; s += NET.STEP) {
        this.strandAt(E, s, -p.sig, o);
        idx.add({ x: o.x, y: o.y, z: o.z, ah: P.trunkWidth + 2, va: wallH(P.trunkWidth, P.trunkFloor, 1), vb: P.trunkThickness, b: null, s, i: -1, mid: false });
      }
    }
    const ctx = { L, lb, idx, rng, roots: [], byTier: [[lb], [], [], []], bounds: this.net.boundsBox(this.li, lb.box[0], lb.box[1], lb.box[2], lb.box[3]) };
    // Islands: roots keep clear of this face's islands and of the islands between this layer
    // and the next ones (which this layer's roots could hang or arch into). Each island in the
    // face gets its docks first: a stream from the loop onto it, one from it back to the loop.
    const box = lb.box, own = this.islandsOf(fi, fj);
    const near = [...own];
    if (P.layersOn) for (const li of [this.li - 1, this.li + 1]) {
      if (li < 0 || li > 2) continue;
      for (const I of this.net.layers[li].islandsIn(box[0], box[1], box[2], box[3])) if (I.kind === 'between' && !near.includes(I)) near.push(I);
    }
    for (const I of near) for (const p of this._islandProbes(I)) idx.add(p);
    const docks = [];
    for (const I of own) {
      if (I.kind !== 'layer') continue;
      for (const make of [this._dockIn, this._dockOut]) {
        const b = make.call(this, ctx, I);
        if (b) { ctx.roots.push(b); docks.push(b); }
      }
    }
    const want = [0, Math.round(P.rootsPerFace), Math.round(P.rootletsPerFace), Math.round(P.tendrilsPerFace)];
    for (let tier = 1; tier <= 3; tier++) {
      for (let c = 0; c < want[tier]; c++) {
        for (let t = 0; t < 8; t++) {
          const b = this._tryRoot(ctx, tier);
          if (b) { ctx.roots.push(b); ctx.byTier[tier].push(b); break; }
        }
      }
    }
    // Launch lips: from an island's ground off its rim, over a stream below.
    for (const I of own) {
      if (I.kind !== 'layer') continue;
      const b = this._launchLip(ctx, I);
      if (b) ctx.roots.push(b);
    }
    for (const b of ctx.roots) this._finalizeCut(b);
    return { bands: ctx.roots };
  }

  // --- islands ---------------------------------------------------------------------------------

  // The islands of face (fi, fj): sometimes one in the layer, deep inside the face, clear of its
  // trunks; and (for the main and crown layers) sometimes one between this layer and the one
  // below. From the face's nodes only (no streams), so they are cheap and known everywhere.
  islandsOf(fi, fj) {
    return this._get(`I|${fi}|${fj}`, () => {
      const P = this.P, out = [];
      if (!P.islandsOn) return out;
      const ns = this.faceNodes(fi, fj).map(([i, j]) => this.node(i, j));
      let cx = 0, cz = 0;
      for (const n of ns) { cx += n.x / 6; cz += n.z / 6; }
      const a = this.dims().a, rng = mulberry32(cellHash3(fi, fj, 311 + 7 * this.li, this.seedH));
      // How far from the middle an island's edge may reach: well clear of the loop (its meander,
      // its strands and the knots' corners).
      const safe = 0.8 * a - Math.max(0, P.meanderAmp) - 260;
      const rmin = Math.max(30, P.islandMin), rmax = Math.max(rmin, P.islandMax);
      const place = (kind, y0, yr, avoid) => {
        const R = rmin + (rmax - rmin) * Math.pow(rng(), 1.4);
        for (let t = 0; t < 6; t++) {
          const room = safe - R * 1.4;
          if (room < 0) return null;
          const ang = rng() * TAU, d = Math.sqrt(rng()) * room;
          const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
          if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < avoid.Rmax + R * 1.4 + 250) continue;
          const y = y0(x, z) + yr * (rng() * 2 - 1);
          return new Island({ li: this.li, kind, x, z, y, R, seed: cellHash3(fi, fj, 8191 * (this.li + 1) + (kind === 'layer' ? 1 : 2), this.seedH) });
        }
        return null;
      };
      // An island's underside stays above the midline to the layer below (in a layer), or well
      // clear of the layer below (between layers).
      const below = this.li > 0 && P.layersOn;
      const clampD = (I, floorY) => { I.D = Math.min(I.D, I.y - 2 - floorY); return I.D >= 25; };
      let I0 = null;
      if (rng() < P.islandChance) {
        I0 = place('layer', (x, z) => this.net.field(this.li, x, z) + 15, 25, null);
        if (I0 && (!below || clampD(I0, (this.net.field(this.li - 1, I0.x, I0.z) + this.net.field(this.li, I0.x, I0.z)) / 2 + 20))) out.push(I0);
        else I0 = null;
      }
      if (below && rng() < P.islandBetween) {
        const I1 = place('between', (x, z) => (this.net.field(this.li - 1, x, z) + this.net.field(this.li, x, z)) / 2 + 20, 20, I0);
        if (I1) {
          const lo = this.net.field(this.li - 1, I1.x, I1.z), hi = this.net.field(this.li, I1.x, I1.z);
          if (I1.y - lo > 130 && hi - I1.y > 90 && clampD(I1, lo + 100)) out.push(I1);
        }
      }
      return out;
    });
  }

  // Islands of this layer near the box (faces from the lattice: no streams built).
  islandsIn(x0, x1, z0, z1) {
    const out = [];
    if (!this.P.islandsOn) return out;
    const { Sx, Sz } = this.dims();
    let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      const [a, c] = this.toLattice(x, z);
      lx0 = Math.min(lx0, a); lx1 = Math.max(lx1, a); lz0 = Math.min(lz0, c); lz1 = Math.max(lz1, c);
    }
    const fi0 = Math.floor(lx0 / Sx) - 3, fi1 = Math.floor(lx1 / Sx) + 1;
    const fj0 = Math.floor(lz0 / Sz) - 2, fj1 = Math.floor(lz1 / Sz) + 1;
    for (let fj = fj0; fj <= fj1; fj++) for (let fi = fi0; fi <= fi1; fi++) {
      if (mod2(fi + fj)) continue;
      for (const I of this.islandsOf(fi, fj)) {
        if (I.x + I.Rmax >= x0 && I.x - I.Rmax <= x1 && I.z + I.Rmax >= z0 && I.z - I.Rmax <= z1) out.push(I);
      }
    }
    return out;
  }

  // Clearance probes covering an island (see _clash): its ground and how far it hangs below.
  _islandProbes(I) {
    if (I._pr) return I._pr;
    const out = [], st = 24, n = Math.ceil(I.Rmax / st) + 1;
    for (let a = -n; a <= n; a++) for (let c = -n; c <= n; c++) {
      const x = I.x + a * st, z = I.z + c * st;
      if (I.rhat(x, z) > 1.08) continue;
      const t = I.top(x, z), bt = I.bottom(x, z);
      out.push({ x, y: t, z, ah: 18, va: 6, vb: t - bt, b: null, isl: I, s: 0, i: -1, mid: false });
    }
    I._pr = out;
    return out;
  }

  // A dock from the face's loop onto island I: it leaves the loop through an exit lane, runs to
  // the island's rim and on across its ground for a stretch, where it ends (you step off).
  _dockIn(ctx, I) {
    const dm = this._dims(TIER.ROOT), host = ctx.lb, rng = mulberry32((I.seed ^ 0x51ed27) >>> 0);
    const run = 46;
    for (let t = 0; t < 10; t++) {
      const lnA = this._pickLane(host, 1, dm.lane, rng);
      if (!lnA) return null;
      const E = this._laneEnd(host, lnA, dm.w);
      const dx = I.x - E.x, dz = I.z - E.z, D = Math.hypot(dx, dz);
      if (D < I.Rmax + 260 || D > I.Rmax + 2200 * this.sc) continue;
      if ((E.hx * dx + E.hz * dz) / D < 0.25) continue;
      const th = Math.atan2(E.z - I.z, E.x - I.x), Rp = I.rimAt(th);
      const yR = I.top(Rp.x, Rp.z) + DOCK_LIFT;
      if (Math.abs(yR - E.y) > (D - I.Rmax) * dm.grade * 0.6) continue;
      const M = { x: Rp.x, z: Rp.z, y: yR, hx: -Math.cos(th), hz: -Math.sin(th), g: 0 };
      const F = new Fine();
      this._pushLane(F, host, lnA, dm.w, false);
      const mid0 = this._arclen(F);
      const W = this._wander(E, M, null, TIER.ROOT, rng);
      const path = this._middle(F, E, M, E, W, () => 0, TIER.ROOT, { tip: true, runout: run }, ctx.L.poly);
      if (!path) continue;
      // The run-in lies on the island's ground.
      for (let k = F.n - Math.ceil(run / 4) - 1; k < F.n; k++) {
        const g = I.ground(F.x[k], F.z[k]);
        if (g !== null) F.y[k] = g + DOCK_LIFT;
      }
      const mid1 = this._arclen(F);
      const b = this._commit({
        key: `dock in ${ctx.L.fi},${ctx.L.fj}`, F, mid0: mid0 + 10, mid1: mid1 - run - 30,
        lanes: [{ host, ln: lnA, atStart: true }],
        d: { tier: TIER.ROOT, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed: hashu((I.seed + 11) >>> 0), attachStart: true, attachEnd: false, tip: true, cord: false, features: false, tag: TAG.DOCK, wallDeg: 40 },
        idx: ctx.idx, inside: ctx.L.poly, bounds: ctx.bounds, grade: dm.grade, weave: 0, skipIsland: I,
      });
      if (b) { b.dock = { island: I, at: 'end' }; return b; }
    }
    return null;
  }

  // A dock from island I back to the face's loop: it rises out of the island's ground, runs off
  // its rim and joins the loop through a merge lane. Step onto it and call your board.
  _dockOut(ctx, I) {
    const dm = this._dims(TIER.ROOT), host = ctx.lb, rng = mulberry32((I.seed ^ 0x2c1b3c6d) >>> 0);
    const run = 46;
    for (let t = 0; t < 10; t++) {
      const lnB = this._pickLane(host, -1, dm.lane, rng);
      if (!lnB) return null;
      const Mr = this._laneEnd(host, lnB, dm.w), M = { ...Mr, hx: -Mr.hx, hz: -Mr.hz, g: -Mr.g };
      const dx = M.x - I.x, dz = M.z - I.z, D = Math.hypot(dx, dz);
      if (D < I.Rmax + 260 || D > I.Rmax + 2200 * this.sc) continue;
      // Arrive with the loop's flow, coming from the island's side.
      if ((M.hx * dx + M.hz * dz) / D < 0.25) continue;
      const th = Math.atan2(dz, dx), Rp = I.rimAt(th), ch = Math.cos(th), sh = Math.sin(th);
      const yR = I.top(Rp.x, Rp.z) + DOCK_LIFT;
      if (Math.abs(yR - M.y) > (D - I.Rmax) * dm.grade * 0.6) continue;
      const E = { x: Rp.x, z: Rp.z, y: yR, hx: ch, hz: sh, g: 0, ux: 0, uy: 1, uz: 0, cx: I.x, cy: yR, cz: I.z };
      const F = new Fine();
      // The run-in across the island's ground, out to the rim.
      const nr = Math.ceil(run / 4);
      for (let k = 0; k < nr; k++) {
        const d = run - (run * k) / nr, x = Rp.x - ch * d, z = Rp.z - sh * d, g = I.ground(x, z);
        F.push(x, (g !== null ? g : yR - DOCK_LIFT) + DOCK_LIFT, z, 0, 1e9, 0, 1, 0, I.x, yR, I.z, 0, 0, 1, 1e9);
      }
      const W = this._wander(E, M, Mr, TIER.ROOT, rng);
      const path = this._middle(F, E, M, Mr, W, () => 0, TIER.ROOT, {}, ctx.L.poly);
      if (!path) continue;
      const mid1 = this._arclen(F);
      this._pushLane(F, host, lnB, dm.w, true);
      const b = this._commit({
        key: `dock out ${ctx.L.fi},${ctx.L.fj}`, F, mid0: run + 30, mid1: mid1 - 10,
        lanes: [{ host, ln: lnB, atStart: false }],
        d: { tier: TIER.ROOT, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed: hashu((I.seed + 13) >>> 0), attachStart: false, attachEnd: true, fadeStart: true, cord: false, features: false, tag: TAG.DOCK, wallDeg: 40 },
        idx: ctx.idx, inside: ctx.L.poly, bounds: ctx.bounds, grade: dm.grade, weave: 0, skipIsland: I,
      });
      if (b) { b.dock = { island: I, at: 'start' }; return b; }
    }
    return null;
  }

  // A launch lip: a short stream rising out of island I's ground that runs to the rim and ends
  // in a kicker aimed over a stream 20-80 m below (a hop off the island onto it).
  _launchLip(ctx, I) {
    const dm = this._dims(TIER.ROOTLET), rng = mulberry32((I.seed ^ 0x7f4a7c15) >>> 0);
    const cands = [];
    for (const tb of [ctx.lb, ...ctx.roots]) {
      if (tb.dock || !tb.hits(I.x - I.Rmax - 220, I.x + I.Rmax + 220, I.z - I.Rmax - 220, I.z + I.Rmax + 220)) continue;
      for (let i = 2; i < tb.n - 2; i += 2) {
        if (tb.pres[i] < 0.99 || tb.cord[i] > 0.01 || tb.tag[i] & (TAG.TWIST | TAG.SPIRAL | TAG.TIP | TAG.LANE | TAG.DOCK)) continue;
        const dx = tb.x[i] - I.x, dz = tb.z[i] - I.z, d = Math.hypot(dx, dz);
        const th = Math.atan2(dz, dx), rim = I.outline(th), out = d - rim;
        const Rp = I.rimAt(th), drop = I.top(Rp.x, Rp.z) - tb.y[i];
        if (drop < 20 || drop > 80) continue;
        // About where you come down off the kicker at the lip's speed (flat throw).
        const reach = LIP_SPEED * Math.sqrt((2 * drop) / (this.P.gravity * (this.P.fallGravity || 1.3)));
        if (Math.abs(out - reach) > 25) continue;
        // The stream runs on roughly the way you would fly (out from the island).
        const ia = tb.idx(i - 1), ic = tb.idx(i + 1);
        let tx = tb.x[ic] - tb.x[ia], tz = tb.z[ic] - tb.z[ia]; const tl = Math.hypot(tx, tz) || 1;
        if (Math.abs(tx * dx + tz * dz) / (tl * d) < 0.3) continue;
        cands.push({ th, Rp });
      }
    }
    if (!cands.length) return this._why('lip: nothing below');
    const c = cands[Math.floor(rng() * cands.length)], ch = Math.cos(c.th), sh = Math.sin(c.th);
    // A long run-in across the island, so the lip has you up to speed by the kicker.
    const run = Math.min(150, 1.7 * I.outline(c.th)), kick = 16, F = new Fine(), n = Math.ceil(run / 3);
    // On the ground, then level out over the rim's rounded edge (no crest to throw you early),
    // up a little at the kicker.
    let yHold = -Infinity;
    for (let k = 0; k <= n; k++) {
      const d = run - (run * k) / n, x = c.Rp.x - ch * d, z = c.Rp.z - sh * d, g = I.ground(x, z);
      let y = (g !== null ? g : I.top(x, z)) + DOCK_LIFT;
      if (I.rhat(x, z) > 0.72) { if (yHold === -Infinity) yHold = y; y = Math.max(y, yHold); }
      y += 1.6 * sst(kick, 0, d);
      F.push(x, y, z, 0, 1e9, 0, 1, 0, I.x, y, I.z, 1, 0, 1 - 0.25 * sst(kick * 2, 0, d), d);
    }
    const b = this._commit({
      key: `lip ${ctx.L.fi},${ctx.L.fj}`, F, mid0: 0, mid1: run,
      lanes: [],
      d: { tier: TIER.ROOTLET, w: dm.w, wf: dm.wf, lane: dm.lane, flow: LIP_FLOW, seed: hashu((I.seed + 17) >>> 0), attachStart: false, attachEnd: false, fadeStart: true, tip: true, cord: false, features: false, tag: TAG.DOCK | TAG.UP, wallDeg: 40 },
      idx: ctx.idx, inside: ctx.L.poly, bounds: null, grade: 0.5, weave: 0, skipIsland: I, noBump: true,
    });
    if (b) b.dock = { island: I, at: 'start', lip: true };
    return b;
  }

  // A random place on a host for a lane of length len (exit: delta +1, merge: -1).
  _pickLane(host, delta, len, rng, side0 = 0) {
    let tot = 0;
    for (const [a, b] of host.free) tot += Math.max(0, b - a);
    if (tot <= 0) return null;
    for (let t = 0; t < 6; t++) {
      let u = rng() * tot, iv = null;
      for (const f of host.free) { const l = Math.max(0, f[1] - f[0]); if (u <= l) { iv = f; break; } u -= l; }
      if (!iv) continue;
      const side = iv[2] !== 0 ? iv[2] : side0 || (rng() < 0.5 ? 1 : -1);
      const s = iv[0] + u;
      // sAtt is the attach point; the lane spans [sAtt, sAtt + len] (exit) or back (merge).
      const sAtt = delta > 0 ? Math.max(iv[0] + 40, Math.min(iv[1] - len - 30, s)) : Math.max(iv[0] + len + 30, Math.min(iv[1] - 40, s));
      const ln = { sAtt, delta, side, len };
      if (!this._inFree(host, ln) || !this._resFree(host, ln)) continue;
      return ln;
    }
    return null;
  }

  _tryRoot(ctx, tier) {
    const P = this.P, rng = ctx.rng;
    const dm = this._dims(tier);
    // Host and kind.
    let host, kind;
    const rk = rng();
    if (tier === TIER.ROOT) {
      host = ctx.lb;
      kind = ctx.byTier[1].length && rng() < P.fuseChance ? 'fuse' : 'span';
    } else {
      const room = (b) => b.free.some(([c, d]) => d - c > dm.lane + 120);
      const t1 = ctx.byTier[1].filter(room), t2 = ctx.byTier[2].filter(room);
      const pool = tier === TIER.ROOTLET ? (rng() < 0.85 && t1.length ? t1 : [ctx.lb])
        : (rng() < 0.55 && t2.length ? t2 : t1.length ? t1 : [ctx.lb]);
      host = pool[Math.floor(rng() * pool.length)];
      const wc = P.wrapChance, dc = P.dropChance;
      kind = rk < wc && host.cls === CLS.ROOT ? 'wrap' : rk < wc + dc ? 'drop' : 'link';
    }
    const lnA = this._pickLane(host, 1, dm.lane, rng, host === ctx.lb ? 1 : 0);
    if (!lnA) return this._why(`no exit lane t${tier}`);
    const seed = hashu(Math.floor(rng() * 4294967295));
    if (kind === 'wrap') return this._wrap(ctx, tier, host, lnA, rng, seed);
    if (kind === 'drop') return this._drop(ctx, tier, host, lnA, rng, seed);
    // Links: span (loop to loop), fuse (into a root), link (rootlets and tendrils: to a
    // nearby root or the loop). Targets are looked for at a suitable distance, where the
    // target's flow runs roughly the way the link would arrive.
    const E = this._laneEnd(host, lnA, dm.w);
    const sc = this.sc, [dmin, dmax] = tier === TIER.ROOT ? [800 * sc, 3600 * sc] : tier === TIER.ROOTLET ? [260, 1300 * Math.sqrt(sc)] : [140, 620];
    let pool;
    if (kind === 'span') pool = [ctx.lb];
    else if (kind === 'fuse') pool = ctx.byTier[1];
    else pool = [...ctx.byTier[1], ...(tier === TIER.TENDRIL ? ctx.byTier[2] : []), ctx.lb];
    const cands = [];
    for (const b of pool) {
      if (!b.hits(E.x - dmax, E.x + dmax, E.z - dmax, E.z + dmax)) continue;
      const st = b === ctx.lb ? 4 : 2;
      for (let i = 0; i < b.n; i += st) {
        const dx = b.x[i] - E.x, dz = b.z[i] - E.z, D = Math.hypot(dx, dz);
        if (D < dmin || D > dmax) continue;
        const s = i * b.sp;
        if (Math.abs(b.y[i] - E.y) > D * dm.grade * 0.6) continue;
        if (b === host) { let ds = s - lnA.sAtt; if (host.closed) ds = wrapS(ds, host.L); if (Math.abs(ds) < (tier === TIER.ROOT ? 1500 * sc : 450)) continue; }
        // Arrive along the target's flow, roughly toward it from E.
        const ia = b.idx(i - 1), ic = b.idx(i + 1);
        let tx = b.x[ic] - b.x[ia], tz = b.z[ic] - b.z[ia]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        // Ahead of E, and arriving with the target's flow (no hairpins).
        if ((tx * dx + tz * dz) / D < (tier === TIER.ROOT ? -0.2 : 0.25)) continue;
        const ahead = (E.hx * dx + E.hz * dz) / D;
        if (ahead < (tier === TIER.ROOT ? -0.3 : 0.3)) continue;
        // Smaller roots reach across to another root (off to the side), not along their own.
        if (tier !== TIER.ROOT && (b === host || ahead > 0.92)) continue;
        cands.push(b, s);
      }
    }
    let dst = null, lnB = null;
    const nc = cands.length / 2;
    for (let t = 0; t < 24 && !lnB && nc; t++) {
      const k = Math.floor(rng() * nc), b = cands[2 * k], s = cands[2 * k + 1];
      const side = b === ctx.lb ? 1 : 0;
      const ln = { sAtt: s, delta: -1, side: side || (rng() < 0.5 ? 1 : -1), len: dm.lane };
      if (!this._inFree(b, ln)) continue;
      if (!this._resFree(b, ln)) { if (side) continue; ln.side = -ln.side; if (!this._resFree(b, ln)) continue; }
      dst = b; lnB = ln;
    }
    if (!lnB) return this._why(`no target t${tier}`);
    return this._link(ctx, tier, host, lnA, dst, lnB, rng, seed);
  }

  // Free middle of a branch from E to M (headings, heights and slopes): a horizontal path
  // through waypoints, and a height profile from E to M with a sag or an arch.
  _middle(F, E, M, Mr, W, yshape, tier, end, poly, wps = []) {
    const dm = this._dims(tier);
    let path = this._path2D(E, M, wps, 0.9, 4);
    if (W) path = this._applyWander(path, W);
    if (this._maxCurv(path, 6) > 1 / dm.rmin) return this._why(`curv t${tier}`);
    if (poly) for (let q = 0; q < path.x.length; q += 4) if (!this._inside(poly, path.x[q], path.z[q])) return this._why('outside (path)');
    const S = path.L;
    for (let q = 0; q < path.x.length; q++) {
      const u = path.s[q] / S, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      let y = h00 * E.y + h10 * E.g * S + h01 * M.y + h11 * M.g * S;
      y += yshape(u, path.s[q]);
      const away = Math.min(path.s[q], end.tip ? 1e9 : S - path.s[q]);
      const nearE = u < 0.5 || end.tip;
      const hu = nearE ? E : Mr;
      F.push(path.x[q], y, path.z[q], 1 - sst(0, 70, away), 1e9, hu.ux, hu.uy, hu.uz, hu.cx, hu.cy, hu.cz,
        sst(30, 90, away), 0, end.wmul ? end.wmul(u) : 1, end.tip ? S - path.s[q] + (end.runout || 0) : 1e9);
    }
    // A straight run-out to a tip (drops): the kicker points the way you will land.
    if (end.runout) {
      const n = Math.ceil(end.runout / 4), q0 = path.x.length - 1;
      const y0 = F.y[F.n - 1];
      for (let k = 1; k <= n; k++) {
        const d = (end.runout * k) / n;
        F.push(path.x[q0] + M.hx * d, y0 + M.g * d, path.z[q0] + M.hz * d, 0, 1e9, E.ux, E.uy, E.uz, E.cx, E.cy, E.cz, 1, 0, end.wmul ? end.wmul(1) : 1, end.runout - d);
      }
    }
    return path;
  }

  _arclen(F) { let s = 0; for (let k = 1; k < F.n; k++) s += Math.hypot(F.x[k] - F.x[k - 1], F.y[k] - F.y[k - 1], F.z[k] - F.z[k - 1]); return s; }

  // Waypoints between E and M: wander to one side and the other.
  // A wander for the path from E to M: a sideways offset made of shapes that start and end
  // flat (sin^2, sin sin2, sin sin3), so the path leaves E and arrives at M along their lanes,
  // then curves off toward E's lane side (away from the host) and comes in to M from its lane
  // side; plus some free wiggle.
  _wander(E, M, Mr, tier, rng) {
    const pe = tier === TIER.ROOT ? 0.07 : tier === TIER.ROOTLET ? 0.09 : 0.1;
    return { E, M, Mr, peel: pe * (0.8 + 0.4 * rng()), c: (rng() - 0.5) * (tier === TIER.ROOT ? 0.06 : 0.04) };
  }
  _applyWander(path, W) {
    const n = path.x.length, L = path.L;
    // Left normal (the R side) of the base path at each point.
    const NX = new Float64Array(n), NZ = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0, c = i < n - 1 ? i + 1 : n - 1;
      const tx = path.x[c] - path.x[a], tz = path.z[c] - path.z[a], l = Math.hypot(tx, tz) || 1;
      NX[i] = -tz / l; NZ[i] = tx / l;
    }
    const nrm = (i) => ({ x: NX[i], z: NZ[i] });
    const sideOf = (P, C) => { const dx = P.x - C.cx, dz = P.z - C.cz, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
    const n0 = nrm(0), n1 = nrm(n - 1);
    const sE = sideOf(W.E, W.E), sEs = n0.x * sE.x + n0.z * sE.z >= 0 ? 1 : -1;
    let sMs = sEs;
    if (W.Mr) { const sM = sideOf(W.M, W.Mr); sMs = n1.x * sM.x + n1.z * sM.z >= 0 ? 1 : -1; }
    // Near u = 0, w ~ pi^2 u^2 (A + 2B + 3C); near u = 1, w ~ pi^2 (1-u)^2 (A - 2B + 3C).
    const c = W.c * L;
    const P0 = W.peel * L;
    const p = sEs * P0, q = W.Mr ? sMs * P0 : 0;
    const a = (p + q) / 2 - 3 * c, b = (p - q) / 4;
    const xs = new Float64Array(n), zs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = path.s[i] / L, su = Math.sin(Math.PI * u);
      const w = a * su * su + b * su * Math.sin(TAU * u) + c * su * Math.sin(3 * Math.PI * u);
      xs[i] = path.x[i] + NX[i] * w; zs[i] = path.z[i] + NZ[i] * w;
    }
    // Re-space evenly.
    const S = [0];
    for (let i = 1; i < n; i++) S.push(S[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    const L2 = S[n - 1], m = Math.max(3, Math.round(L2 / 4) + 1);
    const x = new Float64Array(m), z = new Float64Array(m), s = new Float64Array(m);
    let k = 0;
    for (let i = 0; i < m; i++) {
      const t = (L2 * i) / (m - 1);
      while (k < n - 2 && S[k + 1] < t) k++;
      const f = (t - S[k]) / Math.max(1e-9, S[k + 1] - S[k]);
      x[i] = xs[k] + (xs[k + 1] - xs[k]) * f; z[i] = zs[k] + (zs[k + 1] - zs[k]) * f; s[i] = t;
    }
    return { x, z, s, L: L2 };
  }

  _link(ctx, tier, host, lnA, dst, lnB, rng, seed) {
    const P = this.P, dm = this._dims(tier);
    const F = new Fine();
    this._pushLane(F, host, lnA, dm.w, false);
    const mid0 = this._arclen(F);
    const E = this._laneEnd(host, lnA, dm.w), Mr = this._laneEnd(dst, lnB, dm.w);
    const M = { ...Mr, hx: -Mr.hx, hz: -Mr.hz, g: -Mr.g };
    const W = this._wander(E, M, Mr, tier, rng);
    // Roots span the face through its interior: a waypoint deep inside, roughly between.
    const wps = [];
    if (tier === TIER.ROOT && dst === ctx.lb) {
      const R = ctx.L.poly.raster;
      for (let t = 0; t < 12; t++) {
        const Q = this._deepPoint(ctx.L.poly, R.dmax * 0.4, rng);
        if (!Q) break;
        const a = Math.hypot(Q.x - E.x, Q.z - E.z), c = Math.hypot(M.x - Q.x, M.z - Q.z), d = Math.hypot(M.x - E.x, M.z - E.z);
        if (a > 500 * this.sc && c > 500 * this.sc && a + c < d * 1.5 + 600 * this.sc) { wps.push(Q); break; }
      }
    }
    // Roots sag (hang) or arch between their ends.
    const sag = tier === TIER.ROOT ? P.rootSag : tier === TIER.ROOTLET ? P.rootSag * 0.5 : P.rootSag * 0.25;
    const D = Math.hypot(M.x - E.x, M.z - E.z);
    let A = Math.min(sag, 0.07 * D, (dm.grade * 0.5 * D) / Math.PI) * (rng() < 0.65 ? -(0.3 + 0.7 * rng()) : 0.6 * rng());
    // Where the layers pinch together there is less room to hang (or arch) in.
    const lim = this.net.bounds(this.li, (E.x + M.x) / 2, (E.z + M.z) / 2), ym = (E.y + M.y) / 2;
    A = A < 0 ? -Math.min(-A, Math.max(0, ym - lim.lo - 45)) : Math.min(A, Math.max(0, lim.hi - ym - 45));
    const path = this._middle(F, E, M, Mr, wps.length ? null : W, (u) => A * Math.sin(Math.PI * u) ** 2, tier, {}, ctx.L.poly, wps);
    if (!path) return null;
    let steep = null;
    // A spiral loop on some roots.
    if (tier === TIER.ROOT && rng() < P.spiralChance && path.L > 1200) steep = this._spiral(F, mid0 + 300 + rng() * (path.L - 1000), rng);
    const mid1 = this._arclen(F);
    this._pushLane(F, dst, lnB, dm.w, true);
    const cord = tier !== TIER.ROOT && rng() < P.cordChance * (tier === TIER.TENDRIL ? 0.8 : 0.4);
    return this._commit({
      key: `${['', 'root', 'rootlet', 'tendril'][tier]} ${ctx.L.fi},${ctx.L.fj}`, F, mid0: mid0 + 10, mid1: mid1 - 10,
      lanes: [{ host, ln: lnA, atStart: true }, { host: dst, ln: lnB, atStart: false }],
      d: { tier, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed, attachStart: true, attachEnd: true, cord, features: tier !== TIER.ROOT && !cord },
      idx: ctx.idx, inside: ctx.L.poly, bounds: ctx.bounds, grade: dm.grade, weave: rng() < 0.5 ? 1 : -1,
    });
  }

  // Replace a stretch of a fine path (from arclength sa) by a climbing loop off to one side.
  // Returns true if done.
  _spiral(F, sa, rng) {
    const P = this.P, SL = NET.TSECTION;
    const cum = [0];
    for (let k = 1; k < F.n; k++) cum.push(cum[k - 1] + Math.hypot(F.x[k] - F.x[k - 1], F.z[k] - F.z[k - 1]));
    const ka = cum.findIndex((s) => s >= sa), kb = cum.findIndex((s) => s >= sa + SL);
    if (ka < 3 || kb < 0 || kb >= F.n - 3) return false;
    let hx = F.x[ka + 2] - F.x[ka - 2], hz = F.z[ka + 2] - F.z[ka - 2]; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const side = rng() < 0.5 ? 1 : -1, nx = -hz * side, nz = hx * side;
    const R = Math.max(40, P.spiralRadius);
    const nf = new Fine();
    for (let k = 0; k < ka; k++) nf.copy(F, k, F.x[k], F.y[k], F.z[k], 0, F.ch[10][k], F.ch[11][k]);
    let kk = ka;
    for (let s = cum[ka]; s < cum[kb]; s += 0.6) {
      while (kk < kb - 1 && cum[kk + 1] < s) kk++;
      const f = (s - cum[kk]) / Math.max(1e-9, cum[kk + 1] - cum[kk]);
      const bx = F.x[kk] + (F.x[kk + 1] - F.x[kk]) * f, by = F.y[kk] + (F.y[kk + 1] - F.y[kk]) * f, bz = F.z[kk] + (F.z[kk + 1] - F.z[kk]) * f;
      const u = (s - cum[ka]) / (cum[kb] - cum[ka]);
      const th = TAU * sst(0.08, 0.62, u);
      const c = (Math.cos(th) - 1) * R, sn = Math.sin(th) * R;
      const dy = Math.max(0, P.spiralClimb) * 0.5 * sst(0.08, 0.62, u) * (1 - sst(0.72, 1.0, u));
      const st = sst(0.03, 0.1, u) * (1 - sst(0.55, 0.68, u));
      nf.copy(F, kk, bx + nx * c + hx * sn, by + dy, bz + nz * c + hz * sn, st, 1, 1e9);
    }
    for (let k = kb; k < F.n; k++) nf.copy(F, k, F.x[k], F.y[k], F.z[k], 0, F.ch[10][k], F.ch[11][k]);
    F.x = nf.x; F.y = nf.y; F.z = nf.z; F.ch = nf.ch;
    return true;
  }

  // A branch that splits off, winds round its host (over and under it) and rejoins it.
  _wrap(ctx, tier, host, lnA0, rng, seed) {
    let lnA = lnA0;
    const P = this.P, dm = this._dims(tier);
    const turns = [0.5, 1, 1.5][Math.floor(rng() * 3)], dir = rng() < 0.5 ? 1 : -1;
    const Rw = Math.max(P.helixRadius * (tier === TIER.TENDRIL ? 0.6 : 0.8), host.w[0] + this._thick(host) + dm.w + 4);
    const span = dm.lane * 2 + 100 + turns * TAU * Rw * (1.3 + 0.6 * rng());
    // Start where the whole wrap fits in one free stretch.
    const iv = host.free.find(([c, d]) => lnA.sAtt >= c && lnA.sAtt <= d);
    if (iv && lnA.sAtt + span + 40 > iv[1]) lnA = { ...lnA, sAtt: Math.max(iv[0] + 40, iv[1] - span - 40) };
    if (!this._inFree(host, lnA) || !this._resFree(host, lnA)) return this._why('wrap start');
    const sB = lnA.sAtt + span;
    const phiA = lnA.side > 0 ? 0 : Math.PI, phiE = phiA + dir * turns * TAU;
    const lnB = { sAtt: sB, delta: -1, side: Math.cos(phiE) >= 0 ? 1 : -1, len: dm.lane };
    if (!this._inFree(host, lnB) || !this._resFree(host, lnB)) return this._why('wrap lane');
    // Both lanes and everything between must lie in one free stretch of the host.
    const okSpan = host.free.some(([c, d]) => lnA.sAtt - 40 >= c && sB + 40 <= d);
    if (!okSpan) return this._why('wrap span');
    const F = new Fine();
    this._pushLane(F, host, lnA, dm.w, false);
    const mid0 = this._arclen(F);
    const fr = this._f;
    const Lane = dm.lane;
    for (let s = lnA.sAtt + Lane; s <= sB - Lane + 1e-6; s += NET.FINE) {
      frameAt(host, s, fr);
      const v = (s - lnA.sAtt - Lane) / Math.max(1, span - 2 * Lane);
      const phi = phiA + dir * turns * TAU * sst(0, 1, v);
      // Same distance from the host's axis as the lane ends, swelling to the helix radius.
      const R0 = fr.w + this._thick(host) + dm.w + 4;
      const R = R0 + Math.max(0, P.helixRadius * (tier === TIER.TENDRIL ? 0.6 : 0.8) - R0) * Math.sin(Math.PI * v) ** 2;
      const X = R * Math.cos(phi), Y = R * Math.sin(phi);
      const away = Math.min(s - lnA.sAtt, sB - s) - Lane;
      F.push(fr.x + fr.rx * X + fr.ux * Y, fr.y + fr.ry * X + fr.uy * Y, fr.z + fr.rz * X + fr.uz * Y,
        1 - sst(0, 70, away), 1e9, fr.ux, fr.uy, fr.uz, fr.x, fr.y, fr.z, sst(30, 90, away), 0, 1, 1e9);
    }
    const mid1 = this._arclen(F);
    this._pushLane(F, host, lnB, dm.w, true);
    // Wraps stay plain channels: no cords, corkscrews, gaps or rapids (winding round the root
    // over and under it is enough).
    const cord = false;
    return this._commit({
      key: `wrap ${ctx.L.fi},${ctx.L.fj}`, F, mid0: mid0 + 10, mid1: mid1 - 10,
      lanes: [{ host, ln: lnA, atStart: true }, { host, ln: lnB, atStart: false }],
      d: { tier, w: dm.w, wf: dm.wf, lane: Lane, flow: dm.flow, seed, attachStart: true, attachEnd: true, cord, features: false },
      idx: ctx.idx, inside: ctx.L.poly, bounds: ctx.bounds, grade: 9, noBump: true, span: [host, lnA.sAtt - 40, sB + 40], skipHost: host,
    });
  }

  // A branch that ends in the air, kicking up a little, above a lower stream it drops onto.
  _drop(ctx, tier, host, lnA, rng, seed) {
    const P = this.P, dm = this._dims(tier);
    const E = this._laneEnd(host, lnA, dm.w);
    // Find a stream below: another band 35-260 m lower, 140-700 m away, running on for a while.
    const cands = [];
    for (const tb of [ctx.lb, ...ctx.roots]) {
      if (tb === host || tb.kind.startsWith('drop') || !tb.hits(E.x - 700, E.x + 700, E.z - 700, E.z + 700)) continue;
      for (let i = 2; i < tb.n - 2; i += 2) {
        const dh = Math.hypot(tb.x[i] - E.x, tb.z[i] - E.z);
        if (dh < 140 || dh > 700 || tb.y[i] > E.y - 20 || tb.y[i] < E.y - 260) continue;
        if (tb.pres[i] < 0.99 || tb.cord[i] > 0.01 || tb.tag[i] & (TAG.TWIST | TAG.SPIRAL | TAG.TIP | TAG.LANE)) continue;
        const s = i * tb.sp;
        if (!tb.closed && (s < 60 || s > tb.L - 160)) continue;
        const dx = tb.x[i] - E.x, dz = tb.z[i] - E.z;
        if ((E.hx * dx + E.hz * dz) / dh < 0.3) continue;
        const ia = tb.idx(i - 1), ic = tb.idx(i + 1);
        let tx = tb.x[ic] - tb.x[ia], tz = tb.z[ic] - tb.z[ia]; const tl = Math.hypot(tx, tz) || 1;
        if ((tx * dx + tz * dz) / (tl * dh) < 0.2) continue;
        cands.push({ b: tb, s });
      }
    }
    if (!cands.length) return this._why('drop: nothing below');
    const q = cands[Math.floor(rng() * cands.length)], tb = q.b;
    const fr = frameAt(tb, q.s, {});
    const hl = Math.hypot(fr.tx, fr.tz) || 1, thx = fr.tx / hl, thz = fr.tz / hl;
    const h = 30 + rng() * 16, lead = 55;
    const run = 45;
    const M = { x: fr.x - thx * (lead + run), z: fr.z - thz * (lead + run), y: fr.y + h - 0.2 * run, hx: thx, hz: thz, g: 0.2 };
    const F = new Fine();
    this._pushLane(F, host, lnA, dm.w, false);
    const mid0 = this._arclen(F);
    const W = this._wander(E, M, null, tier, rng);
    const path = this._middle(F, E, M, E, W, () => 0, tier, { tip: true, runout: run, wmul: (u) => 1 - 0.25 * sst(0.6, 1, u) }, ctx.L.poly);
    if (!path) return null;
    const mid1 = this._arclen(F);
    return this._commit({
      key: `drop ${ctx.L.fi},${ctx.L.fj}`, F, mid0: mid0 + 10, mid1: mid1 - 60,
      lanes: [{ host, ln: lnA, atStart: true }],
      d: { tier, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed, attachStart: true, attachEnd: false, tip: true, cord: false, features: false },
      idx: ctx.idx, inside: ctx.L.poly, bounds: ctx.bounds, grade: dm.grade, weave: 0,
    });
  }

  // --- the region around the rider ------------------------------------------------------------

  // The loop's walls are cut for the lanes of its knots and (if built) its roots.
  _finalizeLoop(fi, fj, withRoots) {
    const L = this.faceLoop(fi, fj);
    const state = withRoots ? 2 : 1;
    if (L.finalized >= state) return L;
    if (withRoots) this.faceRoots(fi, fj);
    for (const [a, b] of L.ids) this.knot(a, b);
    this._finalizeCut(L.band);
    L.finalized = state;
    return L;
  }

  // Faces whose loops overlap the box [x0, x1] x [z0, z1] (world).
  facesIn(x0, x1, z0, z1, fn) {
    const { Sx, Sz } = this.dims();
    let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      const [a, c] = this.toLattice(x, z);
      lx0 = Math.min(lx0, a); lx1 = Math.max(lx1, a); lz0 = Math.min(lz0, c); lz1 = Math.max(lz1, c);
    }
    const fi0 = Math.floor(lx0 / Sx) - 3, fi1 = Math.floor(lx1 / Sx) + 1;
    const fj0 = Math.floor(lz0 / Sz) - 2, fj1 = Math.floor(lz1 / Sz) + 1;
    for (let fj = fj0; fj <= fj1; fj++) for (let fi = fi0; fi <= fi1; fi++) {
      if (mod2(fi + fj)) continue;
      const L = this.faceLoop(fi, fj);
      if (L.band.hits(x0, x1, z0, z1)) fn(fi, fj, L);
    }
  }

  // Every band of this layer overlapping the box [x0, x1] x [z0, z1]. Faces farther than
  // rootRange from (fx, fz) show their trunks and knots only (their roots are far off in the
  // haze).
  bandsIn(x0, x1, z0, z1, fx, fz, rootRange, out) {
    const add = (b) => { if (b && b.hits(x0, x1, z0, z1)) { b.layer = this.li; out.add(b); } };
    this.facesIn(x0, x1, z0, z1, (fi, fj, L) => {
      const bx = L.band.box, dx = Math.max(bx[0] - fx, 0, fx - bx[1]), dz = Math.max(bx[2] - fz, 0, fz - bx[3]);
      const withRoots = Math.hypot(dx, dz) < rootRange || this.cache.has(`R|${fi}|${fj}`);
      this._finalizeLoop(fi, fj, withRoots);
      add(L.band);
      if (withRoots) for (const b of this.faceRoots(fi, fj).bands) add(b);
      for (const [a, b] of L.ids) for (const k of this.knot(a, b).bands) add(k);
    });
    return out;
  }

  // Every band of this layer (roots built) overlapping the box: for connectors.
  allIn(x0, x1, z0, z1) {
    const out = [];
    this.facesIn(x0, x1, z0, z1, (fi, fj, L) => {
      this._finalizeLoop(fi, fj, true);
      L.band.layer = this.li; out.push(L.band);
      for (const b of this.faceRoots(fi, fj).bands) { b.layer = this.li; out.push(b); }
      for (const [a, b] of L.ids) for (const k of this.knot(a, b).bands) { k.layer = this.li; out.push(k); }
    });
    return out.filter((b) => b.hits(x0, x1, z0, z1));
  }
}
