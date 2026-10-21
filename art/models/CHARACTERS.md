# Tavi and Mara

The baseline character models are the **original Hunyuan3D-2mv models**, with their own surface,
UVs and colour texture: under the game's cel shading and outline they read closest to the
concept sheets. (A rebuilt, rigged pass was tried and set aside: it looked worse.)

| Character | Design height | Source (as delivered) | Runtime asset | Concept |
|---|---|---|---|---|
| Tavi | 1.72 m | [source/tavi.glb](source/tavi.glb) | [tavi.glb](../../assets/models/tavi.glb) | [tavi-original-concept.png](references/tavi-original-concept.png) |
| Mara | 1.82 m | [source/mara.glb](source/mara.glb) | [mara.glb](../../assets/models/mara.glb) | [mara-original-concept.png](references/mara-original-concept.png) |

## Preparing them

    python3 tools/models/characters_prepare.py [--debug]

Python 3 with numpy, scipy, Pillow and pygltflib; no Blender. From each source it:

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

The cel shader (`src/render/cel.js`) blends `_CELN` in before any skinning, so a rig added
later turns it with the head. `CEL.uCelShape` scales it (0: the model's own normals).

## Checking

    cd test
    MODEL=../assets/models/tavi.glb HEIGHT=1.72 SHAPE=1 VIEWS=face,close,quarter,play node model-shots.mjs

renders the model in the game's light, cel shaded and outlined (`SHAPE=0` for its own normals).

## Still to do

- **Rig and poses.** The models are not rigged: they cannot yet replace the placeholder rider,
  who is posed by the game. Their arms are joined to the body under the armpits, so raising
  them (the riding pose) stretches that surface; this has to be solved before or while rigging.
- **Face paint.** The painted eyes are soft; expressions (blink, mouth) need eyes and mouth as
  their own layer.
- **Texture.** The UV layout is about a thousand fragments; good enough as painted, but it
  cannot be repainted region by region.
