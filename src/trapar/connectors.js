// Vertical connectors: streams that cross between adjacent layers of the network.
//
// The world is divided into square connector cells (connectorCell). Each cell, for each pair of
// adjacent layers, gets its own handful of connectors, so they are spread everywhere:
//   ramp      a long, gentle stream between a stream of one layer and one of the other, up or
//             down (where the layers pinch together they are short).
//   updraft   a narrow, fast stream that flows UP in a cascade: steep surges with flat ledges
//             between them (each crest is a place to pop off).
//   spiral    an updraft that corkscrews up through the open air between the layers.
//   chute     a steep, deep-walled plunge from the upper layer onto the lower one.
//   drop      a stream of the upper layer that ends in a kicker, aimed so a rider launching
//             off it falls onto a stream of the layer below.
// Each leaves its first host through an exit lane and joins its last host through a merge lane,
// like any branch (drops end in the air). Everything a cell builds stays inside the cell, so
// cells never interfere and the result does not depend on the order they are built in.

import { TAU, sst, cellHash3, hashu } from '../sky/common.js';
import { mulberry32 } from '../sky/noise.js';
import { Layer, Fine, Index, NET, CLS, TAG, TIER, frameAt } from './layer.js';

export const CONN = {
  MARGIN: 70,     // connectors stay this far inside their cell (m)
  PAD: 150,       // bands this far outside the cell are kept clear of too (m)
  EASE: 200,      // ramps and chutes ease in and out over this length (m)
};
const KINDS = ['spiral', 'updraft', 'chute', 'ramp', 'drop'];

// A drop's flow and its kicker's slope. Riders launch at about the drop's cruising speed (the
// rider steers the rest of the way).
const DROP_FLOW = 24, KICK = 0.2;

export class Connectors extends Layer {
  constructor(net) { super(net, 1); this.cells = new Map(); this._flight = null; this.made = {}; }

  _setup(P, seedH, clear) {
    super._setup(P, seedH, clear);
    if (clear) { this.cells.clear(); this._flight = null; }
  }

  // A host that gains a lane needs its walls cut again (see Network.bandsIn).
  _reserve(host, ln) { super._reserve(host, ln); host.dirty = true; }

  cell(ci, cj) {
    const key = `${ci}|${cj}`;
    let c = this.cells.get(key);
    if (!c) { c = this._buildCell(ci, cj); this.cells.set(key, c); }
    return c;
  }

  _buildCell(ci, cj) {
    const P = this.P, C = Math.max(1000, P.connectorCell), M = CONN.MARGIN;
    const rect = [ci * C + M, (ci + 1) * C - M, cj * C + M, (cj + 1) * C - M];
    const bands = [];
    if (!P.layersOn) return { bands, rect };
    for (const lo of [0, 1]) {
      const ctx = this.makeCtx(rect, lo, bands, mulberry32(cellHash3(ci, cj, 300 + lo, this.seedH)));
      // connectorsPerCell slots (the fraction is a chance of one more), each filled with a
      // kind drawn by weight; if that kind will not fit, others are tried.
      const wts = { spiral: P.spiralUpsMix, updraft: P.updraftMix, chute: P.chuteMix, ramp: P.rampMix, drop: P.dropMix };
      const wsum = KINDS.reduce((a, k) => a + Math.max(0, wts[k] || 0), 0);
      if (wsum <= 0) continue;
      const pick = () => { let u = ctx.rng() * wsum; for (const k of KINDS) { u -= Math.max(0, wts[k] || 0); if (u <= 0) return k; } return 'drop'; };
      const lam = Math.max(0, P.connectorsPerCell);
      const n = Math.floor(lam) + (ctx.rng() < lam - Math.floor(lam) ? 1 : 0);
      for (let c = 0; c < n; c++) {
        // The drawn kind gets several tries; if it will not fit here, up to two others.
        const tried = new Set();
        let kind = pick(), done = false;
        for (let k = 0; k < 3 && !done; k++) {
          if (k > 0) { for (let u = 0; u < 8 && tried.has(kind); u++) kind = pick(); if (tried.has(kind)) break; }
          tried.add(kind);
          for (let t = 0; t < 8 && !done; t++) {
            const b = this._try(ctx, kind);
            if (b) {
              b.conn = true; b.layer = lo; b.connKind = kind;
              bands.push(b);
              this.made[kind] = (this.made[kind] || 0) + 1;
              done = true;
            }
          }
        }
      }
    }
    return { bands, rect };
  }

  // Everything a cell needs to build the connectors between layers lo and lo + 1: the bands of
  // both (and connectors already made, `extra`) in a clearance index, and the hosts.
  makeCtx(rect, lo, extra, rng) {
    const net = this.net, hi = lo + 1, pad = CONN.PAD;
    const box = [rect[0] - pad, rect[1] + pad, rect[2] - pad, rect[3] + pad];
    const A = net.layers[lo].allIn(...box), B = net.layers[hi].allIn(...box);
    const idx = new Index(40);
    for (const b of [...A, ...B, ...extra]) {
      for (const p of this._probes(b)) if (p.x > box[0] && p.x < box[1] && p.z > box[2] && p.z < box[3]) idx.add(p);
    }
    // (and keep clear of the islands in and between the two layers)
    for (const L of [net.layers[lo], net.layers[hi]]) for (const I of L.islandsIn(...box)) for (const p of L._islandProbes(I)) idx.add(p);
    const host = (b) => b.cls === CLS.TRUNK || (b.tier === TIER.ROOT && !(b.tag[0] & TAG.KNOT));
    const ctx = {
      rect, idx, lo, hi, rng,
      low: A.filter(host), high: B.filter(host),
      lowAll: A.filter((b) => b.tier <= TIER.ROOT && !(b.tag[0] & TAG.KNOT) && !b.kind.startsWith('drop')),
      inr: new Map(), okLane: new Map(),
    };
    for (const b of [...ctx.low, ...ctx.high, ...ctx.lowAll]) if (!ctx.inr.has(b)) ctx.inr.set(b, this._inRect(b, rect, 30));
    return ctx;
  }

  // Indices of band b's samples inside rect (shrunk by m).
  _inRect(b, r, m) {
    const out = [];
    for (let i = 0; i < b.n; i++) if (b.x[i] > r[0] + m && b.x[i] < r[1] - m && b.z[i] > r[2] + m && b.z[i] < r[3] - m) out.push(i);
    return out;
  }
  _inR(r, x, z, m = 0) { return x > r[0] + m && x < r[1] - m && z > r[2] + m && z < r[3] - m; }

  // A lane on host (exit: delta +1, merge: -1) at a random place inside the cell.
  _laneIn(ctx, host, delta, len, near = null) {
    const ids = near === null ? this._okLane(ctx, host, delta, len) : null;
    if (near !== null) return this._laneFits(ctx, host, near, delta, len, ctx.rng);
    if (!ids.length) return null;
    for (let t = 0; t < 6; t++) {
      const ln = this._laneFits(ctx, host, ids[Math.floor(ctx.rng() * ids.length)], delta, len, ctx.rng);
      if (ln) return ln;
    }
    return null;
  }

  // Lane fit test for host at sample i (either side if the host allows), or null.
  _laneFits(ctx, host, i, delta, len, rng) {
    const s = i * host.sp;
    const free = host.free.find(([c, d]) => s >= c && s <= d);
    if (!free) return null;
    const side = free[2] !== 0 ? free[2] : rng && rng() < 0.5 ? 1 : -1;
    const ln = { sAtt: s, delta, side, len };
    // Clear of other lanes on both sides (a branch on the far side lies on the same floor).
    const ok = (l) => {
      if (!this._inFree(host, l) || !this._resFree(host, l) || !this._resFree(host, { ...l, side: -l.side })) return false;
      const [a, c] = this._laneSpan(l);
      const f = this._f2;
      for (const q of [a, (a + c) / 2, c]) { frameAt(host, q, f); if (!this._inR(ctx.rect, f.x, f.z, 10)) return false; }
      return true;
    };
    if (ok(ln)) return ln;
    if (free[2] === 0) { ln.side = -ln.side; if (ok(ln)) return ln; }
    return null;
  }
  // Samples of host (inside the cell) where a lane fits, cached per cell build.
  _okLane(ctx, host, delta, len) {
    const key = host.id * 4 + (delta > 0 ? 0 : 2) + (len > 120 ? 1 : 0);
    let v = ctx.okLane.get(key);
    if (!v) {
      v = [];
      const ids = ctx.inr.get(host) || [];
      for (let k = 0; k < ids.length; k += 2) if (this._laneFits(ctx, host, ids[k], delta, len, null)) v.push(ids[k]);
      ctx.okLane.set(key, v);
    }
    return v;
  }

  _try(ctx, kind) {
    if (kind === 'spiral') return this._spiralUp(ctx);
    if (kind === 'updraft') return this._updraft(ctx);
    if (kind === 'chute') return this._chute(ctx);
    if (kind === 'ramp') return this._ramp(ctx, ctx.rng() < 0.5 ? 1 : -1);
    return this._dropDown(ctx);
  }

  // An exit lane on a random host of one layer, and its end.
  _start(ctx, hosts, dm, room = 0) {
    const rng = ctx.rng;
    const pool = hosts.filter((b) => this._okLane(ctx, b, 1, dm.lane).length > 0);
    if (!pool.length) return this._why('conn: no exit lane');
    // Prefer exits heading into the cell (there is more room ahead).
    const r = ctx.rect, cx = (r[0] + r[1]) / 2, cz = (r[2] + r[3]) / 2;
    let any = null;
    for (let t = 0; t < 8; t++) {
      const host = pool[Math.floor(rng() * pool.length)];
      const lnA = this._laneIn(ctx, host, 1, dm.lane);
      if (!lnA) continue;
      const E = this._laneEnd(host, lnA, dm.w);
      if (room && !this._roomAt(ctx, E, E.hx, E.hz, room, 160, host)) continue;
      if (E.hx * (cx - E.x) + E.hz * (cz - E.z) > 0) return { host, lnA, E };
      any = any || { host, lnA, E };
    }
    return any || this._why('conn: no exit lane');
  }

  // Is there open air between heights y0 and y1 within r of (x, z) (ignoring band skip)?
  _open(ctx, x, z, y0, y1, r, skip) {
    let ok = true;
    ctx.idx.query(x, z, r + 30, (q) => {
      if (!ok || q.b === skip) return;
      const dx = q.x - x, dz = q.z - z;
      if (dx * dx + dz * dz > (r + q.ah) * (r + q.ah)) return;
      if (q.y + q.va > y0 && q.y - q.vb < y1) ok = false;
    });
    return ok;
  }
  // Room to climb (dir 1) or descend (-1) for `len` meters off a lane end P (heading hx, hz),
  // or to arrive there (back = true: the stretch before it).
  _roomAt(ctx, P, hx, hz, dir, len, host, back = false) {
    const sg = back ? -1 : 1;
    for (const d of [len * 0.5, len]) {
      const x = P.x + hx * d * sg, z = P.z + hz * d * sg, h = d * 0.35;
      const y0 = dir > 0 ? P.y + 22 : P.y - h - 30, y1 = dir > 0 ? P.y + h + 30 : P.y - 22;
      if (!this._open(ctx, x, z, y0, y1, 10, host)) return false;
    }
    return true;
  }

  // A merge-lane target on one of `hosts` for a branch leaving E: horizontal distance within
  // [dmin, dmax], height difference test dyOk(dy, D), ahead of E, and arriving along the
  // target's flow.
  _target(ctx, hosts, E, dm, dmin, dmax, dyOk, align = 0.2, ahead = 0.2, room = 0, near = false) {
    const rng = ctx.rng, cands = [];
    for (const b of hosts) {
      const ids = this._okLane(ctx, b, -1, dm.lane);
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        const dx = b.x[i] - E.x, dz = b.z[i] - E.z, D = Math.hypot(dx, dz);
        if (D < dmin || D > dmax || !dyOk(b.y[i] - E.y, D)) continue;
        if (b.tag[i] & (TAG.LANE | TAG.TWIST | TAG.SPIRAL | TAG.TIP)) continue;
        if ((E.hx * dx + E.hz * dz) / D < ahead) continue;
        const ia = b.idx(i - 1), ic = b.idx(i + 1);
        let tx = b.x[ic] - b.x[ia], tz = b.z[ic] - b.z[ia]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        if ((tx * dx + tz * dz) / D < align) continue;
        cands.push(b, i);
      }
    }
    let nc = cands.length / 2;
    if (near && nc > 6) {
      // Prefer the nearest third (the steepest, shortest connectors).
      const ord = [...Array(nc).keys()].sort((p, q) => {
        const bp = cands[2 * p], ip = cands[2 * p + 1], bq = cands[2 * q], iq = cands[2 * q + 1];
        return Math.hypot(bp.x[ip] - E.x, bp.z[ip] - E.z) - Math.hypot(bq.x[iq] - E.x, bq.z[iq] - E.z);
      }).slice(0, Math.ceil(nc / 3));
      const c2 = []; for (const k of ord) c2.push(cands[2 * k], cands[2 * k + 1]);
      cands.length = 0; cands.push(...c2); nc = c2.length / 2;
    }
    for (let t = 0; t < 24 && nc; t++) {
      const k = Math.floor(rng() * nc), b = cands[2 * k], i = cands[2 * k + 1];
      const lnB = this._laneIn(ctx, b, -1, dm.lane, i);
      if (!lnB) continue;
      const Mr = this._laneEnd(b, lnB, dm.w);
      // Arriving from below (room > 0) or above (< 0): open air there.
      if (room && !this._roomAt(ctx, Mr, Mr.hx, Mr.hz, -room, 160, b)) { this._why('conn: target crowded'); continue; }
      return { dst: b, lnB, Mr };
    }
    return this._why(nc ? 'conn: no target lane' : 'conn: no target');
  }

  // Fine points of a free middle along `path` with height y(s) (s: horizontal arclength from
  // E). The profile's slope is zero at both ends; the hosts' slopes there are blended in.
  // steep(s): banking hardness (spirals); tip: the path ends in the air.
  _connMiddle(F, path, E, Mr, M, yAt, o = {}) {
    const S = path.L;
    for (let q = 0; q < path.x.length; q++) {
      const s = path.s[q];
      let y = yAt(s);
      if (s < 150) y += E.g * s * (1 - s / 150) ** 2;
      if (!o.tip && S - s < 150) y += M.g * (s - S) * (1 - (S - s) / 150) ** 2;
      const away = o.tip ? s : Math.min(s, S - s);
      const hu = s < S / 2 || o.tip ? E : Mr;
      F.push(path.x[q], y, path.z[q], 1 - sst(0, 70, away), 1e9, hu.ux, hu.uy, hu.uz, hu.cx, hu.cy, hu.cz,
        sst(30, 90, away), o.steep ? o.steep(s) : 0, 1, o.tip ? S - s + (o.runout || 0) : 1e9);
    }
  }

  // A path from E to M (M heading the way it arrives), wandering a little; null if it bends
  // too hard or leaves the cell.
  _connPath(ctx, E, M, Mr, tier, rmin, wps = []) {
    let path = this._path2D(E, M, wps, 0.9, 4);
    if (!wps.length) path = this._applyWander(path, this._wander(E, M, Mr, tier, ctx.rng));
    if (this._maxCurv(path, 6) > 1 / rmin) return this._why('conn: curv');
    for (let q = 0; q < path.x.length; q += 4) if (!this._inR(ctx.rect, path.x[q], path.z[q])) return this._why('conn: outside');
    return path;
  }

  _commitConn(ctx, key, F, mid0, mid1, lanes, d, o = {}) {
    return this._commit({
      key, F, mid0: mid0 + 10, mid1: mid1 - 10, lanes, d,
      idx: ctx.idx, inside: null, rect: ctx.rect, grade: o.grade, weave: o.weave || 0, noBump: !!o.noBump,
    });
  }

  // --- ramps -----------------------------------------------------------------------------------

  // dir +1: from the lower layer up to the upper; -1: down.
  _ramp(ctx, dir) {
    const dm = { ...this._dims(TIER.ROOT), flow: 20 };
    const st = this._start(ctx, dir > 0 ? ctx.low : ctx.high, dm, dir);
    if (!st) return null;
    const { host, lnA, E } = st;
    const GMAX = 0.13, e = CONN.EASE;
    // Long enough to climb (or drop) the difference at no more than GMAX, plus the eases.
    const tg = this._target(ctx, dir > 0 ? ctx.high : ctx.low, E, dm, 700, 3600,
      (dy, D) => dy * dir > 120 && D * 1.08 > Math.abs(dy) / GMAX + e + 2 * dm.lane, -0.2, 0.2, dir);
    // Too far to ramp straight across: a grand spiral ramp instead.
    if (!tg) return this._helixConn(ctx, { up: dir, R: [160, 300], g: [0.08, 0.14], tier: TIER.ROOT, flow: 22, tag: TAG.RAMP, key: `ramp ${dir > 0 ? 'up' : 'down'}`, steep: false, grade: 0.17, minSweep: 0.5 * Math.PI, maxTurns: 2, exitMax: 600, maxLen: 3200 });
    const { dst, lnB, Mr } = tg, M = { ...Mr, hx: -Mr.hx, hz: -Mr.hz, g: -Mr.g };
    const path = this._connPath(ctx, E, M, Mr, TIER.ROOT, 140);
    if (!path) return null;
    const S = path.L, dy = M.y - E.y;
    if (Math.abs(dy) / Math.max(1, S - e) > GMAX + 0.02) return this._why('conn: ramp steep');
    const F = new Fine();
    this._pushLane(F, host, lnA, dm.w, false);
    const mid0 = this._arclen(F);
    // Even grade with eased ends.
    const prof = this._easedProfile(S, e);
    this._connMiddle(F, path, E, Mr, M, (s) => E.y + dy * prof(s));
    const mid1 = this._arclen(F);
    this._pushLane(F, dst, lnB, dm.w, true);
    return this._commitConn(ctx, `ramp ${dir > 0 ? 'up' : 'down'}`, F, mid0, mid1,
      [{ host, ln: lnA, atStart: true }, { host: dst, ln: lnB, atStart: false }],
      { tier: TIER.ROOT, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed: hashu(Math.floor(ctx.rng() * 4294967295)), attachStart: true, attachEnd: true, features: false, tag: TAG.RAMP },
      { grade: GMAX, weave: ctx.rng() < 0.5 ? 1 : -1 });
  }

  // 0 -> 1 over [0, S], slope zero at both ends and constant between eases of length e.
  _easedProfile(S, e) {
    e = Math.min(e, S / 2.2);
    // The slope sst(0, e, s) * sst(S, S - e, s), integrated.
    return this._slopeProfile(S, (s) => sst(0, e, s) * sst(S, S - e, s)).f;
  }

  // A profile from a slope function g(s) on [0, S] (normalized to rise 0 -> 1).
  _slopeProfile(S, g) {
    const n = Math.max(16, Math.ceil(S / 2)), cum = new Float64Array(n + 1);
    for (let k = 1; k <= n; k++) cum[k] = cum[k - 1] + g(((k - 0.5) * S) / n);
    const tot = cum[n] || 1;
    return { tot: (tot * S) / n, f: (s) => {
      const f = Math.min(n, Math.max(0, (s / S) * n)), k = Math.floor(f);
      return (k >= n ? cum[n] : cum[k] + (cum[k + 1] - cum[k]) * (f - k)) / tot;
    } };
  }

  // --- updraft cascades --------------------------------------------------------------------------

  _updraft(ctx) {
    const dm = { ...this._dims(TIER.ROOTLET), flow: 36 };
    const st = this._start(ctx, ctx.low, dm, 1);
    if (!st) return null;
    const { host, lnA, E } = st;
    // Average grade of a cascade about 0.3-0.5 (surges near 0.75, ledges nearly flat).
    const tg = this._target(ctx, ctx.high, E, dm, 350, 2400, (dy, D) => dy > 120 && dy / (D * 1.15) > 0.24 && dy / D < 0.6, -0.1, 0.35, 1, true);
    if (!tg) return null;
    const { dst, lnB, Mr } = tg, M = { ...Mr, hx: -Mr.hx, hz: -Mr.hz, g: -Mr.g };
    const path = this._connPath(ctx, E, M, Mr, TIER.ROOTLET, 150);
    if (!path) return null;
    const S = path.L, dy = M.y - E.y, e = 60;
    // Steps: a flat ledge, a concave turn up, a steep surge, a long convex crest.
    const k = Math.max(2, Math.round((S - 2 * e) / 320)), lam = (S - 2 * e) / k;
    const gl = 0.05, gs = 0.75;
    const g = (s) => {
      if (s < e || s > S - e) return 0.01 * sst(0, e, s) * sst(S, S - e, s);
      const t = ((s - e) / lam) % 1;
      return gl + (gs - gl) * (sst(0.2, 0.31, t) - sst(0.72, 1.0, t));
    };
    const pr = this._slopeProfile(S, g);
    const scale = dy / pr.tot;
    if (scale * gs < 0.5 || scale * gs > 0.82) return this._why('conn: cascade grade');
    const F = new Fine();
    this._pushLane(F, host, lnA, dm.w, false);
    const mid0 = this._arclen(F);
    this._connMiddle(F, path, E, Mr, M, (s) => E.y + dy * pr.f(s));
    const mid1 = this._arclen(F);
    this._pushLane(F, dst, lnB, dm.w, true);
    return this._commitConn(ctx, 'updraft', F, mid0, mid1,
      [{ host, ln: lnA, atStart: true }, { host: dst, ln: lnB, atStart: false }],
      { tier: TIER.ROOTLET, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed: hashu(Math.floor(ctx.rng() * 4294967295)), attachStart: true, attachEnd: true, features: false, tag: TAG.UP },
      { grade: 0.9, weave: 1 });
  }

  // --- spiral updrafts -----------------------------------------------------------------------------

  _spiralUp(ctx) {
    return this._helixConn(ctx, { up: 1, R: [70, 110], g: [0.28, 0.45], tier: TIER.ROOT, flow: 38, tag: TAG.UP, key: 'spiral up', steep: true, grade: 0.5, minSweep: 1.5 * Math.PI, exitMax: 450, approach: [120, 320], ga: 0.12 });
  }

  // A stream that winds round a helix between a stream of one layer and one of the other:
  // up (o.up 1) or down (-1), radius in o.R, climbing at a grade in o.g, approached and left
  // along gentle curves.
  _helixConn(ctx, o) {
    const rng = ctx.rng;
    const dm = { ...this._dims(o.tier), flow: o.flow };
    const st = this._start(ctx, o.up > 0 ? ctx.low : ctx.high, dm, o.up);
    if (!st) return null;
    const { host, lnA, E } = st;
    // Straight on from the exit lane into the helix (it turns either way).
    const ap = o.approach || [160, 440], R = o.R[0] + rng() * (o.R[1] - o.R[0]), dir = rng() < 0.5 ? 1 : -1, a = ap[0] + rng() * (ap[1] - ap[0]);
    const T0 = { x: E.x + E.hx * a, z: E.z + E.hz * a, hx: E.hx, hz: E.hz };
    const Cx = T0.x - R * dir * E.hz, Cz = T0.z + R * dir * E.hx;
    if (!this._inR(ctx.rect, Cx, Cz, R + 30) || !this._inR(ctx.rect, T0.x, T0.z, 20)) return this._why('conn: outside');
    const th0 = Math.atan2(T0.z - Cz, T0.x - Cx);
    const pt = (th) => ({ x: Cx + R * Math.cos(th), z: Cz + R * Math.sin(th), hx: -Math.sin(th) * dir, hz: Math.cos(th) * dir });
    // Leave the helix along a tangent toward a merge on the other layer, arriving with its flow.
    const cands = [];
    for (const b of o.up > 0 ? ctx.high : ctx.low) {
      const ids = this._okLane(ctx, b, -1, dm.lane);
      for (const i of ids) {
        const dx = b.x[i] - Cx, dz = b.z[i] - Cz, dM = Math.hypot(dx, dz);
        if (dM < R + 220 || dM > R + (o.exitMax || 900) || (b.y[i] - E.y) * o.up < 150) continue;
        const th1 = Math.atan2(dz, dx) - dir * Math.acos(R / dM);
        const tx = -Math.sin(th1) * dir, tz = Math.cos(th1) * dir;
        const ia = b.idx(i - 1), ic = b.idx(i + 1);
        let fx = b.x[ic] - b.x[ia], fz = b.z[ic] - b.z[ia]; const fl = Math.hypot(fx, fz) || 1;
        if ((fx * tx + fz * tz) / fl < 0.35) continue;
        cands.push(b, i, th1);
      }
    }
    const nc = cands.length / 3;
    if (!nc) return this._why('conn: no target');
    let tg = null;
    for (let t = 0; t < 12 && !tg; t++) {
      const k = Math.floor(rng() * nc), b = cands[3 * k], i = cands[3 * k + 1];
      const lnB = this._laneIn(ctx, b, -1, dm.lane, i);
      if (!lnB) continue;
      const Mr = this._laneEnd(b, lnB, dm.w);
      if (!this._roomAt(ctx, Mr, Mr.hx, Mr.hz, -o.up, 160, b)) { this._why('conn: target crowded'); continue; }
      tg = { dst: b, lnB, Mr, th1: cands[3 * k + 2] };
    }
    if (!tg) return this._why('conn: no target lane');
    const { dst, lnB, Mr } = tg, M = { ...Mr, hx: -Mr.hx, hz: -Mr.hz, g: -Mr.g };
    const th1 = Math.atan2(M.z - Cz, M.x - Cx) - dir * Math.acos(R / Math.max(R + 1, Math.hypot(M.x - Cx, M.z - Cz)));
    const pa = this._path2D(E, T0, [], 0.9, 4), pb = this._path2D(pt(th1), M, [], 0.9, 4);
    if (this._maxCurv(pb, 6) > 1 / 75) return this._why('conn: curv');
    for (const p of [pa, pb]) for (let q = 0; q < p.x.length; q += 4) if (!this._inR(ctx.rect, p.x[q], p.z[q])) return this._why('conn: outside');
    const dy = M.y - E.y, ady = Math.abs(dy);
    const ga = Math.min(o.ga || 0.06, o.g[0]), ya = Math.min(ady * 0.25, ga * Math.max(0, pa.L - 100)), yb = Math.min(ady * 0.2, ga * Math.max(0, pb.L - 100));
    const dyh = ady - ya - yb;
    let sweep = dir * (th1 - th0); sweep = ((sweep % TAU) + TAU) % TAU;
    // Enough turns to keep the climb under the top grade.
    while (dyh / (R * sweep) > o.g[1]) sweep += TAU;
    const gh = dyh / (R * sweep);
    if (o.maxTurns && sweep > o.maxTurns * TAU) return this._why('conn: helix turns');
    if (o.maxLen && pa.L + R * sweep + pb.L > o.maxLen) return this._why('conn: helix long');
    if (gh < o.g[0] || sweep < (o.minSweep || Math.PI)) return this._why('conn: helix turns');
    // Assemble: approach, helix, exit (horizontal arclength s across the whole).
    const xs = [], zs = [], ss = [];
    let s = 0;
    const add = (x, z) => { if (xs.length) s += Math.hypot(x - xs[xs.length - 1], z - zs[zs.length - 1]); xs.push(x); zs.push(z); ss.push(s); };
    for (let q = 0; q < pa.x.length - 1; q++) add(pa.x[q], pa.z[q]);
    const sh0 = s + Math.hypot(T0.x - xs[xs.length - 1], T0.z - zs[zs.length - 1]);
    const nh = Math.ceil((R * sweep) / 4);
    for (let q = 0; q < nh; q++) { const P0 = pt(th0 + (dir * sweep * q) / nh); add(P0.x, P0.z); }
    const sh1 = sh0 + R * sweep;
    for (let q = 0; q < pb.x.length; q++) add(pb.x[q], pb.z[q]);
    const path = { x: Float64Array.from(xs), z: Float64Array.from(zs), s: Float64Array.from(ss), L: s };
    const S = path.L;
    // Height: eased on the approach, steady round the helix, eased to the exit.
    const g = (u) => {
      if (u < sh0) return (ga * sst(0, 80, u) * sst(sh0 + 60, sh0 - 40, u)) + gh * sst(sh0 - 40, sh0 + 60, u);
      if (u > sh1) return gh * sst(sh1 + 40, sh1 - 60, u) + ga * sst(sh1 - 60, sh1 + 40, u) * sst(S, S - 80, u);
      return gh;
    };
    const pr = this._slopeProfile(S, g);
    const steep = o.steep ? (u) => sst(sh0 - 60, sh0 + 40, u) * sst(sh1 + 60, sh1 - 40, u) : null;
    const F = new Fine();
    this._pushLane(F, host, lnA, dm.w, false);
    const mid0 = this._arclen(F);
    this._connMiddle(F, path, E, Mr, M, (u) => E.y + dy * pr.f(u), { steep });
    const mid1 = this._arclen(F);
    this._pushLane(F, dst, lnB, dm.w, true);
    const band = this._commitConn(ctx, o.key, F, mid0, mid1,
      [{ host, ln: lnA, atStart: true }, { host: dst, ln: lnB, atStart: false }],
      { tier: o.tier, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed: hashu(Math.floor(rng() * 4294967295)), attachStart: true, attachEnd: true, features: false, tag: o.tag },
      { grade: o.grade, weave: o.up });
    if (band) band.info = { R: Math.round(R), turns: +(sweep / TAU).toFixed(2), grade: +gh.toFixed(2), approach: Math.round(pa.L), helix: Math.round(R * sweep), exit: Math.round(pb.L), dy: Math.round(dy) };
    return band;
  }

  // --- chutes --------------------------------------------------------------------------------------

  _chute(ctx) {
    const dm = { ...this._dims(TIER.ROOT), flow: 30 };
    dm.w = 13; dm.wf = 4.5;
    const st = this._start(ctx, ctx.high, dm, -1);
    if (!st) return null;
    const { host, lnA, E } = st;
    const e = 240;
    const tg = this._target(ctx, ctx.low, E, dm, 500, 2600, (dy, D) => dy < -150 && -dy / (D * 1.05 - e) < 0.65 && -dy / (D - e) > 0.28, -0.3, 0.35, -1, true);
    if (!tg) return null;
    const { dst, lnB, Mr } = tg, M = { ...Mr, hx: -Mr.hx, hz: -Mr.hz, g: -Mr.g };
    const path = this._connPath(ctx, E, M, Mr, TIER.ROOT, 110);
    if (!path) return null;
    const S = path.L, dy = M.y - E.y;
    const peak = -dy / Math.max(1, S - e);
    if (peak > 0.65 || peak < 0.26) return this._why('conn: chute grade');
    const prof = this._easedProfile(S, e);
    const F = new Fine();
    this._pushLane(F, host, lnA, dm.w, false);
    const mid0 = this._arclen(F);
    this._connMiddle(F, path, E, Mr, M, (s) => E.y + dy * prof(s));
    const mid1 = this._arclen(F);
    this._pushLane(F, dst, lnB, dm.w, true);
    return this._commitConn(ctx, 'chute', F, mid0, mid1,
      [{ host, ln: lnA, atStart: true }, { host: dst, ln: lnB, atStart: false }],
      { tier: TIER.ROOT, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed: hashu(Math.floor(ctx.rng() * 4294967295)), attachStart: true, attachEnd: true, features: false, tag: TAG.CHUTE, wallDeg: 95, rapids: 'steep' },
      { grade: 0.65, weave: -1 });
  }

  // --- drops to the layer below ----------------------------------------------------------------------

  // Horizontal distance covered while falling h meters after launching off a kicker at the
  // nominal speed (the rider's air model: fall gravity, drag, top falling speed).
  flightReach(h) {
    if (!this._flight) {
      const P = this.P, G = Math.max(1, P.gravity), fg = Math.max(1, P.fallGravity || 1.3), k = Math.max(0, P.airDrag), vt = Math.max(5, P.terminalSpeed);
      const v0 = P.cruiseSpeed + P.cruiseFromFlow * Math.max(0, DROP_FLOW - P.trunkFlow);
      let vx = v0 / Math.hypot(1, KICK), vy = vx * KICK, x = 0, y = 0;
      const tab = [];
      const dt = 0.02;
      for (let t = 0; t < 30 && y > -1200; t += dt) {
        const v = Math.hypot(vx, vy);
        const gr = G * (vy < 0 ? fg * (1 - Math.min(1, (-vy / vt) ** 4)) : 1);
        vx += -k * v * vx * dt; vy += (-gr - k * v * vy) * dt;
        x += vx * dt; y += vy * dt;
        if (vy < 0) tab.push([-y, x, t, vx, vy]);
      }
      this._flight = tab;
    }
    const tab = this._flight;
    let lo = 0, hi = tab.length - 1;
    if (h <= tab[0][0]) return tab[0];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m][0] < h) lo = m; else hi = m; }
    return tab[hi];
  }

  _dropDown(ctx) {
    const rng = ctx.rng;
    const dm = { ...this._dims(TIER.ROOTLET), flow: DROP_FLOW };
    const st = this._start(ctx, ctx.high, dm);
    if (!st) return null;
    const { host, lnA, E } = st;
    const run = 45, lead = 20;
    // A landing: a plain stretch of the lower layer, running away from E.
    const cands = [];
    for (const b of ctx.lowAll) {
      const ids = ctx.inr.get(b);
      for (let k = 0; k < ids.length; k += 4) {
        const i = ids[k];
        if (b.pres[i] < 0.99 || b.cord[i] > 0.01 || b.tag[i] & (TAG.TWIST | TAG.SPIRAL | TAG.TIP | TAG.LANE | TAG.PIPE | TAG.BARREL)) continue;
        const h = E.y - 6 - b.y[i];
        if (h < 140) continue;
        const dx = b.x[i] - E.x, dz = b.z[i] - E.z, D = Math.hypot(dx, dz);
        if (D < 260 || D > 800) continue;
        const ia = b.idx(i - 1), ic = b.idx(i + 1);
        let tx = b.x[ic] - b.x[ia], tz = b.z[ic] - b.z[ia]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        if ((tx * dx + tz * dz) / D < 0.3 || (E.hx * dx + E.hz * dz) / D < 0.2) continue;
        // A forgiving landing: the stream runs on fairly straight and level either side.
        const m = Math.round(80 / b.sp), i0 = b.idx(i - m), i1 = b.idx(i + m);
        if (!b.closed && (i - m < 0 || i + m >= b.n)) continue;
        const ax = b.x[i] - b.x[i0], az = b.z[i] - b.z[i0], cx2 = b.x[i1] - b.x[i], cz2 = b.z[i1] - b.z[i];
        const al = Math.hypot(ax, az) || 1, cl = Math.hypot(cx2, cz2) || 1;
        if ((ax * cx2 + az * cz2) / (al * cl) < 0.95 || Math.abs(b.y[i1] - b.y[i0]) / (al + cl) > 0.15) continue;
        cands.push(b, i, tx, tz);
      }
    }
    const nc = cands.length / 4;
    if (!nc) return this._why('conn: drop nothing below');
    for (let t = 0; t < 6; t++) {
      const k = Math.floor(rng() * nc), b = cands[4 * k], i = cands[4 * k + 1], thx = cands[4 * k + 2], thz = cands[4 * k + 3];
      const Q = { x: b.x[i], y: b.y[i], z: b.z[i] };
      // The tip stands back from the landing by the flight's reach, at about E's height.
      const tipY = E.y - 6;
      const fl = this.flightReach(tipY - Q.y);
      const back = fl[1] + lead;
      const T = { x: Q.x - thx * back, z: Q.z - thz * back };
      const Mp = { x: T.x - thx * run, z: T.z - thz * run, hx: thx, hz: thz, g: KICK };
      if (!this._inR(ctx.rect, T.x, T.z, 20) || Math.hypot(Mp.x - E.x, Mp.z - E.z) < 220) continue;
      if (!this._clearFlight(ctx, T, tipY, thx, thz, b, Q)) { this._why('conn: drop flight blocked'); continue; }
      let path = this._path2D(E, Mp, [], 0.9, 4);
      path = this._applyWander(path, this._wander(E, Mp, null, TIER.ROOTLET, rng));
      if (this._maxCurv(path, 6) > 1 / 60) { this._why('conn: curv'); continue; }
      let ok = true;
      for (let q = 0; q < path.x.length; q += 4) if (!this._inR(ctx.rect, path.x[q], path.z[q])) { ok = false; break; }
      if (!ok) { this._why('conn: outside'); continue; }
      const S = path.L, ym = tipY - KICK * run;
      const prof = this._easedProfile(S, 120);
      const F = new Fine();
      this._pushLane(F, host, lnA, dm.w, false);
      const mid0 = this._arclen(F);
      this._connMiddle(F, path, E, E, Mp, (s) => E.y + (ym - E.y) * prof(s), { tip: true, runout: run });
      // The run-out to the kicker's tip.
      const n = Math.ceil(run / 4), y0 = F.y[F.n - 1], q0 = path.x.length - 1;
      for (let m = 1; m <= n; m++) {
        const d = (run * m) / n;
        F.push(path.x[q0] + thx * d, y0 + KICK * d * sst(0, run * 0.6, d), path.z[q0] + thz * d, 0, 1e9, E.ux, E.uy, E.uz, E.cx, E.cy, E.cz, 1, 0, 1 - 0.25 * sst(0.3, 1, d / run), run - d);
      }
      const mid1 = this._arclen(F);
      const bnd = this._commitConn(ctx, 'drop down', F, mid0, mid1 - 50, [{ host, ln: lnA, atStart: true }],
        { tier: TIER.ROOTLET, w: dm.w, wf: dm.wf, lane: dm.lane, flow: dm.flow, seed: hashu(Math.floor(rng() * 4294967295)), attachStart: true, attachEnd: false, tip: true, features: false, tag: 0 },
        { grade: 0.22, weave: 1 });
      if (bnd) { bnd.landing = { x: Q.x, y: Q.y, z: Q.z, band: b.id }; return bnd; }
    }
    return null;
  }

  // Is the fall from the tip T (height y, heading hx, hz) onto Q clear of other streams?
  _clearFlight(ctx, T, y, hx, hz, target, Q) {
    const tab = this._flight, idx = ctx.idx;
    const h = y - Q.y;
    let blocked = false;
    for (let k = 0; k < tab.length && !blocked; k += 4) {
      const [fall, x] = tab[k];
      if (fall > h - 25) break;
      const px = T.x + hx * x, pz = T.z + hz * x, py = y - fall;
      idx.query(px, pz, 30, (q) => {
        if (blocked || (q.b && q.b === target && Math.hypot(q.x - Q.x, q.z - Q.z) < 120)) return;
        const dx = q.x - px, dz = q.z - pz;
        if (dx * dx + dz * dz > (q.ah + 10) * (q.ah + 10)) return;
        if (py > q.y - q.vb - 10 && py < q.y + q.va + 14) blocked = true;
      });
    }
    return !blocked;
  }

  // Connector bands overlapping the box, for cells near the focus.
  bandsIn(x0, x1, z0, z1, fx, fz, rootRange, out) {
    const P = this.P;
    if (!P.layersOn) return out;
    const C = Math.max(1000, P.connectorCell);
    const ci0 = Math.floor(x0 / C), ci1 = Math.floor(x1 / C), cj0 = Math.floor(z0 / C), cj1 = Math.floor(z1 / C);
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const cx = (ci + 0.5) * C, cz = (cj + 0.5) * C;
      const key = `${ci}|${cj}`;
      if (Math.hypot(cx - fx, cz - fz) > rootRange - 0.5 * C && !this.cells.has(key)) continue;
      for (const b of this.cell(ci, cj).bands) if (b.hits(x0, x1, z0, z1)) out.add(b);
    }
    return out;
  }
}

void NET;
