// The cook: all generation off the main thread, from plain functions over typed arrays.
import { cookTerrain } from './terrain';
import { buildTreeKit, cookForest } from './trees';
import { transferables } from './meshkit';

export interface CookRequest { seed: number; }

self.onmessage = (e: MessageEvent<CookRequest>) => {
  const { seed } = e.data;
  const post = (stage: string, f: number) => (self as unknown as Worker).postMessage({ type: 'progress', stage, f });
  post('Shaping the land', 0);
  const terrain = cookTerrain(seed, (f) => post('Shaping the land', f));
  post('Growing the tree kit', 0);
  const treeKit = buildTreeKit(seed);
  post('Planting the forest', 0);
  const forest = cookForest(seed, (f) => post('Planting the forest', f));
  const tr: ArrayBuffer[] = [terrain.grid.buffer as ArrayBuffer, terrain.zone.buffer as ArrayBuffer, ...transferables(terrain.mesh),
    forest.inst.buffer as ArrayBuffer, forest.cellStart.buffer as ArrayBuffer, forest.open.buffer as ArrayBuffer];
  for (const k of treeKit) for (const m of k) tr.push(...transferables(m));
  (self as unknown as Worker).postMessage({ type: 'done', terrain, treeKit, forest }, tr);
};
