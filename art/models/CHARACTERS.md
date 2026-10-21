# Tavi and Mara

The baseline character models are the **original Hunyuan3D-2mv models**, with their own surface,
UVs and colour texture: under the game's cel shading and outline they read closest to the
concept sheets. (A rebuilt, rigged pass was tried and set aside: it looked worse.) They are
rigged here from scratch, and the game poses them itself (`src/render/riderModel.js`).

| Character | Design height | Source (as delivered) | Runtime asset | Concept |
|---|---|---|---|---|
| Tavi | 1.72 m | [source/tavi.glb](source/tavi.glb) | [tavi.glb](../../assets/models/tavi.glb) | [tavi-original-concept.png](references/tavi-original-concept.png) |
| Mara | 1.82 m | [source/mara.glb](source/mara.glb) | [mara.glb](../../assets/models/mara.glb) | [mara-original-concept.png](references/mara-original-concept.png) |

## Preparing them

    python3 tools/models/characters_rig.py [--debug] [tavi|mara]

writes the game's models, `assets/models/<name>.glb` (Python 3 with numpy, scipy, trimesh,
shapely, Pillow and pygltflib; no Blender). It prepares each source
(`tools/models/characters_prepare.py`, kept in `tools/models/.cache` between runs) and rigs it.
Preparing:

- stands the model at its design height, feet on Y=0, centred, facing **+Z** (glTF, +Y up);
- drops loose fragments under 50 triangles (Tavi 12 triangles, Mara 38);
- drops the metallic-roughness map and the metal (the cel shader paints its own light) and
  halves the colour texture to 2048 px: about 3.4 MB each, from 16 to 18 MB;
- finds the **face** and the **hair** and stores shaped normals for them beside the model's
  own, as the vertex attribute `_CELN` (xyz the shaped normal, w how much of it to use).

The face is the skin-coloured surface of the head (by hue and lightness, so a mustard collar
is not skin), closed over the painted eyes, brows and mouth, joined to the front of the face,
from the chin up. The chin is the top of a bare neck where there is one (Mara), otherwise
where the skin starts (Tavi's turtleneck). The face's shaped normals point out of a smooth
oval round the head, so the cel shadow falls across it as one clean shape, as a 2005 TV anime
painted a face, instead of breaking up over every sculpted bump. Under the jaw and the neck
keep their own, so there is a shadow under the chin. The hair is the head's surface coloured
like the crown; its normals are smoothed heavily over the hair and lean toward the same oval.
`--debug` draws both on the head from three sides (`previews/<name>-face-mask.png`). What it
found is in `production/<name>-prepare.json`.

The cel shader (`src/render/cel.js`) blends `_CELN` in before skinning, so it turns with the
head. `CEL.uCelShape` scales it (0: the model's own normals). `characters_prepare.py` run alone
checks the preparation (`--debug` for the face masks, `--static` writes the unrigged models).

## The rig

A skeleton of 21 bones (glTF frame: +Y up, facing +Z, the character's left toward +X; `_L` is
the character's left), every bone resting unturned, so the game turns each one simply toward
where its limb should point:

    Hips ── Spine ── Chest ── Neck ── Head
     │                 ├── Shoulder_L ── UpperArm_L ── Forearm_L ── Hand_L
     │                 └── Shoulder_R ── …
     ├── Thigh_L ── Shin_L ── Foot_L ── Toe_L
     └── Thigh_R ── …

**Where the joints are** comes from the model itself, from horizontal sections through it:
where the legs part (the crotch) and the hip joint a little above it; the knee and ankle in the
middle of the leg at their usual heights; the ball of the foot and the toe along the shoe; each
arm followed down from where it joins the body to the fingertips, the wrist at its narrowest
a hand's length up, the elbow at the usual share of the arm, the shoulder joint inside the
sleeve under the top of the shoulder; the neck and head over the chin found when preparing.
Left and right are made the same. `--debug` draws it over the model
(`previews/<name>-skeleton.png`); the positions are in `production/<name>-rig.json`.

**The underarms.** Tavi's puffed sleeves lie against his jacket from the elbow nearly to the
armpit, and the delivered surface runs straight from the sleeve onto the jacket there, so
raising an arm would stretch it into a web. The rig cuts it: along the fold between arm and
body (found as the cheapest way round between the two, where the surface folds inward), and
closes each side with a new surface the two hid between them, the inside of the sleeve
(rounded like it) and the side of the jacket. At rest both lie inside the model, so it looks
as delivered; raised, the arm comes away clean. They are painted the clothes' colour (a spot
added in a free part of the texture). Mara's arms hang free almost to the armpit; she gets
the same, much shorter.

**The weights.** Each arm (the surface joined to its hand below the armpit, and beyond a
tilted plane through the shoulder joint above it, blended across) goes to its arm's bones,
shared across the elbow and the wrist; the rest to the legs (below the hips, blended over the
hip joint) and to the body's bones by height, the face and hair wholly to the head, the top of
each shoulder to its shoulder bone; smoothed a little over the surface (never across a cut),
at most four bones a point. `--debug` paints them (`previews/<name>-weights.png`) and poses the
model a few ways in Python to check (`previews/<name>-poses.png`: rest, riding, arms raised,
a stride, skydiving).

**In the game** (`src/render/riderModel.js`) there are no animation clips: every frame the
character is posed to reach the same targets the placeholder rider was placed by (the hips and
chest, the hands, the feet, where the head looks), fitted to its own proportions: the legs and
arms by two-bone reaching (knees forward, elbows down and back), the feet in the board's foot
holds while riding (`FootHold_Front` for the left foot), the hips lowered if the feet could
not reach, the hips and shoulders turned toward the nose, the shoulders lifting as the arms
rise. The board's trapar paint is drawn again in the effects pass to glow with the ride.
Each model is read as `.glb`, or else as `<name>.gltf.json` (glTF with its data inside, made by
`tools/models/glb_to_json.py`) for hosts that do not serve `.glb`, as the published sandbox.
Pictures from the game: `docs/progress/sky-tide-rig.png`.

## Checking

    cd test
    MODEL=../assets/models/tavi.glb HEIGHT=1.72 SHAPE=1 VIEWS=face,close,quarter,play node model-shots.mjs

renders the model at rest in the game's light, cel shaded and outlined (`SHAPE=0` for its own
normals), and

    CHAR=Tavi BOARD=Skipper STATES=ride,crouch,carveL,carveR,walk,sky,dive node rider-shots.mjs

the rider in the game, posed, close up from the front, three quarters, the nose, behind and the
chase camera.

## Still to do

- **Face paint.** The painted eyes are soft; expressions (blink, mouth) need eyes and mouth as
  their own layer.
- **Texture.** The UV layout is about a thousand fragments; good enough as painted, but it
  cannot be repainted region by region. The delivered texture paints the fold under Tavi's
  arms dark; with the arms raised those strips show.
- **Hands.** One bone each: the fingers do not move.
