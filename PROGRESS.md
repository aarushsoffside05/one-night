# Progress

A new session told "continue" picks up here. Read `DECISIONS.md` first (Aarush's mid-run decisions A1, A2 are near the end).

## Done
- Step 0: tooling (pictures from the built site, fixed cameras, sheets, benchmark flight, single file, Pages workflow).
- Step 1: land and water. Step 2: forest. Step 3: light and time. Step 4: buildings and things. Step 5: life and sound (sound never heard by a person). Step 6: boy, canoe, camera; Roam with water and hour sliders and place buttons. Step 7: the family at their work in Roam.
- Step 8, first pass: all eight scenes on the story runner. `scripts/check-story.mjs` plays each with a bot, their way and rushed: all finish.
- Look pass after Aarush's feedback: real-leaf crowns, bark and ground relief, deeper shade, colour grade, sky in the water, closer camera.
- Megascans surface scans from Aarush (11) blended as detail into ground, trunks, planks, thatch. Raw scans are NOT in the repository; `scripts/make-textures.mjs <folder>` remakes `src/assets/tex`.

## In progress
- The people. Aarush does not like them. A helper was rebuilding the kit (`tools/blender`, `src/assets/models/people.glb`) and was stopped part way: the file has the new parts (shoes, boots, trousers, backpack, bigger head, fuller hair) and the game uses them, but nobody has judged the result and `tools/blender/README.md` may not match. Do not restart that helper unless Aarush asks.
- Blind critic rounds (brief section 9): none run yet. Sheets: `shots/step3/`.
- Story scenes have been checked by bot only. Nobody has looked at them as pictures yet (`node scripts/story-shots.mjs`).

## Next
1. Look at the story moments as pictures; fix staging.
2. Run the blind critic on `shots/step3` (give it only the sheets and the brief's sections 2 and 5).
3. When Aarush sends 3D plants from Fab (wish list `2026-11-21-fab-wishlist.md`, section B): convert, cut down, use as near-camera plants.
4. Step 9: final rebuild, counted numbers, the final report.

## Blocked / needs Aarush
- The repository should be made private: it now holds shrunk Megascans textures.
- The link goes live only after merge to `main` and Pages set to "GitHub Actions" (two commands in the final report).

## How to run
- `npm ci`, `npm run dev` (http://localhost:5173/; `?dev=1` dev panel, `?gl=1` WebGL 2, `?q=low|mid|high`).
- `npm run build` then `npx vite preview --port 4173 --strictPort`; then `node scripts/shots.mjs stepN`, `node scripts/check-play.mjs`, `node scripts/check-story.mjs`, `node scripts/check-seed.mjs`, `node scripts/check-file.mjs`, `node scripts/check-audio.mjs`.
