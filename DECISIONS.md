# Decisions

Every craft, tech or taste call made without asking, with the reason. Newest at the bottom.

## Pinned versions (exact)

| Package | Version | Licence |
|---|---|---|
| three | 0.187.0 | MIT |
| react, react-dom | 19.3.1 | MIT |
| @react-three/fiber | 9.8.2 | MIT |
| vite | 8.3.8 | MIT |
| @vitejs/plugin-react | 6.3.0 | MIT |
| typescript | 6.0.2 | Apache-2.0 |
| @types/three 0.187.0, @types/react 19.3.0, @types/react-dom 19.3.0, @types/node 22.x | types only | MIT |

Playwright and Chromium are the ones already installed on the build machine. They are used only to take pictures and run checks, and are not part of the game.

## Step 0

- **Headless pictures.** Page screenshots of the WebGPU canvas come out blank here. Pictures are read back from the renderer instead (`window.__ON.cap()` renders one frame and returns the canvas as JPEG). WebGPU only runs headless in new-headless Chromium through SwiftShader's Vulkan (`--use-vulkan=swiftshader --use-angle=vulkan --disable-vulkan-surface --enable-unsafe-webgpu`); the flags the brief lists gave a dropped device. This is a software renderer: it proves the WebGPU code path draws, it says nothing about speed.
- **Single file.** No plugin: `scripts/singlefile.mjs` inlines the one built script and style into `dist/one-night.html`. Workers use Vite's `?worker&inline` (an IIFE bundle started from a Blob URL), the same in both builds, so the link and the file run identical code.
- **TypeScript 6.0.2, not 7.** 7 is the new native compiler; 6 is the safer pin for a long unattended run.
- **Frame loop.** R3F runs with `frameloop="never"`; our own `requestAnimationFrame` loop calls R3F's `advance()`. This is what lets us render every other frame on a 120 Hz screen and measure the frame interval ourselves.
- **Draw counts.** `renderer.info.autoReset` is off and we reset once per rendered frame, so the draw and triangle numbers cover every pass of the frame (shadows included).
- **Coordinates.** Metres. y = 0 is the river at lowest water. +x is east (sunrise), -z is north (upstream). Top water is y = 10.6.
- **The lake is perched.** At low water the lake surface sits at 6.2 m, above the river, cut off by ground. One water material, two meshes: the river sheet, and a lake disc that is only drawn while the river is below the lake.
- **Height grid.** The land formula is baked to a 2 m grid (341 x 341) in a worker; the ground mesh and the walking code read the same grid, so feet and picture agree.
