import { setup, inp, step, bot, dt } from './netbot.mjs';
const starts = (process.env.STARTS || '0,0').split(';').map(s => s.split(',').map(Number));
for (const [sx, sz] of starts) {
  const S = setup(); const { r, world } = S;
  r.respawn(sx, sz, world.trapar.refAltitude());
  const I = inp(); let prev = r.state; const hist = [];
  for (let i = 0; i < 120 * 90; i++) {
    bot(S, I, +(process.env.BIAS || 0)); I.brace = +(process.env.BRACE || 0); step(S, I);
    const qq = world.trapar.braids.nearestAxis(r.pos.x, r.pos.y, r.pos.z, {}); hist.push(`${(i * dt).toFixed(2)} ${r.state} lat=${qq ? qq.lat.toFixed(1) + '/' + qq.w.toFixed(0) + ' c' + qq.cls : '-'} f=${r.dbg.feature} ny=${r.normal.y.toFixed(2)} k=${r.dbg.kappa.toFixed(3)} sp=${r.vel.len().toFixed(1)} need=${r.holdNeed.toFixed(1)} marg=${r.holdMargin.toFixed(1)} lean=${I.lean.toFixed(2)} face=${r.face}`);
    if (hist.length > 40) hist.shift();
    if (prev === 'riding' && r.state !== 'riding') { console.log(`--- ${sx},${sz} left by ${r.leftBy} at ${(i * dt).toFixed(2)}`); console.log(hist.slice(-12).join('\n')); break; }
    prev = r.state;
  }
}
