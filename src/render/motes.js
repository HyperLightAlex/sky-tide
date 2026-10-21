// Trapar motes: tens of thousands of points that drift with the trapar medium around the
// camera. They light up wherever trapar is present (brightest where it is ridable) and rise
// inside plumes, so you can see trapar's motion up close.

import * as THREE from 'three';
import { MOTES_VERT, MOTES_FRAG } from './shaders.js';

export class Motes {
  constructor(fxScene, skyUniforms, look, count = 30000, box = 260) {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MOTES_VERT,
      fragmentShader: MOTES_FRAG,
      uniforms: {
        ...skyUniforms,
        uSkinA: look.uSkinA, uPlumeColor: look.uPlumeColor,
        uCamPos: { value: new THREE.Vector3() },
        uBox: { value: box }, uTime: { value: 0 }, uRideThr: { value: 1 }, uMistMin: { value: 0.06 },
        uMotes: { value: 1 }, uUpdraft: { value: 20 }, uSize: { value: 260 },
      },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    fxScene.add(this.points);
  }

  update(camera, P, rider, time, pixelRatio) {
    const u = this.mat.uniforms;
    u.uCamPos.value.copy(camera.position);
    u.uTime.value = time;
    u.uRideThr.value = rider.dbg.thr;
    u.uMistMin.value = 0.06;
    u.uMotes.value = P.motes;
    u.uUpdraft.value = 0;
    u.uSize.value = 260 * pixelRatio;
    this.points.visible = P.motes > 0.001;
  }
}
