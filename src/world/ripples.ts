// Rings on the water: the canoe's wake, the paddle, the giant fish, rain.
// A small fixed list of ring sources (position, birth time, strength) is
// evaluated in the water's vertex stage, so it runs the same on both backends.
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { U } from './uniforms';

const t: any = T;
export const RIPPLE_N = 12;
const data: THREE.Vector4[] = Array.from({ length: RIPPLE_N }, () => new THREE.Vector4(0, 0, -100, 0));
export const rippleU = t.uniformArray(data, 'vec4');
let next = 0;
export function addRipple(x: number, z: number, time: number, strength: number) {
  data[next].set(x, z, time, strength); next = (next + 1) % RIPPLE_N;
}
// height of all rings at a world xz
export const rippleHeight = t.Fn(([xz]: any[]) => {
  const h = t.float(0.0).toVar();
  for (let i = 0; i < RIPPLE_N; i++) {
    const s = rippleU.element(i);
    const age = U.time.sub(s.z).max(0.0);
    const d = xz.sub(s.xy).length();
    const r = age.mul(1.5);
    const band = t.exp(d.sub(r).mul(1.6).pow(2.0).negate());
    h.addAssign(t.sin(d.sub(r).mul(5.0)).mul(band).mul(s.w).mul(t.exp(age.mul(-0.45))).mul(t.smoothstep(0.0, 0.25, age)));
  }
  return h;
});
