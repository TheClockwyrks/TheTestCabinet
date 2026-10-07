---
title: Blender binaries
description: >-
  The headless-Blender authoring channel for the blender-character,
  blender-prop and blender-mechanism asset kinds. Covers build.py as the
  recorded trace, the seeded blender.config.json, bpy mesh, armature, weights
  and Actions, the weapon_socket convention, and the glTF 2.0 output contract.
---

The Blender asset kinds `blender-character`, `blender-prop`, and
`blender-mechanism` author their asset by driving headless Blender through its
Python API and exporting a native glTF 2.0 the way a game consumes it. The model
scripts Blender with `bpy` and the run emits a standard glTF rather than a
Test-Cabinet-specific format. All three share one authoring channel, a `build.py`
run through `tcab-blend`, and differ in what they produce:

- `blender-character` produces a rigged, animated skinned character: one
  continuous skin bound to a skeleton that deforms across its joints, exported as
  a skinned, animated glTF.
- `blender-prop` produces a static hard-surface model such as a weapon, crate, or
  pickup: an unrigged glTF with no armature, skin, or animations.
- `blender-mechanism` produces a rigidly-articulated model such as a turret,
  blast door, or crane: separate parented parts posed about their pivots and
  animated as native glTF node-hierarchy clips.

A Blender case asks for the industry-standard content pipeline: hand-authored
topology whose edge loops deform cleanly at the joints, a hand-built armature,
weights the author controls, and real object parenting with keyed transforms. The
emitted glTF is authoritative, and it is judged the way a game engine consumes
it rather than as a replay of the authoring steps.

## The three kinds

All three are authored the same way and emit a native glTF. They differ in the
rig they carry and whether they animate:

| `asset_kind`        | authoring                                | `[model]` animations | emitted glTF    | viewer               |
| ------------------- | ---------------------------------------- | -------------------- | --------------- | -------------------- |
| `blender-character` | mesh + armature + skin weights + Actions | required             | `character.glb` | skinned, clip picker |
| `blender-mechanism` | parented parts + Actions on transforms   | required             | `model.glb`     | rigid, clip picker   |
| `blender-prop`      | geometry alone, no rig                   | forbidden            | `model.glb`     | static turntable     |

A `blender-prop` declares no `[model]` table. Its `build.py` builds geometry
alone, with no armature and no Actions, and the runner emits an unrigged
`model.glb`. The browser renders it as an auto-rotating turntable.

A `blender-mechanism` requires a `[model]` table of required animations,
declared exactly as the character's, and articulates rigidly. Its `build.py`
builds each moving part as its own object, parents them into a hierarchy so that
posing a parent carries its children, and authors motion by keying the part
objects' transforms as `bpy` Actions on object rotation and location. The export
bakes these into standard glTF node animations, so the emitted `model.glb` plays
natively with no skin. This is the right read for a turret or a door.

The rest of this page describes the shared channel. Where a character builds an
armature and binds weights, a mechanism builds and parents objects, and a prop
does neither. A character and a mechanism author Actions; a prop authors none.

The animated kinds also carry a runtime-drivable interface: the caller DOFs a
game sets each frame to aim the asset, such as `turret_yaw` or `aim_pitch`, baked
into the glTF's node `extras`. See
[Runtime control](#runtime-control-caller-dofs-and-node-extras).

## The authoring channel

The run container `test-cabinet-blender` ships headless Blender on `PATH`, a thin
runner `tcab-blend`, and a bundled glTF export helper. It is built on
`ubuntu:26.04` rather than the shared base, because Ubuntu packages a modern
Blender (5.0.x) for both amd64 and arm64, so the same Blender version ships on
both architectures. The model authors one Blender Python script, `build.py`, and
runs it through the runner:

```
tcab-blend                    # config defaults to ./blender.config.json
tcab-blend my.config.json     # or an explicit config path
```

The runner execs Blender in background mode on the model's script, passing the
seeded config after a literal `--`:

```
blender --background --factory-startup --python-use-system-env \
        --python build.py -- <CONFIG>
```

`--factory-startup` gives a clean, reproducible Blender with no user
preferences, and `--python-use-system-env` lets the bundled Python resolve the
export helper from the image's `PYTHONPATH`. `tcab-blend` is the only sanctioned
build path. The recorded authoring trace is `build.py` itself, declared as
`[output].actions` and re-run for [provenance](#validation).

## The `build.py` authoring model

Everything the model builds, it builds by editing and running `build.py`. Using
Blender's `bpy` module, the script:

1. Loads the seeded [`blender.config.json`](#the-seeded-config) from the path
   passed after `--`, falling back to the file in the working directory. It
   carries the bounding box, the axes, the output paths, and the required
   animation and DOF names.
2. Clears the default scene, so the export contains only what the script builds.
3. Builds the body mesh: the character and any permanently-worn gear as one
   mesh, using `bpy.data` or `bmesh` or the primitive operators, colored with
   vertex colors or materials.
4. Builds the armature: an Armature object whose edit-bones form the skeleton
   hierarchy, including any [`weapon_socket`](#the-weapon-socket) attach bone.
5. Binds the skin weights as vertex groups per bone, whether automatic bone-heat
   weights through `bpy.ops.object.parent_set(type='ARMATURE_AUTO')` or
   hand-authored, capped and normalized so each vertex's influences sum to one.
6. Authors one [Action](#animation-actions) per required animation: F-curve
   keyframes on the pose bones.
7. Exports via the bundled helper.

A case seeds a starter `build.py` with this pipeline stubbed out, as its own
`[[spec]]` landing at the run root, so an author sees the whole shape and fills
in geometry, rig, weights, and motion. Because `build.py` is both the authoring
surface and the provenance artifact, it must be self-contained and
deterministic: it has to rebuild the asset from the seeded config alone.

## The seeded config

`tcab seed` writes `blender.config.json` next to the workspace, so neither the
script nor the runner needs any flags. It carries:

- `bounds` — the bounding box the asset must fit within (`width` across,
  `height` the standing height, `depth` front-to-back, in world units), taken
  from the case's `[voxel]` table.
- `up_axis` and `forward_axis` — Blender's native authoring space, `z` up with
  the asset facing `-y`, which is Blender's front view. `build.py` runs inside
  Blender, so the config names the space the model builds in. The bundled export
  runs the glTF exporter with `export_yup=True`, converting the scene to the
  emitted glTF's +Y up and +Z forward, matching the rest of the voxel and mesh
  family. Build Blender-native and let the export convert; pre-rotating to +Y up
  makes the export double-apply the rotation and lay the asset on its back.
- `background` — the clear color behind the rendered preview.
- `mesh` and `preview` — the emitted glTF path (`character.glb` or `model.glb`)
  and the preview PNG path.
- `build_script` — the path of the authored script.
- `animations` — the required animation names, with their `loop` and `auto_play`
  intent, taken from the case's `[model]` table.
- `joints` — the required caller DOFs, taken from the case's `[[model.joint]]`
  entries, with rotation limits in radians.

## Runtime control: caller DOFs and node `extras`

A game consumes a rigged asset two ways, and both are self-contained in the
emitted glTF with no sidecar and no custom glTF extension.

Every authored Action becomes a named glTF animation clip. A game triggers
`reload`, `fire`, or `deploy` by name on demand, through standard glTF animation
played by any engine. This needs nothing beyond authoring the clips.

A caller DOF is what a game sets each frame from its own state, such as aiming at
a target, rather than a baked clip. A case fixes the required DOFs in
`[[model.joint]]` with a name, kind, axis, and `min`/`max`/`rest` limits, and the
model exposes each by building the driven node and tagging it with a Blender
custom property `tcab_joint`:

```python
yaw_obj["tcab_joint"] = {
    "name": "turret_yaw", "kind": "rotation", "axis": "y",
    "min": -2.967, "max": 2.967, "rest": 0.0,   # radians
}
```

The export runs with `export_extras=True`, so each such property lands in that
node's glTF `extras`, a core-spec field that every conformant loader preserves
and surfaces. three.js reads it as `object.userData`. A game finds the node by
the DOF name, reads the axis and limits, and drives the node's local transform,
clamped, each frame. Because the tag lives in the node, the procedural interface
travels with the asset itself.

The axis is named in the emitted Y-up glTF frame, the space a game sees: a yaw
about world-up is `y` and a pitch is `x`, even though the model authors in
Blender's Z-up. Rotation limits in the tag are radians, while the case declares
them in degrees. A caller DOF is owned by the game rather than animated by a
clip, so the required clips move other parts.

The review UI exercises both. It plays each clip from a picker and gives each
caller DOF a slider that drives the node live, so a reviewer aims the turret or
pitches the soldier exactly as a game would.

## The weapon socket

A held weapon is a separate asset rather than part of the skinned mesh. As with
the skinned binaries' first-person
[viewmodels](/testing/asset-generation/skinned-binaries/#first-person-viewmodels),
a weapon hangs on an empty attach bone: a `weapon_socket` bone, a child of the
hand, with no vertex influence. The character's `fire` and `reload` animations
move the hand and the socket, and the game attaches whatever weapon model it
likes to the socket node. The model builds the character and its
permanently-worn gear (helmet, armor, pouches) into the one mesh and leaves the
gun to the socket, so one body holds different weapons.

## Animation Actions

Each required animation is authored as a Blender Action, F-curve keyframes on
the pose bones, named exactly as the `[model]` contract requires. As with every
animated kind, animations are authored in place: a run or walk cycle strides on
the spot and the consuming game supplies world travel. The `loop` and
`auto_play` semantics a case declares carry through to the exported glTF, so a
game plays a looping, auto-playing `idle`, a one-shot `fire`, and a `death` that
holds its last pose.

## The emitted output

The bundled export helper, imported at the end of `build.py`, exports the whole
scene as a binary glTF and renders the preview:

```python
bpy.ops.export_scene.gltf(
    filepath=mesh_path, export_format="GLB",
    export_skins=True, export_animations=True,
    export_extras=True, export_yup=True, use_selection=False,
)
```

It emits two files:

- The glTF at the config's `mesh` path. For a character this is
  `character.glb`, a skinned and animated glTF 2.0 binary carrying one skinned
  mesh (`POSITION`, `NORMAL`, `COLOR_0`, `JOINTS_0`, `WEIGHTS_0`), the glTF skin
  with its inverse-bind matrices and joint list, the bone node hierarchy, and one
  glTF animation per authored Action. A prop and a mechanism export to
  `model.glb`: a prop's scene has no skin or Actions, so its glTF is geometry
  alone, and a mechanism's scene has parented parts and object-transform Actions,
  so its glTF carries node-hierarchy animations and no skin. `export_skins` and
  `export_animations` stay on for all three and are no-ops when the scene has
  neither.
- `model.png`, the 512-pixel-square preview the reviewer sees, rendered with the
  CPU Workbench engine so it works headless. The preview render is best-effort
  and a failure never fails the export.

Core provides both paths; neither is manifest-declared. The model must reach the
export call by running `tcab-blend` before finishing, because the emitted glTF is
what is judged. An un-exported model scores as empty.

## Validation

The `BlenderGenValidator` is authoritative over the emitted file, and it replays
no operations. It:

1. Confirms the emitted glTF, `character.glb` for a character and `model.glb`
   for a prop or mechanism, exists and is a well-formed GLB: the `glTF` magic,
   version 2, and a JSON chunk that parses. A missing or unreadable file is a
   failed load.
2. Confirms it carries at least one mesh. A `blender-character` must also carry a
   skin, a non-empty `skins` array. A prop and a mechanism are rigid, so a skin
   is not required.
3. For the animated kinds it collects the glTF `animations[].name` of every
   animation carrying channels and reconciles them against the required `[model]`
   set. A missing or non-animating one is recorded as a contract-gap note and
   never crashes the run. A prop declares no animations, so this step is skipped.
4. Reconciles the required caller DOFs: each `[[model.joint]]` must be exposed as
   a node whose `extras.tcab_joint` carries that name with the matching kind and
   axis, so a game can find and drive it. A missing or mis-typed DOF is a
   recorded note.
5. Re-runs `tcab-blend` on the seeded `build.py` in a clean temporary directory
   and compares the re-exported glb's summary to the run's emitted glTF: the
   animation-name set, the caller-DOF set, and the mesh and skin counts.
   Divergence is a recorded note. The emitted glTF is authoritative on its own,
   and the re-run only checks that `build.py` faithfully reproduces it. An absent
   runner or Blender is skipped silently.

The summary the validator produces reuses the voxel-family result shape: one
part, named `character` for a character and `model` for a prop or mechanism, the
required animations, and the `skinned` marker set only for a character, so the 3D
viewer skins a character and treats a prop or mechanism as a rigid native glTF.

## Browser rendering

The emitted glTF is rendered in the browser by
[`@clockwyrks/voxel-runtime`](/components/voxel-runtime/overview/) over
three.js, loaded whole and played through a native glTF player. One shared viewer
serves all three kinds:

- A character is skinned, through `THREE.SkinnedMesh` and `Skeleton` with
  linear-blend skinning, so a reviewer can orbit it and scrub each animation with
  real skin deformation.
- A mechanism plays its baked node-hierarchy clips, a three.js `AnimationMixer`
  posing the parented parts, scrubbed from the same animation picker.
- A prop has no clips, so the view auto-rotates the static model as a turntable.
