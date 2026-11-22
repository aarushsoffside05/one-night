// Shrinks the Blender exports: quantised positions, normals and colours (KHR_mesh_quantization,
// read natively by three's GLTFLoader; no wasm decoder). Run after tools/blender/*.py.
import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, weld, prune } from '@gltf-transform/functions';
import { readdirSync, statSync } from 'node:fs';
const dir = new URL('../src/assets/', import.meta.url).pathname;
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
let total = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
  const before = statSync(dir + f).size;
  const doc = await io.read(dir + f);
  await doc.transform(weld(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }), prune());
  await io.write(dir + f, doc);
  const after = statSync(dir + f).size; total += after;
  console.log(f.padEnd(28), (before / 1024).toFixed(0).padStart(6), '->', (after / 1024).toFixed(0).padStart(5), 'KB');
}
console.log('total', (total / 1024).toFixed(0), 'KB');
