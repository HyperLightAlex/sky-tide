# Skytide sandbox

A browser sandbox for tuning the core mechanic: surfing on the sky. The sky has two engines:

- **Weather**: wind, water clouds and storms. Scenery and conditions. Clouds never hold you.
- **Trapar**: the ridable medium. It grows like a **root system**: trunks (pairs of strands
  flowing opposite ways), knots where three trunks meet, and roots, rootlets and tendrils
  filling the cells between them. Three such root systems are stacked as **layers** (tangle,
  main, crown), with **connectors** (updrafts, chutes, ramps, drops) crossing between them
  everywhere. The streams move like water (rolling waves, slosh, rapids), but their courses are fixed:
  nothing you ride changes shape beyond its water.

"Skytide" is a working name. In code, everything uses neutral terms, so renaming the lore
costs nothing.

## The look

Drawn like a mid-2000s TV anime: cel-shaded rider and islands with ink lines, painted clouds
and sky, translucent blue streams, and the green trapar wave your board throws up. How each
piece is built: [ART.md](ART.md). The briefs for the painted art (skies, effects, islands, the
rider and board, key art), to be made by an image model: [art/README.md](art/README.md).

## Run it

The page uses ES modules, so it needs to be served over HTTP (opening the file directly
will not work):

```
cd skytide
python3 -m http.server 8000
# then open http://localhost:8000
```

three.js and lil-gui load from jsDelivr via the import map in `index.html`.

## How it is built

```
index.html                page shell, HUD styles, import map
src/config.js             every tunable constant, with ranges and panel folders
src/main.js               wiring and the fixed 120 Hz simulation loop
src/math/v3.js            small vector math (no three.js dependency)
src/sky/noise.js          tileable noise volumes (generated at startup, in workers)
src/sky/noiseWorker.js    worker that generates noise slices in parallel
src/sky/common.js         hashing and helpers shared by both engines (JS and GLSL)
src/sky/sky.js            SkyWorld: weather + trapar updated together; shader glue
src/weather/weather.js    WEATHER ENGINE: wind, clouds, storm scheduling, turbulence
src/weather/weather.glsl.js
src/trapar/network.js     THE NETWORK: the three layers, their altitude fields, connectors
src/trapar/layer.js       one layer: nodes, trunks, face loops, knots, roots, islands' docks
src/world/islands.js      floating islands: shape, ground and rock queries, names
src/trapar/connectors.js  vertical connectors between layers, per world cell
src/trapar/braids.js      snapshot of the network around the rider; density evaluation
src/trapar/braids.glsl.js the same evaluation in GLSL
src/trapar/braidWorker.js builds the next snapshot in the background; plans routes
src/trapar/route.js       route planning over the snapshot's bands (graph + A*)
src/world/guide.js        route guidance: keeps a route up to date, says what to do next
src/trapar/trapar.js      TRAPAR ENGINE: density, flow and features (wraps the network)
src/trapar/trapar.glsl.js
src/rider/rider.js        rider physics: surface-locked riding, air, catches, boost; on foot
src/input/input.js        gamepad first, keyboard fallback
src/render/pipeline.js    scene pass, sky pass, composite, effects, tone map
src/render/streamMesh.js  streams drawn as meshes (instanced segments bent onto the skin)
src/render/trailView.js   the route trail (chevrons) and the next-maneuver ring
src/render/shaders.js     sky colour, sky pass (clouds; streams when ray marched), ink, composite
                          (painted clouds), tone map, slice, motes
src/render/motes.js       trapar motes that stream with its flow
src/render/riderView.js   rider and board, on-foot poses, green sparks, markers, route beam, overlays
src/render/wakeView.js    the board's wake: the trapar wave, white water, takeoff and catch flashes
src/render/cel.js         cel shading (characters and backgrounds) and the characters' contour lines
src/render/painted.js     the painted assets (skies, cloud cards, cloud sea) and unTone
src/render/cloudView.js   painted cloud cards, the cloud sea, puffs and mist inside a cloud
src/weather/cloudField.js the clouds as things: heaps in the moving air, their lives and volumes
src/world/paintedSets.js  the painted sets: skies, cloud cards (rectangles, outlines), surfaces (generated)
tools/bg/build_painted.py builds the painted sets from art/sky-sheets (Zenith GP's cutting, cut joins)
tools/bg/build_islands.py builds the island art from art/island-sheets (ground, rock, far islands)
src/world/islandArt.js    the island art: ground and rock sheets, far-island cards (generated)
assets/painted/           painted sets: golden/ (Skytide's own) and Zenith GP's Helios and Meridian (for now); islands/
src/render/islandsView.js island meshes near the camera, painted from the island sheets
src/render/camera.js      chase camera; orbit camera on foot
src/debug/hud.js          heads-up display and conditions
src/debug/panel.js        tuning panel
```

The weather, trapar, islands, rider and noise modules do not import three.js. They run the same in a
browser, a worker, Node tests, or a future game server.

### Pure functions

Density, flow and cloud cover depend only on position, sky time, the world seed, the
parameters and the list of storms. Nothing is simulated or stored, so the renderer and the
physics agree exactly, and every client computes the same sky.

### The network

- **Nodes**: a jittered honeycomb, so every node joins exactly three trunks and the cells
  between trunks (faces) are irregular hexagons about 2.4 km across.
- **Trunks**: each trunk is a pair of strands flowing opposite ways, side by side (about 48 m
  apart), now and then twined once round each other. Each strand belongs to the face on its
  side: the strands round a face join into one closed loop that circulates round it, so
  neighboring loops run past each other in opposite directions. Riding a loop you can always
  hop across to its twin (the gap between the wall lips is about 20 m) to go back.
- **Knots**: near a node the strands of each trunk splay apart into an eye and each loop turns
  its corner round the node. Three connectors cross the middle, weaving over and under each
  other: each takes you off one loop just before its corner and onto the trunk you could not
  reach by staying on it.
- **Roots** fill every face, in three sizes, the narrower the faster:
  - **roots** span the face from trunk to trunk through its interior (sagging or arching
    between their ends), or fuse into another root; some have spiral loops;
  - **rootlets** reach across to another root or trunk, wrap round their root (over and
    under it), or end in a **drop**: a straight kicker that ends in the air above a lower
    stream running the same way, for you to land on; some have corkscrews or short gaps (with a
    kicker before and a lower landing after);
  - **tendrils** do the same at a smaller scale; some are round cords.
  Wherever two would meet, the later one lifts over or dips under the other (a weave), so
  nothing passes through anything.
- **Lanes**: a branch leaves or joins its host through a lane. It starts lying flat on the
  host's floor (over the floor's edge, covering the flattened shelf on that side), then slides
  off sideways while its outer wall curls up; the host's wall and the branch's inner wall curl
  back up together, so they part as a V. You choose by steering.
- **Speed**: each size has its own flow (trunks 14, roots 18, rootlets 22, tendrils 26 m/s),
  and faster streams carry you faster (`cruiseFromFlow`).

### Layers

Three root systems are stacked, each on its own altitude field:

- **tangle** (lowest): tighter cells (0.75 x), slower streams, denser hanging roots, more
  wraps and cords. Below it there is only the floor.
- **main**: the reference network.
- **crown** (highest): wide cells (1.35 x), faster streams, long sweeping meanders, more spiral
  loops and drops, fewer tendrils: open sky.

The fields drift up and down together (a warp over about 17 km), each layer rolls on two
scales of its own (the tangle in tighter, lower swells, the crown in big slow ones), and in
places neighboring layers pinch together (`layerPinch`), never closer than `layerMinGap`
(180 m). Typical spacing is `layerGap` (430 m), from about 190 m to about 700 m. Each layer's
lattice is turned and shifted so the cells of different layers never line up. A layer's roots
and knots stay on its side of the midline to each neighbor (their sag is limited where layers
pinch), so layers never tangle.

### Connectors

The world is divided into connector cells (`connectorCell`, 2.8 km). Each cell, for each pair
of neighboring layers, gets `connectorsPerCell` connectors of mixed kinds (the `...Mix`
weights), so there are ways up and down everywhere:

- **updraft** (gold): a narrow, fast stream that flows up, in a cascade of steep surges (about
  0.75 grade) and short flat ledges. It pushes you up hard (`updraftDrive`); each crest is a
  place to pop off for air.
- **spiral updraft** (gold): a tight corkscrew (70-110 m radius, banked hard) climbing through
  the open air between layers.
- **chute** (violet): a steep, deep-walled plunge (up to about 0.6 grade) from a stream of the
  upper layer onto one of the lower, eased in and out.
- **ramp** (pale): long and gentle (under 0.14 grade) either way; straight across where the
  layers pinch together, else a wide spiral.
- **drop**: a stream of the upper layer that ends in a kicker, aimed so that launching off it
  at its cruising speed you fall onto a straight, level stretch of the layer below.

Every connector leaves its first host through an exit lane and joins its last through a merge
lane, kept clear of other lanes on both sides of the host. A cell's connectors stay inside the
cell, so cells never interfere and the result never depends on the order they are built in.

### Falling

In the air the stick does what it always did: lean spins the board and pushes you a little
sideways (`airSteer`), forward and back flip it. Long falls level off at about `terminalSpeed`
(60 m/s): gravity fades out as you approach it.

**Free fall** is a state: once you have been in the air `fallAfter` (0.4 s), falling faster than
`fallSpeed` (12 m/s) with no landing within `fallClear` (1.2 s) (or nothing below at all), you
are in free fall until you land (the HUD says so). In free fall **boost flies you**: it thrusts
level along the board's nose (`fallThrust`, up to `fallBoostTop`, 50 m/s), slows a fast fall
down to a glide sink of `fallSink` (6 m/s, never a climb), and the flight turns to follow the
nose. While flying, lean turns the nose (`fallAim`) and banks the board, stick forward dives
(faster, sinking more), back flares (slower, sinking less), and the camera swings behind the
nose. Flying uses the gauge at `fallDrain` (0.6 x), so a full gauge flies you about 7 s, a few
hundred meters. The boost target shows the stream it can reach (its middle); let go of boost
once the landing marker sits on it. Out of free fall (short airs) boost still adds level speed
the way you are going.

A clean catch keeps most of the fall as speed along the stream (coming down straight, along
the stream the way the board points), up to `catchCap` (60 m/s). Streams hold you under
`holdCap` (62 m/s), so a chute cannot run away with you.

### Islands and going on foot

Floating islands (`src/world/islands.js`) are solid landmasses: a gently rolling grassy top (the
ground) over a rocky underside that hangs to a point, with a wobbly outline. They are placed per
network face from its nodes alone (so they are cheap and known everywhere, `Layer.islandsOf`):
some in a layer (`islandChance`, deep inside the face, clear of its trunks), some between two
layers (`islandBetween`). Their undersides stay clear of the layer below. Every root and
connector keeps clear of them (their probes join the clearance index), and each island in a
layer gets **docks**: a stream from the face's loop that runs up onto its ground and ends there
(it slows you to `dockArrive` so you step off at a jog), one rising out of its ground that runs
off its rim and joins the loop, and sometimes a **launch lip** that kicks you off the rim over a
stream below.

On your board, meeting an island's ground steps you off (a roll if you are fast); its sides and
underside stop you. The landing marker shows island ground too (white).

On foot (`mode: 'foot'`) you walk (`walkSpeed`), run (boost held, `runSpeed`) and jump on an
island's ground; walk off the edge and you fall. Press the board button (Y, or X on the keyboard)
while riding or in the air to jump off your board: you skydive as yourself, up to `skyTerminal`
(A held dives head first, `diveTerminal`), the stick moving you where you fall (`skyDrift`) while
the board's momentum fades. Streams do not hold you without your board: you fall through them.
Press the button again in the air and the board flies to your feet (`summonTime`); you are on it,
falling, and in free fall boost flies you. On an island, press it standing on a dock to step onto
the stream. Landing on your feet is always safe; landing harder than `rollSpeed` rolls you.

**Routes** (D-pad right / N): a gold beam marks an island 1.5-4.5 km away (`routeMin`,
`routeMax`) and a clock runs until you stand on it (best times are kept for the session). I
takes you to the nearest island on foot, for testing.

A **trail** shows a way there through the network: gold chevrons flowing along the streams to
ride, orange up an updraft, violet down a chute, white-blue where you drop, sky blue where you
fly, and a ring at the next maneuver (upright to ride through, flat to fall through). Where
something is in front of it (a drop straight through the stream you are on), it shows faintly.
The card at the top says what to do next and how far: take the branch on the left or right,
ride the updraft, jump off and drop to the stream below (then call your board), jump off and fly
(call your board, boost), drop onto the island, ride the dock onto it.

The route is planned in the snapshot worker (`src/trapar/route.js`) over the bands of the
current snapshot: a graph with nodes along every band (every 36 m where it is ridable), edges to
ride on along the flow, to cross to a band running alongside (branches leaving and joining in
their lanes, knots, connectors, docks), to drop off (jump off the board, steer down as you fall
through streams, call the board above the one you want: reach from `skyDrift`, `skySteer` and
`skyTerminal`, planned with a margin), and to fly (boost in free fall, about two thirds of a
gauge). Landings only go onto a floor facing up with stream ahead (no tips, twists, pipes). A*
by estimated time finds the fastest route; one much slower than going straight there is cut
short to the closest approach (marked "planning ahead as you go"), since the streams near a far
island only come into the snapshot as you get closer. The guide (`src/world/guide.js`) tracks
where along it you are and plans again when you leave it, when a short route runs out, as the
snapshot moves, and after a respawn. It plans from wherever you are: riding, in the air (on the
board or off it), or on foot on an island (walk to a dock, or off the edge).

### Water

The streams are streams of waves. Every channel's surface is displaced along its up, evaluated
the same way in the physics (JS) and the shader (GLSL):

- **Swells**: long waves, always there, rolling downstream at `swellSpeed` x the trunks' flow
  plus `swellSpeedAdd` (34 m/s, a little faster than you cruise). `swellHeight` (3.5 m) and
  `swellLength` (120 m) on trunks; the waves are smaller on smaller streams (roots 0.65 x,
  rootlets 0.4 x, tendrils 0.25 x). They are peaked (sharp crests, flat troughs), and patches of
  bigger and smaller ones drift across the sky. On a swell's face, going within a few m/s of its
  speed (tuck, pump or boost to get there), it carries you along at its speed (`swellPush`).
- **Rollers**: half as long, `rollerHeight` (1 m), rolling at the trunks' flow (14 m/s), so
  you ride up and over one every few seconds: pump down their faces.
- **Chop**: short ripples (`chopHeight`, a quarter of a swell long).
- **Slosh**: bends set the water rocking from wall to wall (`sloshHeight` at the walls, period
  `sloshPeriod`); it builds through a bend and dies away over a few hundred meters after.
- **Rapids**: stretches (`rapidsChance` per 280 m section on rootlets and tendrils, half that
  on roots) of standing humps `rapidsSpacing` apart, `rapidsHeight` high, building through the
  stretch with one double-height hump (a kicker) near its end. At normal speed they rattle you;
  fast, or with a pop on a crest, they launch you. Chutes run white where they are steepest.

Every stream's waves travel at the same speeds and are a function of where along them a point
is (`sw`, see `bandWater` in braids.js), so a branch lying in its host's lane carries exactly
the host's waves and eases to its own size as it leaves; its middle is stretched a little so it
meets the host it joins in step too. Waves pull at you over a crest by your speed relative to
the wave, not over the ground. The water calms over about 100 m near kickers and tips, on
cords, wraps, in corkscrews, spiral loops and barrels (where you need all your hold). Riding,
you move with the surface, so a pop off a rising face goes higher. Crests are shaded paler and
troughs deeper (`waveShade`); white water breaks just ahead of the big swells' crests, lightly on
rollers, on rapids and where slosh runs up a wall. The water's clock repeats every hour.

The network is built per face (its loop, then its roots, largest first, each checked for
clearance against everything already there) and per knot, deterministically from the seed and
the parameters, and cached. Only faces near the rider (4.5 km) get their roots; farther faces
show their trunks and knots. Connector cells are built around the rider too (once a cell is
built its connectors stay). Around the rider the bands become a snapshot of short segments
(each a smooth curve with the band's true tangents at its ends, so neighbors meet seamlessly;
straight, uniform stretches merge into longer segments) and a 3D grid listing the segments in
each cell. Physics reads the snapshot directly; the shader reads the same arrays as float
textures. Snapshots are built in a worker: the first one (with roots close by only) while the
noise is generated, then the full one, later ones ahead of time as you move, and after tuning
changes. While the worker is busy you keep riding the current snapshot. Weather acting on the
network is a next step.

### Test stages

The tuning panel's **Test stage** switches the network: the default three layers, the main
layer only, many connectors, updrafts only, drops and chutes only, pinched layers (closer
together: more short ramps), no features (pipes, barrels, spirals, corkscrews, gaps, twinings,
rapids), many islands, no islands,
calm water (no waves, rapids or slosh), gentle waves, big swells, white water (many more rapids), sparse
roots, dense roots, every rootlet and tendril a cord where possible, and the network with
storms.

### Keep JS and GLSL in lockstep

The density evaluation has a JS version (physics) and a GLSL version (rendering) with the same
math. Any change to one must be made in the other. In testing they agree to within a few
ten-thousandths of a density unit. The stream mesh (`src/render/streamMesh.js`) builds the same
surface directly: each snapshot segment is an instance of a small grid, and the vertex shader
puts it on the segment's Hermite centerline, across the channel's floor and walls (or round a
cord), at the depth where density crosses your current ride threshold, moved by the same water.

### Rendering and performance

Streams are drawn as meshes (`streamMesh`, on by default; off ray marches them in the sky pass
as before, for comparison). Ray marching the streams was most of the frame's GPU time: every
step of every sky pixel evaluated every segment in its grid cell. As meshes they cost a few
hundred thousand triangles (three levels of detail by distance, `streamDetail`, culled to the
view each frame), render at full resolution, and write depth, so clouds, the rider, effects and
the trail sort against them. The sky pass is left with the clouds and skips the trapar band's
small steps.

- **Auto quality** measures GPU time per frame with a timer query where the browser offers it
  (frame time is stuck at the display's refresh rate otherwise) and trades the cloud resolution
  (`resScale`) first, then the whole frame's resolution (`renderScale`), to hold about 60 fps.
  The HUD shows the GPU time.
- **Snapshots** upload only the rows of the stream textures they use (a full upload was tens of
  megabytes, a hitch each time the snapshot moved).
- **The chase camera** stays above the stream's surface (a wave behind you could put it under the
  skin), and the skin between the camera and you thins out, so you are never hidden.

Since v15 the streams are translucent (the anime look: see [ART.md](ART.md)): they are drawn in
their own pass after the clouds and test against the depth of the solid world and the clouds
without writing it. Since v16 the clouds are painted cards with volumes (no ray march: the sky
pass runs only for the ray-marched comparison view), which roughly halved the frame's cost; an
ink pass lines the solid world.
- Physics runs at 120 Hz on the main thread (about 0.4 ms a step riding); snapshots and routes
  are built in a worker.

### Rider model

- **Surface-locked riding**: while you ride, the board stays on the stream's skin (where the
  density crosses the ride threshold) and your velocity follows the surface, so meeting a wall
  carries you up it at any speed. A head-on hit loses the into-wall part of your speed.
- **Leaving the surface**, only for a reason:
  - **pop** (A): you jump.
  - **crest**: the surface curves away faster than gravity plus your hold can follow (lips,
    rims, crests). You launch along your travel.
  - **edge**: the stream ends or you ride off its side.
  - **peel**: on an overhang or underside, gravity is more than your hold.
  - **face**: you reach a face you may not ride (see outside riding).
- **Hold**: riding with a stream's flow fast enough presses you onto it (unbraced up to 0.6 x
  gravity: steep walls and sides, not upside down). **Brace** (RT) adds much more (2 x gravity)
  plus a steady press of its own (1 x gravity): braced and fast you can ride upside down,
  through corkscrews, on barrel roofs and all the way round a cord. The hold meter shows how
  much hold you have against what you need.
- **Outside riding**: a channel's inside (floor, walls, the inside of a barrel) is always
  ridable. Its outside, and a cord's surface, are ridable within `outsideReach` degrees of the
  stream's top (Rider: surface). 180 = all the way round (default), about 60 = tops only, 0 =
  never (cords become pass-through).
- **Gravity**: 22 m/s² (about twice real gravity), 1.3 x that on the way down, so airs are
  short and snappy. A full pop is about 4 m high and 1.2 s long.
- **Cruise**: riding with the flow, a stream pushes you up to about 28 m/s on a trunk, more on
  narrower, faster streams (about 40 m/s on a tendril, 50 on an updraft). The crown's streams
  are faster and the tangle's slower.
- **Surf steering**: the stick swings the nose around the tail and the fins pull your travel
  after it (draw). LT snaps: fast nose, big slide, speed cost. Slow boards pivot, fast boards
  rail. A board traveling tail first swings back around (a revert).
- **Brace in the air** only turns the board: its bottom swings to face where you will come
  down (the predicted landing, else the nearest stream you can reach), and the catch is more
  forgiving. **Lip lock**: braced, going over a wall's lip, the drift away from the wall is
  taken out so you drop back onto it.
- **Tricks**: spins and flips sit on top of the braced orientation. When the landing is close
  and the stick is idle, a part-done spin settles to the nearest half turn and a flip to the
  nearest full one; landing backwards is a revert.
- **Boost** only makes you faster. The gauge fills while riding (faster at speed, with the
  flow, on steep faces, and with clean catches). On a stream (or just off it) boost pushes
  along the stream (not along your travel, so it never drives you up and off a wall), tapering
  toward a top speed; it also adds hold (`boostGrip`) and pulls your travel into line with the
  flow (`boostAlign`). In a short air it adds level speed in the direction you are flying. In
  free fall it flies you where the nose points (see Falling): level, slowing your fall to a
  glide, never climbing.
- **Catch**: landing is scored on board angle versus the surface and heading versus travel.
  Clean catches turn falling speed into forward speed. Hitting a stream side-on (board on edge
  to it) or a bad landing is a crash: you stay on the surface with most of your speed gone and
  a moment without control. Only a board landing upside down passes through (and faces you may
  not ride). `wipeoutThrough` (Rider: catch) brings back passing through on bad landings.
- **Walls are solid**: a move that would cross a wall while riding is caught at the wall and
  you carry on along it (a hard hit loses the into-wall part of your speed), boosting or not.

## Controls

| Controller | Keyboard | Action |
|---|---|---|
| Left stick | A / D, W / S | Swing the nose to turn; forward = weight forward, back = weight on the tail. In the air: spin (and drift sideways) and flip (braced too). Flying in free fall: turn the nose, forward dives, back flares |
| A (hold) | Space | Crouch: pump down faces, charge a pop |
| A (release) | Space | Pop (still braced: stay set on the same stream) |
| LT | Q | Snap (hard back-foot turn); with RT, a cutback |
| RT (analog) | Shift | Brace: more hold and a press onto the surface; in the air, turn the board's bottom to the landing; lip lock |
| B (hold) | E | Boost: more speed. On a stream it pushes along it and holds you on; in a short air, level speed; in free fall, fly where the nose points |
| Right stick | Arrows | Look around |
| View | R | Respawn |
| Menu | Tab | Tuning panel |
| LB / RB | Z | Trapar sense pulse |
| Y | X | Board: jump off it (riding or in the air); on foot, call it back in the air or step onto a dock |
| (on foot) | (on foot) | Left stick / WASD moves you relative to the camera, B / E runs, A / Space jumps (skydiving: hold to dive); right stick / arrows turn the camera |
| D-pad right | N | New route to an island (beacon and timer) |
| | I | Go to the nearest island, on foot |
| X / D-pad left | V / G | Density slice / force arrows |
| D-pad up / down | T / C | Spawn a storm / clear spawned storms |
| | F / P | Freeze sky / pause |
