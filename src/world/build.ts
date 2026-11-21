// Builds the world's few big objects from the cooked arrays. One call, returns handles.
import * as THREE from 'three/webgpu'
import type { CookResult } from './cook.worker'
import { Heightfield, GRID_N } from './terrain'
import { LAKE, LAKE_LEVEL } from './layout'
import { COVER_N } from './forestCook'
import { U } from './uniforms'
import { TEX, makeNoiseTexture, makeFog } from './shade'
import { groundMaterial } from './ground'
import { waterMaterial } from './water'
import { makeSky, makeFarRings } from './sky'
import { buildForest, type Forest } from './forest'
import { buildShafts } from './shafts'
import { updateCellVisibility } from './instanced'
import { applyEnv, envOut } from './env'
import { buildStructures, type Structures } from './structures'
import { buildLife, setLifeHeight, type Life } from './life'
import { Props } from './props'
import { Figures } from './figures'
import { TIERS, type Tier } from '../game/quality'

export type World = {
  hf: Heightfield
  group: THREE.Group
  sun: THREE.DirectionalLight
  forest: Forest
  solids: Float32Array
  structures: Structures
  life: Life
  props: Props
  figures: Figures
  update(dt: number, camera: THREE.PerspectiveCamera, tod: number, focus: THREE.Vector3): void
  counts(): Record<string, number>
}

const frustum = new THREE.Frustum(), pm = new THREE.Matrix4()

export function buildWorld(c: CookResult, scene: THREE.Scene, renderer: THREE.WebGPURenderer, tier: Tier, backend: string): World {
  const hf = new Heightfield(c.h)
  const group = new THREE.Group()
  scene.add(group)

  // textures made from the cooked arrays: land height, ground kinds, canopy cover; plus the noise sheet
  const half = new Uint16Array(c.h.length)
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(c.h[i])
  TEX.height = new THREE.DataTexture(half, GRID_N, GRID_N, THREE.RedFormat, THREE.HalfFloatType)
  TEX.kinds = new THREE.DataTexture(c.kinds, GRID_N, GRID_N, THREE.RGBAFormat, THREE.UnsignedByteType)
  TEX.cover = new THREE.DataTexture(c.forest.cover, COVER_N, COVER_N, THREE.RedFormat, THREE.UnsignedByteType)
  for (const t of [TEX.height, TEX.kinds, TEX.cover]) { t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true }
  TEX.noise = makeNoiseTexture()

  scene.fogNode = makeFog()
  scene.background = null
  const sky = makeSky()
  scene.add(sky)
  group.add(makeFarRings())

  // terrain
  const tg = new THREE.BufferGeometry()
  tg.setAttribute('position', new THREE.BufferAttribute(c.terrain.pos, 3))
  tg.setAttribute('normal', new THREE.BufferAttribute(c.terrain.nrm, 3))
  tg.setIndex(new THREE.BufferAttribute(c.terrain.idx, 1))
  const terrain = new THREE.Mesh(tg, groundMaterial())
  terrain.receiveShadow = true
  terrain.frustumCulled = false
  group.add(terrain)

  const forest = buildForest(c.forest, group)
  forest.fields.push(buildShafts(c.forest.fields.shaft, group))

  const structures = buildStructures(hf, group, c.forest.markedR)
  const solids = new Float32Array(c.forest.solids.length + structures.solids.length)
  solids.set(c.forest.solids); solids.set(structures.solids, c.forest.solids.length)

  const props = new Props(group)
  const figures = new Figures(props.kit, group)
  const life = buildLife(group, TIERS[tier].density, props.fishGeo)
  setLifeHeight((x, z) => hf.at(x, z))

  // water: one material, the river sheet plus the perched lake disc
  const wm = waterMaterial(backend === 'webgpu' && tier !== 'low')
  const river = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2), wm)
  river.frustumCulled = false
  river.renderOrder = 5
  const lakeMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), wm)
  lakeMesh.scale.set(LAKE.rx * 1.4, 1, LAKE.rz * 1.4)
  lakeMesh.position.set(LAKE.x, LAKE_LEVEL, LAKE.z)
  lakeMesh.renderOrder = 5
  group.add(river, lakeMesh)

  // the one real light: sun or moon, with one shadow over the near ground
  const sun = new THREE.DirectionalLight(0xffffff, 2)
  const T = TIERS[tier]
  if (T.shadows) {
    sun.castShadow = true
    sun.shadow.mapSize.set(T.shadowSize, T.shadowSize)
    const sc = sun.shadow.camera
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 400
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06
    sun.shadow.autoUpdate = false // redrawn every other frame, or at once when its centre jumps
  }
  scene.add(sun, sun.target)

  const snap = new THREE.Vector3(), lastSnap = new THREE.Vector3()
  let shadowTick = 0
  return {
    hf, group, sun, forest, solids, structures, life, props, figures,
    update(dt, camera, tod, focus) {
      applyEnv(tod, sun, renderer)
      const wy = U.water.value
      U.eye.value.copy(camera.position)
      river.position.set(camera.position.x, wy, camera.position.z)
      sky.position.copy(camera.position)
      lakeMesh.visible = wy < LAKE_LEVEL - 0.02
      U.lake.value = Math.max(LAKE_LEVEL, wy)
      structures.update(wy)
      // lamps: lit by the time of day, with a slow flicker
      const fl = 0.86 + 0.09 * Math.sin(U.time.value * 7.3) + 0.05 * Math.sin(U.time.value * 17.1)
      const L0 = structures.lamps[1], L1 = structures.lamps[0]
      U.lamp0.value.set(L0.x, L0.y + (L0.floats ? wy : 0), L0.z, envOut.lamp * 5.5 * fl)
      U.lamp1.value.set(L1.x, L1.y, L1.z, envOut.lamp * 4.0 * (1.9 - fl))
      // shadow follows the focus point, snapped so it does not shimmer
      snap.set(Math.round(focus.x / 2) * 2, focus.y, Math.round(focus.z / 2) * 2)
      if (T.shadows) { shadowTick++; if ((shadowTick & 1) === 0 || snap.x !== lastSnap.x || snap.z !== lastSnap.z) sun.shadow.needsUpdate = true; lastSnap.copy(snap) }
      sun.target.position.copy(snap)
      sun.position.copy(snap).addScaledVector(U.sunDir.value, 180)
      camera.updateMatrixWorld()
      pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(pm, renderer.coordinateSystem)
      updateCellVisibility(frustum, camera.position.x, camera.position.z)
      forest.update(U.detail.value * T.far)
      life.update(dt, U.time.value, camera.position, tod)
    },
    counts() { return { terrainTris: c.terrain.idx.length / 3, trees: c.forest.treeCount, ...forest.count() } },
  }
}
