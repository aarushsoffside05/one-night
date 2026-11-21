# Progress

A new session told "continue" picks up here. Read `DECISIONS.md` first (Aarush's mid-run decisions A1, A2 are near the end).

## Done
- Step 0: tooling (pictures from the built site, fixed cameras, sheets, benchmark flight, single file, Pages workflow).
- Step 1: land and water. Step 2: forest. Step 3: light and time. Step 4: buildings and things. Step 5: life and sound (sound never heard by a person). Step 6: boy, canoe, camera; Roam with water and hour sliders and place buttons. Step 7: the family at their work in Roam.
- Step 8, first pass: all eight scenes on the story runner. `scripts/check-story.mjs` plays each with a bot, their way and rushed: all finish.
- Look pass after Aarush's feedback: real-leaf crowns, bark and ground relief, deeper shade, colour grade, sky in the water, closer camera.
- Megascans surface scans from Aarush (11) blended as detail into ground, trunks, planks, thatch. Raw scans are NOT in the repository; `scripts/make-textures.mjs <folder>` remakes `src/assets/tex`.

## State on 21 Nov (end of the long run)
- Steps 0 to 9 have each had a pass. Final report: `2026-11-21-final-report.md` (what is NOT READY is its first section).
- Three blind critic rounds ran on the sheets: 65, 56, 51 faults. Its open list is in the final report.
- People are Microsoft Rocketbox avatars (MIT). Fab (Megascans) surfaces and plants are in.

## Next, in order of value
1. Aarush runs the benchmark flight on his MacBook and sends the numbers; tune from them (cut-out plants and screen passes are the likely costs).
2. The critic's open list: night readability away from lamps, bare beach and yard, banks, giant trunk, crown shapes.
3. People: clothes and faces that fit a river family; hats; Davi's backpack.
4. Place the remaining converted Fab pieces (canoe, oar, driftwood, liana, vine, trunk).
5. Watch each scene in motion and time it.

## Blocked / needs Aarush
- Benchmark numbers from a real machine.
- Repository privacy (Megascans files) against a free public Pages link.
- A reader from the reserve's communities before anyone else sees it.

## How to run
- `npm ci`, `npm run dev` (http://localhost:5173/; `?dev=1` dev panel, `?gl=1` WebGL 2, `?q=low|mid|high`).
- `npm run build` then `npx vite preview --port 4173 --strictPort`; then `node scripts/shots.mjs stepN`, `node scripts/check-play.mjs`, `node scripts/check-story.mjs`, `node scripts/check-seed.mjs`, `node scripts/check-file.mjs`, `node scripts/check-audio.mjs`.
