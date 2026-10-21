import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
const P = defaultParams(); const world = new SkyWorld(bank, P); let t = 600; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P); r.respawn(0, 0, world.trapar.refAltitude());
const I = { lean: 0, trim: 0, snap: 0, dig: +(process.env.DIG || 0), crouch: false, crouchReleased: false, boost: false, boostPressed: false };
for (let i = 0; i < 60; i++) { t += dt; world.update(t, r.pos); r.step(dt, I); }
const fl = r.dbg.flow; const f = r.fwd; r.vel.set(fl.x + f.x * 25, fl.y + f.y * 25, fl.z + f.z * 25);
const ang = (x, z) => Math.atan2(z, x) * 57.3;
for (let i = 0; i < 120; i++) {
  I.lean = i < 84 ? 1 : 0;
  t += dt; world.update(t, r.pos); r.step(dt, I);
  if (i % 8 === 0) { const fl = r.dbg.flow; console.log(`${(i*dt).toFixed(2)} ${r.state} nose ${ang(r.fwd.x, r.fwd.z).toFixed(0)} travel ${ang(r.vel.x - fl.x, r.vel.z - fl.z).toFixed(0)} slip ${(r.slip*57.3).toFixed(0)} pivot ${(r.pivot||0).toFixed(2)} vrel ${Math.hypot(r.vel.x - fl.x, r.vel.z - fl.z).toFixed(1)} n.y ${r.normal.y.toFixed(2)} flow ${fl.x.toFixed(1)},${fl.z.toFixed(1)} rho ${r.dbg.rho.toFixed(2)}`); }
}
