---
title: Authoring a Skinned Character Test Case
---

A **skinned** [asset-generation](/testing/asset-generation/overview/) test case asks
a model to sculpt an **organic character** — one continuous skin bound to a skeleton,
deforming smoothly across its joints — with a **skinning binary** (`mc-skin`,
`sn-skin`, or `dc-skin`), one recorded operation at a time, to **match a written
brief**. As with every asset-generation case there is **no target model**: the model
is given a precise description and the freedom to build a character that reads as it,
so the case rewards a convincing character rather than the faithful reproduction of a
supplied mesh. Authoring one is mostly writing a precise, **self-contained brief** and
naming the animations the character must be able to play.

Read the authoritative pages first: the
[Skinned binaries](/testing/asset-generation/skinned-binaries/) (the whole-body
signed-distance field, the model-invented skeleton, the automatic bone-heat weighting,
linear-blend skinning, and the emitted `mesh.glb` + `rig.json` contract),
[Manifests](/testing/asset-generation/manifests/) — the authoritative schema, whose
**Skinned cases** section is the one that governs here and whose **Voxel cases**
section documents the `[[model.animation]]` rules a skinned case reuses — the
[Overview](/testing/asset-generation/overview/#skinned-character-models), and
[Evaluation](/testing/asset-generation/evaluation/#skinned-characters) (how a skinned
run is validated and reviewed). This guide is self-contained and is the sole
authoring reference for the skinned kinds.

Building a playable game instead is a different test type with its own manifest; see
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/). A 2D
sprite or sprite sheet is
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/).

## Skinned versus the rigid meshed kinds

A skinned case is the sibling of the **animated meshed** kinds (`mc-animation`,
`sn-animation`, `dc-animation`) — same CSG/signed-distance-field sculpting, same
F-curve rig — with one decisive difference in **how the rig moves the mesh**:

- The rigid `-animation` kinds build a **separate mesh per part**, each posed rigidly
  about a pivot — wooden-puppet, mecha-style articulation. There is a **seam at every
  joint**, and there has to be, because each part is its own mesh. That is the right
  read for a tank, a turret, or a mech.
- A **skinned** kind builds **one continuous mesh** bound to a skeleton and deforms it
  by **per-vertex weights**: as a bone rotates, the skin around the joint stretches and
  folds smoothly **across** the seam a rigid kind cannot cross. That is what a limbed
  creature, a humanoid, or a fabric-and-flesh character needs.

So author a skinned case when the subject is a **character or creature whose body
deforms continuously across its joints** — an elbow that bends without tearing, a
stride that reads as a walking body. If the subject is a rigid machine that articulates
about pivots, author a rigid meshed `-animation` case instead. There is **no static
skinned kind**: a character that never deforms is just a static
[`-model`](/testing/asset-generation/mesh-binaries/) case. Every skinned case is
inherently rigged and animated.

## Choosing the kind

There are three skinned kinds, one binary each, differing only in the **surface
character** the extraction produces — a fixed characteristic of the binary, not a
manifest knob. Pick by the character's surface:

| `asset_kind` | binary | surface character | pick for |
| --- | --- | --- | --- |
| `mc-skinned` | `mc-skin` | **low-poly** — coarse grid, chunky faceted surface | stylized characters |
| `sn-skinned` | `sn-skin` | **smooth mid-fidelity** — watertight, uniform, rounded | smooth organic creatures |
| `dc-skinned` | `dc-skin` | **high-fidelity / sharp-edged** — fine grid, preserves edges and corners | armored, hard-surface characters |

The kind is a property of the whole version, not a variant axis — a case is exactly one
kind. The three worked examples authored alongside this guide illustrate the split:
**`siege-husk`** is `mc-skinned` (a low-poly shambling enemy husk),
**`caldera-slag`** is `sn-skinned` (a smooth molten creature), and
**`sunfront-trooper`** is `dc-skinned` (armored hard-surface infantry). Read the one
matching the surface you are authoring alongside this guide; a new case should look
like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, [voxel], [tool], [output], [model], domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: the character + how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief. There is **no
target model** — the model sculpts to match the brief, not to copy a supplied mesh. It
also gets the skinning binary (`mc-skin` / `sn-skin` / `dc-skin`) on its `PATH`, whose
`--help` is the operations contract, and a pre-seeded `mc-skin.config.json` (volume
dimensions, background, and the log / preview / `mesh.glb` / `rig.json` paths) plus a
`rig.json` pre-populated with the case's **required animation declarations** alone. **No
operations schema is seeded** — the binary's `--help` is the contract. Everything marked
*NOT seeded* is authoring- or site-side only.

The model emits the skinned **`mesh.glb`** (the geometry plus the glTF skin — per-vertex
`JOINTS_0`/`WEIGHTS_0` bone weights and inverse-bind matrices) and **`rig.json`** (the
skeleton, the `caller`/`auto` joint interface, and the F-curve animations) by running
`render`. Both are **core-emitted automatically** — they are **not** declared in the
manifest.

## Procedure

### 1. Choose the subject and confirm it qualifies

Pick a catalog **slug** for the lineage (e.g. `caldera-slag`) and the **character** to
sculpt. A good subject is a body whose motion is **continuous skin deformation** — a
creature, humanoid, or beast that bends, strides, and flexes across its joints — reads
clearly at the volume size from silhouette and palette alone, needs no surrounding game
context, and is achievable with the CSG primitives (spheres, boxes, ellipsoids,
cylinders, and their soft-`--blend` unions). If the subject is a rigid machine, it
belongs in a meshed `-animation` case instead. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file describing:

- **the character** — what it is, its silhouette and proportions, its orientation
  (forward is +z, `y` is up), and how it should read at rest;
- the **exact palette** — named colors with **opaque `#rrggbb`** hex values (skinned
  material has **no alpha**), stated as the only colors allowed, so a reviewer can judge
  the character against the brief unambiguously;
- the **required animations, and how each should read as continuous-skin deformation** —
  e.g. a `walk` whose legs plant and swing while the pelvis and spine flex, a `melee`
  swing that carries the shoulder and torso, an `idle` breathing sway — naming what
  makes each convincing so the reviewer can score the motion the model produced;
- **that the skeleton is the model's to invent** — the case fixes only *which*
  animations must exist; the character's bones, joints, pivots, and the per-vertex
  weights that bind the skin are all for the model to devise at run time (weights are
  derived automatically by bone-heat diffusion, capped at four influences per vertex);
- **how the tool behaves** — that the binary is the only way to sculpt and rig, that
  it sculpts **one whole-body field** (there is no `--part`), that `render` is a
  separate on-request step that extracts the surface, derives the skin weights, and
  writes `mesh.glb` + the preview PNG (and, with `--time`/`--animation`, a posed preview
  showing actual deformation), and that the model must `render` before finishing so the
  geometry the result is built from is emitted.

The same self-containment and precise-values rules as an end-to-end spec apply: the brief
must stand on its own, with no link outside the seeded set, and every visual detail
written in real terms. The shared **quality directive** — the brief is the floor, not the
goal; produce the best character you can within its constraints — is prepended to every
asset-generation prompt at render time, so the brief itself stays factual and need not
restate it.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the field, skeleton, and animation operations, and states the hard
requirements (sculpt and rig only through the tool; author every required animation so it
actually animates; `render` before returning; return when finished). The template renders
in **strict mode**, so use only the documented variables —
`{{variant.slug}}` / `{{variant.name}}` / `{{variant.description}}` and
`{{#each specs}}`.

### 4. Write the manifest

Author `test-case.toml` per the [Skinned cases](/testing/asset-generation/manifests/#skinned-cases)
schema. A skinned case is a **meshed animated** case: it declares a `[voxel]` volume (the
bounds of the one whole-body field) and a `[model]` table of required animations — with
one crucial exception described below. A full, realistic `dc-skinned` example
(`sunfront-trooper`):

```toml
# test-cases/asset-generation/medium/sunfront-trooper/v1.0.0/test-case.toml
slug       = "sunfront-trooper"
name       = "Sunfront Trooper"
difficulty = "hard"
tags       = ["asset-generation", "3d", "skinned", "character"]
summary     = "Armored hard-surface infantry that walks, aims, and takes a hit."
description = "description.md"
prompt      = "prompt.hbs"
type        = "asset-generation"     # required; omitting it defaults to end-to-end
asset_kind  = "dc-skinned"           # dc-skin: sharp-edged, armored / hard-surface

# Ordered variant list; first is the default. Root key — must precede the first table.
variants = ["variants/base.toml"]

# The field bounds — the SAME [voxel] volume table a meshed case frames, here bounding
# the ONE whole-body signed-distance field the skin is extracted from. Material is
# opaque #rrggbb (no alpha); the volume starts EMPTY; `background` is the preview clear
# color only.
[voxel]
width      = 40                       # extent along x, in field units
height     = 48                       # extent along y — up
depth      = 24                       # extent along z, forward at +z
background  = "transparent"

# The skinning tool. `preview` and (below) `actions` are SINGLE files — NOT {part}
# templates — because the character is one field / one mesh. This is the skinned
# exception; see the callout under the block.
[tool]
binary  = "dc-skin"                    # mc-skin | sn-skin | dc-skin — pick by surface
preview = "model.png"                  # SINGLE file; NO {part} token

[output]
actions = "actions.json"               # SINGLE op log; NO {part} token
                                       # the skinned mesh.glb + rig.json are emitted
                                       # automatically by core (not declared here)

# The REQUIRED rig contract — and the ONLY thing the case fixes about the rig: the set of
# animations the model must author, by IDENTITY ALONE. The case declares NO bones, NO
# joints, and NO per-vertex weights — the model invents the whole skeleton and its
# binding at run time and is scored on whether the character deforms convincingly.
[model]

[[model.animation]]
name      = "idle"                     # stable, unique name a game plays this by
loop      = true                       # loop (default) vs. play once and hold last pose
auto_play = true                       # plays continuously on its own (a breathing sway)

[[model.animation]]
name      = "walk"
loop      = true
auto_play = false                      # a named playable a game triggers

[[model.animation]]
name      = "aim"
loop      = false
auto_play = false

[[model.animation]]
name      = "hit-react"
loop      = false
auto_play = false

# The self-contained brief, seeded for EVERY variant (dest defaults to source).
[[spec]]
source = "specs/brief.md"

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

The default variant file (`variants/base.toml`) is a standalone document that adds only
what varies from the common set — here nothing beyond identity, since the base *is* the
brief:

```toml
# test-cases/asset-generation/medium/sunfront-trooper/v1.0.0/variants/base.toml
slug = "base"
name = "Base"
spec = []                              # ADDITIVE specs on top of the common specs
# review_item = [...]                  # ADDITIVE reviewer items (may name a common domain)
# [[domain]]                           # ADDITIONAL scoring domains, rated only for this variant
```

Key manifest rules for a skinned case:

- **The `{part}` exception.** Because a skinned model builds a **single whole-body
  field** (not a field per part), `[tool].preview` and `[output].actions` are **single
  files** — `"model.png"` and `"actions.json"` — and **must not** carry a `{part}` token.
  This is the **one animated kind that does not template by part**: the rigid
  `mc-animation`/`sn-animation`/`dc-animation` kinds require `{part}` on both (one preview
  and one log per part), but a skinned kind, having one field and one log, forbids it.
- **`[voxel]` is the field bounds** — `width`, `height` (up), `depth`, and a `background`
  used **only** as the preview clear color (it never places material; the field starts
  empty). It replaces `[canvas]`. Material is **opaque `#rrggbb`**, no alpha.
- **`[model]` fixes only the required animations.** It holds **only**
  `[[model.animation]]` entries, each declared by **identity alone** — a unique `name`, a
  `loop` flag (default `true`), and an `auto_play` flag (default `false`; `true` = plays
  continuously on its own, such as a breathing idle, versus a named playable a game
  triggers). It declares **no bones, no joints, no per-vertex weights, no period, and no
  keyframes**: the model invents the whole skeleton and its binding and authors the motion
  as F-curves at run time. Resolution validates only that every animation `name` is unique.
- **`mesh.glb` and `rig.json` are core-emitted, not declared.** The skinned `mesh.glb`
  (geometry + glTF skin: per-vertex bone weights and inverse-bind matrices) and `rig.json`
  (skeleton, joint interface, F-curve animations) are produced automatically — never named
  in the manifest.
- **No `[[reference]]`, no `[build]`, no `[[check]]`.** A skinned case has no target model
  to score against (declaring a reference is rejected), produces emitted data rather than a
  static site, and — unlike the `draw`/`draw-sheet` sprite kinds — has **no
  cheat-divergence check**: its emitted geometry and rig are what is judged, however they
  were produced.
- **Metadata and seeding** — `name`, `difficulty`, `tags` (all required, site-facing),
  `type = "asset-generation"` (required; omitting it defaults to `end-to-end`, which then
  rejects these tables), the `variants` list (first is the default; at least one, usually
  `base`), and the `[[spec]]`/`[[domain]]` seeding rules behave exactly as for any
  asset-generation case.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a run;
keep them honest about what is seeded.

## Validate your work

There is no separate authoring linter — you validate a case by resolving and seeding it.
For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` renders the instruction (catching strict-mode template errors and manifest
problems — including a stray `{part}` token on `preview`/`actions`, or a missing required
table). `seed` writes the seeded repository to disk so you can read exactly what the model
would receive — the brief, plus the seeded `mc-skin.config.json` (or `sn-skin` / `dc-skin`)
and the pre-seeded `rig.json` carrying the required animation declarations — and confirm it
is self-contained. When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run of your
  case: the reviewer scores how well the skin **deforms** (an elbow that bends without
  tearing, a stride that reads as a walking body) with the 3D viewer posing the rig by
  linear-blend skinning, and reconciles the produced animations against the required set.
