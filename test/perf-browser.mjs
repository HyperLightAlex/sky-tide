// Where a frame's time goes in the browser: JS (sim, views, HUD) and each GPU pass (timed with
// gl.finish under software GL, so relative costs only). Several configurations.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(body);
}).listen(8767);

const W = +(process.env.W || 640), H = +(process.env.H || 360);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url();
  let f = null;
  if (u.includes('three@')) f = 'node_modules/three/build/three.module.js';
  if (u.includes('lil-gui@')) f = 'node_modules/lil-gui/dist/lil-gui.esm.min.js';
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('./' + f, import.meta.url)) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.goto('http://localhost:8767/');
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 180000 }).catch(() => logs.push('TIMEOUT load'));

// Time each pass on its own (the main loop's rendering switched off), forcing completion
// with a 1-pixel read back. Software GL: relative costs only.
const res = await page.evaluate(async () => {
  const s = window.sandbox, P = s.P, pl = s.pipeline, r = pl.renderer, cam = s.camera;
  document.getElementById('help').hidden = true;
  const real = pl.render.bind(pl);
  P.autoQuality = false; P.resScale = 0.45; P.steps = 120;
  // one real frame to set uniforms
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  pl.render = () => {};
  const hf = new Uint16Array(4), u8 = new Uint8Array(4);
  const syncRT = (rt) => r.readRenderTargetPixels(rt, 0, 0, 1, 1, hf);
  const time = (f, rt, n = 3) => { f(); syncRT(rt); const t = performance.now(); for (let i = 0; i < n; i++) { f(); syncRT(rt); } return +((performance.now() - t) / n).toFixed(1); };
  const sky = () => { pl.quad.material = pl.skyMat; r.setRenderTarget(pl.cloudRT); r.render(pl.quadScene, pl.quadCam); };
  const scene = () => { r.setRenderTarget(pl.sceneRT); r.setClearColor(0, 0); r.clear(true, true, false); r.render(s.world && window.__scene || s.islandsView.group.parent, cam); };
  const comp = () => { pl.quad.material = pl.compMat; r.setRenderTarget(pl.compRT); r.render(pl.quadScene, pl.quadCam); };
  const out = {};
  const setU = () => { pl.skyMat.uniforms.uSteps.value = P.steps; };
  out.cloudRT = pl.cloudRT.width + 'x' + pl.cloudRT.height;
  out.scene = time(scene, pl.sceneRT);
  out.composite = time(comp, pl.compRT);
  out.sky_default = time(sky, pl.cloudRT);
  P.steps = 60; setU(); out.sky_steps60 = time(sky, pl.cloudRT); P.steps = 120; setU();
  const su = pl.skyMat.uniforms;
  const keep = {}; for (const k of ['uWxCuDensity', 'uWxStDensity', 'uWxStormDensity']) if (su[k]) { keep[k] = su[k].value; su[k].value = 0; }
  out.sky_noClouds = time(sky, pl.cloudRT);
  for (const k in keep) su[k].value = keep[k];
  const on = su.uBrOn.value; su.uBrOn.value = 0; out.sky_noStreams = time(sky, pl.cloudRT); su.uBrOn.value = on;
  const tOn = su.uTrOn ? su.uTrOn.value : null;
  pl.render = real;
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log(logs.join('\n'));
await browser.close();
server.close();
