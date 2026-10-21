# Tests

The scripts used to check Sky Tide while building it: pictures for judging the look, and traces
and fuzzers for the riding physics. Most are one-off investigations, kept for the record; the
ones still in use are below. They run against the game in the folder above this one.

## Setup

    cd test
    npm install
    npx playwright install chromium

The browser scripts launch Chromium with SwiftShader (software GL), as in the cloud workspace
they were written in, so their pictures match from machine to machine. On a Mac with a GPU you
can drop the `--use-angle=swiftshader` flags in a script's `chromium.launch` for speed. The noise
bank the physics scripts need is generated once into `cache/`. Pictures go to `shots/` unless
`OUT` says otherwise; both are ignored by git.

## The ones in use

| Script | What |
|---|---|
| `look-shots.mjs` | The same moment from several cameras, for judging the look (see ART.md, "Checking a change"): `SHOTS=chase,front,side,wide,three,threeL,low`, round the nearest cloud (`cloudFar`, `cloudNear`, `cloudEdge`, `cloudIn`, `cloudDeep`, `cloudOrb0..2`, `cloudMid`, `cloudLit`), round the sky (`sun`, `anti`, `joinL`, `joinR`, `sea`, `seaFar`, `seaLow`, `seaLowSun`), on the nearest island (`islNear`, `islUnder`, `islTop`, `islFar`). `ROOT` for another build (before/after), `WARM` seconds of riding first with `LEAN` held, `PRE` for any setting, `SEQ` frames for motion, `ASPECT=4:3`. |
| `fx-breakdown.mjs` | The board's effects one at a time (wave, spray, flashes, sparks, glow, route trail, motes, streams). |
| `model-shots.mjs` | A glTF model in the game, cel shaded and outlined as the rider is, in the game's light: `MODEL=x.glb KIND=char|board`, `HEIGHT`/`LENGTH`, `PAINT=texture|flat|raw` (flat: its texture's colours gathered into a few flat paints), `VIEWS=front,quarter,side,back,top,under,close,face,play`. |
| `rider-shots.mjs` | The rider's own models in the game, posed, close up: `CHAR=Tavi|Mara BOARD=Skipper|Kestrel STATES=ride,crouch,carveL,carveR,tail,walk,sky,dive VIEWS=front,back,nose,tail,three,chase`. |
| `orbit-seq.mjs` | Round a cloud in small steps (`N`, `STEP` degrees, `DW` widths off), the world held still: for spotting pops. |
| `perf-pass.mjs`, `perf-frame.mjs` | Where a frame's time goes, pass by pass. |
| `cf-test.mjs`, `far-isl-test.mjs` | The cloud field, and the far islands' query. |
| `fuzz.mjs`, `fuzz-big.mjs`, `foot-fuzz.mjs`, `net-fuzz.mjs` | Physics fuzzers: random riding for NaNs, tunnelling and stuck states. |
| `world-test.mjs`, `stream-stats.mjs`, `island-stats.mjs` | The world's numbers: streams, islands. |
