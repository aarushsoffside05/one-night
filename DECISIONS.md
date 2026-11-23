# Decisions

Plain record of what was decided in this run and why. Newest at the bottom of each part.

## Which run this is
- This session is the **Junior low-poly** run. Reason: the Junior brief and the Junior pack came with it; the branch is this session's own; the pull request title will start with "[junior]".
- **Aarush, 21 Nov, mid-run:** do not use the eight GPT pictures in `04-look/` as the look target. The look comes from Eos instead: the real-place photos (`03-eos`) for what things are, the Junior library and its principles (`08-junior-eos`) for style, and the brief's section 5 words. Concepts are our own. `04-look/` is not given to makers or critics.

## Stack (exact versions, all MIT unless noted)
| Package | Version | Licence |
|---|---|---|
| three | 0.187.0 (tag r187) | MIT |
| @react-three/fiber | 9.8.2 | MIT |
| react, react-dom | 19.3.1 | MIT |
| vite | 8.3.8 | MIT |
| @vitejs/plugin-react | 6.3.0 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| vite-plugin-singlefile | 2.3.4 | MIT |
| @types/three | 0.187.0 | MIT |
| tsx (scripts only) | see package.json | MIT |
| sharp (picture sheets only, not shipped) | 0.35.5 | Apache-2.0 |

TypeScript 5.9 rather than the new 7.0: the tools around it are proven on 5.x.

## Technical
- **Renderer:** `WebGPURenderer`, made in R3F's async `gl` factory, `await renderer.init()`. If WebGPU is missing it falls to its WebGL 2 backend by itself; `?webgl=1` forces that. The backend that ran is logged and shown.
- **R3F's part:** one `<Canvas frameloop="never">`, one mount component, one `useFrame` at priority 1 that calls the engine. Our own `requestAnimationFrame` loop calls R3F's `advance()` and skips display frames evenly on high-refresh screens (120 Hz → every other frame).
- **Everything is faceted by construction:** meshes are built un-indexed, three vertices per face with the face normal, so no derivative tricks are needed and 100% of world faces are flat.
- **Palette:** every face carries one swatch id; a 16 x 16 atlas made by code holds the colours and is re-tinted per time of day.
- **Hero pieces are made by code, not Blender.** The brief says they *may* be modelled in Blender. Code-built pieces use the same faceted kit as the rest of the world, add nothing to the download, and keep one look. Blender was not installed.
- **Trees are placed on the CPU in the worker** (they are needed for collisions), small cover is cooked on the GPU.
- **Headless pictures:** in this machine the software WebGPU device dies when the canvas texture is acquired. With `?shot=1` the engine renders into a render target and pictures are read back from it. This is real WebGPU rendering (SwiftShader), only the presenting step is skipped.

## Studio
- Helpers used so far: Story and play (wrote `GAME-PLAN.md`, `UNSOURCED.md`); a reader that turned the pinned three.js release into an API cheat sheet (kept outside the repository).

## Look reset (Aarush, 22 Nov)
- Aarush looked at the build and said it was ugly and "nothing like the Eos low-poly references". He pointed at the Junior library's biome sheet as the target: lush, saturated, glowing, "magical, fun, not dead", while keeping the Amazon truth and the studio workflow.
- What changed because of it: the ground is now smooth with softly blended colour (no per-triangle checker); crowns are leafy clusters with lighter tops and cool undersides; the palette is brighter; sun and sky light are stronger with coloured shade; grass tufts and flowers carpet the open ground; the sky has streak clouds and a sun halo; bloom is stronger.
- This bends two lines of the brief on purpose, because the references he chose do: the ground is not faceted (so "85% of world faces faceted" now holds for objects, not land), and colour is a little richer than "flat". Objects stay faceted and palette-coloured.
- The river keeps a silty green-gold (the real place), the cut-off lake is clearer and greener.
- Limits hit: the run's usage limit stopped three helpers mid-job (tree kit, buildings, plan writer). Tree kit was finished by the studio head; buildings and the plan are being restarted.

## Aarush, 22 Nov (second round)
- **First person.** He asked for it, so the camera is now the kid's eyes on foot and from the canoe seat (the brief said third person; his word wins). The third-person camera code stays behind `sim.firstPerson = false`.
- **Blender for hero assets.** He asked for the brief's Blender route. `bpy` 5.0.1 is installed (Python 3.11, outside the repository); scripts live in `tools/blender/`, exported `.glb` files (vertex colours only) in `src/assets/`. The earlier "made by code, not Blender" decision is reversed for hero pieces.
- **Meshlets.** The technique he pointed at is three.js r187's meshlet pipeline (`MeshletDrawingPipeline`, Nanite-style virtual geometry). It is wired behind `?meshlets=1` (WebGPU only). NOT verified: in this machine's software GPU the first frame did not finish within three minutes, so it is off by default until it is seen running on a real graphics card.
- **Water** is now a smooth surface with fine ripple normals, glints and shore foam (the faceted water read as ugly triangles).
