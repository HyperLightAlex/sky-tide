import { setup, inp, step, bot, dt } from './netbot.mjs';
const [sx, sz] = (process.env.START || '1200,-7000').split(',').map(Number);
const S = setup(); const { r, world } = S;
r.respawn(sx, sz, world.trapar.refAltitude());
const I = inp();
const net = world.trapar.braids.net;
for (let i = 0; i < 120 * 60; i++) {
  bot(S, I, 0); step(S, I);
  if (i % 120 === 0) {
    const bands = net.bandsIn(r.pos.x - 50, r.pos.x + 50, r.pos.z - 50, r.pos.z + 50);
    let best = null;
    for (const b of bands) for (let k = 0; k < b.n; k++) { const d = Math.hypot(b.x[k] - r.pos.x, b.y[k] - r.pos.y, b.z[k] - r.pos.z); if (!best || d < best.d) best = { d, k, b }; }
    console.log(`${(i * dt).toFixed(0)} ${r.state} ${r.dbg.feature} y=${r.pos.y.toFixed(0)} sp=${r.vel.len().toFixed(1)} band=${best ? best.b.kind + '#' + best.k + ' bs=' + (best.b.bs ? best.b.bs[best.k].toFixed(0) : '') + ' d=' + best.d.toFixed(1) : '-'}`);
  }
  if (r.fallen) { console.log('fell'); break; }
}
