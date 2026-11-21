import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { useEffect, useRef } from 'react'
import { Game } from './game/Game'
import { ui, useUI } from './game/store'
import { Shell } from './ui/Shell'

extend(THREE as any)

let game: Game | null = null
export const getGame = () => game

// The whole world mounts through this one component and runs from this one frame callback.
function WorldMount() {
  const { gl, scene, camera } = useThree()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    game = new Game(gl as unknown as THREE.WebGPURenderer, scene as unknown as THREE.Scene, camera as THREE.PerspectiveCamera)
    game.init().catch((e) => { console.error(e); ui.set({ error: String(e?.message || e) }) })
  }, [])
  useFrame(() => { game?.frame() })
  return null
}

export function App() {
  const forceGL = new URLSearchParams(location.search).get('gl') === '1'
  const error = useUI((s) => s.error)
  return (
    <>
      <Canvas
        frameloop="never"
        style={{ position: 'fixed', inset: 0 }}
        gl={async (props) => {
          const r = new THREE.WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: true, forceWebGL: forceGL })
          await r.init()
          return r
        }}
      >
        <WorldMount />
      </Canvas>
      <Shell />
      {error && <div className="error">Something went wrong: {error}</div>}
    </>
  )
}
