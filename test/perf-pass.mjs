// Per-pass cost (software GL; relative only), forced to finish with a 1-pixel read back.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8783);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(body);
}).listen(PORT);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url(); let f = null;
  if (u.includes('three@')) f = 'node_modules/three/build/three.module.js';
  if (u.includes('lil-gui@')) f = 'node_modules/lil-gui/dist/lil-gui.esm.min.js';
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('./' + f, import.meta.url)) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.addInitScript((e) => { window.__EXP = e; }, process.env.EXP || '');
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 180000 });
const res = await page.evaluate(async () => {
  const s = window.sandbox, P = s.P, pl = s.pipeline, r = pl.renderer, cam = s.camera;
  document.getElementById('help').hidden = true;
  P.autoQuality = false; P.resScale = 0.45;
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const real = pl.render.bind(pl);
  let scenes = null;
  pl.render = (camera, world, fx, overlay, P2, thr, streamScene, backScene, mist) => { scenes = { world, fx, streamScene, backScene }; real(camera, world, fx, overlay, P2, thr, streamScene, backScene, mist); };
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  pl.render = () => {};
  if (window.__EXP) (0, eval)(window.__EXP);
  const hf = new Uint16Array(4);
  const sync = (rt) => r.readRenderTargetPixels(rt, 0, 0, 1, 1, hf);
  const time = (f, rt, n = 3) => { f(); sync(rt); const t = performance.now(); for (let i = 0; i < n; i++) { f(); sync(rt); } return +((performance.now() - t) / n).toFixed(0); };
  const q = (m, rt) => () => { pl.quad.material = m; r.setRenderTarget(rt); r.render(pl.quadScene, pl.quadCam); };
  const out = {};
  out.scene = time(() => { r.setRenderTarget(pl.sceneRT); r.setClearColor(0, 0); r.clear(true, true, false); r.render(scenes.world, cam); }, pl.sceneRT);
  if (!scenes.backScene) out.sky = time(q(pl.skyMat, pl.cloudRT), pl.cloudRT);
  if (pl.inkMat) out.ink = time(q(pl.inkMat, pl.inkRT), pl.inkRT);
  out.composite = time(q(pl.compMat, pl.compRT), pl.compRT);
  if (scenes.backScene) out.clouds = time(() => { r.setRenderTarget(pl.compRT); r.render(scenes.backScene, cam); }, pl.compRT);
  if (scenes.streamScene) out.streams = time(() => { r.setRenderTarget(pl.compRT); r.render(scenes.streamScene, cam); }, pl.compRT);
  out.fx = time(() => { r.setRenderTarget(pl.compRT); r.render(scenes.fx, cam); }, pl.compRT);
  pl.render = real;
  return out;
});
console.log(ROOT, JSON.stringify(res));
await browser.close(); server.close();
