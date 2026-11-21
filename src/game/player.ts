// The boy on foot and in the canoe, and the camera that follows from behind and a little above.
// Plain numbers, no allocation per frame. Never first person; the camera never goes through ground,
// trunks or houses: it is pulled in along its boom until the way is clear.
import * as THREE from 'three/webgpu'
import { input } from './input'
import type { World } from '../world/build'
import { platformAt, resolveBlockers, blockers } from '../world/platforms'
import { LAKE, LAKE_LEVEL, PLAY } from '../world/layout'
import { lakeD } from '../world/terrain'
import { seedInt } from '../world/rng'

export type Mode = 'foot' | 'canoe'
const GRID = 8, GN = Math.ceil(720 / GRID)

export class Player {
  x = 0; y = 0; z = 0; heading = 0 // heading: 0 faces -z (north); positive turns toward +x
  vx = 0; vz = 0; speed = 0
  mode: Mode = 'foot'
  walkPhase = 0; paddlePhase = 0; paddleSide = 1; stroke = 0
  canoe = { x: 0, y: 0, z: 0, heading: 0, vx: 0, vz: 0, spin: 0, roll: 0, visible: true }
  camYaw = 0; camPitch = 0.26; camDist = 3.7; private camDistNow = 3.7
  frozen = false // story scenes can take the controls away
  autoCam = true
  stepped = false; strokeNow = false; surface: 'earth' | 'wood' | 'mud' | 'water' | 'sand' = 'earth'
  switchFade = 0 // > 0 while changing between foot and canoe (screen dips)
  waterY = 0
  private cellStart: Int32Array; private cellItems: Float32Array
  private out = { x: 0, z: 0 }
  private camPos = new THREE.Vector3(); private target = new THREE.Vector3()
  private landPush = 0
  raftDip = 0
  onRaft = false
  canSwitch = true // Roam: wading deep puts him in the canoe; story scenes may lock this

  constructor(private world: World) {
    // spatial grid of solid trunks and posts
    const s = world.solids, n = s.length / 3
    const count = new Int32Array(GN * GN + 1)
    const cell = (x: number, z: number) => Math.min(GN - 1, Math.max(0, Math.floor((z + 360) / GRID))) * GN + Math.min(GN - 1, Math.max(0, Math.floor((x + 360) / GRID)))
    for (let i = 0; i < n; i++) count[cell(s[i * 3], s[i * 3 + 1]) + 1]++
    for (let c = 0; c < GN * GN; c++) count[c + 1] += count[c]
    this.cellStart = count.slice()
    const fill = count.slice(0, GN * GN)
    this.cellItems = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { const d = fill[cell(s[i * 3], s[i * 3 + 1])]++ * 3; this.cellItems[d] = s[i * 3]; this.cellItems[d + 1] = s[i * 3 + 1]; this.cellItems[d + 2] = s[i * 3 + 2] }
  }

  waterAt(x: number, z: number) { return lakeD(x, z, seedInt('terrain')) < 1.3 ? Math.max(LAKE_LEVEL, this.waterY) : this.waterY }
  depthAt(x: number, z: number) { return this.waterAt(x, z) - this.world.hf.at(x, z) }
  groundAt(x: number, z: number, feetY: number) {
    const t = this.world.hf.at(x, z)
    const p = platformAt(x, z, feetY, this.waterY, this.raftDip)
    return p > t ? p : t
  }
  place(x: number, z: number, heading: number, mode: Mode = 'foot') {
    this.x = x; this.z = z; this.heading = heading; this.mode = mode; this.vx = this.vz = 0
    this.y = mode === 'canoe' ? this.waterAt(x, z) : this.groundAt(x, z, 1e9)
    if (mode === 'canoe') { this.canoe.x = x; this.canoe.z = z; this.canoe.heading = heading; this.canoe.vx = this.canoe.vz = 0 }
    this.camYaw = heading
  }

  // push a circle out of trunks, posts and walls
  private collide(x: number, z: number, r: number, feetY: number) {
    const cx = Math.floor((x + 360) / GRID), cz = Math.floor((z + 360) / GRID)
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || j < 0 || i >= GN || j >= GN) continue
      const c = j * GN + i
      for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
        const sx = this.cellItems[k * 3], sz = this.cellItems[k * 3 + 1], sr = this.cellItems[k * 3 + 2] + r
        const dx = x - sx, dz = z - sz, d2 = dx * dx + dz * dz
        if (d2 < sr * sr && d2 > 1e-6) { const d = Math.sqrt(d2); x = sx + (dx / d) * sr; z = sz + (dz / d) * sr }
      }
    }
    resolveBlockers(x, z, r, feetY, this.waterY, this.out)
    const lim = PLAY - 4
    this.out.x = Math.min(lim, Math.max(-lim, this.out.x)); this.out.z = Math.min(lim + 40, Math.max(-lim, this.out.z))
    return this.out
  }

  update(dt: number, waterY: number) {
    this.waterY = waterY
    this.stepped = false; this.strokeNow = false
    if (this.switchFade > 0) this.switchFade = Math.max(0, this.switchFade - dt * 2.2)
    // camera orbit from drag / trackpad
    this.camYaw += input.lookX * 0.0042
    this.camPitch = Math.min(1.15, Math.max(-0.12, this.camPitch + input.lookY * 0.003))
    this.camDist = Math.min(11, Math.max(2.4, this.camDist + input.zoom * 6))
    const moveF = this.frozen ? 0 : input.fwd, moveS = this.frozen ? 0 : input.strafe
    if (this.mode === 'foot') this.updateFoot(dt, moveF, moveS)
    else this.updateCanoe(dt, moveF, moveS)
  }

  private updateFoot(dt: number, f: number, s: number) {
    const hf = this.world.hf
    const mag = Math.min(1, Math.hypot(f, s))
    let want = 0
    if (mag > 0) {
      // move relative to the camera; the boy turns to face where he goes
      const a = this.camYaw + Math.atan2(s, f)
      let d = a - this.heading
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.heading += d * Math.min(1, dt * 9)
      const depth = this.depthAt(this.x, this.z)
      want = (input.run ? 5.6 : 3.5) * mag * (depth > 0.15 && !this.onRaft ? Math.max(0.45, 1 - depth * 0.7) : 1)
      if (this.autoCam && !input.dragging) { // the camera swings round behind him as he walks
        let cd = this.heading - this.camYaw
        cd = Math.atan2(Math.sin(cd), Math.cos(cd))
        this.camYaw += cd * Math.min(1, dt * 0.7) * mag
      }
    }
    this.speed += (want - this.speed) * Math.min(1, dt * (want > this.speed ? 7 : 10))
    const sx = Math.sin(this.heading), sz = -Math.cos(this.heading)
    let nx = this.x + sx * this.speed * dt, nz = this.z + sz * this.speed * dt
    // too steep to climb: slide along instead (banks are climbed by the steps or the beach)
    const g0 = this.groundAt(this.x, this.z, this.y), g1 = this.groundAt(nx, nz, this.y)
    const run = Math.hypot(nx - this.x, nz - this.z)
    if (run > 1e-5 && (g1 - g0) / run > 1.15 && platformAt(nx, nz, this.y, this.waterY, this.raftDip) < g1 - 0.01) {
      const e = 0.6
      const gx = hf.at(this.x + e, this.z) - hf.at(this.x - e, this.z), gz = hf.at(this.x, this.z + e) - hf.at(this.x, this.z - e)
      const gl = Math.hypot(gx, gz) || 1
      const dot = ((nx - this.x) * gx + (nz - this.z) * gz) / gl
      if (dot > 0) { nx -= (gx / gl) * dot; nz -= (gz / gl) * dot }
      this.speed *= 0.9
    }
    const c = this.collide(nx, nz, 0.3, this.y)
    this.vx = (c.x - this.x) / Math.max(dt, 1e-4); this.vz = (c.z - this.z) / Math.max(dt, 1e-4)
    this.x = c.x; this.z = c.z
    const gy = this.groundAt(this.x, this.z, this.y)
    this.onRaft = false
    for (let i = 0; i < 1; i++) { const p = platformAt(this.x, this.z, this.y, this.waterY, this.raftDip); if (p > hf.at(this.x, this.z) && p >= gy - 0.01) { this.surface = 'wood'; this.onRaft = Math.abs(p - (this.waterY + 0.36 + this.raftDip)) < 0.05 } else this.surface = this.depthAt(this.x, this.z) > 0.03 ? 'water' : hf.at(this.x, this.z) < 3 ? 'mud' : 'earth' }
    // feet follow the ground, falling is quick but not instant
    this.y = gy > this.y ? this.y + (gy - this.y) * Math.min(1, dt * 18) : Math.max(gy, this.y - dt * 9)
    const moved = Math.hypot(this.vx, this.vz)
    const before = Math.floor(this.walkPhase / Math.PI)
    this.walkPhase += moved * dt * 2.6
    if (Math.floor(this.walkPhase / Math.PI) !== before && moved > 0.5) this.stepped = true
    // wading deep: into the canoe (it is tied wherever the water's edge now is)
    if (this.canSwitch && this.depthAt(this.x, this.z) > 0.8 && !this.onRaft && this.surface !== 'wood') this.toCanoe()
  }

  toCanoe() {
    this.mode = 'canoe'; this.switchFade = 1
    this.canoe.x = this.x; this.canoe.z = this.z; this.canoe.heading = this.heading; this.canoe.vx = this.canoe.vz = 0; this.canoe.spin = 0
    this.y = this.waterAt(this.x, this.z)
  }
  toFoot(x: number, z: number) {
    this.mode = 'foot'; this.switchFade = 1
    this.x = x; this.z = z; this.y = this.groundAt(x, z, 1e9); this.speed = 0
  }

  private updateCanoe(dt: number, f: number, s: number) {
    const c = this.canoe, hf = this.world.hf
    // strokes: forward paddling comes in pulses, alternating sides; turning is a sweep on one side
    const paddling = f !== 0 || s !== 0
    if (paddling) {
      const before = Math.floor(this.paddlePhase)
      this.paddlePhase += dt * (input.run ? 1.5 : 1.15)
      if (Math.floor(this.paddlePhase) !== before) { this.paddleSide = s !== 0 ? (s > 0 ? -1 : 1) : -this.paddleSide; this.strokeNow = true }
    }
    const ph = this.paddlePhase % 1
    this.stroke = paddling ? Math.max(0, Math.sin(ph * Math.PI)) : this.stroke * Math.max(0, 1 - dt * 4)
    const power = paddling ? 0.35 + 0.9 * this.stroke : 0
    c.spin += (s * 1.15 * (0.5 + 0.5 * power) + (f > 0 ? this.paddleSide * 0.05 * this.stroke : 0) - c.spin) * Math.min(1, dt * 2.5)
    c.heading += c.spin * dt
    const hx = Math.sin(c.heading), hz = -Math.cos(c.heading)
    const thrust = f * power * (input.run ? 5.2 : 3.8) * (f < 0 ? 0.6 : 1)
    c.vx += hx * thrust * dt; c.vz += hz * thrust * dt
    // the hull runs along its keel: sideways speed dies quickly, forward speed slowly
    const fwdV = c.vx * hx + c.vz * hz, sideV = c.vx * -hz + c.vz * hx
    const nf = fwdV * Math.max(0, 1 - dt * 0.55), ns = sideV * Math.max(0, 1 - dt * 3.2)
    c.vx = hx * nf - hz * ns; c.vz = hz * nf + hx * ns
    let nx = c.x + c.vx * dt, nz = c.z + c.vz * dt
    // shallows and banks stop the hull
    const wy = this.waterAt(nx, nz)
    if (wy - hf.at(nx, nz) < 0.22) {
      const e = 1.0
      const gx = hf.at(c.x + e, c.z) - hf.at(c.x - e, c.z), gz = hf.at(c.x, c.z + e) - hf.at(c.x, c.z - e)
      const gl = Math.hypot(gx, gz) || 1
      const dot = (c.vx * gx + c.vz * gz) / gl
      if (dot > 0) { c.vx -= (gx / gl) * dot; c.vz -= (gz / gl) * dot }
      c.vx *= 0.9; c.vz *= 0.9
      nx = c.x + c.vx * dt; nz = c.z + c.vz * dt
      if (this.waterAt(nx, nz) - hf.at(nx, nz) < 0.16) { nx = c.x; nz = c.z }
      // keep pushing at the shore and he steps out
      this.landPush = f > 0 ? this.landPush + dt : 0
      if (this.canSwitch && this.landPush > 0.45) {
        const lx = c.x + hx * 2.4, lz = c.z + hz * 2.4
        if (this.depthAt(lx, lz) < 0.45 && Math.abs(hf.at(lx, lz) - wy) < 2.2) { this.landPush = 0; c.vx = c.vz = 0; this.toFoot(lx, lz); this.heading = c.heading; return }
      }
    } else this.landPush = 0
    const col = this.collide(nx, nz, 0.55, wy - 0.3)
    if (Math.abs(col.x - nx) + Math.abs(col.z - nz) > 1e-4) { c.vx *= 0.6; c.vz *= 0.6 }
    c.x = col.x; c.z = col.z
    c.y = this.waterAt(c.x, c.z)
    c.roll += (-c.spin * 0.12 + this.paddleSide * this.stroke * 0.035 - c.roll) * Math.min(1, dt * 4)
    this.x = c.x; this.z = c.z; this.y = c.y; this.heading = c.heading
    this.vx = c.vx; this.vz = c.vz; this.speed = Math.hypot(c.vx, c.vz)
    if (this.autoCam && !input.dragging) {
      let cd = c.heading - this.camYaw
      cd = Math.atan2(Math.sin(cd), Math.cos(cd))
      this.camYaw += cd * Math.min(1, dt * 1.1)
    }
  }

  // ---- camera
  private blocked(x: number, y: number, z: number): boolean {
    const hf = this.world.hf
    if (y < hf.at(x, z) + 0.35) return true
    if (y < this.waterAt(x, z) + 0.25) return true
    const cx = Math.floor((x + 360) / GRID), cz = Math.floor((z + 360) / GRID)
    if (cx >= 0 && cz >= 0 && cx < GN && cz < GN) {
      const c = cz * GN + cx
      for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
        const dx = x - this.cellItems[k * 3], dz = z - this.cellItems[k * 3 + 1], r = this.cellItems[k * 3 + 2] + 0.3
        if (dx * dx + dz * dz < r * r) return true
      }
    }
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i], off = b.floats ? this.waterY : 0
      if (y < b.y0 + off - 0.2 || y > b.y1 + off + 0.9) continue
      const dx = x - b.x, dz = z - b.z, co = Math.cos(b.rot), si = Math.sin(b.rot)
      if (Math.abs(dx * co + dz * si) < b.hx + 0.35 && Math.abs(-dx * si + dz * co) < b.hz + 0.35) return true
    }
    return false
  }
  updateCamera(dt: number, camera: THREE.PerspectiveCamera) {
    const canoe = this.mode === 'canoe'
    const want = this.camDist * (canoe ? 1.5 : 1)
    const ty = this.y + (canoe ? 1.15 : 1.45)
    this.target.set(this.x, ty, this.z)
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch)
    const bx = -Math.sin(this.camYaw) * cp, by = sp, bz = Math.cos(this.camYaw) * cp
    // walk the boom outwards until something is in the way
    let free = want
    for (let d = 0.6; d <= want; d += 0.3) { if (this.blocked(this.x + bx * d, ty + by * d + 0.25, this.z + bz * d)) { free = Math.max(1.3, d - 0.35); break } }
    this.camDistNow += (free - this.camDistNow) * Math.min(1, dt * (free < this.camDistNow ? 14 : 2.5))
    const d = this.camDistNow
    this.camPos.set(this.x + bx * d, ty + by * d + 0.25, this.z + bz * d)
    const floor = Math.max(this.world.hf.at(this.camPos.x, this.camPos.z) + 0.4, this.waterAt(this.camPos.x, this.camPos.z) + 0.3)
    if (this.camPos.y < floor) this.camPos.y = floor
    camera.position.lerp(this.camPos, Math.min(1, dt * 12))
    camera.lookAt(this.target.x, this.target.y + 0.1, this.target.z)
  }
}
void LAKE
