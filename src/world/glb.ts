// A tiny reader for our own .glb hero models: named meshes with POSITION, NORMAL, COLOR_0 and indices.
// The models sit in the bundle as bytes (base64) and are parsed from memory: nothing is fetched at run time.
import * as THREE from 'three/webgpu'

export function b64ToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function parseGlb(bytes: Uint8Array): Record<string, THREE.BufferGeometry> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb')
  const jsonLen = dv.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)))
  const binStart = 20 + jsonLen + 8
  const acc = (i: number) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView]
    const comps = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]
    const off = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0)
    const size = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType]
    const stride = bv.byteStride || comps * size
    const out = new Float32Array(a.count * comps)
    for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) {
      const p = off + k * stride + c * size
      let v = a.componentType === 5126 ? dv.getFloat32(p, true) : a.componentType === 5125 ? dv.getUint32(p, true) : a.componentType === 5123 ? dv.getUint16(p, true) : a.componentType === 5121 ? dv.getUint8(p) : a.componentType === 5122 ? dv.getInt16(p, true) : dv.getInt8(p)
      if (a.normalized) v /= a.componentType === 5123 ? 65535 : a.componentType === 5121 ? 255 : a.componentType === 5122 ? 32767 : 127
      out[k * comps + c] = v
    }
    return { data: out, comps, count: a.count as number }
  }
  const res: Record<string, THREE.BufferGeometry> = {}
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), t = new THREE.Vector3(), s = new THREE.Vector3()
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue
    const mesh = json.meshes[node.mesh]
    const geos: THREE.BufferGeometry[] = []
    for (const prim of mesh.primitives) {
      const g = new THREE.BufferGeometry()
      const P = acc(prim.attributes.POSITION)
      g.setAttribute('position', new THREE.BufferAttribute(P.data, 3))
      if (prim.attributes.NORMAL !== undefined) g.setAttribute('normal', new THREE.BufferAttribute(acc(prim.attributes.NORMAL).data, 3))
      const col = new Float32Array(P.count * 3).fill(1)
      if (prim.attributes.COLOR_0 !== undefined) { const C = acc(prim.attributes.COLOR_0); for (let i = 0; i < P.count; i++) for (let c = 0; c < 3; c++) col[i * 3 + c] = C.data[i * C.comps + c] }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      if (prim.attributes.TEXCOORD_0 !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(acc(prim.attributes.TEXCOORD_0).data, 2))
      if (prim.indices !== undefined) { const I = acc(prim.indices); g.setIndex(new THREE.BufferAttribute(P.count > 65535 ? Uint32Array.from(I.data) : Uint16Array.from(I.data), 1)) }
      if (!g.attributes.normal) g.computeVertexNormals()
      geos.push(g)
    }
    let g = geos[0]
    if (geos.length > 1) g = mergeGeos(geos)
    if (node.matrix) g.applyMatrix4(m.fromArray(node.matrix))
    else if (node.translation || node.rotation || node.scale) {
      t.fromArray(node.translation || [0, 0, 0]); q.fromArray(node.rotation || [0, 0, 0, 1]); s.fromArray(node.scale || [1, 1, 1])
      g.applyMatrix4(m.compose(t, q, s))
    }
    res[node.name || mesh.name] = g
  }
  return res
}

export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count }
  const names = Object.keys(geos[0].attributes)
  const out = new THREE.BufferGeometry()
  const arrays: Record<string, Float32Array> = {}
  for (const n of names) arrays[n] = new Float32Array(nv * geos[0].attributes[n].itemSize)
  const idx = new Uint32Array(ni)
  let vo = 0, io = 0
  for (const g of geos) {
    const c = g.attributes.position.count
    for (const n of names) { const a = g.attributes[n]; if (a) arrays[n].set(a.array as Float32Array, vo * a.itemSize) }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo
    else for (let i = 0; i < c; i++) idx[io++] = i + vo
    vo += c
  }
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(arrays[n], geos[0].attributes[n].itemSize))
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  return out
}
