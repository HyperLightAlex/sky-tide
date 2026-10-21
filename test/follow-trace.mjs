import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
const [sx, sz] = (process.env.START || '0,0').split(',').map(Number);
const P = defaultParams(); const world = new SkyWorld(bank, P); let t = 600 + sx * 0.003; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P); r.respawn(sx, sz, world.trapar.refAltitude());
const T = world.trapar;
const I = { lean: 0, trim: 0, snap: 0, dig: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
const F = {};
for (let i = 0; i < 120 * 3; i++) {
  t += dt; world.update(t, r.pos); r.step(dt, I);
  for (const e of r.events.splice(0)) console.log('   EVENT', e.type, e.reason || '', e.into?.toFixed?.(1) || '');
  T.sample(r.pos.x, r.pos.y, r.pos.z, F);
  const topside = (r.normal.x * F.face.x + r.normal.y * F.face.y + r.normal.z * F.face.z);
  if (i % 6 === 0) console.log((i * dt).toFixed(2), r.state.padEnd(8), 'rho', r.dbg.rho.toFixed(2), 'e', r.dbg.e.toFixed(2), 'n', r.normal.x.toFixed(2), r.normal.y.toFixed(2), r.normal.z.toFixed(2), 'face', F.face.y.toFixed(2), 'top', topside.toFixed(2), 'v', r.vel.len().toFixed(1), 'vy', r.vel.y.toFixed(1), 'hold', r.hold.toFixed(2), 'need', r.holdNeed.toFixed(1), 'feat', F.feature, 'slip', (r.slip * 57).toFixed(0));
  if (r.fallen) break;
}
