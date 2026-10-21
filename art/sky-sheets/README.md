# Sky sheets

The painted sky, clouds and cloud sea, one set per time of day, to replace the Zenith GP art
the game borrows for now (Meridian's golden hour, Helios's high sun). Each set is four sheets,
in exactly Zenith's layouts, so they drop into the same build:

| Sheet | What | How the game uses it |
|---|---|---|
| 1 Sky | Half the sky, the half facing the sun, unrolled from the horizon (three quarters down) to straight overhead (the top edge); flat haze below the horizon | Half the sky dome, turned so its glow is round the sun; the haze everything fades into takes its colours from it |
| 1B Sky | The other half, facing away from the sun, joining sheet 1 at both edges (made with sheet 1 attached) | The other half of the dome |
| 2 Clouds | Six cloud cards on green, 3x2, in a fixed order (below) | Every cloud in the sky is one of these cards, standing on its flat base and turned to face you; its outline, turned round its upright, is the volume you fly into |
| 3 Cloud surfaces | Six tiling squares, 512 px, 3x2, evenly lit | The sea of cloud far below, in patches (1 dense, 2 broken, 5 shaded), and the puffs you pass inside a cloud (windows onto 1 and 5); the mist deep inside a cloud (3 lit, 6 in shade); the tops of stratus decks (4, later) |

**The cloud cards' order matters.** The game picks cards by shape: towers for the tall heaps,
banks for the wide ones, and card 4 is always the storm (a cumulonimbus with an anvil). Keep
the order in the prompt, cell by cell.

Sets: **G** golden hour (first), **M** midday (the lifting reference's light), **N** night
(later, for the aurora). Sheet files: `sky-g1-sky.png`, `sky-g1b-sky.png`, `sky-g2-clouds.png`,
`sky-g3-cloud.png` (and `m`, `n` for the others), 1536x1024 each, in this folder.

Attach to every sheet: lifting reference frames 19, 22 and 33 (the clouds' values and
dappled brushwork) and, from sheet 2 on, that set's sheet 1 (its palette). Attach sheet 1 to
1B. The Zenith sheets (`bg-m3-clouds`, `bg-h3-clouds`, `bg-h4-surfaces`) are useful layout
references for 2 and 3: attach them as layout only, the style is ours.

## Status

Golden hour (G) is made and in the game (2026-10-21). Midday (M) and night (N) are to come; until
then a high sun uses Zenith's Helios set and night uses G. Image model: not yet recorded.

| Sheet | File | Notes |
|---|---|---|
| G1 | `sky-g1-sky.png` | Second of two takes (G1B was made from it; the takes are near-identical; the first is in `alt/`). Horizon at row 763 (asked 768; the builder finds it), flat haze, plain deep blue along the top, the sun's glow at the middle. Its clouds are fanned in perspective toward the sun, which in the round reads as cloud streets running toward the sun. |
| G1B | `sky-g1b-sky.png` | Used. The model kept G1's cloud layout and repainted the light (rose horizon, no glow), so its clouds do not meet G1's at the edges: the builder overlaps the halves by 160 px and cuts each join through the gaps between clouds. The same fan, facing away, reads as the streets running on to the point opposite the sun. |
| G2 | `sky-g2-clouds.png` | Used as made: flat key (#02FA02), all six in their cells and in order, flat bases, nothing green in the clouds, no halo. The storm's lower half is lavender-violet rather than dark slate, which suits golden hour. |
| G3 | `sky-g3-cloud.png` | Second of two takes (the first is in `alt/`): it wraps far better (the first's squares 5 and 6 only repeated when cut to about 320 px). The builder makes each square repeat with a cut where the edges agree. Squares 1, 2 and 5 are the cloud sea (and 1 and 5 the puffs inside a cloud); 3 and 6 are the mist deep inside a cloud: as puffs they were too soft to read against it. 4 (stratus tops) waits for stratus decks to be drawn as decks. |

## Golden hour (G)

```
SKYTIDE: SKY SHEETS. GOLDEN HOUR (four sheets; make them one at a time, in order G1, G2, G3, then G1B with G1 attached, each as its own image)

The setting: high in an endless sky at golden hour, far above a sea of cloud, with towering cumulus, floating islands of rock and grass, and streams of light winding through the air (the game draws the islands and the streams). These sheets are the painted sky and its clouds.

STYLE, ALL SHEETS
- Background art from a Japanese TV anime of around 2005, painted digitally by hand the way that era's background department did it: skies in smooth, clean gradients; clouds in four or five flat values per form (lit, mid, shadow, deep shadow, a little reflected light), the tones crisply separated with soft, controlled brush edges and a dappled texture of small rounded strokes inside them.
- No ink outlines anywhere; background paintings had none.
- Distance shown by atmospheric perspective: the further away, the paler and closer to the horizon haze.
- Not a photo, not a 3D render, not a modern painterly illustration: no bloom, lens flare, depth-of-field blur, film grain or noise.
- Nothing but sky and cloud: no islands, people, vehicles, aircraft, birds, text, numbers, labels, logos, borders, signatures or watermarks.
- Palette: deep blue #12348F high in the sky, bright blue #3F7FE0, a clean light blue #8DB8F0, peach-gold #FFC98F at the horizon toward the sun, dusky rose #C9A2C0 at the horizon away from it, warm haze #EFCFB6, sunlit cloud cream-gold #FFE9C4, cloud mid tones peach #F4B88E, cloud shadows lavender-blue #8088C0, deep cloud shadow violet-slate #4F4E7E.
- Every sheet is 1536x1024, landscape.

SHEETS G2 AND G3
- G2 is cut out by the game: paint it on perfectly flat pure green, #00FF00, with no shading, texture, gradient, glow or shadow on the green; nothing in the clouds may be green or close to it; crisp edges against the green, with no soft halo.
- G3 is six textures, edge to edge, no green.

SHEET G1: SKY, THE HALF FACING THE SUN (full bleed, no green)
- Half the sky around the viewer, the half facing the sun, unrolled into one painting from the horizon at the bottom to straight overhead at the top edge.
- The horizon is a perfectly straight, level line exactly three quarters of the way down (768 px from the top). Below it, only flat warm haze (#EFCFB6); paint nothing there.
- The sun is low over the horizon at the middle of the image, about 100 px above the horizon line. Paint its warm glow but not the sun disc itself (the game draws it). The sky is warmest and brightest there and turns cooler and bluer towards the left and right edges.
- A smooth gradient from deep blue at the top, through bright blue and a clean light blue, to peach-gold at the horizon. Keep the blues and the gold apart: no muddy grey or purple where they meet.
- Clouds: high, thin cirrus streaks combed by the wind and a broken band of small flat-bottomed altocumulus lower down, cream-gold where they face the sun, lavender-blue in shadow; densest near the middle, sparse towards the edges. No big cumulus (they come on sheet G2).
- The top edge is plain deep blue, even across the full width.

SHEET G2: CLOUD CARDS (six clouds on green)
- Six separate golden-hour cumulus clouds, one in each cell of an invisible 3x2 grid (cells 512x512), each centred in its cell and filling about 85% of it without touching the cell's edges or another cloud.
- Each stands on a flat, level base along its bottom (the game stands it on the cloud's base), with nothing hanging below it.
- Lit from above and a little from the front, so a cloud reads as lit whichever side it is seen from (the game turns each to face the viewer and mirrors half of them): tops cream-gold, middles peach, undersides and the creases between billows lavender-blue, the deepest creases violet-slate. Rounded, cauliflower billows, each with its own lit side and shadow, smaller billows toward the edges.
- In this order:
  - top left: a tall towering cumulus, much taller than wide, its crown boiling up in big billows;
  - top middle: a wide, low, flat-bottomed bank, about three times as wide as tall;
  - top right: a medium heap, a little wider than tall;
  - bottom left: a storm cloud, a cumulonimbus: a massive tower whose top spreads into a wide, flat, smooth anvil, the anvil much wider than the tower, dark slate-violet in its lower half;
  - bottom middle: a heap of two lobes, a taller one and a lower one, joined at the base;
  - bottom right: a broken cluster, one main heap with smaller cloudlets around it (paint the sky between them green).

SHEET G3: CLOUD SURFACES (six tiling squares, full bleed)
- Six square textures in a 3x2 grid, each exactly 512x512, filling the sheet edge to edge with no borders, gaps or labels.
- Each square repeats on its own: its left edge must continue into its right edge and its top edge into its bottom edge, with no visible seam. Paint each straight-on (flat, no perspective, no horizon) and evenly lit in golden light from above, with no cast shadows across it and no vignette. Keep the detail even, with no single feature that would stand out when it repeats.
- 1, top left: a dense sea of cloud seen from high above, packed rounded billows of many sizes, cream-gold tops and lavender-blue creases.
- 2, top middle: a broken sea of cloud seen from high above, clumps of billows with gaps between them where a deep blue-violet depth (#2E3470) shows far below.
- 3, top right: the inside of a cloud, close up: a few large soft billows filling the square, cream and peach with lavender shadows, softer edges than squares 1 and 2.
- 4, bottom left: the top of a flat stratus deck seen from above, long smooth layered streaks and ripples, pale cream-peach with lavender between them.
- 5, bottom middle: the same dense sea of cloud as square 1, but in the shadow of a big cloud above: lavender-blue billows with violet-slate creases and only a little warm light on the highest tops.
- 6, bottom right: the inside of a cloud low down, close up, as square 3 but in shade: lavender and dusky rose billows with violet-slate creases.
```

Sheet G1B, made last, with G1 attached:

```
SHEET G1B: THE OTHER HALF OF THE GOLDEN-HOUR SKY (attach sheet G1)

Same size (1536x1024), same style and palette as the attached sheet, the horizon at exactly the same height (768 px from the top), the same flat warm haze below it and the same plain deep blue along the top edge.

The attached sheet is the half of the sky that faces the low sun. Paint the other half, the sky behind the viewer, facing away from the sun. Its left edge must continue seamlessly from the attached sheet's right edge, and its right edge must continue seamlessly into the attached sheet's left edge, so that the two sheets side by side make the whole sky round.

No sun and no golden glow here: the sky facing away from a low sun is cooler and a clearer blue, with a soft band of dusky rose and lavender just above the horizon. The high cirrus streaks and the broken band of flat-bottomed altocumulus carry on across it, a little sparser than on the sun side, their faces lit warm pink-gold by the sun behind the viewer, lavender-blue in shadow. No big cumulus. No sun disc, no text, no outlines.
```

## Midday (M)

```
SKYTIDE: SKY SHEETS. MIDDAY (four sheets, as the golden hour set: make them in order M1, M2, M3, then M1B with M1 attached; attach the golden hour sheet of the same number for its layout, and the lifting reference frames for the light)

As the golden hour set, with these changes:
- The light: a high sun, the clear, deep blue sky of a summer midday high in the air, as in the attached reference frames.
- Palette: deep ultramarine #0E3A9E high in the sky, bright blue #3D86E8, clean light blue #A9CDF5, pale blue-white haze at the horizon #D6E6F8, cloud white #FFFFFF with light blue-grey mid tones #C9D6EC, blue-grey shadows #7C8FB8, deep slate shadow #3E4866 (the shadowed side of a big cloud goes nearly charcoal, as in the reference).
- M1: the sun is high, out of the picture at the top middle: a soft brightening of the blue around the top middle, no warm glow; the horizon all round is pale blue-white haze. High white cirrus wisps and a few small, bright fair-weather cumulus far off near the horizon.
- M1B: the same sky facing away from the sun, a little deeper blue, the same haze, the same thin cirrus, sparser.
- M2: the same six shapes in the same order, brilliant white tops, light blue-grey middles, blue-grey undersides, deep slate in the creases and under the storm's anvil.
- M3: the same six squares, white and blue-grey; square 2's depth far below a deep blue #1E3F86; squares 5 and 6 in blue-grey shade with slate creases.
```

## Night (N, later)

```
SKYTIDE: SKY SHEETS. NIGHT (four sheets, as the golden hour set: N1, N2, N3, then N1B with N1 attached; attach the golden hour sheet of the same number for its layout)

As the golden hour set, with these changes:
- A clear night high above the sea of cloud, lit by a bright moon (the game draws the moon's disc) and starlight. The game draws the streams glowing like an aurora, so keep the sky dark enough for them to stand out, and paint no aurora.
- Palette: zenith near-black blue #070C26, sky deep navy #13245A, a faint teal-blue glow low on the horizon toward the moon #2D5D7C, moonlit cloud tops cool silver-blue #B4C3E0, cloud mid tones #6F7FA8, cloud shadows navy #222C55, deep shadow #10142E.
- N1: the moon low over the horizon at the middle, about 100 px above it: paint its pale glow, not its disc. Stars: many small, crisp points of slightly different sizes, denser in a faint band across the sky, none larger than 3 px. Thin silver cirrus near the moon.
- N1B: the same night facing away from the moon: darker, more stars, no glow.
- N2: the same six shapes in the same order, moonlit: silver-blue tops, navy shadows, the storm's anvil dark.
- N3: the same six squares, moonlit silver-blue and navy; square 2's depth far below near-black #070A1C.
```
