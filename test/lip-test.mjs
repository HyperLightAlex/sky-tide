// Launch lips: step on, ride off the kicker, land on the stream below?
import { setup, inp, step, dt, bot } from './netbot.mjs';
import { frameAt } from '../src/trapar/network.js';
const S = setup({}); const { r, world } = S; const B = world.trapar.braids;
B.update(40, { x: 0, z: 0 });
const R = +(process.env.R || 7000);
const lips = B.net.bandsIn(-R, R, -R, R, 0, 0, R).filter((b) => b.dock && b.dock.lip);
console.log('lips', lips.length);
let ok = 0;
for (const b of lips) {
  const I = b.dock.island, fr = frameAt(b, 14, {});
  r.placeOnIsland(I, fr.x, fr.z);
  const I_ = inp(); I_.boardPressed = true; step(S, I_); I_.boardPressed = false;
  const ev = []; let t = 0, res = 'timeout', air = 0;
  for (let i = 0; i < 25 / dt; i++) {
    if (r.mode === 'board' && r.state === 'riding') bot(S, I_); else I_.lean = 0;
    I_.brace = r.mode === 'board' && r.state !== 'riding' && r.predict && r.predict.hit && r.predict.t < 1 ? 1 : 0;
    step(S, I_); t += dt;
    if (process.env.TRACE && b === lips[+process.env.TRACE] && (i % 12 === 0)) console.log(`   ${t.toFixed(2)} ${r.mode}/${r.state} ${r.dbg.feature} pos ${r.pos.x.toFixed(0)},${r.pos.y.toFixed(1)},${r.pos.z.toFixed(0)} v ${r.vel.len().toFixed(1)} vy ${r.vel.y.toFixed(1)} rh ${I.rhat(r.pos.x, r.pos.z).toFixed(2)} g ${(I.ground(r.pos.x, r.pos.z) ?? NaN).toFixed(1)} left ${r.leftBy}`);
    if (r.mode === 'board' && r.state !== 'riding') air += dt;
    for (const e of r.events.splice(0)) if (e.type !== 'freefall') ev.push(e.type + (e.into ? ':' + e.into.toFixed(0) : ''));
    if (air > 0.5 && r.mode === 'board' && r.state === 'riding' && r.dbg.feature !== 'dock') { res = `landed on ${r.dbg.feature} after ${air.toFixed(1)} s air`; ok++; break; }
    if (r.mode === 'foot' && r.state === 'walking' && t > 2) { res = 'back on the island'; break; }
    if (r.fallen) { res = 'FELL'; break; }
  }
  console.log(`  lip on ${I.name}: ${res} · ${ev.join(' ')}`);
}
console.log(`lips: ${ok} landed on a stream below`);
