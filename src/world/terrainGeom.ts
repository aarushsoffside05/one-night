// Terrain mesh arrays: the 2 m core grid plus a few widening rings out to the painted distance.
import { CORE, CELL } from './layout'
import { Heightfield, GRID_N } from './terrain'

export function buildTerrainMesh(hf: Heightfield) {
  const ring = [348, 360, 380, 410, 455, 520, 620, 780, 1050, 1500, 2200]
  const axis: number[] = []
  for (let i = ring.length - 1; i >= 0; i--) axis.push(-ring[i])
  for (let i = 0; i < GRID_N; i++) axis.push(-CORE + i * CELL)
  for (let i = 0; i < ring.length; i++) axis.push(ring[i])
  const n = axis.length
  const pos = new Float32Array(n * n * 3), nrm = new Float32Array(n * n * 3)
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = axis[ix], z = axis[iz], i = (iz * n + ix) * 3
    pos[i] = x; pos[i + 1] = hf.at(x, z); pos[i + 2] = z
    const e = 1.2
    const dx = hf.at(x + e, z) - hf.at(x - e, z), dz = hf.at(x, z + e) - hf.at(x, z - e)
    const l = 1 / Math.hypot(dx, 2 * e, dz)
    nrm[i] = -dx * l; nrm[i + 1] = 2 * e * l; nrm[i + 2] = -dz * l
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6)
  let k = 0
  for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) {
    const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1
    idx[k++] = a; idx[k++] = c; idx[k++] = b
    idx[k++] = b; idx[k++] = c; idx[k++] = d
  }
  return { pos, nrm, idx }
}
