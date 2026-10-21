// Worker that computes slices of the sky noise volumes in parallel.
import { makeGenerators, computeSlices } from './noise.js';

let gen = null;
let genSeed = null;

self.onmessage = (e) => {
  const { bankSeed, name, z0, z1 } = e.data;
  if (!gen || genSeed !== bankSeed) { gen = makeGenerators(bankSeed); genSeed = bankSeed; }
  const out = computeSlices(gen, name, z0, z1);
  self.postMessage({ name, z0, z1, out }, out.map((a) => a.buffer));
};
