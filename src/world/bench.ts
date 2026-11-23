// The benchmark flight (dev): a fixed 60 second route through the densest places,
// 20 s at each of three water levels. Reports frame times and counts.
import * as THREE from 'three/webgpu';
import { sim, setUI } from '../state';
import * as L from './layout';
import { waterSurfaceAt } from './height';

const ROUTE: [number, number][] = [
  [-60, -200], [-10, -170], [10, -120], [30, -88], [62, -84], [88, -50], [104, 0], [114, 40], [124, 72], [142, 114], [158, 150], [186, 196], [150, 130], [112, 30], [70, -70],
];
export class Bench {
  running = false; t = 0; frames: number[] = []; draws = 0; tris = 0; maxDraws = 0; maxTris = 0; n = 0;
  private a = new THREE.Vector3(); private b = new THREE.Vector3();
  constructor(private groundAt: (x: number, z: number) => number, private info: () => { calls: number; tris: number }, private extra: () => Record<string, unknown>) {}
  start() { this.running = true; this.t = 0; this.frames = []; this.draws = this.tris = this.n = this.maxDraws = this.maxTris = 0; setUI({ benchRunning: true, bench: '' }); }
  private at(u: number, out: THREE.Vector3) {
    const f = Math.min(0.9999, Math.max(0, u)) * (ROUTE.length - 1), i = Math.floor(f), k = f - i;
    const p0 = ROUTE[Math.max(0, i - 1)], p1 = ROUTE[i], p2 = ROUTE[Math.min(ROUTE.length - 1, i + 1)], p3 = ROUTE[Math.min(ROUTE.length - 1, i + 2)];
    const c = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * k + (2 * a - 5 * b + 4 * c2 - d) * k * k + (-a + 3 * b - 3 * c2 + d) * k * k * k);
    const x = c(p0[0], p1[0], p2[0], p3[0]), z = c(p0[1], p1[1], p2[1], p3[1]);
    out.set(x, Math.max(this.groundAt(x, z), waterSurfaceAt(x, z, sim.water)) + 2.4, z);
  }
  // returns true while it owns the camera
  update(dtReal: number, frameMs: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3): boolean {
    if (!this.running) return false;
    this.t += dtReal;
    const third = Math.min(2, Math.floor(this.t / 20));
    sim.water = sim.waterTarget = [0, 0.5, 1][third];
    const u = (this.t % 20) / 20;
    this.at(u, this.a); this.at(u + 0.02, this.b);
    camera.position.copy(this.a); camera.lookAt(this.b.x, this.b.y - 0.2, this.b.z); focus.copy(this.a);
    if (this.t > 1.5) { // let it settle after the start
      this.frames.push(frameMs); const i = this.info(); this.draws += i.calls; this.tris += i.tris; this.n++;
      this.maxDraws = Math.max(this.maxDraws, i.calls); this.maxTris = Math.max(this.maxTris, i.tris);
    }
    if (this.t >= 60) this.finish();
    return true;
  }
  finish() {
    this.running = false;
    const f = this.frames.slice().sort((a, b) => a - b), n = f.length || 1;
    const avg = f.reduce((a, b) => a + b, 0) / n;
    const res = {
      build: 'one-night junior', backend: sim.backend, level: sim.activeLevel, renderScale: +sim.renderScale.toFixed(2),
      frames: n, avgFrameMs: +avg.toFixed(2), worst1pctMs: +(f[Math.floor(n * 0.99)] ?? 0).toFixed(2), worstFrameMs: +(f[n - 1] ?? 0).toFixed(2),
      over33ms: f.filter((x) => x > 33.4).length, avgDraws: Math.round(this.draws / Math.max(1, this.n)), maxDraws: this.maxDraws,
      avgTriangles: Math.round(this.tris / Math.max(1, this.n)), maxTriangles: this.maxTris,
      screen: `${innerWidth}x${innerHeight} @${devicePixelRatio}`, ua: navigator.userAgent, ...this.extra(),
    };
    (window as any).__bench = res;
    setUI({ benchRunning: false, bench: JSON.stringify(res, null, 1) });
  }
}
