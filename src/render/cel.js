// Cel shading: the solid world drawn the way a 2005 TV anime painted its cels and backgrounds.
// After Zenith GP's look.ts (the same method, tuned for a sky): each material's own lighting
// is replaced by flat tones chosen by which way the surface faces the key light.
//
//   characters (the rider, the board)  lit tone; a shadow tone mixed for each paint (darker,
//       leaning to the sky's blue and to violet); a lighter band of bounced light along the far
//       rim of the shadow; a third, highlight tone facing the light; a hard rim of light round
//       the edge against the sun. Drawn with a dark contour line (addOutline).
//   backgrounds (the islands)  the same lit tone with a gentler shadow, and no highlight.
//
// The key light is lifted toward overhead (cel lighting is designed, not measured: a low sun
// would leave half of everything in shade from every angle). All tones are set from shared
// uniforms (CEL), so a change of light reaches every material at once.

import * as THREE from 'three';

export const CEL = {
  uShadeTint: { value: new THREE.Color(0.58, 0.58, 0.8) },
  uBgShadeTint: { value: new THREE.Color(0.72, 0.72, 0.86) },
  uKeyRef: { value: 0.62 },        // N.L the whole lit side is painted at
  uKeyLift: { value: 0.35 },       // how far the key light is lifted toward overhead
  uBounce: { value: 0.6 },         // bounced light along the far rim of the shadow
  uTerminator: { value: 0.1 },     // where the shadow starts (a little above 0: more shadow, as cels had)
};

const _sky = new THREE.Color(), _violet = new THREE.Color(0.66, 0.56, 1.0);
/** Shadow tints from the sky's colour: the shadow leans toward it and then toward violet. */
export function setCelLight(skyColor) {
  _sky.copy(skyColor);
  const m = Math.max(_sky.r, _sky.g, _sky.b) || 1;
  _sky.multiplyScalar(1 / m).lerp(_violet, 0.35);
  CEL.uShadeTint.value.copy(_sky).multiplyScalar(0.62);
  CEL.uBgShadeTint.value.copy(_sky).lerp(new THREE.Color(1, 1, 1), 0.3).multiplyScalar(0.76);
}

const CEL_HEAD = /* glsl */ `
uniform vec3 uShadeTint, uBgShadeTint;
uniform float uKeyRef, uKeyLift, uBounce, uTerminator;
float celStep(float x, float edge) {
  float aa = fwidth(x) * 0.9 + 0.0015;
  return smoothstep(edge - aa, edge + aa, x);
}
`;

const CEL_BODY = /* glsl */ `
{
  vec3 celBase = diffuseColor.rgb;
  vec3 celN = normalize(normal);
  vec3 celV = normalize(vViewPosition);
  vec3 celUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 celL = celUp;
  vec3 celSun = vec3(0.0);
  #if NUM_DIR_LIGHTS > 0
    celL = normalize(directionalLights[0].direction + celUp * uKeyLift);
    celSun = directionalLights[0].color;
  #endif
  vec3 celAmb = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
    celAmb += mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, 0.75);
  #endif
  vec3 celLit = celBase * (celSun * uKeyRef + celAmb) * RECIPROCAL_PI;
  float ndl = dot(celN, celL);
  float litK = celStep(ndl, uTerminator);
  #ifdef CEL_CHAR
    // Black is never quite black on a cel: a dark blue-grey paint, so the shading still reads.
    celLit += (celSun * uKeyRef + celAmb) * RECIPROCAL_PI * vec3(0.03, 0.032, 0.044);
    vec3 celShade = celLit * uShadeTint;
    float rim = 1.0 - clamp(dot(celN, celV), 0.0, 1.0);
    celShade = mix(celShade, mix(celShade, celLit, 0.45), celStep(rim, 0.62) * uBounce);
    vec3 celCol = mix(celShade, celLit, litK);
    celCol = mix(celCol, celLit * 1.22, celStep(ndl, 0.9) * 0.6);
    #if NUM_DIR_LIGHTS > 0
      vec3 celSunDir = directionalLights[0].direction;
      float against = smoothstep(0.0, 0.35, -dot(celSunDir, celV));
      float rimLit = celStep(rim, 0.55) * celStep(dot(celN, celSunDir), -0.1);
      celCol = mix(celCol, celLit * 1.15, rimLit * against);
    #endif
  #else
    vec3 celCol = mix(celLit * uBgShadeTint, celLit, litK);
  #endif
  outgoingLight = celCol + totalEmissiveRadiance;
}
`;

function patch(m, char) {
  m.userData.cel = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CEL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CEL_HEAD)
      .replace('#include <opaque_fragment>', CEL_BODY + '\n#include <opaque_fragment>');
    if (char) shader.defines = { ...(shader.defines || {}), CEL_CHAR: '' };
  };
  m.customProgramCacheKey = () => `cel${char ? '-char' : ''}`;
  m.needsUpdate = true;
  return m;
}

/** A cel material in place of a Standard (or any lit) one: same paint, flat tones. */
export function celMaterial(src, char = false) {
  if (src.userData && src.userData.cel) return src;
  const m = new THREE.MeshLambertMaterial({
    color: src.color ? src.color.clone() : 0xffffff, vertexColors: !!src.vertexColors, flatShading: !!src.flatShading,
    side: src.side, transparent: src.transparent, opacity: src.opacity, map: src.map || null,
  });
  if (src.emissive) m.emissive.copy(src.emissive);
  return patch(m, char);
}

/** Cel-shade every lit mesh under root (Basic and shader materials are left alone). */
export function celify(root, { char = false } = {}) {
  const done = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.userData.outline) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return m;
      if (!done.has(m)) done.set(m, celMaterial(m, char));
      return done.get(m);
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

// ---- contour lines (characters) ---------------------------------------------------------
// An inverted hull: each part drawn again, back faces only, pushed out along its (smoothed)
// normals by a steady width on screen. The cel character line: unbroken, the same weight all
// round, thinning a little with distance so a far rider is not all outline.

export const OUTLINE = {
  uLinePx: { value: 0.003 },                        // line width as a fraction of the view height
  uLineColor: { value: new THREE.Color(0.07, 0.055, 0.075) },
};

const OUTLINE_VERT = /* glsl */ `
attribute vec3 aOutN;
uniform float uLinePx;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * aOutN);
  float z = max(-mv.z, 0.1);
  float w = uLinePx * z * clamp(10.0 / z, 0.45, 1.0) / projectionMatrix[1][1] * 2.0;
  mv.xyz += n * w;
  gl_Position = projectionMatrix * mv;
}
`;
const OUTLINE_FRAG = /* glsl */ `
uniform vec3 uLineColor;
void main() { gl_FragColor = vec4(uLineColor, 1.0); }
`;
let outlineMat = null;

// Normals averaged over every vertex at the same place, so the hull has no cracks at hard edges.
function smoothNormals(geo) {
  if (geo.getAttribute('aOutN')) return;
  const pos = geo.getAttribute('position');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const nor = geo.getAttribute('normal');
  const acc = new Map(), keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    keys[i] = k;
    const a = acc.get(k) || [0, 0, 0];
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
    acc.set(k, a);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  geo.setAttribute('aOutN', new THREE.BufferAttribute(out, 3));
}

/** Give every opaque lit mesh under root a contour line. */
export function addOutline(root) {
  if (!outlineMat) outlineMat = new THREE.ShaderMaterial({ vertexShader: OUTLINE_VERT, fragmentShader: OUTLINE_FRAG, uniforms: OUTLINE, side: THREE.BackSide });
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.outline && o.material && !o.material.transparent && (o.material.isMeshLambertMaterial || o.material.isMeshStandardMaterial)) meshes.push(o); });
  for (const o of meshes) {
    smoothNormals(o.geometry);
    const h = new THREE.Mesh(o.geometry, outlineMat);
    h.userData.outline = true;
    h.frustumCulled = o.frustumCulled;
    h.renderOrder = o.renderOrder;
    o.add(h);
  }
}

/** Keep the line weight steady with the screen size (call on resize). */
export function setOutlineSize(heightPx) {
  OUTLINE.uLinePx.value = Math.max(1.0, 1.5 * heightPx / 720) / Math.max(heightPx, 1);
}
