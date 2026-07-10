---
title: Authoring a Blender Character Test Case
---

A **Blender character** ([asset-generation](/testing/asset-generation/overview/),
`asset_kind = "blender-character"`) test case asks a model to build a **rigged,
animated, skinned character** the way a game artist would — in **Blender**, scripted
through its Python API — and to **match a written brief**. It is the sibling of the
[skinned CSG kinds](/guides/authoring/authoring-a-skinned-test-case/): the same end product
(one continuous skin bound to a skeleton, deforming across its joints, exported as a
skinned + animated glTF), but authored through a **real character pipeline** rather
than a signed-distance-field sculpting binary. As with every asset-generation case
there is **no target model**: the model is given a precise description and the
freedom to build a character that reads as it. Authoring one is mostly writing a
precise, **self-contained brief**, naming the animations the character must play,
and seeding a **starter `build.py`**.

Read the authoritative pages first: the
[Blender character binaries](/testing/asset-generation/blender-binaries/) (headless
Blender + `tcab-blend`, the `build.py` authoring model, the seeded
`blender.config.json`, the `weapon_socket` convention, and the emitted
`character.glb` + `model.png` contract), [Manifests](/testing/asset-generation/manifests/)
— the authoritative schema, whose **Blender cases** section governs here and whose
**Voxel cases** section documents the `[[model.animation]]` rules a Blender case
reuses — the [Overview](/testing/asset-generation/overview/), and
[Evaluation](/testing/asset-generation/evaluation/) (how a Blender run is validated
and reviewed). This guide is self-contained and is the sole authoring reference for
the `blender-character` kind.

Building a playable game instead is a different test type with its own manifest; see
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/). A
character built from a CSG/signed-distance field is
[Authoring a Skinned Character Test Case](/guides/authoring/authoring-a-skinned-test-case/).

## Blender versus the CSG skinned kinds

Both produce the same thing — a skinned, animated glTF character. Choose
`blender-character` when the subject needs a **real character pipeline** the CSG
skinned kinds cannot express:

- The [skinned CSG kinds](/guides/authoring/authoring-a-skinned-test-case/) (`mc-skin`,
  `sn-skin`, `dc-skin`) composite a signed-distance field and let bone-heat
  diffusion weight the extracted mesh. Great for a constrained sculpt; but the
  author does not control **topology**, cannot hand-author the **armature** or the
  **weights**, and has no **IK** or **shape keys**.
- A **`blender-character`** case gives the model **Blender itself**: hand-built
  `bpy` meshes with real edge loops, edit-bone armatures, vertex-group weights the
  author controls, and F-curve Actions — the industry-standard pipeline. The
  **emitted glTF is judged**, not the authoring steps.

So author a `blender-character` case when the subject is an **organic or hard-surface
character whose credibility depends on real topology and rigging** — clean
deformation at the joints, a hand-built skeleton, IK-driven limbs. If a constrained
CSG sculpt is enough, author a skinned CSG case instead. There is no static Blender
kind: like the skinned kinds, every Blender character is inherently rigged and
animated.

## What a case is, and what gets seeded

A version lives under `test-cases/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, [voxel], [tool], [output], [model], domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: the character + how the tool behaves — SEEDED
  specs/build.py         # the starter Blender script the model edits — SEEDED (as a [[spec]])
```

A run receives the seeded files — the selected variant's **brief** and the **starter
`build.py`** — plus **headless Blender** and **`tcab-blend`** on its `PATH` and a
pre-seeded **`blender.config.json`** (the bounding box, the Blender-native authoring
axes — **+Z up, facing -Y**, which the export converts to the family's +Y-up/+Z-forward
glTF — the output paths `character.glb` / `model.png`, the build-script path, and the
required animation names). There is **no target model**. The skeleton and its
binding are the model's to invent.

The model emits **`character.glb`** (the skinned mesh + glTF skin + one animation per
required Action) and the preview **`model.png`** by running `tcab-blend`. Both are
**core-emitted automatically** — they are **not** declared in the manifest.

Note the one seeding difference from the CSG skinned kinds: the **starter `build.py`
is seeded by the case as a `[[spec]]`** (its dest is `build.py`), so it reaches the
run like any other spec; no core seeding change is needed for it.

## Procedure

### 1. Choose the subject and confirm it qualifies

Pick a catalog **slug** for the lineage (e.g. `siege-rifleman`) and the **character**
to build. A good subject is a body whose credibility rests on **real topology and
rigging** — a humanoid, a creature, a hard-surface figure that bends, strides, and
flexes across hand-built joints — reads clearly at the bounding-box size from
silhouette and palette alone, and needs no surrounding game context. If a constrained
CSG sculpt would do, author a [skinned CSG case](/guides/authoring/authoring-a-skinned-test-case/)
instead. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file describing:

- **the character** — what it is, its silhouette and proportions, its orientation
  (built in Blender-native space: **+Z up, facing -Y**; the export converts to the
  emitted glTF's +Y-up/+Z-forward — and warn against pre-rotating to +Y-up), the gear
  that is **baked into the body mesh** (helmet,
  armor, pouches — permanently worn), and how it should read at rest. It fits within
  the **bounding box given in `blender.config.json`** — write this as prose; do not
  hardcode coordinates, since the volume is templated;
- the **exact palette** — named colors with **opaque `#rrggbb`** hex values, stated
  as the only colors allowed, carried on the mesh as vertex colors or materials;
- the **`weapon_socket` rule** — that a held weapon is **not** part of the mesh: the
  rig carries an **empty `weapon_socket` bone** parented to the hand, with **no
  vertex influence**, where the game hangs a separate weapon asset; the model must
  not model the weapon;
- the **required animations, and how each should read as continuous-skin
  deformation** — naming what makes each convincing (an `idle` breathing sway, a
  `run` cycle with opposite-phase legs and counter-swinging arms, a `fire` recoil
  through the shoulder and torso, a `death` that holds its last pose), authored **in
  place**;
- **that the skeleton is the model's to invent** — the case fixes only *which*
  animations must exist; the bones, joints, and the vertex-group weights that bind
  the skin are all the model's to devise at run time;
- **how the tool behaves** — that everything is authored by editing **`build.py`**
  and running **`tcab-blend`** (which runs Blender headless on the script), that the
  script builds mesh + armature + weights + one Action per required animation with
  `bpy` and calls the bundled export helper to emit `character.glb` + `model.png`,
  that the model must run `tcab-blend` **before finishing** so the glTF is emitted,
  and that the **emitted glTF is judged** (not the script's steps) while `build.py`
  is re-run afterward for provenance — so keep it self-contained and deterministic.

The same self-containment and precise-values rules as an end-to-end spec apply: the
brief must stand on its own, with no link outside the seeded set, and every visual
detail written in real terms. The shared **quality directive** — the brief is the
floor, not the goal — is prepended to every asset-generation prompt at render time,
so the brief itself stays factual and need not restate it.

### 3. Write the starter `build.py`

Author `specs/build.py` — the script the model receives and edits. Keep it
**runnable-shaped and well-commented** so an inexperienced author sees the whole
pipeline, but leave the geometry, rig, weights, and motion as clearly-marked `TODO`s:

- `import bpy`, load the seeded `blender.config.json` (from the path after `--`, or
  the file in the working directory) and read `bounds` and the required
  `animations`;
- clear the default scene;
- `TODO` sections for `build_body_mesh()`, `build_armature()` (including the
  `weapon_socket` bone), `bind_skin_weights()`, and `author_animation(name)` for each
  required animation;
- drive the pipeline, then **end by calling the bundled export helper** —
  `import tcab_blend_export; tcab_blend_export.export(config)` — which the container
  provides (it runs `bpy.ops.export_scene.gltf(...)` and renders the preview).

### 4. Write `prompt.hbs`

A short instruction that points the model at the seeded brief and the starter
`build.py`, tells it to author the character by editing `build.py` and running
`tcab-blend`, and states the hard requirements (build and rig only through Blender /
`build.py`; bake the gear into the mesh; keep the `weapon_socket` empty; author every
required animation so it actually animates; run `tcab-blend` before returning). The
template renders in **strict mode**, so use only the documented variables —
`{{variant.slug}}` / `{{variant.name}}` / `{{variant.description}}` and
`{{#each specs}}`.

### 5. Write the manifest

Author `test-case.toml` per the [Blender cases](/testing/asset-generation/manifests/)
schema. A Blender character case is a **meshed animated** case that declares a
`[voxel]` bounding box and a `[model]` table of required animations, with `[tool]`
and `[output]` pointing at the Blender pipeline:

```toml
# test-cases/siege-rifleman/v1.0.0/test-case.toml
slug       = "siege-rifleman"
name       = "Siege Warden Rifleman"
difficulty = "hard"
tags       = ["asset-generation", "3d", "skinned", "character", "blender"]
summary     = "Standard-issue Warden infantry, built and rigged in Blender."
description = "description.md"
prompt      = "prompt.hbs"
type        = "asset-generation"     # required; omitting it defaults to end-to-end
asset_kind  = "blender-character"    # Blender-authored skinned character

# Ordered variant list; first is the default. Root key — must precede the first table.
variants = ["variants/base.toml"]

# The bounding box — the SAME [voxel] table a meshed case frames, here the box the
# character must fit within. `background` is the preview clear color only.
[voxel]
width      = 24                       # extent along x, in world units
height     = 48                       # extent along y — up
depth      = 24                       # extent along z, forward at +z
background  = "transparent"

# The Blender pipeline. `preview` is a SINGLE file — NOT a {part} template — because
# the character is one mesh.
[tool]
binary  = "tcab-blend"                # the headless-Blender runner
preview = "model.png"                 # SINGLE file; NO {part} token

[output]
actions = "build.py"                  # the authored script IS the recorded trace
                                      # (re-run for provenance); character.glb + model.png
                                      # are emitted automatically by core (not declared)

# The REQUIRED rig contract — the ONLY thing the case fixes about the rig: the set of
# animations the model must author, by IDENTITY ALONE. The case declares NO bones, NO
# joints, and NO weights — the model invents the whole skeleton at run time.
[model]

[[model.animation]]
name      = "idle"
loop      = true
auto_play = true                      # a breathing ready stance, plays on its own

[[model.animation]]
name      = "run"
loop      = true
auto_play = false

[[model.animation]]
name      = "fire"
loop      = false
auto_play = false

[[model.animation]]
name      = "reload"
loop      = false
auto_play = false

[[model.animation]]
name      = "hit"
loop      = false
auto_play = false

[[model.animation]]
name      = "death"
loop      = false                     # plays once and holds the last pose
auto_play = false

# The seeded brief AND the starter build.py — both seeded for EVERY variant.
[[spec]]
source = "specs/brief.md"

[[spec]]
source = "specs/build.py"             # the starter script (dest defaults to build.py)

# At least one scoring domain, rated for EVERY variant. Reporter-side; NOT seeded.
[[domain]]
id          = "fidelity"
name        = "Fidelity"
description = "How faithfully the character matches the brief."

[[domain]]
id          = "deformation"
name        = "Deformation"
description = "How convincingly the skin deforms across joints in each animation."
```

Key manifest rules for a Blender character case:

- **`[tool].binary = "tcab-blend"`** and **`[tool].preview = "model.png"`** — a
  **single** preview, not a `{part}` template, because the character is one mesh
  (the same skinned exception the CSG skinned kinds have).
- **`[output].actions = "build.py"`** — the authored **script** is the recorded
  authoring trace (there is no op-log), a **single** file with **no `{part}`
  token**. The emitted `character.glb` and `model.png` are **core-emitted**, never
  named in the manifest.
- **`[voxel]` is the bounding box** — `width`, `height` (up), `depth`, and a
  `background` used **only** as the preview clear color. Material is **opaque
  `#rrggbb`**, no alpha.
- **`[model]` fixes only the required animations** — `[[model.animation]]` entries by
  **identity alone** (`name`, `loop`, `auto_play`), reusing the [Voxel cases'
  `[[model.animation]]` rules](/testing/asset-generation/manifests/). It declares
  **no bones, no joints, no weights, no keyframes**: the model invents the whole
  skeleton and authors the motion at run time. Add role-special animations
  (`heal`, `resupply`, …) per case; the flagship Rifleman has none.
- **Seed the starter `build.py`** as a second `[[spec]]` (dest `build.py`) so it
  reaches the run.
- **No `[[reference]]`, no `[build]`, no `[[check]]`, and no
  `[canvas]`/`[sheet]`/`[ui]`/`[material]`/`[particle]`/`[audio]`.** A Blender case
  has no target model to score against and produces emitted data judged as-is; its
  provenance re-run is not a cheat-divergence check.
- **Metadata and seeding** — `name`, `difficulty`, `tags`, `type =
  "asset-generation"` (required), the `variants` list, and the `[[spec]]` /
  `[[domain]]` rules behave exactly as for any asset-generation case.

The default variant file (`variants/base.toml`) is a standalone document that adds
only what varies from the common set — here nothing beyond identity, since the base
*is* the brief:

```toml
# test-cases/siege-rifleman/v1.0.0/variants/base.toml
slug = "base"
name = "Base"
spec = []                              # ADDITIVE specs on top of the common specs
# review_item = [...]                  # ADDITIVE reviewer items (may name a common domain)
# [[domain]]                           # ADDITIONAL scoring domains, rated only for this variant
```

### 6. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded — the brief and the starter `build.py`.

## Validate your work

There is no separate authoring linter — you validate a case by resolving and seeding
it. For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` renders the instruction (catching strict-mode template errors and manifest
problems — including a stray `{part}` token on `preview`/`actions`, or a missing
required table). `seed` writes the seeded repository to disk so you can read exactly
what the model would receive — the brief, the starter `build.py`, the seeded
`blender.config.json` (bounds, axes, output paths, and the required animation
names) — and confirm it is self-contained. When the case is ready, exercise it end to
end with [Run a Test Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run of
  your case: the reviewer scores how well the skin **deforms** with the 3D viewer
  posing the emitted `character.glb` by linear-blend skinning, and reconciles the
  produced animations against the required set. Validation decodes the emitted glTF
  and re-runs `build.py` for provenance; see
  [Blender character binaries](/testing/asset-generation/blender-binaries/).
