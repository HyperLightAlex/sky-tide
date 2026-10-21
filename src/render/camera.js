// Chase camera. Follows the direction of travel, tilts a little with the surface,
// looks down toward the landing while falling, and widens its FOV with speed. While flying
// (boosting in free fall) it swings behind the board's nose, so you see where you are going. On steep
// stream walls, corkscrews and barrels it rolls with you (limited by the Camera roll setting).
// On foot it is an orbit camera you turn with the right stick.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// Rotate unit vector v toward unit vector target by at most ang radians.
function rotateToward(v, target, ang, tmp) {
  const full = Math.acos(THREE.MathUtils.clamp(v.dot(target), -1, 1));
  if (full < 1e-5 || ang <= 0) return v;
  const axis = tmp.crossVectors(v, target);
  if (axis.lengthSq() < 1e-10) { axis.set(1, 0, 0).cross(v); if (axis.lengthSq() < 1e-10) axis.set(0, 0, 1).cross(v); }
  axis.normalize();
  return v.applyAxisAngle(axis, Math.min(ang, full));
}

export class ChaseCam {
  constructor(camera) {
    this.camera = camera;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.fall = 0;
    this.nose = 0;
    this._t = new THREE.Vector3(); this._r = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._q = new THREE.Vector3(); this._a = new THREE.Vector3();
    this.initialized = false;
  }

  snap(rider, P) { this.initialized = false; this.update(1, rider, P, { lookX: 0, lookY: 0 }); }

  update(dt, rider, P, inp) {
    if (rider.mode === 'foot') { this._updateFoot(dt, rider, P, inp); return; }
    this.footInit = false;
    const k = 1 - Math.exp(-P.camLag * dt);
    const speed = rider.speed();
    const riding = rider.state === 'riding';

    // Target heading: travel direction relative to the air, else the board's nose.
    const target = this._t;
    const fl = rider.dbg.flow;
    target.set(rider.vel.x - fl.x, rider.vel.y - fl.y, rider.vel.z - fl.z);
    if (target.length() < 3) target.set(rider.fwd.x, rider.fwd.y, rider.fwd.z);
    target.normalize();
    // Flying (boosting in free fall): look along the nose (eases back after the boost ends).
    const noseT = rider.flying ? 1 : 0;
    this.nose += (noseT - this.nose) * (1 - Math.exp(-(noseT ? 4 : 1.5) * dt));
    if (this.nose > 0.001) target.lerp(this._p.set(rider.fwd.x, rider.fwd.y, rider.fwd.z), this.nose).normalize();
    // Camera up: tilts a little with the surface, and rolls with you on steep stream walls,
    // corkscrews and barrels (Camera roll sets how far, for comfort). Upright in the air.
    const upT = this._q.copy(UP);
    if (riding) {
      const nrm = this._p.set(rider.normal.x, rider.normal.y, rider.normal.z);
      const th = Math.acos(THREE.MathUtils.clamp(nrm.dot(UP), -1, 1));
      const f = THREE.MathUtils.lerp(P.camNormalBlend, P.camRoll, THREE.MathUtils.smoothstep(th, 0.5, 1.3));
      rotateToward(upT, nrm, f * th, this._a);
    }
    rotateToward(this.up, upT, Math.acos(THREE.MathUtils.clamp(this.up.dot(upT), -1, 1)) * (1 - Math.exp(-4 * dt)), this._a);
    this.up.normalize();

    // Limit how steeply we look (relative to the camera's up): while riding, follow the
    // slope; while falling, look down more.
    const fallTarget = riding || rider.boosting ? 0 : THREE.MathUtils.clamp(-rider.vel.y / 40, 0, 1);
    this.fall += (fallTarget - this.fall) * (1 - Math.exp(-2.5 * dt));
    const maxDown = THREE.MathUtils.lerp(0.45, 0.85, this.fall);
    const upMax = THREE.MathUtils.lerp(0.4, 0.85, this.nose);
    let el = target.dot(this.up);
    const th2 = this._p.copy(target).addScaledVector(this.up, -el);
    if (th2.length() < 1e-3) th2.copy(this.dir).addScaledVector(this.up, -this.dir.dot(this.up));
    if (th2.length() < 1e-3) th2.set(1, 0, 0).addScaledVector(this.up, -this.up.x);
    th2.normalize();
    el = THREE.MathUtils.clamp(el, riding ? -0.3 : -Math.max(maxDown, 0.85 * this.nose), upMax);
    target.copy(th2).multiplyScalar(Math.sqrt(1 - el * el)).addScaledVector(this.up, el);

    if (!this.initialized) { this.dir.copy(target); this.initialized = true; this.up.copy(upT); }
    else this.dir.lerp(target, k).normalize();

    // Right stick looks around; springs back when released.
    const ky = 1 - Math.exp(-6 * dt);
    this.yaw += (inp.lookX * 2.4 - this.yaw) * ky;
    this.pitch += (inp.lookY * 0.9 - this.pitch) * ky;
    const d = this._r.copy(this.dir).applyAxisAngle(this.up, -this.yaw);
    const side = this._p.crossVectors(d, this.up).normalize();
    d.applyAxisAngle(side, -this.pitch).normalize();

    const dist = P.camDist * (1 + this.fall * 0.5);
    const height = P.camHeight + this.fall * 4;
    const rp = rider.pos;
    this.pos.set(rp.x, rp.y, rp.z).addScaledVector(d, -dist).addScaledVector(this.up, height);
    this.look.set(rp.x, rp.y, rp.z).addScaledVector(d, 6).addScaledVector(this.up, 0.6 - this.fall * 3);
    // Riding: stay above the surface. Over the tangent plane at the board (climbing, the
    // camera would swing down behind you), and out of the stream's skin (a wave behind you).
    // (lifts at once, settles back slowly)
    let lift = 0;
    const n = riding ? rider.normal : UP;
    if (riding) {
      const h = (this.pos.x - rp.x) * n.x + (this.pos.y - rp.y) * n.y + (this.pos.z - rp.z) * n.z;
      const hMin = Math.max(2.4, 0.3 * dist);
      if (h < hMin) lift = hMin - h;
      const sky = rider.sky, F = this._F || (this._F = {});
      if (sky && sky.sample) {
        const thr = rider.dbg.thr || 1;
        for (let k = 0; k < 5; k++) {
          sky.sample(this.pos.x + n.x * lift, this.pos.y + n.y * lift - 0.8, this.pos.z + n.z * lift, F);
          if (!(F.rho > 0.15 * thr)) break;
          lift += 1.2;
        }
      }
    }
    this.lift = Math.max(lift, (this.lift || 0) - dt * 2.5);
    if (this.lift > 0) this.pos.addScaledVector(n, this.lift);

    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.up.copy(this.up);
    cam.lookAt(this.look);
    const fov = P.fov + P.speedFov * THREE.MathUtils.clamp(speed / 60, 0, 1);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * (1 - Math.exp(-3 * dt)); cam.updateProjectionMatrix(); }
  }

  // On foot: an orbit camera you turn with the right stick (the left stick moves you relative
  // to it). Walking it sits behind and above you and swings round behind you as you go;
  // skydiving it pulls back and looks down at where you are falling.
  _updateFoot(dt, rider, P, inp) {
    const sky = rider.vis.sky || 0;
    if (!this.footInit) { this.yawF = Math.atan2(this.dir.z, this.dir.x); this.footInit = true; }
    this.yawF += inp.lookX * 2.6 * dt;
    if (Math.abs(inp.lookX) < 0.1 && rider.state === 'walking' && (rider.vis.walk || 0) > 1.5) {
      let d = Math.atan2(rider.facing.z, rider.facing.x) - this.yawF;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      if (Math.abs(d) < 1.9) this.yawF += d * (1 - Math.exp(-0.8 * dt));
    }
    const pitch = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.25, 0.8, sky) + inp.lookY * 0.45, -0.3, 1.3);
    const dir = this._t.set(Math.cos(this.yawF) * Math.cos(pitch), -Math.sin(pitch), Math.sin(this.yawF) * Math.cos(pitch));
    const dist = THREE.MathUtils.lerp(6.5, 11, sky), lift = THREE.MathUtils.lerp(1.6, 0, sky);
    const rp = rider.pos;
    this.look.set(rp.x, rp.y + lift, rp.z);
    this.dir.copy(dir); this.up.copy(UP);
    this.pos.copy(this.look).addScaledVector(dir, -dist);
    this.fall = 0; this.nose = 0; this.yaw = 0; this.pitch = 0;
    const cam = this.camera;
    cam.position.copy(this.pos); cam.up.copy(UP); cam.lookAt(this.look);
    if (Math.abs(cam.fov - P.fov) > 0.01) { cam.fov += (P.fov - cam.fov) * (1 - Math.exp(-3 * dt)); cam.updateProjectionMatrix(); }
  }
}
