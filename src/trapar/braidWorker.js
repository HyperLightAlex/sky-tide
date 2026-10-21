// Builds stream snapshots in the background (see Braids.attachWorker), and plans routes over
// the latest one (see Braids.requestRoute).
import { Braids } from './braids.js';

let br = null;
self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'route') {
    let out;
    try { out = br ? br.planRoute(d.from, d.dest) : { ok: false, why: 'no streams yet', pts: new Float32Array(0), steps: [] }; }
    catch (err) { out = { ok: false, why: String(err && err.message || err), pts: new Float32Array(0), steps: [] }; }
    out.type = 'route'; out.id = d.id;
    self.postMessage(out, out.pts && out.pts.buffer ? [out.pts.buffer] : []);
    return;
  }
  if (!br) br = new Braids(d.P);
  br.P = d.P; br.net.P = d.P;
  br._build(d.focus);
  const out = br.pack(d.sig);
  out.id = d.id;
  self.postMessage(out, [out.seg.buffer, out.idx.buffer, out.cell.buffer]);
};
