// Browser run of the on-foot loop: put on an island, walk, start a route, walk off the edge,
// skydive, summon the board. Screenshots at each stage; state printed.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const OUT = process.env.OUT || new URL('./shots/fb', import.meta.url).pathname;
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
}).listen(8766);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'log') logs.push(`[${m.type()}] ${m.text()}`); });
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
await page.goto('http://localhost:8766/');
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 180000 }).catch(() => logs.push('TIMEOUT load'));
await page.evaluate(() => { document.getElementById('help') && (document.getElementById('help').hidden = true); });

const state = () => page.evaluate(() => {
  const s = window.sandbox, r = s.rider, rt = s.route;
  return { mode: r.mode, state: r.state, island: r.footIsland?.name || null, summon: +(r.summonT || 0).toFixed(2),
    pos: [r.pos.x, r.pos.y, r.pos.z].map((v) => Math.round(v)), sp: +r.vel.len().toFixed(1),
    route: rt ? { dest: rt.dest?.name, from: rt.from } : null,
    hud: document.getElementById('hud-route')?.textContent?.trim()?.slice(0, 80) || null,
    meshes: s.islandsView.meshes.size };
});
// Wait sim seconds (frames are slow under software GL).
const simWait = async (secs) => {
  const t0 = await page.evaluate(() => window.sandbox.rider.stats ? performance.now() : 0);
  const start = await page.evaluate(() => window.__simT || 0);
  await page.evaluate((secs) => new Promise((res) => {
    const r = window.sandbox.rider; let t = 0, last = null;
    const tick = (now) => { if (last !== null) t += Math.min(0.1, (now - last) / 1000); last = now; if (t >= secs) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), secs);
};
const shot = async (name) => { await page.screenshot({ path: `${OUT}_${name}.png`, timeout: 400000 }); };
const key = async (k) => { await page.keyboard.down(k); await simWait(0.15); await page.keyboard.up(k); };
const say = async (label) => console.log(label.padEnd(18), JSON.stringify(await state()));

await page.evaluate(() => window.sandbox.toIsland());
await simWait(2.5);
await say('on island'); await shot('1_island');

// Walk forward (camera-relative: trim -1 is stick up).
await page.evaluate(() => { window.sandbox.scriptInput = (t, s) => { s.trim = -1; s.lean = 0.2; }; });
await simWait(3);
await say('walking'); await shot('2_walk');
await page.evaluate(() => { window.sandbox.scriptInput = null; });

await key('KeyN');
await simWait(1.5);
await say('route'); await shot('3_route');

// Board press on bare ground: no stream underfoot (stays on foot).
await key('KeyX'); await simWait(0.5);
await say('board on rock');

// Walk off the edge: start near the rim, head away from the island's middle until skydiving.
await page.evaluate(() => {
  const r = window.sandbox.rider, I = r.footIsland;
  const th = Math.atan2(r.pos.z - I.z, r.pos.x - I.x), R = I.outline(th) * 0.93;
  r.placeOnIsland(I, I.x + Math.cos(th) * R, I.z + Math.sin(th) * R);
  window.sandbox.scriptInput = (t, s) => {
    const dx = r.pos.x - I.x, dz = r.pos.z - I.z, l = Math.hypot(dx, dz) || 1, cf = r.camFwd || { x: 1, z: 0 };
    const cl = Math.hypot(cf.x, cf.z) || 1, fx = cf.x / cl, fz = cf.z / cl;
    // stick (lean, -trim) in camera axes: right = (-fz, fx), forward = (fx, fz)
    const wx = dx / l, wz = dz / l;
    s.lean = wx * -fz + wz * fx; s.trim = -(wx * fx + wz * fz); s.boost = true;
  };
});
let st;
for (let k = 0; k < 20; k++) { await simWait(1); st = await state(); if (st.state === 'skydiving') break; }
await page.evaluate(() => { window.sandbox.scriptInput = (t, s) => { s.trim = -0.6; }; });
await simWait(1.2);
await say('skydiving'); await shot('4_skydive');
await page.evaluate(() => { window.sandbox.scriptInput = null; });

await key('KeyX');
await say('summoning');
await simWait(1.0);
await say('summoned'); await shot('5_summoned');

// Board on and in the air: jump off it again (falls straight down), then summon.
await simWait(1.5);
await key('KeyX'); await simWait(0.3);
await say('off board again');

console.log(logs.join('\n') || '(no warnings or errors)');
await browser.close();
server.close();
