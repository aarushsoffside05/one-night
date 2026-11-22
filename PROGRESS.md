# Progress

Last updated: 22 Nov. Read `DECISIONS.md` first: the look, the camera and the story all changed on Aarush's word.

## Done (ran and looked at, on software WebGPU in a headless browser)
- Step 0: pack found and kept outside the repository; headless WebGPU (SwiftShader) and WebGL 2 pictures; same-seed test; commit guard; Pages workflow publishing to `gh-pages/junior/`; draft pull request #1.
- Step 1: land and water from one height formula; the one water number drives water, wet band, flood line, floating plants, the canoe taking over in deep water.
- Step 2 (in part): forest of 16 tree kinds in groves with three detail steps and per-cell culling; ground cover cooked and culled on the GPU (grass, flowers, ferns, reeds, floating plants, driftwood); far silhouette rings; wind in the vertex stage.
- Step 3 (in part): time-of-day colour scripts, sun shadow, canopy light pattern, haze, light shafts from the shadow map, bloom, grade, FXAA, painted sky.
- Step 5 (in part): GPU particles (motes, fireflies, mist, rain, leaves), water rings, birds, fish, the giant fish's roll, cow and calf.
- Step 6 (in part): first-person kid on foot and by canoe, collisions, lamp light at night; Roam with water and time sliders; quality levels with a frame-time controller; benchmark flight (`?dev=1`, key B).
- Look reset toward the Junior references; first Blender-crafted assets (six tree kinds) loaded from `.glb`.
- `GAME-PLAN.md`: a new story, "Cheia - Three Weeks of Rising Water" (replaces the old one).

## In progress
- Buildings and boats crafted in Blender (helper): `tools/blender/`, `src/assets/`, `src/world/structures.ts`. Not yet wired into the engine.
- Fresh judge on the new `GAME-PLAN.md` (workflow), then fixes.

## Next
1. Wire structures into the engine (floating things ride the water, ropes, lamps, walkable decks).
2. People of the place at work (the rigid-part figure system exists; they need Blender-quality looks or a chunkier build).
3. Story: the sounding line (the device), chapters 1, 5, 6 first (they hold the four must-have moments), then 2 and 4.
4. Sound made by code.
5. Picture sheets for all cameras in four states, blind critic rounds, numbers, play bot.
6. Final report.

## Not ready / not proven
- Smoothness is not measured; it must be read from the benchmark flight on a real machine.
- Meshlets (`?meshlets=1`) never finished a frame on this machine's software GPU: untested.
- Triangle count at High is about 2.8 million in dense views: close to the 3 million budget.
- No story scene is built. No sound. People of the place are not in the world. The link needs GitHub Pages switched on.
- The world layout does not yet match the new plan's places (the hump, the old arm, the ridge, the cassava garden, the riverboat).

## How to pick up
- `npm install`, `npm run dev` (port 5173). One picture: `node scripts/snap.mjs '?shot=1&cam=yard&tod=0.12' out.jpg`. Sheets: `node scripts/shots.mjs <step>`.
- Blender: `python3.11 -m venv venv && venv/bin/pip install bpy`, then `venv/bin/python tools/blender/trees.py && node tools/pack-glb.mjs`.
- The pack is expected at `/home/user/pack/2026-11-21-amazon-pack` (never in the repository).
