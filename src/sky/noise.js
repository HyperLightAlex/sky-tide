// Tileable noise volumes for the sky engine.
//
// The volumes are generated once from a fixed bank seed. World seeds never
// regenerate them; they only change where the field samples them, so changing
// the seed is instant.
//
// Each volume keeps two copies of its data:
//   bytes   - quantized RG8 / R8 data uploaded to the GPU
//   ch[c]   - the same quantized values as floats, sampled on the CPU
// Both sides read identical numbers with identical trilinear filtering, which
// is what keeps "what you see" and "what you ride" in agreement.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Improved Perlin noise, periodic with integer periods per axis (each <= 256).
// Written flat (no closures) because the volumes need tens of millions of calls.
const GX = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1]);
const GZ = new Float32Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 1, 0, -1]);

class TilePerlin {
  constructor(rand) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint16Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  noise(x, y, z, px, py, pz) {
    const P = this.perm;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    let X0 = xi % px; if (X0 < 0) X0 += px; const X1 = X0 + 1 === px ? 0 : X0 + 1;
    let Y0 = yi % py; if (Y0 < 0) Y0 += py; const Y1 = Y0 + 1 === py ? 0 : Y0 + 1;
    let Z0 = zi % pz; if (Z0 < 0) Z0 += pz; const Z1 = Z0 + 1 === pz ? 0 : Z0 + 1;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const a0 = P[X0], a1 = P[X1];
    const b00 = P[a0 + Y0], b01 = P[a0 + Y1], b10 = P[a1 + Y0], b11 = P[a1 + Y1];
    const xm = xf - 1, ym = yf - 1, zm = zf - 1;
    let h;
    h = P[b00 + Z0] & 15; const n000 = GX[h] * xf + GY[h] * yf + GZ[h] * zf;
    h = P[b10 + Z0] & 15; const n100 = GX[h] * xm + GY[h] * yf + GZ[h] * zf;
    h = P[b01 + Z0] & 15; const n010 = GX[h] * xf + GY[h] * ym + GZ[h] * zf;
    h = P[b11 + Z0] & 15; const n110 = GX[h] * xm + GY[h] * ym + GZ[h] * zf;
    h = P[b00 + Z1] & 15; const n001 = GX[h] * xf + GY[h] * yf + GZ[h] * zm;
    h = P[b10 + Z1] & 15; const n101 = GX[h] * xm + GY[h] * yf + GZ[h] * zm;
    h = P[b01 + Z1] & 15; const n011 = GX[h] * xf + GY[h] * ym + GZ[h] * zm;
    h = P[b11 + Z1] & 15; const n111 = GX[h] * xm + GY[h] * ym + GZ[h] * zm;
    const x00 = n000 + u * (n100 - n000), x10 = n010 + u * (n110 - n010);
    const x01 = n001 + u * (n101 - n001), x11 = n011 + u * (n111 - n011);
    const y0 = x00 + v * (x10 - x00), y1 = x01 + v * (x11 - x01);
    return y0 + w * (y1 - y0);
  }
}

// Worley (cellular) noise, periodic, one feature point per cell. Returns F1 in cell units.
// Points are stored in a padded grid (one extra cell on every side, already wrapped and
// offset) so the 27-cell search needs no modulo work.
class TileWorley {
  constructor(rand, cx, cy, cz) {
    this.cx = cx; this.cy = cy; this.cz = cz;
    const raw = new Float32Array(cx * cy * cz * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = rand();
    const PX = cx + 2, PY = cy + 2, PZ = cz + 2;
    this.PX = PX; this.PY = PY;
    this.pad = new Float32Array(PX * PY * PZ * 3);
    for (let z = -1; z <= cz; z++) for (let y = -1; y <= cy; y++) for (let x = -1; x <= cx; x++) {
      const xw = (x + cx) % cx, yw = (y + cy) % cy, zw = (z + cz) % cz;
      const src = ((zw * cy + yw) * cx + xw) * 3;
      const dst = (((z + 1) * PY + (y + 1)) * PX + (x + 1)) * 3;
      this.pad[dst] = x + raw[src]; this.pad[dst + 1] = y + raw[src + 1]; this.pad[dst + 2] = z + raw[src + 2];
    }
  }
  // x, y, z must be in [0, cells) on each axis.
  f1(x, y, z) {
    const { PX, PY, pad } = this;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 1e9;
    for (let dz = 0; dz < 3; dz++) {
      for (let dy = 0; dy < 3; dy++) {
        let idx = (((zi + dz) * PY + (yi + dy)) * PX + xi) * 3;
        for (let dx = 0; dx < 3; dx++, idx += 3) {
          const ddx = pad[idx] - x, ddy = pad[idx + 1] - y, ddz = pad[idx + 2] - z;
          const d = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }
}

// Stretch a float channel so its 1st..99th percentile spans 0..1, then quantize.
function normalizeToBytes(src, bytes, stride, offset) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < src.length; i++) { const v = src[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const BINS = 2048, hist = new Uint32Array(BINS), span = hi - lo || 1;
  for (let i = 0; i < src.length; i++) hist[Math.min(BINS - 1, Math.floor(((src[i] - lo) / span) * BINS))]++;
  const pick = (q) => {
    const target = q * src.length; let acc = 0;
    for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc >= target) return lo + (b / BINS) * span; }
    return hi;
  };
  const p0 = pick(0.01), p1 = pick(0.99), s = 1 / (p1 - p0 || 1);
  for (let i = 0; i < src.length; i++) {
    const v = Math.min(1, Math.max(0, (src[i] - p0) * s));
    bytes[i * stride + offset] = Math.round(v * 255);
  }
}

// Volume layouts. Texture axes are (x, y, z) = (u, v, w) in the shaders.
//   A: cubic 3D. R = perlin-worley billows (banks), G = smooth perlin fbm (wisps).
//   C: wide and flat (x, time, z). Two smooth perlin fbms for 2D fields that evolve over
//      time: deck coverage and holes, deck rise/sink, roller groups, weather.
//   B: small cubic. R = worley fbm used to erode cloud edges (the chop).
export const VOLUMES = {
  A: { w: 112, h: 112, d: 112, channels: 2 },
  C: { w: 256, h: 24, d: 256, channels: 2 },
  B: { w: 64, h: 64, d: 64, channels: 1 },
};

export function makeGenerators(bankSeed = 1337) {
  const rand = mulberry32(bankSeed);
  return {
    perlinA: new TilePerlin(rand), perlinB: new TilePerlin(rand),
    perlinC: new TilePerlin(rand), perlinD: new TilePerlin(rand),
    worleyA: [new TileWorley(rand, 4, 4, 4), new TileWorley(rand, 8, 8, 8), new TileWorley(rand, 16, 16, 16)],
    worleyB: [new TileWorley(rand, 4, 4, 4), new TileWorley(rand, 8, 8, 8), new TileWorley(rand, 16, 16, 16)],
  };
}

// Raw (un-normalized) values for z slices [z0, z1) of one volume. Returns one Float32Array per channel.
export function computeSlices(gen, name, z0, z1) {
  const V = VOLUMES[name];
  const { w: W, h: H, d: D } = V;
  const n = W * H * (z1 - z0);
  const out = [];
  for (let c = 0; c < V.channels; c++) out.push(new Float32Array(n));
  let i = 0;
  for (let z = z0; z < z1; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        const u = (x + 0.5) / W, v = (y + 0.5) / H, w = (z + 0.5) / D;
        if (name === 'A') {
          let p = 0, pa = 0;
          for (let o = 0, P = 4, a = 1; o < 3; o++, P *= 2, a *= 0.5) { p += a * gen.perlinA.noise(u * P, v * P, w * P, P, P, P); pa += a; }
          p = (p / pa) * 0.5 + 0.5;
          const W0 = gen.worleyA[0], W1 = gen.worleyA[1], W2 = gen.worleyA[2];
          const wf = 0.625 * (1 - Math.min(1, W0.f1(u * 4, v * 4, w * 4)))
                   + 0.25 * (1 - Math.min(1, W1.f1(u * 8, v * 8, w * 8)))
                   + 0.125 * (1 - Math.min(1, W2.f1(u * 16, v * 16, w * 16)));
          // Perlin remapped by the worley fbm gives billowy, cauliflower-like shapes.
          out[0][i] = (p - (wf - 1)) / (2 - wf);
          let g = 0, ga = 0;
          for (let o = 0, P = 4, a = 1; o < 4; o++, P *= 2, a *= 0.55) { g += a * gen.perlinB.noise(u * P, v * P, w * P, P, P, P); ga += a; }
          out[1][i] = g / ga;
        } else if (name === 'C') {
          let r = 0, g = 0, ra = 0;
          for (let o = 0, P = 4, a = 1; o < 4; o++, P *= 2, a *= 0.5) {
            const Pt = Math.max(1, P / 8);
            r += a * gen.perlinC.noise(u * P, v * Pt, w * P, P, Pt, P);
            g += a * gen.perlinD.noise(u * P, v * Pt, w * P, P, Pt, P);
            ra += a;
          }
          out[0][i] = r / ra; out[1][i] = g / ra;
        } else {
          const W0 = gen.worleyB[0], W1 = gen.worleyB[1], W2 = gen.worleyB[2];
          out[0][i] = 0.6 * (1 - Math.min(1, W0.f1(u * 4, v * 4, w * 4)))
                    + 0.27 * (1 - Math.min(1, W1.f1(u * 8, v * 8, w * 8)))
                    + 0.13 * (1 - Math.min(1, W2.f1(u * 16, v * 16, w * 16)));
        }
      }
    }
  }
  return out;
}

// Normalize full raw channels into a finished volume (quantized bytes + float copies).
export function assembleVolume(name, raw) {
  const V = VOLUMES[name];
  const n = V.w * V.h * V.d;
  const vol = { ...V, bytes: new Uint8Array(n * V.channels), ch: [] };
  for (let c = 0; c < V.channels; c++) normalizeToBytes(raw[c], vol.bytes, V.channels, c);
  for (let c = 0; c < V.channels; c++) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = vol.bytes[i * V.channels + c] / 255;
    vol.ch.push(f);
  }
  return vol;
}

function makeJobs(chunkVoxels) {
  const jobs = [];
  for (const name of ['A', 'C', 'B']) {
    const V = VOLUMES[name];
    const step = Math.max(1, Math.floor(chunkVoxels / (V.w * V.h)));
    for (let z = 0; z < V.d; z += step) jobs.push({ name, z0: z, z1: Math.min(V.d, z + step) });
  }
  return jobs;
}

function allocRaw() {
  const raw = {};
  for (const [name, V] of Object.entries(VOLUMES)) {
    raw[name] = [];
    for (let c = 0; c < V.channels; c++) raw[name].push(new Float32Array(V.w * V.h * V.d));
  }
  return raw;
}

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// Generate all volumes. Uses worker threads in the browser (opts.workerUrl), otherwise runs
// on the calling thread in chunks. onProgress(fraction) is called as chunks finish.
export async function generateNoiseBank(onProgress = () => {}, opts = {}) {
  const bankSeed = opts.bankSeed ?? 1337;
  const raw = allocRaw();
  const jobs = makeJobs(60000);
  const total = jobs.length;
  let done = 0;
  const store = (job, out) => {
    const V = VOLUMES[job.name];
    const off = V.w * V.h * job.z0;
    for (let c = 0; c < V.channels; c++) raw[job.name][c].set(out[c], off);
    done++;
    onProgress(done / total);
  };

  let usedWorkers = false;
  if (opts.workerUrl && typeof Worker !== 'undefined') {
    try {
      const count = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
      const workers = [];
      for (let k = 0; k < count; k++) workers.push(new Worker(opts.workerUrl, { type: 'module' }));
      await new Promise((resolve, reject) => {
        let next = 0, active = 0;
        const feed = (wk) => {
          if (next >= jobs.length) { if (active === 0) resolve(); return; }
          const job = jobs[next++]; active++;
          wk.postMessage({ bankSeed, ...job });
        };
        for (const wk of workers) {
          wk.onmessage = (e) => { active--; store(e.data, e.data.out); feed(wk); };
          wk.onerror = (e) => reject(e);
          feed(wk);
        }
      });
      workers.forEach((w) => w.terminate());
      usedWorkers = true;
    } catch (err) {
      console.warn('Noise workers unavailable, generating on the main thread.', err);
      done = 0;
    }
  }
  if (!usedWorkers) {
    const gen = makeGenerators(bankSeed);
    for (const job of jobs) {
      store(job, computeSlices(gen, job.name, job.z0, job.z1));
      await yieldFrame();
    }
  }
  return { A: assembleVolume('A', raw.A), C: assembleVolume('C', raw.C), B: assembleVolume('B', raw.B) };
}

// CPU trilinear sampling that matches GL_LINEAR + GL_REPEAT on a 3D texture.
// Writes channel values into out[0..channels-1].
export function sampleVolume(vol, u, v, w, out) {
  const { w: W, h: H, d: D, ch } = vol;
  const x = u * W - 0.5, y = v * H - 0.5, z = w * D - 0.5;
  const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
  const fx = x - xf, fy = y - yf, fz = z - zf;
  const x0 = ((xf % W) + W) % W, x1 = x0 + 1 === W ? 0 : x0 + 1;
  const y0 = ((yf % H) + H) % H, y1 = y0 + 1 === H ? 0 : y0 + 1;
  const z0 = ((zf % D) + D) % D, z1 = z0 + 1 === D ? 0 : z0 + 1;
  const i000 = x0 + W * (y0 + H * z0), i100 = x1 + W * (y0 + H * z0);
  const i010 = x0 + W * (y1 + H * z0), i110 = x1 + W * (y1 + H * z0);
  const i001 = x0 + W * (y0 + H * z1), i101 = x1 + W * (y0 + H * z1);
  const i011 = x0 + W * (y1 + H * z1), i111 = x1 + W * (y1 + H * z1);
  for (let c = 0; c < ch.length; c++) {
    const a = ch[c];
    const c00 = a[i000] + (a[i100] - a[i000]) * fx;
    const c10 = a[i010] + (a[i110] - a[i010]) * fx;
    const c01 = a[i001] + (a[i101] - a[i001]) * fx;
    const c11 = a[i011] + (a[i111] - a[i011]) * fx;
    const c0 = c00 + (c10 - c00) * fy;
    const c1 = c01 + (c11 - c01) * fy;
    out[c] = c0 + (c1 - c0) * fz;
  }
  return out;
}
