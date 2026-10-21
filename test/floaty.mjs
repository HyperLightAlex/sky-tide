// How floaty is a fall? Drop from a pop/launch at speed in various places; measure time in mist, fall rates.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const dt = 1 / 120;
let tot = { air: 0, drift: 0, free: 0, dist: 0, drop: 0, n: 0 }, slowest = [];
for (let k = 0; k < 24; k++) {
  const P = defaultParams(); const world = new SkyWorld(bank, P); const st = { t: 600 + k * 37 };
  const sx = (k % 6) * 1700 - 4000, sz = Math.floor(k / 6) * 2100 - 3000;
  world.update(st.t, { x: sx, z: sz });
  const r = new Rider(world, P); r.respawn(sx, sz, world.trapar.refAltitude());
  const I = { lean: 0, trim: 0, snap: 0, brace: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
  for (let i = 0; i < 120; i++) { st.t += dt; world.update(st.t, r.pos); r.step(dt, I); }
  // launch off: 30 m/s along travel + 8 m/s up
  const h = r.vel.clone(); h.y = 0; h.normalize();
  r.vel.set(h.x * 30, 8, h.z * 30); r.state = 'freefall'; r.pos.y += 3; r.popT = 0.3; r.attachT = 0; r.airT = 0.01;
  const x0 = r.pos.x, z0 = r.pos.z, y0 = r.pos.y; let air = 0, drift = 0, free = 0;
  for (let i = 0; i < 120 * 6; i++) {
    st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
    if (r.state === 'riding' && air > 0.3) break;
    air += dt; if (r.state === 'drifting') drift += dt; else if (r.state === 'freefall') free += dt;
    if (r.fallen) break;
  }
  const dist = Math.hypot(r.pos.x - x0, r.pos.z - z0), drop = y0 - r.pos.y;
  tot.air += air; tot.drift += drift; tot.free += free; tot.dist += dist; tot.drop += drop; tot.n++;
  slowest.push({ k, air: +air.toFixed(1), drift: +drift.toFixed(1), dist: +dist.toFixed(0), drop: +drop.toFixed(0), end: r.state });
}
console.log(`avg air ${(tot.air / tot.n).toFixed(1)} s (in mist ${(tot.drift / tot.n).toFixed(1)} s), horizontal ${(tot.dist / tot.n).toFixed(0)} m, net drop ${(tot.drop / tot.n).toFixed(0)} m`);
console.log('ballistic reference (g=12, no drag): 6 s of air drops', (12 * 36 / 2 - 8 * 6).toFixed(0), 'm');
slowest.sort((a, b) => b.air - a.air); console.log(slowest.slice(0, 8).map(s => JSON.stringify(s)).join('\n'));
