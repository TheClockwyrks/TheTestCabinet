---
title: Blender cases
---

The Blender kinds `blender-character`, `blender-prop`, and `blender-mechanism`
are authored by driving headless Blender through its Python API. The model writes
a `build.py` and runs the `tcab-blend` runner, which exports a native glTF and a
`model.png` preview. See the
[Blender binaries](/testing/asset-generation/blender-binaries/).

The emitted glTF is the authoritative, judged output. There is no operation log:
`build.py` is the recorded authoring trace, re-run for provenance. All three
kinds reuse `[voxel]` as a bounding box and differ in what they emit and whether
they animate.

| `asset_kind` | Rig | `[model]` | Emitted glTF |
| --- | --- | --- | --- |
| `blender-character` | skinned (armature + weights) | required | `character.glb` |
| `blender-mechanism` | rigid (parented node clips) | required | `model.glb` |
| `blender-prop` | none (static) | forbidden | `model.glb` |

Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged.

## A character case

A `blender-character` produces a rigged, animated skinned character. Its
`build.py` builds the character mesh, an armature it invents, the skin weights,
an empty `weapon_socket` bone, and one Action per required animation, exporting a
skinned and animated `character.glb`.

```toml
asset_kind = "blender-character"

# The character's BOUNDING BOX — the volume the whole character must fit within, in
# world units (width x, height y-up, depth z; forward is +z). This is the [voxel] table
# reused as a bounds box; `background` is the preview clear color only.
[voxel]
width  = 24
height = 48
depth  = 20
background = "transparent"

# `tcab-blend` runs the model's `build.py` under headless Blender
# (`blender --background --python build.py -- blender.config.json`), exports the glTF,
# and renders the preview. `preview` is a SINGLE file (one mesh — no {part} token).
[tool]
binary  = "tcab-blend"
preview = "model.png"

# The authored `build.py` IS the recorded trace — NOT an op log. The emitted
# `character.glb` is produced by the runner and is not manifest-declared.
[output]
actions = "build.py"

# The required animations, declared by identity alone. The skeleton, weapon socket,
# and weights are the model's to invent.
[model]

[[model.animation]]
name      = "idle"
loop      = true
auto_play = true

[[model.animation]]
name      = "run"
loop      = true
auto_play = false

# The self-contained brief, plus the `build.py` STARTER STUB seeded to the workspace
# root (the path `[output].actions` names) so the model edits it in place.
[[spec]]
source = "specs/brief.md"

[[spec]]
source = "specs/build.py"
dest   = "build.py"
kind   = "script"          # tag it "Script" (not "Spec") on the Inputs tab
```

## The bounding box

`[voxel]` is the asset's bounding box rather than a voxel field: its
`width`/`height`/`depth` in world units, plus a `background` used only as the
preview clear color. It replaces `[canvas]`. Like a voxel case's volume it is a
variant axis, so a variant may declare its own `[voxel]` to author the same
subject at another size.

## Tool and output paths

`[tool].binary` is `tcab-blend` and `[output].actions` is the authored
`build.py`. Both are single files and must not carry a `{part}` token.

Because `build.py` is authored from a seeded starter stub, that stub is seeded as
the case's own `[[spec]]` with `dest = "build.py"`, landing at the run root. This
is the one case where a spec `dest` deliberately coincides with
`[output].actions`. The spec sets `kind = "script"` so the run's Inputs tab tags
the starter as a script rather than a spec, a presentation marker that does not
change how the file is seeded. See the
[end-to-end `[[spec]]` reference](/testing/end-to-end/manifests/).

The emitted glTF and the `model.png` preview are produced by `tcab-blend` and are
never named in the manifest. The orchestrator seeds a `blender.config.json`
carrying the bounding box, the axes, the output paths, and the required animation
names, which the runner and `build.py` read.

## Required animations and caller DOFs

`[model]` fixes the required animations for the character and mechanism kinds,
each a unique `name`, a `loop` flag, and an `auto_play` flag, exactly as for the
[skinned cases](/testing/asset-generation/manifests/skinned-cases/). The
skeleton, the `weapon_socket` bone, the per-vertex weights, and the keyframes are
all model-invented in `build.py`.

`[model]` also fixes the required caller DOFs: the runtime-drivable joints a game
sets each frame to aim the asset, such as a turret's `turret_yaw` or a
character's `aim_pitch`. They are declared as optional `[[model.joint]]` entries;
a prop declares none.

```toml
[[model.joint]]
name = "turret_yaw"    # a game drives this by name
kind = "rotation"      # "rotation" | "translation"
axis = "y"             # in the emitted Y-up glTF frame (yaw=y, pitch=x)
min  = -170.0          # degrees (rotation); world units (translation)
max  =  170.0
rest =  0.0
```

The model builds the driven node and tags its glTF `extras` with a `tcab_joint`
descriptor, through a Blender custom property plus `export_extras`, so the
interface travels in the emitted glTF. A game reads it as `userData`, and the
review UI drives it live. The clips a game plays and the DOFs a game drives are
the two halves of the game-facing contract. See
[Runtime control](/testing/asset-generation/blender-binaries/#runtime-control-caller-dofs-and-node-extras).

## Props and mechanisms

The other two Blender kinds share the character's shape, the `[voxel]` bounding
box, the `tcab-blend` tool, the `build.py` output, and the seeded starter stub.

A `blender-prop` is a static hard-surface model such as a weapon, crate, or
pickup. It declares no `[model]` table, and its `build.py` just builds geometry.
The runner emits an unrigged `model.glb`. The validator confirms a well-formed
glTF with at least one mesh.

A `blender-mechanism` is a rigidly articulated model such as a turret, door, or
crane. Its `build.py` builds separate parented parts and authors motion as object
transforms, exported as native glTF node-hierarchy animations rather than skin
deformation. It requires a `[model]` table of required animations, declared
exactly as for the character, and emits `model.glb`. The validator reconciles the
emitted glTF's animations against the required set and requires no skin.

```toml
# A static prop: no [model], emits model.glb.
asset_kind = "blender-prop"

[voxel]
width  = 8
height = 16
depth  = 48
background = "transparent"

[tool]
binary  = "tcab-blend"
preview = "model.png"

[output]
actions = "build.py"
```

```toml
# A rigid mechanism: [model] required (node-hierarchy clips), emits model.glb.
asset_kind = "blender-mechanism"

[voxel]
width  = 24
height = 30
depth  = 24
background = "transparent"

[tool]
binary  = "tcab-blend"
preview = "model.png"

[output]
actions = "build.py"

[model]

[[model.animation]]
name      = "idle"
loop      = true
auto_play = true

[[model.animation]]
name      = "fire"
loop      = false
auto_play = false
```
