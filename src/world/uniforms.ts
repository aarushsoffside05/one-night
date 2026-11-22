// Every state the world can be in is a uniform here: nothing compiles mid-play.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const U = {
  time: uniform(0),
  waterY: uniform(0),                 // the one number, in metres
  lakeY: uniform(5),                  // max(waterY, lake's own level)
  markY: uniform(10.6),               // last year's flood mark
  sunDir: uniform(new THREE.Vector3(0.4, 0.7, 0.3)),
  sunCol: uniform(new THREE.Color(1, 0.9, 0.75)),
  sunDisc: uniform(new THREE.Color(1, 0.9, 0.75)),
  skyTop: uniform(new THREE.Color(0.25, 0.45, 0.75)),
  skyHorizon: uniform(new THREE.Color(0.8, 0.85, 0.85)),
  fogCol: uniform(new THREE.Color(0.75, 0.82, 0.8)),
  fogSunCol: uniform(new THREE.Color(1, 0.85, 0.6)),
  fogDensity: uniform(0.004),
  fogHeight: uniform(26),             // haze thins out above this many metres over the water
  waterDeep: uniform(new THREE.Color(0.20, 0.15, 0.08)),
  waterShallow: uniform(new THREE.Color(0.45, 0.33, 0.18)),
  waterLake: uniform(new THREE.Color(0.10, 0.14, 0.10)),
  underTint: uniform(new THREE.Color(0.5, 0.4, 0.25)),
  canopyAmb: uniform(0.5),            // ambient under a closed canopy (1 = open sky)
  dapple: uniform(1),                 // strength of the moving canopy light pattern
  wind: uniform(1),
  shadowR: uniform(48),               // radius of the real sun shadow
  camSnap: uniform(new THREE.Vector3()),
  glow: uniform(1.6),                 // emissive swatch strength
  night: uniform(0),                  // 0 day .. 1 night
  stars: uniform(0),
  seeing: uniform(0),                 // device "Seeing" overlay strength
  fade: uniform(1),
  sat: uniform(1),
  tintAmt: uniform(0),
  tintCol: uniform(new THREE.Color(1, 1, 1)),
};
