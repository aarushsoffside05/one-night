// Roam: the family at their work, placed by the water level. Low water: on the ground they use in October.
// When the river covers that ground they are where a family would be: on the house walk, the raft, the canoes.
import * as THREE from 'three/webgpu'
import type { Game } from './Game'
import type { Boat } from '../world/props'
import { PLACES, CHANNEL, HOUSE_FLOOR_Y, YARD_Y, polyAt } from '../world/layout'
import { waterYOf } from '../world/layout'
import { envOut } from '../world/env'

const v = new THREE.Vector3(), v2 = new THREE.Vector3(), pt = { x: 0, z: 0 }

export class Roam {
  school: Boat; lakeCanoe: Boat; tied: Boat; skiff: Boat
  private t = 0; private schoolU = 0.2; private schoolDir = 1
  private caioLeg = 0
  private flooded = false
  constructor(private g: Game) {
    const pr = g.world.props, R = g.world.structures.raft
    this.school = pr.addBoat('canoe_long', -46, 150, 0, 2)
    this.lakeCanoe = pr.addBoat('canoe', PLACES.lakeBank.x + 9, PLACES.lakeBank.z - 3, 1.2, 3)
    this.tied = pr.addBoat('canoe', R.x - 6.4, R.z + 1.5, 0.15, 4)
    this.skiff = pr.addBoat('skiff', -96, 243, 2.6, 5)
    this.enter()
  }
  enter() {
    const f = this.g.world.figures, hf = this.g.world.hf
    f.hideAll()
    f.get('davi').active = true
    const y = (x: number, z: number) => hf.at(x, z)
    f.show('nino', 15.5, y(15.5, 33), 33, 2.2, 'board')
    f.show('lia', 20, y(20, 40), 40, 0.5, 'walk')
    f.show('caio', 112, y(112, -74), -74, 0, 'carry')
    f.show('tome', PLACES.lakeBank.x + 3.2, y(PLACES.lakeBank.x + 3.2, PLACES.lakeBank.z - 1), PLACES.lakeBank.z - 1, 1.6, 'liftNet')
    f.show('socorro', 0, 0, 0, 0, 'gut')
    f.show('marta', 0, 0, 0, 0, 'paddle')
    f.show('rafa', -99, y(-99, 239), 239, 0.4, 'idle')
    f.show('mae', 0, 0, 0, 0, 'ride'); f.show('pai', 0, 0, 0, 0, 'ride')
    this.g.world.props.board.visible = true
  }
  update(dt: number) {
    this.t += dt
    const g = this.g, f = g.world.figures, hf = g.world.hf, p = g.player, pr = g.world.props, cast = g.cast
    const wy = waterYOf(g.water)
    const R = g.world.structures.raft, cR = Math.cos(R.rot), sR = Math.sin(R.rot)
    const raft = (lx: number, lz: number, out: THREE.Vector3) => out.set(R.x + lx * cR + lz * sR, wy + R.deckY, R.z - lx * sR + lz * cR)
    const yardWet = wy > YARD_Y - 0.25
    // Dona Socorro at the fish table on the raft, always
    const so = f.get('socorro'); raft(2.9, -0.45, v); so.x = v.x; so.y = v.y; so.z = v.z; so.heading = Math.PI - (-R.rot) + Math.PI; so.heading = -R.rot; so.anim = 'gut'
    // the canoe tied alongside the raft
    raft(-0.5, 4.6, v); this.tied.x = v.x; this.tied.z = v.z; this.tied.heading = -R.rot + Math.PI / 2
    // Marta paddles the school canoe up and down the channel
    this.schoolU += this.schoolDir * dt * 0.0042
    if (this.schoolU > 0.4) this.schoolDir = -1; else if (this.schoolU < 0.16) this.schoolDir = 1
    polyAt(CHANNEL, this.schoolU, pt); const ax = pt.x, az = pt.z
    polyAt(CHANNEL, this.schoolU + 0.004 * this.schoolDir, pt)
    this.school.x = ax + 3; this.school.z = az; this.school.heading = Math.atan2(pt.x - ax, -(pt.z - az))
    const ma = f.get('marta'); cast.seat(ma, this.school, -2.9, 'paddle', Math.sin(this.t * 0.5) > 0 ? 1 : -1)
    // the visitors' boat at the beach: parents aboard, Rafa beside it
    const sk = this.skiff
    cast.seat(f.get('mae'), sk, 0.4, 'ride'); cast.seat(f.get('pai'), sk, -1.6, 'ride')
    const ra = f.get('rafa'); ra.y = Math.max(hf.at(ra.x, ra.z), wy - 0.9); ra.active = wy < hf.at(ra.x, ra.z) + 0.7
    ra.anim = Math.hypot(p.x - ra.x, p.z - ra.z) < 14 ? 'wave' : 'idle'; ra.heading = Math.atan2(p.x - ra.x, -(p.z - ra.z))
    // the yard: Nino on the board, Lia fetching paddles between the steps and the tree; on the house walk in flood
    const ni = f.get('nino'), li = f.get('lia'), H = PLACES.stiltHouse
    if (yardWet !== this.flooded) {
      this.flooded = yardWet
      if (yardWet) { const c = Math.cos(H.rot), s = Math.sin(H.rot); const w = (lx: number, lz: number) => v.set(H.x + lx * c + lz * s, HOUSE_FLOOR_Y + 0.04, H.z - lx * s + lz * c)
        w(-1.6, 3.6); ni.x = v.x; ni.y = v.y; ni.z = v.z; ni.anim = 'sit'; ni.heading = H.rot + Math.PI; ni.moving = false
        w(0.9, 3.5); li.x = v.x; li.y = v.y; li.z = v.z; li.anim = 'idle'; li.heading = H.rot + Math.PI; li.moving = false
      } else { ni.x = 15.5; ni.z = 33; ni.y = hf.at(15.5, 33); ni.anim = 'board'; ni.heading = 2.2; li.x = 20; li.z = 40; li.moving = false }
    }
    if (!yardWet) {
      li.y = hf.at(li.x, li.z)
      if (!li.moving) { const toTree = Math.hypot(li.x - 14, li.z - 31) > 3; f.walkTo('lia', toTree ? 14.5 : 27, toTree ? 31.5 : 60, 1.15, 0.4, 'lamp') }
      pr.board.visible = true; pr.board.position.set(ni.x, ni.y + 0.02, ni.z); pr.board.rotation.set(0, Math.PI - ni.heading, 0)
      ni.y = hf.at(ni.x, ni.z) + 0.02
    } else pr.board.visible = false
    // the trail: Caio carries a load between the giant trunk and the lake; in flood he and Tomé are in the lake canoe
    const ca = f.get('caio'), to = f.get('tome'), lc = this.lakeCanoe
    const trailWet = wy > hf.at(112, -74) - 0.2
    if (!trailWet) {
      ca.y = hf.at(ca.x, ca.z)
      if (!ca.moving) { this.caioLeg ^= 1; f.walkTo('caio', this.caioLeg ? 119 : 100, this.caioLeg ? -118 : -48, 1.25, 0.5, 'carry') }
      to.x = PLACES.lakeBank.x + 3.2; to.z = PLACES.lakeBank.z - 1; to.y = hf.at(to.x, to.z); to.anim = 'liftNet'; to.heading = 1.6
      lc.x = PLACES.lakeBank.x + 9; lc.z = PLACES.lakeBank.z - 3; lc.heading = 1.2
    } else {
      const a = this.t * 0.07
      lc.x = 168 + Math.cos(a) * 18; lc.z = -136 + Math.sin(a) * 12; lc.heading = a + Math.PI
      cast.seat(ca, lc, -1.3, 'paddle', Math.sin(this.t * 0.6) > 0 ? 1 : -1); cast.seat(to, lc, 1.1, 'ride')
    }
    // by night the boy carries the hand lamp: one warm pool in a dark blue forest
    cast.lampHolder = envOut.lamp > 0.45 && p.mode === 'foot' ? 'davi' : null
    cast.boyAnim = cast.lampHolder && p.speed < 0.2 ? 'lamp' : null
    // paddles for the paddlers
    pr.paddles[1].visible = false; pr.paddles[2].visible = false
    f.handPos('marta', ma.side > 0 ? 1 : 0, v); f.handPos('marta', ma.side > 0 ? 0 : 1, v2); v2.y -= 0.12; pr.holdPaddle(1, v, v2)
    if (trailWet) { f.handPos('caio', ca.side > 0 ? 1 : 0, v); f.handPos('caio', ca.side > 0 ? 0 : 1, v2); v2.y -= 0.12; pr.holdPaddle(2, v, v2) }
  }
}
