import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const world = new SkyWorld(bank, P);
let t = 40; const focus = { x: 0, z: 0 };
world.update(t, focus);
const W = world.weather, T = world.trapar;
// --- density stats by altitude
const rows = [];
for (let y = 200; y <= 1700; y += 100) {
  let ride = 0, mist = 0, cloud = 0, n = 0, both = 0;
  for (let x = -6000; x < 6000; x += 131) for (let z = -6000; z < 6000; z += 131) {
    const d = T.density(x, y, z), c = W.cloud(x, y, z); n++;
    if (d >= 1) ride++; else if (d > 0.06) mist++;
    if (c > 0.3) cloud++;
    if (d >= 1 && c > 0.3) both++;
  }
  rows.push(`${String(y).padStart(5)} trapar ride ${(ride/n*100).toFixed(1).padStart(5)}% mist ${(mist/n*100).toFixed(1).padStart(5)}%  cloud ${(cloud/n*100).toFixed(1).padStart(5)}%  overlap ${(both/n*100).toFixed(1)}%`);
}
console.log(rows.join('\n'));
// --- storms around
const near = W.stormsAround(0, 0, t, 30000, 2000);
console.log('storms in 30km (any age up to 2000s):', near.length, 'alive near focus:', W.alive.length, 'swell events:', T.events.length, 'candidates:', T.candidates.length);
// --- timing
let t0 = performance.now(); for (let i = 0; i < 50000; i++) T.density((i%300)*7, 300 + (i%900), (i*13)%5000);
console.log('trapar density us', ((performance.now()-t0)/50000*1000).toFixed(2));
t0 = performance.now(); for (let i = 0; i < 50000; i++) W.cloud((i%300)*7, 300 + (i%900), (i*13)%5000);
console.log('cloud density us', ((performance.now()-t0)/50000*1000).toFixed(2));
t0 = performance.now(); for (let i = 0; i < 1200; i++) world.update(t + i/120, focus);
console.log('world.update us', ((performance.now()-t0)/1200*1000).toFixed(1));

// --- swell propagation: spawn a storm 4 km west of a probe and watch the swell signal arrive
P.stormFrequency = 0; // isolate
const probe = { x: 0, z: 0 };
world.update(t, probe);
W.spawnStorm(-4000, 0, t, { D: 120, I: 1.5 });
const series = [];
for (let s = 0; s <= 420; s += 5) {
  world.update(t + s, probe);
  // measure max |swell| along a 600 m line around the probe (the ring passes by)
  let mx = 0; for (let k = -300; k <= 300; k += 20) mx = Math.max(mx, Math.abs(T.swell(probe.x + k, probe.z)));
  series.push([s, +mx.toFixed(3)]);
}
const first = series.find(([s, v]) => v > 0.02);
console.log('swell arrival at probe 4 km away: first signal at', first && first[0], 's (front ETA from medium-frame distance ~', (4000/P.swellSpeed).toFixed(0), 's minus ring offset)');
console.log('signal over time:', series.filter((_, i) => i % 6 === 0).map(([s, v]) => `${s}s:${v}`).join(' '));
const fc = T.forecast(probe.x, probe.z);
console.log('forecast now:', fc.slice(0, 3).map(f => ({ dist: f.dist.toFixed(0), arrive: f.arrive.toFixed(0), peak: f.peak.toFixed(1) })));
