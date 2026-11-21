// Time of day is the second number (0 late afternoon .. 1 morning). Each key below is one line of the
// colour script: sky, sun or moon, haze, shadow colour, water colour, exposure. Everything in between is blended.
import * as THREE from 'three/webgpu'
import { U } from './uniforms'
import { uniform } from './tsl'

export const envUniforms = { lampGlow: uniform(0) }

type Key = {
  t: number; moon?: boolean; az: number; el: number; sunI: number; sun: string
  top: string; hor: string; glow: string; amb: string; ambI: number; gnd: string
  fog: string; fogSun: string; den: number; fogH: number; day: number; exp: number
  deep: string; shallow: string; stars: number; cloud: string; cloudSh: string; lamp: number; mist: number
}
// az: compass bearing of the light (0 north = -z, 90 east = +x). el: height in degrees.
export const KEYS: Key[] = [
  { t: 0.00, az: 258, el: 30, sunI: 3.0, sun: '#ffd596', top: '#3d7cc2', hor: '#cfe2e4', glow: '#ffe9c2', amb: '#6f8fae', ambI: 0.62, gnd: '#4a3f24', fog: '#9db8b4', fogSun: '#ffe0a8', den: 0.0043, fogH: 0.05, day: 1, exp: 1.0, deep: '#3a2412', shallow: '#8a5a30', stars: 0, cloud: '#fff6e4', cloudSh: '#a9b6cc', lamp: 0, mist: 0 },
  { t: 0.10, az: 262, el: 12, sunI: 3.0, sun: '#ffb866', top: '#4a76b6', hor: '#f4d9ae', glow: '#ffcf88', amb: '#6f7ba8', ambI: 0.6, gnd: '#4a3524', fog: '#dcc8a4', fogSun: '#ffd08a', den: 0.0058, fogH: 0.05, day: 1, exp: 1.0, deep: '#33281a', shallow: '#a37a48', stars: 0, cloud: '#ffd9a8', cloudSh: '#a08fb0', lamp: 0, mist: 0 },
  { t: 0.16, az: 265, el: 3, sunI: 1.5, sun: '#ff9550', top: '#48599a', hor: '#f6ac78', glow: '#ff965a', amb: '#8d86b4', ambI: 0.8, gnd: '#5d4638', fog: '#c9a28e', fogSun: '#ff9a62', den: 0.0066, fogH: 0.045, day: 0.8, exp: 1.02, deep: '#2c2320', shallow: '#9a6a52', stars: 0, cloud: '#ffb088', cloudSh: '#7d6c98', lamp: 0.5, mist: 0 },
  { t: 0.22, az: 267, el: 4, sunI: 0.22, sun: '#c486a0', top: '#222b5a', hor: '#7c6088', glow: '#c2685c', amb: '#5a639a', ambI: 0.75, gnd: '#2c2738', fog: '#4c4a70', fogSun: '#8a5a6a', den: 0.0083, fogH: 0.04, day: 0.3, exp: 1.08, deep: '#161828', shallow: '#4a4460', stars: 0.25, cloud: '#8a6a88', cloudSh: '#3a3a62', lamp: 1, mist: 0 },
  { t: 0.30, moon: true, az: 130, el: 52, sunI: 0.85, sun: '#9db6e6', top: '#0a1230', hor: '#22335e', glow: '#2e4274', amb: '#34477a', ambI: 0.95, gnd: '#131827', fog: '#162240', fogSun: '#263a66', den: 0.0094, fogH: 0.04, day: 0.6, exp: 1.15, deep: '#0a1020', shallow: '#22304e', stars: 1, cloud: '#26345a', cloudSh: '#0e1428', lamp: 1, mist: 0 },
  { t: 0.60, moon: true, az: 200, el: 44, sunI: 0.85, sun: '#9db6e6', top: '#0a1230', hor: '#22335e', glow: '#2e4274', amb: '#34477a', ambI: 0.95, gnd: '#131827', fog: '#162240', fogSun: '#263a66', den: 0.0094, fogH: 0.04, day: 0.6, exp: 1.15, deep: '#0a1020', shallow: '#22304e', stars: 1, cloud: '#26345a', cloudSh: '#0e1428', lamp: 1, mist: 0.2 },
  { t: 0.68, moon: true, az: 230, el: 30, sunI: 0.14, sun: '#9aa8c0', top: '#28323f', hor: '#5e6975', glow: '#5e6975', amb: '#5d6a78', ambI: 0.85, gnd: '#23282b', fog: '#59646e', fogSun: '#636d76', den: 0.0099, fogH: 0.07, day: 0.1, exp: 1.08, deep: '#1b2124', shallow: '#4a5658', stars: 0.15, cloud: '#6a7480', cloudSh: '#3c4450', lamp: 1, mist: 1 },
  { t: 0.74, az: 96, el: 4, sunI: 0.2, sun: '#e9ae9c', top: '#47587a', hor: '#cba8a0', glow: '#f2a080', amb: '#7a85a0', ambI: 0.85, gnd: '#3a3432', fog: '#93919c', fogSun: '#eaa890', den: 0.0066, fogH: 0.08, day: 0.3, exp: 1.04, deep: '#23262c', shallow: '#6e6a70', stars: 0, cloud: '#f0b8a0', cloudSh: '#6a6a88', lamp: 0.7, mist: 1 },
  { t: 0.80, az: 97, el: 4, sunI: 2.6, sun: '#ffa055', top: '#5c84be', hor: '#ffd0a0', glow: '#ffb05e', amb: '#6c7498', ambI: 0.62, gnd: '#5e4a38', fog: '#d9b9a2', fogSun: '#ffc27a', den: 0.0050, fogH: 0.08, day: 1, exp: 1.0, deep: '#2e2a22', shallow: '#a8805a', stars: 0, cloud: '#ffd2a0', cloudSh: '#8a80a8', lamp: 0.2, mist: 0.9 },
  { t: 0.88, az: 95, el: 14, sunI: 2.9, sun: '#ffc888', top: '#4888ce', hor: '#eae2ca', glow: '#ffe2b0', amb: '#7286a8', ambI: 0.62, gnd: '#463a26', fog: '#d8dcc8', fogSun: '#ffe6b0', den: 0.0047, fogH: 0.06, day: 1, exp: 1.0, deep: '#2f2a18', shallow: '#927a48', stars: 0, cloud: '#fff0d4', cloudSh: '#a0aac4', lamp: 0, mist: 0.4 },
  { t: 1.00, az: 88, el: 34, sunI: 3.0, sun: '#ffe2b0', top: '#3880d0', hor: '#cfe6ee', glow: '#fff0d0', amb: '#7090b2', ambI: 0.62, gnd: '#4a4026', fog: '#c2d9dc', fogSun: '#fff0cc', den: 0.0043, fogH: 0.05, day: 1, exp: 1.0, deep: '#3a2412', shallow: '#8a5a30', stars: 0, cloud: '#ffffff', cloudSh: '#a8b8d0', lamp: 0, mist: 0 },
]

const ca = new THREE.Color(), cb = new THREE.Color()
function lerpCol(target: THREE.Color, a: string, b: string, f: number, mul = 1) {
  ca.set(a); cb.set(b)
  target.copy(ca).lerp(cb, f).multiplyScalar(mul)
}
const dirOf = (az: number, el: number, out: THREE.Vector3) => {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e))
}
const d0 = new THREE.Vector3(), d1 = new THREE.Vector3()
export const envOut = { lamp: 0, exposure: 1, sunI: 1, isMoon: false }

export function applyEnv(tod: number, sun: THREE.DirectionalLight, renderer: THREE.WebGPURenderer) {
  let i = 0
  while (i < KEYS.length - 2 && tod > KEYS[i + 1].t) i++
  const a = KEYS[i], b = KEYS[i + 1]
  let f = Math.min(Math.max((tod - a.t) / (b.t - a.t), 0), 1)
  const L = (x: number, y: number) => x + (y - x) * f
  // sun and moon are one light: where they swap, the light dips to nothing and jumps across
  let sunI = L(a.sunI, b.sunI)
  if (!!a.moon !== !!b.moon) {
    const k = f < 0.5 ? a : b
    dirOf(k.az, k.el, d0)
    sunI = (f < 0.5 ? a.sunI * (1 - f * 2) : b.sunI * (f * 2 - 1))
    U.sunDir.value.copy(d0)
    envOut.isMoon = !!k.moon
  } else {
    dirOf(a.az, a.el, d0); dirOf(b.az, b.el, d1)
    U.sunDir.value.copy(d0).lerp(d1, f).normalize()
    envOut.isMoon = !!a.moon
  }
  lerpCol(U.sunCol.value, a.sun, b.sun, f)
  sun.color.copy(U.sunCol.value); sun.intensity = sunI
  U.sunI.value = sunI
  lerpCol(U.skyTop.value, a.top, b.top, f)
  lerpCol(U.skyHor.value, a.hor, b.hor, f)
  lerpCol(U.skyGlow.value, a.glow, b.glow, f)
  lerpCol(U.amb.value, a.amb, b.amb, f, L(a.ambI, b.ambI))
  lerpCol(U.ambGround.value, a.gnd, b.gnd, f, L(a.ambI, b.ambI))
  lerpCol(U.fogCol.value, a.fog, b.fog, f)
  lerpCol(U.fogSun.value, a.fogSun, b.fogSun, f)
  lerpCol(U.waterDeep.value, a.deep, b.deep, f)
  lerpCol(U.waterShallow.value, a.shallow, b.shallow, f)
  lerpCol(U.cloudCol.value, a.cloud, b.cloud, f)
  lerpCol(U.cloudShade.value, a.cloudSh, b.cloudSh, f)
  lerpCol(U.discCol.value, a.sun, b.sun, f, envOut.isMoon ? 1.6 : 3.0)
  U.fogDen.value = L(a.den, b.den)
  U.fogHeight.value = L(a.fogH, b.fogH)
  U.day.value = L(a.day, b.day)
  U.stars.value = L(a.stars, b.stars)
  U.mist.value = L(a.mist, b.mist)
  envOut.lamp = L(a.lamp, b.lamp)
  envUniforms.lampGlow.value = envOut.lamp
  envOut.exposure = L(a.exp, b.exp)
  envOut.sunI = sunI
  renderer.toneMappingExposure = envOut.exposure
}
