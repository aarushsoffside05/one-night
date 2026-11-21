// The place, as numbers. Units are metres. y = 0 is the river surface at lowest water (October).
// +x is east (sunrise side), -z is north (upstream). Everything else reads from here.
export const WATER_RANGE = 10.6 // mean yearly swing, metres (brief section 7)
export const waterYOf = (w: number) => w * WATER_RANGE
export const LAKE_LEVEL = 6.2 // the cut-off lake sits perched above the low river
export const FLOOR_Y = 8.0 // the forest floor that floods (about 2.6 m under at top level)
export const HIGH_Y = 10.3 // the community's high ground: ankle-deep at top level
export const PLAY = 300 // playable half-size
export const CORE = 340 // half-size of the baked height grid
export const CELL = 2 // height grid spacing

export type P2 = readonly [number, number]
// Main low-water channel, mouth (south, on the open river) to upstream (north).
export const CHANNEL: P2[] = [[-38, 330], [-40, 262], [-46, 215], [-52, 172], [-30, 120], [-34, 78], [-50, 38], [-78, -22], [-70, -70], [-48, -118], [-58, -170], [-78, -225], [-66, -290], [-60, -360]]
// The lake's only way out: a channel bed that is dry ground in October.
export const DRYBED: P2[] = [[178, -84], [158, -58], [130, -40], [96, -31], [60, -36], [22, -52], [-14, -62], [-52, -72]]
// The trail: yard -> forest -> dry bed crossing -> giant trunk -> lake's high bank.
export const TRAIL: P2[] = [[30, 30], [52, 14], [74, -6], [92, -30], [100, -48], [112, -74], [116, -100], [121, -122]]
// Path from the yard to the top of the bank steps.
export const YARDPATH: P2[] = [[30, 30], [10, 42], [-8, 50]]

export const LAKE = { x: 186, z: -138, rx: 66, rz: 50 }
export const RIVER_Z = 236 // north shore of the open river (wobbles a little)
export const COMMUNITY = { x: 16, z: 44, r: 44 }
export const PLACES = {
  stiltHouse: { x: 24, z: 56, rot: 0.25 },
  markedTree: { x: 12, z: 30 },
  aerial: { x: 40, z: 46 },
  stepsTop: { x: -10, z: 52 },
  landing: { x: -29, z: 56 },
  floatHouse: { x: -31, z: 70, rot: 1.45 },
  giantTrunk: { x: 121, z: -66 },
  lakeBank: { x: 122, z: -124 },
  fishRoll: { x: 131, z: -127 },
  beach: { x: -110, z: 214 },
  mouth: { x: -44, z: 232 },
}

// Distance to a polyline; also reports how far along it (0..1) in polyT.
export let polyT = 0
export function distPoly(x: number, z: number, pts: readonly P2[]): number {
  let best = 1e9, bestT = 0
  const n = pts.length - 1
  for (let i = 0; i < n; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1]
    const dx = bx - ax, dz = bz - az
    let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = ax + dx * t - x, pz = az + dz * t - z
    const d = px * px + pz * pz
    if (d < best) { best = d; bestT = (i + t) / n }
  }
  polyT = bestT
  return Math.sqrt(best)
}
// Point along a polyline at 0..1 (by segment index, not arc length).
export function polyAt(pts: readonly P2[], t: number, out: { x: number; z: number }) {
  const n = pts.length - 1
  const f = Math.min(Math.max(t, 0), 0.99999) * n
  const i = Math.floor(f), u = f - i
  out.x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u
  out.z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u
  return out
}
