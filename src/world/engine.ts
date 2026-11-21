// The world engine: one object, one frame callback.
import * as THREE from 'three/webgpu';
import { sim, setUI, params } from '../state';
import { WORLD_SEED } from './rng';
import CookWorker from './cook.worker?worker&inline';
import type { TerrainCook } from './terrain';
import type { ForestCook } from './trees';
import type { KitMesh } from './meshkit';
import { makeKitGeometry } from './gfx';

export interface Cooked { terrain: TerrainCook; treeKit: KitMesh[][]; forest: ForestCook; }

export class Engine {
  cooked: Cooked | null = null;
  disposed = false;
  constructor(public renderer: THREE.WebGPURenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {}

  async start() {
    setUI({ mode: 'loading', backend: sim.backend });
    const cooked = await new Promise<Cooked>((resolve) => {
      const w = new CookWorker();
      w.onmessage = (e) => {
        if (e.data.type === 'progress') setUI({ loading: { stage: e.data.stage, f: e.data.f } });
        else { resolve(e.data as Cooked); w.terminate(); }
      };
      w.postMessage({ seed: WORLD_SEED });
    });
    if (this.disposed) return;
    this.cooked = cooked;
    const geo = makeKitGeometry(cooked.terrain.mesh);
    const mat = new THREE.MeshLambertNodeMaterial({ color: 0x8a8a84 });
    this.scene.add(new THREE.Mesh(geo, mat));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(-60, 80, -40); this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfd4e6, 0x554433, 1.0));
    this.scene.background = new THREE.Color(0xa9c4d6);
    this.camera.position.set(110, 34, -150); this.camera.lookAt(20, 4, -60);
    await this.renderer.compileAsync(this.scene, this.camera);
    sim.ready = true; (window as any).__ready = true;
    setUI({ mode: 'roam' });
  }
  // In this headless machine the software WebGPU device dies the moment the canvas
  // texture is acquired, so with ?shot=1 every frame goes to a render target instead
  // and pictures are read back from it. Real browsers present to the canvas as usual.
  offscreen: THREE.RenderTarget | null = null;
  frame(_dt: number) {
    if (!this.cooked) return;
    const r = this.renderer;
    if (params.shot) {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      if (!this.offscreen || this.offscreen.width !== size.x || this.offscreen.height !== size.y) {
        this.offscreen?.dispose();
        this.offscreen = new THREE.RenderTarget(size.x, size.y, { colorSpace: THREE.SRGBColorSpace });
      }
      r.setRenderTarget(this.offscreen); this.renderWorld(); r.setRenderTarget(null);
    } else this.renderWorld();
    (window as any).__info = { calls: r.info.render.drawCalls, tris: r.info.render.triangles };
    if (this.grab) { const g = this.grab; this.grab = null; this.readFrame().then(g); }
  }
  grab: ((url: string) => void) | null = null;
  grabFrame(): Promise<string> { return new Promise((r) => { this.grab = r; }); }
  renderWorld() { this.renderer.render(this.scene, this.camera); }
  async readFrame(): Promise<string> {
    const r = this.renderer, rt = this.offscreen!;
    const w = rt.width, h = rt.height;
    const px = (await r.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
    const flip = (r.backend as any).isWebGPUBackend !== true; // GL reads bottom-up
    for (let y = 0; y < h; y++) {
      const src = (flip ? h - 1 - y : y) * w * 4;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  dispose() { this.disposed = true; }
}
