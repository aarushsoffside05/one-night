// Fixed viewpoints along the routes a player takes. Used for the picture sheets and the dev keys.
// y is height above the ground at that spot; the camera never goes under water (it rides 1.3 m above it,
// as if from the canoe), so the same view works at every water level.
import { PLACES } from '../world/layout'
export type Cam = { name: string; x: number; z: number; up: number; lx: number; lz: number; lup: number; fov?: number }
export const CAMS: Cam[] = [
  { name: '01 beach to mouth', x: -128, z: 226, up: 1.7, lx: -40, lz: 190, lup: 5 },
  { name: '02 river mouth', x: -42, z: 262, up: 1.4, lx: -50, lz: 170, lup: 4 },
  { name: '03 channel under banks', x: -47, z: 168, up: 1.4, lx: -30, lz: 110, lup: 5 },
  { name: '04 landing and floating house', x: -21, z: 59, up: 3.2, lx: -31, lz: 70, lup: 1.4 },
  { name: '05 bank steps from top', x: -4, z: 47, up: 1.7, lx: -34, lz: 66, lup: -4 },
  { name: '06 yard and house on legs', x: 4, z: 30, up: 1.7, lx: 25, lz: 56, lup: 3.2 },
  { name: '07 marked tree', x: 19, z: 23, up: 1.5, lx: PLACES.markedTree.x, lz: PLACES.markedTree.z, lup: 2.6 },
  { name: '08 trail', x: 55, z: 12, up: 1.7, lx: 80, lz: -14, lup: 2.5 },
  { name: '09 dry bed crossing', x: 82, z: -22, up: 1.7, lx: 118, lz: -36, lup: 1 },
  { name: '10 giant trunk', x: 101, z: -42, up: 1.6, lx: PLACES.giantTrunk.x, lz: PLACES.giantTrunk.z, lup: 9, fov: 60 },
  { name: '11 lake high bank east', x: 121.5, z: -123.5, up: 2.3, lx: 165, lz: -130, lup: 0.2 },
  { name: '12 deep forest', x: 72, z: -86, up: 1.7, lx: 96, lz: -112, lup: 4 },
]
// Benchmark flight: a fixed loop through the densest places. Flown once per water level, 20 s each.
export const FLIGHT: [number, number, number][] = [
  // x, z, height above ground-or-water
  [-44, 250, 3], [-48, 180, 3], [-32, 110, 3.5], [-36, 72, 4], [-8, 50, 3], [22, 40, 2.6], [50, 16, 2.4],
  [78, -10, 2.4], [96, -40, 2.6], [114, -66, 3], [118, -112, 2.6], [150, -132, 3], [128, -100, 3], [84, -84, 2.6], [40, -30, 3],
]
