// Every state the world can be in is a uniform here. Materials never get swapped at run time,
// so nothing compiles mid-play: water level, time of day, lamps and wind are all just numbers.
import { uniform } from './tsl'
import { Color, Vector3, Vector4 } from 'three/webgpu'

export const U = {
  water: uniform(0), // river surface height in metres (0 .. 10.6): THE one number, as metres
  lake: uniform(6.2), // lake surface height: max(lake level, river)
  time: uniform(0), // seconds, animation clock (frozen for pictures)
  wind: uniform(1),
  sunDir: uniform(new Vector3(0.4, 0.7, 0.2)), // towards the sun (or moon)
  sunCol: uniform(new Color(1, 0.9, 0.75)),
  skyTop: uniform(new Color(0.3, 0.5, 0.8)),
  skyHor: uniform(new Color(0.8, 0.85, 0.8)),
  skyGlow: uniform(new Color(1, 0.7, 0.4)), // colour round the sun
  amb: uniform(new Color(0.4, 0.5, 0.6)), // sky ambient on up-facing
  ambGround: uniform(new Color(0.3, 0.25, 0.15)), // bounce on down-facing
  fogCol: uniform(new Color(0.7, 0.8, 0.8)),
  fogSun: uniform(new Color(1, 0.85, 0.6)), // fog colour looking into the sun
  fogDen: uniform(0.004),
  fogHeight: uniform(0.06), // how fast haze thins with height
  shadowTint: uniform(new Color(0.35, 0.42, 0.6)),
  day: uniform(1), // 1 by day, 0 at night: dapple strength, shafts
  waterDeep: uniform(new Color(0.16, 0.13, 0.07)),
  waterShallow: uniform(new Color(0.5, 0.42, 0.25)),
  lamp0: uniform(new Vector4(0, -100, 0, 0)), // xyz position, w strength
  lamp1: uniform(new Vector4(0, -100, 0, 0)),
  lamp2: uniform(new Vector4(0, -100, 0, 0)),
  orb: uniform(new Vector4(0, -100, 0, 0)), // the orb's light at the boy's hand
  fogMax: uniform(0.96),
  cloudCol: uniform(new Color(1, 1, 1)),
  cloudShade: uniform(new Color(0.6, 0.65, 0.75)),
  stars: uniform(0),
  discCol: uniform(new Color(1, 0.95, 0.8)),
  sunI: uniform(1), // direct light strength, for shaders that fake it (water glitter, shafts)
  mist: uniform(0),
  raft: uniform(new Vector4(0, 0, 0, 0)), // floating house: x,z tilt and y dip when someone steps on (xyz), spare
  fishRoll: uniform(new Vector3(0, 0.3, 0.5)), // the giant fish: progress, bend, tail wag
  boatLake: uniform(0), // 1 while the boats being drawn sit on the lake (wet band height)
  marker: uniform(new Vector4(0, -100, 0, 0)), // a soft ring of light on the ground where the story asks him to go
  grey: uniform(0), // the told story: the world's colour drops away
  ripple: uniform(1), // water surface roughness (still lake at dawn = low) // low ground mist before dawn

  lampCol: uniform(new Color(1, 0.62, 0.28)),
  orbCol: uniform(new Color(0.5, 0.72, 0.8)),
  orbWater: uniform(-100), // the lent "way of seeing": a ghost sheet of water at this height
  orbMix: uniform(0),
  detail: uniform(1), // draw-distance scale from the quality controller
  player: uniform(new Vector3()),
  eye: uniform(new Vector3()), // main camera position (shadow passes have their own camera, so shaders use this)
}
