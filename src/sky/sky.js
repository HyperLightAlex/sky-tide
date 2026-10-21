// The sky world: weather and trapar, updated together.
//
//   world.weather  wind, water clouds, storms (scenery and conditions)
//   world.trapar   the ridable medium (pushed by wind, fed swells by storms)
//
// Both are deterministic functions of position, time, seed, parameters and the storm list.
// update(t, focus) refreshes time-dependent state; focus is where swell sources and nearby
// storms are selected for (the rider).

import { Weather } from '../weather/weather.js';
import { Trapar } from '../trapar/trapar.js';
import { WEATHER_GLSL, WEATHER_UNIFORMS } from '../weather/weather.glsl.js';
import { TRAPAR_GLSL, TRAPAR_UNIFORMS } from '../trapar/trapar.glsl.js';
import { BRAIDS_GLSL, BRAID_UNIFORMS } from '../trapar/braids.glsl.js';
import { COMMON_GLSL, makeUniforms, syncUniforms } from './common.js';

export class SkyWorld {
  constructor(bank, params) {
    this.weather = new Weather(bank, params);
    this.trapar = new Trapar(bank, params, this.weather);
    this.t = 0;
  }
  update(t, focus) {
    this.t = t;
    this.weather.update(t, focus);
    this.trapar.update(t, focus);
  }
}

// Everything a shader needs to evaluate both fields: wxCloud(), wxPressure(), trDensity()...
export const SKY_GLSL = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uNoiseA;
uniform sampler3D uNoiseB;
uniform sampler3D uNoiseC;
${COMMON_GLSL}
${WEATHER_GLSL}
${BRAIDS_GLSL}
${TRAPAR_GLSL}
`;

export function makeSkyUniforms(textures, world) {
  return {
    uNoiseA: { value: textures.A }, uNoiseB: { value: textures.B }, uNoiseC: { value: textures.C },
    tBrSeg: { value: textures.brSeg }, tBrIdx: { value: textures.brIdx }, tBrCell: { value: textures.brCell },
    ...makeUniforms(world.weather.S, WEATHER_UNIFORMS),
    ...makeUniforms(world.trapar.S, TRAPAR_UNIFORMS),
    ...makeUniforms(world.trapar.braids.S, BRAID_UNIFORMS),
  };
}

export function syncSkyUniforms(uniforms, world) {
  syncUniforms(uniforms, world.weather.S, WEATHER_UNIFORMS);
  syncUniforms(uniforms, world.trapar.S, TRAPAR_UNIFORMS);
  syncUniforms(uniforms, world.trapar.braids.S, BRAID_UNIFORMS);
}
