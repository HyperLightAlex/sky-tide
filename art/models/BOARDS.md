# Skipper and Kestrel

These board assets are self-contained. Load either GLB with a standard glTF 2.0 loader;
no character files, game renderer, textures or external asset services are required.

| Board | Nominal dimensions | Triangles | Runtime asset | Editable source |
|---|---|---:|---|---|
| Skipper | 1.62 m long × 0.48 m body width | 10,968 | [skipper.glb](../../assets/models/skipper.glb) | [skipper.blend](production/skipper.blend) |
| Kestrel | 1.86 m long × 0.40 m wide | 9,608 | [kestrel.glb](../../assets/models/kestrel.glb) | [kestrel.blend](production/kestrel.blend) |

Skipper's side vanes extend its total width to approximately 0.639 m. Kestrel's measured
length is approximately 1.858 m after beveling. Each GLB has 29 meshes and 36 nodes.
The blends retain individual named panels and hardware; exports batch compatible parts
by material within each assembly. Cameras and lights are excluded from the GLBs.

The supplied [Skipper concept](references/skipper-original-concept.png) and
[Kestrel concept](references/kestrel-original-concept.png) are the design references.
The rider illustrations on those sheets guide posing, not attachment construction.

## Coordinates and assemblies

All measurements are meters. GLBs use **+Y up, -Z toward the nose**, with the origin at
the center of the deck contact plane (`Y=0`). Blender sources use **+Z up, +Y toward the
nose**. Root nodes are `Board_Skipper` and `Board_Kestrel`; keep their hierarchy intact.

| Node | Contract |
|---|---|
| `FootHold_Front` | Separate empty pivot at glTF `(0, 0, -0.32)`; extras `role="foothold"`, `foot="L"` |
| `FootHold_Rear` | Separate empty pivot at glTF `(0, 0, +0.32)`; extras `role="foothold"`, `foot="R"` |
| `Fin_Left`, `Fin_Right` | Independent pivots containing their own vane/blade and hinge geometry; extras `role="fin"`, `side` |
| `Wake_Left`, `Wake_Right` | Empty effect sockets; extras `role="wake_socket"`, `side` |
| `Trapar_*` | Individually addressable energy-aperture meshes; extras `role="trapar"` |

Each foot hold contains its complete footbed, cushions, straps and brackets, with no
vertices joined to the deck or the other hold. Rotate or reposition the pivot to move
the whole assembly. Its neutral boot toe direction is **+X**, with **+Y up** in glTF.
Extras include `footbedHeight=0.014`, `nominal_boot_length=0.26` and
`nominal_boot_width=0.11`. The sole contact point is therefore `(0, 0.014, 0)` in hold
local coordinates, above the deck-level pivot.

To follow an animated foot, use an explicit sole frame. If that frame uses +Z toward
the toe and +Y up, the hold orientation is:

```text
holdRotation = inverse(parentWorldRotation) * soleWorldRotation * rotationY(-90°)
holdPosition = parentWorldToLocal(soleWorldPosition)
             - holdRotation * (0, footbedHeight, 0)
```

This assumes unit scale; apply asset scaling consistently before alignment. Solve each
hold independently and retain a neutral transform for times when no foot is attached.
The exported pivots contain no baked animation or constraints.

Wake sockets sit at glTF `Y=-0.035, Z=+0.65`, with `X=±0.187` on Skipper and `X=±0.12`
on Kestrel. They are attachment positions; the consumer chooses effect direction and
behavior. Fin pivots similarly provide editable articulation without prescribing motion.

## Materials and outlines

Materials use `cel_*` names, flat base-color palettes, zero metallic factor and rough
surfaces. They work as ordinary glTF materials; a cel renderer may replace their lighting
while preserving base colors. No textures or baked glow are required.

`Trapar_*` surfaces have a visible painted base and zero baked emission. Drive their light
from runtime state, either through material emission or a separate additive effects pass.
Skipper has four energy surfaces; Kestrel has three. Keep these meshes separately addressable.

Thin paint inlays, seams, cushions and small hardware carry glTF node extras
`skipOutline=true`. An inverted-hull outline renderer should skip those nodes and outline
the main structural forms, avoiding overlapping expanded surfaces. A loader such as
Three.js exposes these extras through `object.userData`.

## Rebuild and validation

Run from the repository root with Blender 5.2 and Python 3:

```sh
blender --background --factory-startup --python tools/models/boards_build.py
python3 tools/models/boards_verify.py
```

On macOS, the Blender executable is commonly
`/Applications/Blender.app/Contents/MacOS/Blender`. The builder authors both boards from
its geometry and palette definitions; it does not read preliminary models or need source
ZIP files. It writes the two blends, GLBs, geometry audit and five preview views per board.
Rebuilding replaces generated outputs, so preserve manual blend edits before running it.

The builder checks closed-part manifold geometry, finite coordinates and triangle budgets.
The standalone Python validator checks exported triangles/normals, independent hold
hierarchies, metadata, energy surfaces and absence of external dependencies or lights.
It updates [boards-audit.json](production/boards-audit.json). No browser or game code is
needed for these checks.

Review `previews/{skipper,kestrel}-{top,side,underside,quarter,binding-swivel}.png` for the
silhouette and construction. The swivel view demonstrates independent +28°/-19° hold
rotation; saved assets return to their neutral mounts. The optional `*-game-board.png`
and `*-game-underside.png` images show an example cel presentation, not a required renderer.
