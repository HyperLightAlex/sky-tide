// Skytide sandbox: wires the weather and trapar engines, rider physics, input, rendering and
// tuning tools.

import * as THREE from 'three';
import { PARAMS } from './config.js';
import { generateNoiseBank } from './sky/noise.js';
import { snapshotSig, plainParams, BR } from './trapar/braids.js';
import { SkyWorld } from './sky/sky.js';
import { Rider } from './rider/rider.js';
import { Input } from './input/input.js';
import { SkyPipeline, makeNoiseTextures } from './render/pipeline.js';
import { RiderView } from './render/riderView.js';
import { Motes } from './render/motes.js';
import { ChaseCam } from './render/camera.js';
import { IslandsView } from './render/islandsView.js';
import { StreamMesh } from './render/streamMesh.js';
import { setCelLight, setOutlineSize } from './render/cel.js';
import { WakeView } from './render/wakeView.js';
import { CloudView } from './render/cloudView.js';
import { loadPainted } from './render/painted.js';
import { paintedSetFor, stormSetFor } from './weather/cloudField.js';
import { TrailView } from './render/trailView.js';
import { RouteGuide } from './world/guide.js';
import { Hud } from './debug/hud.js';
import { Panel } from './debug/panel.js';

const P = PARAMS;
const FIXED = 1 / 120;
const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);

function fail(msg) {
  $('loading-status').textContent = msg;
  $('loading').classList.add('error');
}

async function boot() {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) { fail('This browser does not support WebGL 2, which the sky renderer needs. Try a current Chrome, Edge, Firefox or Safari.'); return; }

  // Stream snapshots are built in a worker: the first one while the noise is generated, later
  // ones ahead of time as the rider moves (falls back to building in place).
  let braidWorker = null, firstSnap = null;
  try {
    braidWorker = new Worker(new URL('./trapar/braidWorker.js', import.meta.url), { type: 'module' });
    firstSnap = new Promise((resolve) => {
      braidWorker.onmessage = (e) => resolve(e.data);
      braidWorker.onerror = () => resolve(null);
    });
    braidWorker.postMessage({ id: 1, P: plainParams(P), focus: { x: 0, z: 0, rr: BR.QUICK, region: BR.QUICK_REGION }, sig: snapshotSig(P) });
  } catch (e) { console.warn('Braid worker unavailable, building snapshots in place.', e); braidWorker = null; }

  // The painted skies and clouds load alongside the sky's generation.
  const paintedSets = [-10, 10, 50].flatMap((el) => [paintedSetFor({ sunElevation: el }), stormSetFor({ sunElevation: el })]);
  const paintedLoad = loadPainted(paintedSets).catch((e) => { console.warn('Painted assets did not load:', e.message); return null; });
  const bank = await generateNoiseBank((f) => {
    $('loading-fill').style.width = `${(f * 100).toFixed(0)}%`;
  }, { workerUrl: new URL('./sky/noiseWorker.js', import.meta.url) });
  $('loading-status').textContent = 'Growing the streams';

  const world = new SkyWorld(bank, P);
  if (braidWorker) {
    const snap = await Promise.race([firstSnap, new Promise((r) => setTimeout(() => r(null), 20000))]);
    world.trapar.braids.preload(snap);
    world.trapar.braids.attachWorker(braidWorker);
  }
  $('loading-status').textContent = 'Starting the sky';
  let skyTime = 40;
  world.update(skyTime, { x: 0, z: 0 });

  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let renderScale = P.renderScale;
  renderer.setPixelRatio(dpr * renderScale);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(P.fov, window.innerWidth / window.innerHeight, 0.5, 20000);
  const scene = new THREE.Scene();
  const fx = new THREE.Scene();
  const overlay = new THREE.Scene();
  const streamScene = new THREE.Scene();   // the translucent streams, drawn after the clouds
  const backScene = new THREE.Scene();     // the painted clouds and cloud sea, after the sky
  const veilScene = new THREE.Scene();     // what is not light but lies over it (puffs inside a cloud)
  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x10142a, 1.4);
  const sun = new THREE.DirectionalLight(0xffe2c4, 2.6);
  scene.add(hemi, sun, sun.target);
  // (islands and anything else far off fade into the haze)
  scene.fog = new THREE.Fog(0xb8c8dc, 1200, 9000);

  const textures = makeNoiseTextures(bank);
  const pipeline = new SkyPipeline(renderer, world, textures);
  pipeline.setSize(window.innerWidth, window.innerHeight, dpr * renderScale);
  pipeline.setCloudScale(P.resScale);
  // GPU time per frame (where the browser allows it), for the auto quality and the HUD.
  const gpuTimer = makeGpuTimer(renderer.getContext());

  const rider = new Rider(world, P);
  const view = new RiderView(scene, fx, overlay, pipeline.skyUniforms);
  const islandsView = new IslandsView(scene);
  const streamMesh = new StreamMesh(streamScene, pipeline.skyUniforms, pipeline.common, pipeline.look);
  const guide = new RouteGuide(world.trapar.braids);
  const trail = new TrailView(fx);
  const wake = new WakeView(fx);   // the trapar wave and spray a board throws up
  const clouds = new CloudView(backScene, veilScene, pipeline.common, pipeline.exposure);
  const painted = await paintedLoad;
  if (painted) { pipeline.setPainted(painted); clouds.init(painted); }
  const motes = new Motes(fx, pipeline.skyUniforms, pipeline.look);
  const cam = new ChaseCam(camera);
  const input = new Input(window);
  const hud = new Hud($('hud'));

  const respawnHere = () => { rider.respawn(rider.pos.x, rider.pos.z, Math.max(rider.pos.y, P.floorAltitude + 200)); cam.snap(rider, P); guide.invalidate(); };
  // Back to the last safe spot: on a stream, or on foot on the island you last stood on.
  const respawnSafe = () => {
    const s = rider.lastSafe;
    if (rider.lastSafeFoot) {
      const I = world.trapar.islandsIn(s.x - 5, s.x + 5, s.z - 5, s.z + 5).find((J) => J.ground(s.x, s.z) !== null && Math.abs(J.ground(s.x, s.z) - s.y) < 3);
      if (I && rider.placeOnIsland(I, s.x, s.z)) { cam.snap(rider, P); guide.invalidate(); return; }
    }
    rider.respawn(s.x, s.z, s.y); cam.snap(rider, P);
    guide.invalidate();
  };

  // Routes: pick an island a few kilometers off and get there. A gold beam marks it, a trail
  // of chevrons shows a way there through the network (planned in the snapshot worker, see
  // world/guide.js), the card at the top says what to do next; the clock stops when you
  // stand on it.
  let simT = 0, route = null;
  const best = new Map();
  const islandsNear = (r) => { const p = rider.pos; return world.trapar.islandsIn(p.x - r, p.x + r, p.z - r, p.z + r); };
  const newRoute = () => {
    const p = rider.pos;
    const cands = islandsNear(P.routeMax + 200).filter((I) => { const d = Math.hypot(I.x - p.x, I.z - p.z); return d > P.routeMin && d < P.routeMax && (!route || I.id !== route.dest.id) && I !== rider.footIsland; });
    if (!cands.length) { hud.notice('No island in range for a route.', 2); return; }
    const I = cands[Math.floor(Math.random() * cands.length)];
    route = { dest: I, t0: simT, from: rider.footIsland ? rider.footIsland.name : null };
    view.setRoute(I);
    guide.set(I);
    hud.notice(`Route: get to ${I.name}${best.has(I.name) ? ` (best ${hud.mmss(best.get(I.name))})` : ''}`, 3);
  };
  // Go to the nearest island, on foot (for testing).
  const toIsland = () => {
    const p = rider.pos;
    let bestI = null, bd = Infinity;
    for (const I of islandsNear(8000)) { const d = Math.hypot(I.x - p.x, I.z - p.z) + Math.abs(I.y - p.y) * 2; if (I !== rider.footIsland && d < bd) { bd = d; bestI = I; } }
    if (!bestI) { hud.notice('No island near.', 1.5); return; }
    rider.placeOnIsland(bestI);
    cam.snap(rider, P);
    hud.notice(`On ${bestI.name}`, 2);
  };

  // Sandbox: spawn a storm upwind or straight ahead (weather only for now; storms will act on
  // the network in the next phase).
  const spawnStorm = () => {
    let dx, dz;
    if (P.spawnUpwind) {
      const w = world.weather.windMean(rider.pos.y, { x: 0, y: 0, z: 0 });
      const l = Math.hypot(w.x, w.z);
      if (l > 0.1) { dx = -w.x / l; dz = -w.z / l; } else { dx = Math.cos(P.windDir * DEG); dz = Math.sin(P.windDir * DEG); }
    } else {
      dx = rider.fwd.x; dz = rider.fwd.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    }
    const x = rider.pos.x + dx * P.spawnDistance, z = rider.pos.z + dz * P.spawnDistance;
    world.weather.spawnStorm(x, z, skyTime);
    world.update(skyTime, rider.pos);
    hud.notice(`Storm spawned ${(P.spawnDistance / 1000).toFixed(1)} km ${P.spawnUpwind ? 'upwind' : 'ahead'}.`, 3.5);
  };
  const clearStorms = () => { world.weather.clearSpawned(); world.update(skyTime, rider.pos); hud.notice('Spawned storms cleared', 1.5); };
  const onStage = (name) => {
    world.update(skyTime, rider.pos);
    rider.respawn(rider.pos.x, rider.pos.z, world.trapar.refAltitude(rider.pos.x, rider.pos.z));
    cam.snap(rider, P);
    hud.notice(`Test stage: ${name}`, 2.5);
  };
  const panel = new Panel(P, { respawn: respawnHere, spawnStorm, clearStorms, onStage });

  rider.respawn(0, 0, world.trapar.refAltitude());
  cam.snap(rider, P);

  const help = $('help');
  let helpShownAt = performance.now();
  const toggleHelp = (force) => { help.hidden = force !== undefined ? !force : !help.hidden; if (!help.hidden) helpShownAt = performance.now(); };
  hud.el.btnPanel.addEventListener('click', () => panel.toggle());
  hud.el.btnHelp.addEventListener('click', () => toggleHelp());
  hud.el.btnRespawn.addEventListener('click', respawnHere);
  hud.el.btnStorm.addEventListener('click', spawnStorm);
  $('help-close').addEventListener('click', () => toggleHelp(false));

  let paused = false;
  let fellTimer = 0;
  // Trapar sense pulse.
  const pulse = { active: false, t: 0, origin: { x: 0, y: 0, z: 0 }, cooldown: 0 };
  const sense = () => {
    if (pulse.cooldown > 0) return;
    pulse.active = true; pulse.t = 0;
    pulse.origin = { x: rider.pos.x, y: rider.pos.y, z: rider.pos.z };
    pulse.cooldown = Math.max(1, P.senseTime * 0.6);
    if (P.rumble) input.rumble(0.2, 120);
  };
  const handleAction = (a) => {
    if (a === 'respawn') respawnHere();
    else if (a === 'panel') panel.toggle();
    else if (a === 'arrows') P.showArrows = !P.showArrows;
    else if (a === 'slice') P.showSlice = !P.showSlice;
    else if (a === 'freeze') { P.freezeSky = !P.freezeSky; hud.notice(P.freezeSky ? 'Sky frozen' : 'Sky moving', 1.2); }
    else if (a === 'pause') { paused = !paused; hud.notice(paused ? 'Paused (P to resume)' : 'Resumed', paused ? 9999 : 1); }
    else if (a === 'help') toggleHelp();
    else if (a === 'storm') spawnStorm();
    else if (a === 'clearStorms') clearStorms();
    else if (a === 'sense') sense();
    else if (a === 'route') newRoute();
    else if (a === 'island') toIsland();
  };

  // The picture's shape: the whole window, or 16:9 or 4:3 with black bars (a TV frame).
  const screenRect = () => {
    const W = window.innerWidth, H = window.innerHeight;
    const want = P.screenShape === '16:9' ? 16 / 9 : P.screenShape === '4:3' ? 4 / 3 : 0;
    if (!want) return { x: 0, y: 0, w: W, h: H };
    let w = W, h = Math.round(W / want);
    if (h > H) { h = H; w = Math.round(H * want); }
    return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
  };
  let shape = P.screenShape;
  const onResize = () => {
    const r = screenRect();
    shape = P.screenShape;
    Object.assign(canvas.style, { inset: 'auto', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    document.body.classList.toggle('framed', r.w !== window.innerWidth || r.h !== window.innerHeight);
    renderer.setPixelRatio(dpr * renderScale);
    renderer.setSize(r.w, r.h, false);
    pipeline.setSize(r.w, r.h, dpr * renderScale);
    setOutlineSize(r.h * dpr * renderScale);
    camera.aspect = r.w / r.h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();

  // Exposed for debugging from the browser console.
  window.sandbox = { world, rider, P, input, camera, pipeline, panel, spawnStorm, newRoute, toIsland, islandsView, streamMesh, guide, trail, wake, clouds, scriptInput: null, camOverride: null, get skyTime() { return skyTime; }, get route() { return route; } };
  const camDir = new THREE.Vector3();

  let acc = 0, last = performance.now(), frameEma = 16, gpuEma = 8, qualityT = 0, boostRumbleT = 0;
  let firstFrame = true;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;

    input.poll();
    if (window.sandbox.scriptInput) window.sandbox.scriptInput(now / 1000, input.state);
    for (const a of input.takeActions()) handleAction(a);

    if (!help.hidden && now - helpShownAt > 1500) {
      const s = input.state;
      if (Math.abs(s.lean) + Math.abs(s.trim) > 0.3 || s.crouch) toggleHelp(false);
    }

    if (!paused) {
      acc += dt * P.simSpeed;
      let n = 0;
      while (acc >= FIXED && n < 24) {
        if (!P.freezeSky) skyTime += FIXED * P.skySpeed;
        world.update(skyTime, rider.pos);
        rider.step(FIXED, input.state);
        input.consumeEdges();
        simT += FIXED;
        acc -= FIXED; n++;
      }
      if (n >= 24) acc = 0;
    }

    for (const ev of rider.events.splice(0)) {
      if (ev.type === 'clean' || ev.type === 'sketchy' || ev.type === 'wipeout') {
        hud.showCatch(ev);
        if (P.rumble) input.rumble(ev.type === 'wipeout' ? 1 : ev.type === 'sketchy' ? 0.6 : 0.35, ev.type === 'wipeout' ? 450 : 160);
      } else if (ev.type === 'bonk') {
        if (P.rumble) input.rumble(0.5, 140);
      } else if (ev.type === 'pop') {
        if (P.rumble) input.rumble(0.15 + ev.charge * 0.25, 70);
      } else if (ev.type === 'fell') {
        hud.notice('Fell below the floor. Run over.', 1.6);
        fellTimer = 1.2;
      } else if (ev.type === 'noStream') {
        hud.notice('No stream under you. Walk onto a dock, or jump off the edge and call your board.', 3);
      } else if (ev.type === 'land' || ev.type === 'stepOff') {
        if (P.rumble) input.rumble(ev.roll ? 0.6 : 0.25, ev.roll ? 220 : 90);
      } else if (ev.type === 'mount' || ev.type === 'dismount') {
        if (P.rumble) input.rumble(0.2, 70);
      }
    }
    if (fellTimer > 0) { fellTimer -= dt; if (fellTimer <= 0) respawnSafe(); }
    if (rider.boosting && P.rumble) { boostRumbleT -= dt; if (boostRumbleT <= 0) { input.rumble(0.12, 90); boostRumbleT = 0.08; } }

    // Sense pulse sweep.
    if (pulse.cooldown > 0) pulse.cooldown -= dt;
    if (pulse.active) {
      pulse.t += dt;
      const k = pulse.t / P.senseTime;
      const radius = P.senseRange * Math.min(1, pulse.t / (P.senseTime * 0.45));
      const strength = k < 1 ? 1 - Math.max(0, (k - 0.45) / 0.55) : 0;
      pipeline.setPulse(pulse.origin, radius, strength);
      if (k >= 1) { pulse.active = false; pipeline.setPulse(null, 0, 0); }
    }

    // Auto quality: hold roughly 60 fps. Measured by GPU time where the browser reports it
    // (frame time is stuck at the display's refresh rate otherwise), traded first against the
    // sky (cloud) resolution, then the whole frame's resolution.
    frameEma += (dt * 1000 - frameEma) * 0.05;
    const gms = gpuTimer.poll();
    if (gms !== null) gpuEma += (gms - gpuEma) * 0.1;
    if (P.autoQuality && !firstFrame) {
      qualityT += dt;
      if (qualityT > 0.75) {
        qualityT = 0;
        const slow = gpuTimer.ok ? gpuEma > 13 || frameEma > 24 : frameEma > 19;
        const fast = gpuTimer.ok ? gpuEma < 7.5 && frameEma < 19 : frameEma < 13.5;
        if (slow) {
          if (P.resScale > 0.35) P.resScale = Math.max(0.35, +(P.resScale - 0.05).toFixed(2));
          else if (P.renderScale > 0.55) P.renderScale = Math.max(0.55, +(P.renderScale - 0.05).toFixed(2));
          else if (P.resScale > 0.25) P.resScale = Math.max(0.25, +(P.resScale - 0.05).toFixed(2));
        } else if (fast) {
          if (P.renderScale < 1) P.renderScale = Math.min(1, +(P.renderScale + 0.05).toFixed(2));
          else if (P.resScale < 0.7) P.resScale = Math.min(0.7, +(P.resScale + 0.05).toFixed(2));
        }
      }
    }
    if (Math.abs(P.renderScale - renderScale) > 0.001 || P.screenShape !== shape) { renderScale = P.renderScale; onResize(); }
    pipeline.setCloudScale(P.resScale);

    pipeline.updateLighting(P);
    setCelLight(pipeline.common.uSkyMid.value);
    sun.position.copy(pipeline.sunDir).multiplyScalar(100).add(camera.position);
    sun.target.position.copy(camera.position);
    sun.color.copy(pipeline.common.uSunColor.value).multiplyScalar(0.8);

    cam.update(dt, rider, P, input.state);
    if (window.sandbox.camOverride) window.sandbox.camOverride(camera, rider);
    camera.getWorldDirection(camDir);
    rider.camFwd = { x: camDir.x, z: camDir.z };
    islandsView.update(dt, world, camera.position, P);
    scene.fog.color.copy(pipeline.common.uHorizon.value);
    scene.fog.far = Math.max(2000, P.fogDistance * 1.3);

    // Route: arrived when you stand on the island.
    if (route) {
      const D = route.dest, p = rider.pos;
      const el = simT - route.t0;
      if (rider.mode === 'foot' && rider.state === 'walking' && rider.footIsland && rider.footIsland.id === D.id) {
        const prev = best.get(D.name);
        if (prev === undefined || el < prev) best.set(D.name, el);
        hud.showRoute(D.name, el, prev);
        route = null; view.setRoute(null); guide.set(null);
        hud.setRoute('', ''); hud.setGuide(null);
      } else {
        const d = Math.hypot(D.x - p.x, D.z - p.z), dh = D.top(D.x, D.z) - p.y;
        const where = `${D.name}: ${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'} ${hud.bearing(D.x - p.x, D.z - p.z)}, ${Math.abs(dh) < 15 ? 'level' : Math.round(Math.abs(dh)) + ' m ' + (dh > 0 ? 'up' : 'down')} · ${hud.mmss(el)}`;
        hud.setRoute(where, 'on');
        // The next thing to do on the way.
        guide.update(dt, rider);
        const nx = guide.next;
        if (nx) {
          const air = ['drop', 'fly', 'land', 'flyland', 'jump'].includes(nx.type);
          const dist = nx.dist < 8 ? 'now' : nx.dist >= 1000 ? `${(nx.dist / 1000).toFixed(1)} km` : `${Math.round(nx.dist / 10) * 10} m`;
          hud.setGuide({ icon: nx.icon, text: nx.text, dist, sub: `${where}${guide.path && guide.path.partial ? ' · planning ahead as you go' : ''}`, kind: nx.dist < 8 ? 'now' : air ? 'drop' : '' });
        } else hud.setGuide({ icon: '…', text: guide.failed ? 'No way found from here yet: head for the beam' : 'Finding a way…', dist: '', sub: where, kind: '' });
      }
    } else hud.setGuide(null);
    trail.update(dt, route ? guide : null, camera, P, world.trapar.braids.S.uBrWater[3]);
    view.update(dt, rider, P, camera);
    wake.update(paused ? 0 : dt * P.simSpeed, rider, camera, P, pipeline.size.y);   // (on the sim's clock: pauses and slows with it)
    motes.update(camera, P, rider, skyTime, dpr);
    pipeline.setStreamMesh(!!P.streamMesh);
    streamMesh.update(camera, world.trapar.braids, P, rider.dbg.thr, pipeline, rider.pos, rider.mode === 'board' ? rider.up : null);
    gpuTimer.begin();
    clouds.update(paused ? 0 : dt * P.simSpeed, camera, world, P);
    pipeline.render(camera, scene, fx, overlay, P, rider.dbg.thr, streamScene, backScene, { amount: clouds.mist, color: clouds.mistColor }, veilScene);
    gpuTimer.end();
    view.renderSlice(renderer, P);
    hud.update(dt, rider, P, input, skyTime, pipeline.cloudScale, world, gpuTimer.ok ? gpuEma : null, renderScale);

    if (firstFrame) {
      firstFrame = false;
      $('loading').hidden = true;
    }
  }
  requestAnimationFrame(frame);
}

// GPU time of a frame with a timer query (EXT_disjoint_timer_query_webgl2), read back a few
// frames later. ok is false where the browser does not offer it.
function makeGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  let active = null;
  return {
    get ok() { return !!ext; },
    begin() {
      if (!ext || active || pending.length > 4) return;
      active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active); active = null;
    },
    poll() {
      if (!ext || !pending.length) return null;
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return null;
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q);
      return disjoint ? null : ns / 1e6;
    },
  };
}

boot().catch((err) => {
  console.error(err);
  fail(`The sandbox could not start: ${err && err.message ? err.message : err}`);
});
