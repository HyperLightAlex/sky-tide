// GLSL mirror of the trapar engine (trapar.js). Keep the two in lockstep.
// Requires BRAIDS_GLSL and COMMON_GLSL before it.

export const TRAPAR_UNIFORMS = ['uTrFlowOff', 'uTrFlowDir', 'uTrLo', 'uTrHi', 'uTrTime'];

export const TRAPAR_GLSL = /* glsl */ `
uniform vec2 uTrFlowOff, uTrFlowDir;
uniform float uTrLo, uTrHi;
uniform float uTrTime;

// Last values computed by trDensityImpl, for shading.
float gTrSwell = 0.0;          // wave height (relative to the biggest trunk waves, about -1..1)
float gTrChaos = 0.0;
vec2 gTrFlow = vec2(0.0);   // stream flow velocity along the band (xz, m/s)
float gTrPool = 0.0;
float gTrStream = 0.0;      // stream density
float gTrCls = 0.0;         // band class (1 trunk, 2 root, 3 cord)
float gTrTier = 0.0;        // band size (0 trunk, 1 root, 2 rootlet, 3 tendril) + 4 * layer
float gTrTags = 0.0;        // feature tags (TAG in network.js)
float gTrFoam = 0.0;        // white water

float trDensityImpl(vec3 p, bool full, out float plumeOut) {
  plumeOut = 0.0;
  gTrFlow = vec2(0.0); gTrStream = 0.0; gTrCls = 0.0; gTrTier = 0.0; gTrTags = 0.0; gTrFoam = 0.0; gTrSwell = 0.0;
  gBrCnt = 0;
  if (p.y < uTrLo || p.y > uTrHi) return 0.0;
  float rho = brDensity(p);
  if (rho > 0.0) { gTrFlow = gBrTan.xz * gBrFlow; gTrStream = rho; gTrCls = gBrCls; gTrTier = gBrTier; gTrTags = gBrTags; gTrFoam = gBrFoam; gTrSwell = gBrWave; }
  return rho;
}

float trDensity(vec3 p) { float pl; return trDensityImpl(p, true, pl); }
float trDensityLite(vec3 p) { float pl; return trDensityImpl(p, false, pl); }
`;
