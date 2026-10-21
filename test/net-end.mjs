// What is ahead where the branch "ends"?
import fs from 'fs';
let s = fs.readFileSync('./net-fork.mjs', 'utf8');
s = s.replace("const starts = [[0, 0], [3000, 1500], [-4000, 2500], [5000, -4000], [-6000, -6000], [8000, 3000], [1200, -7000], [-2500, 6500]];", "const starts = [[3000, 1500]];");
s = s.replace("    follow(S, I); I.brace = brace; step(S, I);", `    const pp = r.pos.clone(), vv = r.vel.clone();
    follow(S, I); I.brace = brace; step(S, I);
    if (prev === 'riding' && r.state !== 'riding') {
      const net = world.trapar.braids.net; const bands = net.bandsIn(pp.x - 30, pp.x + 30, pp.z - 30, pp.z + 30);
      for (const b of bands) { let bi = -1, bd = 1e9; for (let k = 0; k < b.n; k++) { const d = Math.hypot(b.x[k] - pp.x, b.y[k] - pp.y, b.z[k] - pp.z); if (d < bd) { bd = d; bi = k; } }
        if (bd < 20) { console.log(b.kind, 'n', b.n, 'idx', bi, 'L', b.L.toFixed(0), 'd', bd.toFixed(1)); for (let k = Math.max(0, bi - 3); k < Math.min(b.n, bi + 5); k++) console.log('  ', k, b.x[k].toFixed(1), b.y[k].toFixed(1), b.z[k].toFixed(1), 'pres', b.pres[k].toFixed(2), 'cord', b.cord[k].toFixed(2), 'w', b.w[k].toFixed(1), 'tag', b.tag[k]); } }
      process.exit(0);
    }`);
fs.writeFileSync('./net-end-run.mjs', s);
