// Far islands: how many islands are within 17 km, and what the query costs (first and cached).
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
world.update(600, { x: -924, z: -38 });
const R = 17000, cx = -924, cz = -38;
let t0 = performance.now();
let L = world.trapar.islandsIn(cx - R, cx + R, cz - R, cz + R);
const first = performance.now() - t0;
t0 = performance.now();
for (let i = 0; i < 5; i++) L = world.trapar.islandsIn(cx - R, cx + R, cz - R, cz + R);
const again = (performance.now() - t0) / 5;
const d = L.map((I) => Math.hypot(I.x - cx, I.z - cz));
console.log('islands', L.length, 'beyond 6.5 km', d.filter((x) => x > 6500).length, 'first ms', first.toFixed(1), 'cached ms', again.toFixed(2));
console.log('R range', Math.min(...L.map((I) => I.R)).toFixed(0), Math.max(...L.map((I) => I.R)).toFixed(0), 'D/R', Math.min(...L.map((I) => I.D / I.R)).toFixed(2), Math.max(...L.map((I) => I.D / I.R)).toFixed(2));
