import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams();
const sky = new SkyWorld(bank, P);
let t = 30; sky.update(t, {x:0,z:0});
const r = new Rider(sky, P);
console.log('spawned', r.respawn(0, 0, 700), r.pos);
const inp = { lean: 0, trim: 0, brake: 0, dig: 0, crouch: false, crouchReleased: false };
const dt = 1/120;
function run(seconds, script, label) {
  const counts = {}; let prev = r.state; const trans = [];
  for (let i = 0; i < seconds/dt; i++) {
    const tt = i*dt;
    inp.crouchReleased = false;
    script && script(tt, inp);
    t += dt; sky.update(t, r.pos);
    r.step(dt, inp);
    counts[r.state] = (counts[r.state]||0)+1;
    if (r.state !== prev) { trans.push(`${tt.toFixed(2)}:${prev}->${r.state}`); prev = r.state; }
    for (const e of r.events.splice(0)) trans.push(`${tt.toFixed(2)}:EVENT ${e.type}${e.gain!==undefined?' gain='+e.gain.toFixed(1)+' into='+e.into.toFixed(1)+' q='+e.quality.toFixed(2):''}`);
    if (r.fallen) { trans.push('FELL at '+tt.toFixed(2)); r.respawn(r.lastSafe.x, r.lastSafe.z, r.lastSafe.y); }
  }
  const pct = Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,(v*dt).toFixed(1)+'s']));
  console.log(`\n== ${label}: pos ${r.pos.x.toFixed(0)},${r.pos.y.toFixed(0)},${r.pos.z.toFixed(0)} speed ${r.speed().toFixed(1)} rel ${r.dbg.speedRel.toFixed(1)} state ${r.state} rho ${r.dbg.rho.toFixed(2)} thr ${r.dbg.thr.toFixed(2)} e ${r.dbg.e.toFixed(2)} layer ${r.dbg.layer}`);
  console.log('   time in states', JSON.stringify(pct));
  console.log('   ', trans.slice(0, 30).join(' | '));
}
run(10, null, 'idle 10s');
run(10, (tt, i) => { i.lean = Math.sin(tt*1.2); i.trim = -0.5; }, 'carving slalom tucked');
run(4, (tt, i) => { i.lean = 0; i.trim = 0; i.crouch = tt < 0.5; if (tt >= 0.5 && tt < 0.5+dt) i.crouchReleased = true; }, 'charged pop');
run(20, (tt, i) => { i.lean = 0.3; i.trim = -1; i.crouch = false; }, 'tuck straight w/ slight lean 20s');
console.log('stats', r.stats);
