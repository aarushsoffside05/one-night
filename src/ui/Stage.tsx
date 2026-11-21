// The one R3F mount. React owns nothing in the world beyond this: the engine
// builds a handful of instanced/merged objects and is driven from one frame callback.
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { Engine } from '../world/engine';
import { params, sim } from '../state';

extend(THREE as any);

function WorldMount() {
  const { gl, scene, camera, advance } = useThree();
  const engine = useRef<Engine | null>(null);
  useEffect(() => {
    const e = new Engine(gl as unknown as THREE.WebGPURenderer, scene as unknown as THREE.Scene, camera as THREE.PerspectiveCamera);
    engine.current = e;
    (window as any).__engine = e;
    e.start();
    // Frame pacing: cap at 60 on high-refresh displays by skipping display frames evenly.
    let raf = 0, last = 0, acc = 0, lastRaf = 0, period = 16.7;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (lastRaf) { const d = t - lastRaf; if (d > 2 && d < 50) period += (d - period) * 0.05; }
      lastRaf = t;
      const every = period < 11.5 ? Math.round(16.667 / period) : 1; // 120 Hz → 2, 144 → 2, 240 → 4
      acc++;
      if (acc < every) return;
      acc = 0;
      if (!last) last = t;
      last = t;
      advance(t / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); e.dispose(); };
  }, [gl, scene, camera, advance]);
  // priority 1: we render (through the post pipeline); R3F does not.
  useFrame((_, dt) => { engine.current?.frame(Math.min(dt, 0.1)); }, 1);
  return null;
}

export function Stage() {
  return (
    <Canvas
      frameloop="never"
      dpr={params.shot ? 1 : Math.min(2, window.devicePixelRatio || 1)}
      camera={{ fov: 42, near: 0.3, far: 2600, position: [60, 20, -60] }}
      style={{ position: 'fixed', inset: 0 }}
      gl={async (props: any) => {
        const renderer = new THREE.WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: false, forceWebGL: params.forceWebGL, powerPreference: 'high-performance' } as any);
        await renderer.init();
        const isGPU = (renderer.backend as any).isWebGPUBackend === true;
        sim.backend = isGPU ? 'webgpu' : 'webgl2';
        console.info('[one-night] backend:', sim.backend);
        return renderer as any;
      }}
    >
      <WorldMount />
    </Canvas>
  );
}
