// Braid tests: follow streams, steering styles, fall-through, corkscrew/barrel hold.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams, STAGES } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
const only = process.env.ONLY || '';
function setup(t0 = 600, over = {}) {
  const P = defaultParams(); Object.assign(P, over);
  const world = new SkyWorld(bank, P);
  const st = { t: t0 };
  world.update(st.t, { x: 0, z: 0 });
  return { P, world, r: new Rider(world, P), st };
}
const inp = () => ({ lean: 0, trim: 0, snap: 0, brace: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false });
const step = (S, I) => { S.st.t += dt; S.world.update(S.st.t, S.r.pos); S.r.step(dt, I); };
// steering bot: follow the flow direction, stay centered
function bot(S, I, sp = 1) {
  const r = S.r, T = S.world.trapar, p = r.pos, R = r.right, u = r.up;
  const F = T.sample(p.x - u.x * 1.5, p.y - u.y * 1.5, p.z - u.z * 1.5, {});
  let headErr = 0;
  if (F.stream > 0.3) {
    let fx = F.flowDir.x, fy = F.flowDir.y, fz = F.flowDir.z;
    // project into the board plane
    const d = fx * u.x + fy * u.y + fz * u.z; fx -= u.x * d; fy -= u.y * d; fz -= u.z * d;
    // signed angle from fwd to flow about up: (fwd x flow) . up  -> positive = flow to the left?
    const cx = r.fwd.y * fz - r.fwd.z * fy, cy = r.fwd.z * fx - r.fwd.x * fz, cz = r.fwd.x * fy - r.fwd.y * fx;
    const s = cx * u.x + cy * u.y + cz * u.z; // >0 : flow is counterclockwise (left) of fwd
    headErr = -s;  // lean right (+) when the flow is to the right
  }
  const dl = T.density(p.x - R.x * 14 - u.x * 2, p.y - R.y * 14 - u.y * 2, p.z - R.z * 14 - u.z * 2);
  const dr = T.density(p.x + R.x * 14 - u.x * 2, p.y + R.y * 14 - u.y * 2, p.z + R.z * 14 - u.z * 2);
  const lat = (dr - dl) / Math.max(0.2, dl + dr);
  I.lean = Math.max(-1, Math.min(1, (headErr * 2.5 + lat * 1.2) * sp));
  I.trim = -0.4; // tuck a little
  return F;
}

if (!only || only.includes('follow')) {
  const rows = [];
  for (const [sx, sz] of [[0, 0], [2000, 1000], [-3000, 2500], [5000, -4000], [-6000, -6000], [8000, 3000]]) {
    const S = setup(600 + sx * 0.003); const { r, world } = S;
    r.respawn(sx, sz, world.trapar.refAltitude());
    const I = inp(); let ride = 0, firstOff = null, sp = 0, n = 0; const ev = {}, feats = {};
    let maxTilt = 0;
    for (let i = 0; i < 120 * 90; i++) {
      const F = bot(S, I); step(S, I);
      for (const e of r.events.splice(0)) ev[e.type] = (ev[e.type] || 0) + 1;
      if (r.state === 'riding') { ride += dt; sp += r.vel.len(); n++; feats[F.feature] = (feats[F.feature] || 0) + dt; maxTilt = Math.max(maxTilt, Math.acos(Math.max(-1, Math.min(1, r.normal.y)))); }
      else if (firstOff === null && i > 60) firstOff = i * dt;
      if (r.fallen) break;
      if (!r.pos.isFinite()) { ev.NaN = 1; break; }
    }
    rows.push(`(${sx},${sz}) riding ${ride.toFixed(0)}/90 s, first off ${firstOff === null ? 'never' : firstOff.toFixed(1) + 's'}, speed ${(sp / Math.max(1, n)).toFixed(1)}, max tilt ${(maxTilt * 57.3).toFixed(0)} deg, feats ${JSON.stringify(Object.fromEntries(Object.entries(feats).map(([k, v]) => [k, +v.toFixed(1)])))} ev ${JSON.stringify(ev)}`);
  }
  console.log('1) follow streams\n   ' + rows.join('\n   '));
}

if (!only || only.includes('steer')) {
  // 2) Steering styles at 25 m/s on a flat stream section: hold full lean for 0.7 s.
  for (const [label, mod] of [['draw', {}], ['snap (LT)', { snap: 1 }], ['braced (RT)', { brace: 1 }], ['tail (stick back)', { trim: 1 }]]) {
    const S = setup(); const { r, world } = S;
    r.respawn(0, 0, world.trapar.refAltitude());
    // settle and bring to ~25 m/s relative along the board
    const I = inp();
    for (let i = 0; i < 60; i++) step(S, I);
    const fl = r.dbg.flow; const f = r.fwd;
    r.vel.set(fl.x + f.x * 25, fl.y + f.y * 25, fl.z + f.z * 25);
    const v0 = new V3(r.vel.x - fl.x, 0, r.vel.z - fl.z); const s0 = v0.len(); v0.normalize();
    const h0 = Math.atan2(r.fwd.z, r.fwd.x);
    let maxSlip = 0;
    for (let i = 0; i < 84; i++) { Object.assign(I, { lean: 1, ...mod }); step(S, I); maxSlip = Math.max(maxSlip, r.slip); }
    Object.assign(I, { lean: 0, snap: 0, brace: 0, trim: 0 });
    for (let i = 0; i < 36; i++) step(S, I);
    const fl2 = r.dbg.flow; const v1 = new V3(r.vel.x - fl2.x, 0, r.vel.z - fl2.z); const s1 = v1.len(); v1.normalize();
    const turned = Math.acos(Math.max(-1, Math.min(1, v0.x * v1.x + v0.z * v1.z))) * 57.3;
    let nose = (Math.atan2(r.fwd.z, r.fwd.x) - h0) * 57.3; nose = ((nose + 540) % 360) - 180;
    console.log(`2) ${label.padEnd(18)} travel turned ${turned.toFixed(0).padStart(4)} deg, nose ${Math.abs(nose).toFixed(0).padStart(4)} deg, speed ${s0.toFixed(1)} -> ${s1.toFixed(1)} m/s, max slip ${(maxSlip * 57.3).toFixed(0)} deg, state ${r.state}`);
  }
}

if (!only || only.includes('through')) {
  for (const mode of ['upright', 'upside down', 'bad angle fast', 'boost up from below']) {
    const S = setup(); const { r, world, P } = S; P.autoLevel = 0;
    r.respawn(0, 0, world.trapar.refAltitude());
    const y0 = r.pos.y, x0 = r.pos.x, z0 = r.pos.z;
    if (mode === 'boost up from below') { r.pos.set(x0, y0 - 40, z0); r.vel.set(0, 22, 0); }
    else { r.pos.set(x0, y0 + (mode === 'bad angle fast' ? 60 : 20), z0); r.vel.set(0, mode === 'bad angle fast' ? -25 : -8, 0); }
    r.state = 'freefall'; r.airT = 1;
    if (mode === 'upside down') { r.up.set(0, -1, 0); r.right.crossVectors(r.fwd, r.up); }
    if (mode === 'bad angle fast') { r.up.set(1, 0.25, 0).normalize(); r.fwd.set(0, 0, 1).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up); }
    const I = inp(); const ev = []; let caught = false, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < 120 * 5; i++) {
      step(S, I);
      for (const e of r.events.splice(0)) ev.push(e.type + (e.through ? '(through)' : ''));
      if (r.state === 'riding' && r.rideT > 0.3) caught = true;
      minY = Math.min(minY, r.pos.y); maxY = Math.max(maxY, r.pos.y);
    }
    console.log(`3) ${mode}: surface ${y0.toFixed(0)}, events [${ev.join(', ')}], caught ${caught}, y range ${minY.toFixed(0)}..${maxY.toFixed(0)}`);
  }
}

// Locate features in the snapshot near the focus: a corkscrew (ribbon up pointing down) or a
// barrel (strong curl). Returns a start point ~6-10 segments upstream on the same strand.
function findFeature(B, kind, skip = 0) {
  const seg = B.seg; let found = 0;
  for (let s = 8; s < B.nSeg - 8; s++) {
    const o = s * 20;
    if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2000) continue;
    const inv = seg[o + 9] < -0.6, curl = seg[o + 11] * (seg[o + 3] % 1000) > 2.2;
    if (seg[o + 16] < 0.95) continue;
    if (!(kind === 'twist' ? inv : curl)) continue;
    const dir = seg[o + 18] >= 0 ? -1 : 1;
    let k = s, steps = 0;
    while (steps < 9) {
      const kk = k + dir, ok = kk * 20, ko = k * 20;
      const shares = dir < 0 ? (Math.abs(seg[ok + 4] - seg[ko]) < 0.01 && Math.abs(seg[ok + 6] - seg[ko + 2]) < 0.01) : (Math.abs(seg[ok] - seg[ko + 4]) < 0.01 && Math.abs(seg[ok + 2] - seg[ko + 6]) < 0.01);
      if (!shares) break;
      k = kk; steps++;
    }
    if (steps < 6) continue;
    const q = k * 20;
    if (seg[q + 9] < 0.85 || seg[q + 16] < 0.95) continue;
    if (found++ < skip) { s += 20; continue; }
    const L = Math.floor(seg[q + 3] / 1000), sh = B.S.uBrShift;
    let ex = seg[q + 4] - seg[q], ey = seg[q + 5] - seg[q + 1], ez = seg[q + 6] - seg[q + 2]; const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    if (dir > 0) { ex = -ex; ey = -ey; ez = -ez; }
    return { px: seg[q] + sh[L * 3], py: seg[q + 1], pz: seg[q + 2] + sh[L * 3 + 2], u: [seg[q + 8], seg[q + 9], seg[q + 10]], e: [ex, ey, ez], flow: Math.abs(seg[o + 18]) };
  }
  return null;
}
if (!only || only.includes('hold')) {
  for (const kind of ['twist', 'barrel']) for (const skip of [0, 1, 2]) for (const speed of [14, 34]) {
    const S = setup(); const { r, world } = S; const B = world.trapar.braids;
    const ft = findFeature(B, kind, skip);
    if (!ft) { console.log(`4) no ${kind} #${skip} found`); break; }
    r.pos.set(ft.px + ft.u[0] * 0.5, ft.py + ft.u[1] * 0.5, ft.pz + ft.u[2] * 0.5);
    r.up.set(...ft.u); r.normal.copy(r.up);
    r.fwd.set(...ft.e).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up);
    r.vel.set(ft.e[0] * speed, ft.e[1] * speed, ft.e[2] * speed); r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(speed);
    const I = inp(); let minUy = 1, peeled = false, rideT = 0, minMargin = 99, featT = 0, endState = '';
    for (let i = 0; i < 120 * 14; i++) {
      const F = bot(S, I, 0.6); I.trim = 0; step(S, I);
      if (r.state === 'riding') { rideT += dt; if (r.normal.y < minUy) { minUy = r.normal.y; r._atMin = { hold: r.hold, v: r.vel.len(), va: F.flowDir ? r.vel.x * F.flowDir.x + r.vel.y * F.flowDir.y + r.vel.z * F.flowDir.z : 0 }; } if (F.feature === kind) featT += dt; if (r.holdNeed > 1) minMargin = Math.min(minMargin, r.holdMargin); }
      else if (minUy < 0.2 && !peeled) peeled = true;
      if (r.fallen) break;
    }
    console.log(`4) ${kind} #${skip} start ${speed} m/s (flow ${ft.flow.toFixed(0)}): rode ${rideT.toFixed(1)} s, in ${kind} ${featT.toFixed(1)} s, lowest normal.y ${minUy.toFixed(2)}, ${peeled ? 'PEELED' : 'held'}, min hold margin ${minMargin === 99 ? '-' : minMargin.toFixed(1)}${r._atMin ? `, at deepest: hold ${r._atMin.hold.toFixed(2)} speed ${r._atMin.v.toFixed(0)} along flow ${r._atMin.va.toFixed(0)}` : ''}`);
  }
}
