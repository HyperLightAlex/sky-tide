// Shared helpers for network tests.
import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { Rider } from '../src/rider/rider.js';
import { defaultParams } from '../src/config.js';
import { V3 } from '../src/math/v3.js';
export const bank = await loadBank();
export const dt = 1 / 120;
export function setup(over = {}, t0 = 40) {
  const P = defaultParams(); Object.assign(P, over);
  const world = new SkyWorld(bank, P); const st = { t: t0 };
  world.update(st.t, { x: 0, z: 0 });
  return { P, world, r: new Rider(world, P), st };
}
export const inp = () => ({ lean: 0, trim: 0, snap: 0, brace: 0, crouch: false, crouchReleased: false, boost: false, boostPressed: false });
export const step = (S, I) => { S.st.t += dt; S.world.update(S.st.t, S.r.pos); S.r.step(dt, I); };
// Bot: steer the nose along the flow and toward the band's middle (or toward one side: bias -1..1).
export function bot(S, I, bias = 0, gain = 1) {
  const r = S.r, B = S.world.trapar.braids, p = r.pos, n = r.normal;
  const F = S.world.trapar.sample(p.x - n.x * 0.5, p.y - n.y * 0.5, p.z - n.z * 0.5, {});
  let headErr = 0, lat = 0;
  if (F.rho > 0.05 && r.state === 'riding') {
    let fx = F.flowDir.x, fy = F.flowDir.y, fz = F.flowDir.z;
    const d = fx * n.x + fy * n.y + fz * n.z; fx -= n.x * d; fy -= n.y * d; fz -= n.z * d;
    const f = r.fwd;
    const cx = f.y * fz - f.z * fy, cy = f.z * fx - f.x * fz, cz = f.x * fy - f.y * fx;
    headErr = -(cx * n.x + cy * n.y + cz * n.z);
    const q = B.nearestAxis(p.x, p.y, p.z, {});
    if (q) {
      // lateral offset in the rider's right direction
      const sgnR = q.rx * r.right.x + q.ry * r.right.y + q.rz * r.right.z;
      const target = bias * Math.max(0, q.w - 6);
      lat = ((q.lat * Math.sign(sgnR || 1)) - target) / Math.max(6, q.w);
    }
  }
  I.lean = Math.max(-1, Math.min(1, (headErr * 2.5 - lat * 1.2) * gain));
  return F;
}
export { V3 };
