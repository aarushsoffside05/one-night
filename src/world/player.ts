// The kid: on foot and by canoe, seen from behind and a little above.
import * as THREE from 'three/webgpu';
import { sim } from '../state';
import { U } from './uniforms';
import type { Figure } from './people';
import { INST_STRIDE, TREE_TRUNK_R, TREE_HEIGHT, type ForestCook } from './trees';
import { waterSurfaceAt } from './height';
import * as L from './layout';

export interface World { groundAt(x: number, z: number): number; forest: ForestCook; solids: Solid[]; }
export interface Solid { x: number; z: number; r: number; top: number; } // simple round obstacles (posts, houses use several)

const keys = new Set<string>();
let dragDX = 0, dragDY = 0, wheel = 0, lastLook = 0;
export function bindInput(el: HTMLElement) {
  const kd = (e: KeyboardEvent) => { keys.add(e.code); if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); };
  const ku = (e: KeyboardEvent) => keys.delete(e.code);
  let down = false;
  const pd = (e: PointerEvent) => { down = true; el.setPointerCapture?.(e.pointerId); };
  const pu = () => { down = false; };
  const pm = (e: PointerEvent) => { if (down || document.pointerLockElement === el) { dragDX += e.movementX; dragDY += e.movementY; } };
  const wh = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) dragDX -= e.deltaX * 0.6; else wheel += e.deltaY; e.preventDefault(); };
  const blur = () => keys.clear();
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
  el.addEventListener('pointerdown', pd); window.addEventListener('pointerup', pu); el.addEventListener('pointermove', pm);
  el.addEventListener('wheel', wh, { passive: false });
  return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); el.removeEventListener('pointerdown', pd); window.removeEventListener('pointerup', pu); el.removeEventListener('pointermove', pm); el.removeEventListener('wheel', wh); };
}
export const input = {
  keys,
  // scripted input for the play bot: overrides the keyboard when set
  bot: null as null | { fwd: number; turn: number; strafe?: number },
  pressed: new Set<string>(),           // one-shot key presses, consumed by the game layer
};
window.addEventListener('keydown', (e) => { if (!e.repeat) input.pressed.add(e.code); });

export class Player {
  pos = new THREE.Vector3(L.BANK_TOP[0] + 6, 0, L.BANK_TOP[1] + 10);
  yaw = 2.2; speed = 0;
  mode: 'foot' | 'canoe' = 'foot';
  camYaw = 2.2; camPitch = 0.2; camDist = 5.6; camDistNow = 5.6;
  canoePos = new THREE.Vector3(L.LANDING[0] - 4, 0, L.LANDING[1]); canoeYaw = 1.2; canoeRoll = 0;
  walked = 0; paddled = 0; stuck = 0;
  private target = new THREE.Vector3(); private want = new THREE.Vector3();
  frozen = false;                       // story beats can take the controls away
  camOverride: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number } | null = null;

  constructor(public fig: Figure, public canoe: THREE.Object3D, public world: World) {}

  place(x: number, z: number, yaw = this.yaw) { this.pos.set(x, this.world.groundAt(x, z), z); this.yaw = this.camYaw = yaw; this.speed = 0; }

  private collide(p: THREE.Vector3, r: number) {
    const f = this.world.forest, cs = L.CELL, nc = f.nc;
    const cx = Math.floor((p.x - f.cellMin) / cs), cz = Math.floor((p.z - f.cellMin) / cs);
    for (let j = Math.max(0, cz - 1); j <= Math.min(nc - 1, cz + 1); j++) for (let i = Math.max(0, cx - 1); i <= Math.min(nc - 1, cx + 1); i++) {
      for (let t = f.cellStart[j * nc + i]; t < f.cellStart[j * nc + i + 1]; t++) {
        const o = t * INST_STRIDE, tr = f.inst[o + 7];
        if (tr < 0.12) continue;
        const dx = p.x - f.inst[o], dz = p.z - f.inst[o + 2], rr = tr + r, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), k = (rr - d) / d; p.x += dx * k; p.z += dz * k; }
      }
    }
    for (const s of this.world.solids) {
      const dx = p.x - s.x, dz = p.z - s.z, rr = s.r + r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6 && p.y < s.top) { const d = Math.sqrt(d2), k = (rr - d) / d; p.x += dx * k; p.z += dz * k; }
    }
    const lim = L.PLAY_HALF + 12;
    p.x = Math.min(lim, Math.max(-lim, p.x)); p.z = Math.min(lim, Math.max(-lim - 30, p.z));
  }
  // is the straight line from a to b blocked by a trunk (for the camera)
  private blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const f = this.world.forest, cs = L.CELL, nc = f.nc;
    let best = 1;
    const cx = Math.floor(((ax + bx) / 2 - f.cellMin) / cs), cz = Math.floor(((az + bz) / 2 - f.cellMin) / cs);
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    for (let j = Math.max(0, cz - 1); j <= Math.min(nc - 1, cz + 1); j++) for (let i = Math.max(0, cx - 1); i <= Math.min(nc - 1, cx + 1); i++) {
      for (let t = f.cellStart[j * nc + i]; t < f.cellStart[j * nc + i + 1]; t++) {
        const o = t * INST_STRIDE, tr = f.inst[o + 7];
        if (tr < 0.16) continue;
        const u = ((f.inst[o] - ax) * dx + (f.inst[o + 2] - az) * dz) / len2;
        if (u < 0.06 || u > 1.05) continue;
        const px = ax + dx * u - f.inst[o], pz = az + dz * u - f.inst[o + 2];
        const rr = tr + 0.28;
        if (px * px + pz * pz < rr * rr) {
          const y = ay + (by - ay) * u;
          if (y < f.inst[o + 1] + TREE_HEIGHT[f.inst[o + 5]] * f.inst[o + 4] * 0.6) best = Math.min(best, Math.max(0.12, u - rr / Math.sqrt(len2)));
        }
      }
    }
    return best;
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    const w = this.world, k = input.keys, bot = input.bot;
    let fwd = 0, strafe = 0, turn = 0;
    if (!this.frozen) {
      if (bot) { fwd = bot.fwd; turn = bot.turn; strafe = bot.strafe ?? 0; }
      else {
        fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
        strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
        turn = (k.has('ArrowRight') || k.has('KeyE') && false ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
      }
    }
    // look: drag, two-finger swipe, or arrow keys
    if (dragDX || dragDY) { this.camYaw -= dragDX * 0.0042; this.camPitch = Math.min(1.1, Math.max(-0.35, this.camPitch + dragDY * 0.003)); lastLook = sim.time; dragDX = dragDY = 0; }
    if (wheel) { this.camDist = Math.min(9, Math.max(3.2, this.camDist + wheel * 0.004)); wheel = 0; }
    const wyHere = waterSurfaceAt(this.pos.x, this.pos.z, sim.water);
    const ground = w.groundAt(this.pos.x, this.pos.z);
    const depth = wyHere - ground;
    // on foot until the water is waist-deep; then the canoe takes over, and gives way again when it grounds
    if (this.mode === 'foot' && depth > 0.78) { this.mode = 'canoe'; this.canoePos.copy(this.pos); this.canoeYaw = this.yaw; this.speed *= 0.3; }
    else if (this.mode === 'canoe' && depth < 0.26) { this.mode = 'foot'; this.speed = 0; }
    sim.onWater = this.mode === 'canoe';
    const f = this.fig;
    if (this.mode === 'foot') {
      this.camYaw -= turn * dt * 1.7;
      const run = k.has('ShiftLeft') || k.has('ShiftRight');
      const mag = Math.min(1, Math.hypot(fwd, strafe));
      let sp = 0;
      if (mag > 0.01) {
        const a = this.camYaw + Math.atan2(-strafe, fwd);  // heading in world: yaw 0 looks toward +z... (see dir below)
        const want = a;
        let d = want - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * Math.min(1, dt * 10);
        // slower in shallows and on steep banks
        const ahead = w.groundAt(this.pos.x + Math.sin(this.yaw) * 0.8, this.pos.z + Math.cos(this.yaw) * 0.8);
        const slope = Math.abs(ahead - ground) / 0.8;
        sp = (run ? 6.4 : 3.9) * mag * (1 - Math.min(0.55, Math.max(0, depth) * 0.7)) * (1 - Math.min(0.5, slope * 0.45));
      }
      this.speed += (sp - this.speed) * Math.min(1, dt * 9);
      const ox = this.pos.x, oz = this.pos.z;
      this.pos.x += Math.sin(this.yaw) * this.speed * dt; this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      this.collide(this.pos, 0.3);
      this.pos.y = w.groundAt(this.pos.x, this.pos.z);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      this.walked += moved; if (sp > 0.5 && moved < sp * dt * 0.2) this.stuck += dt; else this.stuck = 0;
      f.pose = this.speed > 0.25 ? 'walk' : 'idle'; f.speed = this.speed; f.phase += this.speed * dt * 2.35;
      f.pos.copy(this.pos); f.yaw = this.yaw; f.holdsPaddle = false; f.holdsLamp = (U.night.value as number) > 0.35 && sim.lamp > 0;
      // the canoe waits where it was left, riding the water if there is any
      const cg = w.groundAt(this.canoePos.x, this.canoePos.z), cw = waterSurfaceAt(this.canoePos.x, this.canoePos.z, sim.water);
      this.canoePos.y = Math.max(cg + 0.3, cw + 0.08);
    } else {
      // canoe: W paddles, A/D steer, S backs water
      const steer = strafe + turn;
      const thrust = fwd > 0 ? 2.3 : fwd < 0 ? -1.3 : 0;
      this.speed += (thrust - this.speed * 0.62) * dt;
      this.canoeYaw -= steer * dt * (0.55 + Math.min(1, Math.abs(this.speed)) * 0.75);
      if (Math.abs(steer) > 0 && Math.abs(this.speed) < 0.5) this.speed += 0.5 * dt; // a turning stroke still moves the boat a little
      const nx = this.pos.x + Math.sin(this.canoeYaw) * this.speed * dt, nz = this.pos.z + Math.cos(this.canoeYaw) * this.speed * dt;
      const ok = (x: number, z: number) => waterSurfaceAt(x, z, sim.water) - w.groundAt(x, z) > 0.2;
      const ox = this.pos.x, oz = this.pos.z;
      if (ok(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (ok(nx, this.pos.z)) { this.pos.x = nx; this.speed *= 0.9; }
      else if (ok(this.pos.x, nz)) { this.pos.z = nz; this.speed *= 0.9; }
      else this.speed *= 0.5;
      this.collide(this.pos, 0.55);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      this.paddled += moved; if (Math.abs(thrust) > 0.5 && moved < 0.2 * dt) this.stuck += dt; else this.stuck = 0;
      const wy = waterSurfaceAt(this.pos.x, this.pos.z, sim.water);
      const bob = sim.reduceMotion ? 0 : Math.sin(sim.time * 1.7) * 0.025;
      this.pos.y = wy + 0.06 + bob;
      this.yaw = this.canoeYaw;
      this.canoePos.copy(this.pos); this.canoeRoll = sim.reduceMotion ? 0 : Math.sin(sim.time * 1.3) * 0.03 - steer * 0.05;
      const working = Math.abs(fwd) > 0 || Math.abs(steer) > 0;
      f.pose = working ? 'paddle' : 'sit'; if (working) f.phase += dt * 3.4;
      f.holdsPaddle = true; f.holdsLamp = false;
      f.pos.set(this.pos.x - Math.sin(this.yaw) * 0.55, this.pos.y - 0.12, this.pos.z - Math.cos(this.yaw) * 0.55); f.yaw = this.yaw;
      // drift the camera behind the boat
      let d = this.canoeYaw - this.camYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      if (sim.time - lastLook > 1.2) this.camYaw += d * Math.min(1, dt * 1.6);
    }
    if (this.mode === 'foot' && this.speed > 0.5 && sim.time - lastLook > 2.0 && !bot) {
      let d = this.yaw - this.camYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 2.4) this.camYaw += d * Math.min(1, dt * 0.9);
    }
    if (bot) this.camYaw = this.yaw;
    this.canoe.position.copy(this.canoePos);
    this.canoe.rotation.set(0, this.canoeYaw, this.canoeRoll, 'YXZ');
    this.updateCamera(dt, camera);
  }

  updateCamera(dt: number, camera: THREE.PerspectiveCamera) {
    const w = this.world;
    if (this.camOverride) {
      camera.position.lerp(this.camOverride.pos, Math.min(1, dt * 2.5)); this.target.lerp(this.camOverride.look, Math.min(1, dt * 3)); camera.lookAt(this.target);
      return;
    }
    const head = this.mode === 'canoe' ? 0.95 : 1.32;
    this.want.set(this.pos.x, this.pos.y + head, this.pos.z);
    this.target.lerp(this.want, Math.min(1, dt * 12));
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const dx = -Math.sin(this.camYaw) * cp, dz = -Math.cos(this.camYaw) * cp, dy = sp;
    // never through trunks, ground, or water
    let dist = this.camDist;
    const hit = this.blocked(this.target.x, this.target.y, this.target.z, this.target.x + dx * dist, this.target.y + dy * dist, this.target.z + dz * dist);
    dist *= hit;
    for (let i = 0; i < 4; i++) {
      const x = this.target.x + dx * dist, z = this.target.z + dz * dist, y = this.target.y + dy * dist;
      const floor = Math.max(w.groundAt(x, z), waterSurfaceAt(x, z, sim.water)) + 0.45;
      if (y >= floor) break;
      dist *= 0.82;
    }
    this.camDistNow += (dist - this.camDistNow) * Math.min(1, dt * (dist < this.camDistNow ? 14 : 3));
    const d = this.camDistNow;
    let cy = this.target.y + dy * d;
    const cx = this.target.x + dx * d, cz = this.target.z + dz * d;
    cy = Math.max(cy, Math.max(w.groundAt(cx, cz), waterSurfaceAt(cx, cz, sim.water)) + 0.4);
    camera.position.set(cx, cy, cz);
    camera.lookAt(this.target.x, this.target.y + 0.25, this.target.z);
  }
}
