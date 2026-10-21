import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
const bank = await loadBank();
const dt = 1 / 120;
const P = defaultParams(); const world = new SkyWorld(bank, P); const st = { t: 600 }; world.update(600, { x: 0, z: 0 });
const r = new Rider(world, P); const B = world.trapar.braids; const seg = B.seg, F = 24;
let found = 0, ft = null;
for (let s = 8; s < B.nSeg - 8 && !ft; s++) {
  const o = s * F; if (Math.hypot(seg[o] - B.cx, seg[o + 2] - B.cz) > 2500) continue;
  if (seg[o + 16] < 0.95 || !(seg[o + 22] > 0.9)) continue;
  const dir = seg[o + 18] >= 0 ? -1 : 1; let k = s, steps = 0;
  while (steps < 4) { const kk = k + dir, ok = kk * F, ko = k * F; const shares = dir < 0 ? (Math.abs(seg[ok + 4] - seg[ko]) < 0.01 && Math.abs(seg[ok + 6] - seg[ko + 2]) < 0.01) : (Math.abs(seg[ok] - seg[ko + 4]) < 0.01 && Math.abs(seg[ok + 2] - seg[ko + 6]) < 0.01); if (!shares) break; k = kk; steps++; }
  if (steps < 4) continue; if (found++ < 2) { s += 30; continue; }
  const q = k * F, L = Math.floor(seg[q + 3] / 1000), sh = B.S.uBrShift;
  let ex = seg[q + 4] - seg[q], ey = seg[q + 5] - seg[q + 1], ez = seg[q + 6] - seg[q + 2]; const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el; if (dir > 0) { ex = -ex; ey = -ey; ez = -ez; }
  ft = { px: seg[q] + sh[L * 3], py: seg[q + 1], pz: seg[q + 2] + sh[L * 3 + 2], u: [seg[q + 8], seg[q + 9], seg[q + 10]], e: [ex, ey, ez] };
}
console.log(ft);
r.pos.set(ft.px + ft.u[0] * 0.5, ft.py + ft.u[1] * 0.5, ft.pz + ft.u[2] * 0.5); r.up.set(...ft.u); r.normal.copy(r.up);
r.fwd.set(...ft.e).projectOnPlane(r.up).normalize(); r.right.crossVectors(r.fwd, r.up);
r.vel.set(ft.e[0] * 30, ft.e[1] * 30, ft.e[2] * 30); r.state = 'riding'; r.ePrev = null; r.rhoHeld = 1; r.thr = r.rideThresholdAt(30); r.attachT = 0.35;
const I = { lean: 0, trim: 0, snap: 0, brace: 1, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
const Fs = {};
for (let i = 0; i < 30; i++) { st.t += dt; world.update(st.t, r.pos); r.step(dt, I); world.trapar.sample(r.pos.x, r.pos.y, r.pos.z, Fs);
  const g = world.trapar.gradient(r.pos.x, r.pos.y, r.pos.z, 1.5, new V3()); const n = g.scale(-1/g.len());
  console.log(i, r.state, 'rho', Fs.rho.toFixed(2), 'face', Fs.face.x.toFixed(2), Fs.face.y.toFixed(2), Fs.face.z.toFixed(2), 'n', n.x.toFixed(2), n.y.toFixed(2), n.z.toFixed(2), 'top', (n.x*Fs.face.x+n.y*Fs.face.y+n.z*Fs.face.z).toFixed(2), 'stream', Fs.stream?.toFixed(2), 'e', r.dbg.e.toFixed(2)); }
