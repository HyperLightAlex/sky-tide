// The painted assets: skies, cloud cards, the cloud sea and the puffs inside clouds, one set
// per time of day (src/world/paintedSets.js, built from art/sky-sheets by
// tools/bg/build_painted.py). Until Skytide's own are made, Zenith GP's Meridian (golden hour)
// and Helios (high sun) sets stand in.
//
// The frame is tone mapped on the way out (shaders.js FINAL_FRAG), which would change a
// painting's colours (lifted mids, greyed whites). Painted things first undo it (unTone), so
// they come out as painted, as Zenith does.

import * as THREE from 'three';
import { PAINTED_SETS } from '../world/paintedSets.js';

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
 * Load the sets the sky can use (each time of day's set, and the storms'). Their cloud atlases
 * go into one texture, one above the other, so every card sorts with every other in one draw.
 * Returns the textures, each card's rectangle in the combined atlas, each set's sky (and colours
 * read off it, for the haze to match it) and cloud surfaces.
 */
export async function loadPainted(sets) {
  const names = [...new Set(sets)].filter((n) => PAINTED_SETS[n]);
  const atlasIms = await Promise.all(names.map((n) => loadImage(PAINTED_SETS[n].clouds)));
  const W = Math.max(...atlasIms.map((im) => im.width)), H = atlasIms.reduce((a, im) => a + im.height, 0);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  let y = 0;
  const rects = {};
  names.forEach((n, k) => {
    const im = atlasIms[k];
    g.drawImage(im, 0, y);
    // v from the bottom of the combined atlas: this one's band is [vb, vb + fh].
    const fh = im.height / H, vb = 1 - (y + im.height) / H, fw = im.width / W;
    rects[n] = PAINTED_SETS[n].cards.map((c) => [c.u0 * fw, vb + c.v0 * fh, (c.u1 - c.u0) * fw, (c.v1 - c.v0) * fh]);
    y += im.height;
  });
  const atlas = new THREE.CanvasTexture(cv);
  atlas.flipY = true;
  atlas.generateMipmaps = true; atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.anisotropy = 4;
  const texCache = new Map();
  const tex = async (url, repeat) => {
    if (texCache.has(url)) return texCache.get(url);
    const t = new THREE.Texture(await loadImage(url));
    t.needsUpdate = true; t.anisotropy = 4;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; else t.wrapS = THREE.RepeatWrapping;
    texCache.set(url, t);
    return t;
  };
  const skies = {}, surfaces = {};
  for (const n of names) {
    const S = PAINTED_SETS[n];
    const t = await tex(S.sky, false);
    skies[n] = { tex: t, sunU: S.sunU, horizonV: S.horizonV, colors: skyColors(t.image, S) };
    const sea = await tex(S.surfaces.cloudsea, true);
    surfaces[n] = { cloudsea: sea, puffs: S.surfaces.puffs ? await tex(S.surfaces.puffs, true) : sea, warm: !!S.warm };
  }
  return { atlas, rects, skies, surfaces };
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
