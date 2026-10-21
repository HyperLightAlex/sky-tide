// On-foot and dock tests: walk off an island, skydive, call the board; ride a dock onto an
// island (step off); step onto a dock and ride it off the island.
import { setup, inp, step, dt, bot } from './netbot.mjs';
import { frameAt } from '../src/trapar/network.js';
const S = setup({}); const { r, world } = S; const T = world.trapar, B = T.braids;
B.update(40, { x: 0, z: 0 });
const R = 4000;
const bands = B.net.bandsIn(-R, R, -R, R, 0, 0, R);
const isl = B.net.islandsIn(-R, R, -R, R).filter((I) => I.kind === 'layer');
const log = (...a) => console.log(...a);
const evs = () => { const e = r.events.map((x) => x.type + (x.into ? ':' + x.into.toFixed(0) : '') + (x.roll ? '(roll)' : '')).filter((x) => x !== 'freefall'); r.events.length = 0; return e; };

// A: walk off the edge, skydive, call the board.
{
  const I = isl[0];
  r.placeOnIsland(I);
  log(`A: on ${I.name} (${I.x.toFixed(0)},${I.y.toFixed(0)},${I.z.toFixed(0)}) mode ${r.mode} state ${r.state} y ${r.pos.y.toFixed(1)}`);
  r.camFwd = { x: 1, y: 0, z: 0 };
  const I_ = inp(); let t = 0, prev = '', summoned = false, offT = -1;
  for (let i = 0; i < 25 / dt; i++) {
    I_.trim = r.mode === 'foot' && r.state === 'walking' ? -1 : 0; I_.boost = r.mode === 'foot';
    I_.boardPressed = false;
    if (r.mode === 'foot' && r.state === 'skydiving' && offT >= 0 && t - offT > 1.5 && !summoned) { I_.boardPressed = true; summoned = true; }
    step(S, I_); t += dt;
    const st = r.mode + '/' + r.state + (r.falling ? ' F' : '');
    const e = evs();
    if (st !== prev || e.length) { log(`  ${t.toFixed(2)} ${st} y ${r.pos.y.toFixed(1)} v ${Math.hypot(r.vel.x, r.vel.z).toFixed(1)},${r.vel.y.toFixed(1)} ${e.join(' ')}`); prev = st; }
    if (r.state === 'skydiving' && offT < 0) offT = t;
    if (r.fallen || (summoned && r.mode === 'board' && t - offT > 6)) break;
  }
}

// B: ride a dock onto its island.
{
  const docks = bands.filter((b) => b.dock && b.dock.at === 'end');
  log('B: docks in', docks.length);
  let ok = 0;
  for (const b of docks.slice(0, 5)) {
    const s0 = Math.max(10, b.L - 420), fr = frameAt(b, s0, {});
    r.respawn(fr.x, fr.z, fr.y); world.update(S.st.t, r.pos);
    const q = r._project(fr.x + fr.ux * 2, fr.y + fr.uy * 2, fr.z + fr.uz * 2, r._q, 8, fr.ux, fr.uy, fr.uz);
    if (!q.ok) { log('  no surface'); continue; }
    r.pos.copy(q.p); r.normal.copy(q.n); r.up.copy(q.n); r.fwd.set(fr.tx, fr.ty, fr.tz).projectOnPlane(q.n).normalize(); r.right.crossVectors(r.fwd, r.up);
    r.vel.copy(r.fwd).scale(28); r.state = 'riding'; r.mode = 'board';
    const I_ = inp(); let t = 0, res = 'timeout', e = [];
    for (let i = 0; i < 40 / dt; i++) {
      if (r.mode === 'board' && r.state === 'riding') bot(S, I_); else I_.lean = 0;
      step(S, I_); t += dt; const ee = evs(); if (ee.some((x) => x.startsWith('wipe'))) ee.push(`@${r.pos.x.toFixed(0)},${r.pos.y.toFixed(0)},${r.pos.z.toFixed(0)} ${r.dbg.feature} ${r.leftBy}`); e.push(...ee);
      if (r.mode === 'foot' && r.state === 'walking' && r.footStun <= 0) { res = `on foot on ${r.footIsland ? r.footIsland.name : '?'} (${b.dock.island.name})`; ok++; break; }
      if (r.fallen) { res = 'FELL'; break; }
    }
    log(`  dock in L ${b.L.toFixed(0)}: ${res} after ${t.toFixed(1)} s · ${e.join(' ')}`);
  }
  log(`B: ${ok} reached their islands`);
}

// C: step onto a dock on an island and ride it off.
{
  const docks = bands.filter((b) => b.dock && b.dock.at === 'start');
  log('C: docks out / lips', docks.length);
  let ok = 0;
  for (const b of docks.slice(0, 6)) {
    const I = b.dock.island, fr = frameAt(b, 22, {});
    r.placeOnIsland(I, fr.x, fr.z);
    const I_ = inp(); I_.boardPressed = true;
    step(S, I_); I_.boardPressed = false;
    const e0 = evs();
    let t = 0, res = 'timeout', e = [], far = 0;
    for (let i = 0; i < 75 / dt && r.mode === "board"; i++) {
      if (r.state === 'riding') bot(S, I_); else I_.lean = 0;
      step(S, I_); t += dt; e.push(...evs());
      if (r.state === 'riding' && Math.hypot(r.pos.x - I.x, r.pos.z - I.z) > I.Rmax + 300) { far = 1; }
      if (far && r.dbg.feature !== 'dock' && r.state === 'riding') { res = `off the island onto ${r.dbg.feature}`; ok++; break; }
      if (r.fallen) { res = 'FELL'; break; }
    }
    log(`  ${b.dock.lip ? 'lip' : 'dock out'} on ${I.name}: mount ${e0.join(' ')} -> ${r.mode === 'board' ? res : 'still on foot'} after ${t.toFixed(1)} s · ${e.slice(0, 8).join(' ')}`);
  }
  log(`C: ${ok} rode off their islands`);
}
