import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams(); const world = new SkyWorld(bank, P);
let t = 900; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P); r.respawn(0, 0, 380); r.gauge = 1;
const dt = 1 / 120;
const I = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false, camFX: 0, camFZ: -1 };
for (let i = 0; i < 120; i++) { t += dt; world.update(t, r.pos); r.step(dt, I); }
console.log('target', r.boostTarget && { dh: r.boostTarget.dh.toFixed(0), d: r.boostTarget.d.toFixed(0) }, 'column skins above', world.trapar.findSkins(r.pos.x, r.pos.z, 1).map(v => v.toFixed(0)));
const y0 = r.pos.y;
for (let i = 0; i < 120 * 14; i++) {
  const tt = i * dt;
  I.crouch = tt < 0.5; I.crouchReleased = tt >= 0.5 && tt < 0.5 + dt;
  I.boost = tt > 0.6; I.boostPressed = tt > 0.6 && tt < 0.6 + dt;
  t += dt; world.update(t, r.pos); r.step(dt, I);
  if (i % 18 === 0) console.log(`${tt.toFixed(2)}s y ${r.pos.y.toFixed(0)} vy ${r.vel.y.toFixed(1)} vh ${Math.hypot(r.vel.x, r.vel.z).toFixed(1)} ${r.state} rho ${r.dbg.rho.toFixed(2)} thr ${r.thr.toFixed(2)} n.y ${r.normal.y.toFixed(2)} boost ${r.boosting ? 'on' : 'off'} gauge ${r.gauge.toFixed(2)} aim ${r.boostAim.x.toFixed(2)},${r.boostAim.y.toFixed(2)},${r.boostAim.z.toFixed(2)}`);
}
