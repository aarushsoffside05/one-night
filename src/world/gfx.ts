import * as THREE from 'three/webgpu';
import type { KitMesh } from './meshkit';

export function makeKitGeometry(m: KitMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
  g.setAttribute('dat', new THREE.BufferAttribute(m.dat, 3));
  g.computeBoundingSphere();
  return g;
}
