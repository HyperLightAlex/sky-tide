// Ride into a stream wall at speed/angle: ride up it, or pass through it?
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
function run(kind, skip, brace, speed, angDeg) {
  const P = defaultParams(); const world = new SkyWorld(bank, P); const st = { t: 600 }; world.update(600, { x: 0, z: 0 });
  const r = new Rider(world, P); const B = world.trapar.braids; const seg = B.seg, FF = 24;
  let found = 0, q = -1;
  for (let s = 2; s < B.nSeg - 2; s++) {
    const o = s * FF; if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue;
    const isPipe = seg[o + 23] > 0.97, plain = seg[o + 23] < 0.01 && seg[o + 22] < 0.01 && seg[o + 9] > 0.95 && seg[o + 19] < 0.05;
    const ok = (kind === 'pipe' ? isPipe : plain) && seg[o + 16] > 0.95;
    const nb = (k) => { const oo = k * FF; return kind === 'pipe' ? seg[oo + 23] > 0.97 : seg[oo + 23] < 0.01 && seg[oo + 9] > 0.9; };
    if (ok && nb(s - 1) && nb(s + 1) && nb(s + 2)) { if (found++ === skip) { q = s; break; } s += 25; }
  }
  if (q < 0) return null;
  const o = q * FF, L = Math.floor(seg[o + 3] / 1000), sh = B.S.uBrShift;
  const p0 = new V3(seg[o] + sh[L * 3], seg[o + 1], seg[o + 2] + sh[L * 3 + 2]);
  const e = new V3(seg[o + 4] - seg[o], seg[o + 5] - seg[o + 1], seg[o + 6] - seg[o + 2]).normalize();
  e.scale(seg[o + 18] >= 0 ? 1 : -1);
  const U = new V3(seg[o + 8], seg[o + 9], seg[o + 10]); const right = new V3().crossVectors(e, U).normalize();
  const a = angDeg * Math.PI / 180;
  const dir = e.clone().scale(Math.cos(a)).addScaled(right, Math.sin(a)).normalize();
  r.pos.copy(p0).addScaled(U, 0.3);
  r.up.copy(U); r.normal.copy(U); r.fwd.copy(dir).projectOnPlane(U).normalize(); r.right.crossVectors(r.fwd, r.up);
  r.vel.set(dir.x * speed, dir.y * speed, dir.z * speed);
  r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(speed); r.attachT = 0.35;
  const I = { lean: 0, trim: 0, snap: 0, brace, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
  let minNy = 1, through = false, maxV = -1e9, firstOff = null, q2 = {};
  const w0 = seg[o + 3] - L * 1000;
  for (let i = 0; i < 120 * 2.5; i++) {
    st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
    const ax = B.nearestAxis(r.pos.x, r.pos.y, r.pos.z, q2);
    if (r.state === 'riding') minNy = Math.min(minNy, r.normal.y);
    else if (firstOff === null) firstOff = { t: i * dt, lat: ax ? ax.lat : NaN, v: ax ? ax.v : NaN, ny: r.normal.y };
    if (ax) { maxV = Math.max(maxV, ax.v); if (Math.abs(ax.lat) > ax.w + 4 && ax.v < 8) through = true; }
    if (r.fallen) break;
  }
  return { w: w0, wf: seg[o + 20], kap: seg[o + 11], minNy, through, maxV, firstOff, end: r.state };
}
for (const kind of (process.env.K||'plain,pipe').split(',')) for (const speed of (process.env.S||'20,30,45').split(',').map(Number)) for (const ang of (process.env.A||'30,55').split(',').map(Number)) for (const brace of [0, 1]) {
  let thr = 0, n = 0, rode = 0;
  for (const skip of [0, 1, 2]) {
    const res = run(kind, skip, brace, speed, ang); if (!res) continue; n++;
    if (res.through) thr++; if (res.minNy < 0.6) rode++;
    if (process.env.V) console.log('  ', kind, skip, JSON.stringify(res));
  }
  console.log(`${kind.padEnd(5)} ${speed} m/s at ${ang} deg, brace ${brace}: through the wall ${thr}/${n}, rode up past 53 deg ${rode}/${n}`);
}
