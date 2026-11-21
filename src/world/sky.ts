// Sky dome (gradient, sun or moon, painted cloud streaks, stars) and the far painted silhouette rings.
import * as THREE from 'three/webgpu'
import { Fn, positionWorld, positionLocal, cameraPosition, vec2, vec3, float, mix, smoothstep, max, dot, pow, attribute, clamp } from './tsl'
import { U } from './uniforms'
import { noise, PaintedMaterial, grade } from './shade'
import { heightFormula } from './terrain'
import { rng, noise2, seedInt } from './rng'

// The sky as a function of direction: used by the dome, and by the water for what it reflects.
export const skyColor = (dir: any, stars: boolean) => {
  const y = dir.y
  const t = clamp(y, 0, 1)
  const col = mix(U.skyHor, U.skyTop, pow(t, 0.42)).toVar()
  const sd = max(dot(dir, U.sunDir), 0)
  col.addAssign(U.skyGlow.mul(pow(sd, 6).mul(0.35).add(pow(sd, 48).mul(0.5))).mul(smoothstep(-0.1, 0.1, y)))
  // painted clouds: soft banks with a brushed edge, lit on the sun side; a flat layer seen in perspective
  const cuv = dir.xz.div(y.abs().add(0.3)).mul(0.42)
  const drift = vec2(U.time.mul(0.0012), U.time.mul(0.0004))
  const big = noise(cuv.mul(0.5).add(drift)).r
  const mid = noise(cuv.mul(1.3).sub(drift.mul(1.7))).g
  const brush = noise(cuv.mul(vec2(1.1, 2.6)).add(drift.mul(2))).a
  const dens = big.mul(0.62).add(mid.mul(0.28)).add(brush.mul(0.16))
  const c = smoothstep(0.56, 0.74, dens).mul(smoothstep(0.03, 0.2, y)).mul(0.9)
  const lit = smoothstep(0.5, 0.95, dens.add(pow(sd, 3).mul(0.2)))
  col.assign(mix(col, mix(U.cloudShade, U.cloudCol, lit), c))
  if (stars) {
    const suv = dir.xz.div(y.abs().add(0.35)).mul(9)
    const st = noise(suv).b.mul(noise(suv.mul(2.7).add(0.37)).b)
    col.addAssign(vec3(0.9, 0.95, 1).mul(smoothstep(0.46, 0.6, st)).mul(1.6).mul(U.stars).mul(smoothstep(0.0, 0.25, y)).mul(c.oneMinus()))
  }
  col.addAssign(U.discCol.mul(smoothstep(0.99935, 0.99965, sd)).mul(c.mul(0.7).oneMinus()))
  const hazeBand = smoothstep(0.16, -0.02, y)
  const hz = mix(U.fogCol, U.fogSun, pow(sd, 3))
  return mix(col, hz, hazeBand.mul(0.85))
}

export function makeSky(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
  m.colorNode = Fn(() => grade(skyColor(positionLocal.normalize(), true)))()
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), m)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  return mesh
}

// Far forest: layered silhouette rings in the haze, not real trees. One merged mesh, one draw.
export function makeFarRings(): THREE.Mesh {
  const r = rng('far-rings')
  const S = seedInt('far-rings')
  const pos: number[] = [], col: number[] = [], idx: number[] = []
  const rings = [
    { rad: 372, h: 26, seg: 420, tone: 0.0 },
    { rad: 470, h: 31, seg: 380, tone: 0.33 },
    { rad: 640, h: 36, seg: 320, tone: 0.66 },
    { rad: 1000, h: 44, seg: 260, tone: 1.0 },
    { rad: 1900, h: 60, seg: 200, tone: 1.0 },
  ]
  for (const ring of rings) {
    const base = pos.length / 3
    const off = r() * 10
    for (let i = 0; i <= ring.seg; i++) {
      const a = (i / ring.seg) * Math.PI * 2
      const wob = 1 + 0.07 * Math.sin(a * 5 + off) + 0.04 * Math.sin(a * 11 + off * 2)
      const x = Math.cos(a) * ring.rad * wob, z = Math.sin(a) * ring.rad * wob
      const g = heightFormula(x, z)
      const land = g > 1.5 ? 1 : 0
      // crown line: lumpy canopy with a few emergent trees standing above it
      const u = i * (ring.rad / ring.seg) * 0.9
      const lump = noise2(u * 0.21 + off, 3, S) * 0.5 + noise2(u * 0.07 + off, 9, S) * 0.5
      const emergent = Math.pow(noise2(u * 0.11 + off, 21, S), 6) * 14
      const top = land ? Math.max(g, 8) + ring.h * (0.72 + 0.4 * lump) + emergent : -4
      const bot = land ? Math.min(g, 0) - 4 : -6
      pos.push(x, bot, z, x, top, z)
      const dark = 0.75 + 0.25 * lump
      col.push(ring.tone, dark * 0.75, 0, ring.tone, dark, 1)
    }
    for (let i = 0; i < ring.seg; i++) {
      const a = base + i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('ring', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
  m.colorNode = Fn(() => {
    const k = attribute('ring', 'vec3')
    // crown tops catch the sun, the body stays in cool shade; painted blotches break the band
    const blot = noise(vec2(positionWorld.x.add(positionWorld.z).mul(0.006), positionWorld.y.mul(0.03))).r
    const base = mix(vec3(0.05, 0.11, 0.05), vec3(0.16, 0.26, 0.09), k.z.mul(0.6).add(blot.mul(0.5)))
    const lit = base.mul(U.sunCol.mul(U.sunI).mul(k.z.mul(0.5).add(0.15)).add(U.amb.mul(0.9)))
    return grade(lit.mul(k.y))
  })()
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  return mesh
}
void PaintedMaterial; void cameraPosition; void float
