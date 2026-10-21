// Render pipeline:
//   1. World scene (rider, board) into an HDR target with a depth texture.
//   2. Sky pass at reduced resolution: water clouds and trapar, each ray marched only up to
//      the scene depth so the rider is hidden by anything in front of it.
//   3. Composite into an HDR target that shares the scene depth.
//   4. Effects (trapar motes, wake, board glow) drawn into it, depth-tested against the rider.
//   5. Final tone map to the screen, then the overlay (landing marker, debug arrows).

import * as THREE from 'three';
import { makeSkyUniforms, syncSkyUniforms } from '../sky/sky.js';
import { FULLSCREEN_VERT, SKY_PASS_FRAG, COMPOSITE_FRAG, INK_FRAG, FINAL_FRAG, COPY_FRAG, GLOW_EXTRACT_FRAG, BLUR_FRAG } from './shaders.js';
import { BR } from '../trapar/braids.js';
import { unToneJS } from './painted.js';
import { paintedSetFor } from '../weather/cloudField.js';

export function makeNoiseTextures(bank) {
  const make = (vol) => {
    const t = new THREE.Data3DTexture(vol.bytes, vol.w, vol.h, vol.d);
    t.format = vol.channels === 2 ? THREE.RGFormat : THREE.RedFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  };
  return { A: make(bank.A), B: make(bank.B), C: make(bank.C) };
}

// Float textures holding the stream snapshot (segments, per-cell index list, cell table).
// They wrap the engine's own arrays and are re-uploaded whenever a new snapshot is built.
export function makeBraidTextures(braids) {
  const make = (data, format) => {
    const ch = format === THREE.RGBAFormat ? 4 : format === THREE.RGFormat ? 2 : 1;
    const t = new THREE.DataTexture(data, BR.TEX_W, data.length / ch / BR.TEX_W, format, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  };
  return { brSeg: make(braids.seg, THREE.RGBAFormat), brIdx: make(braids.idx, THREE.RedFormat), brCell: make(braids.cell, THREE.RGFormat) };
}

export const PALETTE = {
  zenith: new THREE.Color(0.045, 0.12, 0.42),
  skyMid: new THREE.Color(0.14, 0.34, 0.78),     // the clean lighter blue below the zenith
  horizon: new THREE.Color(1.0, 0.6, 0.3),       // low on the horizon toward the sun
  horizonAnti: new THREE.Color(0.6, 0.48, 0.66), // low on the far side
  abyss: new THREE.Color(0.012, 0.016, 0.06),
  sun: new THREE.Color(1.0, 0.8, 0.58),
  skinA: new THREE.Color(0.08, 0.5, 0.95),   // ridable streams (translucent blue; the mesh streams: streamMesh.js)
  skinB: new THREE.Color(0.5, 0.82, 1.0),    // ridable streams at grazing angles
  plume: new THREE.Color(0.45, 0.78, 1.0),
  thin: new THREE.Color(0.32, 0.45, 0.95),   // trapar too thin to ride right now
  trapar: new THREE.Color(0.3, 0.95, 0.1),   // the green trapar a board throws up (its trail, glow, wake)
  traparCore: new THREE.Color(0.88, 1.0, 0.35),
};

export class SkyPipeline {
  constructor(renderer, world, textures) {
    this.renderer = renderer;
    this.world = world;
    this.size = new THREE.Vector2(1, 1);
    this.cloudScale = 0.45;

    this.depth = new THREE.DepthTexture(1, 1);
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.sceneRT.depthTexture = this.depth;
    this.compRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.compRT.depthTexture = this.depth;
    // The sky pass (low resolution) is only for the ray-marched streams now (the comparison
    // view; the clouds are painted cards, render/cloudView.js).
    this.cloudRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.cloudRT.texture.minFilter = this.cloudRT.texture.magFilter = THREE.LinearFilter;
    this.exposure = { value: 1 };   // shared with everything painted (painted.js unTone)

    this.sunDir = new THREE.Vector3(0, 0.3, -1).normalize();
    const common = {
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSkyMid: { value: new THREE.Color() }, uHorizonAnti: { value: new THREE.Color() },
      uAbyss: { value: new THREE.Color() },
      uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
    };
    this.common = common;
    this.braidTex = makeBraidTextures(world.trapar.braids);
    this._braidVersion = -1;
    this.skyUniforms = makeSkyUniforms({ ...textures, ...this.braidTex }, world);
    this.look = {
      uSkinA: { value: PALETTE.skinA.clone() },
      uSkinB: { value: PALETTE.skinB.clone() },
      uPlumeColor: { value: PALETTE.plume.clone() },
    };

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SKY_PASS_FRAG,
      uniforms: {
        ...this.skyUniforms, ...common, ...this.look,
        tDepth: { value: this.depth },
        uCamPos: { value: new THREE.Vector3() },
        uSteps: { value: 96 },
        uExtinction: { value: 0.02 }, uFogDist: { value: 7000 }, uMaxDist: { value: 12000 }, uMinT: { value: 0.08 }, uStepK: { value: new THREE.Vector2(0.04, 1.5) },
        uRideThr: { value: 1 }, uBaseThr: { value: 1 },
        uSkinOpacity: { value: 0.8 }, uSkinGlow: { value: 1 }, uStripes: { value: 0.5 },
        uSwellHi: { value: 1 }, uInterior: { value: 0.5 },
        uOutline: { value: 1 }, uContours: { value: 0.7 }, uContourStep: { value: 12 }, uThin: { value: 0.6 },
        uThinColor: { value: PALETTE.thin.clone() },
        uPulseOrigin: { value: new THREE.Vector3() }, uPulseRadius: { value: 0 }, uPulseStrength: { value: 0 }, uPulseWidth: { value: 120 },
      },
      depthTest: false, depthWrite: false,
      defines: { WX_NO_CLOUDS: 1 },
    });
    // The ink pass: the solid world lined (shaders.js INK_FRAG), read by the composite.
    this.inkRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.inkMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: INK_FRAG,
      uniforms: {
        tScene: { value: this.sceneRT.texture }, tDepth: { value: this.depth }, uTexel: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.5 }, uFar: { value: 20000 }, uInk: { value: 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        ...common,
        tScene: { value: this.inkRT.texture },
        tClouds: { value: this.cloudRT.texture },
        uCloudTexel: { value: new THREE.Vector2(1, 1) }, uSkyPass: { value: 0 },
        tPano: { value: null }, uPanoOn: { value: 0 }, uPanoSunU: { value: 0.25 }, uPanoHorizon: { value: 0.03 },
        uExposure: this.exposure,
      },
      depthTest: false, depthWrite: false,
    });
    // Glow (only the light glows): targets at a half, a quarter and an eighth of the frame.
    const grt = () => { const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }); t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter; return t; };
    this.glowBase = grt(); this.glowHalf = grt();
    this.glowQ1 = grt(); this.glowQ2 = grt(); this.glowE1 = grt(); this.glowE2 = grt();
    const q = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.copyMat = q(COPY_FRAG, { tSrc: { value: this.compRT.texture } });
    this.extractMat = q(GLOW_EXTRACT_FRAG, { tAfter: { value: this.compRT.texture }, tBase: { value: this.glowBase.texture }, uThreshold: { value: 0.12 } });
    this.blurMat = q(BLUR_FRAG, { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FINAL_FRAG,
      uniforms: {
        tComp: { value: this.compRT.texture }, uExposure: this.exposure, uMist: { value: 0 }, uMistColor: { value: new THREE.Color(1, 1, 1) },
        tGlow: { value: this.glowQ2.texture }, tGlowWide: { value: this.glowE2.texture }, uGlow: { value: 1 },
        tDepth: { value: this.depth }, uSunGlow: { value: 1 }, uSunColor: common.uSunColor, uSunUv: { value: new THREE.Vector2(-9, -9) }, uAspect: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, pixelRatio) {
    this.size.set(Math.max(1, Math.floor(w * pixelRatio)), Math.max(1, Math.floor(h * pixelRatio)));
    this.sceneRT.setSize(this.size.x, this.size.y);
    this.compRT.setSize(this.size.x, this.size.y);
    this.inkRT.setSize(this.size.x, this.size.y);
    const hx = Math.max(1, this.size.x >> 1), hy = Math.max(1, this.size.y >> 1);
    this.glowBase.setSize(hx, hy); this.glowHalf.setSize(hx, hy);
    this.glowQ1.setSize(Math.max(1, hx >> 1), Math.max(1, hy >> 1)); this.glowQ2.setSize(Math.max(1, hx >> 1), Math.max(1, hy >> 1));
    this.glowE1.setSize(Math.max(1, hx >> 2), Math.max(1, hy >> 2)); this.glowE2.setSize(Math.max(1, hx >> 2), Math.max(1, hy >> 2));
    this.finalMat.uniforms.uAspect.value.set(this.size.x / this.size.y, 1);
    this._resizeClouds();
  }

  setCloudScale(s) {
    if (Math.abs(s - this.cloudScale) < 0.005) return;
    this.cloudScale = s;
    this._resizeClouds();
  }

  _resizeClouds() {
    const w = Math.max(1, Math.floor(this.size.x * this.cloudScale)), h = Math.max(1, Math.floor(this.size.y * this.cloudScale));
    this.cloudRT.setSize(w, h);
    this.compMat.uniforms.uCloudTexel.value.set(1 / w, 1 / h);
  }

  // A new stream snapshot: upload only the rows it uses (a full upload of the float textures
  // is tens of megabytes, a hitch every time the snapshot moves).
  _uploadBraids() {
    const r = this.renderer, gl = r.getContext(), br = this.world.trapar.braids, W = BR.TEX_W;
    const S = br.S, nCells = S.uBrDims[0] * S.uBrDims[1] * S.uBrDims[2];
    const parts = [
      [this.braidTex.brSeg, br.seg, 4, Math.ceil((br.nSeg * BR.SEG_TEXELS) / W), gl.RGBA],
      [this.braidTex.brIdx, br.idx, 1, Math.ceil(br.nIdx / W), gl.RED],
      [this.braidTex.brCell, br.cell, 2, Math.ceil(nCells / W), gl.RG],
    ];
    for (const [tex, data, ch, rows, fmt] of parts) {
      const props = r.properties.get(tex);
      if (!props.__webglTexture || !this._braidsUploaded) { tex.needsUpdate = true; continue; }
      if (rows <= 0) continue;
      r.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, rows, fmt, gl.FLOAT, data.subarray(0, rows * W * ch));
    }
    this._braidsUploaded = true;
  }

  // Streams drawn as meshes (render/streamMesh.js): the sky pass is then not needed at all.
  setStreamMesh(on) {
    if (on === this._meshOn) return;
    this._meshOn = on;
    this.skyMat.defines = on ? { BR_DISABLE: 1, WX_NO_CLOUDS: 1 } : { WX_NO_CLOUDS: 1 };
    this.skyMat.needsUpdate = true;
  }

  _quad(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  _blur(src, dst, dx, dy, k) {
    const u = this.blurMat.uniforms;
    u.tSrc.value = src.texture;
    u.uStep.value.set(dx * k / src.width, dy * k / src.height);
    this._quad(this.blurMat, dst);
  }

  // The painted assets (painted.js): the sky behind everything, by time of day.
  setPainted(painted) { this.painted = painted; }

  // Trapar sense pulse: origin, current radius and strength (0 = off).
  setPulse(origin, radius, strength) {
    const su = this.skyMat.uniforms;
    if (origin) su.uPulseOrigin.value.set(origin.x, origin.y, origin.z);
    su.uPulseRadius.value = radius;
    su.uPulseStrength.value = strength;
  }

  updateLighting(P) {
    const el = THREE.MathUtils.degToRad(P.sunElevation), az = THREE.MathUtils.degToRad(P.sunAzimuth);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    const day = THREE.MathUtils.smoothstep(P.sunElevation, 2, 45);   // 0: golden hour, 1: midday
    const c = this.common;
    c.uSunColor.value.copy(PALETTE.sun).lerp(new THREE.Color(1.0, 0.95, 0.88), day * 0.6).multiplyScalar(2.7 * (0.25 + 0.75 * THREE.MathUtils.smoothstep(P.sunElevation, -5, 8)));
    this.exposure.value = P.exposure;
    const sky = this.painted && this.painted.skies[paintedSetFor(P)];
    if (sky) {
      // The haze everything fades into takes its colours from the painted sky.
      const set = (col, rgb) => col.setRGB(unToneJS(rgb[0], P.exposure), unToneJS(rgb[1], P.exposure), unToneJS(rgb[2], P.exposure));
      set(c.uZenith.value, sky.colors.zenith); set(c.uSkyMid.value, sky.colors.mid);
      set(c.uHorizon.value, sky.colors.horizon); set(c.uHorizonAnti.value, sky.colors.horizonAnti);
      const cu = this.compMat.uniforms;
      cu.tPano.value = sky.tex; cu.uPanoOn.value = 1; cu.uPanoSunU.value = sky.sunU; cu.uPanoHorizon.value = sky.horizonV;
    } else {
      c.uZenith.value.copy(PALETTE.zenith).lerp(new THREE.Color(0.16, 0.36, 0.78), day * 0.6);
      c.uHorizon.value.copy(PALETTE.horizon).lerp(new THREE.Color(0.72, 0.8, 0.92), day * 0.7);
      c.uSkyMid.value.copy(PALETTE.skyMid).lerp(new THREE.Color(0.25, 0.5, 0.92), day * 0.7);
      c.uHorizonAnti.value.copy(PALETTE.horizonAnti).lerp(new THREE.Color(0.6, 0.72, 0.92), day * 0.7);
    }
    c.uAbyss.value.copy(PALETTE.abyss);
  }

  render(camera, worldScene, fxScene, overlayScene, P, rideThr, streamScene = null, backScene = null, mist = null, veilScene = null) {
    const r = this.renderer;
    const c = this.common;
    camera.updateMatrixWorld();
    c.uProjInv.value.copy(camera.projectionMatrixInverse);
    c.uCamWorld.value.copy(camera.matrixWorld);
    syncSkyUniforms(this.skyUniforms, this.world);
    const bv = this.world.trapar.braids.version;
    if (bv !== this._braidVersion) {
      this._braidVersion = bv;
      this._uploadBraids();
    }

    const su = this.skyMat.uniforms;
    su.uCamPos.value.copy(camera.position);
    su.uSteps.value = Math.round(P.steps);
    su.uExtinction.value = P.extinction;
    su.uMinT.value = 0.015;
    su.uStepK.value.set(0.04, 1.5);
    su.uFogDist.value = P.fogDistance;
    const skyPass = !this._meshOn;
    this.compMat.uniforms.uSkyPass.value = skyPass ? 1 : 0;
    const iu = this.inkMat.uniforms;
    iu.uNear.value = camera.near; iu.uFar.value = camera.far; iu.uInk.value = P.ink;
    iu.uTexel.value.set(1 / this.sceneRT.width, 1 / this.sceneRT.height);
    const fu = this.finalMat.uniforms;
    fu.uMist.value = mist ? mist.amount : 0;
    if (mist) fu.uMistColor.value.setRGB(unToneJS(mist.color.r, P.exposure), unToneJS(mist.color.g, P.exposure), unToneJS(mist.color.b, P.exposure));
    su.uRideThr.value = rideThr;
    su.uBaseThr.value = P.rideThreshold;
    su.uSkinOpacity.value = P.skinOpacity;
    su.uSkinGlow.value = P.skinGlow;
    su.uStripes.value = P.flowStripes;
    su.uSwellHi.value = P.waterOn ? P.waveShade : 0;
    su.uInterior.value = P.interiorGlow;
    su.uOutline.value = P.outline;
    su.uContours.value = P.contours;
    su.uContourStep.value = P.contourStep;
    su.uThin.value = P.thinTrapar;

    // 1. Scene.
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(worldScene, camera);

    // 2. Sky pass (only for the ray-marched streams).
    if (skyPass) {
      this.quad.material = this.skyMat;
      r.setRenderTarget(this.cloudRT);
      r.render(this.quadScene, this.quadCam);
    }

    // 3-4. Composite, then effects tested against the scene depth (not cleared).
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.quad.material = this.inkMat;
    r.setRenderTarget(this.inkRT);
    r.render(this.quadScene, this.quadCam);
    this.quad.material = this.compMat;
    r.setRenderTarget(this.compRT);
    r.render(this.quadScene, this.quadCam);
    // The painted clouds and the cloud sea (render/cloudView.js): over the sky, tested against
    // the solid world; their solid parts write depth, so streams behind them are hidden.
    if (backScene) r.render(backScene, camera);
    // (the frame before the light goes on, for the glow)
    const glow = P.glow > 0.001;
    if (glow) this._quad(this.copyMat, this.glowBase);
    // The streams: translucent, over the sky and clouds, behind the solid world (render/streamMesh.js).
    r.setRenderTarget(this.compRT);
    if (streamScene) r.render(streamScene, camera);
    if (fxScene) r.render(fxScene, camera);
    // Glow: what the light added, kept where bright, blurred tight and wide.
    if (glow) {
      this.extractMat.uniforms.uThreshold.value = P.glowThreshold;
      this._quad(this.extractMat, this.glowHalf);
      this._blur(this.glowHalf, this.glowQ1, 1, 0, 1.0); this._blur(this.glowQ1, this.glowQ2, 0, 1, 1.0);
      this._blur(this.glowQ2, this.glowE1, 1, 0, 1.6); this._blur(this.glowE1, this.glowE2, 0, 1, 1.6);
      r.setRenderTarget(this.compRT);
    }
    // Things that are not light, over it (the puffs inside a cloud).
    if (veilScene) r.render(veilScene, camera);
    const fu2 = this.finalMat.uniforms;
    fu2.uGlow.value = glow ? P.glow : 0;
    // The sun's place on screen, for its glow.
    const sp = this._sp || (this._sp = new THREE.Vector3());
    sp.copy(this.sunDir).multiplyScalar(5000).add(camera.position).project(camera);
    const front = sp.z < 1 && this.sunDir.dot(camera.getWorldDirection(this._cd || (this._cd = new THREE.Vector3()))) > 0;
    fu2.uSunUv.value.set(front ? sp.x * 0.5 + 0.5 : -9, front ? sp.y * 0.5 + 0.5 : -9);
    fu2.uSunGlow.value = front ? P.sunGlow : 0;

    // 5. Tone map to the screen, then the overlay.
    this.quad.material = this.finalMat;
    r.setRenderTarget(null);
    r.clear(true, true, false);
    r.render(this.quadScene, this.quadCam);
    if (overlayScene) { r.clearDepth(); r.render(overlayScene, camera); }
    r.autoClear = autoClear;
  }
}
