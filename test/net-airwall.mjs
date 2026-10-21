// In the air, boost straight at a stream wall: bounce, land on it, or go through?
import { setup, inp, step, dt, V3 } from './netbot.mjs';
const res = {};
for (const kind of ['plain', 'pipe']) for (const tilt of [0, 0.6, 1.2]) for (const skip of [0, 1, 2, 3]) {
  const S = setup({ boostInfinite: true }); const { r, world } = S; const B = world.trapar.braids, seg = B.seg;
  world.update(40, { x: 3000, z: 2000 });
  let o = -1, f = 0;
  for (let s = 0; s < B.nSeg; s++) { const oo = s * 32; if (Math.floor(seg[oo + 3] / 1000) !== 1 || seg[oo + 16] < 0.99 || seg[oo + 9] < 0.98) continue; if (Math.hypot(seg[oo] - B.cx, seg[oo + 2] - B.cz) > 1500) continue; const t = seg[oo + 27]; if (kind === 'pipe' ? !(t & 1) || seg[oo + 20] < 8.5 : t !== 0) continue; if (f++ === skip) { o = oo; break; } s += 40; }
  if (o < 0) continue;
  const P0 = new V3(seg[o], seg[o + 1], seg[o + 2]), U = new V3(seg[o + 8], seg[o + 9], seg[o + 10]);
  const e = new V3(seg[o + 4] - seg[o], seg[o + 5] - seg[o + 1], seg[o + 6] - seg[o + 2]).normalize();
  const right = new V3().crossVectors(e, U).normalize();
  // start 3 m above the floor in the middle, flying sideways at the right wall
  r.pos.copy(P0).addScaled(U, 4); r.vel.copy(right).scale(15).addScaled(e, 5); r.state = 'freefall'; r.airT = 0.5;
  r.up.copy(U); r.fwd.copy(right); r.right.crossVectors(r.fwd, r.up);
  // tilt the board (roll about its nose)
  const rot = (v, ax, a) => { const c = Math.cos(a), s2 = Math.sin(a); const d = ax.dot(v); const cr = new V3().crossVectors(ax, v); return v.clone().scale(c).addScaled(cr, s2).addScaled(ax, d * (1 - c)); };
  r.up.copy(rot(r.up, r.fwd, tilt)); r.right.crossVectors(r.fwd, r.up);
  const I = inp(); I.boost = true;
  let out = 'none', thr = false;
  for (let i = 0; i < 120 * 2; i++) {
    step(S, I);
    for (const ev of r.events.splice(0)) { if (ev.type === 'bonk') out = 'bounced'; else if (ev.type === 'clean' || ev.type === 'sketchy') out = 'landed on it'; else if (ev.through) out = 'through'; }
    if (r.throughT > 0) thr = true;
    if (out !== 'none' && out !== 'bounced') break;
  }
  const k = `${kind} board rolled ${(tilt * 57.3).toFixed(0)} deg`;
  (res[k] ||= {})[thr ? 'through' : out] = ((res[k] || {})[thr ? 'through' : out] || 0) + 1;
}
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
