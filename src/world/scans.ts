// Surface scans (Quixel Megascans, downloaded by Aarush from Fab, shrunk by scripts/make-textures.mjs).
// They are used as DETAIL on top of our own painted palette: each sample is divided by the scan's average
// colour, so the scan brings grain, leaves, cracks and bark ridges while the colour script stays ours.
import * as THREE from 'three/webgpu'
import { texture, vec3, vec2, mix, abs, smoothstep, normalWorld, positionWorld } from './tsl'
import avg from '../assets/tex/avg.json'
import floor from '../assets/tex/floor.jpg?inline'
import floor2 from '../assets/tex/floor2.jpg?inline'
import mud from '../assets/tex/mud.jpg?inline'
import crack from '../assets/tex/crack.jpg?inline'
import sand from '../assets/tex/sand.jpg?inline'
import soil from '../assets/tex/soil.jpg?inline'
import kapok from '../assets/tex/kapok.jpg?inline'
import banyan from '../assets/tex/banyan.jpg?inline'
import planks from '../assets/tex/planks.jpg?inline'
import paint from '../assets/tex/paint.jpg?inline'
import thatch from '../assets/tex/thatch.jpg?inline'

import sFern from '../assets/tex/scan_fern.webp?inline'
import sLeather from '../assets/tex/scan_leatherfern.webp?inline'
import sPalm from '../assets/tex/scan_palm.webp?inline'
import sFan from '../assets/tex/scan_fanpalm.webp?inline'
import sBanana from '../assets/tex/scan_banana.webp?inline'
import sEar from '../assets/tex/scan_elephantear.webp?inline'
import sLily from '../assets/tex/scan_waterlily.webp?inline'
import sTree from '../assets/tex/scan_fallentree.webp?inline'
import sDrift from '../assets/tex/scan_driftwood.webp?inline'
import sCanna from '../assets/tex/scan_canna.webp?inline'

import peopleAtlas from '../assets/tex/people_atlas.webp?inline'
export const PEOPLE_TEX = {} as { atlas: THREE.Texture }
export const PLANT_URLS = { fern: sFern, leatherfern: sLeather, palm: sPalm, fanpalm: sFan, banana: sBanana, elephantear: sEar, waterlily: sLily, canna: sCanna, fallentree: sTree, driftwood: sDrift }
export const PLANT_TEX = {} as Record<keyof typeof PLANT_URLS, THREE.Texture>
const URLS = { floor, floor2, mud, crack, sand, soil, kapok, banyan, planks, paint, thatch }
export type ScanName = keyof typeof URLS
export const SCAN = {} as Record<ScanName, THREE.Texture>

export async function loadScans(onProgress: (f: number) => void) {
  const names = Object.keys(URLS) as ScanName[]
  let done = 0
  { const img = new Image(); img.src = peopleAtlas; await img.decode(); const t = new THREE.Texture(img); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; PEOPLE_TEX.atlas = t }
  await Promise.all((Object.keys(PLANT_URLS) as (keyof typeof PLANT_URLS)[]).map(async (n) => {
    const img = new Image(); img.src = PLANT_URLS[n]; await img.decode()
    const t = new THREE.Texture(img); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true
    PLANT_TEX[n] = t
  }))
  await Promise.all(names.map(async (n) => {
    const img = new Image(); img.src = URLS[n]; await img.decode()
    const t = new THREE.Texture(img)
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8
    t.needsUpdate = true
    SCAN[n] = t
    onProgress(++done / names.length)
  }))
}
// the scan as detail: about 1 on average, carrying the scan's light-and-dark and its slight colour shifts
export const detail = (n: ScanName, uv: any, strength = 1) => {
  const a = (avg as Record<string, number[]>)[n]
  const d = texture(SCAN[n], uv).rgb.div(vec3(a[0], a[1], a[2]))
  return mix(vec3(1, 1, 1), d.clamp(0.15, 3.0), strength)
}
// for upright things (trunks, roots): two flat projections blended by which way the surface faces
export const detailUpright = (n: ScanName, scale: number, strength = 1) => {
  const p = positionWorld
  const w = smoothstep(0.35, 0.65, abs(normalWorld.x).div(abs(normalWorld.x).add(abs(normalWorld.z)).add(0.001)))
  return mix(detail(n, vec2(p.x, p.y).mul(scale), strength), detail(n, vec2(p.z, p.y).mul(scale), strength), w)
}
