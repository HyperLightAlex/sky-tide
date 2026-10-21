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
| Its **edges** are thick white glowing lines with lightning kinks | white lines on the sheet, tied to the path so they stay put on the wave |
| Its **body** is see-through sea-glass teal, clouds showing behind | translucent teal, premultiplied over the sky |
| A **green glow** along its base: the trapar | lime body, gold-white core, brightest behind the board |
| A **core of pastel rainbow sparkle** right behind the board | hashed dots in the young part of the base |
| **White water dashes** fly off | streak particles (hard-edged capsules) |
| **Takeoff**: white burst at the lip, a fan of spray, flecks trailing the board | the takeoff flash and burst |
| **Catching** a stream: a green-gold flash, the wave building again | the catch flash |
| **Clouds**: painted heaps, white or gold tops, slate shadow sides, dappled brushwork, layered by depth | painted cloud cards (Skytide's golden-hour sheet; Zenith's Helios under a high sun) with a volume you fly into (`render/cloudView.js`) |
| Characters: thin dark lines, two flat tones, cool muted shadows | `render/cel.js` |
| The camera paces the rider at three-quarter side-on | a later camera angle for carves (not yet) |

Decisions on top of the references: the **streams stay translucent blue**, so the **green**
is the board's trapar alone and the two always read apart; the anime look is the only look
(no toggle); play is crisp, and the 2005-broadcast touch (4:3 safe framing, title cards, the
eyecatch) is kept for those moments. Drawn, frame-by-frame effects (the effect sheets, when they
come) play at **12 drawings a second** with holds at 8; everything continuous (the wake, the
streams, the clouds, the camera, steering and physics) moves smoothly every frame. (The wake
was first stepped at 12 a second too: as a continuous sheet it read as flicker.)

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
- **Clouds in front hide them** by depth: the painted clouds write depth where they are solid.
- The rider's view is kept clear: skin between the camera and the rider thins out.

### Board wake (`render/wakeView.js`)

See the table above. Samples of the board's path (in the frame of travel, smoothed, so riding
switch or a bumpy surface does not twist it) carry the carve, taken from how fast the path
turns: the outside of a carve throws the tall wall. The wave peels off the rail and rises over
the first few metres behind the board (longer the faster you go), so it always grows out of the
board; each ride on a stream is one wave, rising from where you caught it and tapering off
where you left. It falls away over two seconds. Everything moves every frame: the lines, kinks
and sparkles are tied to the distance along the path and only drift slowly, so they stay on the
wave instead of being re-drawn. Green comes from `PALETTE.trapar` and `traparCore`
(`render/pipeline.js`), shared with the board's glow and the green sparks.

### Sky (`render/painted.js`, the composite)

The sky is a painted set picked by the sun's height: golden hour (below 28°) is Skytide's own
([art/sky-sheets](art/sky-sheets/README.md), set G); a high sun still borrows Zenith GP's Helios
Drop, and night falls back to golden hour until sets M and N are made. Each sky is a panorama
round the horizon up to the zenith, made of two painted halves (the one facing the sun and the
one facing away), turned so its glow is round the sun, the sun's disc drawn over it. An image
model cannot paint two halves whose clouds meet, so the builder overlaps them and cuts each join
through the gaps between the clouds. The haze everything fades into (`SKY_COLOR_GLSL`) takes its
colours from the painting, so far things fade into the sky they are painted against.

Painted things undo the frame's tone mapping first (`unTone` in `render/painted.js`, the inverse
of the final pass's curve), so they come out as painted, as Zenith does.

### Clouds (`weather/cloudField.js`, `render/cloudView.js`)

Zenith's approach, made to fly through: each cloud is a **painted card** (Skytide's golden
cumulus and storm at golden hour; Helios's white-blue ones and anvil under a high sun until set M
is made) and a **volume**.

- **Where.** Heaps sit one to a cell of the moving air (towers, heaps and banks; more where the
  pressure is low and with `Cumulus cover`), drift with the wind at their height, and each lives
  a slow cycle, growing in, holding and thinning out, before its cell makes another. Stratus
  banks are squashed bank cards at the stratus height; storms are the weather's living storms.
  All of it is a function of the seed, the time and the focus, with no three.js, so the main
  thread, workers and tests see the same sky.
- **The card** stands on the cloud's flat base and turns to face you about the upright, as in
  Zenith; it leans back as you rise above it (and forward below), so from above it is never seen
  edge on. Hazed with distance. Cards are drawn farthest first, after the sky and the solid
  world: a depth pass writes their solid parts (so streams behind are hidden), then the painting
  is laid over.
- **The volume** is the card's silhouette turned round its upright (`tools/bg/build_painted.py`
  reads each card's outline from its atlas into `world/paintedSets.js`), so the painting and the
  volume agree from every side. It is what shakes you (turbulence) and what the HUD reports.
- **Flying in.** Within 45 m of a cloud its card thins away; inside, puffs (round windows onto
  the set's painted cloud sea, its shaded painting low in the cloud) sit on a lattice tied to the
  world round you, shown where they are inside the cloud, so they stream past as you fly. The
  deeper in, the more the view goes to a mist (40% at most): the set's painting of the inside of
  a cloud (lit higher up, in shade low down), about a screen high and turning with the view, so
  there are big soft billows behind the puffs streaming past. Zenith's sets have no inside
  paintings: their mist is the cloud's colour, and their puffs are warmed at golden hour.
- **The cloud sea**: the set's painted sea of cloud, far below at the floor (fall into it and you
  are gone), drifting, each painting at two sizes blended by a slow noise so its billows never
  line up, hazed into the horizon. A set of Skytide's own has three paintings of it (dense,
  broken with the depth showing between the clumps, and in a cloud's shadow) that come and go in
  wide patches, so it reads as weather rather than one tile repeated. (Helios has one, warmed at
  golden hour.)

### Glow (`render/pipeline.js`, the final pass)

As a 2005 TV anime composited it: only the light glows. The frame is copied (at half size) just
before the light goes on, after the sky, the solid world and the painted clouds; after the
streams and effects, what they added (the frame less the copy) is kept where it is bright
(`Glow threshold`), blurred tight (a quarter of the frame) and wide (an eighth), and added back
before the tone map. So the streams' white lines and bright cores, the board's green trapar,
the flashes and sparks glow, and the painted sky, clouds and islands never bloom. The puffs
inside a cloud are drawn after the glow is taken (they are not light). The sun gets its own
soft glow round its disc, dimmed where something solid stands in front of it. `Glow` and
`Sun glow` (Rendering) set how strong.

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
2. Ink pass: the solid world lined.
3. Composite: the painted sky behind the solid world.
4. The cloud sea and the cloud cards (their depth, then their painting, farthest first).
5. A half-size copy of the frame (for the glow).
6. Streams (translucent, behind the solid world and the clouds by depth).
7. Effects: the wake, spray, flashes, route trail, motes.
8. Glow: what 6 and 7 added, where bright, blurred tight and wide.
9. The puffs inside a cloud.
10. Glow and the sun's glow added, the mist (inside a cloud), tone map to the screen; then the
    overlay.

(The low-resolution sky pass now runs only for the ray-marched streams, the comparison view.)

## Cost

Per pass in software GL at 640x360 (relative only, and noisy; ms, v15 → v16): the sky pass
(the cloud ray march) about 460 → gone; clouds (cards and sea) 43; composite 97 → 58; streams
about 380 → 360; effects about 170 → 160; scene and ink about 45 as before. In all about 1150 →
675: the painted clouds cost a small fraction of the march they replace. On a GPU the streams
are now the largest pass. The glow adds a copy, an extract and four blurs, all at a half to
an eighth of the frame: about a tenth more on the whole frame.

## Checking a change

The look is judged by eye, in pictures that can be compared: `skytide-test/look-shots.mjs`
renders the same moment from several cameras (chase, three-quarter left and right, side,
wide, low; and on the nearest big cloud: `cloudFar`, `cloudNear`, `cloudEdge`, `cloudIn`,
`cloudDeep`; round the sky from the rider: `sun`, `anti`, `joinL` and `joinR` (where the painted
halves meet) and `sea`, `seaFar`), with `ROOT` for before/after, `ASPECT=4:3` for the screen shape, `WARM` seconds of
riding first (with `LEAN` held) so the wake has built, `PRE` for any setting (for example
`window.sandbox.P.sunElevation=55` for midday), and `SEQ` frames at `SEQDT` seconds apart from
`SEQCAM` for checking motion (a continuous effect must not flicker from frame to frame).

## Next

- Phase 2: the drawing clock for every effect; speed lines; effect sheets in place of the
  procedural flashes and spray (art/fx-sheets).
- Phase 3: moments (impact frames on big landings, the painted still, title cards, the
  eyecatch); the glow is in.
- Phase 4: Skytide's own painted skies and clouds per time of day: golden hour is in (set G);
  midday (M) and night (N) to come, night with the streams glowing as aurora. Stratus decks drawn
  as decks, with G3's stratus square on top.
- Phase 5: the rider and board designs (art/model-sheets), replacing the placeholders.
- A three-quarter camera that swings out on carves so you see your wave.
