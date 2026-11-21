// People: simple stylised figures built from one shared kit of rigid parts, animated by code.
// Everybody lives in ONE skinned mesh (each part bound rigidly to one bone), so all the people together
// cost one draw in the main pass and one in the shadow pass.
import * as THREE from 'three/webgpu'
import { Fn, attribute, texture, uv } from './tsl'
import { PaintedMaterial } from './shade'
import { mergeGeos } from './glb'

// Joint numbers of the kit for the 1.70 m reference figure (from tools/blender/README.md).
export const J = { shoulderX: 0.18, shoulderY: 0.45, neckY: 0.5, hipX: 0.09, hipY: -0.07, upperArm: 0.28, forearm: 0.37, thigh: 0.42, shin: 0.45, waist: 0.94 }

export type Body = 'man_tee' | 'man_shirt' | 'man_long' | 'woman_tee' | 'woman_dress'
export type BodyData = { bin: Uint8Array; meta: { verts: number; tris: number; posScale: number; joints: Record<string, number[]> } }
export type CharDef = { body?: Body; id: string; name: string; height: number; child: number; skin: number[]; shirt: number[]; bottom: number[]; hair: number[]; hairPart: string; hat?: string; hatCol?: number[]; skirt?: boolean; legs?: 'shoe' | 'boot' | 'trousers' | 'trousers_boot'; shoe?: number[] }
const SKIN_A = [0.62, 0.4, 0.27], SKIN_B = [0.5, 0.31, 0.2], SKIN_C = [0.7, 0.48, 0.34]
export const CHARS: CharDef[] = [
  { body: 'man_tee', id: 'davi', name: 'Davi', height: 1.5, child: 0.6, skin: SKIN_C, shirt: [0.16, 0.42, 0.42], bottom: [0.1, 0.1, 0.11], hair: [0.07, 0.045, 0.03], hairPart: 'hair_tuft', legs: 'shoe' },
  { body: 'man_shirt', id: 'tome', name: 'Tomé', height: 1.7, child: 0, skin: SKIN_B, shirt: [0.4, 0.48, 0.32], bottom: [0.3, 0.24, 0.17], hair: [0.08, 0.07, 0.06], hairPart: 'hair_short', hat: 'hat_straw', hatCol: [0.72, 0.6, 0.36], legs: 'trousers_boot', shoe: [0.1, 0.12, 0.1] },
  { body: 'man_tee', id: 'caio', name: 'Caio', height: 1.75, child: 0, skin: SKIN_A, shirt: [0.55, 0.15, 0.13], bottom: [0.09, 0.09, 0.1], hair: [0.05, 0.04, 0.04], hairPart: 'hair_short' },
  { body: 'woman_tee', id: 'lia', name: 'Lia', height: 1.53, child: 0.45, skin: SKIN_A, shirt: [0.93, 0.74, 0.22], bottom: [0.12, 0.4, 0.42], hair: [0.05, 0.04, 0.04], hairPart: 'hair_long' },
  { body: 'man_tee', id: 'nino', name: 'Nino', height: 1.17, child: 1, skin: SKIN_A, shirt: [0.3, 0.62, 0.86], bottom: [0.7, 0.16, 0.13], hair: [0.06, 0.05, 0.04], hairPart: 'hair_tuft' },
  { body: 'woman_dress', id: 'socorro', name: 'Dona Socorro', height: 1.55, child: 0, skin: SKIN_B, shirt: [0.66, 0.56, 0.74], bottom: [0.16, 0.2, 0.4], hair: [0.62, 0.61, 0.6], hairPart: 'hair_bun', skirt: true },
  { body: 'woman_tee', id: 'marta', name: 'Marta', height: 1.62, child: 0, skin: SKIN_A, shirt: [0.9, 0.9, 0.85], bottom: [0.2, 0.36, 0.24], hair: [0.07, 0.05, 0.04], hairPart: 'hair_bun', skirt: true },
  { body: 'man_tee', id: 'rafa', name: 'Rafa', height: 1.78, child: 0, skin: SKIN_C, shirt: [0.85, 0.83, 0.75], bottom: [0.4, 0.4, 0.42], hair: [0.12, 0.08, 0.05], hairPart: 'hair_short', legs: 'shoe' },
  { body: 'woman_tee', id: 'mae', name: 'Davi\'s mother', height: 1.64, child: 0, skin: SKIN_C, shirt: [0.9, 0.5, 0.45], bottom: [0.85, 0.82, 0.74], hair: [0.12, 0.08, 0.05], hairPart: 'hair_long' },
  { body: 'man_long', id: 'pai', name: 'Davi\'s father', height: 1.77, child: 0, skin: SKIN_C, shirt: [0.55, 0.68, 0.85], bottom: [0.25, 0.27, 0.22], hair: [0.1, 0.07, 0.05], hairPart: 'hair_short', hat: 'hat_cap', hatCol: [0.2, 0.25, 0.4], legs: 'trousers' },
]
export const charIndex = (id: string) => CHARS.findIndex((c) => c.id === id)

// pose channels
export const P = { dy: 0, tilt: 1, roll: 2, lean: 3, twist: 4, side: 5, headYaw: 6, headPitch: 7, aLs: 8, aLo: 9, aLe: 10, aRs: 11, aRo: 12, aRe: 13, lLh: 14, lLk: 15, lRh: 16, lRk: 17, spread: 18 } as const
const NP = 19
export type Anim = 'idle' | 'walk' | 'run' | 'paddle' | 'sit' | 'work' | 'crouch' | 'holdLine' | 'carry' | 'lamp' | 'point' | 'stop' | 'liftNet' | 'film' | 'tow' | 'board' | 'reach' | 'wave' | 'lift' | 'gut' | 'ride'

export type Fig = {
  def: CharDef; active: boolean; x: number; y: number; z: number; heading: number
  anim: Anim; phase: number; speed: number; side: number; look: number
  pose: Float32Array; target: Float32Array
  tx: number; tz: number; moving: boolean; arrive: number // walk-to target
  k: number
  j: { waistY: number; waistZ: number; neckY: number; neckZ: number; shX: number; shY: number; shZ: number; ua: number; fa: number; hipX: number; hipY: number; hipZ: number; th: number; sh: number; rest: number[][] }
}

const BONES = ['hips', 'torso', 'head', 'uaL', 'faL', 'uaR', 'faR', 'thL', 'shL', 'thR', 'shR'] as const
const NB = BONES.length

export class Figures {
  figs: Fig[] = []
  mesh: THREE.SkinnedMesh
  private bones: THREE.Bone[] = []
  private m0 = new THREE.Matrix4(); private m1 = new THREE.Matrix4(); private m2 = new THREE.Matrix4(); private t = new THREE.Matrix4()
  private e = new THREE.Euler(); private s = new THREE.Vector3(); private hand = new THREE.Matrix4(); private o = new THREE.Matrix4()
  private fore = [new THREE.Matrix4(), new THREE.Matrix4()]
  private foreM = CHARS.flatMap(() => [new THREE.Matrix4(), new THREE.Matrix4()]); private headM = CHARS.map(() => new THREE.Matrix4())

  constructor(bodies: Record<string, BodyData>, atlas: THREE.Texture, group: THREE.Object3D) {
    const geos: THREE.BufferGeometry[] = []
    CHARS.forEach((def, ci) => {
      const B = bodies[def.id], M = B.meta, J = M.joints as Record<string, number[]>
      // realistic bodies (Microsoft Rocketbox, MIT): 17 bytes a vertex: position, normal, two body segments and a weight, uv into the shared atlas
      const n = M.verts, dv = new DataView(B.bin.buffer, B.bin.byteOffset, B.bin.byteLength)
      const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uvs = new Float32Array(n * 2), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const o = i * 17
        for (let c = 0; c < 3; c++) { pos[i * 3 + c] = (dv.getInt16(o + c * 2, true) / 32767) * M.posScale; nrm[i * 3 + c] = dv.getInt8(o + 6 + c) / 127 }
        const wa = dv.getUint8(o + 12) / 255
        si[i * 4] = ci * NB + dv.getUint8(o + 10); si[i * 4 + 1] = ci * NB + dv.getUint8(o + 11); sw[i * 4] = wa; sw[i * 4 + 1] = 1 - wa
        uvs[i * 2] = dv.getUint16(o + 13, true) / 65535; uvs[i * 2 + 1] = dv.getUint16(o + 15, true) / 65535
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(B.bin.buffer.slice(B.bin.byteOffset + n * 17, B.bin.byteOffset + n * 17 + M.tris * 6)), 1))
      geos.push(g)
      const W = J.Abdomen, sh = J['UpperArm.L'], el = J['LowerArm.L'], pa = J['Palm.L'], hp = J['UpperLeg.L'], kn = J['LowerLeg.L']
      const j = { waistY: W[1], waistZ: W[2], neckY: J.Head[1] - W[1], neckZ: J.Head[2] - W[2], shX: sh[0], shY: sh[1] - W[1], shZ: sh[2] - W[2], ua: el[0] - sh[0], fa: pa[0] - el[0] + 0.07, hipX: hp[0], hipY: hp[1] - W[1], hipZ: hp[2] - W[2], th: hp[1] - kn[1], sh: kn[1],
        rest: [[0, W[1], W[2]], [0, W[1], W[2]], J.Head, sh, el, [-sh[0], sh[1], sh[2]], [-el[0], el[1], el[2]], hp, kn, [-hp[0], hp[1], hp[2]], [-kn[0], kn[1], kn[2]]] }
      this.figs.push({ def, active: false, x: 0, y: -50, z: 0, heading: 0, anim: 'idle', phase: ci * 1.7, speed: 0, side: 1, look: 0, pose: new Float32Array(NP), target: new Float32Array(NP), tx: 0, tz: 0, moving: false, arrive: 0, k: def.height / 1.7, j })
    })
    const geo = mergeGeos(geos)
    const mat = new PaintedMaterial({ wrap: 0.55, pools: true })
    mat.colorNode = Fn(() => texture(atlas, uv()).rgb)()
    this.mesh = new THREE.SkinnedMesh(geo, mat)
    for (let i = 0; i < CHARS.length * NB; i++) { const b = new THREE.Bone(); b.matrixAutoUpdate = false; this.bones.push(b); this.mesh.add(b) }
    this.mesh.bind(new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4())), new THREE.Matrix4())
    this.mesh.frustumCulled = false
    this.mesh.castShadow = true; this.mesh.receiveShadow = true
    group.add(this.mesh)
  }

  get(id: string) { return this.figs[charIndex(id)] }
  show(id: string, x: number, y: number, z: number, heading: number, anim: Anim = 'idle') {
    const f = this.get(id); f.active = true; f.x = x; f.y = y; f.z = z; f.heading = heading; f.anim = anim; f.moving = false
    this.computeTarget(f); f.pose.set(f.target)
    return f
  }
  hide(id: string) { this.get(id).active = false }
  hideAll() { for (const f of this.figs) f.active = false }

  private computeTarget(f: Fig) {
    const T = f.target
    T.fill(0)
    const ph = f.phase, s = Math.sin(ph), c = Math.cos(ph)
    const br = Math.sin(ph * 0.9) * 0.02
    T[P.aLo] = 0.1; T[P.aRo] = 0.1; T[P.lean] = 0.03 + br; T[P.aLe] = 0.15; T[P.aRe] = 0.15
    T[P.headYaw] = f.look
    switch (f.anim) {
      case 'idle': T[P.aLs] = br * 2; T[P.aRs] = -br * 2; T[P.side] = Math.sin(ph * 0.31) * 0.03; T[P.lLh] = 0.02; break
      case 'walk': case 'run': case 'carry': case 'lamp': case 'tow': {
        const a = f.anim === 'run' ? 0.95 : 0.6
        T[P.lLh] = s * a; T[P.lRh] = -s * a
        T[P.lLk] = Math.max(0, -c) * a * 1.5 + 0.08; T[P.lRk] = Math.max(0, c) * a * 1.5 + 0.08
        T[P.aLs] = -s * a * 0.75; T[P.aRs] = s * a * 0.75; T[P.aLe] = 0.35 + (f.anim === 'run' ? 0.9 : 0); T[P.aRe] = T[P.aLe]
        T[P.dy] = -Math.abs(c) * 0.035 * a; T[P.lean] = f.anim === 'run' ? 0.22 : 0.07; T[P.twist] = s * 0.12 * a; T[P.roll] = c * 0.03
        if (f.anim === 'carry') { T[P.aRs] = 2.5; T[P.aRo] = 0.35; T[P.aRe] = 1.5; T[P.aLs] = -s * 0.3; T[P.lean] = 0.1; T[P.side] = -0.07 }
        if (f.anim === 'lamp') { T[P.aRs] = 0.75; T[P.aRo] = 0.25; T[P.aRe] = 0.9 }
        if (f.anim === 'tow') { T[P.aRs] = -0.8; T[P.aRe] = 0.2; T[P.lean] = 0.3 }
        break
      }
      case 'paddle': case 'ride': {
        // seated in the canoe; the paddle goes in on one side, both hands reach forward and pull back
        T[P.dy] = -0.56; T[P.lLh] = 1.45; T[P.lRh] = 1.45; T[P.lLk] = 1.3; T[P.lRk] = 1.3; T[P.spread] = 0.12
        if (f.anim === 'ride') { T[P.aLs] = 0.5; T[P.aRs] = 0.5; T[P.aLe] = 0.9; T[P.aRe] = 0.9; T[P.lean] = 0.08; break }
        const st = Math.sin(ph), sd = f.side
        T[P.lean] = 0.22 + st * 0.2; T[P.twist] = -sd * (0.35 + st * 0.2)
        T[P.aLs] = 1.0 + st * 0.5 + (sd > 0 ? 0.25 : 0); T[P.aRs] = 1.0 + st * 0.5 + (sd < 0 ? 0.25 : 0)
        T[P.aLe] = 0.6 - st * 0.4; T[P.aRe] = 0.6 - st * 0.4; T[P.aLo] = sd > 0 ? 0.5 : -0.15; T[P.aRo] = sd < 0 ? 0.5 : -0.15
        break
      }
      case 'sit': case 'board': T[P.dy] = -0.52; T[P.lLh] = 1.5; T[P.lRh] = 1.5; T[P.lLk] = 1.45; T[P.lRk] = 1.45; T[P.aLs] = 0.5; T[P.aRs] = 0.5; T[P.aLe] = 0.7; T[P.aRe] = 0.7; T[P.lean] = 0.1 + br; if (f.anim === 'board') { T[P.aLo] = 0.5; T[P.aRo] = 0.5; T[P.aLs] = 0.2 + s * 0.15; T[P.aRs] = 0.2 - s * 0.15 } break
      case 'work': case 'gut': // standing at a table, hands busy
        T[P.lean] = 0.3 + Math.sin(ph * 2) * 0.03; T[P.aLs] = 0.75 + Math.sin(ph * 3.1) * 0.12; T[P.aRs] = 0.7 + Math.sin(ph * 2.3 + 1) * 0.2; T[P.aLe] = 1.05; T[P.aRe] = 1.0 + Math.sin(ph * 4.6) * 0.25; T[P.aLo] = -0.05; T[P.aRo] = -0.05; T[P.headPitch] = 0.4; break
      case 'crouch': T[P.dy] = -0.5; T[P.lLh] = 1.7; T[P.lRh] = 1.9; T[P.lLk] = 2.2; T[P.lRk] = 2.3; T[P.lean] = 0.5; T[P.aLs] = 0.9 + s * 0.1; T[P.aRs] = 0.8 - s * 0.1; T[P.aLe] = 0.7; T[P.aRe] = 0.8; T[P.headPitch] = 0.3; break
      case 'holdLine': // braced, both hands on a line, leaning back against it
        T[P.lean] = -0.16 + Math.sin(ph * 2.2) * 0.03; T[P.lLh] = 0.42; T[P.lRh] = -0.3; T[P.lLk] = 0.25; T[P.lRk] = 0.35; T[P.dy] = -0.07; T[P.aLs] = 0.95; T[P.aRs] = 0.8; T[P.aLe] = 0.75; T[P.aRe] = 0.95; T[P.aLo] = -0.12; T[P.aRo] = -0.12; break
      case 'liftNet': case 'lift': { // bend, grip, haul up, again
        const h = Math.sin(ph * 1.6) * 0.5 + 0.5
        T[P.lean] = 0.75 - h * 0.5; T[P.dy] = -0.16 + h * 0.1; T[P.lLk] = 0.5 - h * 0.3; T[P.lRk] = 0.5 - h * 0.3; T[P.lLh] = 0.45 - h * 0.25; T[P.lRh] = 0.45 - h * 0.25
        T[P.aLs] = 0.5 + h * 0.7; T[P.aRs] = 0.5 + h * 0.7; T[P.aLe] = 0.3 + h * 1.0; T[P.aRe] = 0.3 + h * 1.0; T[P.headPitch] = 0.25; break
      }
      case 'point': T[P.aRs] = 1.45; T[P.aRe] = 0.05; T[P.aRo] = 0.05; T[P.twist] = -0.15; break
      case 'reach': T[P.aRs] = 1.1; T[P.aRe] = 0.3; T[P.aLs] = 1.0; T[P.aLe] = 0.35; T[P.lean] = 0.18; break
      case 'stop': T[P.aLs] = 2.75; T[P.aRs] = 2.75; T[P.aLo] = 0.45 + s * 0.35; T[P.aRo] = 0.45 + s * 0.35; T[P.aLe] = 0.15; T[P.aRe] = 0.15; T[P.lean] = -0.05; break
      case 'wave': T[P.aRs] = 2.6; T[P.aRo] = 0.3 + Math.sin(ph * 5) * 0.3; T[P.aRe] = 0.4; break
      case 'film': T[P.aLs] = 1.25; T[P.aRs] = 1.25; T[P.aLe] = 1.55; T[P.aRe] = 1.55; T[P.aLo] = -0.3; T[P.aRo] = -0.3; T[P.headPitch] = -0.05; break
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.figs.length; i++) {
      const f = this.figs[i]
      if (!f.active) { this.m0.makeScale(0, 0, 0).setPosition(0, -200, 0); for (let b = 0; b < NB; b++) this.setBone(i, b, this.m0); continue }
      // walking to a target on its own
      if (f.moving) {
        const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz)
        if (d < Math.max(0.12, f.arrive)) { f.moving = false; f.speed = 0; if (f.anim === 'walk' || f.anim === 'run') f.anim = 'idle' }
        else {
          const want = Math.atan2(dx, -dz)
          let dh = want - f.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh))
          f.heading += dh * Math.min(1, dt * 7)
          const sp = Math.min(f.speed, d / Math.max(dt, 1e-3))
          f.x += Math.sin(f.heading) * sp * dt; f.z -= Math.cos(f.heading) * sp * dt
        }
      }
      const rate = f.anim === 'walk' || f.anim === 'carry' || f.anim === 'lamp' || f.anim === 'tow' ? Math.max(0.4, f.speed) * 2.4 / Math.max(0.6, f.k) : f.anim === 'run' ? 9 : f.anim === 'paddle' ? 3.2 : 1.6
      f.phase += dt * rate
      this.computeTarget(f)
      const k = Math.min(1, dt * 9)
      for (let c = 0; c < NP; c++) f.pose[c] += (f.target[c] - f.pose[c]) * k
      this.solve(i, f)
    }
  }

  private setBone(ci: number, b: number, m: THREE.Matrix4) { const bone = this.bones[ci * NB + b]; bone.matrix.copy(m); bone.matrixWorldNeedsUpdate = true }
  private rot(x: number, y: number, z: number) { this.e.set(x, y, z, 'YXZ'); return this.t.makeRotationFromEuler(this.e) }

  // Each body segment gets one matrix: where its joint frame is now, times the inverse of where it was at rest
  // (arms rest straight out to the sides in these models, so their rest frame is turned a quarter turn).
  private put(ci: number, seg: number, frame: THREE.Matrix4, f: Fig, sx: number, sy: number, arm = 0) {
    const r = f.j.rest[seg]
    this.o.copy(frame).scale(this.s.set(sx, sy, sx))
    if (arm) this.o.multiply(this.t.makeRotationZ(-arm * Math.PI / 2))
    this.o.multiply(this.t.makeTranslation(-r[0], -r[1], -r[2]))
    this.setBone(ci, seg, this.o)
  }
  private solve(ci: number, f: Fig) {
    const p = f.pose, k = f.k, ch = f.def.child, j = f.j
    const limb = k * (1 - ch * 0.05), headS = k * (1 + ch * 0.07)
    const waist = (j.waistY + p[P.dy]) * limb
    this.m0.makeRotationY(Math.PI - f.heading).setPosition(f.x, f.y + waist, f.z)
    this.m0.multiply(this.rot(p[P.tilt], 0, p[P.roll]))
    this.put(ci, 0, this.m0, f, k, limb)
    this.m1.copy(this.m0).multiply(this.rot(p[P.lean], p[P.twist], p[P.side]))
    const torso = this.m2.copy(this.m1)
    this.put(ci, 1, torso, f, k, k)
    this.m1.copy(torso).multiply(this.t.makeTranslation(0, j.neckY * k, j.neckZ * k)).multiply(this.rot(p[P.headPitch] - p[P.lean] * 0.6, p[P.headYaw], 0))
    this.put(ci, 2, this.m1, f, headS, headS)
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd === 0 ? 1 : -1, o = sd === 0 ? P.aLs : P.aRs
      this.m1.copy(torso).multiply(this.t.makeTranslation(sg * j.shX * k, j.shY * k, j.shZ * k)).multiply(this.rot(-p[o], 0, sg * p[o + 1]))
      this.hand.copy(this.m1)
      this.put(ci, 3 + sd * 2, this.m1, f, k, k, sg)
      this.m1.copy(this.hand).multiply(this.t.makeTranslation(0, -j.ua * k, 0)).multiply(this.rot(-p[o + 2], 0, 0))
      this.fore[sd].copy(this.m1)
      this.put(ci, 4 + sd * 2, this.m1, f, k, k, sg)
    }
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd === 0 ? 1 : -1, o = sd === 0 ? P.lLh : P.lRh
      this.m1.copy(this.m0).multiply(this.t.makeTranslation(sg * j.hipX * k, j.hipY * limb, j.hipZ * k)).multiply(this.rot(-p[o], 0, sg * p[P.spread]))
      this.hand.copy(this.m1)
      this.put(ci, 7 + sd * 2, this.m1, f, k, limb)
      this.m1.copy(this.hand).multiply(this.t.makeTranslation(0, -j.th * limb, 0)).multiply(this.rot(p[o + 1], 0, 0))
      this.put(ci, 8 + sd * 2, this.m1, f, k, limb)
    }
    this.headM[ci].copy(this.m2).multiply(this.t.makeTranslation(0, (j.neckY + 0.12) * k, 0))
    this.foreM[ci * 2].copy(this.fore[0]); this.foreM[ci * 2 + 1].copy(this.fore[1])
  }

  // world position of a hand (side: 0 = left, 1 = right), for props held in it
  handPos(id: string, side: number, out: THREE.Vector3) {
    const ci = charIndex(id), f = this.figs[ci]
    return out.set(0, -f.j.fa * f.k * 0.95, 0.02).applyMatrix4(this.foreM[ci * 2 + side]), f
  }
  headPos(id: string, out: THREE.Vector3) { return out.set(0, 0, 0).applyMatrix4(this.headM[charIndex(id)]) }
  walkTo(id: string, x: number, z: number, speed = 1.3, arrive = 0.15, anim: Anim = 'walk') { const f = this.get(id); f.tx = x; f.tz = z; f.speed = speed; f.moving = true; f.arrive = arrive; f.anim = anim; return f }
}
