// Instanced fields with per-cell culling. Each field (trunks, crowns, saplings...) is a handful of draws:
// one per detail step. Every frame the visible 50 m cells are packed into the instance buffers, with no
// allocation; the buffers are only re-uploaded when the set of visible cells changes.
import * as THREE from 'three/webgpu'
import { CELLS, CELL_M, CELL_ORIGIN, type FieldData } from './forestCook'

export type LodSpec = { geometry: THREE.BufferGeometry; material: THREE.Material; near: number; far: number; shadow?: boolean }
type Lod = { mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry; A: THREE.InstancedBufferAttribute; B: THREE.InstancedBufferAttribute; near: number; far: number; sig: number; count: number }

const box = new THREE.Box3()
// which cells are in view this frame (shared by all fields), and their distance to the eye
export const cellVis = { dist: new Float32Array(CELLS * CELLS), inView: new Uint8Array(CELLS * CELLS) }
export function updateCellVisibility(frustum: THREE.Frustum, ex: number, ez: number) {
  for (let cz = 0; cz < CELLS; cz++) for (let cx = 0; cx < CELLS; cx++) {
    const x0 = CELL_ORIGIN + cx * CELL_M, z0 = CELL_ORIGIN + cz * CELL_M
    const dx = Math.max(x0 - ex, 0, ex - (x0 + CELL_M)), dz = Math.max(z0 - ez, 0, ez - (z0 + CELL_M))
    const i = cz * CELLS + cx
    cellVis.dist[i] = Math.hypot(dx, dz)
    box.min.set(x0 - 8, -8, z0 - 8); box.max.set(x0 + CELL_M + 8, 56, z0 + CELL_M + 8)
    cellVis.inView[i] = frustum.intersectsBox(box) ? 1 : 0
  }
}

export class Field {
  lods: Lod[] = []
  total: number
  private a: Float32Array; private b: Float32Array
  private aCell: Float32Array[] = []; private bCell: Float32Array[] = []
  private cellCount: Uint32Array
  constructor(public name: string, fd: FieldData, specs: LodSpec[], group: THREE.Object3D, private shadowReach = 0) {
    const n = (this.total = fd.data.length / 8)
    this.a = new Float32Array(n * 4); this.b = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { this.a[i * 4 + k] = fd.data[i * 8 + k]; this.b[i * 4 + k] = fd.data[i * 8 + 4 + k] }
    this.cellCount = new Uint32Array(CELLS * CELLS)
    for (let c = 0; c < CELLS * CELLS; c++) {
      const s = fd.cellStart[c], e = fd.cellStart[c + 1]
      this.cellCount[c] = e - s
      this.aCell.push(this.a.subarray(s * 4, e * 4)); this.bCell.push(this.b.subarray(s * 4, e * 4))
    }
    for (const sp of specs) {
      const geo = new THREE.InstancedBufferGeometry()
      geo.index = sp.geometry.index
      for (const k in sp.geometry.attributes) geo.setAttribute(k, sp.geometry.attributes[k])
      const A = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(4, n * 4)), 4)
      const B = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(4, n * 4)), 4)
      A.setUsage(THREE.DynamicDrawUsage); B.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('ia', A); geo.setAttribute('ib', B)
      geo.instanceCount = 0
      const mesh = new THREE.Mesh(geo, sp.material)
      mesh.frustumCulled = false
      mesh.castShadow = !!sp.shadow
      mesh.receiveShadow = true
      mesh.name = `${name}`
      group.add(mesh)
      this.lods.push({ mesh, geo, A, B, near: sp.near, far: sp.far, sig: -1, count: 0 })
    }
  }
  // detail scales every distance (quality controller); cells within shadowReach are kept even when behind the eye
  update(detail: number) {
    const { dist, inView } = cellVis
    for (const L of this.lods) {
      const near = L.near * detail, far = L.far * detail
      let sig = 7, count = 0
      for (let c = 0; c < CELLS * CELLS; c++) {
        const d = dist[c]
        if (this.cellCount[c] === 0 || d >= far || d < near) continue
        if (!inView[c] && d > this.shadowReach) continue
        sig = (Math.imul(sig, 31) + c + 1) | 0
        count += this.cellCount[c]
      }
      if (sig === L.sig) continue
      L.sig = sig
      const A = L.A.array as Float32Array, B = L.B.array as Float32Array
      let o = 0
      for (let c = 0; c < CELLS * CELLS; c++) {
        const d = dist[c]
        if (this.cellCount[c] === 0 || d >= far || d < near) continue
        if (!inView[c] && d > this.shadowReach) continue
        A.set(this.aCell[c], o); B.set(this.bCell[c], o)
        o += this.cellCount[c] * 4
      }
      L.count = count
      L.geo.instanceCount = count
      L.mesh.visible = count > 0
      if (count > 0) {
        L.A.clearUpdateRanges(); L.A.addUpdateRange(0, o); L.A.needsUpdate = true
        L.B.clearUpdateRanges(); L.B.addUpdateRange(0, o); L.B.needsUpdate = true
      }
    }
  }
  drawn() { let n = 0; for (const L of this.lods) n += L.count; return n }
}
