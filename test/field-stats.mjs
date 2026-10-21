import { loadBank } from './bank.mjs';
import { Sky } from '../src/sky/field.js';
import { PARAMS } from '../src/config.js';
const bank = await loadBank();
const sky = new Sky(bank, PARAMS);
sky.update(100);
const S = sky.S;
console.log('cloud band', S.uCloudLo.toFixed(0), S.uCloudHi.toFixed(0), 'decks', Array.from(S.uDeckBase).slice(0,3));
// altitude profile of density coverage
const rows = [];
for (let y = Math.floor(S.uCloudLo/50)*50; y <= S.uCloudHi; y += 50) {
  let above = 0, any = 0, mist = 0, n = 0; const kinds = {};
  const out = {};
  for (let x = -6000; x < 6000; x += 97) for (let z = -6000; z < 6000; z += 97) {
    sky.sample(x, y, z, out); n++;
    if (out.rho >= 1) { above++; kinds[out.dominant] = (kinds[out.dominant]||0)+1; }
    else if (out.rho > 0.06) mist++;
  }
  rows.push(`${String(y).padStart(5)}  ride ${(above/n*100).toFixed(1).padStart(5)}%  mist ${(mist/n*100).toFixed(1).padStart(5)}%  ${JSON.stringify(kinds)}`);
}
console.log(rows.join('\n'));
// skins at a few columns
for (const [x,z] of [[0,0],[300,200],[-800,500],[1500,-1200]]) console.log('skins', x, z, sky.findSkins(x, z, 1).map(v=>v.toFixed(1)));
// timing
let t0 = performance.now(), s = 0; for (let i = 0; i < 100000; i++) s += sky.density((i%300)*7, 300 + (i%900), (i*13)%5000);
console.log('density eval us', ((performance.now()-t0)/100000*1000).toFixed(2));
