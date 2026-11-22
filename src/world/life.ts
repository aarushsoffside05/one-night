// Life: leaves drifting on the water and falling through the air, motes in the light and fireflies at night,
// butterflies, birds crossing the sky, fish shadows under the surface, rings on the water, the giant fish.
// Each is one instanced draw; the small ones live in a box that wraps round the eye, so they are everywhere
// without being placed everywhere.
import * as THREE from 'three/webgpu'
import { Fn, attribute, positionLocal, normalLocal, uv, vec2, vec3, vec4, float, mix, smoothstep, sin, cos, fract, max, abs, texture, cameraProjectionMatrix, cameraViewMatrix, length, dot, normalize } from './tsl'
import { U } from './uniforms'
import { PaintedMaterial, TEX } from './shade'
import { rng } from './rng'
import { CORE, LAKE, LAKE_LEVEL, PLACES } from './layout'
import { GB } from './geom'

type N = any
const hUV = (xz: N) => xz.add(CORE).div(CORE * 2)
const lakeMask = (xz: N) => smoothstep(1.42, 1.3, xz.sub(vec2(LAKE.x, LAKE.z)).div(vec2(LAKE.rx, LAKE.rz)).length())
const waterAt = (xz: N) => mix(U.water, U.lake, lakeMask(xz))

function instanced(geo: THREE.BufferGeometry, n: number, fill: (i: number, a: Float32Array, b: Float32Array) => void) {
  const g = new THREE.InstancedBufferGeometry()
  g.index = geo.index
  for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k])
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) fill(i, A.subarray(i * 4, i * 4 + 4), B.subarray(i * 4, i * 4 + 4))
  g.setAttribute('ia', new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute('ib', new THREE.InstancedBufferAttribute(B, 4))
  g.instanceCount = n
  return g
}
const ia: N = attribute('ia', 'vec4'), ib: N = attribute('ib', 'vec4'), aux: N = attribute('aux', 'vec3')
// a point in a box of size `box` that wraps round the eye
const wrapXZ = (base: N, box: number) => U.eye.xz.add(fract(base.sub(U.eye.xz.div(box))).sub(0.5).mul(box))

export type Life = {
  update(dt: number, clock: number, eye: THREE.Vector3, tod: number): void
  ring(x: number, z: number, size: number, lake?: boolean): void
  fishRoll(x: number, z: number, heading: number): void
  fish: { active: boolean; t: number; x: number; z: number }
  objects: THREE.Object3D[]
}

export function buildLife(group: THREE.Object3D, density: number, fishGeo: THREE.BufferGeometry): Life {
  const objects: THREE.Object3D[] = []
  const add = (m: THREE.Mesh, order = 0) => { m.frustumCulled = false; m.renderOrder = order; group.add(m); objects.push(m); return m }

  // ---------- leaves: floating on the water (ib.w = 0) and falling through the forest air (ib.w = 1)
  {
    const r = rng('leaves')
    const g = new GB()
    g.v(-0.5, 0, 0, 0, 1, 0, 0, 0, 0); g.v(-0.1, 0, 0.22, 0, 1, 0, 0, 0, 0); g.v(0.5, 0, 0, 0, 1, 0, 1, 0, 0); g.v(-0.1, 0, -0.22, 0, 1, 0, 0, 0, 0)
    g.quad(0, 1, 2, 3)
    const n = Math.round(2600 * density)
    const geo = instanced(g.build(), n, (i, a, b) => { a[0] = r(); a[1] = r(); a[2] = r(); a[3] = r.range(0.06, 0.13); b[0] = r() * 6.283; b[1] = r(); b[2] = r(); b[3] = i < n * 0.72 ? 0 : 1 })
    const m = new PaintedMaterial({ wrap: 0.8, pools: true })
    m.side = THREE.DoubleSide
    m.positionNode = Fn(() => {
      const falling = ib.w
      const box = mix(float(70), float(44), falling)
      const t = U.time
      // floating leaves drift slowly downstream (towards +z, the river) and turn; falling ones sink and flutter
      const drift = mix(vec2(sin(t.mul(0.05).add(ib.y.mul(9))).mul(0.004), t.mul(0.0016).mul(ib.z.add(0.5))), vec2(t.mul(0.004), t.mul(0.002)), falling)
      const xz = U.eye.xz.add(fract(ia.xy.add(drift).sub(U.eye.xz.div(box))).sub(0.5).mul(box)).toVar()
      const bed = texture(TEX.height, hUV(xz)).r
      const wy = waterAt(xz)
      const afloat = smoothstep(0.02, 0.2, wy.sub(bed))
      const fallY = U.eye.y.add(fract(ia.z.sub(t.mul(0.03).mul(ib.z.add(0.6))).sub(U.eye.y.div(26))).sub(0.42).mul(26))
      const overLand = smoothstep(0.1, -0.1, wy.sub(bed))
      const y = mix(wy.add(0.012), max(fallY, bed.add(0.03)), falling)
      const show = mix(afloat, overLand.mul(smoothstep(bed, bed.add(0.6), fallY)), falling)
      const spin = ib.x.add(t.mul(mix(float(0.08), float(1.6), falling)).mul(ib.y.sub(0.5).mul(2)))
      const tumble = sin(t.mul(2.2).add(ib.y.mul(30))).mul(1.1).mul(falling)
      const lp = positionLocal.mul(ia.w)
      const p1 = vec3(lp.x, lp.z.mul(sin(tumble)), lp.z.mul(cos(tumble)))
      const p2 = vec3(p1.x.mul(cos(spin)).sub(p1.z.mul(sin(spin))), p1.y, p1.x.mul(sin(spin)).add(p1.z.mul(cos(spin))))
      const sway = vec3(sin(t.mul(1.3).add(ib.y.mul(40))).mul(0.5), 0, cos(t.mul(1.1).add(ib.z.mul(40))).mul(0.5)).mul(falling)
      const fade = smoothstep(box.mul(0.5), box.mul(0.38), length(xz.sub(U.eye.xz)))
      return p2.mul(show).mul(fade).add(vec3(xz.x, y, xz.y)).add(sway)
    })()
    m.colorNode = Fn(() => mix(mix(vec3(0.2, 0.12, 0.04), vec3(0.34, 0.24, 0.06), ib.y), vec3(0.1, 0.16, 0.04), smoothstep(0.6, 0.9, ib.z)).mul(mix(float(0.8), float(1.1), aux.x)))()
    add(new THREE.Mesh(geo, m), 6)
  }

  // ---------- leaf litter: big fallen leaves lying on the forest floor round the eye, each one drawn
  {
    const r = rng('litter')
    const g = new GB()
    g.v(-0.5, 0.0, 0, 0, 1, 0, 0, 0, 0); g.v(0.05, 0.05, 0.3, 0.2, 1, 0.3, 0.5, 0, 0); g.v(0.5, 0.02, 0, 0, 1, 0, 1, 0, 0); g.v(0.05, 0.05, -0.3, 0.2, 1, -0.3, 0.5, 0, 0)
    g.quad(0, 1, 2, 3)
    const n = Math.round(9000 * density)
    const geo = instanced(g.build(), n, (_i, a, b) => { a[0] = r(); a[1] = r(); a[2] = r(); a[3] = r.range(0.08, 0.2); b[0] = r() * 6.283; b[1] = r(); b[2] = r(); b[3] = r() })
    const m = new PaintedMaterial({ wrap: 0.6, pools: true })
    m.side = THREE.DoubleSide
    m.positionNode = Fn(() => {
      const box = 34
      const xz = wrapXZ(ia.xy, box)
      const bed = texture(TEX.height, hUV(xz)).r
      const cover = texture(TEX.cover, hUV(xz)).r
      const dry = smoothstep(0.0, 0.25, bed.sub(waterAt(xz)))
      const lp = positionLocal.mul(ia.w)
      const rp = vec3(lp.x.mul(cos(ib.x)).sub(lp.z.mul(sin(ib.x))), lp.y.add(lp.x.mul(ib.z.sub(0.5)).mul(0.35)), lp.x.mul(sin(ib.x)).add(lp.z.mul(cos(ib.x))))
      const fade = smoothstep(box * 0.5, box * 0.36, length(xz.sub(U.eye.xz)))
      return rp.mul(dry).mul(fade).mul(smoothstep(-0.2, 0.4, cover.add(ib.w.mul(0.5)))).add(vec3(xz.x, bed.add(0.025), xz.y))
    })()
    m.colorNode = Fn(() => mix(mix(vec3(0.11, 0.055, 0.025), vec3(0.24, 0.13, 0.05), ib.y), vec3(0.3, 0.22, 0.09), smoothstep(0.8, 0.97, ib.z)).mul(mix(float(0.75), float(1.1), aux.x)))()
    add(new THREE.Mesh(geo, m))
  }

  // ---------- motes in the sun by day, fireflies by night: soft additive specks that face the eye
  {
    const r = rng('motes')
    const n = Math.round(260 * density)
    const geo = instanced(new THREE.PlaneGeometry(1, 1), n, (_i, a, b) => { a[0] = r(); a[1] = r(); a[2] = r(); a[3] = r.range(0.5, 1.4); b[0] = r(); b[1] = r(); b[2] = r(); b[3] = r() })
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    const box = 46
    const night = Fn(() => smoothstep(0.75, 0.25, U.day))
    const center = Fn(() => {
      const t = U.time
      const wob = vec2(sin(t.mul(0.31).add(ib.x.mul(40))), cos(t.mul(0.27).add(ib.y.mul(40)))).mul(0.014)
      const xz = wrapXZ(ia.xy.add(wob).add(vec2(t.mul(0.0012), 0)), box)
      const bed = max(texture(TEX.height, hUV(xz)).r, waterAt(xz))
      // near the ground at night (fireflies), anywhere up to the canopy by day
      const hgt = mix(ia.z.mul(ia.z).mul(14).add(0.4), ia.z.mul(2.6).add(0.3), night())
      return vec3(xz.x, bed.add(hgt).add(sin(t.mul(0.6).add(ib.z.mul(30))).mul(0.3)), xz.y)
    })
    m.vertexNode = Fn(() => {
      const c = center()
      const cover = texture(TEX.cover, hUV(c.xz)).r
      const blink = smoothstep(0.55, 0.95, sin(U.time.mul(mix(float(1.2), float(2.6), ib.w)).add(ib.x.mul(60))))
      const size = mix(float(0.035).mul(ia.w), float(0.085).mul(blink.add(0.12)), night()).mul(mix(cover.mul(0.9).add(0.1), cover.mul(0.5).add(0.5), night()))
      const fade = smoothstep(box * 0.5, box * 0.36, length(c.xz.sub(U.eye.xz)))
      const view = cameraViewMatrix.mul(vec4(c, 1))
      return cameraProjectionMatrix.mul(view.add(vec4(positionLocal.xy.mul(size).mul(fade), 0, 0)))
    })()
    const body = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2)
      const a = smoothstep(1.0, 0.0, d)
      const col = mix(U.sunCol.mul(U.sunI).mul(0.35), vec3(0.75, 1.0, 0.35).mul(1.6), night())
      return vec4(col.mul(a.mul(a)), a)
    })()
    m.colorNode = body.rgb; m.opacityNode = body.a
    add(new THREE.Mesh(geo, m), 9)
  }

  // ---------- butterflies: two flapping wings, low in the forest by day
  {
    const r = rng('butterflies')
    const g = new GB()
    for (const s of [-1, 1]) { const a = g.v(0, 0, -0.5, 0, 1, 0, 0, 0, s), b = g.v(s, 0, -0.7, 0, 1, 0, 1, 0, s), c = g.v(s * 0.8, 0, 0.5, 0, 1, 0, 1, 0, s), d = g.v(0, 0, 0.4, 0, 1, 0, 0, 0, s); g.quad(a, b, c, d) }
    const n = Math.round(90 * density)
    const geo = instanced(g.build(), n, (_i, a, b) => { a[0] = r(); a[1] = r(); a[2] = r(); a[3] = r.range(0.05, 0.085); b[0] = r(); b[1] = r(); b[2] = r(); b[3] = r() })
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
    m.positionNode = Fn(() => {
      const t = U.time, box = 60
      const path = vec2(sin(t.mul(0.21).add(ib.x.mul(50))), cos(t.mul(0.17).add(ib.y.mul(50)))).mul(0.05)
      const xz = wrapXZ(ia.xy.add(path), box)
      const bed = max(texture(TEX.height, hUV(xz)).r, waterAt(xz))
      const y = bed.add(0.5).add(ia.z.mul(2.2)).add(sin(t.mul(1.7).add(ib.z.mul(40))).mul(0.35))
      const flap = sin(t.mul(17).add(ib.w.mul(30))).mul(1.0)
      const lp = positionLocal.mul(ia.w)
      const wing = vec3(lp.x.mul(cos(flap)), abs(lp.x).mul(sin(flap)), lp.z)
      const dir = t.mul(0.21).add(ib.x.mul(50))
      const rp = vec3(wing.x.mul(cos(dir)).sub(wing.z.mul(sin(dir))), wing.y, wing.x.mul(sin(dir)).add(wing.z.mul(cos(dir))))
      const show = smoothstep(0.55, 0.9, U.day).mul(smoothstep(box * 0.5, box * 0.38, length(xz.sub(U.eye.xz)))).mul(smoothstep(2.5, 5, length(xz.sub(U.eye.xz))))
      return rp.mul(show).add(vec3(xz.x, y, xz.y))
    })()
    m.colorNode = Fn(() => {
      const c = mix(mix(vec3(0.95, 0.72, 0.1), vec3(0.95, 0.45, 0.1), smoothstep(0.45, 0.55, ib.x)), vec3(0.95, 0.95, 0.9), smoothstep(0.8, 0.85, ib.y))
      return c.mul(mix(float(0.45), float(1.0), aux.x)).mul(U.amb.add(U.sunCol.mul(U.sunI).mul(0.4)))
    })()
    add(new THREE.Mesh(geo, m))
  }

  // ---------- birds: small flocks crossing high over the river and the lake
  {
    const r = rng('birds')
    const g = new GB()
    for (const s of [-1, 1]) { const a = g.v(0, 0, -0.25, 0, 1, 0, 0, 0, s), b = g.v(s * 0.55, 0, -0.1, 0, 1, 0, 0.55, 0, s), c = g.v(s, 0, 0.12, 0, 1, 0, 1, 0, s), d = g.v(0, 0, 0.3, 0, 1, 0, 0, 0, s); g.quad(a, b, c, d) }
    const flocks = 7, per = 9, n = flocks * per
    const geo = instanced(g.build(), n, (i, a, b) => {
      const f = Math.floor(i / per)
      const fr = rng('flock' + f)
      // flock: centre of its circuit (x, z), radius, height; bird: offset in the flock
      a[0] = fr.range(-160, 200); a[1] = fr.range(16, 38); a[2] = fr.range(-220, 240); a[3] = fr.range(40, 120)
      b[0] = fr() * 6.283 + (i % per) * 0.035 * (f % 2 ? 1 : -1); b[1] = r.range(-5, 5); b[2] = fr.range(0.035, 0.07) * (f % 2 ? 1 : -1); b[3] = r()
    })
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
    m.positionNode = Fn(() => {
      const t = U.time
      const ang = ib.x.add(t.mul(ib.z))
      const rad = ia.w.add(ib.y.mul(1.4))
      const c = vec3(ia.x.add(cos(ang).mul(rad)), ia.y.add(ib.y.mul(0.5)).add(sin(t.mul(0.3).add(ib.w.mul(9))).mul(1.5)), ia.z.add(sin(ang).mul(rad).mul(0.7)))
      const flap = sin(t.mul(7).add(ib.w.mul(40))).mul(0.7)
      const lp = positionLocal.mul(1.6)
      const wing = vec3(lp.x.mul(cos(flap.mul(aux.x))), abs(lp.x).mul(sin(flap)).mul(aux.x.add(0.2)), lp.z)
      const dir = ang.add(mix(float(1.5708), float(-1.5708), smoothstep(-0.001, 0.001, ib.z.negate()))).add(3.14159)
      const rp = vec3(wing.x.mul(cos(dir)).sub(wing.z.mul(sin(dir))), wing.y, wing.x.mul(sin(dir)).add(wing.z.mul(cos(dir))))
      // fewer by night
      return rp.mul(smoothstep(0.2, 0.6, U.day.add(ib.w.mul(0.4)))).add(c)
    })()
    m.colorNode = Fn(() => mix(vec3(0.07, 0.07, 0.08), vec3(0.85, 0.85, 0.82), smoothstep(0.86, 0.9, ib.w)).mul(U.amb.add(U.sunCol.mul(U.sunI).mul(0.3))))()
    add(new THREE.Mesh(geo, m))
  }

  // ---------- fish shadows gliding under the surface
  {
    const r = rng('fish-shadows')
    const g = new GB()
    const pts = [[0, 0.5], [0.16, 0.2], [0.13, -0.15], [0.03, -0.38], [0.14, -0.55], [-0.14, -0.55], [-0.03, -0.38], [-0.13, -0.15], [-0.16, 0.2]]
    const c = g.v(0, 0, 0, 0, 1, 0, 0, 0.5, 0)
    for (const [x, z] of pts) g.v(x, 0, z, 0, 1, 0, 0, 0.5 - z, 0)
    for (let i = 0; i < pts.length; i++) g.tri(c, 1 + ((i + 1) % pts.length), 1 + i)
    const n = Math.round(260 * density)
    const geo = instanced(g.build(), n, (_i, a, b) => { a[0] = r(); a[1] = r(); a[2] = r(); a[3] = r.range(0.25, 0.7); b[0] = r(); b[1] = r(); b[2] = r(); b[3] = r() })
    const m = new THREE.MeshBasicNodeMaterial({})
    m.positionNode = Fn(() => {
      const t = U.time, box = 56
      const ang = t.mul(ib.x.sub(0.5).mul(0.5)).add(ib.y.mul(6.283))
      const circ = vec2(cos(ang), sin(ang)).mul(0.035).mul(ib.z.add(0.4))
      const xz = wrapXZ(ia.xy.add(circ), box)
      const bed = texture(TEX.height, hUV(xz)).r
      const wy = waterAt(xz)
      const depth = wy.sub(bed)
      const show = smoothstep(0.35, 0.8, depth).mul(smoothstep(box * 0.5, box * 0.36, length(xz.sub(U.eye.xz))))
      const dir = ang.add(mix(float(1.5708), float(-1.5708), smoothstep(0.499, 0.501, ib.x))).add(1.5708)
      // the body bends as it swims
      const wag = sin(t.mul(5).add(ib.w.mul(30)).add(positionLocal.z.mul(5))).mul(0.06).mul(float(0.5).sub(positionLocal.z))
      const lp = vec3(positionLocal.x.add(wag), 0, positionLocal.z).mul(ia.w)
      const rp = vec3(lp.x.mul(cos(dir)).sub(lp.z.mul(sin(dir))), 0, lp.x.mul(sin(dir)).add(lp.z.mul(cos(dir))))
      return rp.mul(show).add(vec3(xz.x, wy.sub(mix(float(0.12), float(0.3), ib.z)), xz.y))
    })()
    m.colorNode = Fn(() => U.waterDeep.mul(0.35).mul(U.amb))()
    add(new THREE.Mesh(geo, m), 1)
  }

  // ---------- rings on the water: a small pool, respawned by fish rises, paddle strokes and the giant fish
  const RN = 28
  const ringA = new Float32Array(RN * 4), ringB = new Float32Array(RN * 4)
  for (let i = 0; i < RN; i++) ringB[i * 4] = -100
  const ringGeo = new THREE.InstancedBufferGeometry()
  {
    const pg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    ringGeo.index = pg.index
    for (const k in pg.attributes) ringGeo.setAttribute(k, pg.attributes[k])
  }
  const rA = new THREE.InstancedBufferAttribute(ringA, 4), rB = new THREE.InstancedBufferAttribute(ringB, 4)
  rA.setUsage(THREE.DynamicDrawUsage); rB.setUsage(THREE.DynamicDrawUsage)
  ringGeo.setAttribute('ia', rA); ringGeo.setAttribute('ib', rB); ringGeo.instanceCount = RN
  {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false })
    const age = Fn(() => U.time.sub(ib.x))
    m.positionNode = Fn(() => {
      const a = age()
      const rad = a.mul(0.9).add(0.15).mul(ia.w).mul(2)
      const alive = smoothstep(-0.001, 0.0, a).mul(smoothstep(ib.y, ib.y.mul(0.5), a))
      return vec3(positionLocal.x.mul(rad), 0, positionLocal.z.mul(rad)).mul(alive).add(vec3(ia.x, ia.y.add(0.02), ia.z))
    })()
    const body = Fn(() => {
      const a = age()
      const d = length(uv().sub(0.5)).mul(2)
      // two or three concentric bands, thinning as they spread
      const q = uv().sub(0.5)
      const wob = sin(q.x.mul(9).add(ib.x)).mul(sin(q.y.mul(7).sub(ib.x.mul(1.7)))).mul(0.5).add(0.5)
      const bands = smoothstep(0.045, 0.0, abs(d.sub(0.84))).add(smoothstep(0.035, 0.0, abs(d.sub(0.6))).mul(0.75)).add(smoothstep(0.028, 0.0, abs(d.sub(0.36))).mul(0.55)).mul(wob.mul(0.6).add(0.4))
      const fade = smoothstep(ib.y, 0.0, a)
      const al = bands.mul(fade).mul(0.42)
      return vec4(mix(U.skyHor, vec3(1, 1, 1), 0.3).mul(U.amb.add(U.sunCol.mul(U.sunI).mul(0.12)).add(0.05)), al)
    })()
    m.colorNode = body.rgb; m.opacityNode = body.a
    add(new THREE.Mesh(ringGeo, m), 7)
  }
  let ringNext = 0
  let clockNow = 0
  const ring = (x: number, z: number, size: number, lake = false) => {
    const i = ringNext; ringNext = (ringNext + 1) % RN
    ringA[i * 4] = x; ringA[i * 4 + 1] = lake ? Math.max(LAKE_LEVEL, U.water.value) : U.water.value; ringA[i * 4 + 2] = z; ringA[i * 4 + 3] = size
    ringB[i * 4] = clockNow; ringB[i * 4 + 1] = 2.2 + size * 1.6
    rA.needsUpdate = true; rB.needsUpdate = true
  }

  // ---------- the giant fish: a back and a tail rolling at the surface, never the whole animal
  const fishMat = new PaintedMaterial({ wrap: 0.5, pools: false })
  const fishU = { roll: U.fishRoll }
  fishMat.positionNode = Fn(() => {
    // U.fishRoll: x = roll progress 0..1, y = bend, z = unused. The body arcs: head goes down first, back shows, tail last.
    const p = positionLocal
    const along = p.z.div(1.15) // -1 tail .. +1 head
    const k = fishU.roll.y
    const arc = along.mul(along).mul(k).negate()
    const wag = sin(U.time.mul(6).add(along.mul(2.5))).mul(0.05).mul(float(1).sub(along)).mul(fishU.roll.z)
    normalLocal.assign(normalize(vec3(normalLocal.x, normalLocal.y, normalLocal.z.add(along.mul(k).mul(1.2)))))
    return vec3(p.x.add(wag), p.y.add(arc), p.z)
  })()
  fishMat.colorNode = Fn(() => {
    // the modelled fish carries its painted colour; add a wet shine along the back
    return attribute('color', 'vec3').mul(0.13).add(U.skyHor.mul(0.3).mul(smoothstep(0.1, 0.19, positionLocal.y)))
  })()
  const fishMesh = new THREE.Mesh(fishGeo, fishMat)
  fishMesh.visible = false
  fishMesh.scale.set(3.3, 2.0, 2.4)
  add(fishMesh)
  const fish = { active: false, t: 0, x: 0, z: 0, heading: 0 }
  const fishRoll = (x: number, z: number, heading: number) => { fish.active = true; fish.t = 0; fish.x = x; fish.z = z; fish.heading = heading; ring(x, z, 2.6, true) }

  const rr = rng('life-events')
  let nextRise = 3, nextRoll = 14
  return {
    objects, ring, fishRoll, fish,
    update(dt, clock, eye, tod) {
      clockNow = clock
      // small fish rising: rings near the eye, wherever there is water
      nextRise -= dt
      if (nextRise <= 0) {
        nextRise = rr.range(1.2, 4.5)
        const a = rr() * 6.283, d = rr.range(5, 26)
        const x = eye.x + Math.cos(a) * d, z = eye.z + Math.sin(a) * d
        const inLake = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) < 1.05
        const wy = inLake ? Math.max(LAKE_LEVEL, U.water.value) : U.water.value
        if (wy - TEXh(x, z) > 0.3) ring(x, z, rr.range(0.25, 0.6), inLake)
      }
      // in Roam the giant fish rolls by the lake's bank at first light, when someone is near enough to see it
      if (tod > 0.66 && tod < 0.93 && !fish.active && Math.hypot(eye.x - PLACES.fishRoll.x, eye.z - PLACES.fishRoll.z) < 60 && autoRoll.on) {
        nextRoll -= dt
        if (nextRoll <= 0) { nextRoll = rr.range(16, 30); fishRoll(PLACES.fishRoll.x + rr.range(-3, 3), PLACES.fishRoll.z + rr.range(-3, 3), rr() * 6.283) }
      }
      if (fish.active) {
        fish.t += dt
        const T = 3.4, u = fish.t / T
        if (u >= 1) { fish.active = false; fishMesh.visible = false; return }
        // the back comes up, slides forward and over, the tail lifts and slaps down
        const up = Math.sin(Math.min(1, u * 1.15) * Math.PI)
        const wy = Math.max(LAKE_LEVEL, U.water.value)
        const fwd = (u - 0.5) * 1.9
        fishMesh.visible = true
        // never a hero shot: the body stays in the water; only the broad back, then the tail, breaks the surface
        fishMesh.position.set(fish.x + Math.sin(fish.heading) * fwd, wy - 0.56 + up * 0.3, fish.z + Math.cos(fish.heading) * fwd)
        fishMesh.rotation.set(-0.1 + u * 0.3, fish.heading, 0, 'YXZ')
        U.fishRoll.value.set(u, 0.12 + 0.1 * up, u > 0.55 ? 1.6 : 0.5)
        if (fish.t - dt < T * 0.62 && fish.t >= T * 0.62) ring(fishMesh.position.x - Math.sin(fish.heading) * 1.0, fishMesh.position.z - Math.cos(fish.heading) * 1.0, 1.7, true)
      }
    },
  }
}
// CPU read of the baked land height for event placement (set by build.ts)
let TEXh: (x: number, z: number) => number = () => 0
export function setLifeHeight(f: (x: number, z: number) => number) { TEXh = f }
export const autoRoll = { on: true }
void dot
