(async () => {
  const THREE = await import('three');
  const { SKY_GLSL } = await import('/src/sky/sky.js');
  const sb = window.sandbox;
  const world = sb.world, r = sb.pipeline.renderer;
  // Make sure some swell sources and storms are active near the rider.
  world.weather.spawnStorm(sb.rider.pos.x - 3000, sb.rider.pos.z, sb.skyTime - 150, { D: 240, I: 1.5 });
  world.weather.spawnStorm(sb.rider.pos.x + 800, sb.rider.pos.z + 1200, sb.skyTime - 60, { D: 240, I: 1.2 });
  world.update(sb.skyTime, sb.rider.pos);
  const { syncSkyUniforms } = await import('/src/sky/sky.js');
  syncSkyUniforms(sb.pipeline.skyUniforms, world);
  const N = 16384, W = 128, H = 128;
  const pts = new Float32Array(N * 4);
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const T = world.trapar, Wx = world.weather;
  const lo = Math.min(T.S.uTrLo, Wx.S.uWxLo), hi = Math.max(T.S.uTrHi, Wx.S.uWxHi);
  for (let i = 0; i < N; i++) {
    pts[i*4] = (rnd() - 0.5) * 7000 + sb.rider.pos.x;
    pts[i*4+1] = i % 2 ? lo + rnd() * (hi - lo) : T.S.uStrSet[(i >> 1) % 3 * 4] - 80 + rnd() * 160;
    pts[i*4+2] = (rnd() - 0.5) * 7000 + sb.rider.pos.z;
    pts[i*4+3] = 1;
  }
  const tex = new THREE.DataTexture(pts, W, H, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...sb.pipeline.skyUniforms, tPts: { value: tex } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }',
    fragmentShader: SKY_GLSL + `\nuniform sampler2D tPts;
      void main(){ vec3 p = texelFetch(tPts, ivec2(gl_FragCoord.xy), 0).xyz; float pl; float d = trDensityImpl(p, true, pl); float sw = gTrSwell; float c = wxCloud(p, true); gl_FragColor = vec4(d, c, sw, pl); }`,
  });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(q);
  r.setRenderTarget(rt); r.render(sc, new THREE.OrthographicCamera(-1,1,1,-1,0,1));
  const out = new Float32Array(N * 4);
  r.readRenderTargetPixels(rt, 0, 0, W, H, out);
  r.setRenderTarget(null);
  const stat = () => ({ max: 0, sum: 0, nz: 0, worst: null, dis: 0 });
  const st = { trapar: stat(), cloud: stat(), swell: stat() };
  for (let i = 0; i < N; i++) {
    const x = pts[i*4], y = pts[i*4+1], z = pts[i*4+2];
    const js = { trapar: T.density(x, y, z), cloud: Wx.cloud(x, y, z, true), swell: T.swell(x, z) };
    const gl = { trapar: out[i*4], cloud: out[i*4+1], swell: out[i*4+2] };
    for (const k of ['trapar', 'cloud']) {
      const e = Math.abs(js[k] - gl[k]); const s = st[k];
      if (js[k] > 0.01 || gl[k] > 0.01) s.nz++;
      s.sum += e; if (e > s.max) { s.max = e; s.worst = { p: [x, y, z].map(v => +v.toFixed(0)), js: +js[k].toFixed(4), gl: +gl[k].toFixed(4) }; }
      if (k === 'trapar' && (js[k] >= 1) !== (gl[k] >= 1) && Math.abs(js[k] - 1) > 0.02) s.dis++;
    }
    // swell only meaningful inside the sheet band
    if (y > T.S.uStrLo && y < T.S.uStrHi) {
      const e = Math.abs(js.swell - gl.swell), s = st.swell; s.sum += e; s.nz += Math.abs(js.swell) > 0.01 ? 1 : 0; if (e > s.max) { s.max = e; s.worst = { js: +js.swell.toFixed(4), gl: +gl.swell.toFixed(4) }; }
    }
  }
  const f = (s) => ({ nonzero: s.nz, mean: +(s.sum / N).toFixed(5), max: +s.max.toFixed(4), rideDisagree: s.dis, worst: s.worst });
  return { events: T.S.uTrEvCount, storms: Wx.S.uWxStormCount, trapar: f(st.trapar), cloud: f(st.cloud), swell: f(st.swell) };
})()
