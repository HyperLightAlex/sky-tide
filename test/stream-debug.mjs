import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
const P = defaultParams();
const world = new SkyWorld(bank, P); let t = 300; world.update(t, { x: 0, z: 0 });
const T = world.trapar, r = new Rider(world, P);
const [sx, sz] = (process.env.START || '0,0').split(',').map(Number);
r.respawn(sx, sz, T.refAltitude());
const I = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
// distance to centerline and lateral info for set k at (x,z)
function info(k, x, z) {
  const S = T.S, Tm = S.uStrTerm; let nv = 0, gx = 0, gz = 0;
  for (let i = 0; i < 5; i++) { const j = (k * 5 + i) * 4; const ph = Tm[j] * x + Tm[j + 1] * z + Tm[j + 2]; nv += Tm[j + 3] * Math.sin(ph); const c = Tm[j + 3] * Math.cos(ph); gx += c * Tm[j]; gz += c * Tm[j + 1]; }
  const gl = Math.hypot(gx, gz); return { dist: nv / gl, tx: -gz / gl, tz: gx / gl };
}
for (let i = 0; i < 120 * 12; i++) {
  const p = r.pos, R = r.right;
  const F = T.sample(p.x, p.y - 2, p.z, {});
  let k = -1, best = 0; for (let j = 0; j < T.S.uStrCount; j++) if (F.layers.str[j] > best) { best = F.layers.str[j]; k = j; }
  if (k < 0) k = r._k ?? 0; r._k = k;
  const inf = info(k, p.x, p.z);
  let tx = inf.tx, tz = inf.tz; if (tx * r.fwd.x + tz * r.fwd.z < 0) { tx = -tx; tz = -tz; }
  const cross = r.fwd.x * tz - r.fwd.z * tx;
  // lateral: signed distance along right vector
  const latSide = Math.sign(inf.dist) * 1; 
  I.lean = 0;
  t += dt; world.update(t, r.pos); r.step(dt, I);
  if (i % 30 === 0) {
    const vh = Math.hypot(r.vel.x, r.vel.z);
    const vdir = (r.vel.x * tx + r.vel.z * tz) / Math.max(vh, 1e-3);
    console.log(`${(i*dt).toFixed(2)} ${r.state.padEnd(8)} k${k} dist ${inf.dist.toFixed(1).padStart(6)} rho ${r.dbg.rho.toFixed(2)} thr ${r.thr.toFixed(2)} n.y ${r.normal.y.toFixed(2)} cross ${cross.toFixed(2)} vAlong ${vdir.toFixed(2)} v ${r.vel.len().toFixed(1)} y ${p.y.toFixed(1)} flow ${Math.hypot(r.dbg.flow.x, r.dbg.flow.z).toFixed(1)}`);
  }
  if (r.fallen) break;
}
