// Hero pieces modelled in Blender (tools/blender), carried in the bundle as bytes: boats, paddles, the
// surfboard, the giant fish; plus small things made by code: the hand lamp, the orb, a line, the net floats.
import * as THREE from 'three/webgpu'
import { Fn, attribute, vec3, float, mix, sin, positionLocal, positionWorld, smoothstep } from './tsl'
import boatsUrl from '../assets/models/boats.glb?inline'
import fishUrl from '../assets/models/fish.glb?inline'
import peopleUrl from '../assets/models/people.glb?inline'
import { b64ToBytes, parseGlb, mergeGeos } from './glb'
import { PaintedMaterial, noise } from './shade'
import { U } from './uniforms'
import { envUniforms } from './env'
import { Kit, SURF, kitMaterial } from './kit'

export type Boat = { kind: string; mesh: THREE.Mesh; x: number; z: number; y: number; heading: number; roll: number; pitch: number; visible: boolean; float: boolean; seed: number; lift: number }

export class Props {
  kit: Record<string, THREE.BufferGeometry>
  fishGeo: THREE.BufferGeometry
  boats: Boat[] = []
  paddles: THREE.Mesh[] = []
  board: THREE.Mesh
  lamp: THREE.Mesh
  orb: THREE.Mesh
  line: THREE.Mesh; private linePos: Float32Array
  line2: THREE.Mesh; private line2Pos: Float32Array
  net: THREE.Mesh
  catchFish: THREE.Mesh
  private geo: Record<string, THREE.BufferGeometry>
  private mat: THREE.Material
  private up = new THREE.Vector3(0, 1, 0); private d = new THREE.Vector3(); private q = new THREE.Quaternion()

  constructor(private group: THREE.Object3D) {
    this.geo = parseGlb(b64ToBytes(boatsUrl))
    this.kit = parseGlb(b64ToBytes(peopleUrl))
    this.fishGeo = parseGlb(b64ToBytes(fishUrl)).fish
    // skiff and its outboard become one mesh
    if (this.geo.skiff && this.geo.outboard) { const o = this.geo.outboard.clone(); o.translate(0, 0.42, -3.085); this.geo.skiff = mergeGeos([this.geo.skiff, o]) }
    const m = new PaintedMaterial({ wrap: 0.45, pools: true })
    m.colorNode = Fn(() => {
      const vc = attribute('color', 'vec3')
      const brush = noise(positionLocal.xz.mul(1.3).add(positionLocal.y)).a
      // painted wood: brush variation, and a wet dark band at the waterline
      const wet = smoothstep(0.14, 0.02, positionWorld.y.sub(mix(U.water, U.lake, U.boatLake)))
      return vc.mul(brush.mul(0.3).add(0.85)).mul(mix(float(1), float(0.6), wet))
    })()
    this.mat = m
    for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(this.geo.paddle, m); p.visible = false; p.castShadow = true; group.add(p); this.paddles.push(p) }
    this.board = new THREE.Mesh(this.geo.surfboard, m); this.board.visible = false; this.board.castShadow = true; group.add(this.board)
    // hand lamp: a small lantern
    const K = new Kit()
    K.box(0, -0.16, 0, 0.12, 0.17, 0.12, [1.0, 0.72, 0.36], SURF.glass)
    K.box(0, -0.06, 0, 0.14, 0.03, 0.14, [0.08, 0.08, 0.08], SURF.plain); K.box(0, -0.26, 0, 0.14, 0.03, 0.14, [0.08, 0.08, 0.08], SURF.plain)
    K.cyl(0, -0.05, 0, 0, 0.0, 0, 0.012, 0.012, [0.08, 0.08, 0.08], SURF.plain, 4)
    this.lamp = new THREE.Mesh(K.build(), kitMaterial(false)); this.lamp.visible = false; group.add(this.lamp)
    // the orb: a small glowing device
    const om = new THREE.MeshBasicNodeMaterial({ fog: false })
    om.colorNode = Fn(() => U.orbCol.mul(mix(float(0.5), float(2.2), U.orb.w.div(3).clamp())).add(vec3(0.05, 0.08, 0.1)))()
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6), om); this.orb.visible = false; group.add(this.orb)
    // two lines (rope): 12 points each, rebuilt when their ends move
    const mkLine = () => {
      const g = new THREE.BufferGeometry(), n = 13 * 3
      const pos = new Float32Array(n * 3), idx: number[] = []
      for (let j = 0; j < 12; j++) for (let i = 0; i < 3; i++) { const a = j * 3 + i, b = j * 3 + ((i + 1) % 3); idx.push(a, a + 3, b + 3, a, b + 3, b) }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx)
      const lm = new PaintedMaterial({ wrap: 1, pools: false }); lm.colorNode = Fn(() => vec3(0.5, 0.43, 0.3))()
      const mesh = new THREE.Mesh(g, lm); mesh.frustumCulled = false; mesh.visible = false; group.add(mesh)
      return { mesh, pos }
    }
    const l1 = mkLine(), l2 = mkLine()
    this.line = l1.mesh; this.linePos = l1.pos; this.line2 = l2.mesh; this.line2Pos = l2.pos
    // the net: a row of floats and a sagging skirt (seen at the surface only)
    const N = new Kit()
    for (let i = 0; i < 14; i++) { const x = (i - 6.5) * 0.9; N.cyl(x - 0.1, 0.02, 0, x + 0.1, 0.02, 0, 0.06, 0.06, [0.85, 0.78, 0.6], SURF.plain, 6) }
    N.box(0, -0.25, 0, 12.4, 0.5, 0.01, [0.2, 0.26, 0.24], SURF.plain)
    this.net = new THREE.Mesh(N.build(), kitMaterial(true)); this.net.visible = false; this.net.frustumCulled = false; group.add(this.net)
    // the catch: the great fish, carried
    const fm = new PaintedMaterial({ wrap: 0.5, pools: true }); fm.colorNode = Fn(() => attribute('color', 'vec3'))()
    this.catchFish = new THREE.Mesh(this.fishGeo, fm); this.catchFish.visible = false; this.catchFish.castShadow = true; group.add(this.catchFish)
    void sin; void envUniforms
  }

  addBoat(kind: 'canoe' | 'canoe_long' | 'skiff', x: number, z: number, heading: number, seed = 0): Boat {
    const mesh = new THREE.Mesh(this.geo[kind], this.mat)
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false
    this.group.add(mesh)
    const b: Boat = { kind, mesh, x, z, y: 0, heading, roll: 0, pitch: 0, visible: true, float: true, seed, lift: 0 }
    this.boats.push(b)
    return b
  }

  update(clock: number, waterAt: (x: number, z: number) => number, groundAt: (x: number, z: number) => number) {
    for (const b of this.boats) {
      b.mesh.visible = b.visible
      if (!b.visible) continue
      const wy = waterAt(b.x, b.z), g = groundAt(b.x, b.z)
      // afloat where there is water under it, otherwise resting on the mud
      const afloat = wy - g > 0.16
      if (b.float) b.y = afloat ? wy + Math.sin(clock * 1.1 + b.seed * 7) * 0.012 : g + 0.13
      const rest = afloat ? 0 : 0.14
      b.mesh.position.set(b.x, b.y + b.lift, b.z)
      b.mesh.rotation.set(b.pitch + (afloat ? Math.sin(clock * 0.9 + b.seed * 3) * 0.012 : 0), Math.PI - b.heading, b.roll + rest + (afloat ? Math.sin(clock * 1.3 + b.seed * 5) * 0.02 : 0), 'YXZ')
    }
  }

  // put a paddle through two hands (upper hand, lower hand)
  holdPaddle(i: number, upper: THREE.Vector3, lower: THREE.Vector3) {
    const p = this.paddles[i]
    p.visible = true
    this.d.subVectors(upper, lower).normalize()
    this.q.setFromUnitVectors(this.up, this.d)
    p.quaternion.copy(this.q); p.position.copy(lower)
  }
  setLine(which: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number) {
    const pos = which ? this.line2Pos : this.linePos, mesh = which ? this.line2 : this.line
    mesh.visible = true
    let o = 0
    for (let j = 0; j <= 12; j++) {
      const u = j / 12
      const x = ax + (bx - ax) * u, z = az + (bz - az) * u, y = ay + (by - ay) * u - Math.sin(u * Math.PI) * sag
      for (let i = 0; i < 3; i++) { const th = i * 2.094; pos[o++] = x + Math.cos(th) * 0.014; pos[o++] = y + Math.sin(th) * 0.014; pos[o++] = z }
    }
    mesh.geometry.attributes.position.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  }
}
