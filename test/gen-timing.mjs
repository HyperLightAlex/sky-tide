import { generateNoiseBank, sampleVolume } from '../src/sky/noise.js';
const t0 = performance.now();
const bank = await generateNoiseBank(()=>{});
console.log('gen ms', (performance.now()-t0).toFixed(0));
for (const [k,v] of Object.entries(bank)) {
  for (let c=0;c<v.channels;c++){ const a=v.ch[c]; let s=0; const h=new Array(10).fill(0); for(const x of a){s+=x; h[Math.min(9,Math.floor(x*10))]++;} console.log(k,c,'mean',(s/a.length).toFixed(3),'hist',h.map(n=>(n/a.length*100).toFixed(0)).join(' ')); }
}
