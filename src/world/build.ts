// Builds the world's few big objects from the cooked arrays. One call, returns handles.
import * as THREE from 'three/webgpu'
import { Fn, positionWorld, normalWorld, vec3, float, mix, smoothstep, texture, vec2, uniform } from 'three/tsl'
import type { CookResult } from './cook.worker'
import { Heightfield, GRID_N } from './terrain'
import { CORE, LAKE, LAKE_LEVEL } from './layout'
import { U } from './uniforms'

export type World = {
  hf: Heightfield
  group: THREE.Group
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  heightTex: THREE.DataTexture
  kindsTex: THREE.DataTexture
  lakeMesh: THREE.Mesh
  update(dt: number, camera: THREE.PerspectiveCamera): void
  counts: Record<string, number>
}

export function worldUV() { return positionWorld.xz.add(CORE).div(CORE * 2) }

export function buildWorld(c: CookResult, scene: THREE.Scene): World {
  const hf = new Heightfield(c.h)
  const group = new THREE.Group()
  scene.add(group)

  // height + ground-kind textures for shaders (water depth, wet band, ground painting)
  const half = new Uint16Array(c.h.length)
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(c.h[i])
  const heightTex = new THREE.DataTexture(half, GRID_N, GRID_N, THREE.RedFormat, THREE.HalfFloatType)
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter
  heightTex.needsUpdate = true
  const kindsTex = new THREE.DataTexture(c.kinds, GRID_N, GRID_N, THREE.RGBAFormat, THREE.UnsignedByteType)
  kindsTex.minFilter = kindsTex.magFilter = THREE.LinearFilter
  kindsTex.needsUpdate = true

  // terrain
  const tg = new THREE.BufferGeometry()
  tg.setAttribute('position', new THREE.BufferAttribute(c.terrain.pos, 3))
  tg.setAttribute('normal', new THREE.BufferAttribute(c.terrain.nrm, 3))
  tg.setIndex(new THREE.BufferAttribute(c.terrain.idx, 1))
  tg.computeBoundingSphere()
  const tm = new THREE.MeshLambertNodeMaterial()
  tm.colorNode = Fn(() => {
    const k = texture(kindsTex, worldUV())
    const base = mix(vec3(0.42, 0.42, 0.4), vec3(0.6, 0.58, 0.5), k.r)
    const wet = smoothstep(float(0.9), float(0.0), positionWorld.y.sub(U.water))
    const slope = smoothstep(float(0.95), float(0.6), normalWorld.y)
    return mix(base, vec3(0.3, 0.28, 0.25), slope.mul(0.6)).mul(mix(float(1), float(0.55), wet))
  })()
  const terrain = new THREE.Mesh(tg, tm)
  terrain.receiveShadow = true
  terrain.frustumCulled = false
  group.add(terrain)

  // water: one material, the river sheet plus the perched lake disc
  const wm = new THREE.MeshBasicNodeMaterial({ transparent: true })
  wm.colorNode = Fn(() => {
    const depth = positionWorld.y.sub(texture(heightTex, worldUV()).r)
    return mix(vec3(0.45, 0.5, 0.5), vec3(0.2, 0.26, 0.3), smoothstep(float(0), float(4), depth))
  })()
  wm.opacityNode = Fn(() => smoothstep(float(0.0), float(0.5), positionWorld.y.sub(texture(heightTex, worldUV()).r)).mul(0.85).add(0.1))()
  const river = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), wm)
  river.frustumCulled = false
  const lakeMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), wm)
  lakeMesh.scale.set(LAKE.rx * 1.35, 1, LAKE.rz * 1.35)
  lakeMesh.position.set(LAKE.x, LAKE_LEVEL, LAKE.z)
  group.add(river, lakeMesh)

  const sun = new THREE.DirectionalLight(0xfff0dd, 2.2)
  const hemi = new THREE.HemisphereLight(0xbcd0ff, 0x4a3a28, 1.1)
  scene.add(sun, sun.target, hemi)

  const counts: Record<string, number> = { terrainTris: c.terrain.idx.length / 3 }
  return {
    hf, group, sun, hemi, heightTex, kindsTex, lakeMesh, counts,
    update(_dt, camera) {
      const wy = U.water.value
      river.position.set(camera.position.x, wy, camera.position.z)
      lakeMesh.visible = wy < LAKE_LEVEL - 0.02
      U.lake.value = Math.max(LAKE_LEVEL, wy)
    },
  }
}
