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

## Steps 1 to 3 (land, forest, light)

- **One lighting model for everything.** `PaintedMaterial` (in `src/world/shade.ts`) is a Lambert node material with our own lighting model: a soft wrapped sun, a cool sky ambient and warm ground bounce written as plain maths, lamps and the orb as uniforms (no extra light objects), and moving pools of sun under the canopy. Only one real light exists (sun or moon), so nothing recompiles when lamps come on.
- **Canopy does not cast the real shadow.** Crowns are solid clumps; if they cast into the one shadow map the whole floor would be black. Under the canopy the "moving light pattern" from the brief does the job; trunks, buildings, boats and people cast the real shadow over the near 46 m.
- **Leaf clumps, no cut-out cards at all.** Crowns are lumpy solid meshes with rounded normals and shader dabs. The leafy edge is made from small real leaf triangles standing off the surface (both windings, one normal), not alpha-cut cards, so no draw in the game uses alpha test.
- **Detail steps swap per 50 m cell and shrink at the limit, no dither.** A dither needs `discard`, which is the same hidden-surface problem on Apple chips as cut-outs. Near, middle and far versions of a tree share a silhouette and swap per cell; everything at its draw limit shrinks to nothing in the vertex shader.
- **Per-cell culling with few draws.** The world is cut into 14 x 14 cells of 50 m. Each instanced field (trunks, crowns, saplings...) is one draw per detail step; each frame the visible cells are packed into the instance buffer (typed-array copies, no allocation) and re-uploaded only when the set of visible cells changes.
- **Small trees are real leaves.** Crowns of the smallest trees are leaf sprays (blade geometry), because solid clumps at eye level read as balloons.
- **Water.** One material. On WebGPU (middle and top levels) colour comes from the scene depth texture; on the lowest level and WebGL 2 from the baked land height map. Bank and forest reflections are faked by asking the height map whether the reflected ray would meet land. No mirror pass.
- **The yard is at 8.8 m, the knoll at 10.3 m.** The brief wants the marked tree's line over the boy's head and the house on tall legs, and also high ground that is ankle-deep at top water. One level cannot do both, so the yard is the lower ground under the house and a knoll behind it (with the aerial) is the high ground.
- **Blender.** `pip install bpy` worked (bpy 5.3.0, Python 3.13) well inside 30 minutes, so the hero pieces (canoes, surfboard, skiff, outboard, giant fish, people kit) are modelled by script in `tools/blender/` and exported as small vertex-colour glTF.
- **People are one skinned mesh.** All figures are merged into a single mesh whose parts are each bound rigidly to one bone, animated by code. That is one draw in the main pass and one in the shadow pass for everybody, instead of one draw per part type.
- **Pictures are taken from the built site** (`vite preview` on port 4173), not the dev server, so editing code cannot reload the page in the middle of a capture.

## 21 Nov, from Aarush (his words, mid-run)

- **A1. He does not like the character models, and the look must get far better** (nearer the underwater garden, the Eos reference photos and the reel). Done so far: crowns rebuilt from real leaves, relief on bark and ground, deeper shade with gold light, drawn leaf litter, the whole sky in the water's reflection, a colour grade, a closer camera; people kit being rebuilt chunkier to match `04-look`.
- **A2. He overrules the brief's ban on downloaded models and textures and its size cap:** "it's fine as long as it runs on the web"; quality levels low, medium, high are fine. He will download Quixel Megascans assets from Fab himself and upload them. I could not download them: Fab needs a sign-in and I use no logins. Wish list: `2026-11-21-fab-wishlist.md`. Consequences logged there: stand-in species (not Amazon), private repository needed for the raw files, bigger download.
- Still standing from the brief: no paid things, no logins, no outside AI tools, no reference pictures in the repository.

## Story (step 8)

- **Lines** come from the pack's scene plans (`01-story`), with the brief's wording where they differ: the opening line, Marta as the teacher who paddles (no motor on the school canoe), and "Pirarucu." said by Lia at the lake on the orb's map, not earlier.
- **Cut because they rest on facts the brief does not clear:** the planted rows on the beach; every far "still shape" or "glint" (caimans); "from the lodge"; the second half of Lia's counting line; "Black water, and white."; "Not at the edges."; "Most of it is the bank you climbed..."; "In May a boat comes in anywhere." (kept: "In October there is this.").
- **Written by me, because the plans gave no words:** Mãe on the radio ("Davi? Davi, are you there?"); Tomé in scene 6, "Light where I step." (the brief wants every hold's reason said by the person); the six captions of Dona Socorro's telling, each from one cleared fact.
- **Dropped:** Davi's scene 4 line quoting Nino (Nino never says it) and Tomé's "Ten metres." answer to it. Dona Socorro's year as a second orb view (the brief names only Tomé's).
- **Kept:** the closing question (it asks for no answer and checks none).
- **The two authored slips** (filming the trunk in scene 4, letting go of the line in scene 5) happen when the player presses F at the glowing prompt; if the player refuses for some seconds, the scene makes the slip anyway, because the story needs it. In scenes 6 and 7 pressing F cannot break the hold: Lia's hand keeps his.
- **Dona Socorro's telling** uses the real world with the one water number driven, colour dropped, inside the marked orb frame, then returns to low water.
- **Walking holds** (light at Caio's or Tomé's feet) need no key: the hold is staying beside him at his pace. Run ahead and his feet go dark, he stops, "Back. My feet."
- **Scenes are generators** (`src/game/story.ts`, `scenesA.ts`, `scenesB.ts`): a scene reads top to bottom like its plan. `scripts/check-story.mjs` plays all eight with a bot, their way and rushed.

## Scans and people (after A1, A2)

- **Scans are detail, not colour.** Each scan sample is divided by that scan's average colour, so it brings grain, cracks and ridges while the painted colour script stays ours. Eleven scans, 768 px, AO and cavity baked in, 1.3 MB in all. Raw downloads stay outside the repository.
- **Not used:** the leaf litter, mossy bark and corrugated sheet came as object atlases rather than repeating surfaces.
- **Size.** The single file is now about 4.2 MB (2.0 MB gzipped): over the brief's 3 MB aim, under its 8 MB ceiling, and Aarush lifted the cap.
- **People kit rebuild stopped part way** (the helper was stopped from outside). The game uses the newer file because it has every part and reads better than the first one; this is unjudged.

## People, third try (Aarush: "creepy", then "try getting realistic people")

- **A3. Downloaded people.** Our own kit figures are out. Interim: Quaternius "Animated Men" and "Animated Women" bodies (CC0 1.0, public domain; fetched from the author's public folder, no login), converted by `tools/people/export_people.py` into small binaries (`src/assets/models/p_*.bin`, about 100 KB each). Being built: realistic avatars from Microsoft Rocketbox (MIT licence) by `tools/people/make_rocketbox.py`.
- **How any body is animated.** Every vertex is bound to one or two of eleven body segments (hips, torso, head, upper arms, forearms, thighs, calves). Our own code poses the segments (walk, paddle, hold, carry...), so any rigged body can be dropped in without its own animations. Still one skinned mesh for everybody: one draw, one shadow draw.
- **Scanned plants (Megascans, from Aarush)** are converted by `scripts/make-plants.py` into `src/assets/models/scans.glb` and `src/assets/tex/scan_*.webp`. They are alpha cut-outs, which the brief warned about on Apple chips; with the brief's ban lifted they are used near the eye only (46 to 60 m) in seven instanced draws. This must be watched on the benchmark flight.
- **A3, done.** The people in the game are now realistic avatars from Microsoft Rocketbox (MIT licence), one per character, cut to 5,800 triangles each, textures in one shared atlas (`src/assets/tex/people_atlas.webp`, 310 KB), bodies in `src/assets/models/r_*.bin` (about 95 KB each). The Quaternius interim bodies and our own kit figures are no longer drawn. Hats and the backpack from our kit are dropped for now.
