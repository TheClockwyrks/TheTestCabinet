---
title: Authoring a Blender Character Test Case
---

## Overview

A Blender character ([asset-generation](/testing/asset-generation/overview/),
`asset_kind = "blender-character"`) test case asks a model to build a rigged,
animated, skinned character in Blender, scripted through its Python API, to match
a written brief. The end product is the same as a
[skinned CSG case](/guides/authoring/authoring-a-skinned-test-case/): one
continuous skin bound to a skeleton, exported as a skinned and animated glTF,
authored through a real character pipeline. There is no target model. Authoring
one is writing a precise, self-contained brief, naming the animations the
character must play, and seeding a starter `build.py`.

Read the authoritative pages first:
[Blender character binaries](/testing/asset-generation/blender-binaries/) for
headless Blender and `tcab-blend`, the `build.py` authoring model, the seeded
`blender.config.json`, the `weapon_socket` convention, and the emitted glTF and
preview; [Blender cases](/testing/asset-generation/manifests/blender-cases/) for
the schema, with the `[[model.animation]]` rules documented under
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/); and
[Evaluation](/testing/asset-generation/evaluation/#blender-validation) for how a
Blender run is validated and reviewed.

This guide covers the `blender-character` kind. The static `blender-prop` and
rigid `blender-mechanism` kinds share the same pipeline and are documented in
[Blender cases](/testing/asset-generation/manifests/blender-cases/).

## Blender versus the CSG skinned kinds

Both produce a skinned, animated glTF character. Choose `blender-character` when
the subject needs a real character pipeline.

- The [skinned CSG kinds](/guides/authoring/authoring-a-skinned-test-case/)
  composite a signed-distance field and let bone-heat diffusion weight the
  extracted mesh. The topology, the armature, and the weights follow from the
  field, and there is no IK or shape-key authoring.
- A `blender-character` case gives the model Blender itself: hand-built `bpy`
  meshes with real edge loops, edit-bone armatures, vertex-group weights the
  author controls, and F-curve Actions. The emitted glTF is judged, rather than
  the authoring steps.

Author a `blender-character` case when the subject's credibility depends on real
topology and rigging: clean deformation at the joints, a hand-built skeleton, and
IK-driven limbs. Every Blender character is rigged and animated.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`.
Versioning is per-case and immutable: once a run references a version, that
version is frozen. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, [voxel], [tool], [output], [model]
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # per-version site-facing entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: the character + how the tool behaves (SEEDED)
  specs/build.py         # the starter Blender script (SEEDED to the workspace root)
```

A run receives the selected variant's brief and the starter `build.py`, seeded to
the workspace root, plus headless Blender and `tcab-blend` on its `PATH` and a
pre-seeded `blender.config.json`. That config carries the `bounds`, the
Blender-native authoring axes (`up_axis` `z` and `forward_axis` `-y`, which the
export converts to the family's +Y-up and +Z-forward glTF), the `mesh` and
`preview` output paths, the `build_script` path, the required `animations`, and
any declared caller `joints`. There is no target model, and the skeleton and its
binding are the model's to invent.

Running `tcab-blend` emits `character.glb`, carrying the skinned mesh, the glTF
skin, and one animation per required Action, alongside the preview `model.png`.
Core emits both, and neither is declared in the manifest.

## Procedure

### 1. Choose the subject

Pick a catalog slug for the lineage and the character to build. A good subject is
a body whose credibility rests on real topology and rigging, reads clearly at the
bounding-box size from silhouette and palette alone, and needs no surrounding
game context. A subject a constrained CSG sculpt would serve belongs in a
[skinned CSG case](/guides/authoring/authoring-a-skinned-test-case/). Pick a
`version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md`, a single self-contained file describing:

- the character: what it is, its silhouette and proportions, its orientation in
  Blender-native space (+Z up, facing -Y, which the export converts), the gear
  baked into the body mesh, and how it reads at rest. It fits within the bounding
  box the config carries, so describe the fit in prose rather than hardcoding
  coordinates;
- the exact palette: named opaque `#rrggbb` values, stated as the only colors
  allowed, carried on the mesh as vertex colors or materials;
- the `weapon_socket` rule: a held weapon stays out of the mesh, and the rig
  carries an empty `weapon_socket` bone parented to the hand, with no vertex
  influence, where the game hangs a separate weapon asset;
- the required animations, and how each reads as continuous-skin deformation: an
  `idle` breathing sway, a `run` cycle with opposite-phase legs and
  counter-swinging arms, a `fire` recoil through the shoulder and torso, a
  `death` that holds its last pose. Each is authored in place, and the game
  supplies world travel;
- that the skeleton is the model's to invent. The case fixes which animations
  must exist; the bones, joints, and the vertex-group weights that bind the skin
  are devised at run time;
- how the tool behaves: everything is authored by editing `build.py` and running
  `tcab-blend`, which runs Blender headless on the script. The script builds the
  mesh, armature, weights, and one Action per required animation with `bpy` and
  calls the bundled export helper. The model must run `tcab-blend` before
  finishing so the glTF is emitted. The emitted glTF is judged, and `build.py` is
  re-run afterward for provenance, so it stays self-contained and deterministic.

The self-containment and precise-values rules that govern an end-to-end spec
apply. The shared quality directive (`ASSET_QUALITY_PREAMBLE` in
`crates/core/src/prompt.rs`) is prepended to every asset-generation prompt at
render time, so the brief stays factual.

### 3. Write the starter `build.py`

Author `specs/build.py`, the script the model receives and edits. Keep it
runnable-shaped and well commented so the whole pipeline is visible, and leave
the geometry, rig, weights, and motion as marked `TODO` sections:

- `import bpy`, load the seeded `blender.config.json` from the path after `--`,
  falling back to the file in the working directory, and read `bounds` and the
  required `animations`;
- clear the default scene;
- `TODO` sections for `build_body_mesh()`, `build_armature()` (including the
  `weapon_socket` bone), `bind_skin_weights()`, `tag_interface()` for any caller
  DOFs the case declares, and `author_animation(name)` for each required
  animation;
- drive the pipeline, then call the bundled export helper the container provides,
  `import tcab_blend_export` followed by `tcab_blend_export.export(config)`,
  which exports the glTF and renders the preview.

### 4. Write `prompt.hbs`

A short instruction that points the model at the seeded brief and the starter
`build.py`, tells it to author the character by editing `build.py` and running
`tcab-blend`, and states the hard requirements: build and rig only through
Blender, bake the gear into the mesh, keep the `weapon_socket` empty, author
every required animation so it actually animates, and run `tcab-blend` before
returning. The template renders in strict mode, and the available variables are
`{{workspace}}`, `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{#each specs}}`, `{{time_limit_hours}}`, and
`{{voxel}}`.

### 5. Write the manifest

Author `test-case.toml` per the
[Blender cases](/testing/asset-generation/manifests/blender-cases/) schema. A
Blender character case declares a `[voxel]` bounding box and a `[model]` table of
required animations, with `[tool]` and `[output]` pointing at the Blender
pipeline.

```toml
slug       = "siege-rifleman"
name       = "Siege Rifleman"
difficulty = "hard"
tags        = ["asset-generation", "3d", "blender", "skinned", "character"]
summary     = "Standard-issue Warden infantry, built and rigged in Blender."
description = "description.md"
prompt      = "prompt.hbs"
max_runtime_hours = 2.0
type        = "asset-generation"
asset_kind  = "blender-character"

# Ordered variant list; the first is the default. A root key, so it precedes the
# first table header.
variants = ["variants/base.toml"]

# The bounding box the whole character must fit within, in world units.
# `background` is the preview clear color.
[voxel]
width      = 24
height     = 48
depth      = 20
background = "transparent"

# The Blender pipeline. `preview` is a single file: the character is one mesh, so
# no {part} token.
[tool]
binary  = "tcab-blend"
preview = "model.png"

# The authored script is the recorded trace, re-run for provenance. The emitted
# character.glb and model.png are produced by the runner.
[output]
actions = "build.py"

# The required rig contract: the animations the model must author, by identity
# alone. The case declares no bones, joints, or weights.
[model]

[[model.animation]]
name      = "idle"
loop      = true
auto_play = true

[[model.animation]]
name      = "run"
loop      = true
auto_play = false

[[model.animation]]
name      = "fire"
loop      = false
auto_play = false

[[model.animation]]
name      = "death"
loop      = false
auto_play = false

# A caller DOF the game drives each frame. The model builds a node that realizes
# it and tags that node's glTF extras so a game finds and clamps it. Rotation
# limits are degrees.
[[model.joint]]
name = "aim_pitch"
kind = "rotation"
axis = "x"
min  = -40.0
max  = 40.0
rest = 0.0

# The seeded brief and the starter build.py, both seeded for every variant.
[[spec]]
source = "specs/brief.md"

[[spec]]
source = "specs/build.py"
dest   = "build.py"
kind   = "script"

# The single scoring domain, and the whole review.
[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

Key manifest rules for a Blender character case:

- `[tool]` names `binary = "tcab-blend"` and a single `preview` file with no
  `{part}` token, because the character is one mesh.
- `[output].actions` names the authored script. It is a single file with no
  `{part}` token, and it is the authoring trace rather than an operation log.
  `character.glb` and `model.png` are core-emitted and never named in the
  manifest.
- `[voxel]` is the bounding box. `width`, `height` (up), `depth`, and a
  `background` used as the preview clear color. Material is opaque `#rrggbb`.
- `[model]` fixes the required animations as `[[model.animation]]` entries by
  identity alone: a unique `name`, a `loop` flag, and an `auto_play` flag. It
  declares no bones, weights, or keyframes. A case may also declare
  `[[model.joint]]` caller DOFs, each with a `name`, `kind`, `axis`, and
  `min`/`max`/`rest` limits in degrees for a rotation.
- Seed the starter `build.py` as a second `[[spec]]` with `dest = "build.py"`
  so it lands at the path `[output].actions` names, and `kind = "script"` so the
  Inputs surfaces tag it as a script rather than a prose spec.
- No `[[reference]]`, `[build]`, `[[check]]`, `[canvas]`, `[sheet]`, `[ui]`,
  `[material]`, `[particle]`, or `[audio]`. Resolution rejects each of them.
- `[[domain]]` declares the single `overall` scoring domain, and the case
  declares no review checklist. The character is judged as a whole against its
  brief.

### 6. Write the non-seeded docs

`description.md` (site blurb), `changelog.md`, and `README.md`. These never reach
a run.

## Validate your work

A case is validated by resolving and seeding it. For every variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` renders the instruction, catching strict-mode template errors and
manifest problems such as a stray `{part}` token on `preview` or `actions`, a
duplicate animation `name`, or a missing required table. `seed` writes the seeded
repository to disk (under `tmp/` by default) so you can read exactly what the
model would receive: the brief, the starter `build.py` at the workspace root, and
the seeded `blender.config.json`.

Lint the specs and prose from the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell
```

When the case is ready, exercise it with
[Run a Test Case](/quickstarts/development/run-a-test-case/). A backend that
already holds the version keeps serving it until a forced re-ingest, so re-ingest
an edited case before running it. See
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case. The reviewer scores how well the skin deforms, with
  the 3D viewer posing the emitted `character.glb` by linear-blend skinning, and
  reconciles the produced animations against the required set.
