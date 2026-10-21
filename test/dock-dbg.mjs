import { setup, inp, step } from './netbot.mjs';
import { RouteGraph } from '../src/trapar/route.js';
import { TAG } from '../src/trapar/layer.js';
const S = setup(); const { r, world } = S;
const B = world.trapar.braids;
const G = new RouteGraph(B.bands, B.P, B.cx, B.cz, B.region);
const isl = world.trapar.islandsIn(-4000, 4000, -4000, 4000);
for (const name of ['Heronbluff', 'Rookhaven']) {
  const A = isl.find((I) => I.name === name);
  const docks = new Set();
  for (let j = 0; j < G.n; j++) if (G.onIsland(j, A, false)) docks.add(G.band[j]);
  console.log(name, 'dock-out bands', [...docks].map((bi) => B.bands[bi].kind));
  for (const bi of docks) {
    const b = B.bands[bi]; const nodes = []; for (let j = 0; j < G.n; j++) if (G.band[j] === bi) nodes.push(j);
    console.log('  band', b.kind, 'L', b.L.toFixed(0), 'nodes', nodes.length, 'attach', (b.attach || []).map((l) => `${l.host.kind}@${l.ln.sAtt.toFixed(0)} ${l.atStart ? 'start' : 'end'}`).join(', '));
    for (const j of nodes.slice(-4)) {
      const xs = []; for (let k = G.xo[j]; k < G.xo[j + 1]; k++) xs.push(B.bands[G.band[G.xs[k]]].kind);
      // nearest other-band node
      let best = null; for (const k of G.near(G.x[j], G.z[j], 60)) { if (G.band[k] === bi) continue; const d = Math.hypot(G.x[k] - G.x[j], G.z[k] - G.z[j]); if (!best || d < best[1]) best = [k, d]; }
      console.log(`    node si ${G.si[j]} next ${G.next[j]} xfers [${xs.join(',')}] w ${G.w[j].toFixed(0)} nearest other ${best ? B.bands[G.band[best[0]]].kind + ' d ' + best[1].toFixed(0) + ' dy ' + (G.y[best[0]] - G.y[j]).toFixed(1) + ' dot ' + (G.tx[j] * G.tx[best[0]] + G.ty[j] * G.ty[best[0]] + G.tz[j] * G.tz[best[0]]).toFixed(2) + ' w ' + G.w[best[0]].toFixed(0) : '-'}`);
    }
  }
}
