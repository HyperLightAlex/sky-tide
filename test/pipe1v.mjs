import fs from 'fs';
let s = fs.readFileSync('./pipe2.mjs', 'utf8');
s = s.slice(0, s.indexOf('for (const skip of [0, 1, 2, 3])'));
s = s.replace("if (verbose && i % 6 === 0) console.log((i * dt).toFixed(2), r.state,", "if (verbose && i % 12 === 0) console.log((i * dt).toFixed(2), r.state, 'out', ((r.vel.x - r._lipFlow?.x||0)*(r.lipOut?.x||0) + (r.vel.z)*(r.lipOut?.z||0)).toFixed?.(1), 'lo', r.lipOut ? [r.lipOut.x.toFixed(2), r.lipOut.y.toFixed(2), r.lipOut.z.toFixed(2)].join(',') : '-', 'vy', r.vel.y.toFixed(1), 'up', r.up.y.toFixed(2),");
s += "console.log(JSON.stringify(run(1, 1, 24, 72)));\n";
fs.writeFileSync('./pipe1run.mjs', s);
