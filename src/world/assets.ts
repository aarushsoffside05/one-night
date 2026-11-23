// Blender-made hero assets (.glb, vertex colours only, quantised). They sit in the bundle
// and are parsed from memory; nothing is fetched from outside the site.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three/webgpu';
import type { KitMesh } from './meshkit';

const files = import.meta.glob('../assets/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
export const assetNames = () => Object.keys(files).map((k) => k.split('/').pop()!.replace('.glb', ''));

// One merged KitMesh per file: dat = linear vertex colour, wnd = colour alpha (wind weight, or a glow flag for made things).
export async function loadKit(name: string): Promise<KitMesh | null> {
  const url = files[`../assets/${name}.glb`];
  if (!url) return null;
  const buf = await (await fetch(url)).arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const pos: number[] = [], nrm: number[] = [], dat: number[] = [], wnd: number[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o: any) => {
    if (!o.isMesh) return;
    const g: THREE.BufferGeometry = o.geometry, P = g.getAttribute('position'), N = g.getAttribute('normal'), C = g.getAttribute('color'), idx = g.getIndex();
    nm.getNormalMatrix(o.matrixWorld);
    const count = idx ? idx.count : P.count;
    for (let i = 0; i < count; i++) {
      const k = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(P, k).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
      if (N) n.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
      nrm.push(n.x, n.y, n.z);
      if (C) { dat.push(C.getX(k), C.getY(k), C.getZ(k)); wnd.push(C.itemSize > 3 ? C.getW(k) : 0); } else { dat.push(0.6, 0.6, 0.6); wnd.push(0); }
    }
  });
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), dat: new Float32Array(dat), wnd: new Float32Array(wnd), tris: pos.length / 9 };
}
