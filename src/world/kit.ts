// A small kit of pieces (plank boxes, posts, roof slabs, ropes) and a builder that merges them per material
// bucket. Buildings are assembled from these by rule in structures.ts. Surfaces are patterned in the shader.
import * as THREE from 'three/webgpu'
import { Fn, attribute, positionLocal, positionWorld, vec2, vec3, float, mix, smoothstep, sin, fract, floor, abs } from './tsl'
import { U } from './uniforms'
import { PaintedMaterial, noise } from './shade'
import { floodStain } from './forest'
import { envUniforms } from './env'

export const SURF = { plank: 0, metal: 1, thatch: 2, plain: 3, rope: 4, glass: 5 } as const

export class Kit {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; aux: number[] = []; idx: number[] = []
  m = new THREE.Matrix4()
  private stack: THREE.Matrix4[] = []
  private v = new THREE.Vector3(); private n = new THREE.Vector3(); private nm = new THREE.Matrix3()
  push(m: THREE.Matrix4) { this.stack.push(this.m.clone()); this.m.multiply(m); return this }
  at(x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0) {
    return this.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')), new THREE.Vector3(1, 1, 1)))
  }
  pop() { this.m = this.stack.pop()!; return this }
  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: number[], u: number, w: number, type: number) {
    this.v.set(x, y, z).applyMatrix4(this.m)
    this.nm.setFromMatrix4(this.m)
    this.n.set(nx, ny, nz).applyMatrix3(this.nm).normalize()
    this.pos.push(this.v.x, this.v.y, this.v.z); this.nrm.push(this.n.x, this.n.y, this.n.z); this.col.push(c[0], c[1], c[2]); this.aux.push(u, w, type)
    return this.pos.length / 3 - 1
  }
  // box centred at (cx,cy,cz). Planks run along the box's longest side.
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: number[], type: number = SURF.plank) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2
    const faces: [number[], number[], number[]][] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ]
    const h = [hx, hy, hz]
    for (const [n, a, b] of faces) {
      const la = Math.abs(a[0]) * sx + Math.abs(a[1]) * sy + Math.abs(a[2]) * sz, lb = Math.abs(b[0]) * sx + Math.abs(b[1]) * sy + Math.abs(b[2]) * sz
      const ids: number[] = []
      for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 1, 2].map((k) => n[k] * h[k] + a[k] * h[k] * sa + b[k] * h[k] * sb)
        const ua = (sa * la) / 2, ub = (sb * lb) / 2
        // aux = (across the planks, along the planks)
        ids.push(this.vert(cx + p[0], cy + p[1], cz + p[2], n[0], n[1], n[2], c, la >= lb ? ub : ua, la >= lb ? ua : ub, type))
      }
      this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3])
    }
    return this
  }
  // round post or log between two points
  cyl(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r0: number, r1: number, c: number[], type: number = SURF.plain, sides = 7, cap = true) {
    const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0), len = d.length(); d.normalize()
    const up = Math.abs(d.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const s1 = new THREE.Vector3().crossVectors(d, up).normalize(), s2 = new THREE.Vector3().crossVectors(s1, d).normalize()
    const base = this.pos.length / 3
    for (let j = 0; j < 2; j++) for (let i = 0; i < sides; i++) {
      const th = (i / sides) * Math.PI * 2, cx = Math.cos(th), sx = Math.sin(th), r = j ? r1 : r0
      const nx = s1.x * cx + s2.x * sx, ny = s1.y * cx + s2.y * sx, nz = s1.z * cx + s2.z * sx
      this.vert((j ? x1 : x0) + nx * r, (j ? y1 : y0) + ny * r, (j ? z1 : z0) + nz * r, nx, ny, nz, c, th * r0, j * len, type)
    }
    for (let i = 0; i < sides; i++) { const a = base + i, b = base + ((i + 1) % sides); this.idx.push(a, a + sides, b + sides, a, b + sides, b) }
    if (cap) for (let j = 0; j < 2; j++) {
      const c0 = this.vert(j ? x1 : x0, j ? y1 : y0, j ? z1 : z0, j ? d.x : -d.x, j ? d.y : -d.y, j ? d.z : -d.z, c.map((q) => q * 0.8), 0, 0, type)
      for (let i = 0; i < sides; i++) { const a = base + j * sides + i, b = base + j * sides + ((i + 1) % sides); if (j) this.idx.push(a, c0, b); else this.idx.push(a, b, c0) }
    }
    return this
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.aux, 3))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    return g
  }
}

// One material for everything built from the kit. `floating` pieces ride the water level in the vertex shader.
export function kitMaterial(floating: boolean): THREE.Material {
  const m = new PaintedMaterial({ wrap: 0.35, pools: true })
  const aux = attribute('aux', 'vec3'), vc = attribute('color', 'vec3')
  if (floating) {
    m.positionNode = Fn(() => {
      // the raft rides the river and dips and tilts a little under a footstep
      const tilt = positionLocal.x.mul(U.raft.x).add(positionLocal.z.mul(U.raft.z))
      return vec3(positionLocal.x, positionLocal.y.add(U.water).add(U.raft.y).add(tilt), positionLocal.z)
    })()
  }
  m.colorNode = Fn(() => {
    const type = aux.z
    const across = aux.x, along = aux.y
    // planks: seams every 16 cm, each plank its own tone, long grain streaks
    const pid = floor(across.div(0.16))
    const seam = smoothstep(0.455, 0.5, abs(fract(across.div(0.16)).sub(0.5)))
    const tone = noise(vec2(pid.mul(0.137), pid.mul(0.071).add(positionWorld.y.mul(0.01)))).r
    const grain = noise(vec2(across.mul(1.7), along.mul(0.12))).a
    const plank = vc.mul(tone.mul(0.55).add(0.7)).mul(grain.mul(0.35).add(0.82)).mul(seam.mul(0.55).oneMinus())
    // corrugated sheet: ridges, rust creeping from the edges
    const ridge = sin(across.mul(38)).mul(0.5).add(0.5)
    const rust = smoothstep(0.55, 0.8, noise(vec2(across.mul(0.4), along.mul(0.25))).r)
    const metal = mix(vc.mul(ridge.mul(0.3).add(0.78)), vec3(0.3, 0.14, 0.08), rust.mul(0.5))
    // thatch: layered strokes
    const th = noise(vec2(across.mul(2.6), along.mul(0.22))).a
    const layer = fract(along.mul(1.6))
    const thatch = vc.mul(th.mul(0.6).add(0.6)).mul(mix(float(0.7), float(1.08), layer))
    let col: any = mix(plank, metal, smoothstep(0.5, 0.51, type).mul(smoothstep(1.51, 1.5, type)))
    col = mix(col, thatch, smoothstep(1.5, 1.51, type).mul(smoothstep(2.51, 2.5, type)))
    col = mix(col, vc, smoothstep(2.5, 2.51, type))
    const stained = floodStain(col, tone)
    // lamp glass glows when the lamps are lit
    const glass = smoothstep(4.5, 4.51, type)
    return mix(floating ? col : stained, vc, glass)
  })()
  m.emissiveNode = Fn(() => vc.mul(smoothstep(4.5, 4.51, aux.z)).mul(envUniforms.lampGlow.mul(5)))()
  return m
}
