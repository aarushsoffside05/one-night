// Placement by rule, in the worker: trees, crowns, palms and all small cover, as flat instance records
// (8 floats each: x, y, z, s, rot, seed, a, b) sorted by 50 m cell so the main thread can cull per cell.
import { rng, noise2, fbm2, seedInt } from './rng'
import { Heightfield, heightFormula, kind } from './terrain'
import { CHANNEL, DRYBED, TRAIL, YARDPATH, COMMUNITY, PLACES, CORE, distPoly, LAKE_LEVEL } from './layout'

export const CELLS = 14, CELL_M = 50, CELL_ORIGIN = -350
export const cellOf = (x: number, z: number) => {
  const cx = Math.min(CELLS - 1, Math.max(0, Math.floor((x - CELL_ORIGIN) / CELL_M)))
  const cz = Math.min(CELLS - 1, Math.max(0, Math.floor((z - CELL_ORIGIN) / CELL_M)))
  return cz * CELLS + cx
}
export type FieldData = { data: Float32Array; cellStart: Uint32Array }
export const FIELD_NAMES = ['trunk', 'clump', 'spray', 'palm', 'sapling', 'broadleaf', 'tuft', 'log', 'root', 'vine', 'bankroot', 'floater', 'shaft'] as const
export type FieldName = (typeof FIELD_NAMES)[number]

class Rec {
  a: number[] = []
  push(x: number, y: number, z: number, s: number, rot: number, seed: number, a: number, b: number) { this.a.push(x, y, z, s, rot, seed, a, b) }
  finish(): FieldData {
    const n = this.a.length / 8, src = this.a
    const count = new Uint32Array(CELLS * CELLS + 1)
    const cell = new Uint16Array(n)
    for (let i = 0; i < n; i++) { cell[i] = cellOf(src[i * 8], src[i * 8 + 2]); count[cell[i] + 1]++ }
    for (let c = 0; c < CELLS * CELLS; c++) count[c + 1] += count[c]
    const cellStart = count.slice()
    const fill = count.slice(0, CELLS * CELLS)
    const data = new Float32Array(n * 8)
    for (let i = 0; i < n; i++) { const d = fill[cell[i]]++ * 8; for (let k = 0; k < 8; k++) data[d + k] = src[i * 8 + k] }
    return { data, cellStart }
  }
}

export const COVER_N = 256
export type ForestCook = { fields: Record<FieldName, FieldData>; cover: Uint8Array; solids: Float32Array; treeCount: number; markedR: number }

export function cookForest(hf: Heightfield, density: number, progress: (f: number) => void): ForestCook {
  const R = Object.fromEntries(FIELD_NAMES.map((n) => [n, new Rec()])) as Record<FieldName, Rec>
  const cover = new Float32Array(COVER_N * COVER_N)
  const solids: number[] = []
  const S = seedInt('forest')
  const r = rng('trees')
  const splat = (x: number, z: number, rad: number, v: number) => {
    const k = COVER_N / (CORE * 2)
    const cx = (x + CORE) * k, cz = (z + CORE) * k, cr = rad * k
    const x0 = Math.max(0, Math.floor(cx - cr)), x1 = Math.min(COVER_N - 1, Math.ceil(cx + cr))
    const z0 = Math.max(0, Math.floor(cz - cr)), z1 = Math.min(COVER_N - 1, Math.ceil(cz + cr))
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i - cx, j - cz) / cr
      if (d < 1) cover[j * COVER_N + i] = Math.min(1, cover[j * COVER_N + i] + v * (1 - d * d))
    }
  }
  const trees: { x: number; y: number; z: number; r: number; h: number; type: number }[] = []

  const addTree = (x: number, z: number, type: number, forceLean = -1, leanDir = 0, scale = 1) => {
    const y = hf.at(x, z)
    const seed = r()
    // type: 0 emergent, 1 canopy, 2 mid, 3 pole, 4 treelet
    const h = (type === 0 ? r.range(32, 42) : type === 1 ? r.range(19, 29) : type === 2 ? r.range(11, 18) : type === 3 ? r.range(6, 11) : r.range(2.8, 5.5)) * scale
    const rad = (type === 0 ? r.range(0.75, 1.15) : type === 1 ? r.range(0.26, 0.5) : type === 2 ? r.range(0.13, 0.26) : type === 3 ? r.range(0.055, 0.11) : r.range(0.03, 0.055)) * scale
    const lean = forceLean >= 0 ? forceLean : r() * r() * 0.12
    const rot = forceLean >= 0 ? leanDir : r() * 6.283
    R.trunk.push(x, y - 0.3, z, rad, rot, seed, h, lean)
    trees.push({ x, y, z, r: rad, h, type })
    if (rad > 0.13) solids.push(x, z, rad * (type === 0 ? 1.9 : 1.25))
    // crown: clumps round the top. The trunk leans along (sin rot, cos rot) by lean*h at the top.
    const tx = x + Math.sin(rot) * lean * h, tz = z + Math.cos(rot) * lean * h
    const n = type === 0 ? 10 + r.int(3) : type === 1 ? 6 + r.int(3) : type === 2 ? 4 + r.int(2) : type === 3 ? 1 + r.int(2) : 1 + r.int(2)
    const cs = type === 0 ? r.range(6.5, 9.5) : type === 1 ? r.range(3.8, 6.2) : type === 2 ? r.range(2.4, 3.8) : type === 3 ? r.range(1.3, 2.1) : r.range(0.9, 1.6)
    const tint = fbm2(x / 90, z / 90, S + 5, 2) * 0.6 + r() * 0.4
    const a0 = r() * 6.283
    for (let i = 0; i < n; i++) {
      const top = i === 0
      const ang = a0 + (i / Math.max(1, n - 1)) * 6.283 + r.range(-0.3, 0.3)
      const ring = top ? 0 : cs * (type === 0 ? r.range(0.55, 1.1) : r.range(0.35, 0.75))
      const s = cs * (top ? 1.05 : r.range(0.65, 1.0))
      const cy = y + h * (top ? 0.97 : r.range(0.7, 0.93)) - (type === 0 && !top ? 1.5 : 0)
      ;(type >= 3 ? R.spray : R.clump).push(tx + Math.cos(ang) * ring, cy, tz + Math.sin(ang) * ring, s, r() * 6.283, r(), type === 0 ? r.range(0.45, 0.6) : r.range(0.6, 0.95), Math.min(1, Math.max(0, tint + r.range(-0.12, 0.12))))
    }
    if (type <= 2) splat(tx, tz, cs * (type === 0 ? 2.1 : 1.7), 0.8)
    return rad
  }

  // ---- trees on a jittered grid, thinned by rules
  const STEP = 4.3
  const lim = 346
  const nG = Math.floor((lim * 2) / STEP)
  for (let gz = 0; gz < nG; gz++) {
    if (gz % 16 === 0) progress(gz / nG * 0.5)
    for (let gx = 0; gx < nG; gx++) {
      const x = -lim + (gx + 0.5) * STEP + r.range(-2.6, 2.6), z = -lim + (gz + 0.5) * STEP + r.range(-2.6, 2.6)
      const roll = r(), typeRoll = r()
      const h = heightFormula(x, z)
      if (h < 6.4 || kind.lake > 0.04 || kind.sand > 0.25 || kind.dry > 0.45) continue
      if (kind.channel > 0.06) continue
      const dTrail = Math.min(distPoly(x, z, TRAIL), distPoly(x, z, YARDPATH))
      if (dTrail < 1.9) continue
      const cd = Math.hypot(x - COMMUNITY.x, (z - COMMUNITY.z) * 0.9) / COMMUNITY.r
      if (cd < 0.62) continue // the yard is open ground; its few trees are placed by hand below
      if (Math.hypot(x - PLACES.giantTrunk.x, z - PLACES.giantTrunk.z) < 11) continue
      const dens = 0.3 + 0.62 * smooth(0.3, 0.68, fbm2(x / 38, z / 38, S + 3, 3))
      if (roll > dens * density) continue
      const dc = distPoly(x, z, CHANNEL)
      const edge = dc < 34 || kind.bank > 0.1 || (kind.lake === 0 && Math.hypot((x - 186) / 66, (z + 138) / 50) < 1.28)
      if (edge && typeRoll < 0.5) {
        // edge trees lean out over the water, lower and fuller
        const e = 2
        const gxn = heightFormula(x + e, z) - heightFormula(x - e, z), gzn = heightFormula(x, z + e) - heightFormula(x, z - e)
        const dir = Math.atan2(-gxn, -gzn)
        addTree(x, z, typeRoll < 0.2 ? 1 : 2, Math.hypot(gxn, gzn) > 0.15 ? r.range(0.12, 0.3) : r() * 0.1, dir, 0.9)
        continue
      }
      const type = typeRoll < 0.04 ? 0 : typeRoll < 0.3 ? 1 : typeRoll < 0.55 ? 2 : typeRoll < 0.8 ? 3 : 4
      if (type === 0 && dTrail < 6) { addTree(x, z, 1); continue }
      addTree(x, z, type)
    }
  }
  // the yard: the marked tree, and a few shade trees round the edges
  const markedR = addTree(PLACES.markedTree.x, PLACES.markedTree.z, 1, 0.0, 0, 1.15)
  // the giant trunk's crown (the trunk itself is a hero piece built on the main thread)
  {
    const T = PLACES.giantTrunk, gy = hf.at(T.x, T.z)
    for (let i = 0; i < 16; i++) {
      const a = i * 2.4, d = i === 0 ? 0 : r.range(5, 15)
      R.clump.push(T.x + Math.cos(a) * d, gy + r.range(38, 47), T.z + Math.sin(a) * d, r.range(8, 12), r() * 6.283, r(), r.range(0.45, 0.6), r.range(0.3, 0.7))
    }
    splat(T.x, T.z, 22, 1)
  }
  for (const [x, z, t] of [[-4, 22, 2], [44, 62, 1], [34, 20, 2], [-6, 66, 2], [46, 34, 1], [8, 74, 1], [-14, 38, 2]] as const) addTree(x, z, t)
  const treeCount = trees.length

  // ---- palms: small groups on higher, lighter ground
  const rp = rng('palms')
  for (let i = 0; i < 520 * density; i++) {
    const x = rp.range(-340, 340), z = rp.range(-340, 340)
    if (fbm2(x / 60, z / 60, S + 71, 2) < 0.52) continue
    const h = heightFormula(x, z)
    if (h < 7.2 || kind.lake > 0.02 || kind.channel > 0.04 || kind.sand > 0.2 || kind.dry > 0.3 || kind.trail > 0.25) continue
    if (Math.hypot(x - COMMUNITY.x, z - COMMUNITY.z) < 30 || Math.hypot(x - PLACES.giantTrunk.x, z - PLACES.giantTrunk.z) < 9) continue
    const ph = rp.range(7, 16), seed = rp()
    R.trunk.push(x, h - 0.3, z, rp.range(0.11, 0.16), rp() * 6.283, seed, ph, rp.range(0.02, 0.14))
    solids.push(x, z, 0.22)
    const rot = R.trunk.a[R.trunk.a.length - 4], lean = R.trunk.a[R.trunk.a.length - 1]
    R.palm.push(x + Math.sin(rot) * lean * ph, h + ph - 0.5, z + Math.cos(rot) * lean * ph, rp.range(3.2, 4.6), rp() * 6.283, seed, rp.range(0.8, 1.1), rp())
  }
  progress(0.6)

  // ---- cover at trunk feet: saplings, roots; vines from the bigger crowns
  const rc = rng('cover')
  for (const t of trees) {
    const ns = t.type >= 3 ? rc.int(2) : 2 + rc.int(3)
    for (let i = 0; i < ns; i++) {
      const a = rc() * 6.283, d = t.r * 2 + rc.range(0.5, 2.6)
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d
      const h = heightFormula(x, z)
      if (kind.trail > 0.3 || kind.channel > 0.3 || kind.lake > 0.1) continue
      R.sapling.push(x, h, z, rc.range(0.5, 1.3), rc() * 6.283, rc(), rc.range(0.8, 1.2), rc())
    }
    if (t.type <= 1) {
      const nr = t.type === 0 ? 7 : 3 + rc.int(3)
      const a0 = rc() * 6.283
      for (let i = 0; i < nr; i++) {
        const a = a0 + (i / nr) * 6.283 + rc.range(-0.3, 0.3)
        R.root.push(t.x + Math.cos(a) * t.r * 1.2, hf.at(t.x + Math.cos(a) * t.r * 2.5, t.z + Math.sin(a) * t.r * 2.5) - 0.05, t.z + Math.sin(a) * t.r * 1.2, t.r * rc.range(4.5, 9), a, rc(), t.r * rc.range(0.45, 0.8), 0)
      }
      const nv = rc.int(3)
      for (let i = 0; i < nv; i++) {
        const a = rc() * 6.283, d = rc.range(1.5, 5)
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d
        const top = t.y + t.h * rc.range(0.7, 0.86)
        const gy = hf.at(x, z)
        R.vine.push(x, top, z, 1, rc() * 6.283, rc(), top - gy - (rc() < 0.5 ? 0 : rc.range(0.5, 4)), rc())
      }
    }
  }
  progress(0.7)

  // ---- broad-leaved understory and low tufts: everywhere there is shade, thinner on trodden ground
  const ru = rng('understory')
  const us = 1.9
  for (let z = -lim; z < lim; z += us) for (let x = -lim; x < lim; x += us) {
    const px = x + ru.range(0, us), pz = z + ru.range(0, us), roll = ru(), s = ru.range(0.7, 1.5), rot = ru() * 6.283, seed = ru()
    const n = fbm2(px / 18, pz / 18, S + 9, 2)
    if (roll > (0.2 + 0.75 * smooth(0.38, 0.66, n)) * density) continue
    const h = heightFormula(px, pz)
    if (h < 6.9 || kind.lake > 0.02 || kind.channel > 0.12 || kind.sand > 0.2 || kind.trail > 0.25 || kind.dry > 0.55) continue
    if (kind.high > 0.5 && n < 0.6) continue
    R.broadleaf.push(px, h, pz, s, rot, seed, ru.range(0.8, 1.25), ru())
  }
  const ts = 1.0
  for (let z = -lim; z < lim; z += ts) for (let x = -lim; x < lim; x += ts) {
    const px = x + ru.range(0, ts), pz = z + ru.range(0, ts), roll = ru(), s = ru.range(0.6, 1.4), rot = ru() * 6.283, seed = ru()
    const n = fbm2(px / 9, pz / 9, S + 19, 2)
    if (roll > (0.16 + 0.6 * smooth(0.35, 0.7, n)) * density) continue
    const h = heightFormula(px, pz)
    if (h < 0.6 || kind.lake > 0.3 || kind.trail > 0.35) continue
    // on the bare banks and the beach only the odd tuft; none under the lowest water
    if ((kind.channel > 0.15 || kind.sand > 0.2 || kind.dry > 0.5) && roll > 0.05) continue
    R.tuft.push(px, h, pz, s, rot, seed, ru.range(0.8, 1.4), ru())
  }
  progress(0.82)

  // ---- fallen wood: scattered on the floor, and stranded in lines where the flood left it (bank tops, dry bed edges)
  const rl = rng('logs')
  for (let i = 0; i < 2600 * density; i++) {
    const x = rl.range(-lim, lim), z = rl.range(-lim, lim), len = rl.range(1.2, 6) * (rl() < 0.12 ? 2 : 1), rad = rl.range(0.07, 0.28), rot = rl() * 6.283, seed = rl(), roll = rl()
    const h = heightFormula(x, z)
    if (kind.lake > 0.2 || kind.trail > 0.3 || h < 0.3) continue
    const strand = kind.bank > 0.2 || (kind.dry > 0.15 && kind.dry < 0.7) || kind.sand > 0.3
    if (!strand && roll > 0.3) continue
    if (kind.channel > 0.12 && roll > 0.12) continue
    R.log.push(x, h + rad * 0.5, z, len, rot, seed, rad, 0)
  }
  // ---- hanging roots at the top of the channel banks and the lake's high bank
  const rb = rng('bankroots')
  for (let i = 0; i < 9000 * density; i++) {
    const x = rb.range(-140, 20), z = rb.range(-340, 250), len = rb.range(1.5, 5.5), seed = rb(), w = rb.range(0.6, 1.4)
    const h = heightFormula(x, z)
    if (kind.channel < 0.02 || kind.channel > 0.3 || h < 6.5) continue
    const e = 1.5
    const gxn = heightFormula(x + e, z) - heightFormula(x - e, z), gzn = heightFormula(x, z + e) - heightFormula(x, z - e)
    R.bankroot.push(x, h + 0.25, z, w, Math.atan2(-gxn, -gzn), seed, len, 0)
  }
  // ---- floating plants: candidates all down the slopes; the shader shows only those the water's edge has reached
  const rf = rng('floaters')
  for (let i = 0; i < 60000 * density; i++) {
    const x = rf.range(-lim, lim), z = rf.range(-lim, 260), s = rf.range(0.5, 1.5), rot = rf() * 6.283, seed = rf(), roll = rf()
    const h = heightFormula(x, z)
    if (h > 10.2 || h < -1.4) continue
    const still = kind.lake > 0.3 || kind.dry > 0.3
    if (h > LAKE_LEVEL - 1.6 && h < LAKE_LEVEL + 0.2 && kind.lake > 0.3) { /* lake margin: keep, thick */ }
    else if (kind.channel > 0.2 && roll > 0.5) continue
    else if (!still && kind.channel < 0.2 && roll > 0.22) continue
    R.floater.push(x, h, z, s, rot, seed, kind.lake > 0.3 ? 1 : 0, rf())
  }
  // ---- light shafts: where the canopy is thick, a few per clearing edge
  const rs = rng('shafts')
  for (let i = 0; i < 2600 * density; i++) {
    const x = rs.range(-lim, lim), z = rs.range(-lim, lim), w = rs.range(1.0, 3.2), seed = rs(), len = rs.range(16, 26)
    const k = COVER_N / (CORE * 2)
    const c = cover[Math.min(COVER_N - 1, Math.floor((z + CORE) * k)) * COVER_N + Math.min(COVER_N - 1, Math.floor((x + CORE) * k))]
    if (c < 0.55) continue
    const h = hf.at(x, z)
    if (h < 6) continue
    R.shaft.push(x, h - 0.5, z, w, 0, seed, len, 0)
  }
  progress(0.95)

  const fields = Object.fromEntries(FIELD_NAMES.map((n) => [n, R[n].finish()])) as Record<FieldName, FieldData>
  const cover8 = new Uint8Array(COVER_N * COVER_N)
  for (let i = 0; i < cover8.length; i++) cover8[i] = Math.min(255, cover[i] * 255)
  return { fields, cover: cover8, solids: new Float32Array(solids), treeCount, markedR }
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t) }
void noise2; void DRYBED
