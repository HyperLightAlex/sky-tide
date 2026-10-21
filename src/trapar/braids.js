// Trapar streams: the snapshot of the network around the rider, and its density.
//
// The network (network.js) is made of bands: trunk loops, knot connectors, roots and cords.
// Around the focus a
// snapshot turns every band into short segments, each with its two end frames and
// cross-sections, plus a 3D grid that lists the segments in each cell. Physics (here) and
// rendering (braids.glsl.js, reading the same arrays as float textures) evaluate the same
// segments, so they agree.
//
// Cross-sections:
//   channel   (veins, branches) a flat floor of half-width wf, then walls curving up with
//             curvature kap out to arc length w. A shallow channel, a halfpipe that goes past
//             vertical, or a barrel that curls nearly closed are all the same shape with
//             different numbers. A lane cut flattens the wall on one side into a shelf.
//   cord      a solid round tube of radius w (ridden on its outside).
// The network is static (its shape does not change with time); a new snapshot is built when
// the focus moves far enough. In the browser a worker builds it ahead of time.

import { sst, hashu } from '../sky/common.js';
import { Network, CLS, TAG } from './network.js';
import { RouteGraph } from './route.js';

export const BR = {
  CELL_H: 150,          // grid cell size, horizontal (m)
  CELL_V_MIN: 50,       // grid cell size, vertical (m, grows if the band is tall)
  TEX_W: 1024,          // texture width for all stream data textures
  SEG_TEXELS: 10,       // RGBA texels per segment
  MAX_SEG: 65536,
  MAX_IDX: 1024 * 512,
  MAX_CELLS: 1024 * 256,
  MAX_PER_CELL: 128,    // the shader and the physics both stop at this many per cell
  MAX_CLASS: 4,
  REGION: 6000,         // half-size of the square region kept around the focus (m)
  REBUILD: 1000,        // rebuild when the focus is this far from the snapshot's center (m)
  HARD: 2600,           // with a worker, build in place only if this far (else wait for it)
  QUICK: 1000,          // root range of the first snapshot (built fast, then the full one)
  QUICK_REGION: 3000,   // and its half-size
  ROOTS: 4500,          // faces this close to the focus get their roots (farther: trunks only)
};
export { CLS, TAG };
const FPS = BR.SEG_TEXELS * 4; // floats per segment
BR.FPS = FPS;
const TWO_PI = Math.PI * 2;
// Segment layout (floats): 0-2 P0, 3 class*1000 + w0 | 4-6 P1, 7 w1 | 8-10 U0, 11 kap0 |
// 12-14 U1, 15 kap1 | 16 pres0, 17 pres1, 18 flow, 19 cut1 | 20 wf0, 21 wf1, 22 cut0,
// 23 tier + 4 * layer (3: a connector between layers) |
// 24-26 T0 (true tangent at the start), 27 tags | 28-30 T1, 31 band id (debugging, tests) |
// water: 32 s0, 33 s1 (where along the waves, see bandWater), 34 a0, 35 a1 (wave size, 0..1) |
// 36 rs0, 37 rs1 (rapids * 1024 + slosh, each 0..1023), 38 swell wavelength, 39 the band's phase.

// What a snapshot depends on (besides where it is centered).
export function snapshotSig(P, net) {
  return [(net || new Network(P)).signature(), P.streamsOn, P.streamDensity, P.streamSoftness,
    P.waterOn, P.swellHeight, P.swellLength, P.rapidsHeight, P.sloshHeight, P.rollerHeight, P.chopHeight].join('|');
}
// Plain copy of the parameters for a worker.
export function plainParams(P0) {
  const P = {};
  for (const k in P0) { const v = P0[k]; if (typeof v !== 'object') P[k] = v; }
  return P;
}

export class Braids {
  constructor(params) {
    this.P = params;
    this.net = new Network(params);
    this.seg = new Float32Array(BR.MAX_SEG * FPS);
    this.idx = new Float32Array(BR.MAX_IDX);
    this.cell = new Float32Array(BR.MAX_CELLS * 2);
    this.nSeg = 0; this.nIdx = 0; this.truncated = false; this.overfull = 0;
    this.version = 0;
    this.cx = 1e9; this.cz = 1e9; this._sig = '';
    this.buildMs = 0;
    this.S = {
      uBrOn: 0,
      uBrGridO: new Float32Array(3), uBrCellSize: new Float32Array([BR.CELL_H, BR.CELL_V_MIN, BR.CELL_H]),
      uBrDims: new Int32Array([1, 1, 1]),
      uBrThickC: new Float32Array(BR.MAX_CLASS),
      uBrSoft: 2.5, uBrDensity: 2.4,
      uBrLo: 0, uBrHi: -1,
      // Water: heights (swell, rapids, slosh, how far it all can move a surface), wave motion
      // (swell and roller speeds, rapids spacing, slosh rate), rollers and chop (heights, chop
      // speed), clock (time, slosh phase, rapids pulse phase), foam.
      uBrWater: new Float32Array(4), uBrWave: new Float32Array(4), uBrWave2: new Float32Array(4), uBrClock: new Float32Array(4), uBrFoam: 1,
    };
    this._keep = new Int32Array(4096);
  }

  _signature() { return snapshotSig(this.P, this.net); }

  // A snapshot built elsewhere (the worker, at startup) to use for the first update.
  preload(d) {
    if (!d || d.sig !== this._signature()) return false;
    this._sig = d.sig; this._ready = d; this.cx = 1e9;
    return true;
  }

  _uniforms() {
    const P = this.P, S = this.S;
    S.uBrThickC[0] = 0;
    S.uBrThickC[CLS.TRUNK] = Math.max(3, P.trunkThickness);
    S.uBrThickC[CLS.ROOT] = Math.max(3, P.rootThickness);
    S.uBrThickC[CLS.CORD] = 0;
    S.uBrSoft = Math.max(0.5, Math.min(P.streamSoftness, Math.max(3, P.rootThickness) * 0.45));
    S.uBrDensity = P.streamDensity;
    const on = P.waterOn ? 1 : 0;
    S.uBrWater[0] = on * Math.max(0, P.swellHeight); S.uBrWater[1] = on * Math.max(0, P.rapidsHeight);
    S.uBrWater[2] = on * Math.max(0, P.sloshHeight);
    S.uBrWave2[0] = on * Math.max(0, P.rollerHeight); S.uBrWave2[1] = on * Math.max(0, P.chopHeight);
    S.uBrWave2[2] = P.chopSpeed * P.trunkFlow; S.uBrWave2[3] = 0;
    // How far the water can move a surface: the waves at their biggest (trunks; roots, the
    // biggest streams with rapids, at 0.65 of that, plus the rapids), plus the slosh.
    const waves = 1.22 * S.uBrWater[0] + S.uBrWave2[0] + S.uBrWave2[1];
    S.uBrWater[3] = Math.max(waves, 0.65 * waves + 2.3 * S.uBrWater[1]) + S.uBrWater[2];
    // (every stream's waves travel at the same speeds, set by the trunks' flow, so a branch's
    // waves stay in step with its host's)
    S.uBrWave[0] = P.swellSpeed * P.trunkFlow + P.swellSpeedAdd; S.uBrWave[1] = P.rollerSpeed * P.trunkFlow; S.uBrWave[2] = Math.max(10, P.rapidsSpacing);
    S.uBrWave[3] = TWO_PI / Math.max(0.5, P.sloshPeriod);
    S.uBrFoam = on * Math.max(0, P.foam);
  }

  update(t, focus) {
    const P = this.P, S = this.S;
    this._uniforms();
    // The water clock (repeats every hour, so the shader's float math stays precise).
    const tw = ((t % 3600) + 3600) % 3600;
    S.uBrClock[0] = tw; S.uBrClock[1] = (S.uBrWave[3] * t) % TWO_PI; S.uBrClock[2] = (2.3 * t) % TWO_PI;
    if (!P.streamsOn) { S.uBrOn = 0; S.uBrLo = 0; S.uBrHi = -1; return; }
    S.uBrOn = 1;
    const sig = this._signature();
    if (sig !== this._sig) {
      // Tuning changed the network: with a worker, keep riding the current snapshot while the
      // new one is built (unless asked to build now, e.g. on a respawn).
      if (this.worker && this.nSeg > 0 && !this.syncNext) {
        const r = this._ready;
        if (r && r.sig === sig) { this._sig = sig; this._apply(r); this._ready = null; }
        else if (!this._inflight) { this._ready = null; this._request(focus, sig); }
        return;
      }
      this._sig = sig; this.cx = 1e9; this._ready = null;
    }
    this.syncNext = false;
    const d = Math.hypot(focus.x - this.cx, focus.z - this.cz);
    const r = this._ready;
    // A snapshot from the worker: take it if it is centered nearer the focus than ours (or ours
    // was a quick one with fewer roots).
    if (r && r.sig === sig) {
      const dr = Math.hypot(focus.x - r.cx, focus.z - r.cz);
      if (dr < d - 50 || (dr < BR.REBUILD && (r.rr || BR.ROOTS) > (this.rr || BR.ROOTS))) { this._apply(r); this._ready = null; this._afterApply(focus, sig); return; }
    }
    if (d > BR.REBUILD) {
      if (this.worker && d < BR.HARD) {
        // Keep riding this snapshot while the worker builds the next one.
        if (!this._inflight) { this._ready = null; this._request(focus, sig); }
      } else { this._build(focus); this._ready = null; }
    } else if (this.worker && d > BR.REBUILD * 0.3 && !this._inflight && !this._ready) this._request(focus, sig);
    else if (this.worker && (this.rr || BR.ROOTS) < BR.ROOTS && !this._inflight && !this._ready) this._request(focus, sig);
  }

  _afterApply(focus, sig) {
    // A quick snapshot is followed at once by the full one.
    if (this.worker && (this.rr || BR.ROOTS) < BR.ROOTS && !this._inflight) this._request(focus, sig);
  }

  // --- worker --------------------------------------------------------------------------------

  attachWorker(worker) {
    this.worker = worker;
    this._inflight = false; this._reqId = 1000;
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'route') { const cb = this._routeCb && this._routeCb.get(d.id); if (cb) { this._routeCb.delete(d.id); cb(d); } return; }
      if (d.id !== this._reqId) return;
      this._inflight = false;
      this._ready = d;
    };
    worker.onerror = () => { this.worker = null; this._inflight = false; };
  }

  _request(focus, sig) {
    if (!this.worker || this._inflight) return;
    this._inflight = true;
    this.worker.postMessage({ id: ++this._reqId, P: plainParams(this.P), focus: { x: focus.x, z: focus.z, rr: focus.rr, region: focus.region }, sig });
  }

  // --- routes --------------------------------------------------------------------------------

  // A route to an island (see route.js), planned over the bands of the latest snapshot: in the
  // worker if there is one (cb gets the result later), else here and now.
  //   from: { x, y, z, vx, vy, vz, mode, state, islandId }   dest: { id, x, z }
  requestRoute(from, dest, cb) {
    if (this.worker) {
      this._routeCb = this._routeCb || new Map();
      const id = (this._routeId = (this._routeId || 0) + 1);
      this._routeCb.set(id, cb);
      this.worker.postMessage({ type: 'route', id, from, dest });
      return;
    }
    cb(this.planRoute(from, dest));
  }

  planRoute(from, dest) {
    if (!this.bands || !this.bands.length) return { ok: false, why: 'no streams yet', pts: new Float32Array(0), steps: [] };
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    if (!this._graph) this._graph = new RouteGraph(this.bands, this.P, this.cx, this.cz, this.region || BR.REGION);
    const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
    const find = (id, x, z) => (id == null ? null : this.net.islandsIn(x - 2, x + 2, z - 2, z + 2).find((I) => I.id === id) || null);
    const D = find(dest.id, dest.x, dest.z);
    if (!D) return { ok: false, why: 'island not found', pts: new Float32Array(0), steps: [] };
    const f = { ...from, island: from.islandId != null ? find(from.islandId, from.ix, from.iz) : null };
    const r = this._graph.plan(f, D);
    r.graphMs = t1 - t0; r.planMs = (typeof performance !== 'undefined' ? performance : Date).now() - t1; r.nodes = this._graph.n;
    return r;
  }

  pack(sig) {
    const S = this.S, N = S.uBrDims[0] * S.uBrDims[1] * S.uBrDims[2];
    return {
      sig, cx: this.cx, cz: this.cz, rr: this.rr, nSeg: this.nSeg, nIdx: this.nIdx, truncated: this.truncated, overfull: this.overfull, buildMs: this.buildMs,
      grid: { o: Array.from(S.uBrGridO), c: Array.from(S.uBrCellSize), d: Array.from(S.uBrDims), lo: S.uBrLo, hi: S.uBrHi },
      seg: this.seg.slice(0, this.nSeg * FPS), idx: this.idx.slice(0, this.nIdx), cell: this.cell.slice(0, N * 2),
    };
  }

  _apply(d) {
    const S = this.S;
    this.seg.set(d.seg); this.idx.set(d.idx); this.cell.set(d.cell);
    S.uBrGridO.set(d.grid.o); S.uBrCellSize.set(d.grid.c); S.uBrDims.set(d.grid.d);
    S.uBrLo = d.grid.lo; S.uBrHi = d.grid.hi;
    this.nSeg = d.nSeg; this.nIdx = d.nIdx; this.truncated = d.truncated; this.overfull = d.overfull;
    this.cx = d.cx; this.cz = d.cz; this.rr = d.rr || BR.ROOTS;
    this.buildMs = 0; this.workerMs = d.buildMs;
    this.version++;
  }

  // --- snapshot ------------------------------------------------------------------------------

  _build(focus) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const P = this.P, S = this.S;
    this._uniforms();
    this.cx = Math.round(focus.x / BR.CELL_H) * BR.CELL_H;
    this.cz = Math.round(focus.z / BR.CELL_H) * BR.CELL_H;
    const R = focus.region || BR.REGION;
    this.region = R;
    this.nSeg = 0; this.truncated = false;
    this._yMin = Infinity; this._yMax = -Infinity;
    const bands = this.net.bandsIn(this.cx - R, this.cx + R, this.cz - R, this.cz + R, focus.x, focus.z, focus.rr || BR.ROOTS);
    this.rr = focus.rr || BR.ROOTS;
    this.bands = bands; this._graph = null;   // (for routes, see planRoute)
    // Water first (a branch that cannot meet its host in step calms the host there, so the
    // host's water may need doing again before anything is written).
    for (const b of bands) bandWater(b, P);
    for (const b of bands) if (b._wl !== Math.max(40, P.swellLength)) bandWater(b, P);
    for (const b of bands) this._emitBand(b);
    // Grid over the occupied height range.
    const yLo = (Number.isFinite(this._yMin) ? this._yMin : 0) - 80, yHi = (Number.isFinite(this._yMax) ? this._yMax : 1) + 80;
    const NX = Math.round((2 * R) / BR.CELL_H), NZ = NX;
    const NY = Math.max(1, Math.min(Math.floor(BR.MAX_CELLS / (NX * NZ)), Math.ceil((yHi - yLo) / BR.CELL_V_MIN)));
    const CV = Math.max(BR.CELL_V_MIN, (yHi - yLo) / NY);
    S.uBrGridO[0] = this.cx - R; S.uBrGridO[1] = yLo; S.uBrGridO[2] = this.cz - R;
    S.uBrCellSize[0] = BR.CELL_H; S.uBrCellSize[1] = CV; S.uBrCellSize[2] = BR.CELL_H;
    S.uBrDims[0] = NX; S.uBrDims[1] = NY; S.uBrDims[2] = NZ;
    S.uBrLo = yLo; S.uBrHi = yLo + CV * NY;
    this._buildGrid();
    this.version++;
    this.buildMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  }

  _emitBand(b) {
    const P = this.P, cx = this.cx, cz = this.cz;
    const RF0 = this.region - 1500, RF1 = this.region - 250;
    const n = b.n;
    if (this._keep.length < n + 2) this._keep = new Int32Array(n + 64);
    const keep = this._keep;
    this._waterOf(b);
    // Merge runs of samples into longer segments wherever one smooth segment reproduces the
    // band closely (position, up, cross-section); looser far from the focus.
    let m = 0;
    keep[m++] = 0;
    for (let a = 0; a < n - 1;) {
      const d = Math.hypot(b.x[a] - cx, b.z[a] - cz);
      const far = Math.max(0, d - 1300) / 500;
      const maxSpan = d < 1300 ? 4 : d < 3000 ? 6 : 10;
      const tol = 1 + far;
      let c = a + 1;
      for (let k = a + 2; k <= Math.min(n - 1, a + maxSpan); k++) {
        if (!this._fits(b, a, k, tol)) break;
        c = k;
      }
      keep[m++] = c;
      a = c;
    }
    const cordR = Math.max(1.5, P.cordRadius);
    const fade = (i) => 1 - sst(RF0, RF1, Math.hypot(b.x[i] - cx, b.z[i] - cz));
    // A channel turns into a cord by shape, never by thinning (which would sink the surface):
    // first the cord grows up from under the channel until its top meets the floor, then the
    // channel narrows away to nothing over it. The cord's axis stays a fixed depth below the
    // floor, so it follows the band smoothly.
    const shape = (i, o) => {
      const c = b.cord[i];
      o.r = cordR * sst(0, 0.5, c);
      const k = 1 - sst(0.5, 1, c);
      o.w = Math.max(0.5, b.w[i] * k); o.wf = Math.min(b.wf[i], o.w * 0.5); o.kap = b.kap[i] * k;
      o.rp = 1 - sst(0.9, 1, c);
      return o;
    };
    const A = this._sa || (this._sa = {}), C = this._sc || (this._sc = {});
    this._cordR = cordR;
    let fa = fade(keep[0]);
    for (let k = 0; k < m - 1; k++) {
      const a = keep[k], c = keep[k + 1];
      const fc = fade(c);
      const pa = b.pres[a] * fa, pc = b.pres[c] * fc;
      fa = fc;
      if (pa < 0.003 && pc < 0.003) continue;
      shape(a, A); shape(c, C);
      if (Math.max(pa * A.rp, pc * C.rp) > 0.003) this._write(b, a, c, b.cls, pa * A.rp, pc * C.rp, A, C);
      if (b.cord[a] > 0.003 || b.cord[c] > 0.003) this._write(b, a, c, CLS.CORD, pa, pc, A, C);
      if (this.truncated) return;
    }
  }

  // The band's water (see bandWater): computed once per band (and swell length).
  _waterOf(b) { bandWater(b, this.P); }

  // Does one segment from sample a to sample k reproduce the samples between closely enough?
  // (Same curve the shader and physics build: Hermite between the end tangents, up and
  // cross-section interpolated linearly.) tol scales the tolerances.
  _fits(b, a, k, tol) {
    const Ta = this._ta || (this._ta = new Float64Array(3)), Tk = this._tk || (this._tk = new Float64Array(3));
    this._tan(b, a, Ta, 0); this._tan(b, k, Tk, 0);
    const ax = b.x[a], ay = b.y[a], az = b.z[a], kx = b.x[k], ky = b.y[k], kz = b.z[k];
    const L = Math.hypot(kx - ax, ky - ay, kz - az);
    const lin = (arr, t) => arr[a] + (arr[k] - arr[a]) * t;
    for (let i = a + 1; i < k; i++) {
      const t = (i - a) / (k - a), t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      const px = h00 * ax + h10 * L * Ta[0] + h01 * kx + h11 * L * Tk[0];
      const py = h00 * ay + h10 * L * Ta[1] + h01 * ky + h11 * L * Tk[1];
      const pz = h00 * az + h10 * L * Ta[2] + h01 * kz + h11 * L * Tk[2];
      if (Math.hypot(px - b.x[i], py - b.y[i], pz - b.z[i]) > 0.05 * tol) return false;
      // up (angle)
      let ux = lin(b.ux, t), uy = lin(b.uy, t), uz = lin(b.uz, t);
      const ul = Math.hypot(ux, uy, uz) || 1;
      if ((ux * b.ux[i] + uy * b.uy[i] + uz * b.uz[i]) / ul < Math.cos(0.012 * tol)) return false;
      if (Math.abs(lin(b.w, t) - b.w[i]) > 0.05 * tol || Math.abs(lin(b.wf, t) - b.wf[i]) > 0.05 * tol) return false;
      if (Math.abs(lin(b.kap, t) - b.kap[i]) > 0.002 * tol) return false;
      if (Math.abs(lin(b.cut, t) - b.cut[i]) > 0.02 * tol || Math.abs(lin(b.pres, t) - b.pres[i]) > 0.01 * tol) return false;
      if (Math.abs(lin(b.cord, t) - b.cord[i]) > 0.01 * tol) return false;
      if (Math.abs(lin(b.wa, t) - b.wa[i]) > 0.03 * tol || Math.abs(lin(b.rap, t) - b.rap[i]) > 0.03 * tol) return false;
      if (Math.abs(lin(b.slosh, t) * lin(b.ww, t) - b.slosh[i] * b.ww[i]) > 0.03 * tol || Math.abs(lin(b.sw, t) - b.sw[i]) > 0.25 * tol) return false;
      if (b.tag[i] !== b.tag[a]) return false;
    }
    return true;
  }

  // One segment from sample a to sample c, with the end shapes A and C (see _emitBand). A
  // cord's axis sits its radius below the band's floor, so its top is the floor.
  _write(b, a, c, cls, pa, pc, A, C) {
    if (this.nSeg >= BR.MAX_SEG) { this.truncated = true; return; }
    const seg = this.seg, o = this.nSeg * FPS;
    const cord = cls === CLS.CORD;
    const da = cord ? this._cordR : 0, dc = da;
    seg[o] = b.x[a] - b.ux[a] * da; seg[o + 1] = b.y[a] - b.uy[a] * da; seg[o + 2] = b.z[a] - b.uz[a] * da;
    seg[o + 3] = cls * 1000 + (cord ? A.r : A.w);
    seg[o + 4] = b.x[c] - b.ux[c] * dc; seg[o + 5] = b.y[c] - b.uy[c] * dc; seg[o + 6] = b.z[c] - b.uz[c] * dc;
    seg[o + 7] = cord ? C.r : C.w;
    seg[o + 8] = b.ux[a]; seg[o + 9] = b.uy[a]; seg[o + 10] = b.uz[a]; seg[o + 11] = cord ? 0 : A.kap;
    seg[o + 12] = b.ux[c]; seg[o + 13] = b.uy[c]; seg[o + 14] = b.uz[c]; seg[o + 15] = cord ? 0 : C.kap;
    seg[o + 16] = pa; seg[o + 17] = pc; seg[o + 18] = b.flow; seg[o + 19] = cord ? 0 : b.cut[c];
    seg[o + 20] = cord ? 0 : A.wf; seg[o + 21] = cord ? 0 : C.wf; seg[o + 22] = cord ? 0 : b.cut[a]; seg[o + 23] = b.tier + 4 * (b.conn ? 3 : b.layer);
    // True tangents at both ends (the band's own direction there, not the chord's), so each
    // segment is a smooth curve that meets its neighbors with the same frame. A cord's axis
    // dips while it grows, so its tangent follows the dipping axis.
    this._tan(b, a, seg, o + 24); seg[o + 27] = b.tag[a] | b.tag[c];
    this._tan(b, c, seg, o + 28); seg[o + 31] = b.id;
    // Water (cords hold still).
    seg[o + 32] = b.sw[a]; seg[o + 33] = b.sw[c];
    if (cord) { seg[o + 34] = seg[o + 35] = seg[o + 36] = seg[o + 37] = 0; }
    else {
      seg[o + 34] = b.wa[a]; seg[o + 35] = b.wa[c];
      const pk = (i) => Math.round(Math.min(1, b.rap[i] / 2) * 1023) * 1024 + Math.round(Math.min(1, b.slosh[i] * b.ww[i]) * 1023);
      seg[o + 36] = pk(a); seg[o + 37] = pk(c);
    }
    seg[o + 38] = b._wl; seg[o + 39] = b._wph;
    const ylo = Math.min(seg[o + 1], seg[o + 5]), yhi = Math.max(seg[o + 1], seg[o + 5]);
    if (ylo < this._yMin) this._yMin = ylo;
    if (yhi > this._yMax) this._yMax = yhi;
    this.nSeg++;
  }

  _tan(b, i, out, k) {
    const a = b.idx(i - 1), c = b.idx(i + 1);
    let tx = b.x[c] - b.x[a], ty = b.y[c] - b.y[a], tz = b.z[c] - b.z[a];
    const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    // Square to the band's up there.
    const ut = tx * b.ux[i] + ty * b.uy[i] + tz * b.uz[i];
    tx -= ut * b.ux[i]; ty -= ut * b.uy[i]; tz -= ut * b.uz[i];
    const l2 = Math.hypot(tx, ty, tz) || 1;
    out[k] = tx / l2; out[k + 1] = ty / l2; out[k + 2] = tz / l2;
  }

  _buildGrid() {
    const S = this.S, seg = this.seg;
    const [NX, NY, NZ] = S.uBrDims;
    const ox = S.uBrGridO[0], oy = S.uBrGridO[1], oz = S.uBrGridO[2];
    const CH = S.uBrCellSize[0], CV = S.uBrCellSize[1];
    const N = NX * NY * NZ;
    const cell = this.cell;
    cell.fill(0, 0, N * 2);
    const ranges = this._ranges && this._ranges.length >= this.nSeg * 6 ? this._ranges : (this._ranges = new Int32Array(BR.MAX_SEG * 6));
    for (let s = 0; s < this.nSeg; s++) {
      const o = s * FPS;
      const L = Math.floor(seg[o + 3] / 1000);
      const w0 = seg[o + 3] - L * 1000, w1 = seg[o + 7];
      const T = S.uBrThickC[L] || 0;
      const cord = L === CLS.CORD;
      // Vertical reach: across the tilted width, plus how high a curling wall rises, plus the
      // curve's bulge between its ends.
      const ex = seg[o + 4] - seg[o], ey = seg[o + 5] - seg[o + 1], ez = seg[o + 6] - seg[o + 2];
      const el = Math.hypot(ex, ey, ez) || 1;
      const disp = cord ? 0 : S.uBrWater[3];   // water moves channels along their up
      const ph = Math.max(w0, w1) + T + 4 + 0.15 * el + disp;
      const vr = (ux, uz, w, kap, wf) => {
        if (cord) return w + 4 + 0.15 * el;
        const ry = Math.abs((ez * ux - ex * uz) / el);
        const curl = kap > 1e-4 ? (1 - Math.cos(Math.min((w - wf) * kap, Math.PI))) / kap : 0;
        return ry * w + curl + T + 4 + 0.15 * el + disp;
      };
      const pad = Math.max(vr(seg[o + 8], seg[o + 10], w0, seg[o + 11], seg[o + 20]), vr(seg[o + 12], seg[o + 14], w1, seg[o + 15], seg[o + 21]));
      const x0 = Math.min(seg[o], seg[o + 4]) - ph, x1 = Math.max(seg[o], seg[o + 4]) + ph;
      const y0 = Math.min(seg[o + 1], seg[o + 5]) - pad, y1 = Math.max(seg[o + 1], seg[o + 5]) + pad;
      const z0 = Math.min(seg[o + 2], seg[o + 6]) - ph, z1 = Math.max(seg[o + 2], seg[o + 6]) + ph;
      const a0 = Math.max(0, Math.floor((x0 - ox) / CH)), a1 = Math.min(NX - 1, Math.floor((x1 - ox) / CH));
      const b0 = Math.max(0, Math.floor((y0 - oy) / CV)), b1 = Math.min(NY - 1, Math.floor((y1 - oy) / CV));
      const c0 = Math.max(0, Math.floor((z0 - oz) / CH)), c1 = Math.min(NZ - 1, Math.floor((z1 - oz) / CH));
      const r = s * 6;
      ranges[r] = a0; ranges[r + 1] = a1; ranges[r + 2] = b0; ranges[r + 3] = b1; ranges[r + 4] = c0; ranges[r + 5] = c1;
      for (let cy = b0; cy <= b1; cy++) for (let cz = c0; cz <= c1; cz++) for (let cx = a0; cx <= a1; cx++) cell[2 * (cx + NX * (cz + NZ * cy)) + 1]++;
    }
    let acc = 0, over = 0;
    for (let c = 0; c < N; c++) { const k = cell[2 * c + 1]; if (k > BR.MAX_PER_CELL) over++; cell[2 * c] = acc; acc += k; cell[2 * c + 1] = 0; }
    this.overfull = over;
    this.nIdx = Math.min(acc, BR.MAX_IDX);
    if (acc > BR.MAX_IDX) this.truncated = true;
    const idx = this.idx;
    for (let s = 0; s < this.nSeg; s++) {
      const r = s * 6;
      for (let cy = ranges[r + 2]; cy <= ranges[r + 3]; cy++) for (let cz = ranges[r + 4]; cz <= ranges[r + 5]; cz++) for (let cx = ranges[r]; cx <= ranges[r + 1]; cx++) {
        const c = 2 * (cx + NX * (cz + NZ * cy));
        const at = cell[c] + cell[c + 1];
        if (at < BR.MAX_IDX) { idx[at] = s; cell[c + 1]++; }
      }
    }
  }

  // --- evaluation (mirrors brDensity in braids.glsl.js) -----------------------------------

  // Density of the strongest band at (x, y, z). If info is given, it receives the winning
  // segment: class, tangent, flow, band up, the ridable face's normal, curl and tags.
  density(x, y, z, info) {
    const S = this.S;
    if (info) { info.rho = 0; info.cnt = 0; }
    if (!S.uBrOn || y < S.uBrLo || y >= S.uBrHi) return 0;
    const [NX, NY, NZ] = S.uBrDims;
    const gx = Math.floor((x - S.uBrGridO[0]) / S.uBrCellSize[0]);
    const gy = Math.floor((y - S.uBrGridO[1]) / S.uBrCellSize[1]);
    const gz = Math.floor((z - S.uBrGridO[2]) / S.uBrCellSize[2]);
    if (gx < 0 || gy < 0 || gz < 0 || gx >= NX || gy >= NY || gz >= NZ) return 0;
    const c = 2 * (gx + NX * (gz + NZ * gy));
    const start = this.cell[c], cnt = Math.min(this.cell[c + 1], BR.MAX_PER_CELL);
    if (info) info.cnt = cnt;
    if (!cnt) return 0;
    const seg = this.seg, soft = S.uBrSoft;
    let best = 0;
    const g = this._geo || (this._geo = {});
    const wat = this._wat || (this._wat = {});
    for (let j = 0; j < cnt; j++) {
      const o = this.idx[start + j] * FPS;
      const L = Math.floor(seg[o + 3] / 1000);
      const w0 = seg[o + 3] - L * 1000, w1 = seg[o + 7];
      const T = S.uBrThickC[L];
      if (!segFrame(seg, o, x, y, z, Math.max(w0, w1) + T + 2 + (L === CLS.CORD ? 0 : S.uBrWater[3]), g)) continue;
      const tau = g.tau, dx = g.dx, dy = g.dy, dz = g.dz, tx = g.tx, ty = g.ty, tz = g.tz;
      const ux = g.ux, uy = g.uy, uz = g.uz, rx = g.rx, ry = g.ry, rz = g.rz;
      const w = w0 + (w1 - w0) * tau;
      const pres = seg[o + 16] + (seg[o + 17] - seg[o + 16]) * tau;
      const u = dx * rx + dy * ry + dz * rz;
      let v = dx * ux + dy * uy + dz * uz;
      // Water: swells, rapids and slosh move a channel's surface along its up.
      // (skipped where it cannot reach: over the floor and well above or below it)
      const wfw = seg[o + 20] + (seg[o + 21] - seg[o + 20]) * tau, D = S.uBrWater[3];
      if (L !== CLS.CORD && D > 0 && (Math.abs(u) > wfw + 0.5 || (v < D + 0.5 && v > -T - D - 0.5))) { waterAt(seg, o, tau, u, w, x, z, S, wat, !!info); v -= wat.h; }
      else { wat.h = 0; wat.hv = 0; wat.sw = 0; wat.rap = 0; wat.hs = 0; wat.c = 0; wat.k0 = 0; wat.k1 = 0; wat.k2 = 0; }
      // Past either end only a thin overlap counts (the next segment, whose frame matches at
      // the joint, takes over there).
      const btol = 0.6 + 0.06 * (Math.abs(u) + Math.abs(v));
      if (g.beyond > btol) continue;
      const bfade = g.beyond > 0 ? 1 - sst(0, btol, g.beyond) : 1;
      let rho, fu = 0, fv = 1, kapE = 0, wfE = 0;
      if (L === CLS.CORD) {
        // Solid round cord of radius w.
        const rr = Math.sqrt(u * u + v * v);
        const depth = w - rr;
        if (depth <= 0) continue;
        rho = S.uBrDensity * sst(0, soft, depth) * pres * bfade;
        if (rr > 1e-6) { fu = u / rr; fv = v / rr; }
      } else {
        // Channel: a flat floor of half-width wf, then walls curving up with curvature kap out
        // to arc length w. A lane cut flattens the wall on its side into a shelf.
        const kap0 = seg[o + 11] + (seg[o + 15] - seg[o + 11]) * tau;
        const wf = seg[o + 20] + (seg[o + 21] - seg[o + 20]) * tau;
        const cut = seg[o + 22] + (seg[o + 19] - seg[o + 22]) * tau;
        // On a lane's side the wall flattens into a shelf.
        const cutS = cut !== 0 && (u >= 0) === (cut > 0) ? Math.min(1, Math.abs(cut)) : 0;
        const kap = kap0 * (1 - cutS);
        const au = Math.abs(u), ea = au - wf;
        let depth, arc;
        if (ea <= 0 || kap < 1e-4) { depth = -v; arc = au; }
        else {
          const Rw = 1 / kap;
          const rr = Math.sqrt(ea * ea + (v - Rw) * (v - Rw));
          depth = (ea * ea + v * v - 2 * v * Rw) / (rr + Rw);
          arc = wf + Rw * Math.atan2(ea, Rw - v);
          fu = (u < 0 ? -wf : wf) - u; fv = Rw - v;
          const fl2 = Math.hypot(fu, fv) || 1; fu /= fl2; fv /= fl2;
        }
        if (depth <= 0 || depth >= T) continue;
        const prof = sst(0, soft, depth) * sst(0, soft, T - depth);
        const fadeW = Math.min(0.25 * w, Math.max(3, 0.25 * w - 0.4 * wf));
        const lat = 1 - sst(w - fadeW, w, arc);
        rho = S.uBrDensity * prof * lat * pres * bfade;
        kapE = kap; wfE = wf;
      }
      if (rho > best) {
        best = rho;
        if (info) {
          info.cls = L; info.tx = tx; info.ty = ty; info.tz = tz; info.flow = seg[o + 18];
          info.ux = ux; info.uy = uy; info.uz = uz;
          info.curl = kapE * (w - wfE); info.tags = seg[o + 27]; info.tier = seg[o + 23];
          // The ridable inner face's normal here (channels: up on the floor, toward the
          // curl's center on walls; cords: straight out from the axis).
          info.fx = rx * fu + ux * fv; info.fy = ry * fu + uy * fv; info.fz = rz * fu + uz * fv;
          info.w = w;
          // Water here: surface offset and how fast it moves along the band's up, swell
          // strength, rapids strength.
          info.h = wat.h; info.hv = wat.hv; info.swell = wat.sw; info.rap = wat.rap; info.hs = wat.hs || 0; info.wc = wat.c || 0;
          info.k0 = wat.k0 || 0; info.k1 = wat.k1 || 0; info.k2 = wat.k2 || 0;
        }
      }
    }
    if (info) info.rho = best;
    return best;
  }

  // Nearest band axis to (x, y, z) among the segments listed for its cell (physics helper,
  // e.g. the lip lock finding the wall it just left). Returns null if none is close.
  nearestAxis(x, y, z, out, onlyCls = 0) {
    const S = this.S;
    if (!S.uBrOn) return null;
    const [NX, NY, NZ] = S.uBrDims;
    const gx = Math.floor((x - S.uBrGridO[0]) / S.uBrCellSize[0]);
    const gy = Math.floor((y - S.uBrGridO[1]) / S.uBrCellSize[1]);
    const gz = Math.floor((z - S.uBrGridO[2]) / S.uBrCellSize[2]);
    if (gx < 0 || gy < 0 || gz < 0 || gx >= NX || gy >= NY || gz >= NZ) return null;
    const c = 2 * (gx + NX * (gz + NZ * gy));
    const start = this.cell[c], cnt = Math.min(this.cell[c + 1], BR.MAX_PER_CELL);
    const seg = this.seg;
    let bestD = Infinity, bo = -1, bTau = 0;
    for (let j = 0; j < cnt; j++) {
      const o = this.idx[start + j] * FPS;
      const L = Math.floor(seg[o + 3] / 1000);
      if (onlyCls ? L !== onlyCls : L === CLS.CORD) continue;
      const ax = seg[o], ay = seg[o + 1], az = seg[o + 2];
      const ex = seg[o + 4] - ax, ey = seg[o + 5] - ay, ez = seg[o + 6] - az;
      const ee = ex * ex + ey * ey + ez * ez;
      let tau = ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / ee;
      tau = tau < 0 ? 0 : tau > 1 ? 1 : tau;
      const dx = x - (ax + ex * tau), dy = y - (ay + ey * tau), dz = z - (az + ez * tau);
      const d2 = dx * dx + dy * dy + dz * dz;
      const w = Math.max(seg[o + 3] - L * 1000, seg[o + 7]), T = S.uBrThickC[L];
      if (d2 < bestD && d2 < (w + T + 40) * (w + T + 40)) { bestD = d2; bo = o; bTau = tau; }
    }
    if (bo < 0) return null;
    const o = bo, tau = bTau, L = Math.floor(seg[o + 3] / 1000);
    const ax = seg[o], ay = seg[o + 1], az = seg[o + 2];
    const ex = seg[o + 4] - ax, ey = seg[o + 5] - ay, ez = seg[o + 6] - az;
    const el = Math.hypot(ex, ey, ez) || 1, tx = ex / el, ty = ey / el, tz = ez / el;
    let ux = seg[o + 8] + (seg[o + 12] - seg[o + 8]) * tau;
    let uy = seg[o + 9] + (seg[o + 13] - seg[o + 9]) * tau;
    let uz = seg[o + 10] + (seg[o + 14] - seg[o + 10]) * tau;
    const ut = ux * tx + uy * ty + uz * tz;
    ux -= ut * tx; uy -= ut * ty; uz -= ut * tz;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    out.px = ax + ex * tau; out.py = ay + ey * tau; out.pz = az + ez * tau;
    const dx = x - out.px, dy = y - out.py, dz = z - out.pz;
    out.tx = tx; out.ty = ty; out.tz = tz; out.ux = ux; out.uy = uy; out.uz = uz; out.rx = rx; out.ry = ry; out.rz = rz;
    const w0 = seg[o + 3] - L * 1000, w1 = seg[o + 7];
    out.w = w0 + (w1 - w0) * tau;
    out.wf = seg[o + 20] + (seg[o + 21] - seg[o + 20]) * tau;
    out.lat = dx * rx + dy * ry + dz * rz; out.v = dx * ux + dy * uy + dz * uz;
    out.cls = L; out.flow = seg[o + 18]; out.tags = seg[o + 27];
    return out;
  }
}

// A band's water: where it is along the waves (sw, meters: the waves are functions of sw, so
// two bands with the same sw and size at a point carry the same water there) and how big its
// waves are (wa, 0..1), per sample; also its own wave weight (ww) and phase (_wph, for rapids
// and slosh). A trunk loop holds a whole number of swells. A branch, while it lies in its host's
// lane, carries exactly the host's waves (its sw and wa are the host's there), easing to its own
// size beyond; its sw is stretched a little along its middle so that it also meets the host it
// joins at its far end in step (if that would take too much stretch, both calm down there
// instead). Its own waves calm in corkscrews, spiral loops and barrels (you need all your
// hold there), near tips and kickers, over cords, where it fades and on wraps.
const TIER_AMP = [1, 0.65, 0.4, 0.25];
const _hw = {};
function hostWater(h, s) {
  s = h.closed ? ((s % h.L) + h.L) % h.L : Math.max(0, Math.min(h.L, s));
  const f = s / h.sp, i = Math.min(h.n - 2, Math.floor(f)), t = f - i;
  _hw.sw = h.sw[i] + (h.sw[i + 1] - h.sw[i]) * t; _hw.a = h.wa[i] + (h.wa[i + 1] - h.wa[i]) * t;
  return _hw;
}
export function bandWater(b, P, depth = 0) {
  const lam = Math.max(40, P.swellLength);
  if (b._wl === lam) return b;
  const n = b.n, sp = b.sp;
  if (b.attach && depth < 8) for (const l of b.attach) bandWater(l.host, P, depth + 1);
  const sw = b.sw && b.sw.length === n ? b.sw : (b.sw = new Float32Array(n));
  const wa = b.wa && b.wa.length === n ? b.wa : (b.wa = new Float32Array(n));
  const W = b.ww && b.ww.length === n ? b.ww : (b.ww = new Float32Array(n));
  const tg = b.tag[n >> 1];
  const own = b.conn ? (tg & TAG.UP ? 0.25 : tg & TAG.CHUTE ? 0.35 : tg & TAG.RAMP ? 0.8 : 0.45) : b.dock ? 0.3 : TIER_AMP[b.tier] ?? 0.4;
  const h = hashu(((Math.round(b.x[0]) * 73856093) ^ (Math.round(b.z[0]) * 19349663) ^ (n * 83492791)) >>> 0);
  b._wph = (h / 4294967296) * TWO_PI;
  // Its lanes (start: samples 0..iA, end: iB..n-1).
  const dl = b.dl, hosted = (l) => l.host.sw && l.host._wl === lam;
  const A0 = b.attach ? b.attach.find((l) => l.atStart && hosted(l)) : null, A1 = b.attach ? b.attach.find((l) => !l.atStart && hosted(l)) : null;
  let iA = -1, iB = n;
  if (A0 && dl) while (iA + 1 < n && dl[iA + 1] < A0.ln.len) iA++;
  if (A1 && dl) while (iB - 1 > iA + 1 && dl[iB - 1] < A1.ln.len) iB--;
  // Its own wave weight: full in the open, easing to nothing (over about 100 m) where its own
  // waves calm, its lanes and the lanes on it that could not be met in step.
  const M = new Uint8Array(n);
  const still = b.kind.startsWith('wrap');
  for (let i = 0; i < n; i++) {
    if (still || i <= iA || i >= iB) continue;
    M[i] = b.cord[i] < 0.01 && b.pres[i] > 0.99 && !(b.tag[i] & (TAG.TIP | TAG.TWIST | TAG.SPIRAL | TAG.BARREL)) ? 1 : 0;
  }
  for (const ln of b.lanes) {
    if (!ln.calm) continue;
    const s0 = ln.delta > 0 ? ln.sAtt - 40 : ln.sAtt - ln.len - 30, s1 = ln.delta > 0 ? ln.sAtt + ln.len + 30 : ln.sAtt + 40;
    for (let i = 0; i < n; i++) {
      let s = i * sp;
      if (b.closed && s1 > b.L && s < s1 - b.L) s += b.L;
      if (b.closed && s0 < 0 && s > s0 + b.L) s -= b.L;
      if (s >= s0 && s <= s1) M[i] = 0;
    }
  }
  const k = Math.max(1, Math.round(50 / sp));
  const at = (q) => (b.closed ? b.idx(q) : q < 0 || q >= n ? -1 : q);
  const E = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let e = M[i];
    for (let d = -k; d <= k && e > 0; d++) { const q = at(i + d); if (q < 0 || M[q] === 0) e = 0; }
    E[i] = e;
  }
  const tipped = !b.closed && (b.tag[n - 1] & TAG.TIP);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let d = -k; d <= k; d++) { const q = at(i + d); if (q >= 0) sum += E[q]; }
    W[i] = sum / (2 * k + 1);
    if (tipped) W[i] *= sst(0, 1, (b.L - i * sp - 160) / 120);
    if (b.dock && b.dock.at === 'start') W[i] *= sst(0, 1, (i * sp - 60) / 120);   // (still where it rises out of an island)
  }
  // Where along the waves: the host's in its lanes, stretched between them to meet both.
  // (a lane point d into the lane lies at host arclength sAtt + delta d, see Layer._lane)
  for (let i = 0; i <= iA; i++) { const q = hostWater(A0.host, A0.ln.sAtt + A0.ln.delta * dl[i]); sw[i] = q.sw; wa[i] = q.a; }
  for (let i = iB; i < n; i++) { const q = hostWater(A1.host, A1.ln.sAtt + A1.ln.delta * dl[i]); sw[i] = q.sw; wa[i] = q.a; }
  let endIn = iB < n;
  if (iA < 0 && endIn) {
    for (let i = iB - 1; i >= 0; i--) sw[i] = sw[iB] - (iB - i) * sp;
  } else {
    const ia = Math.max(0, iA), base = iA >= 0 ? sw[iA] : (h % 100000) / 100000 * lam * 20;
    let stretch = b.closed && iA < 0 ? (lam * Math.max(1, Math.round(b.L / lam))) / b.L : 1;
    if (endIn) {
      const Lm = (iB - ia) * sp, D0 = sw[iB] - base, kk = Math.round((Lm - D0) / lam);
      stretch = (D0 + kk * lam) / Math.max(1, Lm);
      if (stretch > 0.6 && stretch < 1.6) { for (let i = iB; i < n; i++) sw[i] += kk * lam; }
      else {
        // Too far out of step: calm water where it joins (here and on the host).
        endIn = false; stretch = 1;
        if (!A1.ln.calm) { A1.ln.calm = true; A1.host._wl = 0; }
        for (let i = iB; i < n; i++) W[i] = 0;
      }
    }
    for (let i = iA + 1; i < (endIn ? iB : n); i++) sw[i] = base + (i - ia) * sp * stretch;
  }
  // How big: its own size, easing from (and to) its hosts' beside its lanes.
  for (let i = iA + 1; i < (endIn ? iB : n); i++) {
    let a = W[i] * own;
    if (iA >= 0) a += (wa[iA] - a) * (1 - sst(0, 100, (i - iA) * sp));
    if (endIn) a += (wa[iB] - a) * (1 - sst(0, 100, (iB - i) * sp));
    wa[i] = a;
  }
  if (!endIn) for (let i = Math.max(iB, iA + 1); i < n; i++) if (i >= iB) wa[i] = 0;
  b._wl = lam;
  return b;
}

// Water at segment o, parameter tau, lateral offset u (half-width w), world (x, z): the
// surface's offset along the band's up (out.h); with rate set also how fast it moves along the
// up (out.hv), swell strength (out.sw), rapids strength (out.rap), the swell's slope downstream
// (out.hs) and speed (out.c), and the waves' curvature along the band (convex > 0) weighted by
// their speeds (out.k0, k1, k2: the sums of k_i, k_i c_i, k_i c_i^2), so the rider can tell how
// hard a crest pulls at its speed relative to each wave. Mirrors brWater in braids.glsl.js.
// The waves depend only on where along them a point is (sw, see bandWater), the band's wave
// size there and where in the world it is, so a branch lying in its host's lane carries the
// host's waves exactly.
//   swells   long waves rolling downstream a little faster than you cruise, peaked; patches of
//            bigger and smaller ones drift across the world (never flat)
//   rollers  half as long, rolling at the trunks' flow (you ride over them)
//   chop     short ripples (a quarter of a swell long)
//   rapids   standing humps, pulsing a little
//   slosh    the water rocking from wall to wall after bends, rippling downstream (calm in lanes)
const fract = (x) => x - Math.floor(x);
export function waterAt(seg, o, tau, u, w, x, z, S, out, rate) {
  const Wt = S.uBrWater, V = S.uBrWave, V2 = S.uBrWave2, C = S.uBrClock, t = C[0];
  const s = seg[o + 32] + (seg[o + 33] - seg[o + 32]) * tau;
  const a = seg[o + 34] + (seg[o + 35] - seg[o + 34]) * tau;
  const p0 = seg[o + 36], p1 = seg[o + 37];
  const r0 = Math.floor(p0 / 1024), r1 = Math.floor(p1 / 1024);
  const l0 = p0 - r0 * 1024, l1 = p1 - r1 * 1024;
  const rapRel = ((r0 + (r1 - r0) * tau) / 1023) * 2;
  const cut = seg[o + 22] + (seg[o + 19] - seg[o + 22]) * tau;
  const sl = ((l0 + (l1 - l0) * tau) / 1023) * Wt[2] * (1 - Math.min(1, 2 * Math.abs(cut)));
  const lam = seg[o + 38], ph = seg[o + 39];
  const q = Math.max(-1, Math.min(1, u / Math.max(1, w)));
  // Patches of bigger and smaller swells.
  const G1 = 0.00698 * (0.8 * x + 0.6 * z) - 0.1142 * t, G2 = 0.00967 * (0.866 * z - 0.5 * x) - 0.1533 * t + 1.3;
  const m = 0.72 + 0.28 * (0.6 * Math.sin(G1) + 0.4 * Math.sin(G2));
  // Swells (peaked: sharper crests, flatter troughs, more so the bigger they are).
  const c = V[0], A = a * Wt[0];
  const th = TWO_PI * fract((s - c * t) / lam);
  const sn = Math.sin(th), c2 = Math.cos(2 * th), pk = 0.22 * m;
  const hs = A * m * (sn - pk * c2);
  // Rollers.
  const Ar = a * V2[0], cr = V[1], lr = lam * 0.5;
  const thr = TWO_PI * fract((s - cr * t) / lr) + 2.1;
  const snr = Math.sin(thr);
  const hro = Ar * snr;
  // Chop.
  const Ac = a * V2[1], cc = V2[2], lc = lam * 0.25;
  const thc = TWO_PI * fract((s - cc * t) / lc) + 4.1;
  const snc = Math.sin(thc);
  const hc = Ac * snc;
  // Rapids.
  const lrp = V[2] * (0.8 + 0.4 * fract(ph * 1.1141));
  const hb = 0.5 - 0.5 * Math.cos(TWO_PI * fract(s / lrp));
  const pulse = 1 + 0.12 * Math.sin(C[2] + s * 0.05);
  const rp = rapRel * Wt[1], hb15 = hb * Math.sqrt(hb);
  const hr = rp * hb15 * pulse;
  // Slosh.
  const ts = C[1] - TWO_PI * fract(s / lam) + ph;
  const hl = sl * q * Math.sin(ts);
  out.h = hs + hro + hc + hr + hl;
  if (rate) {
    const k = TWO_PI / lam, kr = TWO_PI / lr, kc = TWO_PI / lc;
    const cs = Math.cos(th), s2 = Math.sin(2 * th);
    const thT = -k * c, mT = 0.28 * (0.6 * Math.cos(G1) * -0.1142 + 0.4 * Math.cos(G2) * -0.1533);
    out.hv = A * (mT * sn + m * cs * thT - 0.44 * m * mT * c2 + 0.44 * m * m * s2 * thT)
      + Ar * Math.cos(thr) * (-kr * cr)
      + Ac * Math.cos(thc) * (-kc * cc)
      + rp * hb15 * 0.12 * 2.3 * Math.cos(C[2] + s * 0.05) + sl * q * V[3] * Math.cos(ts);
    out.sw = a * m;
    out.rap = rapRel;
    out.hs = A * m * (cs + 0.44 * m * s2) * k;
    out.c = c;
    const ks = A * m * k * k * (sn - 4 * pk * c2), kro = Ar * kr * kr * snr, kch = Ac * kc * kc * snc;
    out.k0 = ks + kro + kch; out.k1 = ks * c + kro * cr + kch * cc; out.k2 = ks * c * c + kro * cr * cr + kch * cc * cc;
  }
  return out;
}

// Frame of segment o at the point (x, y, z): the segment is a Hermite curve from P0 to P1 with
// the band's true tangents at its ends, so neighbors meet with the same position, tangent and
// up. Writes (to g) the curve parameter tau, the offset d from the curve, the tangent T, up U,
// right R and how far past an end the point lies (beyond). Returns false if the point is
// farther than `bound` from the segment.
// IMPORTANT: mirrored by brFrame in braids.glsl.js.
export function segFrame(seg, o, x, y, z, bound, g) {
  const ax = seg[o], ay = seg[o + 1], az = seg[o + 2];
  const bx = seg[o + 4], by = seg[o + 5], bz = seg[o + 6];
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  const ee = ex * ex + ey * ey + ez * ez;
  const L = Math.sqrt(ee);
  const tauR = ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / ee;
  let tau = tauR < 0 ? 0 : tauR > 1 ? 1 : tauR;
  // Quick reject on the chord (with room for the curve's bulge).
  const cx0 = x - (ax + ex * tau), cy0 = y - (ay + ey * tau), cz0 = z - (az + ez * tau);
  const lim = bound + 0.15 * L;
  if (cx0 * cx0 + cy0 * cy0 + cz0 * cz0 > lim * lim) return false;
  const t0x = seg[o + 24], t0y = seg[o + 25], t0z = seg[o + 26];
  const t1x = seg[o + 28], t1y = seg[o + 29], t1z = seg[o + 30];
  let px, py, pz, tx, ty, tz;
  if (tauR <= 0) { px = ax; py = ay; pz = az; tx = t0x; ty = t0y; tz = t0z; }
  else if (tauR >= 1) { px = bx; py = by; pz = bz; tx = t1x; ty = t1y; tz = t1z; }
  else {
    // One Newton step from the chord's parameter toward the closest point on the curve.
    for (let it = 0; it < 2; it++) {
      const t = tau, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      const d00 = 6 * t2 - 6 * t, d10 = 3 * t2 - 4 * t + 1, d01 = -6 * t2 + 6 * t, d11 = 3 * t2 - 2 * t;
      px = h00 * ax + h10 * L * t0x + h01 * bx + h11 * L * t1x;
      py = h00 * ay + h10 * L * t0y + h01 * by + h11 * L * t1y;
      pz = h00 * az + h10 * L * t0z + h01 * bz + h11 * L * t1z;
      tx = d00 * ax + d10 * L * t0x + d01 * bx + d11 * L * t1x;
      ty = d00 * ay + d10 * L * t0y + d01 * by + d11 * L * t1y;
      tz = d00 * az + d10 * L * t0z + d01 * bz + d11 * L * t1z;
      if (it === 1) break;
      const tt = tx * tx + ty * ty + tz * tz;
      tau = Math.min(1, Math.max(0, tau + ((x - px) * tx + (y - py) * ty + (z - pz) * tz) / tt));
    }
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  }
  const dx = x - px, dy = y - py, dz = z - pz;
  let ux = seg[o + 8] + (seg[o + 12] - seg[o + 8]) * tau;
  let uy = seg[o + 9] + (seg[o + 13] - seg[o + 9]) * tau;
  let uz = seg[o + 10] + (seg[o + 14] - seg[o + 10]) * tau;
  const ut = ux * tx + uy * ty + uz * tz;
  ux -= ut * tx; uy -= ut * ty; uz -= ut * tz;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  g.tau = tau; g.dx = dx; g.dy = dy; g.dz = dz;
  g.tx = tx; g.ty = ty; g.tz = tz; g.ux = ux; g.uy = uy; g.uz = uz;
  g.rx = ty * uz - tz * uy; g.ry = tz * ux - tx * uz; g.rz = tx * uy - ty * ux;
  // How far past the segment's end (along its end tangent) the point lies. On a tightly curved
  // segment a point near the end can fall past the chord's end yet still be short of the
  // curve's end: that is not past it.
  const along = dx * tx + dy * ty + dz * tz;
  g.beyond = tauR > 1 ? Math.max(0, along) : tauR < 0 ? Math.max(0, -along) : 0;
  return true;
}
