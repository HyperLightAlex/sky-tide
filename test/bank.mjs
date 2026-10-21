// Test helper: load the noise bank from a cache file, generating it once.
import fs from 'fs';
import { generateNoiseBank, VOLUMES, assembleVolume } from '../src/sky/noise.js';
const CACHE = new URL('./cache/bank.bin', import.meta.url);
export async function loadBank() {
  const vols = ['A', 'C', 'B'];
  if (fs.existsSync(CACHE)) {
    const buf = fs.readFileSync(CACHE);
    let off = 0; const bank = {};
    for (const n of vols) {
      const V = VOLUMES[n]; const len = V.w * V.h * V.d * V.channels;
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset + off, len); off += len;
      const vol = { ...V, bytes: new Uint8Array(bytes), ch: [] };
      const N = V.w * V.h * V.d;
      for (let c = 0; c < V.channels; c++) { const f = new Float32Array(N); for (let i = 0; i < N; i++) f[i] = vol.bytes[i * V.channels + c] / 255; vol.ch.push(f); }
      bank[n] = vol;
    }
    return bank;
  }
  const bank = await generateNoiseBank();
  fs.mkdirSync(new URL('./cache/', import.meta.url), { recursive: true });
  fs.writeFileSync(CACHE, Buffer.concat(vols.map(n => Buffer.from(bank[n].bytes))));
  return bank;
}
