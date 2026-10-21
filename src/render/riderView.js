// Rider and board visuals, the wake, the landing marker and the debug overlays.
// All placeholder art: an original rider and board built from primitives.

import * as THREE from 'three';
import { SLICE_VERT, SLICE_FRAG } from './shaders.js';
import { PALETTE } from './pipeline.js';
import { celify, addOutline } from './cel.js';

const C = {
  jacket: 0xe39a2f, pants: 0x27324f, boots: 0x1b1f2a, helmet: 0xf1f4f6, visor: 0x162033,
  board: 0xe9eff3, rail: 0x8cff4a, skin: 0xc58d6b,
};

function boardGeometry() {
  const s = new THREE.Shape();
  const L = 0.98, W = 0.27;
  s.moveTo(0, L);
  s.bezierCurveTo(W * 0.55, L * 0.96, W, L * 0.55, W, 0.05);
  s.bezierCurveTo(W, -L * 0.5, W * 0.8, -L * 0.92, W * 0.45, -L);
  s.lineTo(-W * 0.45, -L);
  s.bezierCurveTo(-W * 0.8, -L * 0.92, -W, -L * 0.5, -W, 0.05);
  s.bezierCurveTo(-W, L * 0.55, -W * 0.55, L * 0.96, 0, L);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, -0.025);
  g.rotateX(-Math.PI / 2); // nose (+Y in the shape) now points to -Z (forward)
  return g;
}

function limb(radius, color) {
  const g = new THREE.CylinderGeometry(radius, radius * 0.9, 1, 8, 1);
  g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true }));
  return m;
}

const _yAxis = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
function placeLimb(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.copy(a);
  mesh.scale.set(1, Math.max(0.001, len), 1);
  mesh.quaternion.setFromUnitVectors(_yAxis, _d.normalize());
}

export class RiderView {
  constructor(worldScene, fxScene, overlayScene, skyUniforms) {
    this.root = new THREE.Group();
    worldScene.add(this.root);

    // Board.
    this.boardGroup = new THREE.Group();
    this.root.add(this.boardGroup);
    const board = new THREE.Mesh(boardGeometry(), new THREE.MeshStandardMaterial({ color: C.board, roughness: 0.35, metalness: 0.1 }));
    this.boardGroup.add(board);
    const railGeo = new THREE.TorusGeometry(1, 0.012, 4, 48);
    railGeo.scale(0.27, 0.97, 1);
    railGeo.rotateX(-Math.PI / 2);
    this.railMat = new THREE.MeshBasicMaterial({ color: C.rail });
    const rail = new THREE.Mesh(railGeo, this.railMat);
    rail.position.y = -0.02;
    this.boardGroup.add(rail);
    const glowGeo = new THREE.PlaneGeometry(0.7, 2.2);
    glowGeo.rotateX(-Math.PI / 2);
    this.glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.trapar.clone().multiplyScalar(1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    glowGeo.translate(0, -0.07, 0);
    this.glow = new THREE.Mesh(glowGeo, this.glowMat);
    this.glow.frustumCulled = false;
    fxScene.add(this.glow);

    // Rider (on the board stands sideways, facing the board's right side). The body follows the
    // board while you ride and moves on its own on foot.
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.boardParts = [board, rail];
    this.walkPhase = 0;
    this.legL = limb(0.07, C.pants); this.legR = limb(0.07, C.pants);
    this.armL = limb(0.045, C.jacket); this.armR = limb(0.045, C.jacket);
    this.torso = limb(0.13, C.jacket);
    const bootGeo = new THREE.BoxGeometry(0.28, 0.1, 0.13);
    bootGeo.translate(0, 0.05, 0);
    const bootMat = new THREE.MeshStandardMaterial({ color: C.boots, roughness: 0.8 });
    this.bootL = new THREE.Mesh(bootGeo, bootMat); this.bootR = new THREE.Mesh(bootGeo, bootMat);
    const head = new THREE.Group();
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), new THREE.MeshStandardMaterial({ color: C.helmet, roughness: 0.3 }));
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.137, 14, 8, -0.9, 1.8, 1.0, 0.75), new THREE.MeshStandardMaterial({ color: C.visor, roughness: 0.1, metalness: 0.4 }));
    visor.rotation.y = Math.PI / 2;
    head.add(helmet, visor);
    this.head = head;
    this.body.add(this.legL, this.legR, this.armL, this.armR, this.torso, this.bootL, this.bootR, head);
    for (const m of [this.legL, this.legR, this.armL, this.armR, this.torso]) m.castShadow = false;
    // Painted as a cel character, with its contour line (cel.js).
    celify(this.root, { char: true });
    addOutline(this.root);
    // A drawn shadow on the ground when on foot: one flat shape in the ground's shade tone.
    const shGeo = new THREE.CircleGeometry(0.42, 24);
    shGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.6, 0.58, 0.78), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }));
    this.shadow.scale.set(1, 1, 0.8);
    this.shadow.visible = false;
    worldScene.add(this.shadow);

    // Wake particles.
    this.maxWake = 900;
    this.wakePos = new Float32Array(this.maxWake * 3);
    this.wakeVel = new Float32Array(this.maxWake * 3);
    this.wakeAge = new Float32Array(this.maxWake).fill(99);
    this.wakeLife = new Float32Array(this.maxWake).fill(1);
    this.wakeAlpha = new Float32Array(this.maxWake);
    this.wakeHead = 0;
    this.wakeAcc = 0;
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(this.wakePos, 3).setUsage(THREE.DynamicDrawUsage));
    wg.setAttribute('alpha', new THREE.BufferAttribute(this.wakeAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.wakeMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: PALETTE.trapar.clone().multiplyScalar(2.2) }, uScale: { value: 220 } },
      vertexShader: /* glsl */`
        attribute float alpha; varying float vA; uniform float uScale;
        void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uScale * (0.08 + 0.1 * (1.0 - alpha)) / -mv.z, 1.0, 6.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        varying float vA; uniform vec3 uColor;
        void main() { vec2 q = gl_PointCoord - 0.5; float d = dot(q, q) * 4.0; if (d > 1.0) discard;
          gl_FragColor = vec4(uColor, vA); }`,   // (crisp sparks of green trapar, not soft blobs)
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.wake = new THREE.Points(wg, this.wakeMat);
    this.wake.frustumCulled = false;
    fxScene.add(this.wake);

    // Overlay: landing marker and its drop line.
    this.reticle = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(1.5, 1.9, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.reticleMat = new THREE.MeshBasicMaterial({ color: 0x40ffb0, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    this.reticle.add(new THREE.Mesh(ringGeo, this.reticleMat));
    const dotGeo = new THREE.CircleGeometry(0.35, 20);
    dotGeo.rotateX(-Math.PI / 2);
    this.reticle.add(new THREE.Mesh(dotGeo, this.reticleMat));
    // Brace lock: an outer ring when braced in the air and lined up with a target.
    const lockGeo = new THREE.RingGeometry(2.4, 2.8, 48);
    lockGeo.rotateX(-Math.PI / 2);
    this.lockMat = new THREE.MeshBasicMaterial({ color: 0x8af3ff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    this.lockRing = new THREE.Mesh(lockGeo, this.lockMat);
    this.reticle.add(this.lockRing);
    this.reticle.renderOrder = 10;
    overlayScene.add(this.reticle);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.dropLineMat = new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, dashSize: 2, gapSize: 2, depthTest: false });
    this.dropLine = new THREE.Line(lineGeo, this.dropLineMat);
    this.dropLine.frustumCulled = false;
    overlayScene.add(this.dropLine);

    // Overlay: boost target beacon (a ring on the target surface and a tall beam above it).
    this.beacon = new THREE.Group();
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xc89bff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    const bRing = new THREE.RingGeometry(2.6, 3.2, 40); bRing.rotateX(-Math.PI / 2);
    this.beacon.add(new THREE.Mesh(bRing, this.beaconMat));
    const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1, true); beamGeo.translate(0, 0.5, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xc89bff, transparent: true, opacity: 0.45, depthTest: false });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beacon.add(this.beam);
    this.beacon.renderOrder = 9;
    overlayScene.add(this.beacon);

    // Overlay: route destination (a gold ring on the island and a very tall beam).
    this.routeMark = new THREE.Group();
    this.routeMat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
    const rRing = new THREE.RingGeometry(0.85, 1, 64); rRing.rotateX(-Math.PI / 2);
    this.routeRing = new THREE.Mesh(rRing, this.routeMat);
    this.routeMark.add(this.routeRing);
    this.routeBeamMat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.35, depthTest: false });
    this.routeBeam = new THREE.Mesh(beamGeo, this.routeBeamMat);
    this.routeMark.add(this.routeBeam);
    this.routeMark.renderOrder = 8;
    this.routeMark.visible = false;
    overlayScene.add(this.routeMark);
    this.routeIsland = null;

    // Overlay: force arrows.
    const mk = (c) => { const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, c, 0.4, 0.25); a.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } }); a.renderOrder = 11; overlayScene.add(a); return a; };
    this.arrows = { vel: mk(0xffffff), support: mk(0x40ffd0), flow: mk(0x5aa8ff), normal: mk(0xffc040) };

    // Debug: vertical density slice through the rider along the direction of travel, shown
    // as a side view in a corner inset.
    this.sliceW = 640; this.sliceH = 360;
    const sliceGeo = new THREE.PlaneGeometry(this.sliceW, this.sliceH, 1, 1);
    this.sliceMat = new THREE.ShaderMaterial({
      uniforms: { ...skyUniforms, uRideThr: { value: 1 }, uBaseThr: { value: 1 }, uMistMin: { value: 0.06 }, uRiderPos: { value: new THREE.Vector3() } },
      vertexShader: SLICE_VERT, fragmentShader: SLICE_FRAG,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.slice = new THREE.Mesh(sliceGeo, this.sliceMat);
    this.slice.frustumCulled = false;
    this.sliceScene = new THREE.Scene();
    this.sliceScene.add(this.slice);
    this.sliceCam = new THREE.OrthographicCamera(-this.sliceW / 2, this.sliceW / 2, this.sliceH / 2, -this.sliceH / 2, 1, 2000);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._hip = new THREE.Vector3(); this._chest = new THREE.Vector3();
    this.tumble = new THREE.Quaternion();
  }

  // The route's destination island (or null).
  setRoute(I) { this.routeIsland = I; this.routeMark.visible = !!I; }

  update(dt, rider, P, camera) {
    this.shadow.visible = rider.mode === 'foot' && rider.state === 'walking';
    if (this.shadow.visible) {
      this.shadow.position.set(rider.pos.x, rider.pos.y + 0.03, rider.pos.z);
      this.shadow.rotation.y = Math.atan2(rider.facing.x, rider.facing.z);
    }
    if (rider.mode === 'foot') { this._updateFoot(dt, rider, P, camera); return; }
    for (const m of this.boardParts) m.visible = true;
    this.boardGroup.visible = true;
    const v = this._v;
    // Board basis: X = right, Y = up, Z = -forward.
    const f = rider.fwd, u = rider.up;
    this._m.makeBasis(
      this._v2.set(rider.right.x, rider.right.y, rider.right.z),
      this._v3.set(u.x, u.y, u.z),
      v.set(-f.x, -f.y, -f.z),
    );
    this._q.setFromRotationMatrix(this._m);
    // Lean onto the rail, plus a tumble during wipeouts.
    const vis = rider.vis;
    const lean = vis.lean * (rider.state === 'riding' ? 0.45 : 0.15);
    const leanQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lean);
    if (rider.wipeT > 0) {
      const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(dt * 9, dt * 5, dt * 7));
      this.tumble.multiply(spin);
    } else this.tumble.slerp(new THREE.Quaternion(), Math.min(1, dt * 6));
    this.boardGroup.quaternion.copy(this._q).multiply(leanQ).multiply(this.tumble);
    this.boardGroup.position.set(rider.pos.x, rider.pos.y, rider.pos.z);
    this.body.position.copy(this.boardGroup.position); this.body.quaternion.copy(this.boardGroup.quaternion);
    this.boardGroup.scale.setScalar(1);
    this.glow.position.copy(this.boardGroup.position);
    this.glow.quaternion.copy(this.boardGroup.quaternion);

    // Pose: sideways stance, knees bend with crouch, arms out for balance.
    const cr = Math.max(vis.crouch, (vis.brace || 0) * 0.6);   // bracing sinks into the knees
    const hipY = 0.95 - cr * 0.34;
    const footF = new THREE.Vector3(0, 0.06, -0.33), footB = new THREE.Vector3(0, 0.06, 0.33);
    // Weight on the tail (stick back, snaps) shifts the hips over the back foot.
    const tl = vis.tail || 0;
    const hip = this._hip.set(-0.04 + cr * 0.06, hipY - tl * 0.05, tl * 0.14);
    const kneeOut = 0.12 + cr * 0.12;
    placeLimb(this.legL, footF, hip.clone().add(new THREE.Vector3(kneeOut * 0.3, 0, -0.08)));
    placeLimb(this.legR, footB, hip.clone().add(new THREE.Vector3(kneeOut * 0.3, 0, 0.08)));
    this.bootL.position.copy(footF).setY(0.02); this.bootR.position.copy(footB).setY(0.02);
    const chest = this._chest.set(hip.x + 0.1 + cr * 0.12, hipY + 0.55 - cr * 0.08, tl * 0.22);
    placeLimb(this.torso, hip, chest);
    const armDrop = 0.25 + cr * 0.1;
    placeLimb(this.armL, chest.clone().add(new THREE.Vector3(0, -0.02, -0.12)), chest.clone().add(new THREE.Vector3(0.05, -armDrop, -0.62)));
    placeLimb(this.armR, chest.clone().add(new THREE.Vector3(0, -0.02, 0.12)), chest.clone().add(new THREE.Vector3(0.05, -armDrop, 0.62)));
    this.head.position.set(chest.x + 0.05, chest.y + 0.2, -0.04);
    this.head.rotation.set(0, Math.PI / 2 + 0.9, 0);
    this.bootL.rotation.set(0, 0, 0); this.bootR.rotation.set(0, 0, 0);

    // Glow under the board while it touches ridable cloud.
    // Brighter while a stream holds you on a steep wall; warm and flickering about to peel.
    const holding = rider.state === 'riding' && rider.onStream && rider.holdNeed > 0.5 ? rider.hold : 0;
    const peel = rider.state === 'riding' && rider.onStream && rider.holdNeed > 1 && rider.holdMargin < 1.5;
    this._holdVis = (this._holdVis || 0) + (holding - (this._holdVis || 0)) * Math.min(1, dt * 8);
    const flick = peel ? 0.6 + 0.4 * Math.sin(performance.now() * 0.03) : 1;
    this.glowMat.opacity = Math.min(1, Math.max(vis.contact * 0.35 + this._holdVis * 0.5, vis.boost * 0.9) * flick);
    this.glowMat.color.copy(PALETTE.trapar).multiplyScalar(1.2 + vis.boost * 1.8 + this._holdVis * 1.2);
    if (peel) this.glowMat.color.lerp(new THREE.Color(1.6, 0.5, 0.3), 0.7);
    this.railMat.color.setHex(C.rail).multiplyScalar(0.6 + vis.contact * 0.9);

    this._updateWake(dt, rider, P);
    this._updateOverlay(rider, P, camera);
  }

  // Draw the density slice inset in the lower-left corner (call after the main render).
  renderSlice(renderer, P) {
    if (!P.showSlice) return;
    const el = renderer.domElement;
    const cssW = el.clientWidth, cssH = el.clientHeight;
    const w = Math.min(420, cssW - 28), h = Math.round(w * this.sliceH / this.sliceW);
    const x = 14, y = 52;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    renderer.autoClear = false;
    renderer.render(this.sliceScene, this.sliceCam);
    renderer.autoClear = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, cssW, cssH);
  }

  _updateWake(dt, rider, P) {
    const n = this.maxWake;
    this.wake.visible = P.showWake;
    const exhaust = rider.boosting && rider.state !== 'riding';
    if ((rider.state === 'riding' || exhaust) && P.showWake) {
      const sp = rider.vis.speed;
      this.wakeAcc += dt * (exhaust ? 180 : Math.min(220, 30 + sp * 4) * (rider.boosting ? 1.6 : 1));
      const f = rider.fwd, u = rider.up, r = rider.right;
      // Riding: spray carried by the trapar flow. Boosting in the air: a trail pushed back
      // opposite the thrust.
      const fl = rider.dbg.flow, aim = rider.boostAim;
      const flow = exhaust ? { x: rider.vel.x - aim.x * 25, y: rider.vel.y - aim.y * 25, z: rider.vel.z - aim.z * 25 } : fl;
      while (this.wakeAcc >= 1) {
        this.wakeAcc -= 1;
        const i = this.wakeHead; this.wakeHead = (this.wakeHead + 1) % n;
        const side = (Math.random() - 0.5) * 0.5;
        this.wakePos[i * 3] = rider.pos.x - f.x * 0.75 + r.x * side - u.x * 0.06;
        this.wakePos[i * 3 + 1] = rider.pos.y - f.y * 0.75 + r.y * side - u.y * 0.06;
        this.wakePos[i * 3 + 2] = rider.pos.z - f.z * 0.75 + r.z * side - u.z * 0.06;
        const spray = 0.6 + sp * 0.05;
        this.wakeVel[i * 3] = flow.x + (Math.random() - 0.5) * spray + u.x * spray * 0.6;
        this.wakeVel[i * 3 + 1] = flow.y + (Math.random() - 0.5) * spray + u.y * spray * 0.6;
        this.wakeVel[i * 3 + 2] = flow.z + (Math.random() - 0.5) * spray + u.z * spray * 0.6;
        this.wakeAge[i] = 0;
        this.wakeLife[i] = 0.8 + Math.random() * 1.2;
      }
    }
    // Spray: thrown off the rail when the tail slides (draw slides, snaps).
    const sprayAmt = rider.state === 'riding' && P.showWake ? rider.vis.spray : 0;
    if (sprayAmt > 0.03) {
      this.sprayAcc = (this.sprayAcc || 0) + dt * sprayAmt * 320;
      const f = rider.fwd, u = rider.up, fl = rider.dbg.flow;
      let lx = rider.vel.x - fl.x, ly = rider.vel.y - fl.y, lz = rider.vel.z - fl.z;
      const along = lx * f.x + ly * f.y + lz * f.z;
      lx -= f.x * along; ly -= f.y * along; lz -= f.z * along;
      const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
      const sp = 6 + rider.vis.speed * 0.35;
      while (this.sprayAcc >= 1) {
        this.sprayAcc -= 1;
        const i = this.wakeHead; this.wakeHead = (this.wakeHead + 1) % n;
        const back = 0.4 + Math.random() * 0.6;
        this.wakePos[i * 3] = rider.pos.x - f.x * back + lx * 0.3;
        this.wakePos[i * 3 + 1] = rider.pos.y - f.y * back + ly * 0.3;
        this.wakePos[i * 3 + 2] = rider.pos.z - f.z * back + lz * 0.3;
        const j = () => (Math.random() - 0.5) * sp * 0.35;
        const up = sp * (0.35 + Math.random() * 0.4);
        this.wakeVel[i * 3] = fl.x + lx * sp + u.x * up + j();
        this.wakeVel[i * 3 + 1] = fl.y + ly * sp + u.y * up + j();
        this.wakeVel[i * 3 + 2] = fl.z + lz * sp + u.z * up + j();
        this.wakeAge[i] = 0;
        this.wakeLife[i] = 0.5 + Math.random() * 0.6;
      }
    }
    for (let i = 0; i < n; i++) {
      const age = (this.wakeAge[i] += dt);
      const life = this.wakeLife[i];
      if (age < life) {
        this.wakePos[i * 3] += this.wakeVel[i * 3] * dt;
        this.wakePos[i * 3 + 1] += this.wakeVel[i * 3 + 1] * dt;
        this.wakePos[i * 3 + 2] += this.wakeVel[i * 3 + 2] * dt;
        this.wakeAlpha[i] = (1 - age / life) * 0.8;
      } else this.wakeAlpha[i] = 0;
    }
    this.wake.geometry.attributes.position.needsUpdate = true;
    this.wake.geometry.attributes.alpha.needsUpdate = true;
  }

  // On foot: walking upright, skydiving face down (arms out), diving head first, rolling on a
  // hard landing; the board flies in while you call it.
  _updateFoot(dt, rider, P, camera) {
    const vis = rider.vis, f = rider.facing, sky = vis.sky || 0, dive = (vis.dive || 0) * sky;
    const X = new THREE.Vector3(f.x, 0, f.z).normalize(), Y = new THREE.Vector3(0, 1, 0);
    const qW = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y)));
    const Xs = new THREE.Vector3(0, -1, 0), Ys = X.clone().multiplyScalar(0.97).add(new THREE.Vector3(0, 0.25, 0)).normalize();
    const qS = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xs, Ys, new THREE.Vector3().crossVectors(Xs, Ys)));
    const Xd = X.clone().multiplyScalar(0.3).add(new THREE.Vector3(0, -0.2, 0)).normalize(), Yd = new THREE.Vector3(0, -1, 0).add(X.clone().multiplyScalar(0.25)).normalize();
    const Xd2 = Xd.clone().addScaledVector(Yd, -Xd.dot(Yd)).normalize();
    const qD = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xd2, Yd, new THREE.Vector3().crossVectors(Xd2, Yd)));
    const q = qW.clone().slerp(qS, sky).slerp(qD, dive);
    // A roll on a hard landing: a forward somersault.
    if (rider.rollT > 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(1 - rider.rollT / 0.6) * Math.PI * 2));
    this.body.quaternion.slerp(q, Math.min(1, dt * 10));
    // Walking on the feet; in the air turning about the hips.
    const hipOff = new THREE.Vector3(0, 0.95 * Math.max(sky, rider.rollT > 0 ? 1 : 0), 0).applyQuaternion(this.body.quaternion);
    this.body.position.set(rider.pos.x, rider.pos.y, rider.pos.z).sub(hipOff);

    // Pose (local: facing +X, up +Y).
    const sp = vis.walk || 0;
    this.walkPhase += dt * Math.min(14, sp * 1.25);
    const ph = this.walkPhase, a = Math.min(0.45, sp * 0.045), run = Math.min(1, sp / 12);
    const mix = (w, s, d) => new THREE.Vector3().copy(w).lerp(s, sky).lerp(d, dive);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const hip = mix(V(0.02 * run, 0.95 - 0.04 * run + 0.03 * Math.abs(Math.sin(ph)), 0), V(0, 0.95, 0), V(0, 0.95, 0));
    const footL = mix(V(a * Math.sin(ph), 0.05 + 0.18 * a * Math.max(0, Math.cos(ph)), -0.12), V(-0.12, 0.12, -0.36), V(0, 0.05, -0.08));
    const footR = mix(V(-a * Math.sin(ph), 0.05 + 0.18 * a * Math.max(0, -Math.cos(ph)), 0.12), V(-0.12, 0.12, 0.36), V(0, 0.05, 0.08));
    const chest = mix(V(0.06 + 0.12 * run, 1.5, 0), V(0, 1.5, 0), V(0, 1.5, 0));
    const handL = mix(V(chest.x - 0.6 * a * Math.sin(ph), 1.0 + 0.1 * run, -0.27), V(0.08, 1.85, -0.78), V(0.02, 1.0, -0.26));
    const handR = mix(V(chest.x + 0.6 * a * Math.sin(ph), 1.0 + 0.1 * run, 0.27), V(0.08, 1.85, 0.78), V(0.02, 1.0, 0.26));
    placeLimb(this.legL, footL, hip.clone().add(V(0, 0, -0.1)));
    placeLimb(this.legR, footR, hip.clone().add(V(0, 0, 0.1)));
    this.bootL.position.copy(footL).setY(footL.y - 0.04); this.bootR.position.copy(footR).setY(footR.y - 0.04);
    this.bootL.rotation.set(0, 0, 0); this.bootR.rotation.set(0, 0, 0);
    placeLimb(this.torso, hip, chest);
    placeLimb(this.armL, chest.clone().add(V(0, -0.02, -0.2)), handL);
    placeLimb(this.armR, chest.clone().add(V(0, -0.02, 0.2)), handR);
    this.head.position.copy(chest).add(V(0.03, 0.2, 0));
    this.head.rotation.set(0, Math.PI / 2, 0);

    // The board: hidden, or flying in to your feet while you call it.
    const k = rider.summonT > 0 ? rider.summonT / Math.max(0.01, P.summonTime) : -1;
    this.boardGroup.visible = k >= 0;
    if (k >= 0) {
      const feet = new THREE.Vector3(rider.pos.x, rider.pos.y, rider.pos.z).addScaledVector(new THREE.Vector3(0, -1, 0), 1.1);
      const from = feet.clone().addScaledVector(X, -9).add(V(0, 5, 0));
      this.boardGroup.position.copy(feet).lerp(from, k * k);
      const Xb = new THREE.Vector3().crossVectors(X, Y);
      this.boardGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xb, Y, X.clone().negate()));
      this.boardGroup.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k * 2.5));
    }
    this.glowMat.opacity = 0;
    this._updateWake(dt, rider, P);
    this._updateOverlay(rider, P, camera);
  }

  _updateOverlay(rider, P, camera) {
    // Route destination.
    const RI = this.routeIsland;
    if (RI) {
      const y = RI.top(RI.x, RI.z);
      this.routeMark.position.set(RI.x, y + 1, RI.z);
      const dist = camera.position.distanceTo(this.routeMark.position);
      this.routeRing.scale.setScalar(RI.R * 0.9);
      const w = Math.max(2, dist * 0.004);
      this.routeBeam.scale.set(w, 1500, w);
    }
    const tg = rider.boostTarget;
    const showB = P.reachScan && tg && (rider.state !== 'riding' || rider.gauge >= tg.need);
    this.beacon.visible = !!showB;
    if (showB) {
      this.beacon.position.set(tg.x, tg.y + 0.5, tg.z);
      const dist = camera.position.distanceTo(this.beacon.position);
      const sc = Math.max(1, dist * 0.012);
      this.beacon.children[0].scale.setScalar(sc);
      this.beam.scale.set(sc, Math.max(60, dist * 0.08), sc);
      const col = tg.kind === 'rescue' ? 0xffd27a : 0xc89bff;
      this.beaconMat.color.setHex(col); this.beamMat.color.setHex(col);
    }
    const pr = rider.mode === 'foot' ? rider.footMark : rider.predict;
    const show = P.showReticle && rider.state !== 'riding' && rider.state !== 'walking' && pr && pr.hit;
    this.reticle.visible = !!show;
    this.dropLine.visible = !!show;
    if (show) {
      const p = pr.point, n = pr.normal;
      this.reticle.position.set(p.x, p.y, p.z).addScaledVector(new THREE.Vector3(n.x, n.y, n.z), 0.3);
      this.reticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z));
      const dist = camera.position.distanceTo(this.reticle.position);
      this.reticle.scale.setScalar(Math.max(1, dist * 0.018));
      const type = pr.quality.type;
      this.reticleMat.color.setHex(type === 'clean' ? 0x40ffb0 : type === 'sketchy' ? 0xffc23d : 0xff4d5e);
      if (pr.ground) this.reticleMat.color.setHex(0xffffff);   // (an island's ground)
      this.lockRing.visible = rider.brace > 0.3 && rider.mode === 'board';
      const pos = this.dropLine.geometry.attributes.position;
      pos.setXYZ(0, rider.pos.x, rider.pos.y, rider.pos.z);
      pos.setXYZ(1, p.x, p.y, p.z);
      pos.needsUpdate = true;
      this.dropLine.computeLineDistances();
    }

    const showA = P.showArrows;
    const place = (arrow, vec, scale, minLen = 0.05) => {
      const len = Math.hypot(vec.x, vec.y, vec.z) * scale;
      arrow.visible = showA && len > minLen;
      if (!arrow.visible) return;
      arrow.position.set(rider.pos.x, rider.pos.y + 0.6, rider.pos.z);
      arrow.setDirection(new THREE.Vector3(vec.x, vec.y, vec.z).normalize());
      arrow.setLength(Math.min(len, 40), Math.min(0.8, len * 0.3), Math.min(0.5, len * 0.2));
    };
    place(this.arrows.vel, rider.vel, 0.25);
    place(this.arrows.support, rider.dbg.support, 0.12);
    place(this.arrows.flow, rider.dbg.flow, 0.25);
    place(this.arrows.normal, rider.state === 'riding' ? rider.normal : { x: 0, y: 0, z: 0 }, 3);

    if (P.showSlice) {
      // Plane containing the travel direction and world up, centered a little ahead of the rider.
      const dir = new THREE.Vector3(rider.vel.x - rider.dbg.flow.x, 0, rider.vel.z - rider.dbg.flow.z);
      if (dir.lengthSq() < 1) dir.set(rider.fwd.x, 0, rider.fwd.z);
      if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
      dir.normalize();
      const c = new THREE.Vector3(rider.pos.x + dir.x * this.sliceW * 0.25, rider.pos.y, rider.pos.z + dir.z * this.sliceW * 0.25);
      this.slice.position.copy(c);
      this.slice.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      const side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.slice.quaternion);
      this.sliceCam.position.copy(c).addScaledVector(side, 500);
      this.sliceCam.up.set(0, 1, 0);
      this.sliceCam.lookAt(c);
      this.sliceCam.updateMatrixWorld();
      const u = this.sliceMat.uniforms;
      u.uRideThr.value = rider.dbg.thr;
      u.uBaseThr.value = P.rideThreshold;
      u.uMistMin.value = 0.06;
      u.uRiderPos.value.set(rider.pos.x, rider.pos.y, rider.pos.z);
    }
  }
}
