# Progress

A new session told "continue" picks up here. Read `DECISIONS.md` too.

## Done
- Step 0: headless pictures (WebGPU through SwiftShader, read back from the renderer), fixed cameras, picture sheets (`node scripts/shots.mjs <step>`), benchmark flight (`?dev=1`, key B), single-file build (`npm run build` -> `dist/one-night.html`), file:// check (`node scripts/check-file.mjs`), Pages workflow.

## In progress
- Step 1: land and water in grey.

## Next
- Step 2 forest, 3 light and time, 4 buildings, 5 life and sound, 6 boy and canoe, 7 people, 8 story, 9 finish.

## Blocked
- Nothing.

## How to run
- `npm ci`, `npm run dev` (http://localhost:5173/, add `?dev=1` for the dev panel, `?gl=1` to force WebGL 2, `?q=low|mid|high` to force a quality level).
- Pictures: start `npm run dev`, then `node scripts/shots.mjs stepN` (add `--gl` for the WebGL 2 backend).
