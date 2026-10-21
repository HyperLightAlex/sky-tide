// Rider physics: a board riding the trapar network, through weather.
//
// Riding is locked to the surface. While you ride, the board stays on the stream's skin (the
// surface where trapar density crosses the ride threshold) and your velocity is turned along
// it, so meeting a wall carries you up it at any speed. You only leave the surface for a
// reason:
//   pop       you jump (A)
//   crest     the surface curves away faster than gravity and your hold can follow (lips,
//             rims, the edge of a stream); you launch off it along your travel
//   edge      the stream ends or you slide off its side
//   face      you reach a face you may not ride (see outsideReach)
//   hold      on overhangs and undersides gravity peels you off unless your hold covers it
// Hold comes from riding with a stream's flow fast enough; bracing (RT) adds a lot more, plus
// a steady press onto the surface. Unbraced you can ride walls and steep sides; braced and
// fast you can ride upside down, through corkscrews and all the way round a cord.
//
// Faces: a channel's inside (floor, walls, the inside of a barrel) is always ridable. Its
// outside, and a cord's surface, are ridable within outsideReach degrees of the stream's top
// (180 = all the way round, 0 = never).
//
// Steering is surf style: the stick swings the nose around the tail and the fins pull your
// travel after it (draw). Hold LT to snap (fast nose, big slide, speed cost). Slow boards pivot,
// fast boards rail. A board landing tail-first swings back around (a revert).
// Streams carry you: riding with the flow pushes you up to a cruising speed.
//
// In the air: gravity is stronger on the way down (snappy airs). Brace turns the board's bottom
// toward where you will land (no pull), tricks spin and flip on top of that, and over a wall's
// lip a lip lock brings you back down onto the wall.
// Boost depends on where you are. On a stream it pushes you along the stream (not along your
// heading, so it never drives you up a wall), lines your travel up with the stream and holds you
// on harder. In a short air it adds speed in the direction you are already flying, level. In
// free fall (falling with nothing close below, until you land) it flies you: level thrust along
// the board's nose, lift that slows the fall to a glide (never a climb), the flight following
// the nose as you lean it round (see _fallBoost).
//
// Only the bottom of the board catches. Landing upside down, on a face you may not ride, or
// a wipeout, passes through: you come out the other side, in the air.
//
// States: riding (on the skin), drifting (in the air inside or at the edge of a stream),
// freefall (clear air); in the air, falling is set while in free fall and flying while boosting
// in it.

import { V3, rotateAround, clamp, damp, smoothstep } from '../math/v3.js';
import { TAG } from '../trapar/network.js';
import { BR } from '../trapar/braids.js';
import { islandUnder } from '../world/islands.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const WORLD_UP = new V3(0, 1, 0);
const CORD = 3;

// Reach scan pattern: straight down/up plus rings of columns around the rider.
const SCAN_COLUMNS = [[0, 0]];
for (const d of [160, 360, 640]) for (let k = 0; k < 8; k++) SCAN_COLUMNS.push([d, (k / 8) * Math.PI * 2 + (d === 360 ? Math.PI / 8 : 0)]);

export class Rider {
  constructor(world, params) {
    this.world = world;
    this.sky = world.trapar;      // the ridable medium
    this.weather = world.weather; // wind and turbulence for the air
    this.P = params;
    this.pos = new V3();
    this.vel = new V3();
    this.fwd = new V3(0, 0, -1);
    this.up = new V3(0, 1, 0);
    this.right = new V3(1, 0, 0);
    this.normal = new V3(0, 1, 0);
    this.state = 'freefall';
    this.airT = 0; this.rideT = 0; this.wipeT = 0; this.sketchT = 0;
    this.throughT = 0; this.throughIn = false;   // passing through trapar (failed catch, wrong face)
    this.catchBlock = 0;                         // just left a surface: no catch for a moment
    this.crouchT = 0; this.setting = false;
    this.hold = 0; this.holdMargin = 0; this.holdNeed = 0; this.holdScale = 1; this.onStream = false;
    this.slip = 0; this.popUsed = false; this.face = 'inside'; this.faceAngle = 0;
    this.brace = 0; this.attachT = 0; this.popT = 0;
    this.lipOut = null; this._lipOut = new V3(); this._lipFlow = new V3();
    this.baseUp = new V3(0, 1, 0); this.baseFwd = new V3(0, 0, -1); this._baseValid = false;
    this.trickYaw = 0; this.trickFlip = 0; this.airSpinTotal = 0; this.airFlipTotal = 0; this.braceLock = null;
    this.thr = params.rideThreshold;
    this.predict = null; this._predT = 0;
    this.gauge = params.boostStart; this.boosting = false; this.burstT = 0;
    this.falling = false; this.fallT = 0; this.flying = false;   // free fall; boosting in it (flight)
    this._hx = 0; this._hz = -1;
    // On foot: mode 'foot' (states walking / skydiving) or on the board ('board').
    this.mode = 'board'; this.facing = new V3(0, 0, -1); this.camFwd = null;
    this.footStun = 0; this.summonT = 0; this.diving = false; this.footIsland = null; this.sprint = false; this.jumped = false;
    this._isl = null; this._islT = 0; this._heldPrev = false; this.lastSafeFoot = false;
    this.rollT = 0; this.footMark = null;
    this.boostAim = new V3(0, 1, 0);
    this.boostTarget = null; this.reachNone = false;
    this._scan = SCAN_COLUMNS.map(() => ({ skins: [], x: 0, z: 0 })); this._scanI = 0; this._scanTick = 0;
    this.lastSafe = new V3(); this._safeT = 0;
    this.fallen = false;
    this.events = [];
    this.stats = { maxSpeed: 0, clean: 0, sketchy: 0, wipeouts: 0, longestAir: 0 };
    this.vis = { crouch: 0, lean: 0, contact: 0, speed: 0, boost: 0, snap: 0, spray: 0, slip: 0, tail: 0, brace: 0, foot: 0, walk: 0, sky: 0, dive: 0 };
    this.dbg = { rho: 0, thr: 1, e: 0, layer: 'none', feature: 'none', support: new V3(), flow: new V3(), wind: new V3(), speedRel: 0, turb: 0, swell: 0, chaos: 0, cloud: 0, kappa: 0 };
    this._tb = new V3();
    this.F = {}; this.F2 = {};
    // scratch
    this._g = new V3(); this._n = new V3(); this._vr = new V3(); this._vt = new V3(); this._a = new V3();
    this._t1 = new V3(); this._t2 = new V3(); this._ax = new V3(); this._dir = new V3();
    this._pp = new V3(); this._pv = new V3(); this._pq = new V3();
    this._q = { p: new V3(), n: new V3(), ok: false, rho: 0 };
    this._qa = { p: new V3(), n: new V3(), ok: false, rho: 0 };
  }

  // The ride threshold is fixed (streams are solid; nothing is skimmable).
  rideThresholdAt() { return this.P.rideThreshold; }
  speed() { return this.vel.len(); }
  // Gravity, stronger falling, fading out toward the top falling speed (long falls level off).
  gravityAt(vy) {
    const P = this.P;
    if (vy >= 0) return P.gravity;
    const f = Math.min(1, -vy / Math.max(5, P.terminalSpeed));
    return P.gravity * P.fallGravity * (1 - f * f * f * f);
  }

  // --- surface ---------------------------------------------------------------------------

  // Project a point onto the ridable skin near it (Newton steps along the density gradient).
  // out: p (point), n (outward normal), ok.
  // Project a point onto the ridable skin near it. Searches along a guess normal (nx, ny, nz),
  // or the density gradient if none is given, for where the density crosses the threshold
  // (nearest crossing within maxDist, in the direction the skin must be), then refines along
  // the true normal there. out: p (point), n (outward normal), ok.
  _project(x, y, z, out, maxDist = 3, nx = 0, ny = 0, nz = 0) {
    const sky = this.sky, thr = this.P.rideThreshold, g = this._g;
    out.ok = false;
    let dx = nx, dy = ny, dz = nz;
    if (dx === 0 && dy === 0 && dz === 0) {
      sky.gradient(x, y, z, 0.6, g);
      const gl = g.len();
      if (gl < 1e-4) return out;
      dx = -g.x / gl; dy = -g.y / gl; dz = -g.z / gl;
    }
    const t = this._cross(x, y, z, dx, dy, dz, maxDist);
    if (t === null) return out;
    let qx = x + dx * t, qy = y + dy * t, qz = z + dz * t;
    sky.gradient(qx, qy, qz, 0.5, g);
    let gl = g.len();
    if (gl < 1e-4) return out;
    let mx = -g.x / gl, my = -g.y / gl, mz = -g.z / gl;
    // Refine along the true normal.
    const t2 = this._cross(qx, qy, qz, mx, my, mz, 1);
    if (t2 !== null) {
      qx += mx * t2; qy += my * t2; qz += mz * t2;
      sky.gradient(qx, qy, qz, 0.5, g);
      gl = g.len();
      if (gl > 1e-4) { mx = -g.x / gl; my = -g.y / gl; mz = -g.z / gl; }
    }
    out.p.set(qx, qy, qz);
    out.n.set(mx, my, mz);
    out.rho = thr; out.ok = true;
    return out;
  }

  // Distance t along (dx, dy, dz) from (x, y, z) to the skin: searching outward if inside,
  // inward if outside, at most maxDist. null if there is none.
  _cross(x, y, z, dx, dy, dz, maxDist) {
    const sky = this.sky, thr = this.P.rideThreshold;
    const f0 = sky.density(x, y, z) - thr;
    if (f0 === 0) return 0;
    const dir = f0 > 0 ? 1 : -1;
    const step = 0.25;
    let a = 0, fa = f0, b = null;
    for (let t = step; t <= maxDist + 1e-9; t += step) {
      const ft = sky.density(x + dx * dir * t, y + dy * dir * t, z + dz * dir * t) - thr;
      if ((ft > 0) !== (fa > 0)) { b = t; break; }
      a = t; fa = ft;
    }
    if (b === null) return null;
    let lo = a, hi = b;
    for (let k = 0; k < 10; k++) {
      const m = (lo + hi) / 2;
      const fm = sky.density(x + dx * dir * m, y + dy * dir * m, z + dz * dir * m) - thr;
      if ((fm > 0) === (f0 > 0)) lo = m; else hi = m;
    }
    return dir * (lo + hi) / 2;
  }

  // Where the straight move from a to b first enters trapar, projected onto the skin there.
  _impact(ax, ay, az, bx, by, bz, out) {
    const sky = this.sky, thr = this.P.rideThreshold;
    out.ok = false;
    if (sky.density(ax, ay, az) >= thr) return out;
    let lo = 0, hi = 1;
    for (let k = 0; k < 12; k++) {
      const m = (lo + hi) / 2;
      if (sky.density(ax + (bx - ax) * m, ay + (by - ay) * m, az + (bz - az) * m) >= thr) hi = m; else lo = m;
    }
    return this._project(ax + (bx - ax) * hi, ay + (by - ay) * hi, az + (bz - az) * hi, out, 1);
  }

  // Which face a surface point is, and whether you may ride it. F: sample just inside it.
  _faceRule(F, n) {
    const P = this.P;
    let outside = F.cls === CORD;
    if (!outside) outside = n.x * F.face.x + n.y * F.face.y + n.z * F.face.z < -0.2;
    const bu = F.bandUp;
    const ang = Math.acos(clamp(n.x * bu.x + n.y * bu.y + n.z * bu.z, -1, 1)) / DEG;
    this.face = outside ? 'outside' : 'inside';
    this.faceAngle = outside ? ang : 0;
    return !outside || ang <= P.outsideReach + 0.5;
  }

  // Place the rider on a trunk's floor near (x, z), closest to altitude preferY.
  respawn(x, z, preferY = 700) {
    const P = this.P, sky = this.sky;
    sky.braids.syncNext = true;                   // build it now if the network changed
    this.world.update(this.world.t, { x, z });   // build the network around (x, z)
    const br = sky.braids, seg = br.seg, FPS = BR.FPS;   // floats per segment (see braids.js)
    let best = null;
    for (let s = 0; s < br.nSeg; s++) {
      const o = s * FPS;
      if (Math.floor(seg[o + 3] / 1000) !== 1) continue;       // trunks only
      if (seg[o + 27] !== 0 || seg[o + 16] < 0.99 || seg[o + 17] < 0.99) continue;   // plain stretches
      if (seg[o + 9] < 0.97 || seg[o + 13] < 0.97) continue;   // level floors
      const mx = (seg[o] + seg[o + 4]) / 2, my = (seg[o + 1] + seg[o + 5]) / 2, mz = (seg[o + 2] + seg[o + 6]) / 2;
      if (my < P.floorAltitude + 60) continue;
      // Near (x, z), on the layer at about preferY (layers are hundreds of meters apart).
      const score = Math.hypot(mx - x, mz - z) + Math.abs(my - preferY) * 4;
      if (!best || score < best.score) best = { o, score, x: mx, y: my, z: mz };
    }
    let ok = false;
    if (best) {
      const o = best.o;
      // (from above the axis: the water may have the surface a little higher or lower)
      const q = this._project(best.x + seg[o + 8] * 3, best.y + seg[o + 9] * 3, best.z + seg[o + 10] * 3, this._q, 8, seg[o + 8], seg[o + 9], seg[o + 10]);
      if (q.ok && q.n.y > 0.9) {
        this.pos.copy(q.p); this.normal.copy(q.n); this.up.copy(q.n);
        const F = sky.sample(q.p.x - q.n.x * 0.4, q.p.y - q.n.y * 0.4, q.p.z - q.n.z * 0.4, this.F);
        const fd = this._t1.set(F.flowDir.x, F.flowDir.y, F.flowDir.z).projectOnPlane(q.n);
        if (fd.len() < 0.3) fd.set(1, 0, 0).projectOnPlane(q.n);
        fd.normalize();
        this.fwd.copy(fd); this.right.crossVectors(this.fwd, this.up);
        this.vel.copy(fd).scale(P.cruiseSpeed * 0.6);
        this._fillDbg(F, 0);
        ok = true;
      }
    }
    if (!ok) { this.pos.set(x, preferY, z); this.vel.set(0, 0, 0); this.up.copy(WORLD_UP); this.normal.copy(WORLD_UP); this.fwd.set(0, 0, -1); this.right.crossVectors(this.fwd, this.up); }
    this.state = ok ? 'riding' : 'freefall';
    this.airT = 0; this.rideT = 0; this.wipeT = 0; this.sketchT = 0; this.crouchT = 0;
    this.throughT = 0; this.throughIn = false; this.catchBlock = 0;
    this.hold = 0; this.holdMargin = 0; this.holdNeed = 0; this.slip = 0; this.popUsed = false;
    this.attachT = 0; this.popT = 0; this.lipOut = null; this._baseValid = false; this.braceLock = null;
    this.trickYaw = 0; this.trickFlip = 0; this.airSpinTotal = 0; this.airFlipTotal = 0;
    this.predict = null; this.thr = P.rideThreshold;
    this.gauge = Math.max(this.gauge, P.boostStart); this.boosting = false; this.burstT = 0;
    this.falling = false; this.fallT = 0; this.flying = false;
    this.mode = 'board'; this.footStun = 0; this.summonT = 0; this.diving = false; this.footIsland = null; this._islT = 0;
    this.rollT = 0; this.footMark = null;
    this.boostTarget = null; this.reachNone = false;
    for (const c of this._scan) c.skins.length = 0;
    this.fallen = false;
    this.lastSafe.copy(this.pos);
    this.events.push({ type: 'spawn' });
    return ok;
  }

  // --- step ------------------------------------------------------------------------------

  step(dt, inp) {
    const P = this.P;
    if (this.wipeT > 0) this.wipeT = Math.max(0, this.wipeT - dt);
    if (this.sketchT > 0) this.sketchT = Math.max(0, this.sketchT - dt);
    if (this.popT > 0) this.popT -= dt;
    if (this.catchBlock > 0) this.catchBlock -= dt;
    const ctrl = this.wipeT > 0 ? 0 : 1;
    const c = {
      ctrl,
      lean: inp.lean * ctrl, trim: inp.trim * ctrl,
      snap: (inp.snap || 0) * ctrl,
      brace: (inp.brace ?? inp.dig ?? 0) * ctrl,
      held: !!inp.crouch && ctrl > 0,
    };
    c.tuck = Math.max(0, -c.trim); c.brake = Math.max(0, c.trim);
    c.press = c.held && !this._heldPrev; this._heldPrev = c.held;
    this.brace = c.brace;
    this._nearIslands(dt);

    // The board button: jump off the board (riding or in the air), or on foot call it back
    // (in the air) or step onto the stream you are standing on.
    const boardPress = !!inp.boardPressed && ctrl > 0;
    if (this.mode === 'foot') {
      this.boosting = false; this.sprint = !!inp.boost;
      this._footStep(dt, c, boardPress);
      this._after(dt, c);
      return;
    }
    if (boardPress) { this._dismount(); this._after(dt, c); return; }

    // Boost gauge. A tap is a short burst.
    if (inp.boostPressed && ctrl > 0) this.burstT = 0.25;
    const want = ctrl > 0 && (inp.boost || this.burstT > 0);
    if (this.burstT > 0) this.burstT -= dt;
    this.boosting = want && (P.boostInfinite || this.gauge > 0.001);
    // (flying in free fall uses the gauge more slowly)
    const drain = this.falling && this.state !== 'riding' ? P.fallDrain : 1;
    if (this.boosting && !P.boostInfinite) this.gauge = Math.max(0, this.gauge - (dt * drain) / Math.max(0.1, P.boostCapacity));

    if (this.state === 'riding') this._rideStep(dt, c, inp);
    else this._airStep(dt, c, inp);
    if (this.mode === 'foot') { this._after(dt, c); return; }   // (stepped off onto an island)

    // Crouch timing (pop is handled in the ride step; late pop in the air step).
    if (c.held && this.state === 'riding') this.crouchT += dt;
    if (!c.held && !inp.crouchReleased) this.crouchT = 0;

    // Where you will land (marker, brace lock).
    if (this.state !== 'riding') {
      this._predT -= dt;
      if (this._predT <= 0) { this._predict(); this._predT = 0.05; }
    } else this.predict = null;

    // Free fall: falling with nothing close below (no landing within fallClear seconds). It
    // lasts until you land, and changes what boost does: in free fall it flies you where the
    // nose points (see _fallBoost); otherwise it pushes you on the way you are going.
    if (this.state === 'riding') { this.falling = false; this.fallT = 0; this.flying = false; }
    else {
      if (!this.falling && this.airT >= P.fallAfter) {
        const pr = this.predict, soon = pr && pr.hit && pr.ridable && pr.t < P.fallClear;
        if (!soon && (this.vel.y < -P.fallSpeed || !(pr && pr.hit))) {
          this.falling = true; this.fallT = 0; this.events.push({ type: 'freefall' });
        }
      }
      if (this.falling) this.fallT += dt;
    }

    // Where boosting could take you (one scan column every other step).
    if (P.reachScan) {
      if ((this._scanTick = (this._scanTick + 1) % 2) === 0) this._scanColumn();
    } else { this.boostTarget = null; this.reachNone = false; }

    this._after(dt, c);
  }

  // Bookkeeping after a step (both on the board and on foot).
  _after(dt, c) {
    const P = this.P, p = this.pos, v = this.vel;
    const sp = v.len();
    if (sp > this.stats.maxSpeed && this.mode === 'board') this.stats.maxSpeed = sp;
    if (this.mode === 'board' && this.state === 'riding' && this.wipeT === 0 && this.rideT > 1 && this.normal.y > 0.8) {
      this._safeT -= dt;
      if (this._safeT <= 0) { this.lastSafe.copy(p); this.lastSafeFoot = false; this._safeT = 1; }
    } else if (this.mode === 'foot' && this.state === 'walking' && this.footStun <= 0) {
      this._safeT -= dt;
      if (this._safeT <= 0) { this.lastSafe.copy(p); this.lastSafeFoot = true; this._safeT = 1; }
    }
    if (!this.fallen && p.y < P.floorAltitude) { this.fallen = true; this.events.push({ type: 'fell' }); }
    if (!p.isFinite() || !v.isFinite()) { this.respawn(this.lastSafe.x, this.lastSafe.z, this.lastSafe.y); return; }

    const vis = this.vis, kd = damp(10, dt);
    const riding = this.mode === 'board' && this.state === 'riding';
    vis.crouch += ((c.held && this.mode === 'board' ? 1 : 0) - vis.crouch) * kd;
    vis.lean += (c.lean - vis.lean) * kd;
    vis.contact += ((riding ? 1 : 0) - vis.contact) * damp(8, dt);
    vis.boost += ((this.boosting ? 1 : 0) - vis.boost) * damp(12, dt);
    vis.snap += ((riding ? c.snap : 0) - vis.snap) * kd;
    vis.tail += ((riding ? Math.max(c.brake, c.snap) : 0) - vis.tail) * kd;
    vis.slip = this.slip;
    vis.brace += (c.brace - (vis.brace || 0)) * kd;
    const vtm = this.dbg.speedRel;
    vis.spray = riding ? clamp((vtm / 30) * Math.sin(Math.min(this.slip, 1.4)) * 2.5 + c.snap * 0.5 * clamp(vtm / 15, 0, 1)
      + Math.min(1, this.dbg.rapids || 0) * 0.8 * clamp(vtm / 25, 0, 1), 0, 1.5) : 0;
    vis.speed = sp;
    // On foot: walking speed, and how far into a dive (skydiving with A held).
    const foot = this.mode === 'foot';
    vis.foot = foot ? 1 : 0;
    vis.walk = foot && this.state === 'walking' ? Math.hypot(v.x, v.z) : 0;
    const sky0 = Number.isFinite(vis.sky) ? vis.sky : 0, dive0 = Number.isFinite(vis.dive) ? vis.dive : 0;
    vis.sky = sky0 + ((foot && this.state === 'skydiving' && this.airT > 0.35 ? 1 : 0) - sky0) * damp(6, dt);
    vis.dive = dive0 + ((foot && this.diving ? 1 : 0) - dive0) * damp(5, dt);
    const d = this.dbg;
    if (this.state !== 'freefall') this.weather.windAt(p.y, this.world.t, d.wind);
    d.cloud = this.weather.cloud(p.x, p.y, p.z, false);
  }

  // --- islands and going on foot -------------------------------------------------------------

  // Islands near the rider (refreshed a few times a second).
  _nearIslands(dt) {
    this._islT -= dt;
    if (this._islT > 0 && this._isl) return this._isl;
    this._islT = 0.25;
    const p = this.pos, r = 900;
    this._isl = this.sky.islandsIn ? this.sky.islandsIn(p.x - r, p.x + r, p.z - r, p.z + r) : [];
    return this._isl;
  }

  // Does the move from a to b run into an island? { island, top (landed on its ground), y }.
  _islandHit(ax, ay, az, bx, by, bz) {
    for (const I of this._isl || []) {
      if (!I.near(bx, by, bz, 2) || !I.inside(bx, by, bz)) continue;
      const g = I.ground(bx, bz);
      // From above (or only just under the ground): onto its ground.
      const ga = I.ground(ax, az);
      const top = g !== null && (ay >= (ga !== null ? ga : g) - 0.3 || g - by < 1.2);
      return { island: I, top, y: g };
    }
    return null;
  }

  // Ran into an island's side or underside (not its ground): stopped against it. The part of
  // the velocity into it is lost (a hard hit on the board is a wipeout).
  _islandBump(I, ax, ay, az) {
    const P = this.P, v = this.vel, p = this.pos;
    const under = ay < I.bottom(ax, az) + 0.5;
    let into;
    if (under) { into = Math.max(0, v.y); v.y = Math.min(0, v.y) - 1; }
    else {
      let ox = ax - I.x, oz = az - I.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      const vin = -(v.x * ox + v.z * oz);
      into = Math.max(0, vin);
      if (vin > 0) { v.x += ox * vin; v.z += oz * vin; }
      v.x += ox * 0.5; v.z += oz * 0.5;
    }
    p.set(ax, ay, az);
    if (this.mode === 'board' && into > 20 && this.wipeT === 0) {
      this.wipeT = P.wipeoutTime; this.sketchT = 0.8; this.stats.wipeouts++;
      this.events.push({ type: 'wipeout', reason: 'island', slam: true, into, gain: 0, air: this.airT, quality: 0 });
    } else if (into > 4) this.events.push({ type: 'bonk', into });
  }

  // Jump off the board: you keep its speed (plus a little hop) and fall as yourself; the board
  // is gone until you call it.
  _dismount() {
    const P = this.P, n = this.state === 'riding' ? this.normal : WORLD_UP;
    this.vel.addScaled(n, P.hopOff);
    this.mode = 'foot'; this.state = 'skydiving'; this.airT = 0;
    const hx = this.fwd.x, hz = this.fwd.z, hl = Math.hypot(hx, hz);
    if (hl > 0.2) this.facing.set(hx / hl, 0, hz / hl);
    this.falling = false; this.fallT = 0; this.flying = false; this.boosting = false;
    this.predict = null; this.boostTarget = null; this.reachNone = false; this.braceLock = null;
    this.summonT = 0; this.throughT = 0; this.diving = false; this.footStun = 0;
    this.events.push({ type: 'dismount' });
  }

  // On foot: walking on an island, or in the air as yourself (skydiving). The stick moves you
  // relative to the camera.
  _footStep(dt, c, boardPress) {
    const P = this.P;
    let fx = this.camFwd ? this.camFwd.x : this.facing.x, fz = this.camFwd ? this.camFwd.z : this.facing.z;
    let fl = Math.hypot(fx, fz);
    if (fl < 1e-3) { fx = this.facing.x; fz = this.facing.z; fl = Math.hypot(fx, fz) || 1; }
    fx /= fl; fz /= fl;
    const mx = -fz * c.lean + fx * -c.trim, mz = fx * c.lean + fz * -c.trim;
    const m = Math.min(1, Math.hypot(mx, mz)), dx = m > 0.02 ? mx / Math.hypot(mx, mz) : 0, dz = m > 0.02 ? mz / Math.hypot(mx, mz) : 0;
    if (this.footStun > 0) this.footStun -= dt;
    if (this.rollT > 0) this.rollT = Math.max(0, this.rollT - dt);
    const ctl = this.footStun > 0 ? 0 : 1;
    if (boardPress) {
      if (this.state === 'walking') this._mountGround();
      else if (this.summonT <= 0) { this.summonT = P.summonTime; this.events.push({ type: 'summon' }); }
      if (this.mode !== 'foot') return;
    }
    if (this.summonT > 0) {
      if (this.state === 'walking') this.summonT = 0;
      else { this.summonT -= dt; if (this.summonT <= 0) { this._mountAir(); return; } }
    }
    if (this.state === 'walking') this._walk(dt, c, dx, dz, m * ctl);
    else this._skydive(dt, c, dx, dz, m * ctl);
    // Skydiving: the island ground straight below you, if any (a marker).
    const below = this.state === 'skydiving' ? islandUnder(this._isl, this.pos.x, this.pos.y, this.pos.z) : null;
    if (below) {
      const fm = this.footMark || (this.footMark = { hit: true, ground: true, point: new V3(), normal: new V3(0, 1, 0), quality: { type: 'clean' } });
      fm.point.set(this.pos.x, below.y, this.pos.z); fm.island = below.island;
    } else this.footMark = null;
    this.dbg.feature = this.footIsland && this.state === 'walking' ? 'island' : 'none';
    this.dbg.rho = 0; this.dbg.speedRel = this.vel.len();
  }

  _turnFace(dx, dz, rate) {
    const f = this.facing, a = Math.atan2(f.z, f.x);
    let d = Math.atan2(dz, dx) - a; d -= Math.round(d / TAU) * TAU;
    const na = a + clamp(d, -rate, rate);
    f.set(Math.cos(na), 0, Math.sin(na));
  }

  _walk(dt, c, dx, dz, m) {
    const P = this.P, v = this.vel, p = this.pos;
    const top = (this.sprint ? P.runSpeed : P.walkSpeed) * m;
    const k = Math.min(1, (m > 0.02 ? P.footAccel : P.footBrake) * dt);
    v.x += (dx * top - v.x) * k; v.z += (dz * top - v.z) * k; v.y = 0;
    if (m > 0.02) this._turnFace(dx, dz, 12 * dt);
    // Jump.
    if (c.press && this.footStun <= 0) {
      v.y = P.jumpSpeed; this.state = 'skydiving'; this.airT = 0; this.jumped = true;
      this.events.push({ type: 'jump' });
      return;
    }
    // Follow the ground; walk off an edge and you fall.
    const nx = p.x + v.x * dt, nz = p.z + v.z * dt;
    const g = islandUnder(this._isl, nx, p.y + 1.0, nz, 2.5);
    if (g) {
      p.set(nx, g.y, nz); this.footIsland = g.island;
      // Too steep to stand on: slide down it.
      const n = g.island.groundNormal(nx, nz, this._t1);
      if (n.y < 0.8) { v.x += n.x * P.gravity * dt; v.z += n.z * P.gravity * dt; }
    } else {
      p.x = nx; p.z = nz; this.state = 'skydiving'; this.airT = 0; this.jumped = false; this.footIsland = null;
    }
  }

  _skydive(dt, c, dx, dz, m) {
    const P = this.P, v = this.vel, p = this.pos;
    this.airT += dt;
    // A held (after a moment): dive head first, falling faster, steering less.
    this.diving = c.held && this.airT > 0.4;
    const term = this.diving ? P.diveTerminal : P.skyTerminal;
    const g = v.y >= 0 ? P.gravity : P.gravity * P.fallGravity * (1 - Math.min(1, -v.y / term) ** 4);
    let ay = -g;
    if (-v.y > term) ay += (-v.y - term) * 2;   // (slowing back down out of a dive)
    // Steer: your level speed moves toward where the stick points (the board's momentum fades
    // as you fall). A short hop steers like running.
    const drift = (P.runSpeed + (P.skyDrift - P.runSpeed) * clamp((this.airT - 0.6) / 1.2, 0, 1)) * (this.diving ? 0.45 : 1);
    const k = 1 - Math.exp(-P.skySteer * dt);
    v.x += (dx * drift * m - v.x) * k; v.z += (dz * drift * m - v.z) * k;
    v.y += ay * dt;
    const hl = Math.hypot(v.x, v.z);
    if (m > 0.02) this._turnFace(dx, dz, 6 * dt); else if (hl > 3) this._turnFace(v.x / hl, v.z / hl, 3 * dt);
    // Move; land on an island's ground or bump off its side. Streams do not hold you without
    // your board: you fall through them.
    const ax = p.x, ay0 = p.y, az = p.z;
    const nx = ax + v.x * dt, ny = ay0 + v.y * dt, nz = az + v.z * dt;
    const hit = this._islandHit(ax, ay0, az, nx, ny, nz);
    if (hit && hit.top && v.y <= 0.5) {
      const into = -v.y;
      p.set(nx, hit.y, nz); v.y = 0;
      this.state = 'walking'; this.footIsland = hit.island; this.summonT = 0; this.diving = false;
      // Always a safe landing: a hard one rolls you (a moment without control).
      const roll = into > P.rollSpeed;
      this.footStun = roll ? 0.6 : into > 12 ? 0.15 : 0;
      if (roll) this.rollT = 0.6;
      if (roll) { v.x *= 0.5; v.z *= 0.5; }
      if (this.airT > this.stats.longestAir) this.stats.longestAir = this.airT;
      this.events.push({ type: 'land', into, roll, air: this.airT });
      return;
    }
    if (hit) { this._islandBump(hit.island, ax, ay0, az); return; }
    p.set(nx, ny, nz);
  }

  // Step onto the stream under your feet (a dock, or any stream you are standing in).
  _mountGround() {
    const P = this.P, p = this.pos, sky = this.sky;
    const q = this._project(p.x, p.y + 1.6, p.z, this._q, 3.4, 0, 1, 0);
    if (q.ok && q.n.y > 0.6) {
      const n = q.n, F = sky.sample(q.p.x - n.x * 0.4, q.p.y - n.y * 0.4, q.p.z - n.z * 0.4, this.F);
      if (F.stream > 0.3) {
        const fd = this._t1.set(F.flowDir.x, F.flowDir.y, F.flowDir.z).projectOnPlane(n);
        if (fd.len() < 0.2) fd.copy(this.facing).projectOnPlane(n);
        fd.normalize();
        this.mode = 'board'; this.state = 'riding';
        this.pos.copy(q.p); this.normal.copy(n); this.up.copy(n);
        this.fwd.copy(fd); this.right.crossVectors(this.fwd, this.up);
        const sp = Math.max(4, Math.hypot(this.vel.x, this.vel.z));
        this.vel.copy(fd).scale(sp);
        this.rideT = 0; this.airT = 0; this.attachT = P.attachTime; this.popUsed = false; this._baseValid = false;
        this.falling = false; this.flying = false; this.footIsland = null; this.lipOut = null;
        this._fillDbg(F, 0);
        this.events.push({ type: 'mount' });
        return true;
      }
    }
    this.events.push({ type: 'noStream' });
    return false;
  }

  // The board arrives under your feet in the air: on it, falling (boost flies you).
  _mountAir() {
    const P = this.P, v = this.vel;
    this.mode = 'board'; this.state = 'freefall';
    this.airT = Math.max(this.airT, P.fallAfter); this.popUsed = true; this.leftBy = 'summon';
    this.catchBlock = 0.05; this.popT = 0; this.throughT = 0; this.attachT = 0; this.wipeT = 0;
    const hl = Math.hypot(v.x, v.z);
    if (hl > 4) this.fwd.set(v.x / hl, 0, v.z / hl); else this.fwd.copy(this.facing);
    this.up.copy(WORLD_UP); this.right.crossVectors(this.fwd, this.up);
    this._baseValid = false; this.trickYaw = 0; this.trickFlip = 0; this.airSpinTotal = 0; this.airFlipTotal = 0;
    this.falling = false; this.fallT = 0; this.diving = false; this.footIsland = null; this.lipOut = null;
    this._predT = 0;
    this.events.push({ type: 'mount', air: true });
  }

  // Your board met an island's ground: you step off it onto the island (fast, with a roll).
  _stepOff(I, y) {
    const P = this.P, v = this.vel, sp = Math.hypot(v.x, v.z);
    this.pos.y = y; v.y = 0;
    this.mode = 'foot'; this.state = 'walking'; this.footIsland = I;
    const hx = this.fwd.x, hz = this.fwd.z, hl = Math.hypot(hx, hz);
    if (hl > 0.2) this.facing.set(hx / hl, 0, hz / hl);
    const roll = sp > P.rollSpeed;
    this.footStun = roll ? 0.6 : 0.2;
    if (roll) this.rollT = 0.6;
    if (roll) { v.x *= 0.45; v.z *= 0.45; }
    this.falling = false; this.flying = false; this.boosting = false; this.predict = null; this.boostTarget = null; this.braceLock = null;
    if (this.airT > this.stats.longestAir) this.stats.longestAir = this.airT;
    this.events.push({ type: 'stepOff', speed: sp, roll });
  }

  // Put the rider on foot on an island's ground at (x, z) (testing, respawns).
  placeOnIsland(I, x = I.x, z = I.z) {
    const g = I.ground(x, z);
    if (g === null) return false;
    this.respawn(x, z, g);
    this.mode = 'foot'; this.state = 'walking'; this.footIsland = I;
    this.pos.set(x, g, z); this.vel.set(0, 0, 0); this.footStun = 0; this.summonT = 0;
    this.up.copy(WORLD_UP); this.normal.copy(WORLD_UP);
    this._isl = null; this._islT = 0;
    return true;
  }

  // --- riding ------------------------------------------------------------------------------

  _rideStep(dt, c, inp) {
    const P = this.P, sky = this.sky, v = this.vel, p = this.pos;
    const g = P.gravity;
    let n = this.normal;
    // The stream under the board (sampled just inside the skin).
    const F = sky.sample(p.x - n.x * 0.4, p.y - n.y * 0.4, p.z - n.z * 0.4, this.F);
    const flow = F.flow;
    this.rideT += dt; this.popUsed = false; this.attachT = P.attachTime; this.lipOut = null; this._baseValid = false;
    this.onSwell = 0;
    this.setting = false;

    // Hold: riding with the flow fast enough presses you onto the stream; bracing adds more
    // (and a steady press of its own). It is what keeps you on overhangs and undersides.
    const fd = F.flowDir;
    const vAlong = v.x * fd.x + v.y * fd.y + v.z * fd.z;
    const sf = F.stream;
    const hold = Math.max(smoothstep(P.holdMinSpeed, P.holdFullSpeed, vAlong) * P.holdUnbraced,
      c.brace * smoothstep(P.braceHoldMin, P.braceHoldFull, vAlong) * P.holdBraced) * sf;
    // Boosting holds you on harder too: going faster never throws you off the stream.
    const holdAcc = g * (hold + c.brace * P.braceDown + (this.boosting ? P.boostGrip * sf : 0));
    this.onStream = sf > 0.3;

    // Forces along the surface.
    const a = this._a.set(0, -g, 0);
    const vr = this._vr.set(v.x - flow.x, v.y - flow.y, v.z - flow.z);
    const vn = vr.dot(n);
    const vt = this._vt.copy(vr).addScaled(n, -vn);
    const vtl = vt.len();
    const dragMul = 1 - c.tuck * (1 - P.tuckDrag) + c.brake * P.brakeDrag;
    a.addScaled(vt, -(P.glideDrag + P.quadDrag * vtl) * dragMul);
    // Streams carry you: riding with the flow pushes you up to a cruising speed.
    if (P.flowDrive > 0 && sf > 0.1) {
      const fdp = this._t2.set(fd.x, fd.y, fd.z).projectOnPlane(n);
      if (fdp.len() > 0.2) {
        fdp.normalize();
        const va = v.dot(fdp);
        if (va > -2) {
          // Faster (narrower) streams carry you faster.
          // (a dock running onto an island slows you to step off at a jog)
          const arriving = (F.tags & TAG.DOCK) && (F.tags & TAG.TIP) && !(F.tags & TAG.UP);   // (not a launch lip)
          const cruise = arriving ? P.dockArrive : (P.cruiseSpeed + P.cruiseFromFlow * Math.max(0, F.flowSpeed - P.trunkFlow)) * (1 + P.tuckCruise * c.tuck);
          // Updrafts carry you up their surges.
          const drive = P.flowDrive * ((F.tags & TAG.UP) ? P.updraftDrive : 1);
          a.addScaled(fdp, drive * clamp((cruise - va) / 8, 0, 1) * sf);
          // Streams hold you back from running away (a chute, a long plunge).
          if (va > P.holdCap) a.addScaled(fdp, -P.flowHold * (va - P.holdCap) * sf);
          if (arriving && va > P.dockArrive) a.addScaled(fdp, -Math.min(5, (va - P.dockArrive) * 0.3) * sf);
          // A swell's face carries you at the swell's speed once you are going nearly as fast:
          // catch it (tuck, pump, boost) and ride it.
          if (P.swellPush > 0 && F.swell > 0.15 && F.swellSlope < 0 && F.swellSpeed > 0) {
            const k = (2 * Math.PI) / Math.max(40, P.swellLength);
            const face = Math.min(1, -F.swellSlope / Math.max(0.01, P.swellHeight * k * 0.5));
            const near = clamp(1 - Math.abs(va - F.swellSpeed) / 7, 0, 1);
            this.onSwell = face * near;
            a.addScaled(fdp, P.swellPush * this.onSwell * clamp((F.swellSpeed + 1 - va) / 3, -1, 1) * sf);
          } else this.onSwell = 0;
        }
      }
    }
    const gt = this._t1.set(0, -g, 0).projectOnPlane(n);
    // Pumping: holding the crouch while dropping down a face adds speed.
    if (c.held && vtl > 2) {
      const down = gt.dot(vt) / vtl;
      if (down > 0) a.addScaled(vt, (P.pumpGain * down) / vtl);
    }
    if (this.boosting) this._surfaceBoost(a, n, F, v);
    else if (!P.boostInfinite) {
      const steep = clamp(gt.len() / g, 0, 1);
      const withFlow = vtl > 1 && sf > 0.3 ? Math.max(0, (vt.x * fd.x + vt.y * fd.y + vt.z * fd.z) / vtl) : 0;
      const spd = Math.sqrt(Math.max(0, v.lenSq() - v.dot(n) ** 2));
      const rate = P.boostFill * clamp(spd / 20, 0.25, 2) * (1 + P.slopeFill * steep + P.flowFill * withFlow);
      this.gauge = Math.min(1, this.gauge + rate * dt);
    }
    const tb = this.weather.turbulence(p.x, p.y, p.z, this.world.t, this._tb);
    a.addScaled(tb, 0.25);
    this.dbg.turb = Math.hypot(tb.x, tb.y, tb.z);
    v.addScaled(a, dt);

    // Steering.
    this._carve(dt, c.lean, c.tuck, c.brace, c.snap, c.brake, flow, n, P.rideThreshold, P.rideThreshold);
    this._currentPull(dt, F, flow, n, this.boosting ? P.boostAlign : 0);

    // Pop.
    if (inp.crouchReleased && c.ctrl > 0) {
      const charge = clamp(this.crouchT / P.popCharge, 0, 1);
      const imp = P.popMin + (P.popMax - P.popMin) * charge;
      v.addScaled(n, imp);
      this.events.push({ type: 'pop', charge, late: false });
      this.popUsed = true; this.popT = 0.2; this.attachT = 0; this.crouchT = 0;
      this._leave(F, 'pop');
      p.addScaled(v, dt);
      this._fillDbg(F, 0);
      return;
    }

    // Move along the surface, then decide: still on, or leaving?
    const tx = p.x + v.x * dt, ty = p.y + v.y * dt, tz = p.z + v.z * dt;
    let q = this._project(tx, ty, tz, this._q, 1.5, n.x, n.y, n.z);
    if (!q.ok && this.sky.density(tx, ty, tz) >= P.rideThreshold) {
      // Ran hard into something (a wall, another stream): find where the move entered it and
      // take the surface there, so nothing is ever passed through.
      q = this._impact(p.x, p.y, p.z, tx, ty, tz, this._q);
    }
    if (!q.ok) { this._leave(F, 'edge'); p.set(tx, ty, tz); this._fillDbg(F, 0); return; }
    const n2 = q.n;
    // How fast the surface curves away ahead of you along your travel (convex > 0).
    const vt2 = this._vt.copy(v).addScaled(n2, -v.dot(n2));
    const vts = vt2.len();
    let kappa = 0;
    if (vts > 1) {
      const D = clamp(vts * 0.2, 3, 10);
      const qa = this._project(q.p.x + (vt2.x / vts) * D, q.p.y + (vt2.y / vts) * D, q.p.z + (vt2.z / vts) * D, this._qa, 2, n2.x, n2.y, n2.z);
      if (!qa.ok) kappa = 10;   // the surface ends ahead: an edge
      else {
        const dlt = (qa.p.x - q.p.x) * n2.x + (qa.p.y - q.p.y) * n2.y + (qa.p.z - q.p.z) * n2.z;
        kappa = (-2 * dlt) / (D * D);
      }
    }
    // Inward acceleration needed to follow the surface, beyond what gravity already gives.
    // Waves travel: their crests pull at you by your speed relative to each wave, not over the
    // ground (see waterAt), so take their share out and put it back at the relative speeds.
    let pull = vts * vts * kappa;
    const F2w = sky.sample(q.p.x - n2.x * 0.4, q.p.y - n2.y * 0.4, q.p.z - n2.z * 0.4, this.F2);
    if (F2w.waveK0 !== 0) {
      const bu = F2w.bandUp, fl = clamp(((bu.x * n2.x + bu.y * n2.y + bu.z * n2.z) - 0.5) / 0.4, 0, 1);
      const vs = v.x * F2w.flowDir.x + v.y * F2w.flowDir.y + v.z * F2w.flowDir.z;
      pull += fl * (F2w.waveK2 - 2 * vs * F2w.waveK1);
    }
    const need = Math.max(0, pull) - g * n2.y;
    this.hold = hold; this.holdNeed = Math.max(0, need); this.holdMargin = holdAcc - need;
    this.holdScale = g * (P.holdBraced + P.braceDown);
    this.dbg.kappa = kappa;
    // Above the surface by more than a hair means it fell away under you.
    const sep = (tx - q.p.x) * n2.x + (ty - q.p.y) * n2.y + (tz - q.p.z) * n2.z;
    const F2 = F2w;   // (the stream at the new spot, sampled above)
    const ridable = this._faceRule(F2, n2);
    if (!ridable) {
      // A face you may not ride: you slip off it and through it.
      this._leave(F, 'face');
      this.throughT = 0.6; this.throughIn = false;
      p.set(tx, ty, tz); this._fillDbg(F, kappa); return;
    }
    // Pulled off (crest, peel) only if it holds for two steps running: a one-step blip of the
    // surface (a seam between segments) is not a crest.
    const over = need > holdAcc + 0.5;
    this._overN = over ? (this._overN || 0) + 1 : 0;
    if ((over && this._overN >= 2) || sep > 0.35) {
      this._overN = 0;
      this._leave(F, over ? (n2.y < 0.2 ? 'peel' : 'crest') : 'edge');
      p.set(tx, ty, tz); this._fillDbg(F, kappa); return;
    }
    // Still on: sit on the surface, velocity along it. The surface takes the push into it
    // (gravity, mostly); then the velocity follows the surface as it curves. A gentle change
    // of surface keeps the speed; running into a wall head-on loses the into-wall part.
    v.addScaled(n, -v.dot(n));
    const cosA = clamp(n.dot(n2), -1, 1);
    if (cosA > 0.97) {
      const ax = this._ax.crossVectors(n, n2), al = ax.len();
      if (al > 1e-7) rotateAround(v, ax.scale(1 / al), Math.acos(cosA));
      v.addScaled(n2, -v.dot(n2));
    } else {
      const vin = v.dot(n2);
      v.addScaled(n2, -vin);
      if (vin < 0) {
        const lost = -vin;
        const along = this._t1.copy(v);
        if (along.len() < 1) along.set(0, 1, 0).projectOnPlane(n2);
        if (along.len() > 1e-3) v.addScaled(along.normalize(), lost * P.impactKeep);
        if (lost > 22) { this.wipeT = P.wipeoutTime * 0.6; this.sketchT = 0.6; this.events.push({ type: 'wipeout', slam: true, reason: 'slam', into: lost, gain: 0, air: 0, quality: 0 }); this.stats.wipeouts++; }
      }
    }
    // Moving water (a swell rising under you, a slosh): ride with the surface, so a pop off a
    // rising face goes higher.
    const bu = F2.bandUp, wn = (F2.surfV || 0) * (bu.x * n2.x + bu.y * n2.y + bu.z * n2.z);
    if (wn !== 0) v.addScaled(n2, wn);
    p.copy(q.p);
    this.normal.copy(n2);
    this._fillDbg(F2, kappa);
    this.dbg.speedRel = v.len();
  }

  // Leaving the surface (pop, crest, edge, peel, face).
  _leave(F, why) {
    const P = this.P, p = this.pos;
    this.state = 'freefall';
    this.airT = 0; this.rideT = 0;
    this.catchBlock = why === 'pop' ? 0 : 0.12;
    // Remember a wall for the lip lock.
    const nh = Math.hypot(this.normal.x, this.normal.z);
    if (nh > 0.5) {
      this.lipOut = this._lipOut.set(-this.normal.x / nh, 0, -this.normal.z / nh);
      this.sky.mediumVelocity(p.y, this.world.t, this._lipFlow);
    } else this.lipOut = null;
    this.airSpinTotal = 0; this.airFlipTotal = 0;
    this.leftBy = why;
  }

  _fillDbg(F, kappa) {
    const d = this.dbg;
    d.rho = F.rho; d.thr = this.P.rideThreshold; d.layer = F.dominant; d.feature = F.feature; d.netLayer = F.layer; d.rapids = F.rapids || 0;
    d.flow.set(F.flow.x, F.flow.y, F.flow.z); d.kappa = kappa;
  }

  // --- air ---------------------------------------------------------------------------------

  _airStep(dt, c, inp) {
    const P = this.P, sky = this.sky, v = this.vel, p = this.pos;
    const F = sky.sample(p.x, p.y, p.z, this.F);
    this.airT += dt;
    this.attachT = Math.max(0, this.attachT - dt);
    this.hold = 0; this.holdNeed = 0; this.holdMargin = 0; this.onStream = false;
    const attached = this.attachT > 0 && !this.popUsed;
    this.setting = c.brace > 0.3;

    // Passing through trapar (failed catch or a face you may not ride): nothing holds you
    // until you are out the other side.
    if (this.throughT > 0) {
      this.throughT -= dt;
      if (F.rho >= P.rideThreshold) this.throughIn = true;
      else if (this.throughIn && F.rho < P.rideThreshold * 0.3) this.throughT = 0;
      if (this.throughT <= 0) { this.throughT = 0; this.throughIn = false; }
    }

    const a = this._a.set(0, -this.gravityAt(v.y), 0);
    if (F.rho > P.rideThreshold) {
      // Inside a stream (passing through): it drags a little in every direction.
      a.addScaled(this._vr.set(v.x - F.flow.x, v.y - F.flow.y, v.z - F.flow.z), -P.punchDrag * Math.min(F.rho / P.rideThreshold, 2));
    } else {
      // Clear air: drag against the wind.
      const w = this.weather.windAt(p.y, this.world.t, this._t1);
      const ax = v.x - w.x, ay = v.y, az = v.z - w.z;
      const sp = Math.sqrt(ax * ax + ay * ay + az * az);
      a.x -= P.airDrag * sp * ax; a.y -= P.airDrag * sp * ay; a.z -= P.airDrag * sp * az;
    }
    this.flying = false;
    if (this.boosting && this.falling) this._fallBoost(a, c);
    else if (this.boosting) {
      // A short air: boost adds speed the way you are already flying, level: no lift, no turn.
      const hx = v.x, hz = v.z, hl = Math.hypot(hx, hz);
      if (hl > 1) {
        const k = Math.min(1, Math.max(0, (P.boostTopSpeed - hl) / 12));
        a.x += (hx / hl) * P.airThrust * k; a.z += (hz / hl) * P.airThrust * k;
        this.boostAim.set(hx / hl, 0, hz / hl);
      }
    }
    // (flying, lean turns the nose instead: see _airControl)
    if (!attached && !this.flying) this._airSteer(a, c.lean, F.rho > 0.05 ? 1 : 0.5);
    // Lip lock: braced, after leaving over a wall's lip, the drift away from the wall is taken
    // out so you come back down onto it (like vert airs in a halfpipe).
    if (this.lipOut && c.brace > 0.3 && this.airT < 3 && P.lipLock > 0) this._lipLock(a, p, v);
    const tb = this.weather.turbulence(p.x, p.y, p.z, this.world.t, this._tb);
    a.addScaled(tb, 1);
    this.dbg.turb = Math.hypot(tb.x, tb.y, tb.z);
    v.addScaled(a, dt);
    if (this.flying) this._fallTurn(dt);
    this._airControl(dt, c.lean, c.trim, c.brace);
    this.slip = 0;

    // Late pop: a short window after sliding off an edge where you can still pop.
    if (inp.crouchReleased && c.ctrl > 0 && this.airT < P.latePop && !this.popUsed && this.leftBy !== 'pop') {
      const charge = clamp(this.crouchT / P.popCharge, 0, 1);
      v.addScaled(this.up, P.popMin + (P.popMax - P.popMin) * charge);
      this.events.push({ type: 'pop', charge, late: true });
      this.popUsed = true; this.popT = 0.2; this.attachT = 0; this.crouchT = 0;
    }

    // Move, and catch a surface if we cross into one.
    const px = p.x, py = p.y, pz = p.z;
    const nx = px + v.x * dt, ny = py + v.y * dt, nz = pz + v.z * dt;
    const thr = P.rideThreshold;
    // Islands are solid: onto one's ground you step off your board; its side or underside
    // stops you.
    const hitI = this._islandHit(px, py, pz, nx, ny, nz);
    if (hitI) {
      if (hitI.top && v.y <= 1) { p.set(nx, ny, nz); this._stepOff(hitI.island, hitI.y); }
      else this._islandBump(hitI.island, px, py, pz);
      this._fillDbg(F, 0);
      return;
    }
    const rhoNew = sky.density(nx, ny, nz);
    p.set(nx, ny, nz);
    this.state = rhoNew > 0.05 ? 'drifting' : 'freefall';
    // Just slid off a surface and sinking back into it (a crest that was not one, an edge you
    // barely left): back onto its skin, as if you had landed.
    if (this.popT <= 0 && this.catchBlock <= 0 && this.throughT <= 0 && rhoNew >= thr && F.rho >= thr * 0.5
      && this.airT < 1 && (this.leftBy === 'crest' || this.leftBy === 'edge' || this.leftBy === 'peel')) {
      // (along the normal of the surface just left: the best guess for where its skin is)
      const nm = this.normal;
      const q = this._project(nx, ny, nz, this._q, 2, nm.x, nm.y, nm.z);
      if (q.ok && this.up.dot(q.n) > 0.5) {
        const n = q.n;
        const F2 = sky.sample(q.p.x - n.x * 0.4, q.p.y - n.y * 0.4, q.p.z - n.z * 0.4, this.F2);
        const vr = this._vr.set(v.x - F2.flow.x, v.y - F2.flow.y, v.z - F2.flow.z);
        const vnr = Math.min(0, vr.dot(n));
        if (this._faceRule(F2, n) && this._land(n, F2.flow, vr, vnr)) {
          p.copy(q.p); this.normal.copy(n); this.state = 'riding';
          this.airT = 0; this.rideT = 0; this.lipOut = null;
          this.attachT = P.attachTime; this.popUsed = false; this._baseValid = false;
          this._fillDbg(F, 0); this.dbg.speedRel = Math.hypot(v.x, v.y, v.z);
          return;
        }
      }
    }
    if (this.popT <= 0 && this.catchBlock <= 0 && this.throughT <= 0 && rhoNew >= thr && F.rho < thr) {
      // Crossing point (bisection).
      let lo = 0, hi = 1;
      for (let k = 0; k < 8; k++) {
        const m = (lo + hi) / 2;
        if (sky.density(px + (nx - px) * m, py + (ny - py) * m, pz + (nz - pz) * m) >= thr) hi = m; else lo = m;
      }
      const cx = px + (nx - px) * hi, cy = py + (ny - py) * hi, cz = pz + (nz - pz) * hi;
      const q = this._project(cx, cy, cz, this._q, 1);
      if (q.ok) {
        const n = q.n;
        const F2 = sky.sample(q.p.x - n.x * 0.4, q.p.y - n.y * 0.4, q.p.z - n.z * 0.4, this.F2);
        const vr = this._vr.set(v.x - F2.flow.x, v.y - F2.flow.y, v.z - F2.flow.z);
        const vnr = vr.dot(n);
        if (vnr < 0.5) {
          const ridable = this._faceRule(F2, n);
          const facing = this.up.dot(n);
          if (!ridable) {
            // A face you may not ride: you pass through it.
            this.throughT = 0.8; this.throughIn = true;
          } else if ((facing < P.bottomMin && facing > -0.35) ? this._crash(n, F2.flow, vr, vnr, 'side-on') : this._land(n, F2.flow, vr, vnr)) {
            // (Side-on, board on edge to the surface, is a crash onto it: you never go through.
            // Only a board landing upside down passes through.)
            p.copy(q.p);
            this.normal.copy(n);
            this.state = 'riding';
            if (this.airT > this.stats.longestAir) this.stats.longestAir = this.airT;
            this.airT = 0; this.rideT = 0; this.lipOut = null;
            this.attachT = P.attachTime; this.popUsed = false; this._baseValid = false;
          }
        }
      }
    }
    this._fillDbg(F, 0);
    this.dbg.speedRel = Math.hypot(v.x, v.y, v.z);
  }

  // The wall is found again each step (the stream bends, and a pipe can open back out into a
  // channel under you). Near the middle of the floor nothing is added.
  _lipLock(a, p, v) {
    const P = this.P, br = this.sky.braids;
    const q = br && br.nearestAxis ? br.nearestAxis(p.x, p.y, p.z, this._lipQ || (this._lipQ = {})) : null;
    let ox, oz, inner = 1;
    if (q) {
      const s = q.lat >= 0 ? 1 : -1;
      ox = q.rx * s; oz = q.rz * s;
      const ol = Math.hypot(ox, oz);
      if (ol < 0.3) return;            // the stream is on its side here: no "outward" to undo
      ox /= ol; oz /= ol;
      inner = Math.min(1, Math.max(0, (Math.abs(q.lat) - 0.5 * q.wf) / 8));
    } else { ox = this.lipOut.x; oz = this.lipOut.z; }
    const out = (v.x - this._lipFlow.x) * ox + (v.z - this._lipFlow.z) * oz;
    const want = -P.lipDrift * inner;
    if (out > want) { const k = (want - out) * P.lipLock; a.x += ox * k; a.z += oz * k; }
  }

  // Air steering: lean pushes you sideways (the way the board's right points), while it spins
  // the board (see _airControl).
  _airSteer(a, lean, scale) {
    if (Math.abs(lean) < 0.01) return;
    const r = this._t2.set(this.right.x, 0, this.right.z);
    if (r.len() < 0.1) return;
    r.normalize();
    a.addScaled(r, lean * this.P.airSteer * scale);
  }

  // The board's nose, level (this._hx, this._hz). Nose straight up or down (mid-flip): the
  // way you are flying, else the last heading.
  _noseH() {
    let hx = this.fwd.x, hz = this.fwd.z, hl = Math.hypot(hx, hz);
    if (hl < 0.3) { hx = this.vel.x; hz = this.vel.z; hl = Math.hypot(hx, hz); }
    if (hl > 1e-3) { this._hx = hx / hl; this._hz = hz / hl; }
  }

  // Boost in free fall: fly where the nose points. Thrust along the nose (level, tapering off
  // toward the top speed), and lift that slows the fall to a glide sink (it never climbs);
  // the flight turns to follow the nose (_fallTurn), and lean turns the nose (_airControl).
  // Stick forward dives (faster, sinking more), back flares (slower, sinking less).
  _fallBoost(a, c) {
    const P = this.P, v = this.vel;
    this._noseH();
    const hx = this._hx, hz = this._hz;
    const top = P.fallBoostTop * (1 + 0.2 * c.tuck - 0.3 * c.brake);
    const along = v.x * hx + v.z * hz;
    const k = clamp((top - along) / 10, 0, 1);
    const thrust = P.fallThrust * (1 + 0.3 * c.tuck - 0.4 * c.brake) * k;
    a.x += hx * thrust; a.z += hz * thrust;
    const sink = Math.max(0.5, P.fallSink * (1 + 1.5 * c.tuck - 0.6 * c.brake));
    const gNow = this.gravityAt(v.y), dv = -sink - v.y;   // dv > 0: falling faster than the glide
    a.y += dv > 0 ? gNow + Math.min(P.fallFlare * dv, P.fallLiftMax) : gNow * Math.max(0, 1 + dv / 4);
    this.boostAim.set(hx, 0, hz);
    this.flying = true;
  }

  // Flying: the flight's level direction turns toward the nose (keeping its speed).
  _fallTurn(dt) {
    const v = this.vel, vh = Math.hypot(v.x, v.z);
    if (vh < 1) return;
    const av = Math.atan2(v.z, v.x);
    let d = Math.atan2(this._hz, this._hx) - av;
    d -= Math.round(d / TAU) * TAU;
    const m = this.P.fallTurn * dt;
    const na = av + clamp(d, -m, m);
    v.x = Math.cos(na) * vh; v.z = Math.sin(na) * vh;
  }

  // Boost on a stream: along the stream (whichever way along it you are going), flat to the
  // surface, tapering off toward the top speed. Off the stream's line (a wall you are heading
  // up) it adds nothing toward the wall.
  _surfaceBoost(a, n, F, v) {
    const P = this.P;
    const d = this._t1.set(F.flowDir.x, F.flowDir.y, F.flowDir.z).projectOnPlane(n);
    if (F.stream < 0.1 || d.len() < 0.3) { d.copy(v).projectOnPlane(n); if (d.len() < 2) d.copy(this.fwd).projectOnPlane(n); }
    if (d.len() < 1e-3) return;
    d.normalize();
    let along = v.dot(d);
    if (along < 0) { d.scale(-1); along = -along; }
    const k = Math.min(1, Math.max(0, (P.boostTopSpeed - along) / 12));
    if (k <= 0) return;
    a.addScaled(d, P.boostThrust * k);
    this.boostAim.copy(d);
  }

  // Surf steering. The stick swings the nose around the tail; the fins then pull your travel
  // toward where the nose points.
  //   draw  (default) moderate nose rate, fins catch the slide: smooth lines, small speed cost
  //   snap  (LT) fast nose, the tail slides, big speed cost: hard redirects, even reversals
  // Slow boards pivot; fast boards rail (turn rate grows with speed, little slide). Weight on
  // the tail (stick back) pivots more. Bracing (RT) adds grip and leans toward the rail, so a
  // braced snap is a tight cutback that keeps you on. A board traveling tail-first swings back
  // around nose-first (a revert), at a speed cost.
  _carve(dt, lean, tuck, brace, snap, tail, flow, n, rho, thr) {
    const P = this.P, v = this.vel;
    const nS = this.normal;
    const vr = this._vr.set(v.x - flow.x, v.y - flow.y, v.z - flow.z);
    const vn = vr.dot(n);
    const vt = this._vt.copy(vr).addScaled(n, -vn);
    const vtl = vt.len();

    let pivot = 1 - smoothstep(P.pivotSpeed, P.railSpeed, vtl);
    pivot = clamp(pivot + tail * P.tailPivot, 0, 1);
    pivot = Math.max(pivot, snap);
    pivot *= 1 - 0.5 * brace;
    this.pivot = pivot;
    const railRate = Math.min(P.turnMax, P.turnMin + P.turnPerSpeed * vtl);
    const pivRate = P.drawRate + (P.snapRate - P.drawRate) * snap;
    const rate = (railRate + (pivRate - railRate) * pivot) * (1 - 0.35 * tuck) * (this.sketchT > 0 ? 0.5 : 1);
    rotateAround(this.fwd, nS, -lean * rate * dt);

    this.up.lerp(nS, damp(18, dt)).normalize(nS);
    this.fwd.projectOnPlane(this.up).normalize(this._t1.set(1, 0, 0).projectOnPlane(this.up).normalize());
    this.right.crossVectors(this.fwd, this.up);

    this.slip = 0;
    if (vtl > 0.5) {
      const fx = this._t1.copy(this.fwd).projectOnPlane(n);
      if (fx.len() < 1e-3) return;
      fx.normalize();
      const vd = this._t2.copy(vt).scale(1 / vtl);
      const ang = Math.acos(clamp(vd.dot(fx), -1, 1));
      this.slip = ang;
      if (ang > Math.PI / 2 + 0.15) {
        // Tail first: the fins swing the nose back around toward your travel (a revert).
        const sgn = this._ax.crossVectors(fx, vd).dot(nS) >= 0 ? 1 : -1;
        rotateAround(this.fwd, nS, sgn * Math.min(Math.PI - ang + 0.2, P.revertRate * dt));
        this.fwd.projectOnPlane(this.up).normalize(fx);
        this.right.crossVectors(this.fwd, this.up);
        const loss = P.skidFriction * Math.sin(ang) + 1.2 * Math.max(0, -Math.cos(ang));
        vt.scale(Math.max(0, 1 - loss * dt));
        v.set(flow.x + vt.x + n.x * vn, flow.y + vt.y + n.y * vn, flow.z + vt.z + n.z * vn);
        return;
      }
      if (ang > 1e-4) {
        const gRail = P.gripRate;
        const gPiv = P.finGrip + (P.snapGrip - P.finGrip) * snap;
        const gripScale = clamp(Math.sqrt(Math.max(rho, 0.01) / thr), 0.6, 1.6)
          * (this.sketchT > 0 ? 0.5 : 1) * (this.wipeT > 0 ? 0.1 : 1) * (1 - 0.25 * tuck) * (1 + P.braceGrip * brace);
        // Fins pull the travel toward the nose in proportion to the slide, so the nose leads
        // through a turn by a visible slip angle (nose rate / grip).
        const rot = Math.min(ang, (gRail + (gPiv - gRail) * pivot) * gripScale * Math.max(ang, 0.08) * dt);
        const axis = this._ax.crossVectors(vd, fx);
        let al = axis.len();
        if (al < 1e-6) { axis.copy(nS).scale(lean < 0 ? -1 : 1); al = 1; }
        rotateAround(vt, axis.scale(1 / al), rot);
        const loss = P.skidFriction * Math.sin(ang) * (1 + snap * P.snapLoss * (1 - 0.4 * brace));
        vt.scale(Math.max(0, 1 - loss * dt));
        v.set(flow.x + vt.x + n.x * vn, flow.y + vt.y + n.y * vn, flow.z + vt.z + n.z * vn);
      }
    }
  }

  // Inside a stream the current gently turns your travel toward its flow line (either way
  // along it), keeping your speed.
  _currentPull(dt, F, flow, n, extra = 0) {
    const P = this.P;
    if (!(F.stream > 0.3) || P.currentPull + extra <= 0) return;
    const fd = this._t1.set(F.flowDir.x, F.flowDir.y, F.flowDir.z).projectOnPlane(n);
    if (fd.len() < 0.2) return;
    fd.normalize();
    const v = this.vel;
    const vr = this._vr.set(v.x - flow.x, v.y - flow.y, v.z - flow.z);
    const vn = vr.dot(n);
    const vt = this._vt.copy(vr).addScaled(n, -vn);
    const vtl = vt.len();
    if (vtl < 1) return;
    if (vt.dot(fd) < 0) fd.scale(-1);
    const ang = Math.acos(clamp(vt.dot(fd) / vtl, -1, 1));
    if (ang < 1e-4) return;
    const axis = this._ax.crossVectors(vt, fd);
    const al = axis.len();
    if (al < 1e-8) return;
    const k = (P.currentPull + extra) * clamp((F.stream - 0.3) / 0.4, 0, 1);
    rotateAround(vt, axis.scale(1 / al), Math.min(ang, k * Math.max(ang, extra > 0 ? 0.15 : 0) * dt));
    v.set(flow.x + vt.x + n.x * vn, flow.y + vt.y + n.y * vn, flow.z + vt.z + n.z * vn);
  }

  _rotateBasis(axis, ang) {
    rotateAround(this.fwd, axis, ang);
    rotateAround(this.up, axis, ang);
  }

  _alignUpTo(target, maxAng) {
    const c = clamp(this.up.dot(target), -1, 1);
    const ang = Math.acos(c);
    if (ang < 1e-4 || maxAng <= 0) return;
    const axis = this._ax.crossVectors(this.up, target);
    let al = axis.len();
    if (al < 1e-6) { axis.copy(this.right); al = 1; }
    this._rotateBasis(axis.scale(1 / al), Math.min(ang, maxAng));
  }

  // What a braced board lines up with in the air: the surface you are about to land on, or
  // if you would miss everything, the nearest stream you can reach.
  _braceTarget() {
    const pr = this.predict;
    if (pr && pr.hit) return { n: pr.normal, vel: pr.vel, point: pr.point, t: pr.t };
    const tg = this.boostTarget;
    if (tg && tg.n) {
      const d = this._pv.set(tg.x - this.pos.x, tg.y - this.pos.y, tg.z - this.pos.z);
      return { n: tg.n, vel: d.len() > 1 ? d : this.vel, point: tg, t: 99 };
    }
    return null;
  }

  // Rotate (fwd, up) so up turns toward target by at most maxAng.
  _turnUp(fwd, up, target, maxAng) {
    const ang = Math.acos(clamp(up.dot(target), -1, 1));
    if (ang < 1e-4 || maxAng <= 0) return;
    const axis = this._ax.crossVectors(up, target);
    let al = axis.len();
    if (al < 1e-6) { axis.crossVectors(fwd, up); al = axis.len() || 1; }
    axis.scale(1 / al);
    const r = Math.min(ang, maxAng);
    rotateAround(fwd, axis, r); rotateAround(up, axis, r);
  }

  _airControl(dt, lean, trim, brace) {
    const P = this.P;
    const lock = brace > 0.3 ? this._braceTarget() : null;
    this.braceLock = lock;
    if (this.flying) {
      // Flying (boosting in free fall): lean turns the nose, the board levels out, banked into
      // the turn and pitched with the stick (forward dives, back flares). No tricks.
      this._baseValid = false; this.trickYaw = 0; this.trickFlip = 0;
      if (Math.abs(lean) > 0.01) rotateAround(this.fwd, this.up, -lean * P.fallAim * dt);
      const fh = this._t1.set(this.fwd.x, 0, this.fwd.z);
      if (fh.len() < 0.3) fh.set(this._hx, 0, this._hz);
      fh.normalize();
      const rh = this._t2.set(-fh.z, 0, fh.x);   // (fh x up)
      const bank = 0.5 * lean, pitch = 0.35 * Math.max(0, -trim) - 0.3 * Math.max(0, trim);
      const tgt = this._dir.set(0, Math.cos(bank) * Math.cos(pitch), 0).addScaled(rh, Math.sin(bank)).addScaled(fh, Math.sin(pitch)).normalize();
      // (braced with a landing coming up: line up with it instead)
      if (lock && lock.t < 1.2) this._alignUpTo(lock.n, P.braceTurnRate * dt);
      else this._alignUpTo(tgt, P.fallLevel * dt);
    } else if (brace > 0.3) {
      // Braced: a base orientation turns toward the landing; tricks spin and flip on top.
      if (!this._baseValid) {
        this.baseUp.copy(this.up); this.baseFwd.copy(this.fwd);
        this.trickYaw = 0; this.trickFlip = 0; this._baseValid = true;
      }
      const bu = this.baseUp, bf = this.baseFwd;
      if (lock) {
        this._turnUp(bf, bu, lock.n, P.braceTurnRate * dt);
        const d = this._dir.copy(lock.vel).projectOnPlane(bu);
        if (d.len() > 1) {
          d.normalize();
          const ang = Math.acos(clamp(d.dot(bf), -1, 1));
          const ax = this._ax.crossVectors(bf, d);
          const al = ax.len();
          if (al > 1e-6) rotateAround(bf, ax.scale(1 / al), Math.min(ang, P.braceTurnRate * 0.7 * dt));
        }
      }
      bu.normalize(WORLD_UP);
      bf.projectOnPlane(bu).normalize(this._t1.set(1, 0, 0).projectOnPlane(bu).normalize());
      const dYaw = -lean * P.airSpin * dt, dFlip = trim * P.airFlip * dt;
      this.trickYaw += dYaw; this.trickFlip += dFlip;
      const tLand = lock ? lock.t : 99;
      if (tLand < P.trickComplete && Math.abs(lean) < 0.3 && Math.abs(trim) < 0.3) {
        const tol = P.trickTol * DEG;
        const yT = Math.round(this.trickYaw / Math.PI) * Math.PI, fT = Math.round(this.trickFlip / TAU) * TAU;
        const rate = Math.max(3, 1 / Math.max(0.05, tLand)) * dt;
        if (Math.abs(this.trickYaw - yT) < tol) this.trickYaw += clamp(yT - this.trickYaw, -rate, rate);
        if (Math.abs(this.trickFlip - fT) < tol) this.trickFlip += clamp(fT - this.trickFlip, -rate, rate);
      }
      this.airSpinTotal += Math.abs(dYaw); this.airFlipTotal += Math.abs(dFlip);
      this.up.copy(bu); this.fwd.copy(bf);
      rotateAround(this.fwd, this.up, this.trickYaw);
      this.right.crossVectors(this.fwd, this.up).normalize();
      if (this.trickFlip !== 0) this._rotateBasis(this.right, this.trickFlip);
    } else {
      this._baseValid = false;
      if (Math.abs(lean) > 0.01) { rotateAround(this.fwd, this.up, -lean * P.airSpin * dt); this.airSpinTotal += Math.abs(lean * P.airSpin * dt); }
      this.right.crossVectors(this.fwd, this.up).normalize();
      if (Math.abs(trim) > 0.01) { this._rotateBasis(this.right, trim * P.airFlip * dt); this.airFlipTotal += Math.abs(trim * P.airFlip * dt); }
      const free = 1 - Math.min(1, Math.abs(lean) + Math.abs(trim));
      this._alignUpTo(WORLD_UP, P.autoLevel * free * dt);
    }
    this.up.normalize(WORLD_UP);
    this.fwd.projectOnPlane(this.up).normalize(this._t1.set(1, 0, 0));
    this.right.crossVectors(this.fwd, this.up);
  }

  // Judge a landing. Converts falling speed into forward speed according to how well the
  // board's angle and heading match the surface and the direction of travel.
  // Returns false when the board does not catch: you fall through.
  _land(n, flow, vr, vnr) {
    const P = this.P;
    const into = -vnr;
    if (this.up.dot(n) < P.bottomMin) {
      // Upside down: no catch. At speed it is a wipeout; slowly you just pass through.
      if (into > P.catchMinSpeed && this.airT > P.catchMinAir) this._fallThrough(into, 'upside down');
      else { this.throughT = 0.8; this.throughIn = true; }
      return false;
    }
    const vt = this._vt.copy(vr).addScaled(n, -vnr);
    const vtl = vt.len();
    const dir = this._dir;
    const fl = Math.hypot(flow.x, flow.y, flow.z);
    if (fl > 1 && vtl < 0.5 * Math.max(0, -vnr)) {
      // Coming down mostly straight (a long fall): the catch sends you along the stream, the
      // way the board points (with the flow if it is across).
      dir.set(flow.x / fl, flow.y / fl, flow.z / fl).projectOnPlane(n);
      if (dir.len() > 0.2) {
        dir.normalize();
        const f = this._t2.copy(this.fwd).projectOnPlane(n);
        if (f.len() > 0.3 && f.dot(dir) < -0.35 * f.len()) dir.scale(-1);
      } else dir.copy(this.fwd).projectOnPlane(n).normalize(this._t1.set(1, 0, 0).projectOnPlane(n).normalize());
    } else if (vtl > 3) dir.copy(vt).scale(1 / vtl);
    else {
      dir.copy(this.fwd).projectOnPlane(n);
      if (dir.len() < 0.1) dir.set(1, 0, 0).projectOnPlane(n);
      dir.normalize();
    }
    if (this.airT < P.catchMinAir || into < P.catchMinSpeed) {
      this.vel.set(flow.x + vt.x, flow.y + vt.y, flow.z + vt.z);
      this.up.lerp(n, 0.5).normalize(n);
      this.fwd.projectOnPlane(this.up).normalize(dir);
      this.right.crossVectors(this.fwd, this.up);
      return true;
    }
    const res = this.judge(this.up, this.fwd, n, vt, into, this.setting);
    if (res.type === 'wipeout') {
      if (P.wipeoutThrough) { this._fallThrough(into, 'bad landing', res.q); return false; }
      return this._crash(n, flow, vr, vnr, 'crash', res.q);
    }
    let gain = 0, keep = 1;
    if (res.type === 'clean') { gain = into * P.cleanConv; this.stats.clean++; this.gauge = Math.min(1, this.gauge + P.catchFill); }
    else { gain = into * P.sketchyConv; keep = 0.85; this.sketchT = 0.6; this.stats.sketchy++; this.gauge = Math.min(1, this.gauge + P.catchFill * 0.3); }
    const before = vtl * keep;
    vt.scale(keep).addScaled(dir, gain);
    // A long fall caught cleanly keeps most of its speed, up to a point.
    const cap = Math.max(P.catchCap, before), vl = vt.len();
    if (vl > cap) { vt.scale(cap / vl); gain = Math.max(0, cap - before); }
    this.vel.set(flow.x + vt.x, flow.y + vt.y, flow.z + vt.z);
    this.up.copy(n);
    this.fwd.projectOnPlane(n).normalize(dir);
    this.right.crossVectors(this.fwd, this.up);
    this.events.push({ type: res.type, quality: res.q, gain, into, air: this.airT, trick: this._trickName(n, vt) });
    return true;
  }

  // A crash: you hit the surface and stay on it (no passing through), losing most of your
  // speed and control for a moment. Returns true (you are on the surface).
  _crash(n, flow, vr, vnr, reason, q = 0) {
    const P = this.P, into = -vnr;
    const vt = this._vt.copy(vr).addScaled(n, -vnr).scale(0.4);
    this.vel.set(flow.x + vt.x, flow.y + vt.y, flow.z + vt.z);
    const dir = this._dir.copy(vt);
    if (dir.len() < 1) dir.copy(this.fwd).projectOnPlane(n);
    if (dir.len() < 0.1) dir.set(1, 0, 0).projectOnPlane(n);
    this.up.copy(n); this.fwd.copy(dir).normalize(); this.right.crossVectors(this.fwd, this.up);
    this.wipeT = P.wipeoutTime; this.sketchT = 0.8; this.stats.wipeouts++;
    this.events.push({ type: 'wipeout', through: false, reason: 'crash', quality: q, gain: 0, into, air: this.airT });
    return true;
  }

  // Name the rotation done in the air (spins in 180s, flips), and whether it landed tail-first.
  _trickName(n, vt) {
    const spins = Math.round(this.airSpinTotal / Math.PI) * 180;
    const flips = Math.round(this.airFlipTotal / TAU);
    const parts = [];
    if (spins >= 180) parts.push(String(spins));
    if (flips >= 1) parts.push(flips === 1 ? 'flip' : `${flips}x flip`);
    if (vt.len() > 3 && this.fwd.dot(vt) < 0) parts.push('revert');
    return parts.join(' + ');
  }

  // A failed catch: the trapar does not hold you. You keep most of your momentum, lose
  // control for a moment and pass through to the air underneath.
  _fallThrough(into, reason, q = 0) {
    const P = this.P;
    this.throughT = P.throughTime; this.throughIn = false;
    this.wipeT = P.wipeoutTime;
    this.vel.x *= 0.8; this.vel.z *= 0.8;
    if (this.vel.y > -3) this.vel.y = -3;
    this.stats.wipeouts++;
    this.events.push({ type: 'wipeout', through: true, reason, quality: q, gain: 0, into, air: this.airT });
  }

  // Pure scoring, also used to color the landing marker before you land.
  judge(up, fwd, n, vt, into, setting) {
    const P = this.P;
    if (up.dot(n) < P.bottomMin) return { type: 'wipeout', q: 0, upScore: 0, headScore: 0 };
    const tol = (setting ? P.setTol : P.catchTol) * DEG;
    const cu = Math.cos(tol);
    const upScore = clamp((up.dot(n) - cu) / (1 - cu), 0, 1);
    let headScore = 1;
    const vtl = vt.len();
    if (vtl > 6) {
      const f = this._pq.copy(fwd).projectOnPlane(n);
      const fl = f.len();
      if (fl > 0.2) {
        const ch = Math.cos(P.headTol * DEG);
        headScore = clamp((Math.abs(f.dot(vt)) / (fl * vtl) - ch) / (1 - ch), 0, 1);
      } else headScore = 0;
    }
    const q = upScore * (0.55 + 0.45 * headScore);
    const sev = clamp(into / P.hardImpact, 0, 1);
    let type = q >= 0.55 + 0.25 * sev ? 'clean' : q < 0.12 + 0.3 * sev ? 'wipeout' : 'sketchy';
    if (type === 'wipeout' && into < P.wipeoutMinSpeed) type = 'sketchy';
    return { type, q, upScore, headScore };
  }

  // Look-ahead along the flight (gravity, air drag, top falling speed; no steering, no wind)
  // to the next ridable skin, up to 10 s.
  _predict() {
    const P = this.P, sky = this.sky, thr = P.rideThreshold;
    const p = this._pp.copy(this.pos), v = this._pv.copy(this.vel);
    let inside = sky.density(p.x, p.y, p.z) >= thr || this.throughT > 0;
    const dt = 0.05;
    for (let i = 1; i <= 200; i++) {
      const px = p.x, py = p.y, pz = p.z;
      const sp = Math.hypot(v.x, v.y, v.z), kd = P.airDrag * sp * dt;
      v.y -= this.gravityAt(v.y) * dt;
      v.x -= v.x * kd; v.y -= v.y * kd; v.z -= v.z * kd;
      p.addScaled(v, dt);
      if (p.y < P.floorAltitude) { this.predict = { hit: false, floor: true, point: p.clone(), t: i * dt }; return; }
      // An island in the way: its ground (you would step off there) or its rock.
      for (const I of this._isl || []) {
        if (!I.near(p.x, p.y, p.z, 0) || !I.inside(p.x, p.y, p.z)) continue;
        const g = I.ground(p.x, p.z), ga = I.ground(px, pz), top = g !== null && py >= (ga !== null ? ga : g) - 0.3;
        this.predict = { hit: true, ground: top, island: I, point: new V3(p.x, top ? g : p.y, p.z), normal: new V3(0, 1, 0), vel: v.clone(), t: i * dt, quality: { type: top ? 'clean' : 'wipeout', q: top ? 1 : 0 }, ridable: top };
        return;
      }
      const d = sky.density(p.x, p.y, p.z);
      if (!inside && d >= thr) {
        let lo = 0, hi = 1;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (sky.density(px + (p.x - px) * m, py + (p.y - py) * m, pz + (p.z - pz) * m) >= thr) hi = m; else lo = m;
        }
        const pt = new V3(px + (p.x - px) * hi, py + (p.y - py) * hi, pz + (p.z - pz) * hi);
        const gg = sky.gradient(pt.x, pt.y, pt.z, 0.6, new V3());
        const nn = gg.scale(-1).normalize(WORLD_UP);
        const into = -v.dot(nn);
        const vt = v.clone().addScaled(nn, -v.dot(nn));
        const F = sky.sample(pt.x - nn.x * 0.4, pt.y - nn.y * 0.4, pt.z - nn.z * 0.4, this.F2);
        const face = this.face, fa = this.faceAngle;
        const ridable = this._faceRule(F, nn);
        this.face = face; this.faceAngle = fa;
        const res = ridable ? this.judge(this.up, this.fwd, nn, vt, Math.max(0, into), this.setting) : { type: 'wipeout', q: 0, through: true };
        this.predict = { hit: true, point: pt, normal: nn, vel: v.clone(), t: i * dt, quality: res, ridable };
        return;
      }
      if (d < thr) inside = false;
    }
    this.predict = { hit: false, floor: false };
  }

  // --- Boost reach -------------------------------------------------------------------------

  // Can we reach a point dh meters up (negative = down) and d meters away horizontally
  // (direction ux, uz) with G seconds of (level) air boost? Simple kinematics, kept on the
  // cautious side to stand in for drag.
  _canReach(dh, d, ux, uz, G) {
    if (this.falling && this.state !== 'riding') return this._canReachFlying(dh, d, ux, uz, G);
    const P = this.P, A = P.airThrust * 0.8, gb = P.gravity, g = P.gravity * P.fallGravity;
    for (const u of [0]) {
      const vy = this.vel.y, vh = this.vel.x * ux + this.vel.z * uz;
      const ay = A * u - gb, ah = A * Math.sqrt(1 - u * u);
      const yAt = (t) => {
        if (t <= G) return vy * t + 0.5 * ay * t * t;
        const yG = vy * G + 0.5 * ay * G * G, vyG = vy + ay * G, s = t - G;
        return yG + vyG * s - 0.5 * g * s * s;
      };
      if (d < 40) {
        let ymax = 0;
        if (ay < 0 && vy > 0) ymax = Math.max(ymax, yAt(Math.min(G, -vy / ay)));
        const yG = yAt(G), vyG = vy + ay * G;
        ymax = Math.max(ymax, yG, vyG > 0 ? yG + (vyG * vyG) / (2 * g) : yG);
        if (dh < 0 || ymax >= dh + 3) return true;
        continue;
      }
      let td;
      const xG = vh * G + 0.5 * ah * G * G;
      if (d <= xG) td = (-vh + Math.sqrt(Math.max(0, vh * vh + 2 * ah * d))) / Math.max(ah, 1e-3);
      else {
        const vhG = vh + ah * G;
        if (vhG <= 0.5) continue;
        td = G + (d - xG) / vhG;
      }
      if (td > 30) continue;
      if (yAt(td) >= dh + 3) return true;
    }
    return false;
  }

  // In free fall: G seconds of flying straight at it (see _fallBoost), then falling. Simple
  // kinematics, cautious: the sink eases to the glide sink, the speed builds to the top speed
  // (drag and the turn toward it shave some off), and after the boost you coast with drag.
  _canReachFlying(dh, d, ux, uz, G) {
    const P = this.P, v = this.vel;
    if (d < 40) {
      // Below you: flying you can circle down onto it; falling, only if you do not drift off.
      if (dh >= 0) return false;
      if (G > 0) return true;
      const g = P.gravity * P.fallGravity, vt = P.terminalSpeed, vy = Math.max(-vt, v.y);
      const tf = vy > -vt + 1 ? Math.min((vt + vy) / g, (vy + Math.sqrt(vy * vy - 2 * g * dh)) / g) : 0;
      const yf = vy * tf - 0.5 * g * tf * tf, tFall = tf + Math.max(0, (yf - dh) / vt);
      return Math.hypot(v.x, v.z) * tFall < 25;
    }
    const toward = Math.max(0, v.x * ux + v.z * uz);
    const vh0 = G > 0 ? Math.max(toward, 0.75 * Math.hypot(v.x, v.z)) : toward;
    const A = Math.max(0.1, P.fallThrust * 0.65), top = Math.max(P.fallBoostTop * 0.95, vh0);
    const s = P.fallSink, kf = 1.1, vy0 = v.y;
    const tc = (top - vh0) / A;
    const xB = (t) => (t <= tc ? vh0 * t + 0.5 * A * t * t : vh0 * tc + 0.5 * A * tc * tc + top * (t - tc));
    const yB = (t) => -s * t + ((vy0 + s) * (1 - Math.exp(-kf * t))) / kf;
    let t, y;
    const xG = G > 0 ? xB(G) : 0;
    if (G > 0 && d <= xG) {
      // Reached while flying.
      if (d <= xB(tc)) t = (-vh0 + Math.sqrt(vh0 * vh0 + 2 * A * d)) / A;
      else t = tc + (d - xB(tc)) / top;
      y = yB(t);
    } else {
      // Coasting the rest of the way (quadratic drag), falling.
      const vG = G > 0 ? Math.min(top, vh0 + A * G) : vh0, kd = Math.max(1e-5, P.airDrag);
      if (vG < 0.5) return false;
      const sC = (Math.exp(kd * (d - xG)) - 1) / (kd * vG);
      if (!(sC < 25)) return false;
      const yG = G > 0 ? yB(G) : 0, vyG = G > 0 ? -s + (vy0 + s) * Math.exp(-kf * G) : vy0;
      const g = P.gravity * P.fallGravity, vt = P.terminalSpeed;
      const s1 = vyG > -vt ? (vyG + vt) / g : 0;   // until the top falling speed
      y = sC <= s1 ? yG + vyG * sC - 0.5 * g * sC * sC : yG + vyG * s1 - 0.5 * g * s1 * s1 - vt * (sC - s1);
      t = G + sC;
    }
    return t < 30 && y >= dh + 3;
  }

  // Fraction of a full gauge needed (0 = reachable without boosting), or Infinity.
  _boostNeed(dh, d, ux, uz) {
    // (seconds of boost a full gauge gives: longer flying in free fall)
    const flying = this.falling && this.state !== 'riding';
    const cap = Math.max(0.1, this.P.boostCapacity) / (flying ? Math.max(0.05, this.P.fallDrain) : 1);
    const avail = this.P.boostInfinite ? cap : this.gauge * cap;
    if (this._canReach(dh, d, ux, uz, 0)) return 0;
    if (!this._canReach(dh, d, ux, uz, avail)) return this._canReach(dh, d, ux, uz, cap) ? 1.01 : Infinity;
    let lo = 0, hi = avail;
    for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (this._canReach(dh, d, ux, uz, m)) hi = m; else lo = m; }
    return hi / cap;
  }

  _scanColumn() {
    const P = this.P, sky = this.sky;
    const i = this._scanI; this._scanI = (i + 1) % SCAN_COLUMNS.length;
    const [dist, ang] = SCAN_COLUMNS[i];
    const c = this._scan[i];
    c.x = this.pos.x + Math.cos(ang) * dist; c.z = this.pos.z + Math.sin(ang) * dist;
    c.skins = sky.findSkins(c.x, c.z, P.rideThreshold * 1.02, 5).filter((y) => y > P.floorAltitude + 30);
    if (i % 4 === 0) this._chooseTarget();
  }

  // How good a boost target is (lower is better).
  _targetScore(landing, dh, d, need) {
    if (landing) return dh + 0.25 * d + 80 * need;
    // (in free fall, keeping height is worth some boost)
    if (this.falling) return need * 100 + d * 0.3 + Math.max(0, -dh) * 0.35;
    return need * 300 + d * 0.4 + Math.max(0, dh) * 0.2;
  }

  _chooseTarget() {
    const P = this.P, p = this.pos;
    const onSurface = this.state === 'riding';
    // (in free fall a landing far below still leaves you looking for somewhere to fly to)
    const pr = this.predict;
    const landing = onSurface || (pr && pr.hit && pr.ridable && (!this.falling || pr.t < 2.5));
    let best = null, bestScore = Infinity;
    const minClimb = Math.max(40, 0.45 * this.sky.layerSpacing());
    for (const c of this._scan) {
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      const ux = d > 1 ? dx / d : 0, uz = d > 1 ? dz / d : 0;
      for (const y of c.skins) {
        const dh = y - p.y;
        if (landing && dh < minClimb) continue;
        if (!landing && Math.abs(dh) < 3 && d < 30) continue;
        const need = this._boostNeed(dh, d, ux, uz);
        if (need > 1) continue;
        const usable = P.boostInfinite || need <= this.gauge + 1e-3;
        if (!usable) continue;
        const score = this._targetScore(landing, dh, d, need);
        if (score < bestScore) { bestScore = score; best = { x: c.x, y, z: c.z, dh, d, need, kind: landing ? 'climb' : 'rescue' }; }
      }
    }
    // Keep the target we had while it is still reachable and nearly as good (the scan columns
    // move with you, so the best spot found jumps around).
    const old = this.boostTarget;
    if (old && old.kind === (landing ? 'climb' : 'rescue') && this.sky.density(old.x, old.y - 1.5, old.z) >= P.rideThreshold) {
      const dx = old.x - p.x, dz = old.z - p.z, d = Math.hypot(dx, dz), dh = old.y - p.y;
      const need = this._boostNeed(dh, d, d > 1 ? dx / d : 0, d > 1 ? dz / d : 0);
      if (need <= 1 && (P.boostInfinite || need <= this.gauge + 1e-3) && !(landing && dh < minClimb)
        && this._targetScore(landing, dh, d, need) <= bestScore + 40) {
        old.d = d; old.dh = dh; old.need = need;
        best = old;
      }
    }
    if (best && best !== old) {
      // Aim at the middle of the stream found there (its floor), not wherever its skin was hit.
      const q = this.sky.braids.nearestAxis(best.x, best.y - 1, best.z, this._axQ || (this._axQ = {}));
      if (q && q.cls !== CORD && q.uy > 0.7 && Math.abs(q.lat) < q.w && this.sky.density(q.px, q.py - 1.5, q.pz) >= P.rideThreshold) {
        const top = this._cross(q.px, q.py - 1.5, q.pz, 0, 1, 0, 8);
        if (top !== null) {
          best.x = q.px; best.z = q.pz; best.y = q.py - 1.5 + top;
          best.dh = best.y - p.y; best.d = Math.hypot(best.x - p.x, best.z - p.z);
        }
      }
      const g = this.sky.gradient(best.x, best.y - 1, best.z, 0.6, new V3());
      best.n = g.len() > 1e-5 ? g.scale(-1 / g.len()) : new V3(0, 1, 0);
    }
    this.boostTarget = best;
    this.reachNone = !landing && !best;
  }
}
