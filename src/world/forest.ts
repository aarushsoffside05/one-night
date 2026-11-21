// Draws the cooked forest: one instanced mesh per tree kind and detail step.
// Each frame the visible 50 m cells are walked and the three instance lists
// are refilled; nothing is allocated. Shadow casters are kept by distance,
// not by view, so trees behind the camera still cast into the shadow box.
import * as THREE from 'three/webgpu';
import type { ForestCook } from './trees';
import { INST_STRIDE, NK, TREE_HEIGHT, TREE_CROWN, TREE_FAR } from './trees';
import type { KitMesh } from './meshkit';
import { makeKitGeometry } from './gfx';
import * as L from './layout';

export interface ForestDetail { lod0: number; lod1: number; max: number; density: number; }

export class Forest {
  meshes: THREE.InstancedMesh[][] = []; // [kind][near, mid], then one last row: the three far shapes
  mats: Float32Array;                   // 16 per tree
  cols: Float32Array;                   // 3 per tree
  counts: number[][] = [];
  group = new THREE.Group();
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private box = new THREE.Box3();
  stats = { lod0: 0, lod1: 0, lod2: 0 };

  constructor(public cook: ForestCook, kit: KitMesh[][], material: THREE.Material) {
    const n = cook.count, inst = cook.inst;
    this.mats = new Float32Array(n * 16); this.cols = new Float32Array(n * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const perKind = new Array(NK).fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * INST_STRIDE;
      p.set(inst[o], inst[o + 1], inst[o + 2]); q.setFromAxisAngle(up, inst[o + 3]);
      const sc = inst[o + 4]; s.set(sc, sc * (0.92 + inst[o + 6] * 0.2), sc);
      m.compose(p, q, s).toArray(this.mats, i * 16);
      const tnt = inst[o + 6]; // small per-tree shift in warmth and value
      this.cols[i * 3] = 0.9 + tnt * 0.2; this.cols[i * 3 + 1] = 0.92 + ((tnt * 7.3) % 1) * 0.16; this.cols[i * 3 + 2] = 0.88 + ((tnt * 3.7) % 1) * 0.2;
      perKind[inst[o + 5]]++;
    }
    const mk = (geo: KitMesh, cap: number, cast: boolean, name: string) => {
      const mesh = new THREE.InstancedMesh(makeKitGeometry(geo), material, Math.max(1, cap));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.castShadow = cast; mesh.receiveShadow = true; mesh.count = 0; mesh.name = name;
      this.group.add(mesh);
      return mesh;
    };
    for (let k = 0; k < NK; k++) {
      this.meshes.push([mk(kit[k][0], Math.min(perKind[k], 600), TREE_HEIGHT[k] > 5, `tree${k}_near`), mk(kit[k][1], Math.min(perKind[k], 3000), false, `tree${k}_mid`)]);
      this.counts.push([0, 0]);
    }
    const farCap = [0, 0, 0];
    for (let k = 0; k < NK; k++) if (TREE_FAR[k] >= 0) farCap[TREE_FAR[k]] += perKind[k];
    this.meshes.push([0, 1, 2].map((i) => mk(kit[NK][i], farCap[i], false, `treeFar${i}`)));
    this.counts.push([0, 0, 0]);
  }

  update(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, d: ForestDetail, shadowR: number) {
    const { cook, mats, cols } = this;
    const inst = cook.inst, nc = cook.nc, cs = L.CELL;
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    for (const c of this.counts) c.fill(0);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const max2 = d.max * d.max, l0 = d.lod0 * d.lod0, l1 = d.lod1 * d.lod1, sh2 = shadowR * shadowR;
    const fadeBand = Math.max(20, d.max * 0.12);
    for (let j = 0; j < nc; j++) {
      const z0 = cook.cellMin + j * cs;
      for (let i = 0; i < nc; i++) {
        const c = j * nc + i, a = cook.cellStart[c], b = cook.cellStart[c + 1];
        if (a === b) continue;
        const x0 = cook.cellMin + i * cs;
        // distance from camera to the cell rectangle
        const dx = Math.max(x0 - cx, 0, cx - x0 - cs), dz = Math.max(z0 - cz, 0, cz - z0 - cs);
        const cd2 = dx * dx + dz * dz;
        if (cd2 > max2) continue;
        const fx = Math.max(x0 - focus.x, 0, focus.x - x0 - cs), fz = Math.max(z0 - focus.z, 0, focus.z - z0 - cs);
        const nearShadow = fx * fx + fz * fz < sh2;
        this.box.min.set(x0 - 12, -3, z0 - 12); this.box.max.set(x0 + cs + 12, 52, z0 + cs + 12);
        const inView = this.frustum.intersectsBox(this.box);
        if (!inView && !nearShadow) continue;
        for (let t = a; t < b; t++) {
          const o = t * INST_STRIDE;
          const ddx = inst[o] - cx, ddz = inst[o + 2] - cz, ddy = inst[o + 1] + 10 - cy;
          const d2 = ddx * ddx + ddz * ddz + ddy * ddy * 0.25;
          if (d2 > max2) continue;
          const k = inst[o + 5];
          // thin the far forest by density setting (stable per tree)
          if (d.density < 1 && d2 > l1 && inst[o + 6] > d.density) continue;
          const dist = Math.sqrt(d2);
          let row = k, col: number, f = 1, sxz = 1, sy = 1;
          if (d2 < l0) col = 0;
          else if (!inView) continue;
          else if (d2 < l1) { col = 1; if (TREE_FAR[k] < 0) f = Math.min(1, (d.lod1 - dist) / 14); } // small kinds shrink away at the mid limit
          else {
            if (TREE_FAR[k] < 0) continue;
            row = NK; col = TREE_FAR[k]; sxz = TREE_CROWN[k]; sy = TREE_HEIGHT[k];
            if (dist > d.max - fadeBand) f = Math.max(0, (d.max - dist) / fadeBand);       // shrink away at the draw limit
          }
          const mesh = this.meshes[row][col];
          const n = this.counts[row][col];
          if (n >= mesh.instanceMatrix.count) continue;
          const dst = mesh.instanceMatrix.array as Float32Array, src = t * 16, at = n * 16;
          if (f >= 1 && row !== NK) { for (let q = 0; q < 16; q++) dst[at + q] = mats[src + q]; }
          else {
            const a = sxz * f, bb = sy * f;
            dst[at] = mats[src] * a; dst[at + 1] = mats[src + 1] * a; dst[at + 2] = mats[src + 2] * a; dst[at + 3] = 0;
            dst[at + 4] = mats[src + 4] * bb; dst[at + 5] = mats[src + 5] * bb; dst[at + 6] = mats[src + 6] * bb; dst[at + 7] = 0;
            dst[at + 8] = mats[src + 8] * a; dst[at + 9] = mats[src + 9] * a; dst[at + 10] = mats[src + 10] * a; dst[at + 11] = 0;
            dst[at + 12] = mats[src + 12]; dst[at + 13] = mats[src + 13]; dst[at + 14] = mats[src + 14]; dst[at + 15] = 1;
          }
          const cdst = mesh.instanceColor!.array as Float32Array;
          cdst[n * 3] = cols[t * 3]; cdst[n * 3 + 1] = cols[t * 3 + 1]; cdst[n * 3 + 2] = cols[t * 3 + 2];
          this.counts[row][col] = n + 1;
        }
      }
    }
    let s0 = 0, s1 = 0, s2 = 0;
    for (let k = 0; k <= NK; k++) for (let l = 0; l < this.meshes[k].length; l++) {
      const mesh = this.meshes[k][l], n = this.counts[k][l];
      mesh.count = n; mesh.visible = n > 0;
      if (n > 0) {
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.clearUpdateRanges(); mesh.instanceColor!.addUpdateRange(0, n * 3); mesh.instanceColor!.needsUpdate = true;
      }
      if (k === NK) s2 += n; else if (l === 0) s0 += n; else s1 += n;
    }
    this.stats.lod0 = s0; this.stats.lod1 = s1; this.stats.lod2 = s2;
  }
}
export { TREE_HEIGHT };
