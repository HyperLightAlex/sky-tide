// Small helpers shared by the weather and trapar engines (JS side), with GLSL twins.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const frac = (x) => x - Math.floor(x);
export const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

// 32-bit integer hash. Mirrored exactly in GLSL (skyHash) with uint math.
export function hashu(x) {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
export const cellHash = (ix, iz, seed) => hashu((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ seed) >>> 0);
export const cellHash3 = (ix, iz, iw, seed) => hashu((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ Math.imul(iw, 83492791) ^ seed) >>> 0);
// Two 16-bit uniform values from one hash.
export const lo16 = (h) => (h & 0xffff) / 65535;
export const hi16 = (h) => (h >>> 16) / 65535;

export const COMMON_GLSL = /* glsl */ `
uint skyHash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
uint skyCellHash(int ix, int iz, uint seed) {
  return skyHash((uint(ix) * 73856093u) ^ (uint(iz) * 19349663u) ^ seed);
}
float lo16(uint h) { return float(h & 0xffffu) / 65535.0; }
float hi16(uint h) { return float(h >> 16u) / 65535.0; }
`;

// Uniform helpers: build three.js uniform objects from a state object, and copy scalars each
// frame (typed arrays are shared by reference).
export function makeUniforms(state, names) {
  const u = {};
  for (const n of names) u[n] = { value: state[n] };
  return u;
}
export function syncUniforms(uniforms, state, names) {
  for (const n of names) {
    const v = state[n];
    if (!ArrayBuffer.isView(v)) uniforms[n].value = v;
  }
}
