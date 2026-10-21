// The painted assets: skies, cloud cards and the cloud sea, painted for Zenith GP (its Helios
// Drop and Meridian Skyway sheets) and reused here for now. Meridian's are golden hour,
// Helios's a high sun.
//
// The frame is tone mapped on the way out (shaders.js FINAL_FRAG), which would change a
// painting's colours (lifted mids, greyed whites). Painted things first undo it (unTone), so
// they come out as painted, as Zenith does.

import * as THREE from 'three';
import { CLOUD_CARDS } from '../world/cloudCards.js';

export const PAINTED = {
  sky: {
    meridian: { url: 'assets/painted/sky-meridian.webp', sunU: 0.2633, horizonV: 0.03125 },
    helios: { url: 'assets/painted/sky-helios.webp', sunU: 0.4043, horizonV: 0.03125 },
  },
  cloudsea: 'assets/painted/cloudsea.webp',
};

// The final pass's curve (Narkowicz's ACES fit, after the exposure, then a 2.2 gamma),
// inverted: the HDR value that comes out of the frame as the painted colour.
export const UNTONE_GLSL = /* glsl */ `
uniform float uExposure;
vec3 unTone(vec3 s) {
  vec3 y = pow(clamp(s, 0.0, 1.0), vec3(2.2)) * 0.985;
  vec3 A = 2.43 * y - 2.51, B = 0.59 * y - 0.03, C = 0.14 * y;
  vec3 x = (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
  return max(x, 0.0) / max(uExposure, 1e-3);
}
`;
export function unToneJS(s, exposure) {
  const y = Math.pow(Math.min(1, Math.max(0, s)), 2.2) * 0.985;
  const A = 2.43 * y - 2.51, B = 0.59 * y - 0.03, C = 0.14 * y;
  return Math.max(0, (-B - Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A)) / Math.max(exposure, 1e-3);
}

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('could not load ' + url)); im.src = url; });
}

/**
 * Load everything. Both cloud atlases go into one texture (Helios above, Meridian below), so
 * every card sorts with every other in one draw. Returns the textures, each card's rectangle
 * in the combined atlas, and colours read off each sky (for the haze to match it).
 */
export async function loadPainted() {
  const [hel, mer, sea, skyM, skyH] = await Promise.all([
    loadImage(CLOUD_CARDS.helios.url), loadImage(CLOUD_CARDS.meridian.url), loadImage(PAINTED.cloudsea),
    loadImage(PAINTED.sky.meridian.url), loadImage(PAINTED.sky.helios.url),
  ]);
  const W = Math.max(hel.width, mer.width), H = hel.height + mer.height;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.drawImage(hel, 0, 0); g.drawImage(mer, 0, hel.height);
  const atlas = new THREE.CanvasTexture(cv);
  atlas.flipY = true;   // (v from the bottom, as the card rectangles are)
  atlas.generateMipmaps = true; atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.anisotropy = 4;
  // Rectangles in the combined atlas: Helios in the top half (v 0.5..1), Meridian the bottom.
  const fh = hel.height / H, fm = mer.height / H;
  const rects = {
    helios: CLOUD_CARDS.helios.cards.map((c) => [c.u0 * hel.width / W, 1 - fh + c.v0 * fh, (c.u1 - c.u0) * hel.width / W, (c.v1 - c.v0) * fh]),
    meridian: CLOUD_CARDS.meridian.cards.map((c) => [c.u0 * mer.width / W, c.v0 * fm, (c.u1 - c.u0) * mer.width / W, (c.v1 - c.v0) * fm]),
  };
  const tex = (im, repeat) => {
    const t = new THREE.Texture(im);
    t.needsUpdate = true; t.anisotropy = 4;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const skies = {};
  for (const [name, im] of [['meridian', skyM], ['helios', skyH]]) {
    const t = tex(im, false);
    t.wrapS = THREE.RepeatWrapping;
    skies[name] = { tex: t, ...PAINTED.sky[name], colors: skyColors(im, PAINTED.sky[name]) };
  }
  return { atlas, rects, cloudsea: tex(sea, true), skies };
}

// Colours off a painted sky (sRGB, 0..1): the zenith, the clean blue below it, and the
// horizon toward the sun and away from it, for the procedural haze to match the painting.
function skyColors(im, meta) {
  const w = 256, h = 64;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.drawImage(im, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const at = (u, v) => {
    // v from the bottom; average a small patch
    const out = [0, 0, 0]; let n = 0;
    for (let du = -6; du <= 6; du++) for (let dv = -1; dv <= 1; dv++) {
      const x = ((Math.floor(u * w) + du) % w + w) % w, y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h) + dv));
      const i = (y * w + x) * 4;
      out[0] += d[i]; out[1] += d[i + 1]; out[2] += d[i + 2]; n++;
    }
    return out.map((c) => c / n / 255);
  };
  const hv = meta.horizonV;
  return {
    zenith: at(meta.sunU, 0.97),
    mid: at(meta.sunU + 0.25, hv + (1 - hv) * 0.35),
    horizon: at(meta.sunU, hv + 0.03),
    horizonAnti: at(meta.sunU + 0.5, hv + 0.03),
  };
}
