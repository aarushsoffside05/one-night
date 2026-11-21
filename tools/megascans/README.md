# Megascans plants and props → `scans.glb`

Quixel Megascans packs downloaded from Fab, shrunk to small game-ready files by `scripts/make-plants.py`.
The raw packs are **not** in the repository (they stay in a scratch folder, one sub-folder per unzipped pack).

```
<python with bpy + numpy> -I scripts/make-plants.py <folder with the extracted packs> [--sheet out.jpg]
```

Needs Blender as a Python module (`bpy`: reads the images and the two FBX packs, runs the decimate modifier),
`numpy`, and `node` with the project's Playwright/Chromium (`scripts/_pw.mjs`), which encodes the WebP files.
Nothing inside a pack is executed. The run takes about 40 s and rewrites everything below; it ends by re-reading
`scans.glb` and asserting sizes, axes, UV ranges, budgets, and writes a contact sheet (`scans-sheet.jpg`, next to
the packs folder unless `--sheet` says otherwise).

## Output

| file | size |
|---|---|
| `src/assets/models/scans.glb` | 843 KB (863 712 bytes), 57 meshes, 23 254 triangles |
| `src/assets/models/scans.json` | manifest: `info`, `textures[]`, `findings[]`, `skipped[]`, `meshes[]` |
| `src/assets/tex/scan_<asset>.webp` × 19 | 2 092 KB together (2 142 212 bytes) |

How to use it in three.js:

- Every mesh is its own named node with identity transform: `POSITION`, `NORMAL`, `TEXCOORD_0` (float32), uint16 indices. No materials.
- Metres, +Y up. Ground plants: root at the origin. Water lilies: `y = 0` is the water surface. Hanging things: top attachment at the origin, hanging toward −Y. Solids: resting on `y = 0`, centred in X/Z, long things lie along X.
- UVs are glTF convention (v = 0 is the top row): load each `.webp` with `texture.flipY = false`.
- `alpha: true` → alpha-test at 0.5, double-sided. The colour is bled under the transparent texels and their alpha is 1/255, never 0 (a canvas would wipe the colour of alpha-0 pixels), so mipmaps have no dark fringe.
- `tiles: true` (vine A, root) → UVs leave 0..1, use `RepeatWrapping`.
- Leaf-card normals are pulled toward up/outward (55 % bias) so clumps shade softly; solids have plain smooth normals welded across UV seams.

## What the packs turned out to be (axis / scale)

| pack | Megascans id | what it is | axis / scale found |
|---|---|---|---|
| `tropical_palm_rkqjj_ue_low` | rkqjj | 3D plant, 3 variants × LOD0-1 + billboard | raw data cm with **−Z up**; each node has rotation +90° about X and scale 0.01 → +Y up, metres |
| `chinese_fan_palm_ud4geejja_ue_low` | ud4geejja | 3D plant, 7 variants × LOD0-2 + billboard | same |
| `common_fern_rhdso_ue_low` | rhDso | 3D plant, 3 variants × LOD0-2 + billboard | same. No `_B-O.png`: opacity is the **R channel of `_ORT.jpg`** |
| `leather_fern_tkytbjdia_ue_low` | tkytbjdia | 3D plant, 5 variants × LOD0-2 + billboard | same |
| `canna_lily_ud0mcinia_ue_low` | ud0mcinia | 3D plant, 7 variants × LOD0-2 + billboard | same |
| `carolana_water_lily_uc2jdibia_ue_low` | uc2jdibia | 3D plant, 7 variants × LOD0-2 + flat card | same; pads at y = 0, stems reach 0.67 m **below** |
| `huge_banana_leaf_slpmfhp_4k_ue_high` | slpmfhp | **atlas only** (one leaf, 4096×1024 px = 2×0.5 m); the glTF is a 2-triangle placeholder plane | — |
| `elephant_ear_qfxkv2_1k` | qfxkv2 | **atlas only** (two blades + five stalks, 0.86 m scan, separate Opacity map) | — |
| `hanging_vine_tfwoxsh_1k_ue_low` | tfwoxsh | **atlas only** (tileable 2×2 m ivy decal); placeholder plane | — |
| `buttress_root_wdbncfq_1k_ue_low` | wdbncfq | **tileable bark surface only** (2×2 m); placeholder plane | — |
| `ficus_microcarpa_tree_trunk_wdjqbag_gltf_low` | wdjqbag | solid scan, one LOD, 4018 triangles | raw data cm, already +Y up; two wrapper node matrices cancel to ×0.01 |
| `mossy_log_tjrtcibda_gltf_low` | tjrtcibda | solid scan, one LOD, 1090 triangles | same; lies along X already |
| `long_liana_stem_wdoicd0_low` | wdoicd0 | FBX only, one LOD, 1458 triangles | cm under a 0.01 / +90° X root; Blender gives Z-up metres → converted to +Y up |
| `fallen_tree_rgzon_low` (arrived later) | rgzoN | FBX only, one LOD, 1631 triangles | same as liana |
| `coast_african_debris_driftwood_s_01_xlnndfv_gltf_mid` (later) | xlnndfv | solid scan, 4370 triangles | same as trunk |
| `historic_medieval_harbour_oar_wood_old_01_xivobjn_gltf_mid` (later) | xivobjn | solid scan, 3870 triangles | same as trunk |
| `residential_europeanrural_canoe_wood_worn_vejjfcqaw_gltf_mid` (later) | vejjfcqaw | solid scan, 2782 triangles | same as trunk |
| `jungle_debris_slci2uh_2k_ue_mid` (later) | slci2uh | **atlas only** (tileable 2×2 m litter decal); placeholder plane | — |
| `dry_leaf_scatter_pbdiw2_2k` (later) | pbDiW2 | **atlas only** (1×1 m, about 50 leaves) | — |

Megascans plant pivots are the root of the plant, so they are kept as they are (not re-centred on the bounding box).
A few fronds dip below the root: lowest vertex is −0.11 m (`fern_C`), otherwise −0.05 m or less.

## Rules used

- Plants: up to 3 variants. `near` = the source LOD with the most triangles at or below 700; `far` = the source LOD
  with the most triangles at or below 120. Billboard LODs (material `*_Billboard`) are never exported.
  **Deviation:** `far` accepts up to 132 triangles (+10 %), because the lowest real LODs of the ferns sit at 124-130;
  without that only two plants would have a far mesh.
- Water lily: triangles entirely below −4 cm (the submerged stems) are cut before counting, vertices clamped to −4 cm.
- Solids: at most 1500 triangles (`near`) and 300 (`far`), by Blender's decimate modifier (collapse, UVs kept) when the single source LOD is larger.
- Atlas-only packs have no geometry, so the script builds it: bent leaf cards (banana, elephant ear), hanging ribbons and a curtain (vine), flat ground quads (debris, leaf litter). These are **not scans**, only their texture is.
- `root_*` is a **procedural** buttress flare (5 fins, 3 m, trunk axis at the origin, open top), textured with the tileable buttress bark scan.
- Textures: area-averaged down, alpha-weighted, 16 dilation passes of colour into transparent texels (beyond that the scan's own padding), WebP quality 0.8 through a float16 canvas in headless Chromium.

## Meshes

Size is X × Y × Z in metres.

| mesh | triangles | vertices | size | y min … max | kind | source |
|---|---|---|---|---|---|---|
| `palm_A_near` | 530 | 400 | 3.31 × 1.63 × 3.61 | −0.03 … 1.60 | palm-crown | VarA LOD1 |
| `palm_B_near` | 530 | 400 | 2.58 × 1.14 × 2.41 | −0.02 … 1.12 | palm-crown | VarB LOD1 |
| `palm_C_near` | 424 | 320 | 3.43 × 1.47 × 3.37 | −0.02 … 1.45 | palm-crown | VarC LOD1 |
| `fanpalm_A_near` | 321 | 395 | 2.63 × 1.52 × 2.43 | −0.01 … 1.51 | ground-plant | VarB LOD2 |
| `fanpalm_B_near` | 667 | 771 | 2.60 × 1.02 × 2.50 | −0.01 … 1.01 | ground-plant | VarC LOD1 |
| `fanpalm_C_near` | 409 | 491 | 1.44 × 1.12 × 1.48 | −0.01 … 1.11 | ground-plant | VarG LOD1 |
| `fern_A_near` | 360 | 327 | 1.35 × 0.67 × 1.42 | −0.05 … 0.62 | ground-plant | VarA LOD0 |
| `fern_A_far` | 128 | 166 | 1.36 × 0.67 × 1.42 | −0.05 … 0.62 | ground-plant | VarA LOD2 |
| `fern_B_near` | 516 | 459 | 1.73 × 0.69 × 1.49 | −0.04 … 0.64 | ground-plant | VarB LOD0 |
| `fern_C_near` | 384 | 342 | 1.65 × 0.75 × 1.70 | −0.11 … 0.64 | ground-plant | VarC LOD0 |
| `fern_C_far` | 130 | 166 | 1.69 × 0.73 × 1.74 | −0.10 … 0.64 | ground-plant | VarC LOD2 |
| `leatherfern_A_near` | 442 | 419 | 1.47 × 0.50 × 1.29 | −0.01 … 0.49 | ground-plant | VarA LOD0 |
| `leatherfern_B_near` | 370 | 353 | 1.08 × 0.34 × 1.22 | −0.01 … 0.33 | ground-plant | VarC LOD0 |
| `leatherfern_B_far` | 125 | 173 | 1.07 × 0.33 × 1.25 | −0.01 … 0.32 | ground-plant | VarC LOD2 |
| `leatherfern_C_near` | 300 | 325 | 0.79 × 0.17 × 0.79 | 0.00 … 0.17 | ground-plant | VarD LOD0 |
| `leatherfern_C_far` | 110 | 168 | 0.79 × 0.16 × 0.80 | 0.00 … 0.16 | ground-plant | VarD LOD2 |
| `canna_A_near` | 624 | 656 | 1.25 × 2.39 × 1.02 | −0.01 … 2.38 | ground-plant | VarA LOD2 |
| `canna_B_near` | 592 | 495 | 1.09 × 1.72 × 1.07 | −0.02 … 1.70 | ground-plant | VarD LOD1 |
| `canna_C_near` | 327 | 401 | 1.66 × 1.74 × 1.02 | −0.04 … 1.70 | ground-plant | VarE LOD2 |
| `waterlily_A_near` | 263 | 227 | 0.89 × 0.06 × 0.97 | −0.04 … 0.02 | water-plant | VarA LOD0, stems cut |
| `waterlily_A_far` | 90 | 117 | 0.90 × 0.06 × 0.99 | −0.04 … 0.02 | water-plant | VarA LOD2, stems cut |
| `waterlily_B_near` | 516 | 385 | 1.33 × 0.19 × 1.43 | −0.04 … 0.15 | water-plant | VarC LOD0, stems cut |
| `waterlily_C_near` | 496 | 809 | 1.30 × 0.15 × 1.06 | −0.04 … 0.11 | water-plant | VarG LOD1, stems cut (flowers) |
| `banana_A_near` | 224 | 189 | 3.09 × 2.34 × 3.08 | 0.00 … 2.34 | ground-plant | built: 7 leaves, 2.6 m |
| `banana_A_far` | 42 | 56 | 3.09 × 2.35 × 3.09 | 0.01 … 2.36 | ground-plant | built |
| `banana_B_near` | 128 | 108 | 1.31 × 1.47 × 1.85 | 0.00 … 1.47 | ground-plant | built: 4 leaves, 1.7 m |
| `banana_B_far` | 24 | 32 | 1.28 × 1.46 × 1.85 | 0.01 … 1.47 | ground-plant | built |
| `banana_C_near` | 32 | 27 | 1.71 × 1.92 × 1.01 | 0.00 … 1.92 | ground-plant | built: one leaf heading +X |
| `banana_C_far` | 6 | 8 | 1.71 × 1.94 × 1.01 | 0.01 … 1.95 | ground-plant | built |
| `elephantear_A_near` | 168 | 196 | 2.26 × 1.52 × 2.00 | −0.01 … 1.51 | ground-plant | built: 7 leaves on stalks |
| `elephantear_A_far` | 28 | 56 | 2.27 × 1.47 × 2.01 | 0.00 … 1.47 | ground-plant | built |
| `elephantear_B_near` | 96 | 112 | 1.79 × 1.02 × 1.44 | −0.01 … 1.01 | ground-plant | built: 4 leaves |
| `elephantear_B_far` | 16 | 32 | 1.80 × 0.98 × 1.45 | 0.00 … 0.98 | ground-plant | built |
| `vine_A_near` | 96 | 81 | 0.59 × 3.60 × 0.59 | −3.60 … 0.00 | hanging | built: 3 crossed ribbons, **tiles** (V 0..1.8) |
| `vine_A_far` | 12 | 16 | 0.59 × 3.60 × 0.59 | −3.60 … 0.00 | hanging | built, **tiles** |
| `vine_B_near` | 60 | 42 | 2.00 × 2.00 × 0.45 | −2.00 … 0.00 | hanging | built: wavy curtain, top edge along X |
| `vine_B_far` | 8 | 9 | 2.00 × 2.00 × 0.38 | −2.00 … 0.00 | hanging | built |
| `vine_C_near` | 40 | 36 | 0.49 × 1.60 × 0.49 | −1.60 … 0.00 | hanging | built: short tuft |
| `vine_C_far` | 8 | 12 | 0.49 × 1.60 × 0.49 | −1.60 … 0.00 | hanging | built |
| `root_A_near` | 1080 | 610 | 2.64 × 3.00 × 2.61 | 0.00 … 3.00 | solid | **procedural**, **tiles** (U 0..3, V 0..1.5) |
| `root_A_far` | 240 | 155 | 2.64 × 3.00 × 2.59 | 0.00 … 3.00 | solid | **procedural**, **tiles** |
| `trunk_A_near` | 1500 | 1532 | 1.26 × 1.88 × 0.98 | 0.00 … 1.88 | solid | 4018 → decimated |
| `trunk_A_far` | **442** | 662 | 1.24 × 1.88 × 0.91 | 0.00 … 1.88 | solid | 4018 → decimated, **over the 300 budget** |
| `log_A_near` | 1090 | 917 | 0.46 × 0.13 × 0.14 | 0.00 … 0.13 | solid | source as is |
| `log_A_far` | 300 | 368 | 0.46 × 0.13 × 0.14 | 0.00 … 0.13 | solid | decimated |
| `driftwood_A_near` | 1500 | 1012 | 0.82 × 0.13 × 0.15 | 0.00 … 0.13 | solid | 4370 → decimated |
| `driftwood_A_far` | 300 | 261 | 0.82 × 0.13 × 0.15 | 0.00 … 0.13 | solid | decimated |
| `oar_A_near` | 1500 | 1042 | 2.38 × 0.08 × 0.10 | 0.00 … 0.08 | solid | 3870 → decimated |
| `oar_A_far` | 300 | 281 | 2.37 × 0.07 × 0.10 | 0.00 … 0.07 | solid | decimated |
| `canoe_A_near` | 1500 | 1014 | 4.49 × 0.38 × 0.77 | 0.00 … 0.38 | solid | 2782 → decimated |
| `canoe_A_far` | 300 | 287 | 4.48 × 0.38 × 0.77 | 0.00 … 0.38 | solid | decimated |
| `liana_A_near` | 1458 | 1162 | 0.22 × 2.32 × 0.31 | −2.32 … 0.00 | hanging | source as is |
| `liana_A_far` | 299 | 369 | 0.21 × 2.32 × 0.32 | −2.32 … 0.00 | hanging | decimated |
| `fallentree_A_near` | 1500 | 1327 | 1.77 × 0.47 × 0.89 | 0.00 … 0.47 | solid | 1631 → decimated |
| `fallentree_A_far` | 299 | 398 | 1.76 × 0.39 × 0.89 | 0.00 … 0.39 | solid | decimated |
| `debris_A_near` | 2 | 4 | 2.00 × 0 × 2.00 | 0.02 | ground-plant | built: flat decal quad |
| `leaflitter_A_near` | 2 | 4 | 1.00 × 0 × 1.00 | 0.02 | ground-plant | built: flat decal quad |

## Textures

| file | pixels | channels | size | source map |
|---|---|---|---|---|
| `scan_palm.webp` | 768×768 | RGBA | 261 KB | `T_rkqjj_1K_B-O.png` |
| `scan_fanpalm.webp` | 768×768 | RGBA | 322 KB | `T_ud4geejja_1K_B-O.png` |
| `scan_fern.webp` | 768×768 | RGBA | 204 KB | `T_rhDso_1K_B.jpg` + R of `T_rhDso_1K_ORT.jpg` |
| `scan_leatherfern.webp` | 512×512 | RGBA | 135 KB | `T_tkytbjdia_1K_B-O.png` |
| `scan_canna.webp` | 768×768 | RGBA | 314 KB | `T_ud0mcinia_1K_B-O.png` |
| `scan_waterlily.webp` | 512×512 | RGBA | 127 KB | `T_uc2jdibia_1K_B-O.png` |
| `scan_banana.webp` | 1024×512 | RGBA | 56 KB | `T_slpmfhp_4K_B-O.png`, cropped to the leaf |
| `scan_elephantear.webp` | 512×512 | RGBA | 21 KB | `BaseColor.jpg` + `Opacity.jpg` |
| `scan_vine.webp` | 640×640 | RGBA | 176 KB | `T_tfwoxsh_1K_B-O.png` (tileable) |
| `scan_root.webp` | 512×512 | RGB | 75 KB | `T_wdbncfq_1K_B.jpg` (tileable) |
| `scan_trunk.webp` | 768×768 | RGB | 74 KB | albedo |
| `scan_log.webp` | 512×512 | RGB | 46 KB | albedo |
| `scan_driftwood.webp` | 512×512 | RGB | 28 KB | albedo (2K source) |
| `scan_oar.webp` | 512×512 | RGB | 23 KB | albedo (2K source) |
| `scan_canoe.webp` | 768×768 | RGB | 57 KB | albedo (2K source) |
| `scan_liana.webp` | 512×512 | RGB | 38 KB | `BaseColor.jpg` |
| `scan_fallentree.webp` | 512×512 | RGB | 65 KB | `BaseColor.jpg` |
| `scan_debris.webp` | 512×512 | RGBA | 41 KB | `T_slci2uh_2K_B-O.png` |
| `scan_leaflitter.webp` | 512×512 | RGBA | 32 KB | `BaseColor.jpg` + `Opacity.jpg` |

## Skipped, dropped, and why

- **No `far` mesh** for palm, fan palm, canna, `fern_B`, `leatherfern_A`, `waterlily_B/C`: their lowest non-billboard LOD is far above 120 triangles (palm 424-530, fan palm 192-396, canna 250+).
- **Variants dropped**: fan palm A, D, E, F (kept B tall, C wide, G small); leather fern B, E (E is a dead brown 10 cm tuft); canna B (no LOD at or below 700), C, F and G (F, G are wilted brown); water lily B (brown pads), D, E, F (wider than 1.5 m or over budget).
- **Texture sizes lowered to fit 2.2 MB** (all at the first try were 3.2 MB): palm, fan palm, canna, fern 1024 → 768; leather fern, water lily 1024 → 512; vine 1024 → 640; trunk 1024 → 768; fallen tree, debris 1024 → 512.
- `chinese_fan_palm_ud4geejja_low` (the non-UE zip) and `elephant_ear_qfxkv2_4k`: not used, as asked.
- Normal, roughness, translucency, displacement maps and the billboard atlases: not converted.
- Vertex colours and the wind attribute of the plants: not exported.
- Surface-only packs (mud, sand, bark, planks, thatch, jungle floor…): handled by `scripts/make-textures.mjs`.

## Things to know

- `trunk_A_far` has 442 triangles, not 300: the ficus scan is full of holes between its roots and edge-collapse cannot go lower.
- The mossy log is small at true scale (0.46 m), the driftwood 0.82 m. Scale them up in the game for big logs.
- The liana piece is 2.32 m, not "several metres": stack or stretch it.
- The tropical palm is a stemless understory palm 1.1-1.6 m tall; its kind is `palm-crown` because the fronds radiate from the origin and also work on top of a trunk.
- Water lily B is 1.43 m across and stands 0.15 m above the water (raised pads); C has flowers and some brown pads.
- `debris` and `leaflitter` use kind `ground-plant` (the manifest has no decal kind); they are flat quads facing up.
