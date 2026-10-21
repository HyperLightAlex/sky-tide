// Ride along streams (bot steering) with boost held vs not: does boosting throw you off?
import { setup, inp, step, bot, dt } from './netbot.mjs';
const starts = [[0, 0], [3000, 1500], [-4000, 2500], [5000, -4000], [-6000, -6000], [8000, 3000], [1200, -7000], [-2500, 6500]];
for (const boost of [0, 1]) for (const brace of [0, 1]) {
  let ride = 0, air = 0, leaves = {}, falls = 0, top = 0, sumSp = 0, n = 0;
  for (const [sx, sz] of starts) {
    const S = setup({ boostInfinite: true }); const { r, world } = S;
    r.respawn(sx, sz, world.trapar.refAltitude());
    const I = inp(); let prev = 'riding';
    for (let i = 0; i < 120 * 40; i++) {
      bot(S, I, 0); I.boost = !!boost && i > 120; I.brace = brace; step(S, I);
      if (r.state === 'riding') { ride += dt; sumSp += r.vel.len(); n++; } else air += dt;
      if (prev === 'riding' && r.state !== 'riding') leaves[r.leftBy] = (leaves[r.leftBy] || 0) + 1;
      prev = r.state; top = Math.max(top, r.vel.len()); r.events.length = 0;
      if (r.fallen) { falls++; break; }
    }
  }
  console.log(`boost ${boost} brace ${brace}: riding ${(100 * ride / (ride + air)).toFixed(0)}% of the time, avg speed ${(sumSp / n).toFixed(0)} m/s, top ${top.toFixed(0)}, left the surface ${JSON.stringify(leaves)}, falls ${falls}`);
}
