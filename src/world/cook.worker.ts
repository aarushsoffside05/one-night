/// <reference lib="webworker" />
// Off-main-thread cooking: plain functions over typed arrays, posted back with transfer.
import { setSeed } from './rng'
import { bakeTerrain, Heightfield } from './terrain'
import { buildTerrainMesh } from './terrainGeom'
import { cookForest, FIELD_NAMES, type ForestCook } from './forestCook'

export type CookRequest = { seed: string; density: number }
export type CookResult = {
  type: 'done'
  h: Float32Array; kinds: Uint8Array
  terrain: { pos: Float32Array; nrm: Float32Array; idx: Uint32Array }
  forest: ForestCook
}
export type CookMsg = { type: 'stage'; name: string; pct: number } | CookResult

const post = (m: CookMsg, t: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, t)

self.onmessage = (e: MessageEvent<CookRequest>) => {
  setSeed(e.data.seed)
  post({ type: 'stage', name: 'Shaping the land', pct: 0.02 })
  const { h, kinds } = bakeTerrain((f) => post({ type: 'stage', name: 'Shaping the land', pct: 0.02 + f * 0.2 }))
  const hf = new Heightfield(h)
  post({ type: 'stage', name: 'Cutting the channel and the lake', pct: 0.24 })
  const terrain = buildTerrainMesh(hf)
  post({ type: 'stage', name: 'Planting the forest', pct: 0.3 })
  const forest = cookForest(hf, e.data.density, (f) => post({ type: 'stage', name: f < 0.6 ? 'Planting the forest' : 'Scattering leaves, roots and fallen wood', pct: 0.3 + f * 0.68 }))
  const tr: Transferable[] = [h.buffer, kinds.buffer, terrain.pos.buffer, terrain.nrm.buffer, terrain.idx.buffer, forest.cover.buffer, forest.solids.buffer]
  for (const n of FIELD_NAMES) tr.push(forest.fields[n].data.buffer, forest.fields[n].cellStart.buffer)
  post({ type: 'done', h, kinds, terrain, forest }, tr)
}
