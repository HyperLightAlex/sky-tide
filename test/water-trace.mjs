// Ride a trunk and log how the water moves the rider: speed, surface offset, surface speed.
import { setup, inp, step, bot, dt } from './netbot.mjs';
const S = setup(); const { r, world } = S;
const sx = +(process.env.SX || 0), sz = +(process.env.SZ || 0);
r.respawn(sx, sz, world.trapar.refAltitude(sx, sz));
const I = inp(); const T = world.trapar;
let mn = 1e9, mx = 0, hmax = 0, vmax = 0, onSw = 0;
for (let i = 0; i < 120 * +(process.env.SECS || 40); i++) {
  bot(S, I, 0); I.crouch = !!process.env.PUMP && r.state === 'riding'; if (process.env.TUCK) I.trim = -1; step(S, I); onSw += (r.onSwell || 0) > 0.4 ? dt : 0;
  const n = r.normal, F = T.sample(r.pos.x - n.x * 0.4, r.pos.y - n.y * 0.4, r.pos.z - n.z * 0.4, {});
  const sp = r.vel.len(); mn = Math.min(mn, sp); mx = Math.max(mx, sp); hmax = Math.max(hmax, Math.abs(F.waterH)); vmax = Math.max(vmax, Math.abs(F.surfV));
  if (i % 60 === 0) console.log((i * dt).toFixed(1), r.state, r.dbg.feature, 'sp', sp.toFixed(1), 'h', F.waterH.toFixed(2), 'surfV', F.surfV.toFixed(2), 'swell', F.swell.toFixed(2), 'rap', F.rapids.toFixed(2), 'flow', F.flowSpeed.toFixed(0), 'onSwell', (r.onSwell || 0).toFixed(2), 'c', F.swellSpeed.toFixed(1));
  for (const e of r.events) if (e.type !== 'spawn') console.log('   ev', (i * dt).toFixed(2), e.type, e.reason || '', r.leftBy || '', 'into', (e.into || 0).toFixed(1));
  if (r.state !== 'riding' && r._was === 'riding') console.log('   LEAVE', (i * dt).toFixed(2), r.leftBy, 'kappa', r.dbg.kappa.toFixed(3), 'need', r.holdNeed.toFixed(1), 'v', r.vel.len().toFixed(1), 'feat', r.dbg.feature);
  if (process.env.PROBE && r.state !== 'riding' && r._was === 'riding' && r.dbg.kappa === 10) {
    const p = r._lastP, n = r._lastN, v = r.vel, vl = v.len();
    const B = world.trapar.braids;
    for (const D of [0, 2, 4, 6, 8, 10]) {
      const x = p.x + v.x / vl * D, y = p.y + v.y / vl * D, z = p.z + v.z / vl * D;
      let line = '';
      for (let k = -4; k <= 4; k += 0.5) line += T.density(x + n.x * k, y + n.y * k, z + n.z * k).toFixed(1) + ' ';
      const info = {}; T._eval(x - n.x, y - n.y, z - n.z, info);
      const ax = B.nearestAxis(x, y, z, {});
      console.log('    D', D, line, 'h', (info.h || 0).toFixed(2), ax ? `lat ${ax.lat.toFixed(1)} w ${ax.w.toFixed(1)} wf ${ax.wf.toFixed(1)} cls ${ax.cls} tags ${ax.tags}` : '');
    }
  }
  if (r.state === 'riding') { r._lastP = r.pos.clone(); r._lastN = r.normal.clone(); }
  r._was = r.state; r.events.length = 0;
  if (r.fallen) { console.log('FELL'); break; }
}
console.log('on a swell', onSw.toFixed(1), 's; speed', mn.toFixed(1), '..', mx.toFixed(1), 'max |h|', hmax.toFixed(2), 'max surface speed', vmax.toFixed(2));
