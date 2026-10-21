import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
const P = defaultParams(); P.autoLevel = 0; const world = new SkyWorld(bank, P); let t = 600; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P); r.respawn(0, 0, world.trapar.refAltitude());
const x0 = r.pos.x, y0 = r.pos.y, z0 = r.pos.z;
console.log('spawn', x0.toFixed(1), y0.toFixed(1), z0.toFixed(1));
r.pos.set(x0, y0 + 20, z0); r.vel.set(0, -8, 0); r.state = 'freefall'; r.airT = 1;
const I = { lean: 0, trim: 0, snap: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
const F = {};
for (let i = 0; i < 200; i++) {
  t += dt; world.update(t, r.pos); r.step(dt, I);
  world.trapar.sample(r.pos.x, r.pos.y, r.pos.z, F);
  if (r.pos.y < y0 + 4 && r.pos.y > y0 - 20 && i % 2 === 0) console.log(i, r.state, 'y', r.pos.y.toFixed(2), 'rho', F.rho.toFixed(2), 'thr', r.thr.toFixed(2), 'face', F.face.y.toFixed(2), 'up', r.up.y.toFixed(2), 'through', r.throughT.toFixed(2), 'n.y', r.normal.y.toFixed(2), 'vy', r.vel.y.toFixed(1));
}
