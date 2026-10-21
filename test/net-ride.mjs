import { setup, inp, step, bot, dt } from './netbot.mjs';
const starts = [[0, 0], [3000, 1500], [-4000, 2500], [5000, -4000], [-6000, -6000], [8000, 3000], [1200, -7000], [-2500, 6500]];
const brace = +(process.env.BRACE || 0), secs = +(process.env.SECS || 60), bias = +(process.env.BIAS || 0);
let tot = { ride: 0, air: 0, falls: 0 }, left = {}, feats = {}, events = {};
for (const [sx, sz] of starts) {
  const S = setup(); const { r, world } = S;
  r.respawn(sx, sz, world.trapar.refAltitude());
  const I = inp(); let ride = 0, air = 0; const fl = {};
  let prev = r.state;
  for (let i = 0; i < 120 * secs; i++) {
    bot(S, I, bias); I.brace = brace; step(S, I);
    if (r.state === 'riding') { ride += dt; fl[r.dbg.feature] = (fl[r.dbg.feature] || 0) + dt; } else air += dt;
    if (prev === 'riding' && r.state !== 'riding') left[r.leftBy] = (left[r.leftBy] || 0) + 1;
    prev = r.state;
    for (const e of r.events.splice(0)) events[e.type + (e.reason ? ':' + e.reason : '')] = (events[e.type + (e.reason ? ':' + e.reason : '')] || 0) + 1;
    if (r.fallen) { tot.falls++; break; }
  }
  for (const k in fl) feats[k] = (feats[k] || 0) + fl[k];
  tot.ride += ride; tot.air += air;
  console.log(`start ${sx},${sz}: rode ${ride.toFixed(1)} s, air ${air.toFixed(1)} s${r.fallen ? ' FELL' : ''}, top ${r.stats.maxSpeed.toFixed(0)} m/s, ${Object.entries(fl).map(([k, v]) => k + ' ' + v.toFixed(0)).join(', ')}`);
}
console.log('TOTAL ride', tot.ride.toFixed(0), 'air', tot.air.toFixed(0), 'falls', tot.falls, 'left by', JSON.stringify(left), 'events', JSON.stringify(events));
console.log('features', JSON.stringify(Object.fromEntries(Object.entries(feats).map(([k, v]) => [k, +v.toFixed(0)]))));
