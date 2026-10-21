import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const t0 = performance.now();
const world = new SkyWorld(bank, P);
world.update(40, { x: 0, z: 0 });
const B = world.trapar.braids;
console.log('build ms', (performance.now() - t0).toFixed(0), 'buildMs', B.buildMs.toFixed(0), 'segs', B.nSeg, 'idx', B.nIdx, 'truncated', B.truncated, 'overfull cells', B.overfull, 'grid', Array.from(B.S.uBrDims), 'y', B.S.uBrLo.toFixed(0), B.S.uBrHi.toFixed(0));
const bands = B.net.bandsIn(-6000, 6000, -6000, 6000, 0, 0, 4500);
const kinds = {};
for (const b of bands) { const k = b.kind.split(' ')[0].replace(/[-\d,]+$/, ''); kinds[k] = (kinds[k] || 0) + 1; }
console.log('bands', bands.length, kinds);
// cell occupancy histogram
const cnts = []; const N = B.S.uBrDims[0] * B.S.uBrDims[1] * B.S.uBrDims[2];
let mx = 0, nz = 0; for (let c = 0; c < N; c++) { const k = B.cell[2 * c + 1]; if (k) { nz++; mx = Math.max(mx, k); } }
console.log('nonempty cells', nz, 'max per cell', mx);
const r = new Rider(world, P);
const ok = r.respawn(0, 0, world.trapar.refAltitude());
console.log('respawn', ok, r.pos.x.toFixed(0), r.pos.y.toFixed(0), r.pos.z.toFixed(0), 'n', r.normal.y.toFixed(3), r.state);
const I = { lean: 0, trim: 0, snap: 0, brace: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false };
let st = { t: 40 }; const dt = 1 / 120; const feats = {}; let ride = 0, air = 0; const ev = [];
const tt = performance.now();
for (let i = 0; i < 120 * 60; i++) {
  st.t += dt; world.update(st.t, r.pos); r.step(dt, I);
  if (r.state === 'riding') { ride += dt; feats[r.dbg.feature] = (feats[r.dbg.feature] || 0) + dt; } else air += dt;
  for (const e of r.events.splice(0)) ev.push(e.type + (e.reason ? ':' + e.reason : ''));
  if (i % 600 === 0) console.log(`t${(i * dt).toFixed(0)} ${r.state} sp ${r.vel.len().toFixed(1)} y ${r.pos.y.toFixed(0)} feat ${r.dbg.feature} ny ${r.normal.y.toFixed(2)} left ${r.leftBy || ''}`);
  if (r.fallen) { console.log('fell at', (i * dt).toFixed(1)); break; }
}
console.log('sim ms per s', ((performance.now() - tt) / 60).toFixed(1), 'ride', ride.toFixed(1), 'air', air.toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(feats).map(([k, v]) => [k, +v.toFixed(1)]))), ev.join(','));
