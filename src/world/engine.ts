// The world engine: one object, one frame callback. No React here.
import * as THREE from 'three/webgpu';
import { sim, setUI, params } from '../state';
import { WORLD_SEED } from './rng';
import CookWorker from './cook.worker?worker&inline';
import type { TerrainCook } from './terrain';
import { sampleGrid } from './terrain';
import type { ForestCook } from './trees';
import type { KitMesh } from './meshkit';
import { makeKitGeometry } from './gfx';
import { U } from './uniforms';
import { makeWorldTextures, makeWorldMaterial, makeFogNode, type WorldTextures } from './worldmat';
import { Forest, type ForestDetail } from './forest';
import { makeWater } from './water';
import { makeSky, makeFarRings, makeClouds } from './sky';
import { applyTimeOfDay } from './timeofday';
import { FIXED_CAMS } from './cameras';
import { makePost, type Post } from './post';
import * as L from './layout';

export interface Cooked { terrain: TerrainCook; treeKit: KitMesh[][]; forest: ForestCook; }

export class Engine {
  cooked: Cooked | null = null;
  disposed = false;
  tex!: WorldTextures;
  worldMat!: THREE.MeshLambertNodeMaterial;
  forest!: Forest;
  water!: THREE.Mesh;
  sky!: THREE.Mesh;
  clouds!: THREE.Mesh;
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  focus = new THREE.Vector3(60, 10, -80);       // what the shadow box and detail centre on
  detail: ForestDetail = { lod0: 58, lod1: 170, max: 520, density: 1 };
  post!: Post;
  fullPost = !params.off.includes('post');
  frameNo = 0;
  counts = { calls: 0, tris: 0 };

  constructor(public renderer: THREE.WebGPURenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {}

  groundAt(x: number, z: number): number { return this.cooked ? sampleGrid(this.cooked.terrain.grid, x, z) : 0; }

  async start() {
    setUI({ mode: 'loading', backend: sim.backend });
    const r = this.renderer;
    r.info.autoReset = false;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
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
    setUI({ loading: { stage: 'Raising the world', f: 0.2 } });
    this.build(cooked);
    if (params.water !== null) sim.water = sim.waterTarget = params.water;
    if (params.tod !== null) sim.tod = sim.todTarget = params.tod;
    if (params.cam) this.setFixedCam(params.cam);
    this.updateEnv(0);
    setUI({ loading: { stage: 'Warming the light', f: 0.6 } });
    await r.compileAsync(this.scene, this.camera);
    sim.ready = true; (window as any).__ready = true;
    setUI({ mode: 'roam' });
  }

  build(c: Cooked) {
    const scene = this.scene;
    this.tex = makeWorldTextures(c.forest.open);
    this.worldMat = makeWorldMaterial(this.tex);
    const ground = new THREE.Mesh(makeKitGeometry(c.terrain.mesh), this.worldMat);
    ground.receiveShadow = true; ground.frustumCulled = false; ground.name = 'ground';
    scene.add(ground);
    this.forest = new Forest(c.forest, c.treeKit, this.worldMat);
    scene.add(this.forest.group);
    scene.add(makeFarRings(WORLD_SEED, this.worldMat));
    this.water = makeWater(); scene.add(this.water);
    this.sky = makeSky(); scene.add(this.sky);
    this.clouds = makeClouds(WORLD_SEED); scene.add(this.clouds);
    const s = this.sun;
    s.castShadow = true; s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0008; s.shadow.normalBias = 0.06; s.shadow.radius = 2.5;
    scene.add(s); scene.add(s.target); scene.add(this.hemi);
    (scene as any).fogNode = makeFogNode();
    scene.background = null;
    // free the cook's scratch arrays that were uploaded
    (c.terrain as any).mesh = null;
    this.post = makePost(this.renderer, scene, this.camera);
  }

  setFixedCam(name: string) {
    const fc = FIXED_CAMS.find((c) => c.name === name);
    if (!fc) return;
    const wy = sim.water * L.FLOOD_RANGE;
    const base = Math.max(this.groundAt(fc.x, fc.z), wy), lbase = Math.max(this.groundAt(fc.lx, fc.lz), wy);
    this.camera.position.set(fc.x, base + fc.up, fc.z);
    this.camera.fov = fc.fov ?? 42; this.camera.updateProjectionMatrix();
    this.camera.lookAt(fc.lx, lbase + fc.lup, fc.lz);
    this.camera.updateMatrixWorld();
    this.focus.set(fc.x, base, fc.z).lerp(new THREE.Vector3(fc.lx, lbase, fc.lz), 0.25);
  }

  updateEnv(dt: number) {
    // the two numbers ease toward their targets
    const k = 1 - Math.exp(-dt * 0.9);
    sim.water += (sim.waterTarget - sim.water) * k;
    sim.tod += (sim.todTarget - sim.tod) * (1 - Math.exp(-dt * 0.6));
    const wy = sim.water * L.FLOOD_RANGE;
    U.waterY.value = wy; U.lakeY.value = Math.max(wy, L.LAKE_LOW);
    U.time.value = sim.time;
    applyTimeOfDay(sim.tod, { sun: this.sun, hemi: this.hemi, renderer: this.renderer, tex: this.tex });
    // the one near-field sun shadow, centred on the focus, snapped so it does not swim
    const R = U.shadowR.value as number, f = this.focus;
    const sx = Math.round(f.x), sz = Math.round(f.z);
    const cam = this.sun.shadow.camera;
    if (cam.right !== R) { cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 260; cam.updateProjectionMatrix(); }
    const sd = U.sunDir.value as THREE.Vector3;
    this.sun.target.position.set(sx, f.y + 6, sz);
    this.sun.position.set(sx + sd.x * 130, f.y + 6 + sd.y * 130, sz + sd.z * 130);
    this.sun.target.updateMatrixWorld();
    const cp = this.camera.position;
    U.camSnap.value.set(Math.round(cp.x / 2) * 2, 0, Math.round(cp.z / 2) * 2);
    this.sky.position.copy(cp); this.clouds.position.set(cp.x, 0, cp.z);
  }

  offscreen: THREE.RenderTarget | null = null;
  frame(dt: number) {
    if (!this.cooked || !sim.ready) return;
    const r = this.renderer;
    if (!sim.paused && !params.shot) sim.time += dt;
    this.updateEnv(dt);
    this.forest.update(this.camera, this.focus, this.detail, U.shadowR.value as number);
    r.info.reset();
    if (params.shot) {
      // Headless software WebGPU dies when the canvas texture is acquired, so with ?shot=1
      // every frame goes to a render target and pictures are read back from it.
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      if (!this.offscreen || this.offscreen.width !== size.x || this.offscreen.height !== size.y) {
        this.offscreen?.dispose();
        this.offscreen = new THREE.RenderTarget(size.x, size.y); // the pipeline writes display-ready values
      }
      r.setRenderTarget(this.offscreen); this.renderWorld(); r.setRenderTarget(null);
    } else this.renderWorld();
    this.counts.calls = r.info.render.drawCalls; this.counts.tris = r.info.render.triangles;
    this.frameNo++;
    if (this.grab) { const g = this.grab; this.grab = null; this.readFrame().then(g); }
  }
  info() { return { ...this.counts, forest: { ...this.forest.stats }, trees: this.cooked?.forest.count, backend: sim.backend, water: sim.water, tod: sim.tod }; }
  grab: ((url: string) => void) | null = null;
  grabFrame(): Promise<string> { return new Promise((r) => { this.grab = r; }); }
  // test/capture helper: set state, let a few frames settle, grab a picture
  async shot(o: { cam?: string; water?: number; tod?: number; time?: number }): Promise<string> {
    if (o.water !== undefined) sim.water = sim.waterTarget = o.water;
    if (o.tod !== undefined) sim.tod = sim.todTarget = o.tod;
    if (o.time !== undefined) sim.time = o.time;
    if (o.cam) this.setFixedCam(o.cam);
    const start = this.frameNo;
    await new Promise<void>((res) => { const tick = () => (this.frameNo >= start + 3 ? res() : setTimeout(tick, 30)); tick(); });
    return this.grabFrame();
  }
  renderWorld() { this.post.render(this.fullPost); }
  async readFrame(): Promise<string> {
    const r = this.renderer, rt = this.offscreen!;
    const w = rt.width, h = rt.height;
    const px = await this.readPixels(rt, w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
    const flip = (r.backend as any).isWebGPUBackend !== true; // GL reads bottom-up
    for (let y = 0; y < h; y++) {
      const src = (flip ? h - 1 - y : y) * w * 4;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  }
  // Own readback on WebGPU (three leaves its read buffer mapped, which stalls later reads here).
  async readPixels(rt: THREE.RenderTarget, w: number, h: number): Promise<Uint8Array> {
    const r = this.renderer, be = r.backend as any;
    if (be.isWebGPUBackend !== true) return (await r.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
    const dev: any = be.device, tex = be.get(rt.texture).texture;
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const G = (globalThis as any).GPUBufferUsage, M = (globalThis as any).GPUMapMode;
    const buf = dev.createBuffer({ size: bpr * h, usage: G.COPY_DST | G.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, { width: w, height: h });
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(M.READ);
    const src = new Uint8Array(buf.getMappedRange()), out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
    buf.unmap(); buf.destroy();
    return out;
  }
  dispose() { this.disposed = true; }
}
