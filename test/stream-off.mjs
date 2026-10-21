import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { sampleVolume } from '../src/sky/noise.js';
const bank = await loadBank();
const dt = 1 / 120;
function info(T, k, x, z) {
  const S = T.S, Tm = S.uStrTerm; let nv = 0, gx = 0, gz = 0;
  for (let i = 0; i < 5; i++) { const j = (k * 5 + i) * 4; const ph = Tm[j] * x + Tm[j + 1] * z + Tm[j + 2]; nv += Tm[j + 3] * Math.sin(ph); const c = Tm[j + 3] * Math.cos(ph); gx += c * Tm[j]; gz += c * Tm[j + 1]; }
  const gl = Math.hypot(gx, gz); const c = [0, 0];
  sampleVolume(T.C, x / 6000 + S.uStrSet[k * 4 + 1], S.uStrSet[k * 4 + 2], z / 6000 + S.uStrSet[k * 4 + 3], c);
  const w = S.uStrWidth * (1 + S.uStrWidthVar * (c[0] - 0.5) * 2);
  const pres = (v => v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v))((c[1] - (S.uStrBreakThr - 0.08)) / 0.16);
  return { dist: nv / gl, tx: -gz / gl, tz: gx / gl, w, pres, curv: 0 };
}
for (const [sx, sz] of [[0, 0], [2000, 1000], [-3000, 2500], [5000, -4000], [-6000, -6000]]) {
  const P = defaultParams(); const world = new SkyWorld(bank, P); let t = 300 + sx * 0.01; world.update(t, { x: 0, z: 0 });
  const T = world.trapar, r = new Rider(world, P);
  r.respawn(sx, sz, T.refAltitude());
  const I = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
  let k = 0, hist = [];
  for (let i = 0; i < 120 * 90; i++) {
    const p = r.pos, R = r.right;
    const dl = T.density(p.x - R.x * 12, p.y - 2, p.z - R.z * 12), dr = T.density(p.x + R.x * 12, p.y - 2, p.z + R.z * 12);
    const F = T.sample(p.x, p.y - 2, p.z, {});
    let best = 0; for (let j = 0; j < T.S.uStrCount; j++) if (F.layers.str[j] > best) { best = F.layers.str[j]; k = j; }
    const inf = info(T, k, p.x, p.z);
    let tx = inf.tx, tz = inf.tz; if (tx * r.fwd.x + tz * r.fwd.z < 0) { tx = -tx; tz = -tz; }
    const headErr = r.fwd.x * tz - r.fwd.z * tx;
    const lat = (dr - dl) / Math.max(0.2, dl + dr);
    I.lean = Math.max(-1, Math.min(1, headErr * 2.5 + lat * 1.5));
    t += dt; world.update(t, r.pos); r.step(dt, I);
    hist.push(`${(i*dt).toFixed(1)} ${r.state} dist ${inf.dist.toFixed(0)} w ${inf.w.toFixed(0)} pres ${inf.pres.toFixed(2)} rho ${r.dbg.rho.toFixed(2)} v ${r.vel.len().toFixed(0)} lean ${I.lean.toFixed(2)} hErr ${headErr.toFixed(2)}`);
    if (r.state !== 'riding' && i > 60) break;
  }
  console.log(`start ${sx},${sz}:`); for (const h of hist.filter((_, j) => j % 24 === 0 || j > hist.length - 4).slice(-6)) console.log('   ' + h);
}
