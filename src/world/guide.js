// Route guidance: keeps a planned route (trapar/route.js) to an island up to date as you ride,
// tracks how far along it you are, and says what to do next.
//
//   set(island)      start guiding to an island (null: stop)
//   update(dt, rider)
//   path             the route: pts (x, y, z, ux, uy, uz, kind per point), steps, cum (arc
//                    length to each point), partial (only part of the way so far)
//   cur              index of the point you are at; next: the next maneuver and how far
//
// A route is planned in the snapshot worker and arrives a moment later. It is planned again
// when you leave it, when a partial route runs short, now and then as the snapshot moves, and
// after a respawn.

import { RK } from '../trapar/route.js';

export const STEP_TEXT = {
  branch: (s) => `Take the branch on the ${s.side > 0 ? 'right' : 'left'}`,
  up: () => 'Ride the updraft up',
  chute: () => 'Take the chute down',
  dock: (s, D) => `Take the dock onto ${D}`,
  drop: (s) => `Jump off, drop ${s.dh} m, call your board`,
  fly: (s) => `Jump off, call your board, fly ${s.d} m (boost)`,
  land: (s, D) => `Jump off, drop ${s.dh} m onto ${D}`,
  flyland: (s, D) => `Jump off, call your board, fly ${s.d} m to ${D}`,
  walk: (s) => s.text || 'Walk',
  jump: () => 'Jump off the edge, then call your board',
  mount: () => 'Get on your board',
  toward: (s, D) => `Keep heading for ${D}${s.dy > 60 ? ` (${s.dy} m up: look for an updraft)` : s.dy < -60 ? ` (${-s.dy} m down)` : ''}`,
  arrive: (s, D) => `Ride the dock onto ${D}`,
};
export const STEP_ICON = { branch: '↱', up: '⇡', chute: '⇣', dock: '⇥', drop: '⤓', fly: '➚', land: '⤓', flyland: '➚', walk: '•', jump: '⤓', mount: '⇧', toward: '➜', arrive: '⚑' };

export class RouteGuide {
  constructor(braids) {
    this.braids = braids;
    this.dest = null; this.path = null;
    this.cur = 0; this.off = 0; this.s = 0;
    this.pending = false; this.reqT = 0; this.offT = 0; this.age = 0;
    this.next = null; this.version = 0; this._snap = -1; this._seq = 0;
    this.stats = { plans: 0, replans: 0, lastMs: 0 };
  }

  set(island) {
    this.dest = island; this.path = null; this.cur = 0; this.next = null; this.version++;
    this.pending = false; this.reqT = 0; this._seq++;
  }

  // Plan again soon (after a respawn, say).
  invalidate() { this.reqT = Math.min(this.reqT, 0); this._force = true; }

  _from(r) {
    const I = r.footIsland;
    return { x: r.pos.x, y: r.pos.y, z: r.pos.z, vx: r.vel.x, vy: r.vel.y, vz: r.vel.z, mode: r.mode, state: r.state, islandId: I ? I.id : null, ix: I ? I.x : 0, iz: I ? I.z : 0 };
  }

  _request(r, why) {
    if (!this.dest || this.pending) return;
    this.pending = true; this.reqT = 1.5; this._force = false;
    const seq = this._seq, snap = this.braids.version;
    this.stats.plans++; if (why !== 'first') this.stats.replans++;
    this.braids.requestRoute(this._from(r), { id: this.dest.id, x: this.dest.x, z: this.dest.z }, (res) => {
      this.pending = false;
      if (seq !== this._seq) return;   // (guiding somewhere else by now)
      this.stats.lastMs = (res.graphMs || 0) + (res.planMs || 0);
      if (!res.ok || !res.pts || res.pts.length < 14) { this.failed = res.why || 'no route'; if (!this.path) this.next = null; return; }
      this.failed = null;
      const pts = res.pts, n = pts.length / 7, cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 7] - pts[i * 7 - 7], pts[i * 7 + 1] - pts[i * 7 - 6], pts[i * 7 + 2] - pts[i * 7 - 5]);
      this.path = { pts, n, cum, steps: res.steps, partial: !!res.partial, eta: res.eta, snap };
      this.cur = 0; this.age = 0; this.offT = 0; this.version++;
    });
  }

  update(dt, r) {
    if (!this.dest) return;
    this.reqT -= dt; this.age += dt;
    const p = this.path;
    if (!p) { if (!this.pending && this.reqT <= 0) this._request(r, 'first'); return; }
    // Where along it you are: the nearest point a little behind to well ahead.
    const pts = p.pts, x = r.pos.x, y = r.pos.y, z = r.pos.z;
    let best = Infinity, bi = this.cur;
    const i0 = Math.max(0, this.cur - 6), i1 = Math.min(p.n - 1, this.cur + 160);
    for (let i = i0; i <= i1; i++) {
      const d = (pts[i * 7] - x) ** 2 + ((pts[i * 7 + 1] - y) * 0.7) ** 2 + (pts[i * 7 + 2] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    this.cur = bi; this.off = Math.sqrt(best); this.s = p.cum[bi];
    // (exactly where along it: onto the piece from this point to the next)
    if (bi < p.n - 1) {
      const a = bi * 7, b = a + 7, ex = pts[b] - pts[a], ey = pts[b + 1] - pts[a + 1], ez = pts[b + 2] - pts[a + 2], ee = ex * ex + ey * ey + ez * ez;
      if (ee > 1e-6) this.s += Math.max(0, Math.min(1, ((x - pts[a]) * ex + (y - pts[a + 1]) * ey + (z - pts[a + 2]) * ez) / ee)) * Math.sqrt(ee);
    }
    // The next maneuver.
    let nx = null;
    for (const st of p.steps) if (st.i >= bi - 1 && (st.i > bi - 1 || st.type === 'drop' || st.type === 'fly')) { nx = st; break; }
    if (nx) {
      const D = this.dest.name;
      this.next = { ...nx, dist: Math.max(0, p.cum[Math.min(p.n - 1, nx.i)] - this.s), text: (STEP_TEXT[nx.type] || (() => nx.type))(nx, D), icon: STEP_ICON[nx.type] || '•' };
    } else this.next = null;
    // Off the route?
    const air = r.state !== 'riding' && !(r.mode === 'foot' && r.state === 'walking');
    const kind = pts[bi * 7 + 6];
    const tol = air || kind === RK.DROP || kind === RK.FLY || kind === RK.LAND ? 90 : r.mode === 'foot' ? 40 : 35;
    this.offT = this.off > tol ? this.offT + dt : 0;
    let why = null;
    if (this.offT > 1.0) why = 'off';
    else if (p.partial && p.cum[p.n - 1] - this.s < 500) why = 'short';
    else if (this.age > 12 && !air) why = 'fresh';
    else if (p.partial && this.braids.version !== p.snap && this.age > 3) why = 'snapshot';
    else if (this._force) why = 'forced';
    if (why && !this.pending && this.reqT <= 0) this._request(r, why);
  }
}
