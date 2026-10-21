// Free fall + flying: drop the rider into the air over open sky (off to the side of a main
// layer trunk), then (FLY=1) fly to the boost target as a player would: aim the nose at it
// with lean, hold boost, let go once a landing is close, brace late. Reports where each run
// lands and how much height it kept.
import { setup, inp, step, dt, bot } from './netbot.mjs';
const N = +(process.env.N || 10), FLY = +(process.env.FLY || 0), OFF = +(process.env.OFF || 220), UP = +(process.env.UP || 60);
const S = setup({}); const { r, world, P } = S;
let landed = 0, fell = 0, keptSum = 0, wipe = 0, clean = 0, flyT = 0;
for (let k = 0; k < N; k++) {
  const ang = (k / N) * Math.PI * 2 + 0.3, R = 900 + 400 * (k % 3);
  r.respawn(Math.cos(ang) * R, Math.sin(ang) * R, P.netBase + P.layerGap);
  if (r.state !== 'riding') { console.log('no spawn'); continue; }
  world.update(S.st.t, r.pos);
  // Off to the side, a bit up, moving sideways.
  const f = r.fwd, sx = -f.z, sz = f.x, sl = Math.hypot(sx, sz) || 1;
  const y0 = r.pos.y;
  r.pos.set(r.pos.x + (sx / sl) * OFF, r.pos.y + UP, r.pos.z + (sz / sl) * OFF);
  r.vel.set((sx / sl) * 15, 0, (sz / sl) * 15);
  r.state = 'freefall'; r.airT = 0; r.catchBlock = 0; r.popT = 0; r.leftBy = 'pop'; r.popUsed = true;
  r.up.set(0, 1, 0); r.fwd.set(sx / sl, 0, sz / sl); r.right.crossVectors(r.fwd, r.up); r.gauge = 1;
  const I = inp(); let t = 0, out = 'timeout', how = '', fellIn = 0, flew = 0, startFall = -1, tgt0 = null;
  for (let i = 0; i < 40 / dt; i++) {
    I.lean = 0; I.trim = 0; I.boost = false; I.brace = 0;
    const pr = r.predict, soon = pr && pr.hit && pr.ridable && pr.t < 1.4;
    // As a player would: fly at the boost target until the landing marker sits on the middle
    // of a stream, then line the board up with that stream for the catch.
    const B = world.trapar.braids;
    let good = false, ax = null;
    if (pr && pr.hit && pr.ridable) {
      ax = B.nearestAxis(pr.point.x, pr.point.y - 1, pr.point.z, {});
      good = ax && Math.abs(ax.lat) < Math.max(3, ax.wf + 0.25 * (ax.w - ax.wf));
    }
    if (FLY && r.state !== 'riding' && r.falling && !good && !(pr && pr.hit && pr.t < 1.0)) {
      const tg = r.boostTarget;
      if (tg) {
        if (!tgt0) tgt0 = { ...tg };
        const dx = tg.x - r.pos.x, dz = tg.z - r.pos.z;
        let d = Math.atan2(dz, dx) - Math.atan2(r.fwd.z, r.fwd.x); d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        I.lean = Math.max(-1, Math.min(1, d * 2));
        I.boost = true;
      }
    } else if (r.state !== 'riding' && ax && pr.t < 2.5) {
      let tx = ax.tx, tz = ax.tz; if (tx * r.fwd.x + tz * r.fwd.z < 0) { tx = -tx; tz = -tz; }
      let d = Math.atan2(tz, tx) - Math.atan2(r.fwd.z, r.fwd.x); d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      I.lean = Math.max(-1, Math.min(1, d * 1.5));
    }
    if (r.state !== 'riding' && pr && pr.hit && pr.t < 1.0) I.brace = 1;
    if (r.state === 'riding') { I.brace = 1; bot(S, I); }
    if (r.flying) flew += dt;
    if (r.falling && startFall < 0) startFall = t;
    step(S, I); t += dt;
    if (process.env.TRACE && k === +process.env.TRACE && i % 30 === 0) { const tg = r.boostTarget; console.log(`  ${t.toFixed(2)} ${r.state}${r.falling ? ' F' : ''}${r.flying ? ' FLY' : ''} y ${r.pos.y.toFixed(0)} v ${Math.hypot(r.vel.x, r.vel.z).toFixed(1)},${r.vel.y.toFixed(1)} head ${(Math.atan2(r.fwd.z, r.fwd.x) * 57.3).toFixed(0)} vel ${(Math.atan2(r.vel.z, r.vel.x) * 57.3).toFixed(0)} g ${r.gauge.toFixed(2)} lean ${I.lean.toFixed(2)} tg ${tg ? `${(Math.atan2(tg.z - r.pos.z, tg.x - r.pos.x) * 57.3).toFixed(0)}deg d ${Math.hypot(tg.x - r.pos.x, tg.z - r.pos.z).toFixed(0)} dh ${(tg.y - r.pos.y).toFixed(0)} need ${tg.need.toFixed(2)}` : '-'} pred ${pr && pr.hit ? pr.t.toFixed(1) + (pr.ridable ? 'R' : 'X') : pr && pr.floor ? 'floor' : '-'}`); }
    for (const e of r.events) if (['clean', 'sketchy', 'wipeout'].includes(e.type)) how = e.type + (e.into ? ` into ${e.into.toFixed(0)}` : '') + (e.reason ? ' ' + e.reason : '');
    if (process.env.TRACE && k === +process.env.TRACE) for (const e of r.events) console.log('   ev', e.type, e.reason || '', r.leftBy || '');
    r.events.length = 0;
    if (process.env.TRACE && k === +process.env.TRACE && (r.state === 'riding' || r.airT < 0.3) && t > 1) console.log(`   . ${t.toFixed(3)} ${r.state} ${r.dbg.feature} tier ${r.dbg.netLayer} y ${r.pos.y.toFixed(1)} v ${r.vel.len().toFixed(1)} vy ${r.vel.y.toFixed(1)} n ${r.normal.x.toFixed(2)},${r.normal.y.toFixed(2)},${r.normal.z.toFixed(2)} kap ${(r.dbg.kappa || 0).toFixed(3)} need ${(r.holdNeed || 0).toFixed(1)} marg ${(r.holdMargin || 0).toFixed(1)} left ${r.leftBy}`);
    if (r.fallen) { out = 'FELL'; fell++; break; }
    if (r.state === 'riding' && r.rideT > 2) { out = 'landed'; landed++; break; }
  }
  const kept = r.pos.y - y0;
  if (out === 'landed') { keptSum += kept; if (how.startsWith('wipe')) wipe++; if (how.startsWith('clean')) clean++; }
  flyT += flew;
  console.log(`run ${k}: ${out} after ${t.toFixed(1)} s (free fall from ${startFall.toFixed(1)} s, flew ${flew.toFixed(1)} s) ${how} · height vs start layer ${kept.toFixed(0)} m · layer ${['tangle', 'main', 'crown'][r.dbg.netLayer] || '-'} ${tgt0 ? `· target ${tgt0.dh.toFixed(0)} m, ${tgt0.d.toFixed(0)} m away, need ${(tgt0.need * 100).toFixed(0)}%` : ''}`);
}
console.log(`SUMMARY fly ${FLY}: landed ${landed}, fell ${fell}, clean ${clean}, wipeouts ${wipe}, mean height vs start ${(keptSum / Math.max(1, landed)).toFixed(0)} m, flew ${(flyT / N).toFixed(1)} s avg`);
