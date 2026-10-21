import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
const P = defaultParams(); const world = new SkyWorld(bank, P); let t = 600; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P); r.respawn(0, 0, world.trapar.refAltitude());
console.log('spawn', r.pos.x.toFixed(1), r.pos.y.toFixed(1), r.pos.z.toFixed(1), 'state', r.state, 'n', r.normal);
const I = { lean: 0, trim: 0, snap: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
const F = {};
for (let i = 0; i < 70; i++) {
  t += dt; world.update(t, r.pos); r.step(dt, I);
  world.trapar.sample(r.pos.x, r.pos.y, r.pos.z, F);
  if (i % 5 === 0) console.log(i, r.state, 'y', r.pos.y.toFixed(2), 'rho', r.dbg.rho.toFixed(2), 'e', r.dbg.e.toFixed(2), 'face', F.face.x.toFixed(2), F.face.y.toFixed(2), F.face.z.toFixed(2), 'stream', (F.stream||0).toFixed(2), 'n', r.normal.y.toFixed(2), 'vy', r.vel.y.toFixed(2), 'hold', r.hold.toFixed(2));
}
