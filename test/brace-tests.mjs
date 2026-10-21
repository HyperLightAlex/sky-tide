// Brace, boost-on-stream, pipe lip, braced landings, tricks, spirals.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
const only = process.env.ONLY || '';
function setup(t0 = 600, over = {}) {
  const P = defaultParams(); Object.assign(P, over);
  const world = new SkyWorld(bank, P); const st = { t: t0 };
  world.update(st.t, { x: 0, z: 0 });
  return { P, world, r: new Rider(world, P), st };
}
const inp = () => ({ lean: 0, trim: 0, snap: 0, brace: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false });
const step = (S, I) => { S.st.t += dt; S.world.update(S.st.t, S.r.pos); S.r.step(dt, I); };
function bot(S, I, sp = 1) {
  const r = S.r, T = S.world.trapar, p = r.pos, R = r.right, u = r.up;
  const F = T.sample(p.x - u.x * 1.5, p.y - u.y * 1.5, p.z - u.z * 1.5, {});
  let headErr = 0;
  if (F.stream > 0.3) {
    let fx = F.flowDir.x, fy = F.flowDir.y, fz = F.flowDir.z;
    const d = fx * u.x + fy * u.y + fz * u.z; fx -= u.x * d; fy -= u.y * d; fz -= u.z * d;
    const cx = r.fwd.y * fz - r.fwd.z * fy, cy = r.fwd.z * fx - r.fwd.x * fz, cz = r.fwd.x * fy - r.fwd.y * fx;
    headErr = -(cx * u.x + cy * u.y + cz * u.z);
  }
  const dl = T.density(p.x - R.x * 14 - u.x * 2, p.y - R.y * 14 - u.y * 2, p.z - R.z * 14 - u.z * 2);
  const dr = T.density(p.x + R.x * 14 - u.x * 2, p.y + R.y * 14 - u.y * 2, p.z + R.z * 14 - u.z * 2);
  const lat = (dr - dl) / Math.max(0.2, dl + dr);
  I.lean = Math.max(-1, Math.min(1, (headErr * 2.5 + lat * 1.2) * sp));
  return F;
}
const starts = [[0, 0], [2000, 1000], [-3000, 2500], [5000, -4000], [-6000, -6000], [8000, 3000]];

if (!only || only.includes('boost')) {
  // Boost while following a stream: does it throw you off? (unbraced vs braced)
  for (const brace of [0, 1]) {
    let ride = 0, total = 0, offs = 0, maxSp = 0, maxAir = 0;
    for (const [sx, sz] of starts) {
      const S = setup(600 + sx * 0.003); const { r, world } = S; S.P.boostInfinite = true;
      r.respawn(sx, sz, world.trapar.refAltitude());
      const I = inp(); let was = 'riding';
      for (let i = 0; i < 120 * 12; i++) {
        bot(S, I); I.boost = i > 60; I.boostPressed = i === 61; I.brace = brace; step(S, I);
        if (r.state === 'riding') ride += dt; total += dt;
        if (was === 'riding' && r.state !== 'riding') offs++;
        was = r.state; if (r.state === 'riding') maxSp = Math.max(maxSp, r.vel.len()); else maxAir = Math.max(maxAir, r.vel.len());
        if (r.fallen) break;
      }
    }
    console.log(`boost on stream, brace ${brace}: riding ${(ride / total * 100).toFixed(0)}% of the time, left the surface ${offs} times, top riding speed ${maxSp.toFixed(0)} m/s, top air speed ${maxAir.toFixed(0)}`);
  }
}

// Find a section of a given feature near the focus; returns start pose upstream on the same strand.
function findFeature(B, test, back = 6, skip = 0) {
  const seg = B.seg, F = 24; let found = 0;
  for (let s = 8; s < B.nSeg - 8; s++) {
    const o = s * F;
    if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue;
    if (seg[o + 16] < 0.95 || !test(seg, o)) continue;
    const dir = seg[o + 18] >= 0 ? -1 : 1;
    let k = s, steps = 0;
    while (steps < back) {
      const kk = k + dir, ok = kk * F, ko = k * F;
      const shares = dir < 0 ? (Math.abs(seg[ok + 4] - seg[ko]) < 0.01 && Math.abs(seg[ok + 6] - seg[ko + 2]) < 0.01) : (Math.abs(seg[ok] - seg[ko + 4]) < 0.01 && Math.abs(seg[ok + 2] - seg[ko + 6]) < 0.01);
      if (!shares) break; k = kk; steps++;
    }
    if (steps < back) continue;
    if (found++ < skip) { s += 30; continue; }
    const q = k * F, L = Math.floor(seg[q + 3] / 1000), sh = B.S.uBrShift;
    let ex = seg[q + 4] - seg[q], ey = seg[q + 5] - seg[q + 1], ez = seg[q + 6] - seg[q + 2]; const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    if (dir > 0) { ex = -ex; ey = -ey; ez = -ez; }
    return { px: seg[q] + sh[L * 3], py: seg[q + 1], pz: seg[q + 2] + sh[L * 3 + 2], u: [seg[q + 8], seg[q + 9], seg[q + 10]], e: [ex, ey, ez], flow: Math.abs(seg[o + 18]), uf: seg[o + 9] };
  }
  return null;
}
function place(r, ft, speed, side = 0) {
  r.pos.set(ft.px - ft.u[0] * 1.5, ft.py - ft.u[1] * 1.5, ft.pz - ft.u[2] * 1.5);
  r.up.set(...ft.u); r.normal.copy(r.up);
  const e = new V3(...ft.e); const right = new V3().crossVectors(e, r.up).normalize();
  const dir = e.clone().scale(Math.cos(side)).addScaled(right, Math.sin(side)).normalize();
  r.fwd.copy(dir).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.set(dir.x * speed, dir.y * speed, dir.z * speed); r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(speed); r.attachT = 0.35;
}

if (!only || only.includes('pipe')) {
  // Pipe: start on the floor angled toward a wall; go up it, off the lip, and come back?
  for (const skip of [0, 1, 2]) for (const brace of [0, 1]) {
    const S = setup(); const { r, world } = S; const B = world.trapar.braids;
    const ft = findFeature(B, (sg, o) => sg[o + 23] > 0.9, 3, skip);
    if (!ft) { console.log('no pipe #' + skip); break; }
    place(r, ft, 30, 0.75);
    const I = inp(); let left = false, airT = 0, back = false, maxAbove = 0, y0 = r.pos.y, endFeat = '';
    let leftState = '', landedAfter = null;
    for (let i = 0; i < 120 * 9; i++) {
      I.brace = brace; I.lean = 0; step(S, I);
      const F = world.trapar.sample(r.pos.x, r.pos.y - 1, r.pos.z, {});
      if (r.state !== 'riding') { if (!left && i > 5) { left = true; } if (left) airT += dt; maxAbove = Math.max(maxAbove, r.pos.y - y0); }
      else if (left && !back) { back = true; landedAfter = airT; endFeat = F.feature; }
      if (r.fallen) break;
    }
    console.log(`pipe #${skip} brace ${brace}: ${left ? `left at the lip, air ${airT.toFixed(1)} s, peak +${maxAbove.toFixed(0)} m, ${back ? `came back down onto the stream (${endFeat})` : 'did NOT come back'}` : 'never left the surface'}; end ${r.state}`);
  }
}

if (!only || only.includes('land')) {
  // Braced air: drop onto a stream with the board badly oriented.
  for (const [label, up] of [['tilted 100 deg', [1, -0.17, 0]], ['upside down', [0.05, -1, 0]], ['tilted 60 deg', [0.87, 0.5, 0]]]) for (const brace of [0, 1]) {
    const S = setup(); const { r, world, P } = S; P.autoLevel = 0;
    r.respawn(0, 0, world.trapar.refAltitude());
    const y0 = r.pos.y;
    r.pos.y += 35; r.vel.set(r.vel.x * 0.5, -4, r.vel.z * 0.5); r.state = 'freefall'; r.airT = 1; r.attachT = 0;
    r.up.set(...up).normalize(); r.fwd.set(0, 0, 1).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up);
    const I = inp(); const ev = [];
    for (let i = 0; i < 120 * 4; i++) { I.brace = brace; step(S, I); for (const e of r.events.splice(0)) ev.push(e.type + (e.through ? '(through)' : '')); if (r.state === 'riding' && r.rideT > 0.3) break; }
    console.log(`landing ${label}, brace ${brace}: [${ev.join(', ')}] -> ${r.state}`);
  }
}

if (!only || only.includes('trick')) {
  // Pop off a stream, spin, release, land. Braced vs not.
  for (const [label, spinT] of [['180', 0.4], ['360', 0.75], ['half-done 270', 0.6], ['flip', -1]]) for (const brace of [0, 1]) {
    const S = setup(); const { r, world, P } = S;
    r.respawn(0, 0, world.trapar.refAltitude());
    const I = inp(); const ev = []; let popped = false;
    for (let i = 0; i < 120 * 6; i++) {
      const t = i * dt;
      I.brace = brace;
      I.crouch = t < 0.5; I.crouchReleased = t >= 0.5 && t < 0.5 + dt;
      if (spinT > 0) I.lean = t > 0.6 && t < 0.6 + spinT * (P.airSpin > 0 ? 4.5 / P.airSpin : 1) ? 1 : 0;
      else I.trim = t > 0.6 && t < 0.6 + (Math.PI * 2) / P.airFlip ? 1 : 0;
      step(S, I);
      for (const e of r.events.splice(0)) ev.push(e.type + (e.trick ? `[${e.trick}]` : '') + (e.through ? '(through)' : ''));
      if (t > 1 && r.state === 'riding' && r.rideT > 0.6) break;
    }
    console.log(`trick ${label}, brace ${brace}: [${ev.join(', ')}] -> ${r.state}, nose vs travel ${(Math.acos(Math.max(-1, Math.min(1, r.fwd.dot(new V3(r.vel.x - r.dbg.flow.x, r.vel.y - r.dbg.flow.y, r.vel.z - r.dbg.flow.z).normalize())))) * 57.3).toFixed(0)} deg`);
  }
}

if (!only || only.includes('spiral')) {
  for (const skip of [0, 1, 2]) for (const brace of [0, 1]) {
    const S = setup(); const { r, world } = S; const B = world.trapar.braids;
    const ft = findFeature(B, (sg, o) => sg[o + 22] > 0.9, 4, skip);
    if (!ft) { console.log('no spiral #' + skip); break; }
    place(r, ft, 30);
    const I = inp(); let spT = 0, minUy = 1, peel = false, ride = 0;
    for (let i = 0; i < 120 * 20; i++) {
      const F = bot(S, I, 0.7); I.brace = brace; step(S, I);
      if (r.state === 'riding') { ride += dt; if (F.feature === 'spiral') spT += dt; minUy = Math.min(minUy, r.normal.y); }
      else if (spT > 0.5 && !peel && ride > 0) peel = spT;
      if (r.fallen) break;
    }
    console.log(`spiral #${skip} brace ${brace}: rode ${ride.toFixed(1)} s, ${spT.toFixed(1)} s on the spiral, steepest normal.y ${minUy.toFixed(2)}${peel ? `, left the stream after ${(+peel).toFixed(1)} s on the spiral` : ''}`);
  }
}

if (!only || only.includes('cutback')) {
  for (const brace of [0, 1]) {
    const S = setup(); const { r, world } = S;
    r.respawn(0, 0, world.trapar.refAltitude());
    const I = inp();
    for (let i = 0; i < 60; i++) step(S, I);
    const fl = r.dbg.flow, f = r.fwd; r.vel.set(fl.x + f.x * 25, fl.y + f.y * 25, fl.z + f.z * 25);
    const v0 = new V3(r.vel.x - fl.x, 0, r.vel.z - fl.z).normalize(); let off = false, maxSlip = 0;
    for (let i = 0; i < 84; i++) { Object.assign(I, { lean: 1, snap: 1, brace }); step(S, I); maxSlip = Math.max(maxSlip, r.slip); if (r.state !== 'riding') off = true; }
    Object.assign(I, { lean: 0, snap: 0 });
    for (let i = 0; i < 36; i++) { step(S, I); if (r.state !== 'riding') off = true; }
    const fl2 = r.dbg.flow; const v1 = new V3(r.vel.x - fl2.x, 0, r.vel.z - fl2.z); const s1 = v1.len(); v1.normalize();
    console.log(`snap ${brace ? '+ brace (cutback)' : 'unbraced'}: turned ${(Math.acos(Math.max(-1, Math.min(1, v0.x * v1.x + v0.z * v1.z))) * 57.3).toFixed(0)} deg, speed 25 -> ${s1.toFixed(1)}, max slip ${(maxSlip * 57.3).toFixed(0)} deg, ${off ? 'LEFT the surface' : 'stayed on'}`);
  }
}
