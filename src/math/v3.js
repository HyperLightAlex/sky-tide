// Minimal mutable 3D vector used by the simulation.
// The sky engine and rider physics avoid depending on three.js so they can
// run anywhere (browser, worker, Node tests, a future server).

export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    this.x = x; this.y = y; this.z = z; return this;
  }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lenSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize(fallback) {
    const l = this.len();
    if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; }
    else if (fallback) this.copy(fallback);
    return this;
  }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  // Remove the component along unit vector n (projects onto the plane with normal n).
  projectOnPlane(n) { const d = this.dot(n); this.x -= n.x * d; this.y -= n.y * d; this.z -= n.z * d; return this; }
  isFinite() { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }
}

// Rotate v around unit axis by angle (Rodrigues), in place.
export function rotateAround(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  v.x = v.x * c + cx * s + axis.x * d * (1 - c);
  v.y = v.y * c + cy * s + axis.y * d * (1 - c);
  v.z = v.z * c + cz * s + axis.z * d * (1 - c);
  return v;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
