// Shapes made by code: trunks, leaf clumps, plants, palms, logs, roots. Each is a small BufferGeometry
// with position, normal and one extra vec3 ("aux") that the shaders use for bending, shading and wind.
import * as THREE from 'three/webgpu'
import { rng, type Rng } from './rng'

export class GB {
  pos: number[] = []; nrm: number[] = []; aux: number[] = []; idx: number[] = []
  get n() { return this.pos.length / 3 }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, a = 0, b = 0, c = 0) {
    const l = Math.hypot(nx, ny, nz) || 1
    this.pos.push(x, y, z); this.nrm.push(nx / l, ny / l, nz / l); this.aux.push(a, b, c)
    return this.n - 1
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c) }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d) }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3))
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.aux, 3))
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    return g
  }
  // a tube along a list of points with radii; aux = (auxA, t along, auxC)
  tube(pts: [number, number, number][], radii: number[], sides: number, auxA = 0, auxC = 0, capEnd = false) {
    const base = this.n
    const up = new THREE.Vector3(), t = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3()
    for (let j = 0; j < pts.length; j++) {
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)]
      t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
      up.set(0, 1, 0); if (Math.abs(t.y) > 0.9) up.set(1, 0, 0)
      s1.crossVectors(t, up).normalize(); s2.crossVectors(s1, t).normalize()
      for (let i = 0; i < sides; i++) {
        const th = (i / sides) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th)
        const nx = s1.x * c + s2.x * s, ny = s1.y * c + s2.y * s, nz = s1.z * c + s2.z * s
        this.v(pts[j][0] + nx * radii[j], pts[j][1] + ny * radii[j], pts[j][2] + nz * radii[j], nx, ny, nz, auxA, j / (pts.length - 1), auxC)
      }
    }
    for (let j = 0; j < pts.length - 1; j++) for (let i = 0; i < sides; i++) {
      const a = base + j * sides + i, b = base + j * sides + ((i + 1) % sides)
      this.quad(a, a + sides, b + sides, b)
    }
    if (capEnd) {
      const e = pts[pts.length - 1], c = this.v(e[0], e[1], e[2], t.x, t.y, t.z, auxA, 1, auxC)
      const lb = base + (pts.length - 1) * sides
      for (let i = 0; i < sides; i++) this.tri(lb + i, c, lb + ((i + 1) % sides))
    }
  }
  // one arching leaf blade from a base point; aux = (t along the leaf, 0..1 across (0.5 = midrib), random)
  leaf(bx: number, by: number, bz: number, ang: number, len: number, width: number, arch: number, droop: number, segs: number, rnd: number, fold = 0) {
    const dx = Math.cos(ang), dz = Math.sin(ang), sx = -dz, sz = dx
    const base = this.n
    const cols = fold > 0 ? 3 : 2
    for (let j = 0; j <= segs; j++) {
      const t = j / segs
      const out = len * t * (1 - 0.15 * t), y = len * (arch * t - droop * t * t)
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(0.98, 0.06 + t * 0.94)), 0.7)
      const slope = arch - 2 * droop * t
      for (let k = 0; k < cols; k++) {
        const u = cols === 2 ? k * 2 - 1 : k - 1
        const lift = cols === 3 && k === 1 ? fold * w : 0
        this.v(bx + dx * out + sx * w * u, by + y + lift, bz + dz * out + sz * w * u, -dx * slope * 0.6 + sx * u * 0.35, 1, -dz * slope * 0.6 + sz * u * 0.35, t, (u + 1) / 2, rnd)
      }
    }
    for (let j = 0; j < segs; j++) for (let k = 0; k < cols - 1; k++) {
      const a = base + j * cols + k
      this.quad(a, a + 1, a + cols + 1, a + cols)
    }
  }
}

// ---- trunk: unit height, unit radius at chest. aux = (root flare weight, height 0..1, 1 on limbs)
export function trunkGeometry(sides: number, rings: number, limbs: number): THREE.BufferGeometry {
  const g = new GB()
  for (let j = 0; j <= rings; j++) {
    const y = Math.pow(j / rings, 1.7)
    const taper = 1 - 0.5 * y
    const flare = Math.exp(-y * 34)
    for (let i = 0; i < sides; i++) {
      const th = (i / sides) * Math.PI * 2
      const lobe = Math.pow(0.5 + 0.5 * Math.cos(th * 3), 2)
      g.v(Math.cos(th) * taper, y, Math.sin(th) * taper, Math.cos(th), flare * 0.8, Math.sin(th), flare * (0.5 + 1.9 * lobe), y, 0)
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
    const a = j * sides + i, b = j * sides + ((i + 1) % sides)
    g.quad(a, a + sides, b + sides, b)
  }
  const r = rng('trunk-limbs')
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + r.range(-0.4, 0.4), y0 = 0.6 + 0.09 * k, reach = r.range(7, 12)
    const pts: [number, number, number][] = [], rad: number[] = []
    for (let s = 0; s <= 3; s++) {
      const t = s / 3
      pts.push([Math.cos(a) * reach * t, y0 + 0.24 * Math.pow(t, 0.8), Math.sin(a) * reach * t]); rad.push(0.42 - 0.26 * t)
    }
    // limb radii are in trunk-radius units sideways but height units up: keep them thin in y by building flat-ish
    g.tube(pts, rad, 5, 0, 1)
    // fix aux.y (height) for limb vertices so bending and bark shading follow the real height
    // the tube's cross-section was built in one unit, but y is in height units and x,z in radius units:
    // squash the ring's y offset so limbs stay round once scaled (a trunk is ~60 radii tall)
    const nv = 4 * 5, start = g.n - nv
    for (let i = start; i < g.n; i++) {
      const cy = pts[Math.floor((i - start) / 5)][1]
      g.pos[i * 3 + 1] = cy + (g.pos[i * 3 + 1] - cy) * 0.017
      g.aux[i * 3 + 1] = g.pos[i * 3 + 1]; g.aux[i * 3 + 2] = 1
    }
  }
  return g.build()
}

// ---- leaf clump: a lumpy solid mass with rounded normals. aux = (lump random, local height -1..1, 0)
export function clumpGeometry(detail: number, seed: string, fringe = 0, fringeSize = 0.2): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, detail)
  const p = ico.attributes.position
  const r = rng(seed)
  // lumps: a few random bump directions
  const bumps: number[][] = []
  for (let i = 0; i < 9; i++) { const v = new THREE.Vector3(r.range(-1, 1), r.range(-0.3, 1), r.range(-1, 1)).normalize(); bumps.push([v.x, v.y, v.z, r.range(0.18, 0.42)]) }
  const g = new GB()
  const map = new Map<string, number>()
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
    let id = map.get(key)
    if (id === undefined) {
      let s = 0.82
      for (const b of bumps) { const d = v.x * b[0] + v.y * b[1] + v.z * b[2]; if (d > 0.55) s += b[3] * Math.pow((d - 0.55) / 0.45, 0.8) }
      const y = v.y < 0 ? v.y * 0.72 : v.y
      id = g.v(v.x * s, y * s, v.z * s, v.x, v.y + 0.3, v.z, s, v.y, 0)
      map.set(key, id)
    }
    g.idx.push(id)
  }
  // leaf sprigs standing off the surface: real little leaves, so the edge of a clump reads as foliage
  // without any cut-out cards (cut-outs are what kills Apple GPUs)
  const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3()
  for (let i = 0; i < fringe; i++) {
    d.set(r.range(-1, 1), r.range(-0.55, 1), r.range(-1, 1)).normalize()
    let s = 0.82
    for (const b of bumps) { const q = d.x * b[0] + d.y * b[1] + d.z * b[2]; if (q > 0.55) s += b[3] * Math.pow((q - 0.55) / 0.45, 0.8) }
    const py = (d.y < 0 ? d.y * 0.72 : d.y) * s, px = d.x * s, pz = d.z * s
    t1.set(-d.z, r.range(-0.3, 0.3), d.x).normalize(); t2.crossVectors(d, t1).normalize()
    const len = fringeSize * r.range(0.8, 1.5), wid = len * r.range(0.32, 0.45)
    // a broad pointed leaf, built with both windings and one outward normal so it is lit the same from either side
    const ox = d.x * len * 0.7 + t2.x * len * 0.5, oy = d.y * len * 0.4 - len * 0.55, oz = d.z * len * 0.7 + t2.z * len * 0.5
    const a = g.v(px - d.x * 0.06, py - d.y * 0.06, pz - d.z * 0.06, d.x, d.y + 0.4, d.z, 1.2, d.y, 0.6)
    const b = g.v(px + ox * 0.45 + t1.x * wid, py + oy * 0.35 + t1.y * wid, pz + oz * 0.45 + t1.z * wid, d.x, d.y + 0.4, d.z, 1.6, d.y, 1)
    const c = g.v(px + ox, py + oy, pz + oz, d.x, d.y + 0.4, d.z, 2.0, d.y, 1)
    const e = g.v(px + ox * 0.45 - t1.x * wid, py + oy * 0.35 - t1.y * wid, pz + oz * 0.45 - t1.z * wid, d.x, d.y + 0.4, d.z, 1.6, d.y, 1)
    g.quad(a, b, c, e); g.quad(a, e, c, b)
  }
  return g.build()
}

// ---- leafy crown clump: a dark inner mass wrapped in many real leaves (two triangles each, no cut-outs).
// The leaves give a broken, leafy edge and catch the light one by one; the core stops the eye seeing through.
// aux = (per-leaf random, local height -1..1, 1 on leaves / 0 on the core)
export function leafClumpGeometry(leaves: number, leafSize: number, coreDetail: number, seed: string): THREE.BufferGeometry {
  const g = new GB(), r = rng(seed)
  const bumps: number[][] = []
  for (let i = 0; i < 9; i++) { const v = new THREE.Vector3(r.range(-1, 1), r.range(-0.3, 1), r.range(-1, 1)).normalize(); bumps.push([v.x, v.y, v.z, r.range(0.18, 0.42)]) }
  const rad = (x: number, y: number, z: number) => { let s = 0.82; for (const b of bumps) { const d = x * b[0] + y * b[1] + z * b[2]; if (d > 0.55) s += b[3] * Math.pow((d - 0.55) / 0.45, 0.8) } return s }
  const ico = new THREE.IcosahedronGeometry(1, coreDetail), p = ico.attributes.position
  const map = new Map<string, number>(), v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
    let id = map.get(key)
    if (id === undefined) { const s = rad(v.x, v.y, v.z) * 0.8; id = g.v(v.x * s, (v.y < 0 ? v.y * 0.7 : v.y) * s, v.z * s, v.x, v.y + 0.2, v.z, 0.5, v.y, 0); map.set(key, id) }
    g.idx.push(id)
  }
  // leaves grow in sprays: a twig leaves the mass, and five or six leaves sit along it in pairs, all hanging
  // the same way. Sprays read as foliage; single scattered leaves read as confetti.
  const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), n = new THREE.Vector3(), tw = new THREE.Vector3(), side = new THREE.Vector3(), ld = new THREE.Vector3()
  const sprays = Math.max(1, Math.round(leaves / 5))
  for (let i = 0; i < sprays; i++) {
    d.set(r.range(-1, 1), r.range(-0.75, 1), r.range(-1, 1)); if (d.y < -0.2 && r() < 0.55) d.y = -d.y; d.normalize()
    const s = rad(d.x, d.y, d.z) * r.range(0.84, 1.02)
    const bx = d.x * s, by = (d.y < 0 ? d.y * 0.7 : d.y) * s, bz = d.z * s
    t1.set(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).cross(d).normalize()
    // the twig runs along the surface and a little outwards, sagging under its leaves
    tw.copy(t1).multiplyScalar(0.8).addScaledVector(d, 0.45).normalize(); tw.y -= r.range(0.1, 0.4); tw.normalize()
    side.crossVectors(tw, d).normalize()
    const twigLen = leafSize * r.range(1.6, 2.4), rnd = r()
    n.set(d.x, d.y + 0.45, d.z).normalize()
    for (let k = 0; k < 5; k++) {
      const t = (k + 0.5) / 5, sg = k % 2 ? 1 : -1
      const px = bx + tw.x * twigLen * t, py = by + tw.y * twigLen * t - t * t * leafSize * 0.35, pz = bz + tw.z * twigLen * t
      // each leaf angles forward off the twig and droops
      ld.copy(side).multiplyScalar(sg * (k === 4 ? 0.15 : 0.8)).addScaledVector(tw, 0.65).normalize(); ld.y -= 0.35; ld.normalize()
      t2.crossVectors(ld, n).normalize()
      const len = leafSize * r.range(0.85, 1.2) * (1 - t * 0.25), wid = len * 0.3
      const a = g.v(px, py, pz, n.x, n.y, n.z, rnd, d.y, 1)
      const b = g.v(px + ld.x * len * 0.45 + t2.x * wid, py + ld.y * len * 0.45 + t2.y * wid + wid * 0.25, pz + ld.z * len * 0.45 + t2.z * wid, n.x + t2.x * 0.35, n.y + 0.1, n.z + t2.z * 0.35, rnd, d.y, 1.15)
      const c = g.v(px + ld.x * len, py + ld.y * len, pz + ld.z * len, n.x + ld.x * 0.3, n.y, n.z + ld.z * 0.3, rnd, d.y, 1.6)
      const e = g.v(px + ld.x * len * 0.45 - t2.x * wid, py + ld.y * len * 0.45 - t2.y * wid + wid * 0.25, pz + ld.z * len * 0.45 - t2.z * wid, n.x - t2.x * 0.35, n.y + 0.1, n.z - t2.z * 0.35, rnd, d.y, 1.15)
      g.quad(a, b, c, e)
    }
  }
  return g.build()
}

export function saplingGeometry(): THREE.BufferGeometry {
  const g = new GB(), r = rng('sapling-shape')
  g.tube([[0, 0, 0], [0.02, 0.5, 0.01], [0, 1, 0]], [0.022, 0.016, 0.008], 3, 0, 0.3)
  for (let i = 0; i < 7; i++) g.leaf(0, 0.42 + i * 0.09, 0, i * 2.4 + r.range(-0.3, 0.3), r.range(0.34, 0.5), r.range(0.085, 0.12), 0.5, 0.75, 3, r())
  return g.build()
}
// a small tree's whole crown as real leaves: sprays of blades in every direction. aux as for leaves.
export function sprayGeometry(): THREE.BufferGeometry {
  const g = new GB(), r = rng('spray-shape')
  for (let i = 0; i < 26; i++) {
    const ang = i * 2.399 + r.range(-0.2, 0.2), tier = (i % 5) / 4
    const y0 = -0.35 + tier * 0.6 + r.range(-0.08, 0.08), rad = 0.12 + (1 - tier) * 0.1
    g.leaf(Math.cos(ang) * rad, y0, Math.sin(ang) * rad, ang, r.range(0.55, 0.95), r.range(0.11, 0.17), 0.25 + tier * 0.9 + r.range(-0.1, 0.1), r.range(0.5, 0.9), 3, r(), 0.2)
  }
  return g.build()
}
export function broadleafGeometry(): THREE.BufferGeometry {
  const g = new GB(), r = rng('broadleaf-shape')
  for (let i = 0; i < 8; i++) g.leaf(0, 0, 0, i * 0.785 + r.range(-0.25, 0.25), r.range(0.8, 1.25), r.range(0.14, 0.2), r.range(1.2, 1.9), r.range(1.0, 1.5), 5, r(), 0.25)
  return g.build()
}
export function tuftGeometry(): THREE.BufferGeometry {
  const g = new GB(), r = rng('tuft-shape')
  for (let i = 0; i < 7; i++) g.leaf(r.range(-0.06, 0.06), 0, r.range(-0.06, 0.06), i * 0.9 + r.range(-0.3, 0.3), r.range(0.3, 0.6), r.range(0.022, 0.034), r.range(1.4, 2.4), r.range(0.9, 1.6), 3, r())
  return g.build()
}
export function palmGeometry(fronds: number, segs: number, fold: boolean): THREE.BufferGeometry {
  const g = new GB(), r = rng('palm-shape')
  for (let i = 0; i < fronds; i++) {
    const ring = i % 3
    g.leaf(0, 0, 0, (i / fronds) * 6.283 * 2.4 + r.range(-0.2, 0.2), r.range(0.85, 1.1), 0.15, [0.95, 0.5, 0.12][ring] + r.range(-0.1, 0.1), [0.85, 0.75, 0.6][ring], segs, r(), fold ? 0.5 : 0)
  }
  return g.build()
}
export function floaterGeometry(): THREE.BufferGeometry {
  const g = new GB(), r = rng('floater-shape')
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9, d = k === 0 ? 0 : r.range(0.22, 0.42), rad = r.range(0.13, 0.2), rnd = r()
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d
    const c = g.v(cx, 0.012, cz, 0, 1, 0, 0, 0.5, rnd)
    const b = g.n
    for (let i = 0; i < 6; i++) { const th = (i / 6) * 6.283 + rnd; g.v(cx + Math.cos(th) * rad, 0.006, cz + Math.sin(th) * rad, Math.cos(th) * 0.3, 1, Math.sin(th) * 0.3, 1, 0.5, rnd) }
    for (let i = 0; i < 6; i++) g.tri(c, b + ((i + 1) % 6), b + i)
  }
  return g.build()
}
// log: lies along +x from 0 to 1, radius 1 (scaled per instance). aux = (0, t, 0)
export function logGeometry(): THREE.BufferGeometry {
  const g = new GB()
  const pts: [number, number, number][] = [], rad: number[] = []
  for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push([t - 0.5, Math.sin(t * 3) * 0.02, Math.sin(t * 5 + 1) * 0.015]); rad.push(1 - 0.25 * t) }
  g.tube(pts, rad, 6, 0, 0, true)
  const c = g.v(-0.5, 0, 0, -1, 0, 0, 0, 0, 0)
  for (let i = 0; i < 6; i++) g.tri(i, (i + 1) % 6, c)
  return g.build()
}
// surface root: runs out along +x from the trunk, dropping from the flare to the ground. aux = (0, t, 0)
export function rootGeometry(): THREE.BufferGeometry {
  const g = new GB()
  const pts: [number, number, number][] = [], rad: number[] = []
  for (let i = 0; i <= 6; i++) {
    const t = i / 6
    pts.push([t, 0.32 * Math.exp(-t * 4.2) + 0.02 * Math.sin(t * 11), 0.06 * Math.sin(t * 7)]); rad.push(0.075 * (1 - 0.85 * t))
  }
  g.tube(pts, rad, 5, 0, 0, true)
  return g.build()
}
// vine: hangs from y = 0 to y = -1. aux = (0, t down, 0)
export function vineGeometry(): THREE.BufferGeometry {
  const g = new GB()
  for (let k = 0; k < 2; k++) {
    const pts: [number, number, number][] = [], rad: number[] = []
    for (let i = 0; i <= 7; i++) { const t = i / 7; pts.push([k * 0.5 + 0.12 * Math.sin(t * 9 + k * 2), -t, 0.12 * Math.cos(t * 7 + k)]); rad.push(0.04 - k * 0.012) }
    g.tube(pts, rad, 4, k, 0)
  }
  return g.build()
}
// hanging bank roots: a cluster that leaves the bank lip along +z and falls to y = -1. aux = (0, t, 0)
export function bankrootGeometry(): THREE.BufferGeometry {
  const g = new GB(), r = rng('bankroot-shape')
  for (let k = 0; k < 5; k++) {
    const pts: [number, number, number][] = [], rad: number[] = []
    const ox = r.range(-0.6, 0.6), l = r.range(0.5, 1), out = r.range(0.25, 0.6)
    for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push([ox + 0.1 * Math.sin(t * 6 + k), -l * t * t - 0.05 * t, out * Math.sqrt(t) + 0.05 * Math.sin(t * 9)]); rad.push(0.045 * (1 - 0.7 * t)) }
    g.tube(pts, rad, 4, 0, 0)
  }
  return g.build()
}
export type { Rng }
