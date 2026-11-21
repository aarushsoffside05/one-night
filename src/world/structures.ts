// Buildings and things, assembled by rule from the kit: the house on legs, the bank steps and landing,
// the floating house on its raft of logs, the aerial, the marked tree's ring, the giant trunk.
// Two merged meshes (fixed, floating) plus the giant trunk and three ropes: a handful of draws.
import * as THREE from 'three/webgpu'
import { Fn, attribute, positionWorld, float } from './tsl'
import { Kit, SURF, kitMaterial } from './kit'
import { GB } from './geom'
import { PaintedMaterial } from './shade'
import { barkColor } from './forest'
import { Heightfield } from './terrain'
import { PLACES, HOUSE_FLOOR_Y, WATER_RANGE } from './layout'
import { addPlatform, addBlocker } from './platforms'
import { rng } from './rng'
import { U } from './uniforms'

const WOOD = [0.42, 0.3, 0.19], WOOD_D = [0.3, 0.21, 0.13], WOOD_L = [0.55, 0.43, 0.29], GREY = [0.46, 0.43, 0.38]
const TEAL = [0.2, 0.4, 0.42], TRIM = [0.74, 0.7, 0.6], ROOF = [0.5, 0.2, 0.13], THATCH = [0.5, 0.4, 0.22], ROPE = [0.5, 0.43, 0.3]
const DARK = [0.05, 0.045, 0.04], GLASS = [1.0, 0.72, 0.36]

export type Structures = {
  lamps: { x: number; y: number; z: number; floats: boolean }[]
  raft: { x: number; z: number; rot: number; deckY: number }
  update(waterY: number): void
  solids: number[]
}

export function buildStructures(hf: Heightfield, group: THREE.Object3D, markedTreeR: number): Structures {
  const K = new Kit(), F = new Kit()
  const r = rng('structures')
  const solids: number[] = []
  const lamps: Structures['lamps'] = []

  // ---------- the house on legs
  {
    const H = PLACES.stiltHouse, g = hf.at(H.x, H.z), fy = HOUSE_FLOOR_Y - g
    K.at(H.x, g, H.z, H.rot)
    const W = 7.2, D = 4.6, V = 1.7, wallH = 2.3
    // legs: every post goes from under the ground to the floor; corner posts carry on to the eaves
    for (let ix = 0; ix <= 3; ix++) for (let iz = 0; iz <= 2; iz++) {
      const x = -W / 2 + (ix / 3) * W, z = -D / 2 + (iz / 2) * D
      K.cyl(x, -0.8, z, x, fy, z, 0.13, 0.11, WOOD_D, SURF.plain)
      solidLocal(K, solids, x, z, 0.2)
    }
    for (let ix = 0; ix <= 3; ix++) { const x = -W / 2 + (ix / 3) * W; K.cyl(x, -0.8, D / 2 + V, x, fy, D / 2 + V, 0.11, 0.1, WOOD_D, SURF.plain); solidLocal(K, solids, x, D / 2 + V, 0.18) }
    // cross braces under the floor
    K.cyl(-W / 2, 0.3, -D / 2, -W / 2 + W / 3, fy - 0.2, -D / 2, 0.05, 0.05, WOOD, SURF.plain, 5)
    K.cyl(W / 2, 0.3, -D / 2, W / 2 - W / 3, fy - 0.2, -D / 2, 0.05, 0.05, WOOD, SURF.plain, 5)
    K.cyl(-W / 2, 0.3, D / 2 + V, -W / 2, fy - 0.2, D / 2, 0.05, 0.05, WOOD, SURF.plain, 5)
    // floor beams and the floor itself (house + plank walk in front)
    for (let i = 0; i <= 3; i++) K.box(-W / 2 + (i / 3) * W, fy - 0.12, V / 2, 0.12, 0.16, D + V + 0.3, WOOD_D)
    K.box(0, fy, V / 2, W + 0.5, 0.07, D + V + 0.2, WOOD_L)
    // walls: planks, a dark doorway and two shuttered windows on the front
    const wy = fy + 0.035 + wallH / 2
    K.box(0, wy, -D / 2, W, wallH, 0.08, TEAL)
    K.box(-W / 2, wy, 0, 0.08, wallH, D, TEAL)
    K.box(W / 2, wy, 0, 0.08, wallH, D, TEAL)
    K.box(0, wy, D / 2, W, wallH, 0.08, TEAL)
    K.box(-0.6, fy + 1.0, D / 2 + 0.05, 0.9, 1.95, 0.05, DARK, SURF.plain)
    K.box(-0.6, fy + 2.02, D / 2 + 0.06, 1.06, 0.08, 0.06, TRIM)
    for (const wx of [1.6, -2.6]) {
      K.box(wx, fy + 1.35, D / 2 + 0.05, 0.85, 0.8, 0.05, DARK, SURF.plain)
      K.box(wx - 0.62, fy + 1.35, D / 2 + 0.07, 0.4, 0.84, 0.04, TRIM)
      K.box(wx, fy + 0.92, D / 2 + 0.08, 1.0, 0.06, 0.1, TRIM)
    }
    // gable roof of corrugated sheet, wide eaves over the plank walk
    const ridgeY = fy + wallH + 1.25, half = D / 2 + 0.7, slope = Math.atan2(1.25, half), len = Math.hypot(1.25, half) + 0.5
    K.at(0, ridgeY, 0, 0, slope).box(0, -0.02, len / 2, W + 1.3, 0.05, len, ROOF, SURF.metal).pop()
    K.at(0, ridgeY, 0, 0, -slope).box(0, -0.02, -len / 2, W + 1.3, 0.05, len, ROOF, SURF.metal).pop()
    // lean-to roof over the walk
    K.at(0, fy + wallH + 0.25, D / 2 + 0.55, 0, 0.3).box(0, 0, V / 2 + 0.2, W + 1.0, 0.05, V + 0.7, ROOF, SURF.metal).pop()
    // gable ends
    for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) { const t = (k + 0.5) / 5; K.box(sx * W / 2, fy + wallH + 0.04 + t * 1.2 - 0.12, 0, 0.07, 0.25, D * (1 - t), TEAL) }
    // rail round the walk
    const rz = D / 2 + V
    for (let i = 0; i <= 6; i++) { const x = -W / 2 + (i / 6) * W; if (i === 5) continue; K.cyl(x, fy, rz, x, fy + 0.95, rz, 0.04, 0.04, WOOD, SURF.plain, 5) }
    K.box(-W / 2 + (W * 4.5) / 12 - 0.3, fy + 0.95, rz, (W * 4.5) / 6, 0.06, 0.08, WOOD_L)
    K.box(W / 2 - 0.02, fy + 0.95, rz - V / 2, 0.08, 0.06, V, WOOD_L)
    K.box(-W / 2 + 0.02, fy + 0.95, rz - V / 2, 0.08, 0.06, V, WOOD_L)
    // steps from the yard up to the walk (between rail posts 4 and 6)
    const sx0 = -W / 2 + (5 / 6) * W - 0.05, run = fy * 1.25
    for (let i = 0; i < 12; i++) { const t = (i + 0.5) / 12; K.box(sx0, fy * (1 - t), rz + 0.15 + t * run, 1.05, 0.05, 0.27, WOOD_L) }
    for (const s of [-0.56, 0.56]) K.cyl(sx0 + s, fy, rz + 0.1, sx0 + s, 0.0, rz + 0.2 + run, 0.06, 0.06, WOOD_D, SURF.plain, 5)
    // lamp hanging under the eave by the door
    K.cyl(0.6, fy + 2.35, D / 2 + 0.9, 0.6, fy + 2.0, D / 2 + 0.9, 0.012, 0.012, DARK, SURF.plain, 4)
    K.box(0.6, fy + 1.9, D / 2 + 0.9, 0.16, 0.22, 0.16, GLASS, SURF.glass)
    lamps.push(worldOf(K, 0.6, fy + 1.9, D / 2 + 0.9, false))
    // a bench, a water barrel, a basin on the walk
    K.box(2.6, fy + 0.42, D / 2 + 0.35, 1.5, 0.06, 0.34, WOOD_L); K.box(2.0, fy + 0.2, D / 2 + 0.35, 0.06, 0.4, 0.3, WOOD); K.box(3.2, fy + 0.2, D / 2 + 0.35, 0.06, 0.4, 0.3, WOOD)
    K.cyl(-3.0, fy + 0.03, D / 2 + 0.6, -3.0, fy + 0.85, D / 2 + 0.6, 0.3, 0.32, [0.2, 0.3, 0.5], SURF.plain, 10)
    // walkable: the floor walk, the stairs; the house body blocks
    platLocal(K, 'house walk', 0, V / 2 + D / 2 - 0.02, W / 2 + 0.2, V / 2 + 0.05, 0, HOUSE_FLOOR_Y + 0.04)
    const c = Math.cos(H.rot), s = Math.sin(H.rot)
    const stx = sx0, stz = rz + 0.1 + run / 2
    addPlatform('house steps', H.x + stx * c + stz * s, H.z - stx * s + stz * c, run / 2 + 0.15, 0.6, -H.rot + Math.PI / 2, HOUSE_FLOOR_Y + 0.04, g + 0.02)
    blockLocal(K, 0, 0, W / 2 + 0.05, D / 2 + 0.05, HOUSE_FLOOR_Y - 0.3, HOUSE_FLOOR_Y + 3)
    K.pop()
  }

  // ---------- the bank steps and the landing
  {
    const A = PLACES.stepsTop, B = PLACES.landing
    const ya = hf.at(A.x, A.z) + 0.05, yb = 0.5
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz), rot = Math.atan2(dz, dx)
    const n = Math.round(Math.hypot(len, ya - yb) / 0.42)
    const px = -dz / len, pz = dx / len
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = A.x + dx * t, z = A.z + dz * t, y = ya + (yb - ya) * t
      K.at(x, y, z, -rot).box(0, 0, 0, 0.3, 0.05, 1.5, i % 7 === 3 ? WOOD : WOOD_L).pop()
      if (i % 5 === 0) {
        // posts down to the bank, and a rail post on the downstream side
        for (const sgn of [-1, 1]) { const qx = x + px * 0.7 * sgn, qz = z + pz * 0.7 * sgn; K.cyl(qx, Math.min(hf.at(qx, qz), y) - 0.8, qz, qx, y + (sgn > 0 ? 1.0 : 0), qz, 0.07, 0.06, WOOD_D, SURF.plain, 6) }
      }
    }
    for (const sgn of [-1, 1]) K.cyl(A.x + px * 0.7 * sgn, ya - 0.08, A.z + pz * 0.7 * sgn, B.x + px * 0.7 * sgn, yb - 0.08, B.z + pz * 0.7 * sgn, 0.07, 0.07, WOOD_D, SURF.plain, 6)
    K.cyl(A.x + px * 0.7, ya + 1.0, A.z + pz * 0.7, B.x + px * 0.7, yb + 1.0, B.z + pz * 0.7, 0.035, 0.035, WOOD, SURF.plain, 5)
    addPlatform('bank steps', (A.x + B.x) / 2, (A.z + B.z) / 2, len / 2 + 0.2, 0.85, rot, ya, yb)
    // the landing: a small stage on posts at the foot
    const lx = B.x + (dx / len) * 1.6, lz = B.z + (dz / len) * 1.6
    K.at(lx, yb, lz, -rot)
    K.box(0, -0.04, 0, 3.4, 0.07, 2.6, WOOD_L)
    for (const [qx, qz] of [[-1.5, -1.1], [1.5, -1.1], [-1.5, 1.1], [1.5, 1.1]]) K.cyl(qx, -3.5, qz, qx, 0.5, qz, 0.09, 0.08, WOOD_D, SURF.plain, 6)
    K.pop()
    addPlatform('landing', lx, lz, 1.7, 1.3, rot, yb, yb)
  }

  // ---------- the aerial pole on the knoll, with guy wires and a wire to the house
  {
    const P = PLACES.aerial, g = hf.at(P.x, P.z)
    K.cyl(P.x, g - 0.5, P.z, P.x, g + 11, P.z, 0.08, 0.05, GREY, SURF.plain, 6)
    K.cyl(P.x, g + 11, P.z, P.x, g + 13.2, P.z, 0.015, 0.01, DARK, SURF.plain, 4)
    for (let i = 0; i < 4; i++) K.cyl(P.x - 0.55, g + 9.4 + i * 0.4, P.z, P.x + 0.55, g + 9.4 + i * 0.4, P.z, 0.012, 0.012, DARK, SURF.plain, 4)
    for (let i = 0; i < 3; i++) { const a = i * 2.09 + 0.4; K.cyl(P.x, g + 8.5, P.z, P.x + Math.cos(a) * 5, hf.at(P.x + Math.cos(a) * 5, P.z + Math.sin(a) * 5), P.z + Math.sin(a) * 5, 0.012, 0.012, DARK, SURF.plain, 3, false) }
    const H = PLACES.stiltHouse
    K.cyl(P.x, g + 9, P.z, H.x + 2, HOUSE_FLOOR_Y + 3.3, H.z + 0.5, 0.01, 0.01, DARK, SURF.plain, 3, false)
    solids.push(P.x, P.z, 0.2)
  }

  // ---------- the marked tree: a painted ring at last year's water
  {
    const M = PLACES.markedTree
    K.cyl(M.x, WATER_RANGE - 0.06, M.z, M.x, WATER_RANGE + 0.06, M.z, markedTreeR * 1.12 + 0.03, markedTreeR * 1.1 + 0.03, [0.86, 0.84, 0.76], SURF.plain, 12, false)
    K.cyl(M.x, WATER_RANGE - 1.2, M.z + markedTreeR + 0.06, M.x, WATER_RANGE - 0.1, M.z + markedTreeR + 0.04, 0.012, 0.012, [0.86, 0.84, 0.76], SURF.plain, 4, false)
  }

  // ---------- the floating house on its raft of logs (local y = 0 is the waterline)
  const R = PLACES.floatHouse
  const DECK = 0.36
  {
    F.at(R.x, 0, R.z, R.rot)
    const L = 10.5, Wd = 7.6
    for (let i = 0; i < 9; i++) { const z = -Wd / 2 + 0.45 + (i / 8) * (Wd - 0.9); F.cyl(-L / 2 + r.range(-0.4, 0.2), -0.02, z, L / 2 + r.range(-0.2, 0.5), 0.0, z, r.range(0.3, 0.38), r.range(0.26, 0.34), [0.33, 0.27, 0.2], SURF.plain, 9) }
    for (const x of [-3.8, 0, 3.8]) F.box(x, 0.26, 0, 0.18, 0.12, Wd, WOOD_D)
    F.box(0, DECK - 0.035, 0, L - 0.4, 0.07, Wd, WOOD_L)
    // the house: smaller than the deck, set to one end
    const hx = -1.9, hw = 5.4, hd = 4.0, wh = 2.1
    for (const [cx, cz, sx, sz] of [[hx, -hd / 2, hw, 0.07], [hx, hd / 2, hw, 0.07], [hx - hw / 2, 0, 0.07, hd], [hx + hw / 2, 0, 0.07, hd]]) F.box(cx, DECK + wh / 2, cz, sx, wh, sz, WOOD)
    F.box(hx + hw / 2 + 0.04, DECK + 0.95, 0.6, 0.05, 1.9, 0.85, DARK, SURF.plain)
    F.box(hx, DECK + 1.3, hd / 2 + 0.04, 0.9, 0.7, 0.05, DARK, SURF.plain)
    for (const [cx, cz] of [[hx - hw / 2, -hd / 2], [hx + hw / 2, -hd / 2], [hx - hw / 2, hd / 2], [hx + hw / 2, hd / 2]]) F.cyl(cx, DECK, cz, cx, DECK + wh + 0.1, cz, 0.08, 0.07, WOOD_D, SURF.plain, 6)
    const half = hd / 2 + 0.9, rise = 1.5, slope = Math.atan2(rise, half), len = Math.hypot(rise, half) + 0.3
    F.at(hx, DECK + wh + rise, 0, 0, slope).box(0, -0.06, len / 2, hw + 1.6, 0.16, len, THATCH, SURF.thatch).pop()
    F.at(hx, DECK + wh + rise, 0, 0, -slope).box(0, -0.06, -len / 2, hw + 1.6, 0.16, len, THATCH, SURF.thatch).pop()
    F.cyl(hx - hw / 2 - 0.8, DECK + wh + rise + 0.06, 0, hx + hw / 2 + 0.8, DECK + wh + rise + 0.06, 0, 0.1, 0.1, THATCH.map((q) => q * 0.8), SURF.thatch, 6)
    // the fish table on the open deck, a basin, crates, a coil of rope
    const tx = 2.9, tz = -1.2
    F.box(tx, DECK + 0.82, tz, 1.9, 0.06, 0.8, WOOD_L)
    for (const [qx, qz] of [[-0.85, -0.32], [0.85, -0.32], [-0.85, 0.32], [0.85, 0.32]]) F.cyl(tx + qx, DECK, tz + qz, tx + qx, DECK + 0.8, tz + qz, 0.04, 0.04, WOOD_D, SURF.plain, 5)
    F.cyl(tx + 0.5, DECK + 0.86, tz, tx + 0.5, DECK + 0.98, tz, 0.26, 0.3, [0.55, 0.56, 0.58], SURF.plain, 10)
    F.box(4.2, DECK + 0.2, 2.4, 0.7, 0.4, 0.5, WOOD); F.box(4.1, DECK + 0.55, 2.35, 0.55, 0.3, 0.45, WOOD_D)
    F.cyl(1.2, DECK + 0.04, 2.9, 1.2, DECK + 0.14, 2.9, 0.32, 0.3, ROPE, SURF.plain, 9)
    // the one lamp: on a post at the table
    const lx = tx - 1.3, lz = tz - 0.5
    F.cyl(lx, DECK, lz, lx, DECK + 2.05, lz, 0.05, 0.04, WOOD_D, SURF.plain, 5)
    F.cyl(lx, DECK + 2.0, lz, lx + 0.45, DECK + 2.0, lz, 0.025, 0.025, WOOD_D, SURF.plain, 4)
    F.box(lx + 0.45, DECK + 1.82, lz, 0.17, 0.24, 0.17, GLASS, SURF.glass)
    F.box(lx + 0.45, DECK + 1.96, lz, 0.2, 0.04, 0.2, DARK, SURF.plain)
    lamps.push(worldOf(F, lx + 0.45, DECK + 1.82, lz, true))
    // mooring posts at the corners
    for (const [qx, qz] of [[-L / 2 + 0.5, -Wd / 2 + 0.4], [L / 2 - 0.5, -Wd / 2 + 0.4], [-L / 2 + 0.5, Wd / 2 - 0.4], [L / 2 - 0.5, Wd / 2 - 0.4]]) F.cyl(qx, DECK, qz, qx, DECK + 0.55, qz, 0.07, 0.06, WOOD_D, SURF.plain, 6)
    platLocal(F, 'raft deck', 0, 0, L / 2 - 0.25, Wd / 2 - 0.05, 0, DECK, true)
    blockLocal(F, hx, 0, hw / 2 + 0.05, hd / 2 + 0.05, DECK - 0.2, DECK + 3, true)
    blockLocal(F, tx, tz, 0.95, 0.4, DECK - 0.2, DECK + 1, true)
    F.pop()
  }

  const km = kitMaterial(false), fm = kitMaterial(true)
  const fixed = new THREE.Mesh(K.build(), km)
  fixed.castShadow = true; fixed.receiveShadow = true
  const floating = new THREE.Mesh(F.build(), fm)
  floating.castShadow = true; floating.receiveShadow = true; floating.frustumCulled = false
  group.add(fixed, floating)

  // ---------- ropes from the raft to trees on the bank: rebuilt only when the water moves
  const cR = Math.cos(R.rot), sR = Math.sin(R.rot)
  const ties = [[-4.7, -3.3, R.x + 14, R.z - 9], [4.7, -3.3, R.x + 13, R.z + 12], [4.7, 3.3, R.x - 4, R.z + 22]].map(([lx, lz, tx, tz]) => ({ ax: R.x + lx * cR + lz * sR, az: R.z - lx * sR + lz * cR, tx, tz, ty: hf.at(tx, tz) + 2.2 }))
  const SEG = 10
  const ropeGeo = new THREE.BufferGeometry()
  const rp = new Float32Array(ties.length * (SEG + 1) * 3 * 3), rn = new Float32Array(rp.length), rc = new Float32Array(rp.length), ra = new Float32Array(rp.length)
  const ri: number[] = []
  ties.forEach((_, k) => { for (let j = 0; j < SEG; j++) for (let i = 0; i < 3; i++) { const a = k * (SEG + 1) * 3 + j * 3 + i, b = k * (SEG + 1) * 3 + j * 3 + ((i + 1) % 3); ri.push(a, a + 3, b + 3, a, b + 3, b) } })
  for (let i = 0; i < rc.length; i += 3) { rc[i] = ROPE[0]; rc[i + 1] = ROPE[1]; rc[i + 2] = ROPE[2]; ra[i + 2] = SURF.plain }
  ropeGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3)); ropeGeo.setAttribute('normal', new THREE.BufferAttribute(rn, 3))
  ropeGeo.setAttribute('color', new THREE.BufferAttribute(rc, 3)); ropeGeo.setAttribute('aux', new THREE.BufferAttribute(ra, 3)); ropeGeo.setIndex(ri)
  const ropes = new THREE.Mesh(ropeGeo, km)
  ropes.frustumCulled = false
  group.add(ropes)
  let lastWater = -99
  const updateRopes = (wy: number) => {
    if (Math.abs(wy - lastWater) < 0.004) return
    lastWater = wy
    let o = 0
    for (const t of ties) {
      const ay = wy + DECK + 0.45
      const slack = Math.max(0.3, Math.min(2.5, (Math.hypot(t.tx - t.ax, t.tz - t.az, t.ty - ay)) * 0.08))
      for (let j = 0; j <= SEG; j++) {
        const u = j / SEG
        const x = t.ax + (t.tx - t.ax) * u, z = t.az + (t.tz - t.az) * u, y = ay + (t.ty - ay) * u - Math.sin(u * Math.PI) * slack
        for (let i = 0; i < 3; i++) {
          const th = (i / 3) * 6.283
          rp[o] = x + Math.cos(th) * 0.022; rp[o + 1] = y + Math.sin(th) * 0.022; rp[o + 2] = z
          rn[o] = Math.cos(th); rn[o + 1] = Math.sin(th); rn[o + 2] = 0
          o += 3
        }
      }
    }
    ropeGeo.attributes.position.needsUpdate = true; ropeGeo.attributes.normal.needsUpdate = true
  }
  updateRopes(0)

  // ---------- the giant trunk: wider than a house, roots like walls
  {
    const T = PLACES.giantTrunk, gy = hf.at(T.x, T.z) - 0.6
    const g = new GB()
    const sides = 56, rings = 22, Hh = 46
    const fins = 7
    for (let j = 0; j <= rings; j++) {
      const v = Math.pow(j / rings, 2.1), y = v * Hh
      const R0 = 2.5 - 1.0 * v
      const flare = Math.exp(-y / 2.6)
      for (let i = 0; i < sides; i++) {
        const th = (i / sides) * Math.PI * 2
        const fin = Math.pow(0.5 + 0.5 * Math.cos(th * fins + Math.sin(th * 2) * 0.8), 5)
        const rr = R0 * (1 + 0.06 * Math.sin(th * 13 + y * 0.3)) + flare * (0.9 + 5.2 * fin)
        g.v(Math.cos(th) * rr, y, Math.sin(th) * rr, Math.cos(th), flare * 0.5, Math.sin(th), 0, v, 0)
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) { const a = j * sides + i, b = j * sides + ((i + 1) % sides); g.quad(a, a + sides, b + sides, b) }
    // great limbs
    for (let k = 0; k < 5; k++) {
      const a = k * 1.256 + 0.3, y0 = 30 + k * 2.2
      const pts: [number, number, number][] = [], rad: number[] = []
      for (let s2 = 0; s2 <= 4; s2++) { const t = s2 / 4; pts.push([Math.cos(a) * (1 + 13 * t), y0 + 7 * Math.pow(t, 0.7), Math.sin(a) * (1 + 13 * t)]); rad.push(0.8 - 0.55 * t) }
      g.tube(pts, rad, 7)
    }
    const geo = g.build()
    geo.computeVertexNormals()
    const m = new PaintedMaterial({ wrap: 0.3 })
    m.colorNode = Fn(() => barkColor(float(0.42), float(gy)))()
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(T.x, gy, T.z)
    mesh.castShadow = true; mesh.receiveShadow = true
    group.add(mesh)
    solids.push(T.x, T.z, 3.3)
    for (let i = 0; i < fins; i++) { const th = (i / fins) * Math.PI * 2; for (const d of [4.2, 5.6]) solids.push(T.x + Math.cos(th) * d, T.z + Math.sin(th) * d, 0.8) }
  }
  void attribute; void positionWorld; void U

  return {
    lamps, solids, raft: { x: R.x, z: R.z, rot: R.rot, deckY: DECK },
    update(wy) { updateRopes(wy) },
  }
}

// helpers: local (kit matrix) -> world for platforms, blockers, solids and lamps
const tv = new THREE.Vector3()
function worldOf(K: Kit, x: number, y: number, z: number, floats: boolean) { tv.set(x, y, z).applyMatrix4(K.m); return { x: tv.x, y: tv.y, z: tv.z, floats } }
function rotOf(K: Kit) { const e = K.m.elements; return Math.atan2(e[2], e[0]) } // angle such that local x -> (cos, sin) in xz... see below
function platLocal(K: Kit, name: string, x: number, z: number, hx: number, hz: number, _r: number, y: number, floats = false) {
  tv.set(x, 0, z).applyMatrix4(K.m)
  addPlatform(name, tv.x, tv.z, hx, hz, -rotOf(K) * -1, y, y, floats)
}
function blockLocal(K: Kit, x: number, z: number, hx: number, hz: number, y0: number, y1: number, floats = false) {
  tv.set(x, 0, z).applyMatrix4(K.m)
  addBlocker(tv.x, tv.z, hx, hz, rotOf(K), y0, y1, floats)
}
function solidLocal(K: Kit, solids: number[], x: number, z: number, r: number) { tv.set(x, 0, z).applyMatrix4(K.m); solids.push(tv.x, tv.z, r) }
