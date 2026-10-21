// Route planning: how to get from where you are to an island, through the network.
//
// The graph is built from the bands of a snapshot (the same bands the streams are made of):
//
//   nodes       points along every band (every STRIDE samples), where it can be ridden
//   ride        from a node to the next one along its band, the way it flows
//   transfer    across to another band running alongside (a branch leaving or joining its
//               host in a lane, a knot, a connector meeting a layer, a dock)
//   drop        off the edge of a stream onto one below, within reach of a fall (no boost)
//   goal        stepping off onto the island (a dock that runs onto its ground), or dropping
//               onto its ground
//
// A* over that (drops found lazily from a spatial hash) gives the fastest route by estimated
// time. Everything is plain arrays, so it runs in the snapshot worker as well as in place.
//
// The result is a polyline the trail follows (points with their up vector and what you are
// doing there) and the maneuvers along it, for the HUD.

import { sst } from '../sky/common.js';
import { TAG } from './layer.js';
import { DOCK_LIFT } from '../world/islands.js';

export const RT = {
  STRIDE: 3,          // band samples per node (36 m at 12 m samples)
  CELL: 48,           // spatial hash cell (m)
  DROP_PEN: 2.5,      // extra cost of a drop (s): ride where you can
  XFER_COST: 1.0,     // crossing to a band alongside (s)
  REACH_MAX: 170,     // farthest horizontal drop considered (m)
  DH_MIN: 8, DH_MAX: 900,
  // Flying (boost in free fall): about two thirds of a full gauge at a steady speed, sinking
  // slowly, then falling the rest.
  FLY_SPEED: 45, FLY_TIME: 5, FLY_PEN: 9, FLY_ON: true,
};
// Point kinds along a route.
export const RK = { RIDE: 0, XFER: 1, DROP: 2, UP: 3, CHUTE: 4, DOCK: 5, LAND: 6, WALK: 7, FLY: 8, TOWARD: 9 };
export const RK_NAMES = ['ride', 'across', 'drop', 'up', 'chute', 'dock', 'land', 'walk', 'fly', 'toward'];

class Grow {
  constructor(T, n = 4096) { this.T = T; this.a = new T(n); this.n = 0; }
  push(v) { if (this.n >= this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
}

// Binary heap of (key, value) pairs, smallest key first.
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// Falling: time to drop dh meters starting with vertical speed vy (up positive), with the
// rider's gravity and a top falling speed; and how far you carry sideways in that time from a
// horizontal speed vh (air drag grows as you fall faster).
export function fallTime(dh, vy, P, vTerm = 0) {
  const g = P.gravity * (P.fallGravity || 1.3), vt = Math.max(15, vTerm || P.terminalSpeed || 60);
  // Up to the top speed: dh = -vy t + g t^2 / 2 ...
  const tTop = (vt + vy) / g, dTop = -vy * tTop + 0.5 * g * tTop * tTop;
  if (dh <= dTop) return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * dh))) / g;
  return tTop + (dh - dTop) / vt;   // ... then steady
}
export function carry(T, vh) { return vh * 4.5 * (1 - Math.exp(-T / 4.5)); }
// Skydiving (off the board): your level speed eases (rate k) from where you were going toward
// where the stick points, at up to the drift speed. After T seconds you can be anywhere in a
// disk: its center carried along by your starting speed, its radius what the stick adds.
export function skyReach(T, P) {
  // (planned with a margin: three quarters of what the stick can do)
  const k = Math.max(0.1, P.skySteer || 1.2), e = (1 - Math.exp(-k * T)) / k;
  return { carry: e, radius: Math.max(0, (P.skyDrift || 16) * (T - e) * 0.65) };
}

export class RouteGraph {
  // bands: the snapshot's bands; center/region: the snapshot's square (nodes fade out near its
  // edge, like the streams).
  constructor(bands, P, cx, cz, region) {
    this.P = P; this.bands = bands;
    const RF0 = region - 1500, RF1 = region - 250;
    const X = new Grow(Float32Array), Y = new Grow(Float32Array), Z = new Grow(Float32Array);
    const UX = new Grow(Float32Array), UY = new Grow(Float32Array), UZ = new Grow(Float32Array);
    const TX = new Grow(Float32Array), TY = new Grow(Float32Array), TZ = new Grow(Float32Array);
    const W = new Grow(Float32Array), SPD = new Grow(Float32Array), NEXT = new Grow(Int32Array), NC = new Grow(Float32Array);
    const BI = new Grow(Int32Array), SI = new Grow(Int32Array), TG = new Grow(Uint16Array);
    const st = RT.STRIDE;
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi], n = b.n, m = b.closed ? n - 1 : n;
      const ok = (i) => (b.pres[i] > 0.4 || b.cord[i] > 0.4) && 1 - sst(RF0, RF1, Math.hypot(b.x[i] - cx, b.z[i] - cz)) > 0.5;
      const speed = Math.min(45, Math.max(20, Math.max(P.cruiseSpeed || 28, b.flow * (P.cruiseFromFlow || 1))));
      let first = -1, prev = -1, prevI = -1;
      const idxs = [];
      for (let i = 0; i < m; i += st) idxs.push(i);
      if (!b.closed && idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
      for (const i of idxs) {
        if (!ok(i)) continue;
        const id = X.n;
        X.push(b.x[i]); Y.push(b.y[i]); Z.push(b.z[i]);
        UX.push(b.ux[i]); UY.push(b.uy[i]); UZ.push(b.uz[i]);
        const ia = b.idx(i - 1), ic = b.idx(i + 1);
        let tx = b.x[ic] - b.x[ia], ty = b.y[ic] - b.y[ia], tz = b.z[ic] - b.z[ia];
        const tl = Math.hypot(tx, ty, tz) || 1; TX.push(tx / tl); TY.push(ty / tl); TZ.push(tz / tl);
        W.push(Math.max(4, b.w[i])); SPD.push(speed); NEXT.push(-1); NC.push(0);
        BI.push(bi); SI.push(i); TG.push(b.tag[i]);
        // Linked to the node before it if the stretch between is ridable (a short gap you jump).
        if (prev >= 0) {
          let bad = 0;
          for (let k = prevI + 1; k < i; k++) if (!(b.pres[k] > 0.4 || b.cord[k] > 0.4)) bad++;
          if (bad * b.sp <= 30) { NEXT.a[prev] = id; NC.a[prev] = ((i - prevI) * b.sp) / speed; }
        }
        if (first < 0) first = id;
        prev = id; prevI = i;
      }
      // A loop closes on itself.
      if (b.closed && first >= 0 && prev !== first && SI.a[first] === 0 && prevI + st >= m) {
        NEXT.a[prev] = first; NC.a[prev] = ((m - prevI) * b.sp) / speed;
      }
    }
    this.n = X.n;
    this.x = X.a; this.y = Y.a; this.z = Z.a; this.ux = UX.a; this.uy = UY.a; this.uz = UZ.a;
    this.tx = TX.a; this.ty = TY.a; this.tz = TZ.a; this.w = W.a; this.spd = SPD.a;
    this.next = NEXT.a; this.ncost = NC.a; this.band = BI.a; this.si = SI.a; this.tag = TG.a;
    // Spatial hash.
    this.cells = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = this._key(Math.floor(this.x[i] / RT.CELL), Math.floor(this.z[i] / RT.CELL));
      let c = this.cells.get(key); if (!c) { c = []; this.cells.set(key, c); } c.push(i);
    }
    // Transfers: nodes of other bands alongside (within the wider channel, about level, going
    // the same way).
    const xs = [], xo = new Int32Array(this.n + 1);
    for (let i = 0; i < this.n; i++) {
      xo[i] = xs.length;
      const x = this.x[i], y = this.y[i], z = this.z[i], gx = Math.floor(x / RT.CELL), gz = Math.floor(z / RT.CELL);
      const best = new Map();   // band -> [node, d]
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
        const cell = this.cells.get(this._key(gx + a, gz + c)); if (!cell) continue;
        for (const j of cell) {
          if (this.band[j] === this.band[i]) continue;
          const dy = this.y[j] - y; if (dy > 6 || dy < -6) continue;
          const d = Math.hypot(this.x[j] - x, this.z[j] - z);
          if (d > Math.max(this.w[i], this.w[j]) * 0.9 + 4) continue;
          if (this.tx[i] * this.tx[j] + this.ty[i] * this.ty[j] + this.tz[i] * this.tz[j] < 0.5) continue;
          const bj = this.band[j], o = best.get(bj);
          if (!o || d < o[1]) best.set(bj, [j, d]);
        }
      }
      for (const [, o] of best) xs.push(o[0]);
    }
    xo[this.n] = xs.length;
    this.xs = Int32Array.from(xs); this.xo = xo;
  }

  _key(gx, gz) { return (gx + 32768) * 65536 + (gz + 32768); }

  // Nodes within r (horizontally) of (x, z).
  near(x, z, r, out = []) {
    out.length = 0;
    const g0 = Math.floor((x - r) / RT.CELL), g1 = Math.floor((x + r) / RT.CELL), h0 = Math.floor((z - r) / RT.CELL), h1 = Math.floor((z + r) / RT.CELL);
    for (let a = g0; a <= g1; a++) for (let c = h0; c <= h1; c++) {
      const cell = this.cells.get(this._key(a, c)); if (!cell) continue;
      for (const j of cell) if ((this.x[j] - x) ** 2 + (this.z[j] - z) ** 2 <= r * r) out.push(j);
    }
    return out;
  }

  // Where you could come down from (x, y, z), moving (vx, vz) with vertical speed vy: calls
  // fn(node, time) for each reachable node below.
  //   sky    off the board (press the board button): you fall through streams, steer with the
  //          stick, and call the board back just above the one you want
  //   board  already in the air on the board: carried by your speed, a little air steer
  drops(x, y, z, vx, vz, vy, mode, fn, skipBand = -1, skipSi = 0) {
    const P = this.P, sky = mode !== 'board';
    const vt = sky ? (P.skyTerminal || 40) : (P.terminalSpeed || 60), steer = Math.max(0, P.airSteer || 3);
    const vh = Math.hypot(vx, vz), hx = vh > 0.5 ? vx / vh : 1, hz = vh > 0.5 ? vz / vh : 0;
    const tMax = fallTime(RT.DH_MAX, vy, P, vt);
    let rMax;
    if (sky) { const R = skyReach(tMax, P); rMax = vh * R.carry + R.radius + 10; }
    else rMax = carry(tMax, vh) + 0.5 * steer * 36 + 20;
    rMax = Math.min(sky ? 260 : RT.REACH_MAX, rMax);
    const list = this.near(x, z, rMax, this._nearBuf || (this._nearBuf = []));
    for (const j of list) {
      const dh = y - this.y[j];
      if (dh < RT.DH_MIN || dh > RT.DH_MAX) continue;
      if (!this.landable(j)) continue;
      if (this.band[j] === skipBand && Math.abs(this.si[j] - skipSi) * 12 < 250) continue;
      const T = fallTime(dh, vy, P, vt), dx = this.x[j] - x, dz = this.z[j] - z;
      if (sky) {
        // (time to call the board before you get there)
        if (T < 1.2) continue;
        const R = skyReach(T, P), cx = vx * R.carry, cz = vz * R.carry;
        if (Math.hypot(dx - cx, dz - cz) > R.radius + 8) continue;
      } else {
        const f = dx * hx + dz * hz, l = Math.abs(dx * hz - dz * hx);
        if (f < -10 || f > carry(T, vh) + 10) continue;
        if (l > 12 + 0.5 * steer * T * T + 0.3 * Math.max(0, f)) continue;
        // (not landing against the flow)
        const th = Math.hypot(this.tx[j], this.tz[j]);
        if (th > 0.3 && (this.tx[j] * hx + this.tz[j] * hz) / th < -0.2) continue;
      }
      fn(j, T);
    }
  }

  // A good place to come down on: a floor facing up (not a wall, a pipe's roof, a twist), wide
  // enough, with stream ahead of it (not about to end in a tip).
  landable(j) {
    if (this.uy[j] < 0.75 || this.w[j] < 6) return false;
    if (this.tag[j] & (TAG.TIP | TAG.TWIST | TAG.SPIRAL | TAG.PIPE | TAG.BARREL | TAG.UP)) return false;
    const a = this.next[j], b = a >= 0 ? this.next[a] : -1;
    return b >= 0 && !(this.tag[a] & TAG.TIP) && !(this.tag[b] & TAG.TIP);
  }

  // Where you could fly to (boost in free fall) from a launch at (x, y, z): calls fn(node,
  // time) for nodes below within a flight and a fall, that bring you closer to (gx, gz).
  flights(x, y, z, gx, gz, fn, skipBand = -1) {
    if (!RT.FLY_ON) return;
    const P = this.P, V = RT.FLY_SPEED, sink = Math.max(1, P.fallSink || 6);
    const R = V * RT.FLY_TIME + 60;
    const dg0 = Math.hypot(gx - x, gz - z);
    const list = this.near(x, z, R, this._flyBuf || (this._flyBuf = []));
    for (const j of list) {
      if (this.band[j] === skipBand) continue;
      if (!this.landable(j)) continue;
      const dx = this.x[j] - x, dz = this.z[j] - z, D = Math.hypot(dx, dz);
      if (D < 60) continue;   // (a plain drop does that)
      const dh = y - this.y[j], tf = D / V, dhFly = sink * tf;
      if (dh < dhFly + RT.DH_MIN || dh > RT.DH_MAX) continue;
      if (Math.hypot(gx - this.x[j], gz - this.z[j]) > dg0 - 40) continue;
      const th = Math.hypot(this.tx[j], this.tz[j]);
      if (th > 0.3 && (this.tx[j] * dx + this.tz[j] * dz) / (th * D) < -0.2) continue;
      fn(j, tf + fallTime(dh - dhFly, -sink, P));
    }
  }

  // Can you come down onto island I from here? (time, landing point) or null. Off the board
  // (sky) you land on your feet; on the board in the air, you step off onto it.
  dropOnto(I, x, y, z, vx, vz, vy, mode, out) {
    const P = this.P, sky = mode !== 'board', dx0 = I.x - x, dz0 = I.z - z, d0 = Math.hypot(dx0, dz0);
    // Aim for the nearest point well inside the outline.
    const th = Math.atan2(z - I.z, x - I.x), rIn = I.outline(th) * 0.7;
    const k = d0 > rIn ? rIn / d0 : 1;
    const lx = x + dx0 * (1 - k), lz = z + dz0 * (1 - k);
    const g = I.ground(lx, lz); if (g === null) return null;
    const dh = y - g; if (dh < 4) return null;
    const vt = sky ? (P.skyTerminal || 40) : (P.terminalSpeed || 60);
    const T = fallTime(dh, vy, P, vt), steer = Math.max(0, P.airSteer || 3), dx = lx - x, dz = lz - z;
    const vh = Math.hypot(vx, vz), hx = vh > 0.5 ? vx / vh : 1, hz = vh > 0.5 ? vz / vh : 0;
    let fly = false;
    if (sky) { const R = skyReach(T, P); if (Math.hypot(dx - vx * R.carry, dz - vz * R.carry) > R.radius + 10) fly = true; }
    else {
      const f = dx * hx + dz * hz, l = Math.abs(dx * hz - dz * hx);
      if (f < -10 || f > carry(T, vh) + 10 || l > 15 + 0.5 * steer * T * T + 0.3 * Math.max(0, f)) fly = true;
    }
    out.fly = false;
    if (fly && !RT.FLY_ON) return null;
    if (fly) {
      // Flying there (on the board, boosting).
      const D = Math.hypot(dx, dz), sink = Math.max(1, P.fallSink || 6), tf = D / RT.FLY_SPEED;
      if (D > RT.FLY_SPEED * RT.FLY_TIME || dh < sink * tf + 4) return null;
      out.T = tf + fallTime(dh - sink * tf, -sink, P) + RT.FLY_PEN; out.fly = true;
    } else out.T = T;
    out.x = lx; out.z = lz; out.y = g;
    return out;
  }

  // Is node j on island I's ground? arriving: a dock that runs onto it and ends there (you step
  // off), else one rising out of it (you get on there).
  onIsland(j, I, arriving = true) {
    const g = I.ground(this.x[j], this.z[j]);
    if (g === null || !(this.y[j] - g < DOCK_LIFT + 3 && this.y[j] - g > -2)) return false;
    const t = this.tag[j], into = (t & TAG.TIP) !== 0 && (t & TAG.UP) === 0;
    return arriving ? into : !into;
  }

  // The fastest route from `from` to island `dest`.
  //   from: { x, y, z, vx, vy, vz, mode ('board' | 'foot'), state, island (standing on) }
  // Returns { ok, pts: Float32Array (x, y, z, ux, uy, uz, kind per point), steps, eta, why }.
  plan(from, dest, opts = {}) {
    const P = this.P, n = this.n;
    const g = new Float64Array(n + 1).fill(Infinity);
    const prev = new Int32Array(n + 1).fill(-2), how = new Uint8Array(n + 1), dropT = new Float32Array(n + 1);
    const GOAL = n;
    const H = new Heap();
    const vMax = 55;
    const h = (j) => Math.max(0, Math.hypot(this.x[j] - dest.x, this.z[j] - dest.z) - dest.R) / vMax;
    const seeds = [];   // [node, cost, kind, extra]
    let goalCost = Infinity, goalFrom = -2, goalHow = 0, goalLand = null;
    const land = {};
    const reach = (j, c, kind, src, T) => {
      if (c >= g[j]) return;
      g[j] = c; prev[j] = src; how[j] = kind; dropT[j] = T || 0;
      H.push(c + h(j), j);
    };
    const tryGoal = (c, src, kind, L) => { if (c < goalCost) { goalCost = c; goalFrom = src; goalHow = kind; goalLand = L ? { ...L } : null; } };

    // Seeds.
    const sx = from.x, sy = from.y, sz = from.z, vh = Math.hypot(from.vx, from.vz);
    const hx0 = vh > 1 ? from.vx / vh : 1, hz0 = vh > 1 ? from.vz / vh : 0;
    const START = -1;
    const virt = [];   // virtual starts (walk to a rim, a launch from the air): {x, y, z, cost, vx, vz, vy, mode}
    if (from.mode === 'foot' && from.state === 'walking' && from.island) {
      const S = from.island, run = Math.max(2, P.runSpeed || 12);
      if (from.island.id === dest.id) return { ok: true, pts: new Float32Array(0), steps: [], eta: 0, why: 'here' };
      // Walk to a dock on this island and ride it off ...
      for (const j of this.near(S.x, S.z, S.Rmax + 10)) {
        if (!this.onIsland(j, S, false)) continue;
        const c = Math.hypot(this.x[j] - sx, this.z[j] - sz) / run + 1;
        if (c < g[j]) { reach(j, c, RK.WALK, START, 0); }
      }
      // ... or run off the edge and fall (skydiving, then call the board).
      for (let k = 0; k < 16; k++) {
        const th = (k / 16) * Math.PI * 2, R = S.outline(th) * 1.02;
        const x = S.x + Math.cos(th) * R, z = S.z + Math.sin(th) * R, y = S.top(x, z);
        virt.push({ x, y, z, cost: Math.hypot(x - sx, z - sz) / run + 0.5, vx: Math.cos(th) * run, vz: Math.sin(th) * run, vy: 0, mode: 'sky' });
      }
    } else if (from.mode === 'board' && from.state === 'riding') {
      // The band you are on: nodes just ahead, about level with you (not a stream crossing
      // overhead), going your way.
      for (const j of this.near(sx, sz, 45)) {
        const dx = this.x[j] - sx, dy = this.y[j] - sy, dz = this.z[j] - sz;
        if (Math.abs(dy) > 8) continue;
        if (vh > 2 && (this.tx[j] * from.vx + this.tz[j] * from.vz) / vh < 0.3) continue;
        const ahead = vh > 2 ? (dx * from.vx + dz * from.vz) / vh : 1;
        if (ahead < -6) continue;
        reach(j, Math.hypot(dx, dy, dz) / 30, RK.RIDE, START, 0);
      }
      // And jumping off from where you are.
      virt.push({ x: sx, y: sy, z: sz, cost: 0, vx: from.vx, vz: from.vz, vy: (P.hopOff || 4), mode: 'sky' });
    } else {
      // In the air: on the board, or skydiving. On the board you can also jump off it (you
      // steer better off it) and call it back lower down.
      virt.push({ x: sx, y: sy, z: sz, cost: 0, vx: from.vx, vz: from.vz, vy: from.vy, mode: from.mode === 'foot' ? 'sky' : 'board' });
      if (from.mode !== 'foot') virt.push({ x: sx, y: sy, z: sz, cost: 0.8, vx: from.vx, vz: from.vz, vy: from.vy + (P.hopOff || 4), mode: 'sky', jump: true });
    }
    const vstart = [];   // per virtual start: index for path rebuilding
    for (let v = 0; v < virt.length; v++) {
      const s = virt[v];
      this.drops(s.x, s.y, s.z, s.vx, s.vz, s.vy, s.mode, (j, T) => reach(j, s.cost + T + RT.DROP_PEN * 0.6, RK.DROP, -10 - v, T));
      this.flights(s.x, s.y, s.z, dest.x, dest.z, (j, T) => reach(j, s.cost + T + RT.FLY_PEN, RK.FLY, -10 - v, T));
      const L = this.dropOnto(dest, s.x, s.y, s.z, s.vx, s.vz, s.vy, s.mode, land);
      if (L) tryGoal(s.cost + L.T + 1, -10 - v, RK.LAND, L);
      vstart.push(s);
    }

    // Search.
    let expanded = 0;
    const maxExpand = opts.maxExpand || 60000;
    // A route much slower than going straight there is not worth showing: past that, settle
    // for the closest approach found (the rest is planned again on the way, as the streams
    // near the island come into the snapshot).
    const D0 = Math.max(0, Math.hypot(dest.x - sx, dest.z - sz) - dest.R);
    const bound = opts.bound || 90 + (3 * D0) / 30;
    let bestJ = -1, bestScore = Infinity;
    while (H.size) {
      const j = H.pop();
      const cj = g[j];
      if (cj + h(j) >= goalCost || cj + h(j) > bound) break;
      if (++expanded > maxExpand) break;
      // (closest approach: across, and up to it, climbing being the hard part)
      const sc = h(j) * vMax + 3 * Math.max(0, dest.y - this.y[j] - 30) + cj * 3;
      if (sc < bestScore) { bestScore = sc; bestJ = j; }
      // Arrived: riding onto the island's ground.
      if (this.onIsland(j, dest)) { tryGoal(cj, j, RK.DOCK, null); continue; }
      // Ride on.
      const nx = this.next[j];
      if (nx >= 0) reach(nx, cj + this.ncost[j], RK.RIDE, j, 0);
      // Across to a band alongside.
      for (let k = this.xo[j]; k < this.xo[j + 1]; k++) reach(this.xs[k], cj + RT.XFER_COST, RK.XFER, j, 0);
      // Drop off (from a floor, not inside a pipe or barrel; and not straight after coming down
      // here: ride a little first).
      const landed = how[j] === RK.DROP || how[j] === RK.FLY;
      if (!landed && this.uy[j] > 0.5 && !(this.tag[j] & (TAG.PIPE | TAG.BARREL))) {
        const th = Math.hypot(this.tx[j], this.tz[j]) || 1, v = this.spd[j];
        const vx = (this.tx[j] / th) * v, vz = (this.tz[j] / th) * v, vy = (P.hopOff || 4) + Math.max(0, v * this.ty[j]);
        this.drops(this.x[j], this.y[j], this.z[j], vx, vz, vy, 'sky', (k, T) => reach(k, cj + T + RT.DROP_PEN, RK.DROP, j, T), this.band[j], this.si[j]);
        if (this.si[j] % (2 * RT.STRIDE) === 0) this.flights(this.x[j], this.y[j], this.z[j], dest.x, dest.z, (k, T) => reach(k, cj + T + RT.FLY_PEN, RK.FLY, j, T), this.band[j]);
        const L = this.dropOnto(dest, this.x[j], this.y[j], this.z[j], vx, vz, vy, 'sky', land);
        if (L) tryGoal(cj + L.T + 1, j, RK.LAND, L);
      }
    }
    let partial = false;
    if (!Number.isFinite(goalCost) || goalCost > bound) {
      if (bestJ < 0 || h(bestJ) * vMax > D0 - 150) return { ok: false, why: 'no route', expanded, pts: new Float32Array(0), steps: [], eta: 0 };
      partial = true; goalFrom = bestJ; goalHow = RK.TOWARD; goalLand = null; goalCost = g[bestJ];
    }

    // Back from the goal: the chain of nodes and how each was reached.
    const chain = [];
    let cur = goalFrom;
    while (cur >= 0) { chain.push(cur); cur = prev[cur]; }
    chain.reverse();
    const startV = cur <= -10 ? vstart[-10 - cur] : null;
    const out = this._emit(from, dest, chain, how, dropT, startV, goalHow, goalLand, goalCost, expanded);
    out.partial = partial;
    return out;
  }

  // The route as points and maneuvers.
  _emit(from, dest, chain, how, dropT, startV, goalHow, goalLand, eta, expanded) {
    const P = this.P, pts = [], steps = [];
    const push = (x, y, z, ux, uy, uz, k) => pts.push(x, y, z, ux, uy, uz, k);
    const np = () => pts.length / 7;
    const arc = (x0, y0, z0, x1, y1, z1, vy, T, kind, vTerm = 0) => {
      // A fall: ballistic in height (bent at the end so it lands exactly), straight across.
      const N = Math.max(4, Math.min(16, Math.round(T * 3)));
      const g = P.gravity * (P.fallGravity || 1.3), vt = Math.max(15, vTerm || P.terminalSpeed || 60), tTop = (vt + vy) / g;
      const Y = (t) => (t <= tTop ? vy * t - 0.5 * g * t * t : vy * tTop - 0.5 * g * tTop * tTop - vt * (t - tTop));
      const miss = y1 - (y0 + Y(T));
      for (let q = 1; q <= N; q++) {
        const u = q / N;
        push(x0 + (x1 - x0) * u, y0 + Y(u * T) + miss * u * u, z0 + (z1 - z0) * u, 0, 1, 0, kind);
      }
    };
    const flyArc = (x0, y0, z0, x1, y1, z1) => {
      // A flight: a shallow glide across, boost off early enough that your speed carries you
      // the rest of the way while you fall to the landing.
      const D = Math.hypot(x1 - x0, z1 - z0), sink = Math.max(1, P.fallSink || 6), V = RT.FLY_SPEED;
      let c = 0, yEnd = y0, Tr = 0;
      for (let it = 0; it < 3; it++) {
        const tf = Math.max(0, D - c) / V;
        yEnd = Math.max(y1 + 2, y0 - sink * tf);
        Tr = fallTime(Math.max(0, yEnd - y1), -sink, P);
        c = Math.min(D, carry(Tr, V));
      }
      const u1 = D > 1 ? Math.max(0, D - c) / D : 0, N = Math.max(3, Math.min(20, Math.round((D * u1) / 20)));
      for (let q = 1; q <= N; q++) { const u = (q / N) * u1; push(x0 + (x1 - x0) * u, y0 + (yEnd - y0) * (q / N), z0 + (z1 - z0) * u, 0, 1, 0, RK.FLY); }
      arc(x0 + (x1 - x0) * u1, yEnd, z0 + (z1 - z0) * u1, x1, y1, z1, -sink, Tr, RK.DROP);
    };
    const kindAt = (j) => {
      const t = this.tag[j];
      return t & TAG.DOCK ? RK.DOCK : t & TAG.UP ? RK.UP : t & TAG.CHUTE ? RK.CHUTE : RK.RIDE;
    };
    const sideOf = (a, j) => {
      const th = Math.hypot(this.tx[a], this.tz[a]) || 1;
      const cr = (this.tx[a] / th) * (this.z[j] - this.z[a]) - (this.tz[a] / th) * (this.x[j] - this.x[a]);
      return cr > 0 ? 1 : -1;   // +1: right (y up, x east, z south)
    };
    // Start: where you are.
    push(from.x, from.y, from.z, 0, 1, 0, RK.RIDE);
    if (startV) {
      if (from.mode === 'foot' && from.state === 'walking') {
        // Walk to the rim.
        const N = Math.max(2, Math.ceil(Math.hypot(startV.x - from.x, startV.z - from.z) / 15));
        for (let q = 1; q <= N; q++) { const u = q / N, x = from.x + (startV.x - from.x) * u, z = from.z + (startV.z - from.z) * u; const gy = from.island ? from.island.top(x, z) : from.y; push(x, gy, z, 0, 1, 0, RK.WALK); }
        steps.push({ i: 0, type: 'walk', text: 'Walk off the edge' });
        steps.push({ i: np() - 1, type: 'jump', text: 'Jump off, then call your board' });
      } else if (chain.length && how[chain[0]] === RK.DROP && from.mode === 'board' && (from.state === 'riding' || startV.jump)) {
        steps.push({ i: 0, type: 'drop', dh: Math.round(from.y - this.y[chain[0]]) });
      }
    }
    let lastBand = -1;
    for (let q = 0; q < chain.length; q++) {
      const j = chain[q], k = how[j];
      const a = q > 0 ? chain[q - 1] : -1;
      if (k === RK.RIDE && a >= 0 && this.band[a] === this.band[j]) {
        // Every band sample between the two nodes.
        const b = this.bands[this.band[j]];
        let i0 = this.si[a], i1 = this.si[j];
        if (i1 < i0) i1 += b.n - 1;   // (round a loop's seam)
        for (let i = i0 + 1; i <= i1; i++) { const ii = b.idx(i); push(b.x[ii], b.y[ii], b.z[ii], b.ux[ii], b.uy[ii], b.uz[ii], kindAt(j)); }
      } else if (k === RK.XFER) {
        const kk = kindAt(j);
        steps.push({ i: np() - 1, type: kk === RK.UP ? 'up' : kk === RK.CHUTE ? 'chute' : kk === RK.DOCK ? 'dock' : 'branch', side: a >= 0 ? sideOf(a, j) : 0 });
        push(this.x[j], this.y[j], this.z[j], this.ux[j], this.uy[j], this.uz[j], RK.XFER);
      } else if (k === RK.FLY) {
        const x0 = a >= 0 ? this.x[a] : (startV ? startV.x : from.x), y0 = a >= 0 ? this.y[a] : (startV ? startV.y : from.y), z0 = a >= 0 ? this.z[a] : (startV ? startV.z : from.z);
        steps.push({ i: np() - 1, type: 'fly', dh: Math.round(y0 - this.y[j]), d: Math.round(Math.hypot(this.x[j] - x0, this.z[j] - z0)) });
        flyArc(x0, y0, z0, this.x[j], this.y[j], this.z[j]);
      } else if (k === RK.DROP) {
        const x0 = a >= 0 ? this.x[a] : (startV ? startV.x : from.x), y0 = a >= 0 ? this.y[a] : (startV ? startV.y : from.y), z0 = a >= 0 ? this.z[a] : (startV ? startV.z : from.z);
        const vy = a >= 0 ? (P.hopOff || 4) : (startV ? startV.vy : 0);
        const vt = a >= 0 || !startV || startV.mode === 'sky' ? (P.skyTerminal || 40) : 0;
        if (a >= 0) steps.push({ i: np() - 1, type: 'drop', dh: Math.round(y0 - this.y[j]) });
        arc(x0, y0, z0, this.x[j], this.y[j], this.z[j], vy, dropT[j] || fallTime(y0 - this.y[j], vy, P, vt), RK.DROP, vt);
      } else {
        // First node reached on foot or by riding from the start.
        if (k === RK.WALK) {
          const N = Math.max(2, Math.ceil(Math.hypot(this.x[j] - from.x, this.z[j] - from.z) / 15));
          for (let q2 = 1; q2 <= N; q2++) { const u = q2 / N, x = from.x + (this.x[j] - from.x) * u, z = from.z + (this.z[j] - from.z) * u; const gy = from.island ? from.island.top(x, z) : from.y; push(x, gy, z, 0, 1, 0, RK.WALK); }
          steps.push({ i: 0, type: 'walk', text: 'Walk to the dock' });
          steps.push({ i: np() - 1, type: 'mount', text: 'Get on your board' });
        } else push(this.x[j], this.y[j], this.z[j], this.ux[j], this.uy[j], this.uz[j], kindAt(j));
      }
      // Entering a connector or a dock along a ride (no transfer step): say so.
      const kk = kindAt(j);
      if (this.band[j] !== lastBand && q > 0 && k !== RK.XFER && (kk === RK.UP || kk === RK.CHUTE)) steps.push({ i: np() - 1, type: kk === RK.UP ? 'up' : 'chute' });
      lastBand = this.band[j];
    }
    // The end: onto the island.
    const last = chain.length ? chain[chain.length - 1] : -1;
    if (goalHow === RK.LAND && goalLand) {
      const x0 = last >= 0 ? this.x[last] : startV.x, y0 = last >= 0 ? this.y[last] : startV.y, z0 = last >= 0 ? this.z[last] : startV.z;
      const vy = last >= 0 ? (P.hopOff || 4) : startV.vy;
      const vt = last >= 0 || startV.mode === 'sky' ? (P.skyTerminal || 40) : 0;
      steps.push({ i: np() - 1, type: goalLand.fly ? 'flyland' : 'land', dh: Math.round(y0 - goalLand.y), d: Math.round(Math.hypot(goalLand.x - x0, goalLand.z - z0)) });
      if (goalLand.fly) {
        const n0 = np();
        flyArc(x0, y0, z0, goalLand.x, goalLand.y, goalLand.z);
        for (let i = n0; i < np(); i++) if (pts[i * 7 + 6] === RK.DROP) pts[i * 7 + 6] = RK.LAND;
      } else arc(x0, y0, z0, goalLand.x, goalLand.y, goalLand.z, vy, goalLand.T, RK.LAND, vt);
    } else if (goalHow === RK.TOWARD) {
      // Not all the way yet: keep going that way (planned again as you go).
      steps.push({ i: np() - 1, type: 'toward', dy: Math.round(dest.y - (last >= 0 ? this.y[last] : from.y)) });
      const x0 = last >= 0 ? this.x[last] : from.x, y0 = last >= 0 ? this.y[last] : from.y, z0 = last >= 0 ? this.z[last] : from.z;
      const dx = dest.x - x0, dz = dest.z - z0, d = Math.hypot(dx, dz) || 1, L = Math.min(250, d);
      for (let q = 1; q <= 8; q++) push(x0 + (dx / d) * L * q / 8, y0, z0 + (dz / d) * L * q / 8, 0, 1, 0, RK.TOWARD);
    } else {
      steps.push({ i: np() - 1, type: 'arrive' });
      // (the end of the dock, onto the ground)
      const b = last >= 0 ? this.bands[this.band[last]] : null;
      if (b) for (let i = this.si[last] + 1; i < b.n; i++) { if (dest.ground(b.x[i], b.z[i]) === null) break; push(b.x[i], b.y[i], b.z[i], 0, 1, 0, RK.DOCK); }
    }
    return { ok: true, pts: Float32Array.from(pts), steps, eta, expanded, why: '' };
  }
}
