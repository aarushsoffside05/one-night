# Realistic people from the Microsoft Rocketbox avatar library

Ten rigged, textured, realistic people for the game, converted from
<https://github.com/microsoft/Microsoft-Rocketbox> (commit `0943055db6ec570bcef9f2c8b41c9e5467c808f9`).

**Licence:** MIT, Copyright (c) 2020 Microsoft. The full text is `LICENSE.md` at the root of the
source repository (the README's "November 2020 License Update" confirms it). The MIT notice must
travel with the game; `rocketbox.json` carries `"licence": "MIT, Microsoft Rocketbox"`.
The repository does not use Git LFS; files were read with `git show HEAD:<path>` from a blobless clone.
No raw source file is stored in the game repo.

## Outputs

| file | what |
|---|---|
| `src/assets/models/r_<id>.bin` | one mesh per character (format below) |
| `src/assets/models/rocketbox.json` | counts, joints, atlas rectangle, notes per character |
| `src/assets/tex/people_atlas.webp` | one shared 2048 x 2048 opaque diffuse atlas (WebP q82, about 310 KB) |
| `tools/people/make_rocketbox.py` | the converter |

## Sources chosen

| id | avatar folder (`Assets/Avatars/...`) | why / what does not fit | source tris | tris | verts | bytes |
|---|---|---|---|---|---|---|
| davi | `Children/Male_Child_01` | visitor boy; sweatshirt and jeans rather than T-shirt and shorts | 6660 | 5800 | 3414 | 92838 |
| tome | `Professions/Wood_Male_01` | brown-skinned man with cap, pale work shirt, jeans, boots: the fisher | 7108 | 5800 | 3480 | 93960 |
| caio | `Adults/Male_Adult_09` | young man, long tied-back black hair, dark T-shirt; jeans rather than shorts; skin tinted slightly | 7426 | 5800 | 3404 | 92668 |
| lia | `Children/Female_Child_01` | the only girl without a headscarf; blonde in the source, so hair darkened and skin tanned in the atlas; long sleeves under the T-shirt, jeans | 7102 | 5800 | 3448 | 93416 |
| nino | `Children/Male_Child_02` | T-shirt, cargo shorts, sandals; same child size as the others, the game must scale him down | 7310 | 5800 | 3542 | 95014 |
| socorro | `Adults/Female_Adult_02` | no elderly woman exists; oldest-looking casual woman in jumper and denim skirt, hair greyed and skin tanned in the atlas | 8940 | 5800 | 3628 | 96476 |
| marta | `Adults/Female_Adult_03` | black-haired woman, sleeveless purple top, black trousers, flats; skin tinted slightly | 9208 | 5800 | 3749 | 98533 |
| rafa | `Adults/Male_Adult_01` | young man in striped polo, shorts, trainers | 7440 | 5800 | 3605 | 96085 |
| mae | `Adults/Female_Adult_05` | woman with black bob, pink jacket, jeans (city visitor) | 8288 | 5799 | 3774 | 98952 |
| pai | `Adults/Male_Adult_14` | balding man, grey shirt, khaki trousers (city visitor) | 6842 | 5800 | 3426 | 93042 |

Total: 950,984 bytes of meshes + 309,698 bytes of atlas.

The library has 4 children (two boys, two girls, all about 1.43 m), no teenagers and no elderly
people, and very few brown-skinned casual adults. Everything else in the adult set is in jackets,
jumpers, uniforms or religious dress. Nobody is barefoot; nobody wears a dress.

## Level of detail

The FBX files under `Assets/` contain only the `hipoly` mesh (6,660 to 9,208 triangles). The lower
LODs named in the upstream README exist only inside the 3ds Max `.max` sources, which cannot be
opened here. So every mesh is decimated in Blender (Decimate / Collapse, which interpolates UVs and
vertex groups) to at most 5,800 triangles. The head material's vertices are protected by a vertex
group (the converter tries the group both ways and keeps the variant that leaves more head
triangles), so the body gives up more triangles than the face.

## T-pose

The source rest pose is an A-pose (arms about 45 degrees down, legs slightly apart). The converter does not use
Blender's pose system: it reads rest joints and all 80 skin weights and does linear-blend skinning
itself:

* upper arm, forearm and hand are each rotated by the smallest rotation that points them along
  +X (left) / -X (right);
* the hand is then rolled about the arm axis until the back of the hand faces +Y (about 6.7 degrees;
  one third of that roll is applied at the forearm);
* thigh and calf are each aimed straight down; the foot keeps its original orientation so the soles
  stay flat;
* joints are transformed with the same transforms, so they match the vertices.

Then: soles at y = 0, bounding box centred in X and Z, uniform scale so the figure is exactly
1.70 m (hair/cap included). `srcHeight` in the JSON is the original height in metres (children
1.43, women 1.74, men 1.80 to 1.83) if the game wants true proportions back.

Axes: metres, +Y up, facing +Z, the character's left = +X.

## Binary format (little endian)

Per vertex 17 bytes: `int16 x,y,z` (position / posScale * 32767), `int8 nx,ny,nz` (normal * 127),
`uint8 0`, `uint8 segA`, `uint8 segB`, `uint8 weightA` (weightB = 255 - weightA),
`uint16 u, v` (atlas uv * 65535, v measured from the top: use `flipY = false`).
Then `uint16` indices, 3 per triangle. Counts are in `rocketbox.json`.

Segments: 0 hips (pelvis), 1 torso (spine, spine1, spine2, neck, clavicles), 2 head (head + all
face/jaw/eye bones), 3 left upper arm, 4 left forearm + hand + fingers, 5 right upper arm, 6 right
forearm + hand + fingers, 7 left thigh, 8 left calf + foot + toe, 9 right thigh, 10 right calf +
foot + toe. The Rocketbox rig (3ds Max Biped) has no twist bones. Each vertex's bone weights are
summed per segment, the best two kept and normalised.

Normals are smooth normals recomputed from the T-posed geometry. Vertices are split only at UV seams.
Triangles are wound counter-clockwise seen from outside (front-face culling is fine; checked by
rendering with back-face culling).

## Atlas

2048 x 2048, 5 columns x 2 rows, one cell (about 410 x 1024) per character in the order of the
table; `atlasRect` = `[u0, v0, u1, v1]` of the cell, v from the top. Inside a cell the body map is
on top, the head map below it and, for rafa, mae and marta, a strip with the hair-card map at the
bottom. Source maps are 2048 x 2048 each, so this is a strong reduction (about 5x): faces are fine at
gameplay distance, soft in close-up. Only the colour maps are used (normal and specular maps dropped).

* Texels outside the UV islands are filled with neighbouring colour (mask-weighted downscale plus
  push-pull fill) so no black seams appear when mip-mapped; 2 texels of edge padding per map.
* Eyes, teeth and tongue are part of the head map and mesh and are kept.
* Hair cards (the separate alpha-blended `*_opacity` material: wisps, fringes, lashes): cards whose
  area-weighted mean alpha is below 0.62 are dropped; the rest are kept as opaque geometry with the
  alpha flattened onto the card map's own average hair colour. Dropped/kept triangles are listed
  as `hairCards` in the JSON (caio 274/0, socorro 292/0, marta 912/24, rafa 202/292, mae 370/550).
  The scalp underneath always has painted hair, so nobody goes bald, but hair silhouettes are
  simpler and a little blockier than in the source.
* Tints (`CHARS` options in the converter), applied to texels chosen by colour:
  `skin` multiplies skin-coloured texels (caio, lia, socorro, marta) for a sun-tanned river family;
  `hair: dark` turns lia's blonde hair dark brown; `hair: grey` greys socorro's hair.
  The eye/mouth corner of the head map is excluded. Eye colour is not changed (lia and socorro
  keep light eyes).

## Regenerate

```
BPY=/path/to/python-with-bpy          # e.g. a venv with `pip install bpy`
$BPY -I tools/people/make_rocketbox.py /home/user/microsoft/microsoft-rocketbox src/assets [cache dir]
```

Takes about 45 s. The source may be a full checkout or a blobless `--no-checkout` clone
(`GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --filter=blob:none --no-checkout ...`); the roughly
300 MB of FBX/TGA files needed are extracted into the cache dir (default `<tmp>/rocketbox_cache`),
never into the game repo. The WebP is written by Blender's own image writer (quality 82, RGB);
`RB_WEBP_QUALITY=90` changes that, and a lossless `people_atlas.png` is left in the cache dir for
any other encoder. `RB_ONLY=lia,socorro` converts just those (no JSON/atlas written).
To swap an avatar, edit the `CHARS` table at the top of the script.

## Known shortcomings

* Clothes are European casual wear, not river-family clothes: long sleeves, jeans, closed shoes;
  only nino has shorts and sandals, only socorro a skirt. tome, caio, lia, davi, pai, marta, mae all
  wear long trousers.
* Ages: lia and nino come from the same child size as davi; socorro is a greyed 50-year-old, not
  a grandmother's face; caio reads mid-twenties.
* Ethnicity: tome (South Asian-looking source), caio and marta (East Asian-looking sources) pass as
  ribeirinho/caboclo reasonably well; nino is a very dark-skinned African-looking boy and does not
  obviously look like their son/brother; lia and socorro are European faces with tinted skin.
* lia's recoloured hair has a few lighter strands left at the temple and the tint is uniform.
* Shoulders are raised from an A-pose by plain linear skinning, so the armpit/deltoid area is a
  little pinched compared with a sculpted T-pose.
