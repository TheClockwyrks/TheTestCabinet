---
title: Blender binaries
description: The headless-Blender authoring channel — build.py as the recorded trace, the seeded blender.config.json, bpy mesh/armature/weights/Actions, the weapon_socket convention, and the native glTF 2.0 output contract for the Blender asset kinds (blender-character, blender-prop, blender-mechanism).
---

The **Blender** asset kinds — **`blender-character`**, **`blender-prop`**, and
**`blender-mechanism`** — author their asset by driving **headless Blender** through
its Python API, exporting a **native glTF 2.0** the way a game consumes it: not a
CSG/signed-distance-field sculpting binary, and not a Test-Cabinet-specific format
like `rig.json`, but **Blender itself**, scripted with `bpy`, emitting a standard
glTF. They share one authoring channel (`build.py` + `tcab-blend` + the export
helper) and differ only in what they produce:

- **`blender-character`** — a **rigged, animated skinned character**: one continuous
  skin bound to a skeleton that deforms across its joints, exported as a skinned,
  animated glTF. It is the Blender sibling of the [skinned
  binaries](/testing/asset-generation/skinned-binaries/) (the same end product,
  a different authoring channel).
- **`blender-prop`** — a **static hard-surface model** (a weapon, crate, pickup): an
  unrigged glTF — no armature, no skin, no animations. The Blender sibling of the
  static [voxel/meshed `-model`](/testing/asset-generation/voxel-binaries/) kinds.
- **`blender-mechanism`** — a **rigidly-articulated model** (a turret, blast door,
  crane): separate parented parts posed about their pivots and animated as **native
  glTF node-hierarchy clips** (not skin deformation, not a `rig.json`). The Blender
  sibling of the rigid [voxel/meshed `-animation`](/testing/asset-generation/voxel-binaries/)
  kinds.

Most of this page describes the shared channel and the flagship `blender-character`;
[The three kinds](#the-three-kinds) below draws out what a prop and a mechanism do
differently.

## Why Blender

The [skinned CSG kinds](/testing/asset-generation/skinned-binaries/) (`mc-skin`,
`sn-skin`, `dc-skin`) build a character by compositing a signed-distance field and
letting bone-heat diffusion weight the extracted mesh. That is a clean, constrained
interface, but it **cannot express** what a real character pipeline gives you:
hand-authored **topology** (edge loops that deform cleanly at the joints),
**hand-built armatures** and **hand-painted / bone-heat weights** the author
actually controls, **IK**, and **shape keys**. `blender-character` exists so a case
can ask for the **industry-standard character pipeline** — the same tools a game
artist uses — and judge the result the way a game engine consumes it: **the emitted
glTF is authoritative**, not a replay of the authoring steps.

It is its **own category** — not voxel, skinned, meshed, paint, particle, or audio.
Nothing about the existing kinds changes; a Blender case simply drives a different
tool and emits a standard glTF. The same argument extends past characters: a **prop**
gives a case the real hard-surface pipeline (clean topology, materials) for a static
model, and a **mechanism** gives it real object parenting + keyed transforms for a
machine — each emitting the **native glTF** a game already knows how to load.

## The three kinds

All three Blender kinds are authored the same way — a `build.py` run through
`tcab-blend`, re-run for provenance, reusing `[voxel]` as a bounding box — and emit a
native glTF. They differ in the rig they carry and whether they animate:

| `asset_kind`        | authoring                                          | `[model]` animations | emitted glTF    | viewer               |
| ------------------- | -------------------------------------------------- | -------------------- | --------------- | -------------------- |
| `blender-character` | mesh + armature + skin weights + Actions           | **required**         | `character.glb` | skinned, clip picker |
| `blender-mechanism` | separate **parented parts** + Actions on transforms| **required**         | `model.glb`     | rigid, clip picker   |
| `blender-prop`      | just geometry (no rig)                             | **forbidden** (static)| `model.glb`     | static turntable     |

- A **`blender-prop`** declares **no `[model]` table** — it is static. Its `build.py`
  builds geometry alone (no armature, no Actions), and the runner emits a native,
  unrigged **`model.glb`**. The browser renders it as an auto-rotating turntable.
- A **`blender-mechanism`** **requires a `[model]`** table of required animations,
  declared exactly as the character's. But it articulates **rigidly**: `build.py`
  builds each moving part as its **own object**, **parents** them into a hierarchy
  (so posing a parent carries its children), and authors motion by keying the part
  objects' **transforms** — `bpy` **Actions on object rotation/location**, not pose
  bones and not skin weights. The export bakes these into standard **glTF node
  animations** (`export_animations=True` captures object F-curves), so the emitted
  **`model.glb`** plays natively with no skin. This is the "wooden puppet" read — the
  right one for a turret or a door, wrong for a creature.

Everything in the rest of this page — the `build.py` model, the seeded config, the
export helper, the preview, provenance — is shared. Where a character builds an
armature and binds weights, a mechanism builds and parents objects, and a prop does
neither; where a character and a mechanism author Actions, a prop authors none.

The animated kinds also carry a **runtime-drivable interface** — the caller DOFs a game
sets each frame to aim the asset (`turret_yaw`, `aim_pitch`) — baked into the glTF's node
`extras`. See [Runtime control](#runtime-control-caller-dofs-and-node-extras).

## The authoring channel: headless Blender + `tcab-blend`

The run container (`test-cabinet-blender`) ships **headless Blender** (on `PATH`), a
thin runner **`tcab-blend`**, and a bundled glTF export helper. Unlike every other run
image it is built on **`ubuntu:26.04`** rather than the shared base, because Blender
publishes no upstream Linux build for aarch64 and Ubuntu is the distro that packages a
modern Blender (5.0.x) for both amd64 and arm64 — so the same Blender version ships on
both architectures. The model authors **one Blender Python script, `build.py`**, and runs
it through the runner:

```
tcab-blend        # execs: blender --background --python build.py -- <config.json>
```

`tcab-blend` is the **only** sanctioned build path. It launches Blender in
background mode on the model's script, passing the seeded config after a literal
`--`. There is **no operation log** and no separate rig-authoring vocabulary —
**`build.py` *is* the recorded authoring trace** (it is declared as
`[output].actions`, and it is re-run for provenance; see [Validation](#validation)).

## The `build.py` authoring model

Everything the model builds, it builds by editing and running `build.py`. Using
Blender's `bpy` module, the script:

1. **Loads the seeded [`blender.config.json`](#the-seeded-config)** — the bounding
   box, the axes, the output paths, and the required animation names — from the path
   passed after `--` (falling back to the file in the working directory).
2. **Clears the default scene** so the export contains only what the script builds.
3. **Builds the body mesh** — the character and any permanently-worn gear as **one
   mesh**, using `bpy.data` / `bmesh` or primitive operators, colored with vertex
   colors or materials.
4. **Builds the armature** — an Armature object whose **edit-bones** form the
   skeleton hierarchy, including any [`weapon_socket`](#the-weapon_socket-convention)
   attach bone.
5. **Binds the skin weights** — **vertex groups** per bone (automatic / bone-heat
   weights via `bpy.ops.object.parent_set(type='ARMATURE_AUTO')`, or hand-authored),
   **capped and normalized** so each vertex's influences sum to one.
6. **Authors one [Action](#animations-are-actions) per required animation** —
   F-curve keyframes on the pose bones.
7. **Exports** via the bundled helper (below).

A case **seeds a starter `build.py`** with this pipeline stubbed out (config loading
wired up, `build_body_mesh` / `build_armature` / `bind_skin_weights` /
`author_animation` marked `TODO`, and the export call at the end), so an author sees
the whole shape and only fills in geometry, rig, weights, and motion. Because
`build.py` is both the authoring surface **and** the provenance artifact, it must be
**self-contained and deterministic** — it has to rebuild the character from the
seeded config alone.

## The seeded config

`tcab seed` writes **`blender.config.json`** next to the workspace so neither the
script nor the runner needs any flags. It carries:

- **`bounds`** — the bounding box (`width` across x, `height` the standing height,
  `depth` front-to-back, in world units), taken from the case's
  [`[voxel]`](#manifest-shape) table, that the character must fit within.
- **axes** — Blender's **native authoring space**: **+Z up**, the character **facing
  -Y** (Blender's front view). `build.py` runs inside Blender, so the config names the
  space you build in, not the finished orientation. The bundled export runs the glTF
  exporter with `export_yup=True`, which converts your scene to the emitted glTF's
  **+Y up, forward +Z** — matching the [skinned
  kinds](/testing/asset-generation/skinned-binaries/) and the rest of the voxel/mesh
  family. Build Blender-native and let the export convert; **do not** pre-rotate to
  +Y-up, or the export double-applies the rotation and lays the character on its back.
- **output paths** — `character.glb` and `model.png`, and the build-script path
  (`build.py`).
- **`animations`** — the **required animation names**, taken from the case's
  [`[model]`](#manifest-shape) table.
- **`joints`** — the **required caller DOFs** (the runtime-drivable joints), taken
  from the case's [`[model]`](#manifest-shape) `[[model.joint]]` entries. See [Runtime
  control](#runtime-control-caller-dofs-and-node-extras).

## Runtime control: caller DOFs and node `extras`

A game consumes a rigged asset two ways, and both are **self-contained in the emitted
glTF** — no sidecar, no custom glTF extension:

- **Clips the game plays.** Every authored Action becomes a **named glTF animation
  clip**. A game triggers `reload`, `fire`, `deploy` by name on demand — standard glTF
  animation, played by any engine (three.js, Unity, Unreal, Godot). This needs nothing
  beyond authoring the clips.
- **DOFs the game drives.** A **caller DOF** — a turret's `turret_yaw`, a character's
  `aim_pitch` — is what a game **sets each frame from its own state** (aim at a target),
  not a baked clip. A case fixes the required DOFs in `[[model.joint]]` (name, kind,
  axis, and `min`/`max`/`rest` limits), and the model exposes each by building the driven
  node and tagging it with a Blender **custom property `tcab_joint`**:

  ```python
  yaw_obj["tcab_joint"] = {
      "name": "turret_yaw", "kind": "rotation", "axis": "y",
      "min": -2.967, "max": 2.967, "rest": 0.0,   # radians
  }
  ```

  The export runs with **`export_extras=True`**, so each such property lands in that
  node's glTF **`extras`** — a **core-spec** field (not the `extensions` mechanism)
  that every conformant loader preserves and surfaces (three.js reads it as
  `object.userData`). A game finds the node by the DOF name, reads the axis and limits,
  and drives the node's local transform — clamped — each frame. Because the tag lives
  **in the node**, the procedural interface travels with the asset itself.

  The **axis is named in the emitted Y-up glTF frame** (the space a game sees): a yaw
  about world-up is `y`, a pitch is `x` — even though the model authors in Blender's
  Z-up (the export converts). Rotation limits in the tag are radians; the case declares
  them in degrees. A caller DOF is **not** animated by a clip — the game owns it — so the
  required clips move other parts.

The review UI exercises both: it plays each clip from a picker **and** gives each caller
DOF a slider that drives the node live, so a reviewer aims the turret or pitches the
soldier exactly as a game would.

## The `weapon_socket` convention

A held weapon is **not part of the skinned mesh**. Exactly as with the [skinned
binaries' first-person
viewmodels](/testing/asset-generation/skinned-binaries/#first-person-viewmodels), a
weapon is an **empty attach bone** — a **`weapon_socket`** bone, a child of the
hand, with **no vertex influence** — that a game hangs a separate weapon asset on.
The character's `fire` and `reload` animations move the hand **and the socket**, and
the game attaches whatever weapon model it likes to the socket node. So the model
builds the soldier and its permanently-worn gear (helmet, armor, pouches) into the
one mesh, and leaves the gun to the socket. This keeps one body able to hold
different weapons and matches the repo's standard socket convention.

## Animations are Actions

Each required animation is authored as a Blender **Action** — F-curve keyframes on
the **pose bones** — and named exactly as the [`[model]`](#manifest-shape) contract
requires. As with every animated kind, animations are authored **in place**: a run
or walk cycle strides on the spot and the consuming game supplies world travel. The
`loop` / `auto_play` semantics a case declares carry through to the exported glTF so
a game plays each animation correctly (a looping, auto-playing `idle`; a one-shot
`fire`; a `death` that holds its last pose).

## The emitted output

The bundled **export helper** (imported at the end of `build.py`) runs
`bpy.ops.export_scene.gltf(filepath=..., export_format='GLB',
export_animations=True, export_skins=True, export_extras=True)` and renders the
preview, emitting (`export_extras` carries the [caller-DOF
tags](#runtime-control-caller-dofs-and-node-extras) into node `extras`):

- **`character.glb`** — a standard **skinned + animated glTF 2.0** binary: one
  skinned mesh (POSITION / NORMAL / COLOR + `JOINTS_0` / `WEIGHTS_0`), the glTF
  **skin** (inverse-bind matrices and joint list), the **bone node hierarchy**, and
  one glTF animation per authored Action. The model **must reach the export call**
  (run `tcab-blend`) for the run to emit anything — an un-exported model scores as
  empty. Core provides the path; it is **not** manifest-declared.
- **`model.png`** — the preview the reviewer sees.

The character must run `tcab-blend` **before finishing**; the emitted `character.glb`
is what is judged, not the steps the script took to build it.

A **prop** and a **mechanism** export through the **same helper** to **`model.glb`**
(the runner picks the name from the config): a prop's scene has no skin or Actions, so
its glTF is just geometry; a mechanism's scene has parented parts and object-transform
Actions, so its glTF carries node-hierarchy animations but no skin. `export_skins` and
`export_animations` stay on for all three — they are harmless no-ops when the scene has
neither.

## Validation

The `BlenderGenValidator` is **emitted-file authoritative** — there is **no
op-replay**. It:

1. Confirms the emitted glTF (**`character.glb`** for a character, **`model.glb`** for
   a prop/mechanism) **exists and is a well-formed GLB** — the `glTF` magic, version
   2, and a JSON chunk that parses.
2. Confirms it carries at least one **mesh**. For a **`blender-character`** it must
   **also** carry a **skin** (a non-empty `skins` array) — a skinned character is
   present. A **prop** and a **mechanism** are rigid, so a skin is **not** required
   (and its absence is expected, not a note).
3. For the **animated** kinds (character, mechanism) it collects the glTF
   `animations[].name` (each with non-empty `channels`) and **reconciles** them
   against the required [`[model]`](#manifest-shape) set — each required animation
   must be present and actually animating. A missing or non-animating one is recorded
   as a **zero-scored contract-gap note**; it never crashes the run. A **prop**
   declares no animations, so this step is skipped.
4. It reconciles the required **caller DOFs**: each `[[model.joint]]` must be exposed
   as a node whose `extras.tcab_joint` carries that name with the matching kind and
   axis, so a game can find and drive it. A missing or mis-typed DOF is a recorded
   contract note (not gated) — the same pattern as the animation reconciliation.
5. **Provenance re-run**: it execs `tcab-blend` on the seeded `build.py` in a clean
   temp directory and compares the re-exported glb's **summary** — the animation-name
   set, the caller-DOF set, and the mesh / skin counts — to the run's emitted glTF.
   Divergence is a **recorded note**, the Blender analogue of the sprite kinds'
   [cheat-divergence check](/testing/asset-generation/sprite-binaries/) — **not** a
   hard fail. Unlike the sprite kinds (whose drawn PNG is re-derived from the op-log,
   so a divergence between the two is a cheat signal), here the **emitted glTF is
   authoritative** on its own; the re-run only checks that `build.py` faithfully
   reproduces it. It **degrades gracefully** — a recorded note — if the runner or
   Blender is absent.

The summary the validator produces reuses the voxel-family result shape: one part
(named `character` for a character, `model` for a prop/mechanism), the required
animations (none for a prop), and the `skinned` marker set **only** for a character —
so the 3D viewer skins a character but treats a prop/mechanism as a rigid native glTF.

## Browser rendering

The emitted glTF is rendered in the browser by
[`@test-cabinet/voxel-runtime`](/components/voxel-runtime/overview/) over **three.js**,
loaded whole and played through a **native glTF player** (a shared viewer serves all
three kinds):

- a **character** is skinned — `THREE.SkinnedMesh` + `Skeleton` and **linear-blend
  skinning** — so a reviewer can orbit it and scrub each animation with real skin
  deformation;
- a **mechanism** plays its baked **node-hierarchy** clips (a three.js
  `AnimationMixer` posing the parented parts), scrubbed from the same animation
  picker — rigid articulation, no skin;
- a **prop** has no clips, so the view **auto-rotates** the static model as a
  turntable.

Because each is a standard native glTF, no bespoke runtime path is needed.
