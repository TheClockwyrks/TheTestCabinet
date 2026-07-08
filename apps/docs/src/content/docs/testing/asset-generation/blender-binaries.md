---
title: Blender character binaries
description: The headless-Blender authoring channel — build.py as the recorded trace, the seeded blender.config.json, bpy mesh/armature/weights/Actions, the weapon_socket convention, and the skinned + animated character.glb (glTF 2.0) output contract for the blender-character asset_kind.
---

A **`blender-character`** asset-generation run authors a **rigged, animated,
skinned character** by driving **headless Blender** through its Python API. It is a
sibling of the [skinned binaries](/testing/asset-generation/skinned-binaries/) —
the same end product, **one continuous skin bound to a skeleton that deforms across
its joints**, exported as a skinned, animated **glTF 2.0** — but reached through a
completely different authoring channel: not a CSG/signed-distance-field sculpting
binary, but **Blender itself**, scripted with `bpy`.

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
Nothing about the existing kinds changes; a `blender-character` case simply drives a
different tool and emits a standard glTF.

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

- **`bounds`** — the bounding box (`width` along x, `height` along y-up, `depth`
  along z, in world units), taken from the case's [`[voxel]`](#manifest-shape) table,
  that the character must fit within.
- **axes** — **+Y up, forward +Z**, matching the [skinned
  kinds](/testing/asset-generation/skinned-binaries/) and the rest of the
  voxel/mesh family.
- **output paths** — `character.glb` and `model.png`, and the build-script path
  (`build.py`).
- **`animations`** — the **required animation names**, taken from the case's
  [`[model]`](#manifest-shape) table.

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
export_animations=True, export_skins=True)` and renders the preview, emitting:

- **`character.glb`** — a standard **skinned + animated glTF 2.0** binary: one
  skinned mesh (POSITION / NORMAL / COLOR + `JOINTS_0` / `WEIGHTS_0`), the glTF
  **skin** (inverse-bind matrices and joint list), the **bone node hierarchy**, and
  one glTF animation per authored Action. The model **must reach the export call**
  (run `tcab-blend`) for the run to emit anything — an un-exported model scores as
  empty. Core provides the path; it is **not** manifest-declared.
- **`model.png`** — the preview the reviewer sees.

The character must run `tcab-blend` **before finishing**; the emitted `character.glb`
is what is judged, not the steps the script took to build it.

## Validation

The `BlenderGenValidator` is **emitted-file authoritative** — there is **no
op-replay**. It:

1. Confirms **`character.glb` exists and is a well-formed GLB** — the `glTF` magic,
   version 2, and a JSON chunk that parses.
2. Confirms it carries a **skin** (a non-empty `skins` array) and at least one
   **mesh** — a skinned character is present.
3. Collects the glTF `animations[].name` (each with non-empty `channels`) and
   **reconciles** them against the required [`[model]`](#manifest-shape) set — each
   required animation must be present and actually animating. A missing or
   non-animating one is recorded as a **zero-scored contract-gap note** (the same
   pattern as the rig reconciliation for the other skinned kinds); it never crashes
   the run.
4. **Provenance re-run**: it execs `tcab-blend` on the seeded `build.py` in a clean
   temp directory and compares the re-exported glb's **summary** — the
   animation-name set and the mesh / skin counts — to the run's `character.glb`.
   Divergence is a **recorded note**, the Blender analogue of the sprite kinds'
   [cheat-divergence check](/testing/asset-generation/sprite-binaries/) — **not** a
   hard fail. Unlike the sprite kinds (whose drawn PNG is re-derived from the op-log,
   so a divergence between the two is a cheat signal), here the **emitted glTF is
   authoritative** on its own; the re-run only checks that `build.py` faithfully
   reproduces it. It **degrades gracefully** — a recorded note — if the runner or
   Blender is absent.

The summary the validator produces reuses the skinned-character result shape (one
`character` part, the required animations, `skinned: true`), so the 3D viewer treats
the output as a skinned character.

## Browser rendering

The emitted `character.glb` is rendered and posed in the browser exactly as the
other skinned kinds' output is — by
[`@test-cabinet/voxel-runtime`](/components/voxel-runtime/overview/) over
**three.js**, using `THREE.SkinnedMesh` + `Skeleton` and **linear-blend skinning**
so a reviewer can orbit the character and scrub each animation with real skin
deformation. Because it is a standard skinned, animated glTF, no bespoke runtime
path is needed.
