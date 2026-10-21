import fs from 'fs';
const src = fs.readFileSync('./brace-tests.mjs', 'utf8');
let head = src.slice(0, src.indexOf("if (!only || only.includes('pipe'))"));
head += `
for (const brace of [0, 1]) {
  const S = setup(); const { r, world } = S; const B = world.trapar.braids;
  const ft = findFeature(B, (sg, o) => sg[o + 23] > 0.9, 3, 0);
  place(r, ft, 30, 0.75); const y0 = r.pos.y;
  const I = inp(); console.log('--- brace', brace);
  for (let i = 0; i < 120 * 6; i++) {
    I.brace = brace; I.lean = 0; step(S, I);
    const F = world.trapar.sample(r.pos.x, r.pos.y - 1, r.pos.z, {});
    if (i % 24 === 0) console.log((i*dt).toFixed(1), r.state, 'dy', (r.pos.y - y0).toFixed(1), 'ny', r.normal.y.toFixed(2), 'upy', r.up.y.toFixed(2), 'sp', r.vel.len().toFixed(0), 'feat', F.feature, 'rho', r.dbg.rho.toFixed(2), 'lip', !!r.lipOut);
    for (const e of r.events.splice(0)) console.log('   event', e.type, e.through ? 'through' : '');
    if (r.fallen) break;
  }
}
`;
fs.writeFileSync('./pipebrun.mjs', head);
