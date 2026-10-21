# Island sheets

The floating islands' painted surfaces and their far-off silhouettes. The game draws the
islands as cel-shaded backgrounds (`render/islandsView.js`, `render/cel.js`) lined by the ink
pass; these textures go under the cel shading, so they are painted **evenly lit**, with no
shadows of their own.

| Sheet | What | How the game uses it |
|---|---|---|
| 1 Ground | Six tiling squares, 512 px, 3x2: meadow grass, short turf, wildflower meadow, sandy path, bare earth, moss on stone | The islands' top surfaces |
| 2 Rock | Six tiling squares, 512 px, 3x2: the islands' undersides and cliffs (layered rock, weathered rock, roots through rock, crystal-veined rock, crumbling edge, dripping moss) | The rock below the ground, and cliff faces |
| 3 Docks and paths | Six tiling squares: worn stone slabs, timber decking, rope and plank, painted landing markings (no text), metal grating, a glowing dock edge strip | The docks where streams meet the islands, and paths |
| 4 Far islands | Six island silhouettes on green, 3x2, as seen from a few kilometres off | Cards for islands beyond drawing distance |

Attach to every sheet: the still of the cliff and grass (the board leaping off a grassy
outcrop), for the era's painted grass and rock.

## Status

None made yet.

| Sheet | File | Notes |
|---|---|---|

## Prompt, all sheets

```
SKYTIDE: ISLAND SHEETS (four sheets; make them one at a time, in order, each as its own image)

Surfaces for floating islands high in the sky: grassy tops, rock undersides trailing roots and moss, docks where glowing streams arrive. The game lights and shades them itself.

STYLE, ALL SHEETS
- Background art from a Japanese TV anime of around 2005, painted digitally by hand: a few flat tones per form with soft, controlled brushwork and a little dry-brush texture; grass as clumps and strokes, rock as planes and cracks; no ink outlines.
- Sheets 1 to 3 are textures for a 3D game, so: EVENLY LIT, flat front-on view, no shadows, no highlights, no sky, no horizon, no perspective; each square must tile seamlessly with itself on all four edges.
- Not a photo, not a 3D render: no photographic detail, no noise, no grain.
- Nothing but the surface: no people, animals, text, numbers, logos, signatures or watermarks.
- Palette: grass yellow-green #8DBF5A to #5E9A45, flowers small dots of cream, pale yellow and lilac, earth warm ochre #B8925E, rock warm grey #8C8279 to blue-grey #5D6577 with sandy layers #C9B08A, moss deep green #4F7D3E, timber warm brown #8A5F3C, stone slabs pale grey #B8B2A6.
- Every sheet is 1536x1024, landscape: a 3x2 grid of 512x512 squares, edge to edge.

SHEET 4 IS CUT OUT BY THE GAME
- Paint it on perfectly flat pure magenta, #FF00FF (the islands are green): no shading, texture, gradient, glow or shadow on the magenta; nothing in the art magenta or pink; crisp edges.

SHEET 1: GROUND
- Six tiling squares: (1) meadow grass, long, swept by wind in one direction; (2) short turf; (3) wildflower meadow, grass with small scattered flowers; (4) a sandy path, packed and pebbled; (5) bare earth with a few tufts; (6) moss over stone.

SHEET 2: ROCK
- Six tiling squares: (1) layered sedimentary rock in horizontal bands; (2) weathered rock, rounded and pitted; (3) rock with thin roots running through cracks; (4) rock with faint pale crystal veins; (5) a crumbling edge, broken blocks and soil; (6) rock with hanging moss and drips of water stain.

SHEET 3: DOCKS AND PATHS
- Six tiling squares: (1) worn stone slabs in a staggered pattern; (2) timber decking, boards running left to right; (3) rope and plank walkway; (4) painted landing markings on stone (chevrons and stripes in faded white and amber, no text or numbers); (5) metal grating over a dark gap; (6) a dock's edge strip, pale stone with a band of light inlay (the game makes it glow).

SHEET 4: FAR ISLANDS
- Six floating islands seen from a few kilometres away, from slightly above, one centred in each cell of a 3x2 grid: each a grassy top over a hanging cone of rock trailing roots and a wisp of cloud at its base. Vary them: a wide flat meadow island, a tall spire, a pair joined by a natural arch, one with a waterfall spilling off its edge into the air, a small rocky one with a few trees, one with a tiny lighthouse-like tower.
- Pale and soft with distance: low contrast, blue-grey shadows, a hazy light.
```
