// Light shafts through the canopy: a few hundred soft slanted sheets of light, instanced, additive.
// They lean with the sun, so they follow the time of day, and fade out at night.
import * as THREE from 'three/webgpu'
import { Fn, attribute, positionLocal, vec3, vec4, float, mix, smoothstep, sin, max, dot, normalize, cameraPosition, positionWorld } from './tsl'
import { U } from './uniforms'
import { GB } from './geom'
import { Field } from './instanced'
import type { FieldData } from './forestCook'

export function buildShafts(fd: FieldData, group: THREE.Object3D): Field {
  // two crossed sheets, 3 columns x 3 rows so brightness can fall off to every edge. aux = (across 0..1, up 0..1, sheet)
  const g = new GB()
  for (let s = 0; s < 2; s++) {
    const base = g.n
    for (let j = 0; j <= 3; j++) for (let i = 0; i <= 2; i++) {
      const u = i / 2, v = j / 3, x = (u - 0.5)
      g.v(s === 0 ? x : 0, v, s === 0 ? 0 : x, 0, 1, 0, u, v, s)
    }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) { const a = base + j * 3 + i; g.quad(a, a + 1, a + 4, a + 3) }
  }
  const ia = attribute('ia', 'vec4'), ib = attribute('ib', 'vec4'), aux = attribute('aux', 'vec3')
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
  m.positionNode = Fn(() => {
    const w = ia.w, len = ib.z
    const sd = U.sunDir
    const dir = normalize(vec3(sd.x, max(sd.y, 0.25), sd.z))
    const p = vec3(positionLocal.x.mul(w), 0, positionLocal.z.mul(w)).add(dir.mul(positionLocal.y.mul(len)))
    const fade = smoothstep(float(150).mul(U.detail), float(110).mul(U.detail), ia.xz.sub(U.eye.xz).length())
    return p.mul(fade).add(ia.xyz)
  })()
  const body = Fn(() => {
    const across = sin(aux.x.mul(3.14159))
    const along = smoothstep(0.0, 0.25, aux.y).mul(smoothstep(1.0, 0.55, aux.y))
    const flick = sin(U.time.mul(0.35).add(ib.y.mul(40))).mul(0.25).add(0.75)
    const view = normalize(positionWorld.sub(cameraPosition))
    const toward = max(dot(view, U.sunDir), 0)
    const a = across.mul(across).mul(along).mul(flick).mul(U.day).mul(smoothstep(0.3, 1.2, U.sunI)).mul(mix(float(0.05), float(0.2), toward.mul(toward)))
    return vec4(mix(U.sunCol, U.fogSun, 0.5).mul(a), a)
  })()
  m.colorNode = body.rgb
  m.opacityNode = body.a
  const f = new Field('shaft', fd, [{ geometry: g.build(), material: m, near: 0, far: 150 }], group)
  f.lods[0].mesh.renderOrder = 8
  return f
}
