// Spawn like the game and list the riding surfaces in columns along the way ahead.
import { setup } from './netbot.mjs';
const S = setup({}); const { r, world } = S; const T = world.trapar;
r.respawn(0, 0, T.refAltitude());
world.update(S.st.t, r.pos);
const f = r.fwd, h = Math.hypot(f.x, f.z), fx = f.x / h, fz = f.z / h;
console.log('spawn', r.pos.x.toFixed(0), r.pos.y.toFixed(1), r.pos.z.toFixed(0), 'feature', r.dbg.feature);
for (let d = 0; d <= 320; d += 20) {
  const x = r.pos.x + fx * d, z = r.pos.z + fz * d;
  const sk = T.findSkins(x, z, 1, 1).filter((y) => Math.abs(y - r.pos.y) < 120);
  const F = sk.length ? T.sample(x, sk[0] - 0.5, z, {}) : null;
  console.log(d, sk.map((y) => (y - r.pos.y).toFixed(1)).join(' '), F ? `${F.feature} h ${F.waterH.toFixed(2)}` : '');
}
