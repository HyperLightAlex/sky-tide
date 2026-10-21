// Cloud field: how many heaps, their sizes, density inside one, and the cost of a query.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
world.update(600, { x: -924, z: -38 });
const f = world.weather.field;
const kinds = { 0: 0, 1: 0 };
for (const c of f.list) kinds[c.layer]++;
console.log('clouds', f.list.length, kinds, 'storms', f.storms.length, 'set', f.set());
let n = 0, sum = 0;
f.each((s) => { n++; sum += s.W; });
console.log('mean W', (sum / n).toFixed(0));
// inside the biggest near cloud
let best = null;
f.each((s) => { const d = Math.hypot(s.x + 924, s.z + 38); if (s.alpha > 0.5 && (!best || d < best.d)) best = { ...s, d }; });
console.log('nearest cloud', Object.fromEntries(Object.entries(best).filter(([k]) => k !== 'c').map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v])));
const y = best.y + best.H * 0.3;
console.log('density centre', world.weather.cloud(best.x, y, best.z).toFixed(2), 'sdf', f.sdf(best, best.x, y, best.z).toFixed(0), 'outside', world.weather.cloud(best.x + best.W, y, best.z));
const t0 = performance.now();
for (let i = 0; i < 2000; i++) world.weather.cloud(-924 + i, 913, -38);
console.log('query us', ((performance.now() - t0) / 2000 * 1000).toFixed(1));
const t1 = performance.now();
for (let i = 0; i < 200; i++) world.update(600 + i / 120, { x: -924 + i * 0.2, z: -38 });
console.log('update us', ((performance.now() - t1) / 200 * 1000).toFixed(1));
