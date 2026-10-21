import fs from 'fs';
const src = fs.readFileSync('./brace-tests.mjs', 'utf8');
const cut = src.indexOf("if (!only || only.includes('pipe'))");
let head = src.slice(0, cut);
head += `
for (const skip of [0, 2]) for (const brace of [1]) {
  const S = setup(); const { r, world } = S; const B = world.trapar.braids;
  const ft = findFeature(B, (sg, o) => sg[o + 22] > 0.9, 4, skip);
  place(r, ft, 30);
  const I = inp(); const log = [];
  for (let i = 0; i < 120 * 20; i++) {
    const F = bot(S, I, 0.7); I.brace = brace; step(S, I);
    const G = world.trapar.sample(r.pos.x - r.up.x*1.5, r.pos.y - r.up.y*1.5, r.pos.z - r.up.z*1.5, {});
    if (i % 60 === 0) log.push(\`t\${(i*dt).toFixed(1)} \${r.state} feat=\${F.feature} G=\${G.feature} ny=\${r.normal.y.toFixed(2)} sp=\${r.vel.len().toFixed(0)} y=\${r.pos.y.toFixed(0)} str=\${F.stream.toFixed(2)}\`);
    if (r.fallen) break;
  }
  console.log('--- skip', skip); console.log(log.join('\\n'));
}
`;
fs.writeFileSync('./sp0run.mjs', head);
