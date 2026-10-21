import { loadBank } from './bank.mjs';
import { SkyWorld } from '../src/sky/sky.js';
import { defaultParams } from '../src/config.js';
const bank = await loadBank();
const P = defaultParams(); const world = new SkyWorld(bank, P); world.update(615, { x: 0, z: 0 });
world.update(615, { x: 5000, z: -4000 });
const T = world.trapar; const g = { x: 0, y: 0, z: 0 };
const why = { skins: 0, floor: 0, solid: 0, upright: 0, lateral: 0, ok: 0 };
for (let ring = 0; ring < 14; ring++) { const pts = ring === 0 ? 1 : 8; for (let k = 0; k < pts; k++) {
  const a = (k / pts) * Math.PI * 2 + ring * 0.7; const cx = 5000 + Math.cos(a) * ring * 140, cz = -4000 + Math.sin(a) * ring * 140;
  for (const y of T.findSkins(cx, cz, P.rideThreshold * 1.05)) { why.skins++;
    if (y < P.floorAltitude + 30) { why.floor++; continue; }
    if (T.density(cx, y - 6, cz) < P.rideThreshold * 1.4) { why.solid++; continue; }
    T.gradient(cx, y - 1, cz, 1.5, g); const l = Math.hypot(g.x, g.y, g.z); if (-g.y / l < 0.8) { why.upright++; continue; }
    const F = T.sample(cx, y - 3, cz, {}); let px = -F.flow.z, pz = F.flow.x; const pl = Math.hypot(px, pz); px /= pl; pz /= pl;
    if (T.density(cx + px * 14, y - 4, cz + pz * 14) < 1.2 || T.density(cx - px * 14, y - 4, cz - pz * 14) < 1.2) { why.lateral++; continue; }
    why.ok++;
  } } }
console.log(why, 'band', T.S.uTrLo, T.S.uTrHi, 'braid', T.braids.S.uBrLo, T.braids.S.uBrHi, 'nSeg', T.braids.nSeg, 'center', T.braids.cx, T.braids.cz);
