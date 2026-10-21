// Steps the water adds to the riding surface at lanes: scan the top surface over each lane's
// stretch of its host (a grid along and across) with water and with still water, at a few
// moments, and report the biggest jump between neighbouring points that still water does not
// have.
import { setup } from './netbot.mjs';
import { frameAt } from '../src/trapar/network.js';
const SW = setup({}), SC = setup({ waterOn: false });
for (const S of [SW, SC]) S.world.trapar.braids.update(40, { x: 0, z: 0 });
const lanesOf = (S) => {
  const B = S.world.trapar.braids, out = [];
  for (const b of B.net.bandsIn(-1800, 1800, -1800, 1800, 0, 0, 2000)) for (const ln of b.lanes) {
    const fr = frameAt(b, ln.sAtt, {});
    if (Math.hypot(fr.x, fr.z) < 1300) out.push({ b, ln });
  }
  return out;
};
const LW = lanesOf(SW), LC = lanesOf(SC);
console.log('lanes', LW.length, LC.length, 'calm', LW.filter((l) => l.ln.calm).length);
function grid(S, b, ln, tt) {
  S.world.update(tt, { x: 0, z: 0 });
  const T = S.world.trapar, g = [];
  for (let d = -10; d <= ln.len + 10; d += 3) {
    const fr = frameAt(b, ln.sAtt + ln.delta * d, {});
    const row = [];
    for (let u = -fr.wf; u <= fr.wf + 14; u += 1.5) {
      const X = ln.side * u;
      const x = fr.x + fr.rx * X, y0 = fr.y + fr.ry * X, z = fr.z + fr.rz * X;
      let top = null, prev = T.density(x + fr.ux * 9, y0 + fr.uy * 9, z + fr.uz * 9);
      for (let h = 8.8; h >= -9; h -= 0.2) {
        const r = T.density(x + fr.ux * h, y0 + fr.uy * h, z + fr.uz * h);
        if (prev < 1 && r >= 1) { top = h; break; }
        prev = r;
      }
      row.push(top);
    }
    g.push(row);
  }
  return g;
}
const N = Math.min(+(process.env.N || 40), LW.length), worst = [];
for (let k = 0; k < N; k++) {
  const idx = Math.floor((k * LW.length) / N), { b, ln } = LW[idx], c = LC[idx];
  let maxJ = 0, where = '';
  for (const tt of [40, 47.3, 55.1, 61.7]) {
    const gw = grid(SW, b, ln, tt), gc = grid(SC, c.b, c.ln, tt);
    for (let i = 0; i < gw.length; i++) for (let j = 0; j < gw[i].length; j++) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const a = gw[i][j], ca = gc[i][j], rw = gw[i + di], rc = gc[i + di];
        if (!rw || a === null || ca === null) continue;
        const e = rw[j + dj], ce = rc[j + dj];
        if (e === null || e === undefined || ce === null || ce === undefined) continue;
        if (Math.abs(ce - ca) > 0.4) continue;   // a step even in still water (an edge)
        const jmp = Math.abs(e - a) - (di ? 0.9 : 0.4);   // (beyond what a wave slope gives)
        if (jmp > maxJ) { maxJ = jmp; where = `t ${tt} d ${-10 + i * 3} u ${(j * 1.5).toFixed(1)} ${di ? 'along' : 'across'} ${a.toFixed(2)} -> ${e.toFixed(2)}`; }
      }
    }
  }
  worst.push(maxJ);
  console.log(`${b.kind} lane side ${ln.side} delta ${ln.delta} len ${ln.len.toFixed(0)}${ln.calm ? ' CALM' : ''}: worst extra step ${maxJ.toFixed(2)} m (${where})`);
}
worst.sort((a, b) => a - b);
console.log(`SUMMARY: median ${worst[worst.length >> 1].toFixed(2)}, 90% ${worst[Math.floor(worst.length * 0.9)].toFixed(2)}, max ${worst[worst.length - 1].toFixed(2)}`);
