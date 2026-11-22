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
import { Cover, makeLandMaps } from './cover';
import { People, type Look } from './people';
import { Player, bindInput, type Solid } from './player';
import { buildCanoe } from './props';
import { Quality, markLoading } from './quality';
import { Particles } from './particles';
import { Animals } from './animals';
import { addRipple } from './ripples';
import { loadKit } from './assets';
import { TREE_KINDS } from './trees';
import { Bench } from './bench';
import { bus } from '../state';
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
  applyQuality() {
    const q = this.quality, d = q.def, k = q.detail;
    this.detail.lod0 = d.lod0; this.detail.lod1 = d.lod1 * (0.6 + 0.4 * k); this.detail.max = d.max * k; this.detail.density = d.density * k;
    if (this.cover) this.cover.density.value = d.cover * k;
    if (this.particles) this.particles.amount.value = d.particles * k;
    sim.renderScale = q.scale; this.post?.setScale(q.scale);
    const shadows = d.shadow > 0;
    this.sun.shadow.intensity = shadows ? 1 : 0; this.sunShadowOn = shadows;
  }
  sunShadowOn = true;
  post!: Post;
  cover!: Cover;
  people!: People;
  particles!: Particles;
  animals!: Animals;
  wakeAt = 0;
  canoeKit: KitMesh | null = null;
  player!: Player;
  solids: Solid[] = [];
  lampSpot = new THREE.SpotLight(0xffc27a, 0, 26, 0.95, 0.6, 1.4);
  lampGlow = new THREE.PointLight(0xffb866, 0, 9, 1.6);
  useFixedCam = false;
  quality = new Quality();
  bench!: Bench;
  lastFrameAt = 0;
  fps = 60;
  titleAngle = 0;
  frameNo = 0;
  counts = { calls: 0, tris: 0 };

  constructor(public renderer: THREE.WebGPURenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {}

  groundAt(x: number, z: number): number { return this.cooked ? sampleGrid(this.cooked.terrain.grid, x, z) : 0; }

  async start() {
    markLoading(true);
    setUI({ loading: { stage: 'Waking up', f: 0 }, backend: sim.backend });
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
    setUI({ loading: { stage: 'Unpacking the Blender pieces', f: 0.1 } });
    const crafted = new Map<number, [KitMesh, KitMesh]>();
    await Promise.all(TREE_KINDS.map(async (name, k) => { const [a, b] = await Promise.all([loadKit(`tree_${name}_0`), loadKit(`tree_${name}_1`)]); if (a && b) crafted.set(k, [a, b]); }));
    // kinds without their own Blender piece yet borrow the nearest crafted one, so no code-built shard trees remain among the broadleaves
    const borrow: Record<string, string> = { vineTower: 'tallPale', weeper: 'roundCrown', pioneer: 'lowSpread' };
    TREE_KINDS.forEach((name, k) => { const from = borrow[name]; if (from && !crafted.has(k)) { const src = crafted.get(TREE_KINDS.indexOf(from as any)); if (src) crafted.set(k, src); } });
    this.canoeKit = await loadKit('canoe');
    this.build(cooked, crafted);
    if (params.water !== null) sim.water = sim.waterTarget = params.water;
    if (params.tod !== null) sim.tod = sim.todTarget = params.tod;
    if (params.cam) this.setFixedCam(params.cam);
    const pp = new URLSearchParams(location.search).get('p');
    if (pp) { const [x, z, yaw] = pp.split(',').map(Number); this.player.place(x, z, yaw || 0); }
    if (new URLSearchParams(location.search).has('roll')) { const pl = this.player; this.animals.triggerRoll(pl.pos.x + Math.sin(pl.yaw + 0.35) * 5.5, pl.pos.z + Math.cos(pl.yaw + 0.35) * 5.5, pl.yaw + 1.4); sim.time += 2.1; }
    this.updateEnv(0);
    setUI({ loading: { stage: 'Warming the light', f: 0.6 } });
    this.cover.update(r, this.camera); // run every compute pass once before play
    this.particles.update(r, this.camera, 720);
    this.quality.onChange = () => this.applyQuality();
    this.quality.set(params.level ?? 'auto');
    this.bench = new Bench((x, z) => this.groundAt(x, z), () => this.counts, () => ({ postPasses: this.post.passes(this.quality.def.post), trees: this.cooked?.forest.count, coverInstances: this.cover.instances, coverOnGPU: this.cover.useCompute }));
    bus.on('quality', (l) => this.quality.set(l));
    bus.on('bench', () => { this.useFixedCam = false; this.bench.start(); });
    bus.on('mode', (m) => { sim.mode = m; this.useFixedCam = false; setUI({ mode: m }); });
    await r.compileAsync(this.scene, this.camera);
    // draw every pipeline once so nothing compiles mid-play
    const warm = new THREE.RenderTarget(64, 64);
    r.setRenderTarget(warm); for (const k of ['lite', 'mid', 'full'] as const) this.post.render(k); r.setRenderTarget(null); warm.dispose();
    this.applyQuality();
    markLoading(false);
    sim.ready = true; (window as any).__ready = true;
    setUI({ loading: { stage: 'Ready', f: 1 } });
    if (params.shot || params.auto) { sim.mode = (params.auto as any) || 'roam'; setUI({ mode: sim.mode }); }
  }

  build(c: Cooked, crafted: Map<number, [KitMesh, KitMesh]>) {
    const scene = this.scene;
    this.tex = makeWorldTextures(c.forest.open);
    this.worldMat = makeWorldMaterial(this.tex);
    const ground = new THREE.Mesh(makeKitGeometry(c.terrain.mesh), makeWorldMaterial(this.tex, { rgb: true }));
    ground.receiveShadow = true; ground.frustumCulled = false; ground.name = 'ground';
    scene.add(ground);
    this.forest = new Forest(c.forest, c.treeKit, this.worldMat, makeWorldMaterial(this.tex, { asset: true }), crafted);
    scene.add(this.forest.group);
    scene.add(makeFarRings(WORLD_SEED, this.worldMat));
    const land = makeLandMaps(c.terrain.grid, c.terrain.zone);
    const gpu = sim.backend === 'webgpu' && !params.off.includes('compute');
    this.cover = new Cover(this.tex, land, gpu);
    this.particles = new Particles(land, gpu);
    if (!params.off.includes('particles')) scene.add(this.particles.group);
    if (!params.off.includes('cover')) scene.add(this.cover.group);
    this.water = makeWater(); scene.add(this.water);
    this.sky = makeSky(); scene.add(this.sky);
    this.clouds = makeClouds(WORLD_SEED); this.clouds.visible = false; scene.add(this.clouds); // painted sky clouds replace the blob clouds
    const s = this.sun;
    s.castShadow = true; s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0008; s.shadow.normalBias = 0.06; s.shadow.radius = 2.5;
    scene.add(s); scene.add(s.target); scene.add(this.hemi);
    (scene as any).fogNode = makeFogNode();
    scene.background = null;
    // free the cook's scratch arrays that were uploaded
    (c.terrain as any).mesh = null;
    this.animals = new Animals(this.tex); scene.add(this.animals.group);
    // people and the kid
    this.people = new People(this.tex); scene.add(this.people.group);
    const kidLook: Look = { height: 1.5, skin: 'skinB', hair: 'hair', shirt: 'shirtYellow', shorts: 'shortsDark', shoe: 'shoe', sleeves: true, longLegs: false, pack: 'paintTeal' };
    const kid = this.people.add(kidLook);
    const canoe = this.canoeKit ? new THREE.Mesh(makeKitGeometry(this.canoeKit), makeWorldMaterial(this.tex, { asset: true, wind: false })) : new THREE.Mesh(makeKitGeometry(buildCanoe()), this.worldMat);
    canoe.castShadow = true; canoe.receiveShadow = true; canoe.name = 'canoe'; scene.add(canoe);
    this.player = new Player(kid, canoe, { groundAt: (x, z) => this.groundAt(x, z), forest: c.forest, solids: this.solids });
    this.player.place(L.BANK_TOP[0] + 8, L.BANK_TOP[1] + 12, 2.0);
    bindInput(this.renderer.domElement);
    // the lamp: one spot light with a shadow, plus a small glow without one
    this.lampSpot.castShadow = true; this.lampSpot.shadow.mapSize.set(1024, 1024); this.lampSpot.shadow.camera.near = 0.3; this.lampSpot.shadow.camera.far = 26;
    this.lampSpot.shadow.bias = -0.002; this.lampSpot.shadow.normalBias = 0.05;
    scene.add(this.lampSpot); scene.add(this.lampSpot.target); scene.add(this.lampGlow);
    this.post = makePost(this.renderer, scene, this.camera, this.sun, !params.off.includes('rays'));
  }

  setFixedCam(name: string) {
    const fc = FIXED_CAMS.find((c) => c.name === name);
    if (!fc) return;
    this.useFixedCam = true;
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
    this.sun.shadow.autoUpdate = this.sunShadowOn && this.sun.intensity > 0.02;
    const cp = this.camera.position;
    U.camSnap.value.set(Math.round(cp.x / 2) * 2, 0, Math.round(cp.z / 2) * 2);
    this.sky.position.copy(cp); this.clouds.position.set(cp.x, 0, cp.z);
  }

  updateLamp() {
    const night = U.night.value as number, on = Math.max(0, (night - 0.25) / 0.5) * sim.lamp;
    const f = this.player.fig, p = this.player;
    const lp = this.lampGlow.position;
    if (p.mode === 'canoe') lp.set(p.pos.x + Math.sin(p.yaw) * 1.7, p.pos.y + 0.55, p.pos.z + Math.cos(p.yaw) * 1.7);
    else if (f.holdsLamp) lp.copy(f.lampWorld); else lp.set(p.pos.x, p.pos.y + 1.0, p.pos.z);
    this.lampGlow.intensity = 14 * Math.min(1, on);
    this.lampSpot.position.set(lp.x, lp.y + 0.5, lp.z);
    this.lampSpot.target.position.set(lp.x + Math.sin(p.yaw) * 6, lp.y - 1.6, lp.z + Math.cos(p.yaw) * 6);
    this.lampSpot.target.updateMatrixWorld();
    this.lampSpot.intensity = 260 * Math.min(1, on);
    // the lamp's shadow pass is only drawn when the lamp is lit
    this.lampSpot.shadow.autoUpdate = on > 0.01;
  }
  offscreen: THREE.RenderTarget | null = null;
  frame(dt: number) {
    if (!this.cooked || !sim.ready) return;
    const r = this.renderer;
    if (!sim.paused && !params.shot) sim.time += dt;
    const now = performance.now(), frameMs = this.lastFrameAt ? now - this.lastFrameAt : 16.7; this.lastFrameAt = now;
    this.quality.tick(frameMs); this.fps += (1000 / Math.max(1, frameMs) - this.fps) * 0.05;
    if (this.bench.update(Math.min(0.1, frameMs / 1000), frameMs, this.camera, this.focus)) { /* the flight owns the camera */ }
    else if (sim.mode === 'title' && !this.useFixedCam) {
      // a slow turn above the community while the title is up
      this.titleAngle += dt * 0.03;
      const a = this.titleAngle + 2.6, cx = L.COMMUNITY[0] - 30, cz = L.COMMUNITY[1];
      this.camera.position.set(cx + Math.cos(a) * 70, 30, cz + Math.sin(a) * 70); this.camera.lookAt(cx, 9, cz);
      this.focus.set(cx, 10, cz);
    } else if (!this.useFixedCam) {
      this.player.update(dt, this.camera);
      this.focus.copy(this.player.pos);
    }
    this.camera.updateMatrixWorld();
    this.people.update(sim.time);
    this.animals.update(this.focus, (x, z) => this.groundAt(x, z));
    // the canoe leaves rings behind it
    if (sim.onWater && Math.abs(this.player.speed) > 0.4 && sim.time > this.wakeAt) { this.wakeAt = sim.time + 0.55; addRipple(this.player.pos.x - Math.sin(this.player.yaw) * 1.6, this.player.pos.z - Math.cos(this.player.yaw) * 1.6, sim.time, 0.045); }
    // Roam: at first light on the lake the giant fish rolls near the kid now and then
    if (sim.mode === 'roam' && sim.tod > 0.64 && sim.tod < 0.86 && sim.onWater && sim.time > this.animals.nextRoll && Math.hypot(this.player.pos.x - L.LAKE[0], this.player.pos.z - L.LAKE[1]) < 90) {
      this.animals.nextRoll = sim.time + 16; const a = this.player.yaw + 0.5;
      this.animals.triggerRoll(this.player.pos.x + Math.sin(a) * 6, this.player.pos.z + Math.cos(a) * 6, this.player.yaw + 1.3);
    }
    this.updateLamp();
    this.updateEnv(dt);
    this.forest.update(this.camera, this.focus, this.detail, U.shadowR.value as number);
    if (!params.off.includes('cover')) this.cover.update(r, this.camera);
    if (!params.off.includes('particles')) this.particles.update(r, this.camera, r.domElement.height * sim.renderScale);
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
  async shot(o: { cam?: string; water?: number; tod?: number; time?: number; p?: [number, number, number] }): Promise<string> {
    if (o.p) { this.useFixedCam = false; this.player.place(o.p[0], o.p[1], o.p[2]); }
    if (o.water !== undefined) sim.water = sim.waterTarget = o.water;
    if (o.tod !== undefined) sim.tod = sim.todTarget = o.tod;
    if (o.time !== undefined) sim.time = o.time;
    if (o.cam) this.setFixedCam(o.cam);
    const start = this.frameNo;
    await new Promise<void>((res) => { const tick = () => (this.frameNo >= start + 3 ? res() : setTimeout(tick, 30)); tick(); });
    return this.grabFrame();
  }
  renderWorld() { this.post.render(params.off.includes('post') ? 'lite' : this.quality.def.post); }
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
