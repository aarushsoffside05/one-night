// The second number: time of day, 0 (late afternoon) .. 1 (morning).
// Each key is a full colour script; everything between is interpolated and
// pushed into uniforms and light objects (no material changes, no recompiles).
import * as THREE from 'three/webgpu';
import { U } from './uniforms';
import { writeAtlas, type WorldTextures } from './worldmat';

interface Key {
  t: number; elev: number; az: number; sun: string; sunI: number; disc: number;
  hemiSky: string; hemiGround: string; hemiI: number; skyTop: string; skyHor: string;
  fog: string; fogSun: string; fogD: number; fogH: number; waterDeep: string; waterShallow: string; waterLake: string;
  amb: number; dapple: number; exp: number; sat: number; tint: string; tintAmt: number; stars: number; night: number;
}
// az: direction to the light in the xz plane (0 = east/+x, 90 = south/+z). The lake lies south-east: sunrise at 40.
export const KEYS: Key[] = [
  { t: 0.00, elev: 38, az: 205, sun: '#ffe0aa', sunI: 4.0, disc: 1, hemiSky: '#8fb4ff', hemiGround: '#8c9a58', hemiI: 1.75, skyTop: '#2a78e6', skyHor: '#bfe9f6', fog: '#bfe0e4', fogSun: '#fff0c0', fogD: 0.0026, fogH: 36, waterDeep: '#5f7a3c', waterShallow: '#b9c070', waterLake: '#1c7a6a', amb: 0.8, dapple: 1, exp: 1.08, sat: 1.12, tint: '#ffffff', tintAmt: 0, stars: 0, night: 0 },
  { t: 0.12, elev: 15, az: 188, sun: '#ffbb6a', sunI: 3.1, disc: 1, hemiSky: '#9aa8f0', hemiGround: '#8a7040', hemiI: 1.5, skyTop: '#5a6fd0', skyHor: '#ffd49a', fog: '#e6c99a', fogSun: '#ffc97a', fogD: 0.0044, fogH: 30, waterDeep: '#66763a', waterShallow: '#c8b86a', waterLake: '#22705e', amb: 0.66, dapple: 1, exp: 1.0, sat: 1.1, tint: '#ffd9a0', tintAmt: 0.08, stars: 0, night: 0 },
  { t: 0.22, elev: 3, az: 180, sun: '#ff8648', sunI: 1.5, disc: 1, hemiSky: '#8f8fc2', hemiGround: '#573c33', hemiI: 0.62, skyTop: '#5a4aa8', skyHor: '#ff9e78', fog: '#c89a88', fogSun: '#ff9858', fogD: 0.0052, fogH: 26, waterDeep: '#5a6a5c', waterShallow: '#b09a84', waterLake: '#2a5a5e', amb: 0.5, dapple: 0.8, exp: 1.02, sat: 1.0, tint: '#ffb38a', tintAmt: 0.12, stars: 0, night: 0.15 },
  { t: 0.27, elev: 2, az: 180, sun: '#ff8648', sunI: 0.0, disc: 0, hemiSky: '#5c6caa', hemiGround: '#2b2b36', hemiI: 0.44, skyTop: '#1b2958', skyHor: '#76688a', fog: '#52567a', fogSun: '#7a6a8a', fogD: 0.0058, fogH: 24, waterDeep: '#24405a', waterShallow: '#4a6a84', waterLake: '#12324c', amb: 0.6, dapple: 0, exp: 1.08, sat: 0.85, tint: '#9aa6e0', tintAmt: 0.2, stars: 0.3, night: 0.6 },
  { t: 0.28, elev: 58, az: 300, sun: '#a2bcff', sunI: 0.0, disc: 0, hemiSky: '#5c6caa', hemiGround: '#2b2b36', hemiI: 0.43, skyTop: '#1a2856', skyHor: '#6f6488', fog: '#4e5378', fogSun: '#6f6488', fogD: 0.0058, fogH: 24, waterDeep: '#24405a', waterShallow: '#4a6a84', waterLake: '#12324c', amb: 0.6, dapple: 0, exp: 1.08, sat: 0.85, tint: '#9aa6e0', tintAmt: 0.2, stars: 0.35, night: 0.62 },
  { t: 0.40, elev: 58, az: 300, sun: '#a2bcff', sunI: 0.5, disc: 0.25, hemiSky: '#3a5090', hemiGround: '#131a24', hemiI: 0.34, skyTop: '#0c1040', skyHor: '#2a2a6a', fog: '#0f1930', fogSun: '#1c2c50', fogD: 0.0062, fogH: 22, waterDeep: '#122c40', waterShallow: '#28566a', waterLake: '#0a2a38', amb: 0.62, dapple: 0.5, exp: 1.18, sat: 0.72, tint: '#8aa2f0', tintAmt: 0.28, stars: 1, night: 1 },
  { t: 0.58, elev: 40, az: 250, sun: '#a2bcff', sunI: 0.45, disc: 0.25, hemiSky: '#3a5090', hemiGround: '#131a24', hemiI: 0.34, skyTop: '#0c1040', skyHor: '#2a2a6a', fog: '#101a32', fogSun: '#1c2c50', fogD: 0.0064, fogH: 20, waterDeep: '#122c40', waterShallow: '#28566a', waterLake: '#0a2a38', amb: 0.62, dapple: 0.5, exp: 1.18, sat: 0.72, tint: '#8aa2f0', tintAmt: 0.28, stars: 1, night: 1 },
  { t: 0.66, elev: 30, az: 250, sun: '#a2bcff', sunI: 0.0, disc: 0, hemiSky: '#8c98a8', hemiGround: '#3b3e42', hemiI: 0.72, skyTop: '#55647a', skyHor: '#a8b0b6', fog: '#99a3aa', fogSun: '#aab2b6', fogD: 0.0115, fogH: 13, waterDeep: '#465a58', waterShallow: '#94aaa2', waterLake: '#2c4a50', amb: 0.8, dapple: 0, exp: 1.02, sat: 0.55, tint: '#c8d2dc', tintAmt: 0.22, stars: 0.05, night: 0.3 },
  { t: 0.70, elev: 2, az: 40, sun: '#ff9a52', sunI: 0.0, disc: 0, hemiSky: '#9aa2b4', hemiGround: '#45423f', hemiI: 0.76, skyTop: '#5d6f8c', skyHor: '#c9b8b0', fog: '#a9a8aa', fogSun: '#e0b89a', fogD: 0.011, fogH: 12, waterDeep: '#4c5e58', waterShallow: '#a0b0a0', waterLake: '#30505a', amb: 0.8, dapple: 0, exp: 1.02, sat: 0.62, tint: '#d8d2d6', tintAmt: 0.18, stars: 0, night: 0.15 },
  { t: 0.80, elev: 5, az: 40, sun: '#ff9c56', sunI: 2.4, disc: 1, hemiSky: '#a9a9ca', hemiGround: '#5c4634', hemiI: 0.7, skyTop: '#7a70d0', skyHor: '#ffb88a', fog: '#f0ba8c', fogSun: '#ffd28e', fogD: 0.0082, fogH: 12, waterDeep: '#6a7248', waterShallow: '#d0b47a', waterLake: '#2a6a62', amb: 0.66, dapple: 0.9, exp: 1.05, sat: 1.05, tint: '#ffc79a', tintAmt: 0.1, stars: 0, night: 0 },
  { t: 0.90, elev: 17, az: 48, sun: '#ffd193', sunI: 3.0, disc: 1, hemiSky: '#94b4f8', hemiGround: '#8a8a50', hemiI: 1.6, skyTop: '#4985c7', skyHor: '#f4e3be', fog: '#e0d6ba', fogSun: '#ffe2a6', fogD: 0.0050, fogH: 20, waterDeep: '#627a3e', waterShallow: '#c0c070', waterLake: '#1f7868', amb: 0.7, dapple: 1, exp: 1.0, sat: 1.08, tint: '#ffe6c0', tintAmt: 0.04, stars: 0, night: 0 },
  { t: 1.00, elev: 35, az: 60, sun: '#fff1d2', sunI: 3.4, disc: 1, hemiSky: '#aacef0', hemiGround: '#725f3e', hemiI: 1.5, skyTop: '#3a82cc', skyHor: '#d6e7e9', fog: '#c2d8d0', fogSun: '#fff0c8', fogD: 0.0030, fogH: 34, waterDeep: '#5f7a3c', waterShallow: '#b9c070', waterLake: '#1c7a6a', amb: 0.5, dapple: 1, exp: 1.0, sat: 1.06, tint: '#ffffff', tintAmt: 0, stars: 0, night: 0 },
];
export const TOD = { afternoon: 0, golden: 0.12, dusk: 0.22, night: 0.45, grey: 0.68, sunrise: 0.80, morning: 1 };

const cA = new THREE.Color(), cB = new THREE.Color();
const lerpCol = (out: THREE.Color, a: string, b: string, f: number) => { cA.set(a); cB.set(b); out.copy(cA).lerp(cB, f); return out; };
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export interface Env { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; renderer: THREE.WebGPURenderer; tex: WorldTextures; }
let lastAtlas = '';
const tintC = new THREE.Color();

export function applyTimeOfDay(tod: number, env: Env) {
  const x = Math.min(1, Math.max(0, tod));
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= x) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let f = (x - a.t) / Math.max(1e-6, b.t - a.t);
  f = f * f * (3 - 2 * f);
  const elev = (lerp(a.elev, b.elev, f) * Math.PI) / 180, az = (lerp(a.az, b.az, f) * Math.PI) / 180;
  U.sunDir.value.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
  const sunI = lerp(a.sunI, b.sunI, f);
  lerpCol(env.sun.color, a.sun, b.sun, f); env.sun.intensity = sunI;
  U.sunCol.value.copy(env.sun.color).multiplyScalar(sunI / 3);
  U.sunDisc.value.copy(env.sun.color).multiplyScalar(lerp(a.disc, b.disc, f));
  lerpCol(env.hemi.color, a.hemiSky, b.hemiSky, f); lerpCol(env.hemi.groundColor, a.hemiGround, b.hemiGround, f); env.hemi.intensity = lerp(a.hemiI, b.hemiI, f);
  lerpCol(U.skyTop.value, a.skyTop, b.skyTop, f); lerpCol(U.skyHorizon.value, a.skyHor, b.skyHor, f);
  lerpCol(U.fogCol.value, a.fog, b.fog, f); lerpCol(U.fogSunCol.value, a.fogSun, b.fogSun, f);
  U.fogDensity.value = lerp(a.fogD, b.fogD, f); U.fogHeight.value = lerp(a.fogH, b.fogH, f);
  lerpCol(U.waterDeep.value, a.waterDeep, b.waterDeep, f); lerpCol(U.waterShallow.value, a.waterShallow, b.waterShallow, f); lerpCol(U.waterLake.value, a.waterLake, b.waterLake, f);
  U.underTint.value.copy(U.waterShallow.value).multiplyScalar(1.25);
  U.canopyAmb.value = lerp(a.amb, b.amb, f); U.dapple.value = lerp(a.dapple, b.dapple, f);
  U.stars.value = lerp(a.stars, b.stars, f); U.night.value = lerp(a.night, b.night, f);
  env.renderer.toneMappingExposure = lerp(a.exp, b.exp, f);
  // palette atlas: re-tinted per time of day (256 texels; only when it changes)
  const sat = lerp(a.sat, b.sat, f), tintAmt = lerp(a.tintAmt, b.tintAmt, f);
  lerpCol(tintC, a.tint, b.tint, f);
  const key = sat.toFixed(2) + tintAmt.toFixed(2) + tintC.getHexString();
  if (key !== lastAtlas) { lastAtlas = key; writeAtlas(env.tex, sat, tintAmt, [tintC.r * 1.4, tintC.g * 1.4, tintC.b * 1.4]); }
}
