// Same seed → same world. Cooks twice (and once with another seed) and compares hashes.
import { cookTerrain } from '../src/world/terrain';
import { buildTreeKit, cookForest, NK, INST_STRIDE } from '../src/world/trees';
import { WORLD_SEED } from '../src/world/rng';

function hashBuf(a: ArrayLike<number>): string {
  let h = 2166136261 >>> 0;
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 0; i < a.length; i++) { f[0] = a[i]; h ^= u[0]; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}
function cook(seed: number) {
  const t0 = performance.now();
  const t = cookTerrain(seed, () => {});
  const kit = buildTreeKit(seed);
  const f = cookForest(seed, () => {});
  const ms = performance.now() - t0;
  const kinds = new Array(NK).fill(0);
  for (let i = 0; i < f.count; i++) kinds[f.inst[i * INST_STRIDE + 5]]++;
  return { ms, hash: [hashBuf(t.grid), hashBuf(t.mesh.pos), hashBuf(t.mesh.dat), hashBuf(f.inst), hashBuf(f.open), ...kit.flat().map((m) => hashBuf(m.pos))].join('-'),
    terrainTris: t.mesh.tris, trees: f.count, kinds, kitTris: kit.map((k) => k.map((m) => m.tris)), min: Math.min(...t.grid), max: Math.max(...t.grid) };
}
const a = cook(WORLD_SEED), b = cook(WORLD_SEED), c = cook(WORLD_SEED + 1);
console.log(JSON.stringify({ ...a, hash: a.hash.slice(0, 40) + '…' }));
console.log('same seed same world:', a.hash === b.hash ? 'PASS' : 'FAIL');
console.log('other seed differs:', a.hash !== c.hash ? 'PASS' : 'FAIL');
if (a.hash !== b.hash || a.hash === c.hash) process.exit(1);
