# One Night Through the Forest: final report, 21 November 2026

Aarush,

## 1. What is NOT READY

1. **Smoothness is not measured; it must be read from the benchmark flight on a real machine.** The build machine has no graphics card. I never saw a frame rate and state none.
2. **It does not yet look like your references.** A blind critic judged the picture sheets three times against the brief: 65 faults (20 serious), then 56 (6 serious), then 51 (7 serious). Its verdict stayed "tech demo". What it still lists, worst first:
   - Night views away from the two lamps are dark and muddy.
   - The beach, the yard and the top of the bank steps have bare foreground.
   - The channel banks still read as built walls.
   - The giant trunk does not read as a trunk wider than a house.
   - Crowns show as separate rounded shapes; some dark inner lumps show on the skyline.
   - Water at high level is blotchy.
   - No birds, insects or fish show in still pictures (they exist and move, but are small).
   - One stray pale-blue shape near the camera in the channel view, and white slabs on the trail, which I did not track down.
3. **People.** They are realistic now, but they are ready-made avatars in city clothes (jeans, sweatshirts, shoes), and some faces do not fit one river family. This is also the weakest point for the brief's "truth and care". See `UNSOURCED.md`.
4. **Sound has never been heard by a person.** It passes a machine check only (not silent, no clipping, each event adds sound).
5. **How the boy and the canoe feel in the hand is unjudged by a person.** A bot walks and paddles every route; that proves it works, not that it feels good.
6. **The story has been played only by a bot.** All eight scenes finish, done their way and rushed. I looked at five story moments as still pictures. Nobody has watched a scene in motion or timed it; the plan was about 25 minutes.
7. **Over budget, as counted:**
   - Triangles: up to 3.56 million in one view at the top level (budget 3 million; average 2.5 million).
   - Lowest level: 633 thousand triangles (target about 500 thousand).
   - Download: the single file is 8.99 MB (5.28 MB zipped). The brief's ceiling was 8 MB; you lifted it for the Fab assets.
8. **Not done from the brief:**
   - The lamp casts no shadow (the brief allows "at most one").
   - Detail steps swap and shrink instead of fading with a dither (reason in `DECISIONS.md`).
   - Dona Socorro's year is not kept as a second orb view.
   - Hats and Davi's backpack were dropped when the people changed.
   - The converted Fab canoe, oar, driftwood, liana, vine and trunk pieces are not placed yet.
9. **The repository should be made private.** It holds shrunk Quixel Megascans files, which may not be handed out. The public link carries the same shrunk files inside the game, which their licence allows for a finished product; check this before you publish widely.
10. **It must not be shown to children or published as finished** until a reader from the reserve's own communities has seen it. The title screen says so.

## 2. What exists

- **Roam:** the open river and beach, the low-water channel, the community (house on legs, bank steps, landing, marked tree, aerial), the floating house on its raft, the trail, the dry channel bed, the giant trunk, the lake. Water level and hour sliders, place buttons, the family at their work, the orb's map (M) that grows as you visit places.
- **Story:** all eight scenes, with the hold, the film prompt, captions for every line, Tomé's way of seeing (the water rising inside a marked frame), Dona Socorro's telling, and the closing map.
- **Shell:** title screen with both ways in and scene select, loading screen that names its stages, objective line, key prompts, pause menu (Esc) with controls, sound and picture quality.
- **Three quality levels** chosen at start, a live controller (resolution first, then distance), a 60 frames a second cap on fast screens, WebGPU with an automatic step down to WebGL 2.
- **Your Fab downloads:** 11 surfaces on ground, banks, trunks, planks and thatch; ferns, palms, banana and elephant-ear leaves, water lilies and fallen trees in the forest.

## 3. The four moments, each with its picture

| Moment | Picture | Honest note |
|---|---|---|
| The water rising through the trees | `shots/moments/1a-water-low.jpg`, `1b-water-half.jpg`, `1c-water-high.jpg` | Works in Roam with the slider, and in scene 4 at the giant trunk. |
| The giant fish | `shots/moments/2-giant-fish.jpg` (the back), `2b-giant-fish-ring.jpg` (the ring) | A dark back breaks the surface by the canoe under the bank at first light, then a ring spreads. In Roam it happens by itself at the lake around first light. |
| Night into sunrise | `shots/moments/3a-night-lamp.jpg`, `3b-grey-before-dawn.jpg`, `3c-sunrise.jpg` | The lamp and the sunrise read; night away from a lamp is too dark. |
| The living forest | `shots/moments/4-living-forest.jpg` | Leaves, light pools, haze, drifting leaves and fireflies are there; birds and insects are too small to read in a still. |

All fixed-camera sheets (12 views, 4 states each): `shots/step9/`.

## 4. What was never measured or judged

- Frame rate and frame times on any real graphics card.
- Whether the quality controller's changes flicker.
- Whether anything hitches on first sight (every material is compiled before play, but this was only run on a software renderer).
- How it sounds. How the controls feel. How long the story takes.
- Safari and Firefox. Only Chromium was run.

## 5. The counted numbers (by script, software renderer, not a speed test)

| What | Count |
|---|---|
| Draw calls, top level, all passes, worst view | 70 (budget 150) |
| Draw calls, top level, average over 48 pictures | 65 |
| Triangles, top level, worst view | 3.56 million (budget 3 million) |
| Triangles, top level, average | 2.52 million |
| Lowest level (WebGL 2), single file from disk | 52 draws, 633 thousand triangles |
| Trees in the world, top level | about 10,900 |
| People | 10 figures in one mesh: one draw, plus one in the shadow pass |
| Single file | 8,986 KB (5,279 KB zipped) |
| Same seed, same world | yes; another seed gives another world |
| `Math.random` in the game's code | none |
| Bot routes | 7 of 7 reached, no falling through, no getting stuck |
| Bot story | 16 of 16 runs finished (8 scenes, their way and rushed; the rushed way is pushed back at least once in scenes 2 to 8) |
| Single file opened from disk, no flags | starts, 0 outside requests, 0 errors |

Per-picture numbers: `shots/step9/numbers.txt`.

## 6. How to open it

**The single file.** `dist/one-night.html` is made by `npm run build`. It is not stored in the repository. On a machine with Node: `npm ci`, then `npm run build`, then double-click `dist/one-night.html`.

**The link.** It goes live only after the branch is merged and Pages is switched on. Paste these two commands:

```bash
gh pr create --repo aarushsoffside05/one-night --base main --head claude/quirky-cerf-yaaor6 --title "One Night Through the Forest" --body "First build" && gh pr merge --repo aarushsoffside05/one-night claude/quirky-cerf-yaaor6 --merge
```

```bash
gh api -X POST repos/aarushsoffside05/one-night/pages -f build_type=workflow
```

A free link needs a public repository, which means anyone with the link can open it. That clashes with point 9 above (the Megascans files). The clean way is a paid GitHub plan with a private repository, or hosting the built `dist/` folder somewhere else. That is your call; I did not work around it.

## 7. How to run the benchmark flight, and what to send back

1. Open the game on your MacBook in Chrome with `?dev=1` at the end of the address.
2. Wait for the title screen. Press **B**. Do not touch anything for 60 seconds. It flies one fixed route at low, half and high water.
3. Press **Copy** in the panel and send me the text. It holds: average frame time, the worst 1 percent, the worst frame, draw calls, triangles, resolution scale and which backend ran.
4. Do it once more with `?dev=1&post=0` (screen passes off), so we can see what they cost.

## 8. Files

- Game: `src/` (`world/` the place, `game/` movement, story and scenes, `ui/` the shell, `audio/` the sound, `assets/` models and textures).
- Tools: `scripts/` (pictures, checks, converters), `tools/blender/`, `tools/people/`, `tools/megascans/`.
- Records: `DECISIONS.md`, `UNSOURCED.md`, `PROGRESS.md`, `README.md`, `2026-11-21-fab-wishlist.md`, this report.
- Pictures: `shots/step0` to `shots/step9`, `shots/moments/`.
- Link workflow: `.github/workflows/pages.yml`.
