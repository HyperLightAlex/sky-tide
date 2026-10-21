# The look

Skytide should feel like playing a mid-2000s TV anime about sky surfing: the digital ink and
paint of around 2005. Clean, steady lines; flat cel colour with a hard shadow shape; painted
backgrounds; light effects composited as glows; no film grain. This is how each piece is
built and why. The method for the painted art (briefs, sheets, checks) is in
[art/README.md](art/README.md).

The method itself comes from Zenith GP (`docs/ART.md` there), which built a 1980s anime look
the same way: copy the *production facts* of the era (how a thing was drawn, painted and
composited), not the look of any one show, and give each fact one piece of the renderer.

## The references

From the lifting reference frames and stills (kept outside the project; not for
distribution), what each frame shows, in production terms:

| Seen | What it means for us |
|---|---|
| The board's wake is a **wave**: a sheet rising off the tail, curling beside and behind the rider | `render/wakeView.js`: a sheet laid along the board's path, taller on the outside of a carve |
| Its **edges** are thick white glowing lines with lightning kinks | white lines on the sheet, re-drawn at 12 a second |
| Its **body** is see-through sea-glass teal, clouds showing behind | translucent teal, premultiplied over the sky |
| A **green glow** along its base: the trapar | lime body, gold-white core, brightest behind the board |
| A **core of pastel rainbow sparkle** right behind the board | hashed dots in the young part of the base |
| **White water dashes** fly off | streak particles (hard-edged capsules) |
| **Takeoff**: white burst at the lip, a fan of spray, flecks trailing the board | the takeoff flash and burst |
| **Catching** a stream: a green-gold flash, the wave building again | the catch flash |
| **Clouds**: four or five painted values, white tops, slate to near-charcoal shadow sides, dappled brushwork, layered by depth | the painted clouds in the composite |
| Characters: thin dark lines, two flat tones, cool muted shadows | `render/cel.js` |
| The camera paces the rider at three-quarter side-on | a later camera angle for carves (not yet) |

Decisions on top of the references: the **streams stay translucent blue**, so the **green**
is the board's trapar alone and the two always read apart; the anime look is the only look
(no toggle); play is crisp, and the 2005-broadcast touch (4:3 safe framing, title cards, the
eyecatch) is kept for those moments; effects are drawn at **12 drawings a second** with holds
at 8, while the camera, steering and physics stay smooth.

## What each piece is

### Streams (`render/streamMesh.js`)

Translucent blue light, drawn after the sky and clouds, tested against the solid world's
depth but not writing it.

- **Colour.** A body colour rising to a paler core where the light is most intense
  (`STREAM_PALETTE`): each layer its own blue (tangle deep teal-blue, main cerulean, crown pale
  ice), connectors their own colours (updrafts gold, chutes violet).
- **Intensity** builds from a faint body: denser seen edge on, brighter up the walls toward
  the lips, brightest on wave crests and white water.
- **Brushed streaks**: long thin streaks carried downstream, from a cellular noise sampled in
  the stream's own coordinates (along: the band's arc length; across: metres from the
  centreline), two phases crossfaded so they flow without stretching.
- **White lines** (the wave reference): along the lip, across each wave crest, and kinked lines
  through the body (contours of the streaks). About a pixel or two at any distance, with a soft
  glow; far off they take the stream's own colour so the network does not turn to white wire.
- **Sparkles** riding the flow, thickest at the crests and lips.
- **Clouds in front hide them**: the sky pass writes, for each pixel, where along the ray the
  clouds reach 90% and 50% cover; the stream estimates how much cloud lies in front of it from
  that.
- The rider's view is kept clear: skin between the camera and the rider thins out.

### Board wake (`render/wakeView.js`)

See the table above. Samples of the board's path (in the frame of travel, so riding switch
does not flip it) carry the carve, taken from how fast the path turns: the outside of a carve
throws the tall wall. A stretch of wave grows over a fifth of a second and falls away over
two. The wave stays where it was drawn; its growth, lines, spray and flashes step at 12 a
second. Green comes from `PALETTE.trapar` and `traparCore` (`render/pipeline.js`), shared with
the board's glow and the green sparks.

### Sky (`render/shaders.js`, `SKY_COLOR_GLSL`)

Painted in bands as a background artist would, never a muddy blend: deep blue overhead, a clean
lighter blue below it, a warm glow low on the horizon toward the sun, cooler and pinker on the
far side. Golden hour by default (sun at 16°); raise the sun and it lerps to the midday palette
of the references. Painted sky sheets per time of day replace it later
([art/sky-sheets](art/sky-sheets/README.md)).

### Clouds (composite, `COMPOSITE_FRAG`)

The clouds are still ray marched (you fly through them), then painted over in the composite:

- a **clean silhouette** where a cloud gets thick, thin wisps kept soft and faint;
- the **shape**: the front surface rebuilt from the cloud depth the sky pass writes (a few
  texels apart, so it is smooth), tilted by a cellular noise into rounded lobes, lit by the key
  light lifted toward overhead, and mixed with how much sunlight reaches the cloud through
  itself (also from the sky pass) and its height in its layer (bases dark, tops bright);
- **five values** (dark slate, slate, light blue-grey, sunlit white, hot white), soft brushed
  edges between them, shadows leaning to the sky's colour and lights to the sun's;
- a **silver lining** on edges against the sun, and haze with distance.
- The cumulus field itself makes heaps: broad flat bases narrowing to rounded tops.

`cloudPaint` (0..1) blends back to the lit clouds; `cloudSoft` softens the edges.
`pipeline.compMat.uniforms.uCloudDbg = 1` shows the light value in false colour, for tuning the
band thresholds (`uCloudBands`).

### Characters (`render/cel.js`)

After Zenith's `celify`: each lit material's own lighting is replaced by flat tones chosen by
which way the surface faces the key light. The rider and board are characters: a lit tone, a
shadow tone mixed for each paint (darker, leaning to the sky's blue and to violet), a lighter
band of bounced light along the far rim of the shadow, a third highlight tone, a hard rim of
light against the sun. The key light is lifted toward overhead (cel lighting is designed, not
measured). A **contour line** is drawn on the model (an inverted hull on averaged normals, a
steady width on screen, thinning a little with distance). On foot, a **drawn shadow** (one flat
shape, multiplied) sits under the rider.

### Islands (`render/islandsView.js` + the ink pass)

Backgrounds: the same lit tone with a gentler shadow. Lined by the **ink pass**
(`INK_FRAG`), which runs on the solid world before the sky goes behind it: an outline where it
meets the sky and lines at its creases (where the depth bends), in a deeper, cooler shade of
the paint under them, fading with distance. Painted surfaces come from
[art/island-sheets](art/island-sheets/README.md).

### Framing

`Screen shape` (Rendering): fill, 16:9 or 4:3, with black bars. The picture is crisp: no
vignette, no grain, no blur.

## Order of passes

1. Scene (rider, board, islands) into an HDR target with depth.
2. Sky pass (low resolution): clouds, writing colour + cover and, in a second target, cloud
   depth, light and height.
3. Ink pass: the solid world lined.
4. Composite: the sky, the painted clouds over it, the solid world.
5. Streams (translucent, after the clouds).
6. Effects: the wake, spray, flashes, route trail, motes.
7. Tone map to the screen; then the overlay.

## Cost

Per pass in software GL at 640x360 (relative only, and noisy: ms, v14 → v15): scene with the
streams about 450 → scene 20 + streams 330; sky about 255 → 410 (the streams no longer stop
cloud rays short); composite about 55 → 75 (the cloud paint); ink 20 (new); effects about 175
→ 140. In all somewhere between level with v14 and half again more, depending on the view.

What keeps it there: the cloud march strides out across long empty stretches far off (the
streams no longer stop rays short, so this matters) and stops once a cloud is 92% solid (only
its front is painted); the cloud paint is skipped where there is no
cloud; fine streaks and sparkles on the streams are drawn close by only. On a GPU the cloud
march still dominates, and auto quality trades resolution for it as before.

## Checking a change

The look is judged by eye, in pictures that can be compared: `skytide-test/look-shots.mjs`
renders the same moment from several cameras (chase, three-quarter left and right, side,
wide, low), with `ROOT` for before/after, `ASPECT=4:3` for the screen shape, `WARM` seconds of
riding first (with `LEAN` held) so the wake has built, and `PRE` for any setting (for example
`window.sandbox.P.sunElevation=55` for midday).

## Next

- Phase 2: the drawing clock for every effect; speed lines; effect sheets in place of the
  procedural flashes and spray (art/fx-sheets).
- Phase 3: compositing (glow on light: streams, wake, sun), moments (impact frames on big
  landings, the painted still, title cards, the eyecatch).
- Phase 4: painted skies per time of day; night, with the streams glowing as aurora.
- Phase 5: the rider and board designs (art/model-sheets), replacing the placeholders.
- A three-quarter camera that swings out on carves so you see your wave.
