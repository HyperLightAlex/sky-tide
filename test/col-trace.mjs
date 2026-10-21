import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams(); const world = new SkyWorld(bank, P); let t = 600; world.update(t, { x: 0, z: 0 });
const r = new Rider(world, P); r.respawn(0, 0, world.trapar.refAltitude());
const x0 = r.pos.x, y0 = r.pos.y, z0 = r.pos.z;
const T = world.trapar, B = T.braids;
for (const dtt of [0, 0.01, 0.1, 0.17, 0.5, 1.0, 1.5]) {
  world.update(600 + dtt, { x: x0, z: z0 });
  const sk = T.findSkins(x0, z0, 1, 2).filter(y => Math.abs(y - y0) < 60).map(v => v.toFixed(1));
  console.log('t+' + dtt, 'skins near', sk.join(','), 'tSnap', B.tSnap.toFixed(3), 'shift', Array.from(B.S.uBrShift).slice(0, 9).map(v => v.toFixed(2)).join(','), 'ver', B.version, 'rho@y0-2', T.density(x0, y0 - 2, z0).toFixed(2));
}
{
  world.update(600, { x: x0, z: z0 });
  const F = T.sample(x0, y0 - 3, z0, {});
  const fx = F.flowDir.x, fz = F.flowDir.z, l = Math.hypot(fx, fz); const px = -fz / l, pz = fx / l;
  let row = '';
  for (let d = -60; d <= 60; d += 5) row += T.density(x0 + px * d, y0 - 3, z0 + pz * d).toFixed(1) + ' ';
  console.log('cross-section at y0-3 (every 5 m, -60..60):', row);
  // Track the strand: does it move? sample cross-section at t+1
  world.update(601, { x: x0, z: z0 });
  row = ''; for (let d = -60; d <= 60; d += 5) row += T.density(x0 + px * d, y0 - 3, z0 + pz * d).toFixed(1) + ' ';
  console.log('cross-section at t+1                       :', row);
  for (const dy of [-10, -6, -3, 0, 3, 6]) { row = ''; for (let d = -60; d <= 60; d += 5) row += T.density(x0 + px * d, y0 + dy, z0 + pz * d).toFixed(1) + ' '; console.log('t+1 dy', dy, row); }
  console.log('flow', F.flowDir, 'face', F.face, 'feature', F.feature);
}
