// A bot follows the route trail to islands, as a player would with the guide: steer at the
// trail a little ahead, pop where it says drop or fly, fly (boost) at the landing on flights,
// steer at the landing in the air, brace late. Reports how many it reaches, in what time.
import { setup, inp, step, dt } from './netbot.mjs';
import { RouteGuide } from '../src/world/guide.js';
import { RK, carry, fallTime } from '../src/trapar/route.js';
const N = +(process.env.N || 8), TMAX = +(process.env.TMAX || 420), MIN = +(process.env.MIN || 1500), MAX = +(process.env.MAX || 4500);
const S = setup(); const { r, world } = S;
if (process.env.NOFLY) { const m = await import('../src/trapar/route.js'); m.RT.FLY_ON = false; }
r.respawn(0, 0, world.trapar.refAltitude());
const I = inp();
for (let k = 0; k < 60; k++) step(S, I);
const p0 = { x: r.pos.x, y: r.pos.y, z: r.pos.z };
const isl = world.trapar.islandsIn(p0.x - MAX, p0.x + MAX, p0.z - MAX, p0.z + MAX).filter((J) => { const d = Math.hypot(J.x - p0.x, J.z - p0.z); return d > MIN && d < MAX; });
const ang = (x, z) => Math.atan2(z, x);
const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
let reached = 0, fellTot = 0;
const TR = process.env.TRACE != null ? +process.env.TRACE : -1;
for (let k = 0; k < Math.min(N, isl.length); k++) {
  const D = isl[k];
  r.respawn(0, 0, world.trapar.refAltitude());
  for (let q = 0; q < 30; q++) step(S, I);
  const G = new RouteGuide(world.trapar.braids);
  r.camFwd = { x: 1, z: 0 };
  G.set(D);
  let t = 0, popT = -1, flying = false, out = 'timeout', falls = 0, eta0 = null, lastStep = null, air = 0;
  for (let i = 0; i < TMAX / dt; i++) {
    G.update(dt, r);
    I.lean = 0; I.trim = 0; I.boost = false; I.brace = 0; I.crouchReleased = false; I.boostPressed = false; I.boardPressed = false;
    const P = G.path;
    if (P && eta0 === null) eta0 = P.eta;
    if (P) {
      const pts = P.pts, cur = G.cur;
      if (r.state === 'riding') {
        flying = false;
        // Steer at the trail ahead.
        const ahead = G.s + 14 + r.vel.len() * 0.5;
        let j = cur; while (j < P.n - 1 && P.cum[j] < ahead && ![RK.DROP, RK.FLY, RK.LAND].includes(pts[j * 7 + 6])) j++;
        let dx = pts[j * 7] - r.pos.x, dy = pts[j * 7 + 1] - r.pos.y, dz = pts[j * 7 + 2] - r.pos.z;
        const n = r.normal, dn = dx * n.x + dy * n.y + dz * n.z; dx -= n.x * dn; dy -= n.y * dn; dz -= n.z * dn;
        const f = r.fwd, cx = f.y * dz - f.z * dy, cy = f.z * dx - f.x * dz, cz = f.x * dy - f.y * dx;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const s = (cx * n.x + cy * n.y + cz * n.z) / dl, c = (f.x * dx + f.y * dy + f.z * dz) / dl;
        I.lean = Math.max(-1, Math.min(1, -Math.atan2(s, c) * 2.2));
        I.brace = 1;
        // (just landed fast: brake a little so the stream holds you)
        if (r.rideT < 3 && r.vel.len() > 34) I.trim = 0.7;
        // Jump off where the route leaves the stream (the board button).
        const nx = G.next;
        if (nx && ['drop', 'fly', 'land', 'flyland'].includes(nx.type) && nx.dist < 8) { I.boardPressed = true; lastStep = nx; }
        I.crouch = false;
      } else {
        I.crouch = false;
        // In the air: where the route comes down (the end of this drop or flight).
        let j = cur; while (j < P.n - 1 && [RK.DROP, RK.FLY, RK.LAND].includes(pts[j * 7 + 6])) j++;
        if (j === cur) j = Math.min(P.n - 1, cur + 1);
        const tx = pts[j * 7], ty = pts[j * 7 + 1], tz = pts[j * 7 + 2];
        const ddx = tx - r.pos.x, ddz = tz - r.pos.z, hd = Math.hypot(ddx, ddz);
        if (G.next && G.next.dist < 8 && ['drop', 'fly', 'land', 'flyland'].includes(G.next.type)) lastStep = G.next;
        const type = lastStep ? lastStep.type : 'drop';
        if (k === TR && i % 30 === 0 && process.env.AIR) console.log(`      air ${r.mode} hd ${hd.toFixed(0)} above ${(r.pos.y - ty).toFixed(0)} v ${r.vel.x.toFixed(1)},${r.vel.z.toFixed(1)} to ${(ddx / (hd || 1)).toFixed(2)},${(ddz / (hd || 1)).toFixed(2)} lean ${I.lean.toFixed(2)} trim ${I.trim.toFixed(2)} j ${j} type ${type}`);
        if (r.mode === 'foot') {
          // Skydiving: drift at the landing; call the board in time (not for an island).
          // (aim where you will be when the board catches you: allow for your speed)
          const above = r.pos.y - ty, tl = Math.max(0.5, above / Math.max(20, -r.vel.y + 1));
          const ex = ddx - r.vel.x * Math.min(tl, 1.2), ez = ddz - r.vel.z * Math.min(tl, 1.2), el = Math.hypot(ex, ez);
          const m = Math.min(1, el / 8);
          I.lean = el > 0.3 ? (ez / el) * m : 0; I.trim = el > 0.3 ? -(ex / el) * m : 0;
          const call = type === 'fly' || type === 'flyland' ? r.airT > 0.3 : type === 'land' ? false : above < 30 + Math.abs(r.vel.y) * 0.9;
          if (call && r.summonT <= 0) I.boardPressed = true;
        } else {
          // On the board: fly at the landing on a flight; else line up with the stream.
          const pr = r.predict, soon = pr && pr.hit && pr.t < 1.1;
          const nx = G.next;
          if (nx && nx.type === 'drop' && nx.dist < 8 && !soon) { I.boardPressed = true; lastStep = nx; }
          const d = wrap(ang(ddx, ddz) - ang(r.fwd.x, r.fwd.z));
          const isFly = type === 'fly' || type === 'flyland';
          // (boost off once your speed would carry you there as you fall)
          let flyEnd = j; while (flyEnd > cur && pts[flyEnd * 7 + 6] !== RK.FLY) flyEnd--;
          const stillFly = pts[cur * 7 + 6] === RK.FLY || (flyEnd > cur && pts[flyEnd * 7 + 6] === RK.FLY);
          const prMiss = pr && pr.hit ? Math.hypot(pr.point.x - tx, pr.point.z - tz) : 999;
          // (fly until your speed would carry you there as you fall: watch where you would land)
          const vh = Math.hypot(r.vel.x, r.vel.z), above = r.pos.y - ty;
          const carryNow = carry(fallTime(Math.max(0, above), r.vel.y, S.P), vh);
          if (isFly && carryNow < hd - 10 && !soon && above > 15) { I.lean = Math.max(-1, Math.min(1, d * 2)); I.boost = Math.abs(d) < 0.8; }
          else if (!soon && above > 90 && prMiss > 15 && prMiss < 120 && type !== 'flyland' && type !== 'land') { I.boardPressed = true; }   // (off the board to steer down, call it back lower)
          else {
            // the trail's direction where it lands
            const j2 = Math.min(P.n - 1, j + 2);
            const fx = pts[j2 * 7] - pts[j * 7], fz = pts[j2 * 7 + 2] - pts[j * 7 + 2];
            const dd = Math.hypot(fx, fz) > 0.5 ? wrap(ang(fx, fz) - ang(r.fwd.x, r.fwd.z)) : d;
            I.lean = Math.max(-1, Math.min(1, dd * 1.2));
          }
          if (soon) I.brace = 1;
        }
      }
    }
    step(S, I); t += dt;
    if (r.mode !== 'foot') air = 0;
    if (k === TR && i % 120 === 0) console.log(`   ${t.toFixed(0)}s ${r.mode}/${r.state} cur ${G.cur}/${P ? P.n : 0} off ${G.off.toFixed(0)} next ${G.next ? G.next.type + ' ' + G.next.dist.toFixed(0) : '-'} y ${r.pos.y.toFixed(0)} v ${r.vel.len().toFixed(0)} plans ${G.stats.plans} ${P && P.partial ? 'partial' : ''} ${G.failed || ''}`);
    for (const e of r.events) if (k === TR && ['pop', 'clean', 'sketchy', 'wipeout', 'stepOff', 'fell', 'freefall', 'leave'].includes(e.type)) console.log(`     ev ${e.type} at ${t.toFixed(1)} ${r.leftBy || ''} ${e.reason || ''} feat ${r.dbg.feature} [${[r.pos.x, r.pos.y, r.pos.z].map(Math.round)}]`);
    r.events.length = 0;
    if (r.fallen) { falls++; r.respawn(r.lastSafe.x, r.lastSafe.z, r.lastSafe.y); G.invalidate(); if (falls > 3) { out = 'fell'; break; } }
    if (r.mode === 'foot' && r.footIsland && r.footIsland.id === D.id) { out = 'reached'; break; }
    if (r.mode === 'foot' && r.state === 'walking' && r.footIsland && r.footIsland.id !== D.id) { out = 'wrong island ' + r.footIsland.name; break; }
  }
  if (out === 'reached') reached++;
  fellTot += falls;
  console.log(`${D.name.padEnd(14)} ${(Math.hypot(D.x - p0.x, D.z - p0.z) / 1000).toFixed(1)} km dy ${Math.round(D.y - p0.y)}: ${out} in ${t.toFixed(0)} s (first eta ${eta0 ? eta0.toFixed(0) : '-'}), falls ${falls}, plans ${G.stats.plans}`);
}
console.log(`reached ${reached} of ${Math.min(N, isl.length)}, falls ${fellTot}`);
