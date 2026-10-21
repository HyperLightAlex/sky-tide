# Effect sheets

Drawn effects, 3x2 panels on flat **magenta** (`#FF00FF`): the trapar is green, so nothing
here may be keyed on green. Each row is one effect's drawings in order, left to right; the
game plays them at 12 drawings a second with holds, as hand-drawn effects were timed. The
procedural versions in `render/wakeView.js` stand in until these are made, and set the shape
each sheet must fit (where the board is, which way the motion runs).

| Sheet | What | How the game uses it |
|---|---|---|
| 1 Takeoff burst | Top row: the white burst at the lip as the board leaves a stream (flash, burst, fan of spray); bottom row: the spray thinning to droplets and flecks | In place of the takeoff flash and burst |
| 2 Catch flash | Top row: the green-gold flash as the board catches a stream; bottom row: the wave starting to build from it | In place of the catch flash |
| 3 Wave lines | Six long white glowing wave-edge lines with lightning kinks, each a horizontal strip | Drawn along the wave's crest and through its body, cycled per drawing |
| 4 Spray | Six small clusters of white water dashes and droplets flying off to the right | Thrown off the crest in place of the procedural dashes |
| 5 Trapar glow | Top row: three drawings of the green glow band along the base of the wave; bottom row: three of the pastel rainbow sparkle core | Strips along the wave's base, cycled per drawing |
| 6 Speed lines | Top row: three drawings of radial speed lines for a boost; bottom row: three of parallel speed lines for a fast straight | Screen overlays at speed |
| 7 Impact frame | Top row: a hard landing's impact (the flash, the lines, the after-image); bottom row: a big trick's finish | A moment, a few frames long |

Attach to every sheet: the lifting reference frames 1–8 (the wave, the takeoff and spray),
15–16 (the catch) and 19–22 (the glow and the rainbow core); the second clip's frames 12–14
for the brighter flame-like trapar bursts (sheet 2).

## Status

None made yet.

| Sheet | File | Rows | Notes |
|---|---|---|---|

## Prompt, all sheets

```
SKYTIDE: EFFECT SHEETS (seven sheets; make them one at a time, in order, each as its own image)

Drawn effects for a game about surfing a glowing current in the sky: a board rides streams of light and throws up a wave of green light and white water as it carves. The game draws the rider, the board and the sky; these sheets are the effects only.

STYLE, ALL SHEETS
- Effects animation from a Japanese TV anime of around 2005, made in digital ink and paint: shapes drawn with clean, confident edges, filled with flat colour, then given a composited glow (a soft halo of the same colour round the bright shapes). Hand-drawn timing: each panel is one drawing, with clear changes between drawings.
- White water is drawn as white shapes with a thin pale-blue edge: tapered dashes, teardrop droplets, curling spray; never photographic spray or particles.
- The trapar is glowing lime green #7CF22A with a gold-white core #F2FF8A, soft at its edges like light, with small gold sparkles; where it is most intense it turns white.
- Not a photo, not a 3D render, not a modern painterly illustration: no motion blur, no film grain, no noise, no lens flare.
- No rider, board, sky, text, numbers, borders, signatures or watermarks; nothing but the effect.
- Every sheet is 1536x1024, landscape: a 3x2 grid of panels, each 512x512, the effect centred in its panel unless the sheet says otherwise, nothing crossing a panel's edge.

THE KEY COLOUR
- Paint every sheet on perfectly flat pure magenta, #FF00FF: no shading, texture, gradient, glow or shadow on the magenta. Glows fade into transparency, not into a lighter magenta: keep the halo the effect's own colour, darkening to the magenta only at its very edge.
- Nothing in the art may be magenta, pink or close to it, except sheet 5's pastel rainbow, whose pinks must stay pale (more white than pink).

SHEET 1: TAKEOFF BURST
- The board has just left the lip of a stream moving left to right; the lip is at the centre-left of each panel.
- Top row: (1) a tight white flash at the lip, star-shaped, with a few short rays; (2) the burst opening into a fan of white spray thrown up and back to the right, thick curling sheets of water breaking into dashes; (3) the fan at its widest, the sheets broken into many tapered dashes and droplets arcing outward.
- Bottom row: (4) the dashes thinning and falling, fewer and smaller; (5) a scatter of small droplets and a few short dashes; (6) the last flecks, a handful of small white dots and ticks.

SHEET 2: CATCH FLASH
- The board touches down on a stream at the centre of each panel, moving left to right.
- Top row: (1) a small hard flash of white-gold at the contact point; (2) it blooms into a round green-gold glow with a white core and short rays, gold sparkles thrown outward; (3) the glow flattening along the direction of travel, sparkles drifting.
- Bottom row: (4) a low wave of green light rising behind the contact point, white-edged at its crest; (5) the wave taller, a thick white glowing line along its crest with a lightning-like kink, green glow along its base; (6) the wave trailing off to the left, fading at its far end.

SHEET 3: WAVE LINES
- Six separate lines, one per panel, each running horizontally across the full width of its panel, centred vertically.
- Each is a thick white line with a soft white glow, like the glowing edge of a breaking wave drawn as light: mostly a smooth flowing curve, with one to three sharp lightning-like kinks and the occasional short branch splitting off and rejoining.
- Panels 1–3: thick crest lines (about 8 px core). Panels 4–6: thinner body lines (about 4 px core), more branching.
- Each line's left and right ends taper to nothing.

SHEET 4: SPRAY
- Six small clusters of white water, one per panel, each thrown off to the right from a point at the left of the panel.
- Each cluster: five to fifteen tapered white dashes (thick at the head, tapering to a point at the tail, pointing back toward the left), teardrop droplets and a few dots, with thin pale-blue edges.
- Vary them: tight and fast, wide and scattered, arcing up, arcing down, a single long curling sheet breaking up, a light sprinkle.

SHEET 5: TRAPAR GLOW
- Top row, three drawings of one band: a horizontal band of glowing lime green across the full width of the panel, about 120 px tall, brightest and gold-white along its centre line, soft at its top and bottom edges, with small gold sparkles in it; each drawing changes the band's wavering edges and sparkles, as a hand-drawn loop. Its left and right ends must each continue seamlessly into the other.
- Bottom row, three drawings of one band: the same size, filled with a dense sparkle of small pastel rainbow points (pale pink, pale yellow, pale cyan, pale lavender, mostly white) over a thin lime glow; each drawing moves the sparkles. Ends continuous as the top row.

SHEET 6: SPEED LINES
- Top row, three drawings: radial speed lines bursting from the centre of the panel toward its edges, white, sharp-ended, thick near the edge and tapering to points toward the centre, leaving the middle third clear; each drawing has different lines.
- Bottom row, three drawings: parallel horizontal speed lines across the panel, white, of varied lengths and thickness, tapering at both ends, denser at the top and bottom edges and clear through the middle; each drawing different.

SHEET 7: IMPACT FRAME
- Top row, a hard landing: (1) a full-panel flash, white with a few hard black streaks radiating from the centre (the inverted impact frame of TV anime); (2) a ring of white light expanding from the centre with heavy black speed lines behind it; (3) the ring breaking into fragments and white dashes.
- Bottom row, a big trick's finish: (4) a spinning burst of green-gold light with a white core; (5) the burst opening into a star of rays with gold sparkles; (6) the rays fading, sparkles drifting outward.
```
