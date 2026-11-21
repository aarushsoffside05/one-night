// The forest's materials and its instanced fields. All TSL node materials on the shared painted lighting.
import * as THREE from 'three/webgpu'
import { Fn, attribute, positionLocal, positionWorld, normalLocal, vec2, vec3, float, mix, smoothstep, sin, cos, max, exp, abs } from './tsl'
import { U } from './uniforms'
import { PaintedMaterial, noise } from './shade'
import { Field } from './instanced'
import type { ForestCook, FieldName } from './forestCook'
import * as G from './geom'
import { WATER_RANGE } from './layout'
import { detailUpright, PLANT_TEX } from './scans'
import { texture, uv } from './tsl'
import scansUrl from '../assets/models/scans.glb?inline'
import { b64ToBytes, parseGlb } from './glb'

type N = any
const ia: N = attribute('ia', 'vec4'), ib: N = attribute('ib', 'vec4'), aux: N = attribute('aux', 'vec3')
// rotate about Y so local +x points along (cos a, sin a)
const rotX = (p: N, a: N) => vec3(p.x.mul(cos(a)).sub(p.z.mul(sin(a))), p.y, p.x.mul(sin(a)).add(p.z.mul(cos(a))))
// rotate about Y so local +z points along (sin a, cos a)
const rotZ = (p: N, a: N) => vec3(p.x.mul(cos(a)).add(p.z.mul(sin(a))), p.y, p.z.mul(cos(a)).sub(p.x.mul(sin(a))))
const eyeDist = () => ia.xz.sub(U.eye.xz).length()
// things at their draw limit shrink away instead of popping
const shrink = (far: number) => smoothstep(float(far).mul(U.detail), float(far * 0.8).mul(U.detail), eyeDist())

// the flood mark every trunk keeps: silt-stained below last year's water, a dark line at its top
const FLOOD_Y = WATER_RANGE
export const floodStain = (col: N, wobble: N) => {
  const fl = positionWorld.y.sub(float(FLOOD_Y).add(wobble.sub(0.5).mul(0.3)))
  // below the line the bark is washed pale with silt; at the line a dark band about a hand's width
  const below = smoothstep(0.05, -0.25, fl)
  const band = smoothstep(0.22, 0.06, fl).mul(smoothstep(-0.6, -0.25, fl))
  const pale = mix(col, col.mul(0.45).add(vec3(0.3, 0.26, 0.2)), below.mul(0.75))
  const wet = smoothstep(0.7, 0.0, positionWorld.y.sub(U.water))
  return mix(pale, vec3(0.05, 0.035, 0.025), band.mul(0.9)).mul(mix(float(1), float(0.5), wet))
}
export const barkColor = (seed: N, groundY: N) => {
  const pw = positionWorld
  const streak = noise(vec2(pw.x.add(pw.z).mul(0.5), pw.y.mul(0.05))).a
  const blot = noise(vec2(pw.x.sub(pw.z).mul(0.13), pw.y.mul(0.12))).r
  const fine = noise(vec2(pw.x.add(pw.z).mul(1.9), pw.y.mul(0.5))).b
  let col: N = mix(vec3(0.1, 0.07, 0.05), vec3(0.3, 0.24, 0.17), seed)
  // relief: the bark's ridges catch the light on one side (a cheap emboss of the same strokes)
  const streak2 = noise(vec2(pw.x.add(pw.z).mul(0.5).add(0.012), pw.y.mul(0.05).add(0.004))).a
  const ridge = streak.sub(streak2).mul(9).clamp(-0.5, 0.6)
  col = col.mul(streak.mul(0.7).add(0.55)).mul(fine.mul(0.3).add(0.85)).mul(ridge.add(1))
  // real bark from the scans: ridged kapok on some trunks, ropey banyan on others
  col = col.mul(mix(detailUpright('kapok', 0.42, 0.9), detailUpright('banyan', 0.36, 0.9), smoothstep(0.45, 0.55, seed)))
  // pale lichen blotches and green moss near the foot
  col = mix(col, vec3(0.58, 0.58, 0.5), smoothstep(0.62, 0.78, blot).mul(0.45))
  const moss = smoothstep(0.45, 0.7, noise(pw.xz.mul(0.21).add(pw.y.mul(0.13))).g).mul(smoothstep(5.5, 0.5, pw.y.sub(groundY)))
  col = mix(col, vec3(0.1, 0.19, 0.04), moss.mul(0.7))
  col = mix(col, vec3(0.1, 0.17, 0.04), smoothstep(0.5, 0.75, noise(pw.xz.mul(0.33).sub(pw.y.mul(0.09))).r).mul(0.45))
  return floodStain(col, blot)
}

function trunkMaterial(far: number) {
  const m = new PaintedMaterial({ wrap: 0.3 })
  m.positionNode = Fn(() => {
    const rad = ia.w, h = ib.z, lean = ib.w, rot = ib.x
    const butt = smoothstep(0.2, 0.9, rad).mul(1.9).add(0.3)
    const rr = mix(rad.mul(aux.x.mul(butt).add(1)), rad, aux.z)
    const p = rotX(vec3(positionLocal.x.mul(rr), positionLocal.y.mul(h), positionLocal.z.mul(rr)), rot)
    // lean towards rot, plus a slow S-bend so no two trunks stand alike
    const wob = sin(aux.y.mul(4.2).add(ib.y.mul(40))).mul(aux.y).mul(rad).mul(1.6)
    const bend = vec3(sin(rot), 0, cos(rot)).mul(lean.mul(h).mul(aux.y.mul(aux.y))).add(vec3(cos(ib.y.mul(90)), 0, sin(ib.y.mul(90))).mul(wob))
    normalLocal.assign(rotX(normalLocal, rot))
    return p.add(bend).mul(shrink(far)).add(ia.xyz)
  })()
  m.colorNode = Fn(() => barkColor(ib.y, ia.y))()
  return m
}

function clumpMaterial(far: number) {
  const m = new PaintedMaterial({ wrap: 0.22, back: 0.16, pools: false })
  m.side = THREE.DoubleSide
  m.positionNode = Fn(() => {
    const sx = ia.w, rot = ib.x, seed = ib.y
    const p = rotX(positionLocal.mul(vec3(sx, sx.mul(ib.z), sx)), rot).toVar()
    const t = U.time
    const sway = sin(t.mul(0.6).add(seed.mul(6.28)).add(ia.x.mul(0.04))).mul(0.05).mul(sx).mul(U.wind)
    const flutter = sin(t.mul(2.3).add(positionLocal.x.mul(6)).add(seed.mul(31)).add(aux.x.mul(40))).mul(0.02).mul(sx).mul(aux.z).mul(U.wind)
    p.x.addAssign(sway.add(flutter)); p.z.addAssign(sway.mul(0.6)); p.y.addAssign(flutter.mul(0.7))
    normalLocal.assign(rotX(normalLocal, rot))
    return p.mul(shrink(far)).add(ia.xyz)
  })()
  m.colorNode = Fn(() => {
    const pw = positionWorld, tint = ib.w, lh = aux.y
    const dab = noise(pw.xz.mul(0.31).add(pw.y.mul(0.23))).g
    const dab2 = noise(vec2(pw.x.add(pw.y), pw.z.sub(pw.y)).mul(0.085)).r
    const fleck = noise(vec2(pw.x.add(pw.y.mul(0.7)), pw.z.sub(pw.y.mul(0.7))).mul(1.7)).b
    let col: N = mix(vec3(0.012, 0.05, 0.022), vec3(0.05, 0.15, 0.025), tint)
    col = mix(col, vec3(0.14, 0.17, 0.03), smoothstep(0.78, 1.0, tint).mul(0.6))
    col = col.mul(dab.mul(0.6).add(0.7)).mul(fleck.mul(0.5).add(0.75))
    // dark, cool undersides; light gathers on the tops and on the sprigs at the edge
    const top = smoothstep(-0.6, 0.7, lh)
    col = mix(col.mul(vec3(0.22, 0.34, 0.36)), col.mul(1.2), top)
    col = col.add(vec3(0.07, 0.1, 0.01).mul(smoothstep(0.56, 0.74, dab2)).mul(top))
    // each leaf its own tone (some yellowing, some deep), lighter towards its tip; the inner mass stays dark
    const leaf = smoothstep(0.5, 1.0, aux.z), rnd = aux.x
    col = mix(col.mul(0.32), col.mul(mix(float(0.7), float(1.45), rnd)), leaf)
    col = mix(col, col.mul(vec3(1.5, 1.35, 0.6)), leaf.mul(smoothstep(0.82, 0.97, rnd)).mul(0.7))
    col = col.mul(mix(float(1), float(1.35), smoothstep(1.0, 1.6, aux.z)))
    // crowns standing in the flood: stained like the trunks
    return col.mul(mix(float(0.75), float(1), smoothstep(0, 6, pw.y.sub(U.water))))
  })()
  return m
}

function plantMaterial(far: number, kind: 'sapling' | 'broadleaf' | 'tuft' | 'palm' | 'spray') {
  const m = new PaintedMaterial({ wrap: 0.7, back: 0.3, pools: kind !== 'palm' })
  m.side = THREE.DoubleSide
  m.positionNode = Fn(() => {
    const s = ia.w, rot = ib.x, seed = ib.y
    const p = rotX(positionLocal.mul(kind === 'spray' ? vec3(s, s, s) : vec3(s, s.mul(ib.z), s)), rot).toVar()
    const t = U.time
    const w = aux.x.mul(aux.x).mul(s).mul(U.wind)
    const amp = kind === 'palm' ? 0.07 : kind === 'tuft' ? 0.1 : 0.06
    p.x.addAssign(sin(t.mul(kind === 'palm' ? 0.9 : 1.6).add(seed.mul(40)).add(aux.z.mul(9))).mul(amp).mul(w))
    p.y.addAssign(sin(t.mul(1.3).add(seed.mul(17)).add(aux.z.mul(23))).mul(amp * 0.7).mul(w))
    normalLocal.assign(rotX(normalLocal, rot))
    return p.mul(shrink(far)).add(ia.xyz)
  })()
  m.colorNode = Fn(() => {
    const tint = ib.w, t = aux.x, rnd = aux.z
    let col: N
    if (kind === 'tuft') col = mix(vec3(0.03, 0.075, 0.02), vec3(0.1, 0.15, 0.04), tint)
    else if (kind === 'palm') col = mix(vec3(0.06, 0.17, 0.05), vec3(0.2, 0.33, 0.07), tint.mul(0.6).add(rnd.mul(0.4)))
    else col = mix(vec3(0.02, 0.085, 0.03), vec3(0.08, 0.19, 0.035), tint.mul(0.55).add(rnd.mul(0.45)))
    // darker at the base, lighter at the tip, a pale midrib
    col = col.mul(mix(float(0.5), float(1.15), smoothstep(0.0, 0.8, t)))
    const rib = smoothstep(0.12, 0.0, abs(aux.y.sub(0.5)))
    col = col.add(vec3(0.08, 0.1, 0.02).mul(rib).mul(kind === 'tuft' ? 0 : 1))
    return col
  })()
  return m
}

function woodMaterial(far: number, kind: 'log' | 'root' | 'vine' | 'bankroot') {
  const m = new PaintedMaterial({ wrap: 0.4 })
  m.positionNode = Fn(() => {
    const rot = ib.x
    let p: N
    if (kind === 'log') p = rotX(positionLocal.mul(vec3(ia.w, ib.z, ib.z)), rot)
    else if (kind === 'root') p = rotX(positionLocal.mul(ia.w), rot)
    else if (kind === 'vine') {
      const sway = sin(U.time.mul(0.8).add(ib.y.mul(30))).mul(0.12).mul(aux.y.mul(aux.y.oneMinus()).mul(4)).mul(U.wind)
      p = rotX(vec3(positionLocal.x.add(sway), positionLocal.y.mul(ib.z), positionLocal.z), rot)
    } else p = rotZ(positionLocal.mul(vec3(ia.w, ib.z, ia.w)), rot)
    normalLocal.assign(kind === 'bankroot' ? rotZ(normalLocal, rot) : rotX(normalLocal, rot))
    return p.mul(shrink(far)).add(ia.xyz)
  })()
  m.colorNode = Fn(() => {
    const c = barkColor(ib.y.mul(kind === 'vine' ? 0.4 : kind === 'log' ? 0.9 : 0.6), ia.y.sub(kind === 'vine' ? 30 : 0))
    return kind === 'log' ? mix(c, vec3(0.42, 0.4, 0.36), 0.35) : c
  })()
  return m
}

function floaterMaterial(far: number) {
  const m = new PaintedMaterial({ wrap: 0.8, pools: true })
  m.positionNode = Fn(() => {
    const wy = mix(U.water, U.lake, ib.z)
    const depth = wy.sub(ia.y)
    const show = smoothstep(-0.02, 0.1, depth).mul(smoothstep(1.5, 0.9, depth))
    const p = rotX(positionLocal.mul(ia.w), ib.x)
    const bob = sin(U.time.mul(1.1).add(ib.y.mul(50))).mul(0.012)
    return p.mul(show).mul(shrink(far)).add(vec3(ia.x, wy.add(bob).add(0.01), ia.z))
  })()
  m.colorNode = Fn(() => {
    const c = mix(vec3(0.13, 0.3, 0.07), vec3(0.3, 0.42, 0.1), aux.z.mul(0.6).add(ib.w.mul(0.4)))
    return c.mul(mix(float(1.1), float(0.75), aux.x))
  })()
  return m
}

// Scanned plants (Megascans): real leaf shapes cut out of their photo atlas. Cut-outs cost more on Apple
// chips, so they are only drawn near the eye and kept to a few thousand.
function scanPlantMaterial(tex: THREE.Texture, far: number, base: number, floating = false) {
  const m = new PaintedMaterial({ wrap: 0.7, back: 0.3, pools: true })
  m.side = THREE.DoubleSide
  m.alphaTest = 0.45
  m.positionNode = Fn(() => {
    const s = ia.w.mul(base), rot = ib.x, seed = ib.y
    const p = rotX(positionLocal.mul(s), rot).toVar()
    const w = positionLocal.y.clamp(0, 2).mul(s).mul(U.wind)
    p.x.addAssign(sin(U.time.mul(1.4).add(seed.mul(40)).add(positionLocal.x.mul(3))).mul(0.03).mul(w))
    p.z.addAssign(sin(U.time.mul(1.1).add(seed.mul(17))).mul(0.02).mul(w))
    normalLocal.assign(rotX(normalLocal, rot))
    if (floating) {
      const wy = mix(U.water, U.lake, ib.z)
      const depth = wy.sub(ia.y)
      const show = smoothstep(-0.02, 0.1, depth).mul(smoothstep(1.5, 0.9, depth))
      return p.mul(show).mul(shrink(far)).add(vec3(ia.x, wy.add(0.015), ia.z))
    }
    return p.mul(shrink(far)).add(ia.xyz)
  })()
  const t = texture(tex, uv())
  m.colorNode = Fn(() => floodStain(t.rgb.mul(mix(float(0.8), float(1.15), ib.w)), ib.w))()
  m.opacityNode = t.a
  return m
}

export type Forest = { fields: Field[]; update(detail: number): void; count(): Record<string, number> }

export function buildForest(fc: ForestCook, group: THREE.Object3D): Forest {
  const F = fc.fields
  const mk = (name: Exclude<FieldName, 'shaft'>, specs: any[], shadowReach = 0) => new Field(name, F[name], specs, group, shadowReach)
  const fields: Field[] = []
  const trunkM = [trunkMaterial(9999), trunkMaterial(9999), trunkMaterial(520)]
  fields.push(mk('trunk', [
    { geometry: G.trunkGeometry(10, 9, 3), material: trunkM[0], near: 0, far: 52, shadow: true },
    { geometry: G.trunkGeometry(6, 4, 0), material: trunkM[1], near: 52, far: 170 },
    { geometry: G.trunkGeometry(4, 2, 0), material: trunkM[2], near: 170, far: 520 },
  ], 60))
  const clumpM = [clumpMaterial(9999), clumpMaterial(9999), clumpMaterial(520)]
  fields.push(mk('clump', [
    { geometry: G.leafClumpGeometry(260, 0.26, 1, 'clump-a'), material: clumpM[0], near: 0, far: 48 },
    { geometry: G.leafClumpGeometry(72, 0.5, 0, 'clump-a'), material: clumpM[1], near: 48, far: 150 },
    { geometry: G.leafClumpGeometry(14, 0.85, 0, 'clump-a'), material: clumpM[2], near: 150, far: 520 },
  ]))
  fields.push(mk('spray', [
    { geometry: G.sprayGeometry(), material: plantMaterial(9999, 'spray'), near: 0, far: 60 },
    { geometry: G.leafClumpGeometry(22, 0.7, 0, 'clump-a'), material: clumpMaterial(300), near: 60, far: 300 },
  ]))
  fields.push(mk('palm', [
    { geometry: G.palmGeometry(14, 6, true), material: plantMaterial(9999, 'palm'), near: 0, far: 60 },
    { geometry: G.palmGeometry(9, 3, false), material: plantMaterial(340, 'palm'), near: 60, far: 340 },
  ]))
  fields.push(mk('sapling', [{ geometry: G.saplingGeometry(), material: plantMaterial(70, 'sapling'), near: 0, far: 70 }]))
  fields.push(mk('broadleaf', [{ geometry: G.broadleafGeometry(), material: plantMaterial(85, 'broadleaf'), near: 0, far: 85 }]))
  fields.push(mk('tuft', [{ geometry: G.tuftGeometry(), material: plantMaterial(42, 'tuft'), near: 0, far: 42 }]))
  fields.push(mk('log', [{ geometry: G.logGeometry(), material: woodMaterial(130, 'log'), near: 0, far: 130 }]))
  fields.push(mk('root', [{ geometry: G.rootGeometry(), material: woodMaterial(90, 'root'), near: 0, far: 90 }]))
  fields.push(mk('vine', [{ geometry: G.vineGeometry(), material: woodMaterial(110, 'vine'), near: 0, far: 110 }]))
  fields.push(mk('bankroot', [{ geometry: G.bankrootGeometry(), material: woodMaterial(170, 'bankroot'), near: 0, far: 170 }]))
  const SG = parseGlb(b64ToBytes(scansUrl))
  const sp = (name: any, mesh: string, tex: THREE.Texture, base: number, far = 46) => { if (SG[mesh]) fields.push(mk(name, [{ geometry: SG[mesh], material: scanPlantMaterial(tex, far, base), near: 0, far }])) }
  sp('spFern', 'fern_A_near', PLANT_TEX.fern, 1.0); sp('spFern2', 'fern_C_near', PLANT_TEX.fern, 0.9); sp('spLeather', 'leatherfern_A_near', PLANT_TEX.leatherfern, 1.0)
  sp('spPalm', 'palm_A_near', PLANT_TEX.palm, 0.9, 60); sp('spFan', 'fanpalm_C_near', PLANT_TEX.fanpalm, 1.1, 60); sp('spBanana', 'banana_B_near', PLANT_TEX.banana, 1.0, 60); sp('spEar', 'elephantear_A_near', PLANT_TEX.elephantear, 0.9, 60)
  if (SG.waterlily_A_near) fields.push(mk('floater', [{ geometry: SG.waterlily_A_near, material: scanPlantMaterial(PLANT_TEX.waterlily, 110, 1.3, true), near: 0, far: 110 }]))
  else fields.push(mk('floater', [{ geometry: G.floaterGeometry(), material: floaterMaterial(120), near: 0, far: 120 }]))
  return {
    fields,
    update(detail) { for (const f of fields) f.update(detail) },
    count() { const o: Record<string, number> = {}; for (const f of fields) o[f.name] = f.drawn(); return o },
  }
}
void max
