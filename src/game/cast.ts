// Putting people and boats where they belong: the boy follows the player's controls; everyone else is
// placed by the Roam director (people at their work) or by the story scenes.
import * as THREE from 'three/webgpu'
import type { World } from '../world/build'
import type { Player } from './player'
import type { Boat } from '../world/props'
import type { Fig, Anim } from '../world/figures'
import { U } from '../world/uniforms'
import { envOut } from '../world/env'

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3()

export class Cast {
  playerBoat: Boat
  orbOn = true
  lampHolder: string | null = null // who carries the hand lamp
  boyAnim: Anim | null = null // story override of the boy's pose
  boyHidden = false
  constructor(public world: World, public player: Player) {
    this.playerBoat = world.props.addBoat('canoe', 0, 0, 0, 1)
    world.figures.show('davi', 0, 0, 0, 0)
  }
  seat(f: Fig, b: Boat, localZ: number, anim: Anim, side = 1, localX = 0) {
    const sh = Math.sin(b.heading), ch = Math.cos(b.heading)
    f.active = true
    f.x = b.x + sh * localZ + ch * localX; f.z = b.z - ch * localZ + sh * localX
    f.y = b.y + b.lift - 0.05; f.heading = b.heading; f.anim = anim; f.side = side; f.moving = false
  }
  // every frame: the boy from the player's state, props in hands, lights
  update(dt: number, clock: number) {
    const { figures, props } = this.world, p = this.player
    const boy = figures.get('davi')
    const b = this.playerBoat
    boy.active = !this.boyHidden
    if (p.mode === 'canoe') {
      b.visible = true; b.float = false
      b.x = p.canoe.x; b.z = p.canoe.z; b.heading = p.canoe.heading; b.y = p.canoe.y + Math.sin(clock * 1.2) * 0.012; b.roll = p.canoe.roll
      this.seat(boy, b, -1.25, this.boyAnim ?? 'paddle', p.paddleSide)
      boy.phase = p.paddlePhase * Math.PI * 2 - 1.2
      if (p.stroke < 0.02 && p.speed < 0.1 && !this.boyAnim) boy.phase = -1.2
    } else {
      b.float = true
      boy.x = p.x; boy.y = p.y; boy.z = p.z; boy.heading = p.heading
      const moving = Math.hypot(p.vx, p.vz)
      boy.anim = this.boyAnim ?? (moving > 4.4 ? 'run' : moving > 0.25 ? 'walk' : 'idle')
      boy.speed = moving
      if (moving > 0.25) boy.phase = p.walkPhase
    }
    figures.update(dt)
    props.update(clock, (x, z) => p.waterAt(x, z), (x, z) => this.world.hf.at(x, z))
    // paddle through the boy's hands when he is in the canoe
    props.paddles[0].visible = false
    if (p.mode === 'canoe' && boy.active && !this.boyAnim) {
      const side = p.paddleSide > 0 ? 0 : 1
      figures.handPos('davi', 1 - side, v1); figures.handPos('davi', side, v2)
      v2.y -= 0.12
      props.holdPaddle(0, v1, v2)
    }
    // the orb at his hip gives a small cool light; stronger at night
    figures.handPos('davi', 0, v1)
    const night = envOut.lamp
    props.orb.visible = boy.active && this.orbOn
    props.orb.position.set(v1.x, v1.y + 0.02, v1.z)
    U.orb.value.set(p.x, p.y + 1.1, p.z, this.orbOn && boy.active ? 0.5 + night * 3.2 : 0)
    // the hand lamp, if someone carries it
    if (this.lampHolder) {
      figures.handPos(this.lampHolder, 1, v1)
      props.lamp.visible = true; props.lamp.position.copy(v1)
      U.lamp2.value.set(v1.x, v1.y - 0.15, v1.z, (0.4 + night * 4.2) * (0.9 + 0.1 * Math.sin(clock * 9)))
    } else { props.lamp.visible = false; U.lamp2.value.w = 0 }
  }
}
