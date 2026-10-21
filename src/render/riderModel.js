// The rider's own models (assets/models): Tavi or Mara on Skipper or Kestrel, in place of the
// placeholder figure. The characters are skinned (tools/models/characters_rig.py) with no
// animation of their own: every frame each is posed here to reach the targets the placeholder
// is placed by (riderView's pose: the hips, the chest, the hands, the feet, where the head
// looks), fitted to its own proportions, with its feet in the board's foot holds while riding.
//
// Frames: the rider's body frame (riderView) faces +X with its left toward -Z (on the board:
// toward the nose); the models face +Z with their left toward +X, so a character is turned a
// quarter turn about Y. The boards are already in the board's frame (nose -Z, deck at Y=0),
// lifted to the placeholder deck's height.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { celify, addOutline } from './cel.js';
import { PALETTE } from './pipeline.js';

const FILES = { Tavi: 'tavi', Mara: 'mara', Skipper: 'skipper', Kestrel: 'kestrel' };
const DECK = 0.04;                      // the placeholder deck's height above the rider's position
const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();

/** Load the four models (resolves to null if any is missing: the placeholder stays). */
export async function loadRiderModels() {
  const loader = new GLTFLoader();
  try {
    const entries = await Promise.all(Object.entries(FILES).map(async ([name, file]) =>
      [name, await loader.loadAsync(new URL(`../../assets/models/${file}.glb`, import.meta.url).href)]));
    return Object.fromEntries(entries);
  } catch (e) {
    console.warn('rider models not loaded; keeping the placeholder', e);
    return null;
  }
}

// ---- small geometry ------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _fx = V(), _fy = V(), _fz = V();
/** The rotation whose axes are d, n (made perpendicular to d) and d x n. */
function frame(out, d, n) {
  _fx.copy(d).normalize();
  _fy.copy(n).addScaledVector(_fx, -n.dot(_fx));
  if (_fy.lengthSq() < 1e-10) _fy.set(_fx.y, -_fx.x, 0.3);
  _fy.normalize();
  _fz.crossVectors(_fx, _fy);
  _m.makeBasis(_fx, _fy, _fz);
  return out.setFromRotationMatrix(_m);
}
const _qa = Q(), _qb = Q();
/** The rotation taking a bone's rest direction and bend plane to new ones. */
function align(out, dRest, nRest, dNew, nNew) {
  frame(_qa, dRest, nRest).invert();
  return out.copy(frame(_qb, dNew, nNew)).multiply(_qa);
}
const _d = V(), _p = V();
/** A limb a-b-c of lengths l1, l2 reaching from a toward target, the middle joint bending
 *  toward pole: writes the middle and end positions. */
function twoBone(a, l1, l2, target, pole, mid, end) {
  _d.subVectors(target, a);
  let dl = _d.length();
  if (dl < 1e-6) { _d.set(0, -1, 0); dl = 1e-3; }
  _d.multiplyScalar(1 / dl);
  dl = THREE.MathUtils.clamp(dl, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
  const ca = THREE.MathUtils.clamp((l1 * l1 + dl * dl - l2 * l2) / (2 * l1 * dl), -1, 1);
  const sa = Math.sqrt(1 - ca * ca);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
  _p.normalize();
  mid.copy(a).addScaledVector(_d, l1 * ca).addScaledVector(_p, l1 * sa);
  end.copy(a).addScaledVector(_d, dl);
}

// ---- a character -----------------------------------------------------------------------------

class Character {
  constructor(gltf) {
    this.root = gltf.scene;
    this.bones = {};
    this.root.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.userData && o.userData.rig) this.rig = o.userData.rig;
      if (o.isMesh) o.frustumCulled = false;      // (posed, it leaves its rest bounds)
    });
    const b = this.bones;
    // Rest positions in the model's frame (every bone rests unturned).
    this.rest = {};
    const walk = (bone, at) => {
      const p = at.clone().add(bone.position);
      this.rest[bone.name] = p;
      for (const c of bone.children) if (c.isBone) walk(c, p);
    };
    walk(b.Hips, V());
    for (const [k, v] of Object.entries(this.rig.points)) this.rest[k] = new THREE.Vector3(...v);
    const r = this.rest;
    const len = (a, c) => r[a].distanceTo(r[c]);
    this.len = {};
    for (const s of ['L', 'R']) {
      this.len[`upper_${s}`] = len(`UpperArm_${s}`, `Forearm_${s}`);
      this.len[`fore_${s}`] = len(`Forearm_${s}`, `Hand_${s}`);
      this.len[`thigh_${s}`] = len(`Thigh_${s}`, `Shin_${s}`);
      this.len[`shin_${s}`] = len(`Shin_${s}`, `Foot_${s}`);
    }
    this.hipY = r.Hips.y;
    this.torso = r.Neck.y - r.Hips.y;
    this.armLen = this.len.upper_L + this.len.fore_L;
    this.legLen = this.len.thigh_L + this.len.shin_L;
    // Each bone's rest direction and the plane its limb bends in (for the limbs).
    this.restUp = V().subVectors(r.Neck, r.Hips).normalize();
    this.R = {}; this.G = {};
    for (const name of Object.keys(b)) { this.R[name] = Q(); this.G[name] = V(); }
    this.t = { mid: V(), end: V(), v: V(), w: V(), n: V(), n2: V(), q: Q(), q2: Q() };
  }

  /** Pose from targets in the model's frame (see RiderModels.update). */
  pose(T) {
    const { R, G, rest: r, bones: B, t } = this;
    const child = (name, parent) => G[name].copy(r[name]).sub(r[parent]).applyQuaternion(R[parent]).add(G[parent]);
    // hips and spine
    R.Hips.setFromAxisAngle(UP, T.hipYaw);
    G.Hips.copy(T.hips);
    const bend = t.q.setFromUnitVectors(this.restUp, t.v.copy(T.chestDir).normalize());
    R.Chest.setFromAxisAngle(UP, T.chestYaw).premultiply(bend);
    R.Spine.copy(R.Hips).slerp(R.Chest, 0.5);
    child('Spine', 'Hips'); child('Chest', 'Spine');
    // head: where it looks, carrying half the body's lean
    R.Head.setFromAxisAngle(UP, T.headYaw).multiply(t.q2.setFromAxisAngle(_fx.set(1, 0, 0), T.headPitch));
    R.Head.premultiply(t.q2.identity().slerp(bend, 0.5));
    R.Neck.copy(R.Chest).slerp(R.Head, 0.45);
    child('Neck', 'Chest'); child('Head', 'Neck');
    // arms
    for (const s of ['L', 'R']) {
      const sh = `Shoulder_${s}`, ua = `UpperArm_${s}`, fa = `Forearm_${s}`, ha = `Hand_${s}`;
      // the shoulder lifts a little as the arm rises above level
      const dir = T[`handDir_${s}`];
      R[sh].setFromAxisAngle(_fz.set(0, 0, s === 'L' ? 1 : -1), 0.3 * Math.max(0, dir.y)).premultiply(R.Chest);
      child(sh, 'Chest'); child(ua, sh);
      const hand = t.end.copy(G[ua]).addScaledVector(dir, T[`handReach_${s}`]);
      t.v.copy(hand);
      twoBone(G[ua], this.len[`upper_${s}`], this.len[`fore_${s}`], t.v, T[`elbow_${s}`], t.mid, t.end);
      const nRest = t.n.subVectors(r[ha], r[ua]).cross(_fy.set(0, 0, -1));
      const nNew = t.n2.subVectors(t.end, G[ua]).cross(T[`elbow_${s}`]);
      align(R[ua], t.v.subVectors(r[fa], r[ua]), nRest, t.w.subVectors(t.mid, G[ua]), nNew);
      align(R[fa], t.v.subVectors(r[ha], r[fa]), nRest, t.w.subVectors(t.end, t.mid), nNew);
      child(fa, ua);
      R[ha].copy(R[fa]); child(ha, fa);
    }
    // legs
    for (const s of ['L', 'R']) {
      const th = `Thigh_${s}`, sn = `Shin_${s}`, ft = `Foot_${s}`, to = `Toe_${s}`;
      child(th, 'Hips');
      twoBone(G[th], this.len[`thigh_${s}`], this.len[`shin_${s}`], T[`ankle_${s}`], T[`knee_${s}`], t.mid, t.end);
      const nRest = t.n.subVectors(r[ft], r[th]).cross(_fy.set(0, 0, 1));
      const nNew = t.n2.subVectors(t.end, G[th]).cross(T[`knee_${s}`]);
      align(R[th], t.v.subVectors(r[sn], r[th]), nRest, t.w.subVectors(t.mid, G[th]), nNew);
      align(R[sn], t.v.subVectors(r[ft], r[sn]), nRest, t.w.subVectors(t.end, t.mid), nNew);
      child(sn, th);
      if (T[`footFollow_${s}`]) R[ft].copy(R[sn]); else R[ft].copy(T[`footQ_${s}`]);
      child(ft, sn);
      R[to].copy(R[ft]);
    }
    // to the bones (each turned relative to its parent)
    B.Hips.position.copy(G.Hips);
    B.Hips.quaternion.copy(R.Hips);
    for (const [name, bone] of Object.entries(B)) {
      if (name === 'Hips') continue;
      bone.quaternion.copy(t.q.copy(R[bone.parent.name]).invert().multiply(R[name]));
    }
  }

  /** Where the hips can be so both feet still reach their targets (lowered if not). */
  reachHips(T) {
    const r = this.rest;
    let drop = 0;
    for (const s of ['L', 'R']) {
      const th = this.t.v.subVectors(r[`Thigh_${s}`], r.Hips).applyAxisAngle(UP, T.hipYaw).add(T.hips);
      const a = T[`ankle_${s}`];
      const h = Math.hypot(th.x - a.x, th.z - a.z), L = this.legLen * 0.97;
      const v = h < L ? Math.sqrt(L * L - h * h) : 0;
      drop = Math.max(drop, th.y - a.y - v);
    }
    T.hips.y -= drop;
  }
}

// ---- the rider -------------------------------------------------------------------------------

export class RiderModels {
  constructor(view, fxScene, assets) {
    this.view = view;
    this.characters = {};
    for (const name of ['Tavi', 'Mara']) {
      const c = new Character(assets[name]);
      celify(c.root, { char: true });
      addOutline(c.root);
      c.wrap = new THREE.Group();
      c.wrap.name = `${name}`;
      c.wrap.quaternion.setFromAxisAngle(UP, Math.PI / 2);   // model +Z (facing) to the body's +X
      c.wrap.add(c.root);
      c.wrap.visible = false;
      view.body.add(c.wrap);
      this.characters[name] = c;
    }
    this.boards = {};
    this.lights = new THREE.Group();
    fxScene.add(this.lights);
    for (const name of ['Skipper', 'Kestrel']) {
      const root = assets[name].scene;
      const holder = new THREE.Group();
      holder.position.y = DECK;
      holder.add(root);
      holder.visible = false;
      view.boardGroup.add(holder);
      root.updateMatrixWorld(true);
      // The trapar paint glows: a copy of each of its surfaces drawn again, added, in the
      // effects pass (lit by the same contact and boost as the placeholder's glow).
      const glows = [];
      root.traverse((o) => {
        if (!o.isMesh || !(o.name.startsWith('Trapar_') || o.userData.role === 'trapar')) return;
        const m = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({
          color: PALETTE.trapar.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }));
        m.matrixAutoUpdate = false; m.frustumCulled = false;
        this.lights.add(m);
        glows.push({ src: o, mesh: m });
      });
      celify(root, { char: true });
      addOutline(root);
      const hold = (n) => { let h = null; root.traverse((o) => { if (o.name === n) h = o; }); return h; };
      const holds = { L: hold('FootHold_Front'), R: hold('FootHold_Rear') };
      const footbed = (holds.L && holds.L.userData.footbedHeight) || 0.014;
      // the holds' positions in the body's frame (where the soles go)
      const at = {};
      for (const s of ['L', 'R']) at[s] = holds[s] ? holds[s].position.clone().add(new THREE.Vector3(0, DECK + footbed, 0)) : new THREE.Vector3(0, DECK + footbed, s === 'L' ? -0.32 : 0.32);
      this.boards[name] = { holder, root, glows, at };
    }
    this.placeholder = [view.legL, view.legR, view.armL, view.armR, view.torso, view.bootL, view.bootR, view.head];
    // pose targets, reused
    const T = { hips: V(), chestDir: V(), hipYaw: 0, chestYaw: 0, headYaw: 0, headPitch: 0 };
    for (const s of ['L', 'R']) {
      T[`handDir_${s}`] = V(); T[`handReach_${s}`] = 0.4; T[`elbow_${s}`] = V();
      T[`ankle_${s}`] = V(); T[`knee_${s}`] = V(); T[`footQ_${s}`] = Q(); T[`footFollow_${s}`] = false;
    }
    this.T = T;
    this._v = V(); this._w = V(); this._q = Q(); this._inv = new THREE.Matrix4();
  }

  update(dt, rider, P) {
    const view = this.view, pose = view.pose;
    const c = this.characters[P.character] || this.characters.Tavi;
    const b = this.boards[P.board] || this.boards.Skipper;
    for (const k in this.characters) this.characters[k].wrap.visible = this.characters[k] === c;
    for (const k in this.boards) this.boards[k].holder.visible = this.boards[k] === b;
    for (const m of this.placeholder) m.visible = false;
    for (const m of view.boardParts) m.visible = false;
    if (!pose) return;
    this._fit(c, b, pose);
    c.pose(this.T);
    // the board's glowing paint
    view.boardGroup.updateMatrixWorld(true);
    this.lights.visible = view.boardGroup.visible;
    const op = view.glowMat.opacity;
    for (const g of b.glows) {
      g.mesh.matrix.copy(g.src.matrixWorld);
      g.mesh.material.opacity = Math.min(1, op * 0.9 + (rider.boosting ? 0.3 : 0));
      g.mesh.material.color.copy(view.glowMat.color);
      g.mesh.visible = true;
    }
    for (const k in this.boards) if (this.boards[k] !== b) for (const g of this.boards[k].glows) g.mesh.visible = false;
  }

  /** The placeholder's pose (in the body's frame, for its proportions) as targets for this
   *  character (in its own frame). */
  _fit(c, b, pose) {
    const T = this.T, r = c.rest;
    // body (x facing, z toward its right) to model (z facing, x toward its left)
    const M = (out, v) => out.set(-v.z, v.y, v.x);
    const onBoard = pose.board, air = !onBoard && pose.air;
    for (const s of ['L', 'R']) {
      const sole = r[`Sole_${s}`], ank = r[`Foot_${s}`];
      const q = T[`footQ_${s}`], p = this._v;
      T[`footFollow_${s}`] = air;
      if (onBoard) {
        // in the board's holds, toes turned out a little (the front foot's toward the nose)
        M(p, b.at[s]);
        q.setFromAxisAngle(UP, s === 'L' ? 0.22 : -0.12);
        T[`ankle_${s}`].subVectors(ank, sole).applyQuaternion(q).add(p);
      } else if (!air) {
        // stepping where the placeholder steps, at this character's own spacing and stride
        const f = pose[`foot${s}`];
        p.set(sole.x * 0.9, f.y - pose.footY, f.x * (c.legLen / 0.85));
        q.identity();
        T[`ankle_${s}`].subVectors(ank, sole).add(p);
      } else {
        // in the air: the feet hang from the legs, aimed where the placeholder's are
        M(T[`ankle_${s}`], pose[`foot${s}`]).multiplyScalar(c.hipY / 0.95);
        T[`ankle_${s}`].x = (s === 'L' ? 1 : -1) * Math.max(Math.abs(T[`ankle_${s}`].x) * 0.8, Math.abs(r[`Thigh_${s}`].x));
        // skydiving, the knees bend and the feet lift behind (the skydiver's arch)
        T[`ankle_${s}`].y += 0.3 * c.hipY * pose.skydive;
        T[`ankle_${s}`].z -= 0.3 * c.hipY * pose.skydive;
      }
      T[`knee_${s}`].set(onBoard ? (s === 'L' ? 0.35 : -0.1) : 0, onBoard ? 0 : -0.15, 1);
    }
    // the hips: as far down the legs as the placeholder's are (a crouch), and moved as it moves
    // them; lower still if the feet could not reach
    M(T.hips, pose.hip);
    if (air) T.hips.y = pose.hip.y * c.hipY / 0.95;
    else {
      const ext = THREE.MathUtils.clamp((pose.hip.y - pose.footY) / 0.89, 0.45, 1.05);
      T.hips.y = (onBoard ? b.at.L.y : 0) + ext * c.hipY;
    }
    T.hipYaw = onBoard ? 0.25 : 0;
    T.chestYaw = onBoard ? 0.5 : 0;
    if (!air) c.reachHips(T);
    // the chest leans as the placeholder's does
    M(T.chestDir, this._v.subVectors(pose.chest, pose.hip));
    // the hands: in the placeholder's directions from the shoulders, as far out as it reaches
    for (const s of ['L', 'R']) {
      const d = this._v.subVectors(pose[`hand${s}`], pose[`shoulder${s}`]);
      T[`handReach_${s}`] = THREE.MathUtils.clamp(d.length() / 0.56, 0.55, 0.96) * c.armLen;
      M(T[`handDir_${s}`], d).normalize();
      T[`elbow_${s}`].set(s === 'L' ? 0.2 : -0.2, -1, -0.6);
    }
    T.headYaw = pose.headYaw;
    T.headPitch = onBoard ? 0.18 : 0.05;
  }
}
