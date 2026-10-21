// The rider's own models in the game, close up, in each kind of pose the game gives them:
// riding (standing, crouched, carving each way, weight on the tail), walking, skydiving, diving.
// STATES=ride,crouch,carveL,carveR,tail,walk,sky,dive  CHAR=Tavi|Mara  BOARD=Skipper|Kestrel
// VIEWS=front,back,nose,tail,three,chase  OUT=shots/rider  (one picture per state, its views side
// by side). Cameras are placed in the rider's own frame, so every state is seen the same way.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8772);
const OUT = process.env.OUT || new URL('./shots/rider', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(body);
}).listen(PORT);

const W = +(process.env.W || 520), H = +(process.env.H || 600);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url();
  let f = null;
  if (u.includes('three@')) f = 'node_modules/three/' + u.split(/three@[^/]+\//)[1];
  if (u.includes('lil-gui@')) f = 'node_modules/lil-gui/dist/lil-gui.esm.min.js';
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('./' + f, import.meta.url)) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 180000 }).catch(() => logs.push('TIMEOUT load'));
await page.waitForFunction(() => !!window.sandbox?.riderModels, null, { timeout: 120000 }).catch(() => logs.push('TIMEOUT models'));
await page.evaluate(({ ch, bd }) => {
  document.getElementById('help').hidden = true;
  for (const id of ['hud', 'hud-guide', 'touch', 'gui']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  for (const e of document.querySelectorAll('.lil-gui, .hud, .panel, .meta, .buttons')) e.style.visibility = 'hidden';
  const s = window.sandbox;
  s.P.autoQuality = false;
  s.P.resScale = 0.25;    // (the sky's streams at low resolution: quicker, and only the rider matters here)
  s.P.character = ch; s.P.board = bd;
}, { ch: process.env.CHAR || 'Tavi', bd: process.env.BOARD || 'Skipper' });
await page.waitForTimeout(3000);

const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const states = (process.env.STATES || 'ride,crouch,carveL,walk,sky').split(',');
const views = (process.env.VIEWS || 'front,three,nose,back,chase').split(',');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const shots = [];
for (const st of states) {
  // set the state up and let it settle (at full speed, briefly), then hold it nearly still
  await page.evaluate((st) => {
    const s = window.sandbox, r = s.rider;
    s.P.simSpeed = 1;
    s.scriptInput = (t, i) => {
      i.crouch = st === 'crouch'; i.lean = st === 'carveL' ? -1 : st === 'carveR' ? 1 : 0;
      i.trim = st === 'tail' ? -1 : 0;
    };
    if (st === 'walk') { if (r.mode !== 'foot' || r.state !== 'walking') s.toIsland(); }
    if ((st === 'sky' || st === 'dive') && r.mode === 'board') r._dismount();
    s._state = st;
  }, st);
  await page.waitForTimeout(st === 'walk' ? 2500 : 1200);
  await page.evaluate((st) => {
    const s = window.sandbox, r = s.rider;
    if (st === 'walk') s.scriptInput = (t, i) => { i.lookY = 0; };
    if (st === 'sky' || st === 'dive') { r.vis.sky = 1; r.vis.dive = st === 'dive' ? 1 : 0; }
    s.P.simSpeed = st === 'walk' ? 0.25 : 0.02;
  }, st);
  for (const v of views) {
    await page.evaluate((v) => {
      const s = window.sandbox;
      s.camOverride = (cam) => {
        const b = s.view.body, q = b.quaternion;
        const at = { front: [3.2, 1.0, 0.4], back: [-3.2, 1.2, -0.4], nose: [0.3, 1.0, -3.4], tail: [0.3, 1.1, 3.4], three: [2.4, 1.7, -2.3], chase: [0.9, 1.8, 3.6] }[v];
        const look = s.rider.mode === 'foot' ? [0, 0.95, 0] : [0, 0.85, 0];
        const o = b.position.clone().set(...at).applyQuaternion(q).add(b.position);
        const t = b.position.clone().set(...look).applyQuaternion(q).add(b.position);
        if (s.rider.mode === 'foot' && s.rider.state !== 'walking') { o.copy(b.position).add(cam.up.clone().set(at[0], 0.6 + at[1] * 0.3, at[2])); t.copy(s.rider.pos); }
        cam.position.copy(o); cam.up.set(0, 1, 0); cam.lookAt(t);
      };
    }, v);
    await frames(3);
    const file = `${OUT}-${st}-${v}.png`;
    await page.screenshot({ path: file, timeout: 400000 });
    shots.push(file);
  }
}
await page.evaluate(() => { const s = window.sandbox; s.camOverride = null; s.scriptInput = null; });
fs.writeFileSync(`${OUT}-log.txt`, logs.join('\n'));
console.log(shots.join('\n'));
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
server.close();
