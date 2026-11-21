// Every state the world can be in is a uniform here. Materials never get swapped at run time,
// so nothing compiles mid-play: water level, time of day, lamps and wind are all just numbers.
import { uniform } from 'three/tsl'
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
  lampCol: uniform(new Color(1, 0.62, 0.28)),
  orbCol: uniform(new Color(0.55, 0.85, 1)),
  orbWater: uniform(-100), // the lent "way of seeing": a ghost sheet of water at this height
  orbMix: uniform(0),
  detail: uniform(1), // draw-distance scale from the quality controller
  player: uniform(new Vector3()),
}
