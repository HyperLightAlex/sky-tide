(async () => {
  const THREE = await import('three');
  const { SKY_GLSL } = await import('/src/sky/field.glsl.js');
  const sb = window.sandbox;
  const sky = sb.sky, r = sb.pipeline.renderer;
  const N = 4096, W = 64, H = 64;
  const pts = new Float32Array(N * 4);
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const S = sky.S;
  for (let i = 0; i < N; i++) {
    pts[i*4] = (rnd() - 0.5) * 8000 + sb.rider.pos.x;
    pts[i*4+1] = S.uCloudLo + rnd() * (S.uCloudHi - S.uCloudLo);
    pts[i*4+2] = (rnd() - 0.5) * 8000 + sb.rider.pos.z;
    pts[i*4+3] = 1;
  }
  const tex = new THREE.DataTexture(pts, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...sb.pipeline.skyUniforms, tPts: { value: tex } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }',
    fragmentShader: SKY_GLSL + `\nuniform sampler2D tPts; varying vec2 vUv;
      void main(){ vec3 p = texelFetch(tPts, ivec2(gl_FragCoord.xy), 0).xyz; float pl; float d = skyDensityImpl(p, true, pl); float dl = skyDensityLite(p); gl_FragColor = vec4(d, dl, pl, 1.); }`,
  });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(q);
  r.setRenderTarget(rt); r.render(sc, new THREE.OrthographicCamera(-1,1,1,-1,0,1)); 
  const out = new Float32Array(N * 4);
  r.readRenderTargetPixels(rt, 0, 0, W, H, out);
  r.setRenderTarget(null);
  let maxErr = 0, sumErr = 0, nz = 0, worst = null, disagree = 0;
  for (let i = 0; i < N; i++) {
    const js = sky.density(pts[i*4], pts[i*4+1], pts[i*4+2]);
    const gl = out[i*4];
    const e = Math.abs(js - gl);
    if (js > 0.01 || gl > 0.01) nz++;
    if ((js >= 1) !== (gl >= 1) && Math.abs(js - 1) > 0.02) disagree++;
    sumErr += e; if (e > maxErr) { maxErr = e; worst = { p: [pts[i*4], pts[i*4+1], pts[i*4+2]].map(v=>+v.toFixed(1)), js: +js.toFixed(4), gl: +gl.toFixed(4) }; }
  }
  return { points: N, nonzero: nz, meanErr: +(sumErr / N).toFixed(5), maxErr: +maxErr.toFixed(4), rideDisagree: disagree, worst };
})()
