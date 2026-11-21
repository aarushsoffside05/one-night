/// <reference lib="webworker" />
// Off-main-thread cooking: plain functions over typed arrays, posted back with transfer.
import { setSeed } from './rng'
import { bakeTerrain, Heightfield } from './terrain'
import { buildTerrainMesh } from './terrainGeom'

export type CookRequest = { seed: string }
export type CookResult = {
  type: 'done'
  h: Float32Array; kinds: Uint8Array
  terrain: { pos: Float32Array; nrm: Float32Array; idx: Uint32Array }
}
export type CookMsg = { type: 'stage'; name: string; pct: number } | CookResult

const post = (m: CookMsg, t: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, t)

self.onmessage = (e: MessageEvent<CookRequest>) => {
  setSeed(e.data.seed)
  post({ type: 'stage', name: 'Shaping the land', pct: 0.05 })
  const { h, kinds } = bakeTerrain((f) => post({ type: 'stage', name: 'Shaping the land', pct: 0.05 + f * 0.3 }))
  const hf = new Heightfield(h)
  post({ type: 'stage', name: 'Cutting the channel and the lake', pct: 0.4 })
  const terrain = buildTerrainMesh(hf)
  post({ type: 'done', h, kinds, terrain }, [h.buffer, kinds.buffer, terrain.pos.buffer, terrain.nrm.buffer, terrain.idx.buffer])
}
