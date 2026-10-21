# 3D model review (2026-10-21)

The first models of the rider and boards: Tavi (player), Mara, and the boards Skipper and
Kestrel, made with Hunyuan3D-2mv from the design sheets. Checked by measuring the files and by
putting each into the game (`test/model-shots.mjs`), cel shaded and outlined, in golden-hour
light. Pictures: `docs/progress/sky-tide-model-review.png`. The models themselves are not in the
repo (15 to 18 MB each).

## What is good

- **Shape and design**: silhouettes, proportions and colour blocking follow the sheets closely.
- **Clean shells**: Tavi is one watertight mesh; the others have only a handful of loose bits
  and bad edges. The contour line (an inflated back-face shell) works on all of them as they are.
- **Scale and orientation**: Y up; boards nose toward -Z, as the game's. Normalised to 2 units:
  characters scale by 0.90 to 1.8 m, boards by 0.98 to 1.96 m.

## Since

- **Boards**: rebuilt from the concept sheets in Blender (commit 42989bc; `art/models/BOARDS.md`):
  1.62 and 1.86 m, about 10k triangles, flat cel palettes, undersides as designed, foot holds,
  fins and glow surfaces as their own parts. Items 4 to 7 below are done for them.
- **Characters**: the original models stay as the baseline (a rebuilt, rigged pass looked worse).
  `tools/models/characters_prepare.py` sizes them to their sheets (Tavi 1.72 m, Mara 1.82 m),
  trims them to about 3.4 MB and gives the face and hair shaped normals for the cel shader:
  item 1 (`art/models/CHARACTERS.md`). Rigging (items 3 and 4) is next.

## What needs work

| | Problem | Why it matters here | Fix |
|---|---|---|---|
| 1 | **Faces and hair**: cel shading breaks into blotches | A hard shadow edge follows the normals; a sculpted face gives realistic, broken shadow shapes, not the one clean shape of a 2005 TV anime face | Separate face and hair; face normals transferred from a smooth shape (sphere or ellipsoid); tidy hair normals; eyes and mouth as their own texture or decal (expressions) |
| 2 | **Texture**: about a thousand UV fragments, lighting baked in, 4K | Cannot be repainted or split into flat paint zones; baked shading doubles the cel shadow; seams bleed at small sizes | New UVs in few islands along the design's panels; repaint as flat colours, one per region (plus painted seam and line details), no lighting; 1K to 2K |
| 3 | **Topology**: an even triangle soup (100k), no edge loops | The rider has to be posed (stance, carve, crouch, air, walk); joints need loops to bend cleanly | Retopology: quads, loops at shoulders, elbows, wrists, hips, knees, ankles; about 20k to 30k triangles for a character |
| 4 | **No rig** | The game poses the rider by hand from primitives; a model needs a skeleton | Humanoid skeleton (Mixamo or Rigify naming), skinned; the game then drives it with poses or clips |
| 5 | **Board undersides**: textured from the top view only | The undersides read as grey and brown; the designed navy frame, cyan panels and thruster ring are lost (seen whenever you fly over or tumble) | Repaint the undersides from the sheets |
| 6 | **Board fit**: Skipper is 0.75 m wide and 0.37 m deep, its deck 0.2 m above its fins; bindings at -0.33 and +0.45 m (Kestrel -0.46 and +0.22) | The game's board is 0.54 m wide and 5 cm thick, its feet at -0.33 and +0.33 m | Decide each board's in-game size; the game reads foot positions and deck height per board |
| 7 | **Files**: 14 to 18 MB each, a 4K metallic-roughness map (unused by cel shading), metal set to 1 | Heavy for a web game | glTF with meshopt or Draco, one 1K to 2K colour texture (WebP or KTX2), no metal or roughness maps: about 1 to 3 MB each |
| 8 | **Small parts melted together**: fingers, buckles, pocket flaps, straps | Fine at play distance; mitten hands limit hand poses | Keep simple shapes (as the era drew them); separate the fingers only if close-ups need them |
