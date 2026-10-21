# Sky sheets

The painted sky dome, one set per time of day. Skytide is played high in the sky, so the
dome is seen **above and below** the horizon: unlike Zenith's skies (horizon three quarters
down, haze below), each sheet puts the horizon across the **middle** and paints the far sea
of cloud below it too.

| Sheet | What | How the game uses it |
|---|---|---|
| 1 Sky | Half the dome, the half facing the sun, unrolled: zenith along the top, horizon exactly across the middle, the depths along the bottom, the sun's glow at the middle | Half the sky dome, in place of the banded gradient (`SKY_COLOR_GLSL`), turned to face the sun |
| 1B Sky | The other half, facing away from the sun, painted to join sheet 1 at both edges (made with sheet 1 attached) | The other half of the dome |
| 2 Cloud sea | Three strips on green, each tiling end to end: the far tops of the cloud sea seen from above, at three distances | Rings just below the horizon, for depth, in front of the dome and behind the ray-marched clouds |
| 3 High cloud | Six cirrus and altocumulus cards on green, 3x2 | Cards high above the cloud layer, too far to fly to |

Each time of day is one set: **G** golden hour (first), **M** midday, **N** night (later,
with the aurora). Sheet sizes 1536x1024, landscape. Half a dome to a sheet: 1536 px for 180°
across and 1024 px for 180° up and down, about 8.5 and 5.7 px a degree.

Attach to every sheet: the lifting reference frames 19, 22 and 33 (for the clouds' values and
brushwork) and, for each 1B, its sheet 1.

## Status

None made yet.

| Sheet | File | Notes |
|---|---|---|

## Golden hour (G)

```
SKYTIDE: SKY SHEETS. GOLDEN HOUR (four sheets; make them one at a time, in order, each as its own image)

The setting: high in an endless sky at golden hour, far above a sea of cloud, with floating islands and big cumulus around (the game draws those). These sheets are the painted sky around and below everything.

STYLE, ALL SHEETS
- Background art from a Japanese TV anime of around 2005, painted digitally by hand the way that era's background department did: skies in smooth clean gradients, clouds in four or five flat values per form with soft, controlled brush edges and a dappled texture, no ink outlines (backgrounds had none).
- Distance by atmospheric perspective: further away is paler, bluer and closer to the horizon haze.
- Not a photo, not a 3D render, not a modern painterly illustration: no lens flare, no bloom, no depth-of-field blur, no film grain or noise.
- Nothing but sky and cloud: no islands, people, vehicles, birds, text, numbers, logos, borders, signatures or watermarks.
- Palette: zenith deep blue #0D2A78, sky blue #2E62C8, a clean lighter blue #4F86E0 below it, horizon gold #FFB26A toward the sun, dusky rose #B39AB8 on the far side, sunlit cloud cream #FFF3DE, cloud shadows slate #4A5878 to near-charcoal #232A3C, the depths deep blue-violet #1A1F4A.
- Every sheet is 1536x1024, landscape.

SHEETS 2 AND 3 ARE CUT OUT BY THE GAME
- Paint them on perfectly flat pure green, #00FF00: no shading, texture, gradient, glow or shadow on the green.
- Nothing in the art itself may be green or close to it.
- Crisp edges against the green, with no soft halo.

SHEET G1: SKY, SUN SIDE (full bleed, no green)
- Half the sky around the viewer, unrolled into one painting, the horizon a perfectly straight, level line exactly across the middle (512 px from the top).
- Above the horizon: a smooth gradient from deep blue at the top, through a clean lighter blue, to warm gold in a band low on the horizon. Keep the blues and the gold apart: no muddy grey or purple where they meet.
- The sun is low, at the middle of the image about 120 px above the horizon. Paint its warm glow but not the sun's disc (the game draws it). The gold is strongest there and cools toward both edges.
- Below the horizon: the far sea of cloud seen from high above, its tops catching gold light near the horizon, darkening downward through slate blue into deep blue-violet depths at the bottom edge. Soft, flat-topped masses, no detail that would pull the eye.
- A few high streaks of thin cirrus above, combed by the wind, gold where they face the sun.
- The top edge is plain deep blue, even across the full width; the bottom edge plain deep blue-violet, even across.
- The left and right edges must each be the same colour from top to bottom as the matching row of sheet G1B's edges (paint G1B with this sheet attached).

SHEET G1B: SKY, AWAY FROM THE SUN (full bleed, no green; attach G1)
- The other half of the same sky, painted to join G1 at both its left and right edges.
- No sun glow: the horizon band is dusky rose instead of gold, the blues a little deeper; the cloud sea below lit only by the sky, its tops lavender-grey.
- Horizon exactly across the middle, level with G1's; top and bottom edges as G1's.

SHEET G2: CLOUD SEA (three strips on green)
- Three separate horizontal strips stacked top to bottom with green between them, each the full width of the image and about 260 px tall.
- Each strip is the top of a sea of cloud seen from above at a distance: billowing heaps along its top edge, filled solid down to a perfectly straight, level bottom edge. Each strip repeats: its left end continues seamlessly into its right end.
- Top strip, farthest: low, pale, very soft heaps, almost the haze colour, low contrast.
- Middle strip: rounder heaps, lit cream-gold on top, slate-lavender in shadow.
- Bottom strip, nearest: big rounded heaps with clear lit tops and slate shadow sides, dappled brushwork, the largest about 200 px tall.

SHEET G3: HIGH CLOUD (six cards on green, 3x2 grid)
- Six separate clouds, one centred in each cell of a 3x2 grid, none touching the cell edges or each other.
- Top row: three cirrus, long thin streaks and hooks combed by the wind, cream-gold on the sun side fading to lavender.
- Bottom row: three altocumulus patches, rows of small flat-bottomed cloudlets, each lit cream on top with a slate underside.
- Seen from below and to the side, as from far beneath them.
```

## Midday (M)

```
SKYTIDE: SKY SHEETS. MIDDAY (four sheets, as the golden hour set; attach the golden hour sheet of the same number for layout)

As the golden hour set, with these changes:
- Palette: zenith deep blue #1546B0, sky blue #3D7FE0, clean light blue #8EC0F2 near the horizon, horizon haze pale blue-white #DCE9F7, sunlit cloud white #FFFFFF, cloud shadows blue-grey #6E7FA3 to slate #3B4766, the depths deep blue #172E6E.
- The sun is high: on sheet M1 its glow is a soft brightening at the top middle, not on the horizon; the horizon all round is pale blue-white haze, not gold.
- Clouds below the horizon: bright white tops with blue-grey shadows, the depths deep blue rather than violet.
- High cloud: brilliant white cirrus and altocumulus with soft blue-grey undersides.
```

## Night (N, later)

```
SKYTIDE: SKY SHEETS. NIGHT (four sheets, as the golden hour set; attach the golden hour sheet of the same number for layout)

As the golden hour set, with these changes:
- A clear night far above the cloud sea, lit by a bright moon (the game draws the moon's disc) and starlight. The game draws the streams glowing like an aurora; leave the sky dark enough for them to stand out.
- Palette: zenith near-black blue #060B24, sky deep navy #10204F, a faint teal-blue glow low on the horizon #2C5C7A, moonlit cloud tops cool silver-blue #A9B9D8, cloud shadows navy #1A2448, the depths black-blue #04060F.
- Stars: many small, crisp, slightly varied points, denser in a faint band across the sky; no star larger than 3 px.
- No aurora painted on the sky (the streams are the aurora).
```
