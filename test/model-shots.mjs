// A 3D model in the game: loads a glTF model (MODEL, a .glb) into Sky Tide's scene where the
// rider stands, cel shades it and gives it the contour line as the game does its own rider,
// hides the placeholder rider and board, and photographs it from round about and from the play
// camera's distance, in the game's own light.
//
//   MODEL=path/to/thing.glb  HEIGHT=1.8 (or LENGTH=1.96 for a board)  KIND=char|board
//   VIEWS=front,quarter,side,back,top,under,close,face,play  OUT=prefix  PAINT=texture|flat|raw
//   SHAPE=1 (0: ignore a model's shaped face and hair normals, render/cel.js)
//
// PAINT: texture (cel shaded with its own texture, as delivered), flat (its texture's colours
// gathered into a few flat paints, one per face: the cel look), raw (the model's own materials,
// not cel shaded, for comparison).
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.env.ROOT || new URL('..', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8821);
const OUT = process.env.OUT || new URL('./shots/model', import.meta.url).pathname;
const MODEL = process.env.MODEL;
if (!MODEL) { console.error('MODEL=path/to/model.glb'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = p === '/__model.glb' ? MODEL : path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(f);
  if (p === '/index.html') body = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(body);
}).listen(PORT);

const W = +(process.env.W || 960), H = +(process.env.H || 540);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[model]')) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
await page.route('https://cdn.jsdelivr.net/**', (route) => {
  const u = route.request().url();
  let f = null;
  const ex = u.indexOf('/examples/jsm/');
  if (u.includes('three@') && ex >= 0) f = 'node_modules/three' + u.slice(ex);
  else if (u.includes('three@')) f = 'node_modules/three/build/three.module.js';
  if (u.includes('lil-gui@')) f = 'node_modules/lil-gui/dist/lil-gui.esm.min.js';
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('./' + f, import.meta.url)) });
});
await page.route('https://fonts.**', (r) => r.abort());
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, { timeout: 180000 });
await page.evaluate(() => {
  document.getElementById('help').hidden = true;
  for (const id of ['hud', 'hud-guide', 'touch', 'gui']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  for (const e of document.querySelectorAll('.lil-gui, .hud, .panel, .meta, .buttons')) e.style.visibility = 'hidden';
});
await page.waitForTimeout(3000);
// Load the model, place it where the rider is, cel shade it, hide the placeholder.
const info = await page.evaluate(async ({ kind, height, length, paint, shape }) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js');
  const { celify, addOutline, CEL } = await import('/src/render/cel.js');
  CEL.uCelShape.value = shape;
  const s = window.sandbox;
  s.P.simSpeed = 0.0001; s.P.autoQuality = false;
  const gltf = await new GLTFLoader().loadAsync('/__model.glb');
  const model = gltf.scene;
  // size: a character to its height, a board to its length; stood on the ground at its middle
  let box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  const k = kind === 'board' ? length / Math.max(size.x, size.z) : height / size.y;
  model.scale.multiplyScalar(k);
  box = new THREE.Box3().setFromObject(model); size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  model.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  holder.add(model);
  let tris = 0;
  model.traverse((o) => { if (o.isMesh) tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
  if (paint === 'flat') {
    // the texture's colours gathered into a few flat paints, one per face (k-means on the
    // colour under each face's middle)
    model.traverse((o) => {
      if (!o.isMesh || !o.material.map) return;
      const img = o.material.map.image, cv = document.createElement('canvas');
      cv.width = 1024; cv.height = 1024;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 1024, 1024);
      const px = g.getImageData(0, 0, 1024, 1024).data;
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      const uv = geo.attributes.uv, n = uv.count / 3, cols = new Float32Array(n * 3);
      for (let f = 0; f < n; f++) {
        const u = (uv.getX(f * 3) + uv.getX(f * 3 + 1) + uv.getX(f * 3 + 2)) / 3, v = (uv.getY(f * 3) + uv.getY(f * 3 + 1) + uv.getY(f * 3 + 2)) / 3;
        const x = Math.min(1023, Math.max(0, Math.floor(u * 1024))), y = Math.min(1023, Math.max(0, Math.floor(v * 1024)));
        const i = (y * 1024 + x) * 4;
        cols[f * 3] = px[i] / 255; cols[f * 3 + 1] = px[i + 1] / 255; cols[f * 3 + 2] = px[i + 2] / 255;
      }
      // k-means, K paints
      const K = 9, cent = [];
      for (let j = 0; j < K; j++) { const f = Math.floor((j + 0.5) / K * n); cent.push([cols[f * 3], cols[f * 3 + 1], cols[f * 3 + 2]]); }
      const lab = new Int32Array(n);
      for (let it = 0; it < 12; it++) {
        const acc = cent.map(() => [0, 0, 0, 0]);
        for (let f = 0; f < n; f++) {
          let best = 0, bd = 1e9;
          for (let j = 0; j < K; j++) { const d = (cols[f * 3] - cent[j][0]) ** 2 + (cols[f * 3 + 1] - cent[j][1]) ** 2 + (cols[f * 3 + 2] - cent[j][2]) ** 2; if (d < bd) { bd = d; best = j; } }
          lab[f] = best; const a = acc[best]; a[0] += cols[f * 3]; a[1] += cols[f * 3 + 1]; a[2] += cols[f * 3 + 2]; a[3]++;
        }
        for (let j = 0; j < K; j++) if (acc[j][3]) cent[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
      }
      const col = new Float32Array(n * 9), cc = new THREE.Color();
      for (let f = 0; f < n; f++) { cc.setRGB(...cent[lab[f]], THREE.SRGBColorSpace); for (let q = 0; q < 3; q++) { col[f * 9 + q * 3] = cc.r; col[f * 9 + q * 3 + 1] = cc.g; col[f * 9 + q * 3 + 2] = cc.b; } }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      o.geometry = geo;
      o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    });
  }
  if (paint !== 'raw') {
    model.traverse((o) => { if (o.isMesh && o.material) { o.material.metalness = 0; o.material.roughness = 1; } });
    celify(holder, { char: true });
    addOutline(holder);
  }
  // where the rider is, on the stream, the placeholder hidden
  const r = s.rider.pos;
  holder.position.set(r.x, r.y, r.z);
  s.view.root.parent.add(holder);
  // (the game shows its own rider, board and glow again every frame: hide their paint instead)
  for (const g of [s.view.body, s.view.boardGroup, s.view.glow]) g.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.visible = false; });
  window._model = { holder, size: size.toArray(), center: [r.x, r.y + size.y / 2, r.z], kind };
  return { tris, size: size.toArray().map((v) => +v.toFixed(3)), scale: +k.toFixed(4) };
}, { kind: process.env.KIND || 'char', height: +(process.env.HEIGHT || 1.8), length: +(process.env.LENGTH || 1.96), paint: process.env.PAINT || 'texture', shape: +(process.env.SHAPE ?? 1) });
console.log('[model] loaded', JSON.stringify(info));
const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const views = (process.env.VIEWS || 'front,quarter,side,back,play').split(',');
for (const v of views) {
  await page.evaluate((v) => {
    const s = window.sandbox, M = window._model, [cx, cy, cz] = M.center;
    const big = Math.max(...M.size), d = big * 1.9;
    // the model's front faces +Z (glTF); a board's nose is -Z
    const at = { front: [0, 0.05, 1], quarter: [0.7, 0.2, 0.7], side: [1, 0.05, 0], back: [0, 0.1, -1], top: [0.05, 1, 0.3], under: [0.05, -1, 0.3] }[v];
    // close: the upper body from a metre and a half; face: the head from 70 cm
    if (v === 'close' || v === 'face') {
      const hy = cy + M.size[1] * (v === 'face' ? 0.42 : 0.22), dd = v === 'face' ? 0.7 : 1.5;
      s.camOverride = (cam) => { cam.position.set(cx + 0.45 * dd, hy + 0.05, cz + 0.9 * dd); cam.lookAt(cx, hy, cz); };
      return;
    }
    if (v === 'play') {
      // the play camera: behind and above, at its usual distance
      s.camOverride = (cam) => { cam.position.set(cx + 2.2, cy + 2.4, cz + 7.5); cam.lookAt(cx, cy, cz); };
      return;
    }
    const l = Math.hypot(...at);
    s.camOverride = (cam) => { cam.position.set(cx + at[0] / l * d, cy + at[1] / l * d, cz + at[2] / l * d); cam.lookAt(cx, cy, cz); };
  }, v);
  await frames(3);
  await page.screenshot({ path: `${OUT}-${v}.png`, timeout: 400000 });
}
console.log(logs.join('\n'));
await browser.close();
server.close();
