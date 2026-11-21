// Placement by rule, in the worker: trees, crowns, palms and all small cover, as flat instance records
// (8 floats each: x, y, z, s, rot, seed, a, b) sorted by 50 m cell so the main thread can cull per cell.
import { rng, noise2, fbm2, seedInt } from './rng'
import { Heightfield, heightFormula, kind } from './terrain'
import { CHANNEL, DRYBED, TRAIL, YARDPATH, COMMUNITY, PLACES, CORE, distPoly, LAKE_LEVEL, polyAt } from './layout'

export const CELLS = 14, CELL_M = 50, CELL_ORIGIN = -350
export const cellOf = (x: number, z: number) => {
  const cx = Math.min(CELLS - 1, Math.max(0, Math.floor((x - CELL_ORIGIN) / CELL_M)))
  const cz = Math.min(CELLS - 1, Math.max(0, Math.floor((z - CELL_ORIGIN) / CELL_M)))
  return cz * CELLS + cx
}
export type FieldData = { data: Float32Array; cellStart: Uint32Array }
export const FIELD_NAMES = ['trunk', 'clump', 'spray', 'palm', 'sapling', 'broadleaf', 'tuft', 'log', 'root', 'vine', 'bankroot', 'floater', 'shaft', 'spFern', 'spFern2', 'spLeather', 'spPalm', 'spFan', 'spBanana', 'spEar', 'spTree', 'spDrift', 'limb'] as const
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

  // A limb: a tapering branch from a point, along a yaw and a pitch (angle from straight up). Returns its tip.
  const tip = { x: 0, y: 0, z: 0 }
  const limb = (x: number, y: number, z: number, rad: number, yaw: number, pitch: number, len: number, seed: number) => {
    R.limb.push(x, y, z, rad, yaw, seed, len, pitch)
    tip.x = x + Math.sin(pitch) * Math.cos(yaw) * len; tip.y = y + Math.cos(pitch) * len; tip.z = z + Math.sin(pitch) * Math.sin(yaw) * len
    return tip
  }
  const clump = (x: number, y: number, z: number, s: number, flat: number, tint: number) => R.clump.push(x, y, z, s, r() * 6.283, r(), flat, Math.min(1, Math.max(0, tint + r.range(-0.1, 0.1))))
  // Tree kinds, after the real forest: 0 emergent giant with spreading limbs and a broad flat crown; 1 canopy tree
  // forking into rising limbs; 2 mid tree; 3 pole; 4 treelet; 5 thin pale candelabra tree with big open leaf sprays;
  // 7 bare snag. Every kind has its own height, girth, bark tone, branching and leaf colour.
  const addTree = (x: number, z: number, type: number, forceLean = -1, leanDir = 0, scale = 1) => {
    const y = hf.at(x, z)
    const h = (type === 0 ? r.range(34, 46) : type === 1 ? r.range(19, 30) : type === 2 ? r.range(10, 18) : type === 3 ? r.range(6, 12) : type === 5 ? r.range(11, 20) : type === 7 ? r.range(9, 22) : r.range(2.8, 5.5)) * scale
    const rad = (type === 0 ? r.range(0.85, 1.4) : type === 1 ? r.range(0.24, 0.6) : type === 2 ? r.range(0.11, 0.28) : type === 3 ? r.range(0.05, 0.11) : type === 5 ? r.range(0.09, 0.16) : type === 7 ? r.range(0.15, 0.4) : r.range(0.03, 0.055)) * scale
    const lean = forceLean >= 0 ? forceLean : type === 5 ? r.range(0.03, 0.2) : r() * r() * 0.16
    const rot = forceLean >= 0 ? leanDir : r() * 6.283
    // bark tone by kind: giants and candelabra trees are pale, others run from dark to mid
    const seed = type === 0 ? r.range(0.8, 1) : type === 5 ? r.range(0.88, 1) : type === 7 ? r.range(0.5, 0.75) : r() * r() * 0.75
    R.trunk.push(x, y - 0.3, z, rad, rot, seed, h, lean)
    trees.push({ x, y, z, r: rad, h, type })
    if (rad > 0.13) solids.push(x, z, rad * (type === 0 ? 1.9 : 1.25))
    // point on the leaning trunk at a fraction of its height
    const at = (f: number) => { tip.x = x + Math.sin(rot) * lean * h * f * f; tip.y = y + h * f; tip.z = z + Math.cos(rot) * lean * h * f * f; return tip }
    const tint = type === 5 ? r.range(0.72, 0.95) : type === 0 ? r.range(0.25, 0.5) : fbm2(x / 90, z / 90, S + 5, 2) * 0.55 + r() * 0.45
    const a0 = r() * 6.283
    let crownR = 3
    if (type === 0) {
      // great limbs spread nearly level from the top of a bare trunk; flat crowns sit along and above them
      const n = 6 + r.int(3)
      crownR = r.range(11, 16)
      for (let i = 0; i < n; i++) {
        const f = r.range(0.78, 0.96), b = at(f), bx = b.x, by = b.y, bz = b.z
        const yaw = a0 + (i / n) * 6.283 + r.range(-0.3, 0.3), len = crownR * r.range(0.7, 1.05)
        const e = limb(bx, by, bz, rad * 0.42, yaw, r.range(1.0, 1.35), len, seed), ex = e.x, ey = e.y, ez = e.z
        clump((bx + ex) / 2, (by + ey) / 2 + 1.5, (bz + ez) / 2, r.range(4.5, 6.5), r.range(0.4, 0.55), tint)
        clump(ex, ey + 1, ez, r.range(5, 7.5), r.range(0.38, 0.5), tint)
        if (r() < 0.6) { const e2 = limb(ex, ey, ez, rad * 0.2, yaw + r.range(-0.8, 0.8), r.range(0.9, 1.3), len * 0.4, seed); clump(e2.x, e2.y + 0.8, e2.z, r.range(3.5, 5), 0.45, tint) }
      }
      const t = at(1); clump(t.x, t.y + 1, t.z, r.range(6, 8), 0.5, tint)
    } else if (type === 1 || type === 2) {
      // the trunk forks into rising limbs; leaf masses gather at their ends and fill the middle
      const n = type === 1 ? 3 + r.int(3) : 2 + r.int(2)
      const cs = type === 1 ? r.range(3.6, 5.6) : r.range(2.2, 3.4)
      crownR = cs * 1.7
      for (let i = 0; i < n; i++) {
        const f = r.range(0.5, 0.72), b = at(f), bx = b.x, by = b.y, bz = b.z
        const yaw = a0 + (i / n) * 6.283 + r.range(-0.4, 0.4), len = h * r.range(0.22, 0.4)
        const e = limb(bx, by, bz, rad * 0.5, yaw, r.range(0.45, 0.95), len, seed), ex = e.x, ey = e.y, ez = e.z
        clump(ex, ey + cs * 0.15, ez, cs * r.range(0.75, 1.1), r.range(0.6, 0.9), tint)
        if (type === 1 && r() < 0.7) { const e2 = limb(ex, ey, ez, rad * 0.25, yaw + r.range(-1, 1), r.range(0.5, 1.2), len * 0.5, seed); clump(e2.x, e2.y, e2.z, cs * r.range(0.6, 0.9), r.range(0.6, 0.85), tint) }
      }
      const t = at(0.98); clump(t.x, t.y, t.z, cs * 1.05, r.range(0.6, 0.85), tint)
      if (r() < 0.5) { const m = at(0.8); clump(m.x + r.range(-1.5, 1.5), m.y, m.z + r.range(-1.5, 1.5), cs * 0.9, 0.7, tint) }
    } else if (type === 5) {
      // a few bare, upward-curving branches, each ending in one big open spray of pale leaves
      const n = 3 + r.int(3)
      for (let i = 0; i < n; i++) {
        const f = r.range(0.62, 0.92), b = at(f), bx = b.x, by = b.y, bz = b.z
        const e = limb(bx, by, bz, rad * 0.55, a0 + (i / n) * 6.283 + r.range(-0.3, 0.3), r.range(0.6, 1.0), h * r.range(0.16, 0.28), seed)
        R.spray.push(e.x, e.y + 0.4, e.z, r.range(2.0, 3.0), r() * 6.283, r(), 1, tint)
      }
      const t = at(1); R.spray.push(t.x, t.y + 0.5, t.z, r.range(2.2, 3.2), r() * 6.283, r(), 1, tint)
      crownR = 3
    } else if (type === 7) {
      for (let i = 0; i < 3 + r.int(3); i++) { const b = at(r.range(0.55, 0.95)); limb(b.x, b.y, b.z, rad * 0.4, r() * 6.283, r.range(0.5, 1.2), h * r.range(0.12, 0.25), seed) }
      crownR = 0
    } else {
      const n = 1 + r.int(2), cs = type === 3 ? r.range(1.3, 2.1) : r.range(0.9, 1.6)
      for (let i = 0; i < n; i++) { const t = at(i === 0 ? 0.97 : r.range(0.75, 0.92)); R.spray.push(t.x + (i ? r.range(-0.8, 0.8) : 0), t.y, t.z + (i ? r.range(-0.8, 0.8) : 0), cs, r() * 6.283, r(), r.range(0.6, 0.95), tint) }
      crownR = 0
    }
    if (crownR > 2 && type !== 5) { const t = at(1); splat(t.x, t.z, crownR * 1.15, 0.85) }
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
      if (Math.hypot(x - PLACES.giantTrunk.x, z - PLACES.giantTrunk.z) < 17) continue
      const dens = 0.3 + 0.62 * smooth(0.3, 0.68, fbm2(x / 38, z / 38, S + 3, 3))
      if (roll > dens * density) continue
      const dc = distPoly(x, z, CHANNEL)
      const edge = dc < 34 || kind.bank > 0.1 || (kind.lake === 0 && Math.hypot((x - 186) / 66, (z + 138) / 50) < 1.28)
      if (edge && typeRoll < 0.5) {
        // edge trees lean out over the water, lower and fuller
        const e = 2
        const gxn = heightFormula(x + e, z) - heightFormula(x - e, z), gzn = heightFormula(x, z + e) - heightFormula(x, z - e)
        const dir = Math.atan2(-gxn, -gzn)
        addTree(x, z, typeRoll < 0.14 ? 1 : typeRoll < 0.32 ? 2 : 5, Math.hypot(gxn, gzn) > 0.15 ? r.range(0.12, 0.3) : r() * 0.1, dir, 0.9)
        continue
      }
      const type = typeRoll < 0.035 ? 0 : typeRoll < 0.3 ? 1 : typeRoll < 0.52 ? 2 : typeRoll < 0.72 ? 3 : typeRoll < 0.86 ? 4 : typeRoll < 0.985 ? 5 : 7
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
  let gx0 = 0, gz0 = 0
  for (let i = 0; i < 1500 * density; i++) {
    // palms stand in groves: every sixth one starts a new grove, the rest crowd round it
    if (i % 6 === 0) { gx0 = rp.range(-340, 340); gz0 = rp.range(-340, 340) }
    const x = gx0 + rp.range(-7, 7), z = gz0 + rp.range(-7, 7)
    if (fbm2(gx0 / 60, gz0 / 60, S + 71, 2) < 0.47) continue
    const h = heightFormula(x, z)
    if (h < 7.2 || kind.lake > 0.02 || kind.channel > 0.04 || kind.sand > 0.2 || kind.dry > 0.3 || kind.trail > 0.25) continue
    if (Math.min(distPoly(x, z, TRAIL), distPoly(x, z, YARDPATH)) < 4.5) continue
    if (Math.hypot(x - COMMUNITY.x, z - COMMUNITY.z) < 30 || Math.hypot(x - PLACES.giantTrunk.x, z - PLACES.giantTrunk.z) < 9) continue
    const ph = rp.range(7, 19), seed = rp.range(0.7, 0.95)
    R.trunk.push(x, h - 0.3, z, rp.range(0.1, 0.17), rp() * 6.283, seed, ph, rp.range(0.02, 0.24))
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
    if (roll > (0.06 + 0.55 * smooth(0.45, 0.7, n)) * density) continue
    const h = heightFormula(px, pz)
    if (h < 6.9 || kind.lake > 0.02 || kind.channel > 0.12 || kind.sand > 0.2 || kind.trail > 0.25 || kind.dry > 0.55) continue
    if (kind.high > 0.5 && n < 0.6) continue
    // most of the understory is now the scanned plants; a few of our own broad-leaf plants stay in the mix
    const pick = seed < 0.26 ? R.spFern : seed < 0.46 ? R.spFern2 : seed < 0.6 ? R.spLeather : seed < 0.7 ? R.spPalm : seed < 0.78 ? R.spFan : seed < 0.86 ? R.spBanana : seed < 0.93 ? R.spEar : R.broadleaf
    pick.push(px, h, pz, s, rot, seed, ru.range(0.8, 1.25), ru())
  }
  const ts = 1.0
  for (let z = -lim; z < lim; z += ts) for (let x = -lim; x < lim; x += ts) {
    const px = x + ru.range(0, ts), pz = z + ru.range(0, ts), roll = ru(), s = ru.range(0.6, 1.4), rot = ru() * 6.283, seed = ru()
    const n = fbm2(px / 9, pz / 9, S + 19, 2)
    if (roll > (0.05 + 0.3 * smooth(0.4, 0.7, n)) * density) continue
    const h = heightFormula(px, pz)
    if (h < 0.6 || kind.lake > 0.3 || kind.trail > 0.35) continue
    // on the bare banks and the beach only the odd tuft; none under the lowest water
    if ((kind.channel > 0.15 || kind.sand > 0.2 || kind.dry > 0.5) && roll > 0.05) continue
    R.tuft.push(px, h, pz, s, rot, seed, ru.range(0.8, 1.4), ru())
  }
  progress(0.82)

  // ---- fallen wood: scattered on the floor, and stranded in lines where the flood left it (bank tops, dry bed edges)
  const rl = rng('logs')
  for (let i = 0; i < 6500 * density; i++) {
    const x = rl.range(-lim, lim), z = rl.range(-lim, lim), len = rl.range(1.2, 6) * (rl() < 0.12 ? 2 : 1), rad = rl.range(0.07, 0.28), rot = rl() * 6.283, seed = rl(), roll = rl()
    const h = heightFormula(x, z)
    if (kind.lake > 0.2 || kind.trail > 0.3 || h < 0.3) continue
    const strand = kind.bank > 0.2 || (kind.dry > 0.15 && kind.dry < 0.7) || kind.sand > 0.3
    if (!strand && roll > 0.3) continue
    if (kind.channel > 0.12 && roll > 0.12) continue
    if (strand && seed > 0.45) R.spDrift.push(x, h - 0.03, z, rl.range(2.2, 5.5), rot, seed, 1, rl())
    else if (seed < 0.14 && len > 2.5) R.spTree.push(x, h - 0.05, z, len / 1.77, rot, seed, 1, rl())
    else R.log.push(x, h + rad * 0.5, z, len, rot, seed, rad, 0)
  }
  // ---- hanging roots and fallen trunks along the top of the channel banks, both sides, all the way up
  const rb = rng('bankroots')
  const cp = { x: 0, z: 0 }
  for (let i = 0; i < 5200 * density; i++) {
    const t = rb.range(0.12, 0.98), sgn = rb() < 0.5 ? -1 : 1, off = rb.range(13, 26), len = rb.range(1.5, 5.5), seed = rb(), w = rb.range(0.6, 1.4), roll = rb()
    polyAt(CHANNEL, t, cp); const ax = cp.x, az = cp.z
    polyAt(CHANNEL, t + 0.003, cp)
    const dx = cp.x - ax, dz = cp.z - az, dl = Math.hypot(dx, dz) || 1
    const x = ax + (-dz / dl) * off * sgn, z = az + (dx / dl) * off * sgn
    const h = heightFormula(x, z)
    if (kind.channel < 0.01 || kind.channel > 0.5 || h < 5.5) continue
    const e = 1.5
    const gxn = heightFormula(x + e, z) - heightFormula(x - e, z), gzn = heightFormula(x, z + e) - heightFormula(x, z - e)
    if (roll < 0.06) R.spTree.push(x, h - 0.2, z, rb.range(2, 3.6), Math.atan2(-gzn, -gxn), seed, 1, rb())
    else R.bankroot.push(x, h + 0.25, z, w, Math.atan2(-gxn, -gzn), seed, len, 0)
  }
  // ---- the green wall: low dense shrubs along the top of the banks and round the lake, down to the edge
  const rw = rng('edge-shrubs')
  for (let i = 0; i < 26000 * density; i++) {
    const x = rw.range(-lim, lim), z = rw.range(-lim, 262), sz = rw.range(1.6, 3.6), fl = rw.range(0.55, 0.9), tn = rw.range(0.35, 0.95)
    const h = heightFormula(x, z)
    const lakeEdge = kind.lake > 0.0 && kind.lake < 0.5 && h > LAKE_LEVEL + 0.3
    const bankTop = kind.channel > 0.0 && kind.channel < 0.1 && h > 7
    const riverEdge = kind.bank > 0.25 && h > 5.5 && kind.channel < 0.01
    if (!(lakeEdge || bankTop || riverEdge) || kind.trail > 0.2 || kind.sand > 0.3) continue
    if (Math.hypot(x - PLACES.stepsTop.x, z - PLACES.stepsTop.z) < 7 || Math.hypot(x - PLACES.lakeBank.x, z - PLACES.lakeBank.z) < 9) continue
    R.clump.push(x, h + sz * 0.35, z, sz, rw() * 6.283, rw(), fl, tn)
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
  for (let i = 0; i < 1100 * density; i++) {
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
