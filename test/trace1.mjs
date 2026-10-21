import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
const P = defaultParams(); const world = new SkyWorld(bank, P); let t = 300 - 60; world.update(t, { x: 0, z: 0 });
const T = world.trapar, r = new Rider(world, P);
r.respawn(-6000, -6000, T.refAltitude());
console.log('spawn', r.pos, 'vel', r.vel.len().toFixed(1), 'n', r.normal);
const I = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
for (let i = 0; i < 160; i++) {
  t += dt; world.update(t, r.pos); r.step(dt, I);
  for (const e of r.events.splice(0)) console.log('  event', e.type, e.into?.toFixed?.(1), e.gain?.toFixed?.(1));
  if (i % 6 === 0) console.log(`${(i*dt).toFixed(2)} ${r.state} rho ${r.dbg.rho.toFixed(2)} e ${r.dbg.e.toFixed(2)} sup ${r.dbg.support.len().toFixed(1)} v ${r.vel.len().toFixed(1)} vy ${r.vel.y.toFixed(1)} n ${r.normal.x.toFixed(2)},${r.normal.y.toFixed(2)},${r.normal.z.toFixed(2)} y ${r.pos.y.toFixed(1)} flow ${r.dbg.flow.x.toFixed(1)},${r.dbg.flow.y.toFixed(1)},${r.dbg.flow.z.toFixed(1)}`);
}
// Re-run and probe per-set structure along the path
{
  const P2 = defaultParams(); const w2 = new SkyWorld(bank, P2); let t2 = 300 - 60; w2.update(t2, { x: 0, z: 0 });
  const T2 = w2.trapar, r2 = new Rider(w2, P2);
  r2.respawn(-6000, -6000, T2.refAltitude());
  for (let i = 0; i < 125; i++) {
    t2 += dt; w2.update(t2, r2.pos); r2.step(dt, I);
    if (i >= 60 && i % 4 === 0) {
      const p = r2.pos; const F = T2.sample(p.x, p.y - 1, p.z, {});
      const st = T2._st; const parts = [];
      for (let k = 0; k < 3; k++) parts.push(`k${k}: lat ${st.lat[k].toFixed(2)} h ${st.h[k].toFixed(1)} str ${F.layers.str[k].toFixed(2)}`);
      console.log(`${(i*dt).toFixed(2)} y ${p.y.toFixed(1)} rho ${F.rho.toFixed(2)} wisp ${F.layers.wisp.toFixed(2)} plume ${F.layers.plume.toFixed(2)} | ${parts.join(' | ')}`);
    }
  }
}
