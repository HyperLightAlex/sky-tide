import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams(); const world = new SkyWorld(bank, P); world.update(600, { x: 0, z: 0 });
const r = new Rider(world, P);
let ok = 0, n = 0, t0 = performance.now(); const fails = [];
for (let i = 0; i < 40; i++) { const x = (i % 8) * 2500 - 9000, z = Math.floor(i / 8) * 2500 - 5000; n++; if (r.respawn(x, z, world.trapar.refAltitude())) ok++; else fails.push([x, z]); }
console.log(`respawn success ${ok}/${n}, avg ${((performance.now() - t0) / n).toFixed(0)} ms each, fails ${JSON.stringify(fails.slice(0, 6))}`);
