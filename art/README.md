# Painted art

Everything painted for Skytide is made by an image model from the briefs in these folders,
the way Zenith GP made its art. Keep to the method: it is why the pieces match.

| Folder | What |
|---|---|
| [sky-sheets](sky-sheets/README.md) | The sky dome for each time of day (golden hour, midday, night with aurora), and the far sea of cloud below the horizon |
| [fx-sheets](fx-sheets/README.md) | Drawn effects: the board's wave and spray, takeoff and catch, speed lines, impact frames |
| [island-sheets](island-sheets/README.md) | Island surfaces (tiling textures) and island silhouettes for far off |
| [model-sheets](model-sheets/README.md) | The rider and the board: original designs, four views at one scale |
| [key-sheets](key-sheets/README.md) | Key art (the cover), the title card and the eyecatch |

## Reused for now

Until Skytide's own sheets are made, the game uses Zenith GP's painted Helios Drop and
Meridian Skyway art (in `assets/painted`): both skies, both cloud-card sheets and the Helios
cloud sea. Skytide's own sky and cloud sheets (sky-sheets) replace them; they keep the same
layouts (a panorama with the horizon low, cloud cards 3x2 on green, a tiling cloud-sea square) so
they drop in. After a new cloud sheet is cut, run `python3 tools/clouds/build_cards.py` (with its
card rectangles) to rebuild the clouds' volumes from their outlines.

## The method

1. **One brief, kept with the art.** The prompt goes in the folder's README before the sheet
   is made, under a table of what each sheet is and how the game will use it. A redo gets its
   own prompt and its own letter (3 becomes 3B) rather than the old one being overwritten.
2. **A sheet is a grid on a flat key colour.** Panels in a set grid (3x2 for effects, 2x2 or
   3x2 for most others, strips for horizons) on pure green `#00FF00` or pure magenta `#FF00FF`.
   **Magenta for anything with green in it** (the trapar is green, so every effect sheet is on
   magenta); green for the rest. The prompt says "perfectly flat, no shading, texture,
   gradient, glow or shadow on the key colour", every time. Tiling textures are asked for
   evenly lit.
3. **Attach the references.** Each README lists what to attach. The look references (the
   lifting frames and stills) are for colour, light, line and motion only; every design is
   original, and the briefs say so.
4. **One sheet at a time, checked before the next.** Look at every panel: the shape, the line,
   the colour, anything painted onto the key colour. Note in the README's status table what was
   used, what was not, and why.
5. **Cut and build with scripts, never by hand.** (The cutting tools are to be written when the
   first sheets arrive; Zenith's `tools/fx/ingest.py` and `tools/bg/` are the model.) The sheet
   stays the source: rebuilding from it must give the same files.
6. **Into the game, then checked** with `look-shots.mjs` (see ART.md, "Checking a change").

**Record the image model.** Add a line to the README with the model, its version and the
image size whenever a sheet is made, so it can be made again.

## Style, every brief

These lines open every prompt, adapted to the sheet:

- Art from a Japanese TV anime of around 2005, made in digital ink and paint: clean, steady,
  thin dark lines on characters and props; flat cel colour with one hard shadow shape and a
  small highlight; backgrounds painted by hand in a few tones per form with soft, controlled
  brushwork and a dappled texture in clouds; light effects composited as glows.
- Not a photo, not a 3D render, not a modern painterly illustration: no lens flare, no
  depth-of-field blur, no film grain or noise, no chromatic aberration.
- Original designs only: no existing characters, vehicles, logos or text.
- Palette (golden hour unless the sheet says otherwise): zenith deep blue `#0D2A78`, sky blue
  `#2E62C8`, horizon gold `#FFB26A`, far-side horizon dusky rose `#B39AB8`, cloud lights cream
  `#FFF3DE`, cloud shadows slate `#4A5878` to near-charcoal `#232A3C`, streams translucent
  cerulean `#2F7BEA` with white lines, trapar lime `#7CF22A` with a gold-white core `#F2FF8A`,
  wave body sea-glass teal `#2A8C8E`.
