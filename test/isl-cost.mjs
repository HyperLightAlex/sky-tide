import { setup } from './netbot.mjs';
const S = setup(); const { world } = S;
const R = 7000;
for (let k = 0; k < 5; k++) {
  const t0 = performance.now();
  const list = world.trapar.islandsIn(-R + k * 30, R + k * 30, -R, R);
  console.log('islandsIn 14 km box:', list.length, 'islands', (performance.now() - t0).toFixed(1), 'ms');
}
const net = world.trapar.braids.net;
const t1 = performance.now();
for (let k = 0; k < 100; k++) net.sync();
console.log('100 x net.sync', (performance.now() - t1).toFixed(1), 'ms');
const t2 = performance.now();
for (let k = 0; k < 100; k++) world.trapar.braids._signature();
console.log('100 x snapshot signature', (performance.now() - t2).toFixed(1), 'ms');
const t3 = performance.now();
for (let k = 0; k < 100; k++) world.weather.update(40 + k / 120, { x: 0, z: 0 });
console.log('100 x weather.update', (performance.now() - t3).toFixed(1), 'ms');
const t4 = performance.now();
for (let k = 0; k < 100; k++) world.trapar.update(40 + k / 120, { x: 0, z: 0 });
console.log('100 x trapar.update', (performance.now() - t4).toFixed(1), 'ms');
