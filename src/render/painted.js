// The painted assets: skies, cloud cards, the cloud sea and the puffs inside clouds, one set
// per time of day (src/world/paintedSets.js, built from art/sky-sheets by
// tools/bg/build_painted.py). Golden hour is Skytide's own; until the others are made, Zenith
// GP's Helios stands in under a high sun (and Meridian wherever no set of ours fits).
//
// The frame is tone mapped on the way out (shaders.js FINAL_FRAG), which would change a
// painting's colours (lifted mids, greyed whites). Painted things first undo it (unTone), so
// they come out as painted, as Zenith does.

import * as THREE from 'three';
import { PAINTED_SETS } from '../world/paintedSets.js';
import { ISLAND_ART } from '../world/islandArt.js';

// The final pass's curve (Narkowicz's ACES fit, after the exposure, then a 2.2 gamma),
// inverted: the HDR value that comes out of the frame as the painted colour.
export const UNTONE_FN = /* glsl */ `
vec3 unTone(vec3 s) {
  vec3 y = pow(clamp(s, 0.0, 1.0), vec3(2.2)) * 0.985;
  vec3 A = 2.43 * y - 2.51, B = 0.59 * y - 0.03, C = 0.14 * y;
  vec3 x = (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
  return max(x, 0.0) / max(uExposure, 1e-3);
}
`;
export const UNTONE_GLSL = 'uniform float uExposure;\n' + UNTONE_FN;
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
 * go into one texture, one above the other, with the far islands' cards (world/islandArt.js)
 * under them as one more set ('islands'), so every card sorts with every other in one draw.
 * Returns the textures, each card's rectangle in the combined atlas, each set's sky (and colours
 * read off it, for the haze to match it) and cloud surfaces, and the islands' ground and rock
 * squares as one texture array (islandTex).
 */
export async function loadPainted(sets) {
  const setNames = [...new Set(sets)].filter((n) => PAINTED_SETS[n]);
  const names = [...setNames];
  const cardSets = Object.fromEntries(setNames.map((n) => [n, { clouds: PAINTED_SETS[n].clouds, cards: PAINTED_SETS[n].cards }]));
  // (a set's billows, as '<set>~billows')
  for (const n of setNames) if (PAINTED_SETS[n].billows) { cardSets[n + '~billows'] = { clouds: PAINTED_SETS[n].billows.atlas, cards: PAINTED_SETS[n].billows.cards }; names.push(n + '~billows'); }
  if (ISLAND_ART.far) { cardSets.islands = { clouds: ISLAND_ART.far.atlas, cards: ISLAND_ART.far.cards }; names.push('islands'); }
  const atlasIms = await Promise.all(names.map((n) => loadImage(cardSets[n].clouds)));
  // Two sheets across, as many rows as needed (so the texture stays within what every GPU takes).
  const cw = Math.max(...atlasIms.map((im) => im.width)), ch = Math.max(...atlasIms.map((im) => im.height));
  const COLS = names.length > 1 ? 2 : 1, ROWS = Math.ceil(names.length / COLS);
  const W = cw * COLS, H = ch * ROWS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rects = {};
  names.forEach((n, k) => {
    const im = atlasIms[k], x = (k % COLS) * cw, y = Math.floor(k / COLS) * ch;
    g.drawImage(im, x, y);
    // this sheet's place in the combined atlas (v from the bottom)
    const fw = im.width / W, fh = im.height / H, ub = x / W, vb = 1 - (y + im.height) / H;
    rects[n] = cardSets[n].cards.map((c) => [ub + c.u0 * fw, vb + c.v0 * fh, (c.u1 - c.u0) * fw, (c.v1 - c.v0) * fh]);
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
    if (!S) continue;
    const t = await tex(S.sky, false);
    skies[n] = { tex: t, sunU: S.sunU, horizonV: S.horizonV, colors: skyColors(t.image, S) };
    // The sea: dense, broken (the depth far below showing between the clumps) and in the shadow
    // of a cloud above; the inside of a cloud, lit (higher up) and in shade (low down), for the
    // mist deep in one. A set without all six (Zenith's) uses its cloud sea for the sea's three
    // and has no inside paintings (its mist is a flat colour).
    const own = (k) => (S.surfaces[k] ? tex(S.surfaces[k], true) : null);
    const sea = await tex(S.surfaces.cloudsea, true);
    const inside = await own('puffs');
    surfaces[n] = {
      cloudsea: sea, broken: (await own('cloudsea-broken')) || sea, shade: (await own('cloudsea-shade')) || sea,
      inside, insideShade: (await own('puffs-shade')) || inside,
      variants: !!S.surfaces['cloudsea-broken'], warm: !!S.warm,
    };
  }
  const islandTex = await islandArray().catch((e) => { console.warn('Island art did not load:', e.message); return null; });
  return { atlas, rects, skies, surfaces, islandTex };
}

/**
 * The islands' ground and rock squares (each sheet 3x2 squares of 512 px) as one texture array,
 * ground 0..5 then rock 6..11, in the order of ISLAND_ART's tiles; image up is v up.
 */
async function islandArray() {
  if (!ISLAND_ART.ground || !ISLAND_ART.rock) return null;
  const S = 512;
  const ims = await Promise.all([ISLAND_ART.ground.sheet, ISLAND_ART.rock.sheet].map(loadImage));
  const data = new Uint8Array(S * S * 4 * 12);
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  ims.forEach((im, s) => {
    for (let i = 0; i < 6; i++) {
      g.clearRect(0, 0, S, S);
      g.drawImage(im, (i % 3) * S, Math.floor(i / 3) * S, S, S, 0, 0, S, S);
      const px = g.getImageData(0, 0, S, S).data, base = (s * 6 + i) * S * S * 4;
      // rows bottom first, so v runs up the image
      for (let y = 0; y < S; y++) data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), base + y * S * 4);
    }
  });
  const t = new THREE.DataArrayTexture(data, S, S, 12);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
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
