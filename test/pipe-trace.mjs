import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
const skip = +(process.env.SKIP || 2), brace = +(process.env.BRACE ?? 1);
const P = defaultParams(); const world = new SkyWorld(bank, P); const st = { t: 600 }; world.update(600, { x: 0, z: 0 });
const r = new Rider(world, P); const B = world.trapar.braids;
// same finder as brace-tests
const seg = B.seg, FF = 24; let found = 0, ft = null;
for (let s = 8; s < B.nSeg - 8 && !ft; s++) {
  const o = s * FF; if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue;
  if (seg[o + 16] < 0.95 || !(seg[o + 23] > 0.9)) continue;
  const dir = seg[o + 18] >= 0 ? -1 : 1; let k = s, steps = 0;
  while (steps < 3) { const kk = k + dir, ok = kk * FF, ko = k * FF; const shares = dir < 0 ? (Math.abs(seg[ok + 4] - seg[ko]) < 0.01 && Math.abs(seg[ok + 6] - seg[ko + 2]) < 0.01) : (Math.abs(seg[ok] - seg[ko + 4]) < 0.01 && Math.abs(seg[ok + 2] - seg[ko + 6]) < 0.01); if (!shares) break; k = kk; steps++; }
  if (steps < 3) continue; if (found++ < skip) { s += 30; continue; }
  const q = k * FF, L = Math.floor(seg[q + 3] / 1000), sh = B.S.uBrShift;
  let ex = seg[q + 4] - seg[q], ey = seg[q + 5] - seg[q + 1], ez = seg[q + 6] - seg[q + 2]; const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el; if (dir > 0) { ex = -ex; ey = -ey; ez = -ez; }
  ft = { px: seg[q] + sh[L * 3], py: seg[q + 1], pz: seg[q + 2] + sh[L * 3 + 2], u: [seg[q + 8], seg[q + 9], seg[q + 10]], e: [ex, ey, ez], wf: seg[q + 20], w: seg[q+3] % 1000, kap: seg[q+11], pipe: seg[q+23] };
}
console.log('pipe start', ft);
r.pos.set(ft.px + ft.u[0] * 0.5, ft.py + ft.u[1] * 0.5, ft.pz + ft.u[2] * 0.5);
r.up.set(...ft.u); r.normal.copy(r.up);
const e = new V3(...ft.e), right = new V3().crossVectors(e, r.up).normalize();
const dir = e.clone().scale(Math.cos(0.75)).addScaled(right, Math.sin(0.75)).normalize();
r.fwd.copy(dir).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up);
r.vel.set(dir.x * 30, dir.y * 30, dir.z * 30); r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(30);
const I = { lean: 0, trim: 0, snap: 0, brace, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
const F = {};
for (let i = 0; i < 120 * 4; i++) {
  st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
  world.trapar.sample(r.pos.x, r.pos.y - 1, r.pos.z, F);
  if (i % 6 === 0) {
    const lat = (r.pos.x - ft.px) * right.x + (r.pos.z - ft.pz) * right.z;
    console.log((i * dt).toFixed(2), r.state.padEnd(8), 'lat', lat.toFixed(1), 'y', (r.pos.y - ft.py).toFixed(1), 'n', r.normal.x.toFixed(2), r.normal.y.toFixed(2), r.normal.z.toFixed(2), 'v', r.vel.x.toFixed(1), r.vel.y.toFixed(1), r.vel.z.toFixed(1), 'rho', r.dbg.rho.toFixed(2), 'feat', F.feature, 'lipOut', r.lipOut ? r.lipOut.x.toFixed(2) + ',' + r.lipOut.z.toFixed(2) : '-', 'brace', r.brace);
  }
  if (r.fallen) break;
}
