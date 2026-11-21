// Land from a height formula. Pure functions over numbers and typed arrays: runs in the worker
// (to bake the grid) and on the main thread (to read it). No three.js in here.
import { CHANNEL, DRYBED, TRAIL, YARDPATH, LAKE, RIVER_Z, COMMUNITY, PLACES, FLOOR_Y, HIGH_Y, CORE, CELL, distPoly, polyT } from './layout'
import { fbm2, noise2, seedInt } from './rng'

const ss = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t

// Scratch outputs of heightFormula (ground kinds, 0..1), read right after a call.
export const kind = { sand: 0, trail: 0, bank: 0, dry: 0, lake: 0, channel: 0, high: 0 }

export function lakeD(x: number, z: number, S: number): number {
  const dx = (x - LAKE.x) / LAKE.rx, dz = (z - LAKE.z) / LAKE.rz
  const a = Math.atan2(dz, dx)
  const wob = 1 + 0.16 * Math.sin(a * 3 + 1.3) + 0.09 * Math.sin(a * 5 + 4.0) + 0.1 * (noise2(x / 22, z / 22, S + 91) - 0.5)
  return Math.sqrt(dx * dx + dz * dz) / wob
}

export function heightFormula(x: number, z: number): number {
  const S = seedInt('terrain')
  const n1 = fbm2(x / 70, z / 70, S, 4), n2 = fbm2(x / 15, z / 15, S + 7, 3), n3 = noise2(x / 4.3, z / 4.3, S + 13)
  // forest floor that floods, with long low swales
  const swale = ss(0.52, 0.72, fbm2(x / 55 + 9, z / 110, S + 31, 3))
  let h = FLOOR_Y + (n1 - 0.5) * 1.5 + (n2 - 0.5) * 0.5 + (n3 - 0.5) * 0.12 - swale * 1.3

  // the community's high ground
  const cd = Math.hypot((x - COMMUNITY.x), (z - COMMUNITY.z) * 0.9) / COMMUNITY.r
  const high = 1 - ss(0.62, 1.0, cd + (n2 - 0.5) * 0.3)
  h = mix(h, HIGH_Y + (n2 - 0.5) * 0.12 + (n3 - 0.5) * 0.05, high)
  kind.high = high

  // natural levee: ground stands a little higher beside the channel
  const dc = distPoly(x, z, CHANNEL), s = polyT
  h += 0.9 * ss(70, 30, dc) * (1 - high)

  // the lake, cut off in the forest; a high bank on its west side where the trail arrives
  const dl = lakeD(x, z, S)
  const bankSide = ss(60, 20, Math.hypot(x - PLACES.lakeBank.x, z - PLACES.lakeBank.z))
  h += bankSide * 1.5 * ss(0.8, 1.1, dl)
  const rimA = mix(0.86, 0.985, bankSide), rimB = mix(1.16, 1.035, bankSide)
  const lakeBed = 3.2 + 2.2 * dl * dl + (n2 - 0.5) * 0.4
  const lk = 1 - ss(rimA, rimB, dl)
  h = mix(h, lakeBed, lk)
  kind.lake = lk

  // the dry channel bed (the lake's only way out)
  const dd = distPoly(x, z, DRYBED), sd = polyT
  const dryBedY = mix(6.75, 6.2, sd) + (n3 - 0.5) * 0.1
  const dryW = 3.2 + 1.5 * noise2(sd * 9, 3, S + 5)
  const dry = (1 - ss(dryW, dryW + 5.5, dd)) * (1 - lk)
  h = mix(h, Math.min(h, dryBedY), dry)
  kind.dry = dry * (1 - ss(dryW + 1, dryW + 4, dd) * 0.6)

  // the open river to the south, the beach at the mouth
  const shoreZ = RIVER_Z + 9 * Math.sin(x / 85 + 0.6) + 5 * Math.sin(x / 31)
  const dr = z - shoreZ // > 0 is river
  const beachness = ss(190, 70, Math.hypot(x - PLACES.beach.x, (z - PLACES.beach.z) * 0.6)) * ss(-6, -22, x + 46)
  // steep scarp where there is no beach, long sand slope where there is
  const scarp = ss(-16, 2, dr)
  const sandSlope = ss(-78, 6, dr)
  const toRiver = mix(scarp, sandSlope, beachness)
  const beachY = mix(h, 0.25 + (n2 - 0.5) * 0.5 + 1.6 * ss(0.3, 0.9, noise2(x / 26, z / 9, S + 3)) * (1 - sandSlope), toRiver)
  h = beachY
  kind.sand = beachness * ss(0.12, 0.5, sandSlope)
  const riverBed = -5.5 + (n1 - 0.5) * 1.5
  h = mix(h, riverBed, ss(-3, 46, dr))

  // the low-water channel: a trench with bare banks taller than a house
  const bedY = mix(-3.4, -0.7, ss(0.12, 1, s)) + (n2 - 0.5) * 0.7
  const wb = mix(12.5, 6.5, ss(0.2, 1, s)) + 2.5 * (noise2(s * 26, 1, S + 2) - 0.5)
  const run = mix(10.5, 8, s) + 3 * (noise2(x / 18, z / 18, S + 44) - 0.5)
  const p = ss(wb, wb + run, dc)
  // banks slump in steps: terraces left by the falling river
  const terr = p + 0.05 * Math.sin(p * 19) * p * (1 - p) * 4
  const carved = mix(bedY, h, Math.min(Math.max(terr, 0), 1))
  kind.channel = 1 - p
  kind.bank = Math.max(ss(0.02, 0.2, p) * (1 - ss(0.82, 1.0, p)), Math.max(0, 1 - Math.abs(dr + 6) / 9) * (1 - beachness)) * (h > 1 ? 1 : 0)
  h = Math.min(h, carved)

  // trail and yard path: a narrow cut line, trodden slightly lower and smooth
  const dt = Math.min(distPoly(x, z, TRAIL), distPoly(x, z, YARDPATH))
  const tr = 1 - ss(0.7, 2.2, dt + (n3 - 0.5) * 0.8)
  kind.trail = Math.max(tr * (1 - lk) * p, high * 0.55 * ss(0.3, 0.6, noise2(x / 6, z / 6, S + 77)))
  h -= tr * 0.12 * p * (1 - lk)
  return h
}

export const GRID_N = (CORE * 2) / CELL + 1

export class Heightfield {
  readonly n = GRID_N
  constructor(public h: Float32Array) {}
  // bilinear read of the baked grid inside the core, the formula outside it
  at(x: number, z: number): number {
    const fx = (x + CORE) / CELL, fz = (z + CORE) / CELL
    const n = this.n
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return heightFormula(x, z)
    const ix = fx | 0, iz = fz | 0
    const u = fx - ix, v = fz - iz
    const i = iz * n + ix
    const h = this.h
    // match the mesh's triangle split (diagonal from (ix,iz+1) to (ix+1,iz))
    if (u + v <= 1) return h[i] + (h[i + 1] - h[i]) * u + (h[i + n] - h[i]) * v
    return h[i + n + 1] + (h[i + n] - h[i + n + 1]) * (1 - u) + (h[i + 1] - h[i + n + 1]) * (1 - v)
  }
  normalInto(x: number, z: number, out: { x: number; y: number; z: number }) {
    const e = 1.0
    const dx = this.at(x + e, z) - this.at(x - e, z), dz = this.at(x, z + e) - this.at(x, z - e)
    const l = 1 / Math.hypot(dx, 2 * e, dz)
    out.x = -dx * l; out.y = 2 * e * l; out.z = -dz * l
    return out
  }
  slope(x: number, z: number): number {
    const e = 0.8
    return Math.hypot(this.at(x + e, z) - this.at(x - e, z), this.at(x, z + e) - this.at(x, z - e)) / (2 * e)
  }
}

// Bake the core grid: heights + a ground-kind map (RGBA8: sand, trail, bare bank, dry bed).
export function bakeTerrain(onProgress?: (f: number) => void) {
  const n = GRID_N
  const h = new Float32Array(n * n)
  const kinds = new Uint8Array(n * n * 4)
  for (let iz = 0; iz < n; iz++) {
    const z = -CORE + iz * CELL
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix
      h[i] = heightFormula(-CORE + ix * CELL, z)
      kinds[i * 4] = kind.sand * 255
      kinds[i * 4 + 1] = kind.trail * 255
      kinds[i * 4 + 2] = kind.bank * 255
      kinds[i * 4 + 3] = kind.dry * 255
    }
    if (onProgress && iz % 32 === 0) onProgress(iz / n)
  }
  return { h, kinds }
}
