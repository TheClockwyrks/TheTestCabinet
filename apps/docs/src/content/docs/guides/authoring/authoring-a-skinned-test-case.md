---
title: Authoring a Skinned Character Test Case
---

## Overview

A skinned [asset-generation](/testing/asset-generation/overview/) test case asks
a model to sculpt an organic character with a skinning binary (`mc-skin`,
`sn-skin`, or `dc-skin`), one recorded operation at a time, to match a written
brief. The character is one continuous skin bound to a skeleton, deforming
smoothly across its joints. There is no target model, and the result is reviewed
against the brief. Authoring one is mostly writing a precise, self-contained
brief and naming the animations the character must play.

Read the authoritative pages first:
[Skinned binaries](/testing/asset-generation/skinned-binaries/) for the
whole-body signed-distance field, the model-invented skeleton, the automatic
bone-heat weighting, linear-blend skinning, and the emitted geometry and rig;
[Skinned cases](/testing/asset-generation/manifests/skinned-cases/) for the
schema, with the `[[model.animation]]` rules documented under
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/); and
[Evaluation](/testing/asset-generation/evaluation/#skinned-characters) for how a
skinned run is validated and reviewed.

## Skinned versus the rigid meshed kinds

A skinned case shares its CSG sculpting and its F-curve rig with the animated
meshed kinds (`mc-animation`, `sn-animation`, `dc-animation`), and differs in how
the rig moves the mesh.

- A rigid `-animation` kind builds a separate mesh per part, each posed rigidly
  about a pivot, with a seam at every joint. That is the right read for a tank, a
  turret, or a mech.
- A skinned kind builds one continuous mesh bound to a skeleton and deforms it by
  per-vertex weights, so as a bone rotates the skin around the joint stretches
  and folds across the seam. That is what a limbed creature, a humanoid, or a
  fabric-and-flesh character needs.

Author a skinned case when the subject is a character or creature whose body
deforms continuously across its joints: an elbow that bends without tearing, a
stride that reads as a walking body. A rigid machine belongs in a
[mesh animation](/guides/authoring/authoring-a-mesh-animation-test-case/) case,
and a character that never deforms is a static
[mesh model](/guides/authoring/authoring-a-mesh-model-test-case/) case. Every
skinned case is rigged and animated.

## Choosing the kind

The three skinned kinds differ in the surface character the extraction produces,
a property of the binary rather than a manifest knob.

| `asset_kind` | binary    | surface character                                     | pick for                         |
| ------------ | --------- | ----------------------------------------------------- | -------------------------------- |
| `mc-skinned` | `mc-skin` | low poly: coarse grid, chunky faceted surface         | stylized characters              |
| `sn-skinned` | `sn-skin` | smooth mid-fidelity: watertight, uniform, rounded     | smooth organic creatures         |
| `dc-skinned` | `dc-skin` | high fidelity: fine grid, preserves edges and corners | armored, hard-surface characters |

The kind is a property of the whole version, so a case is exactly one kind. The
worked examples are `siege-husk` (`mc-skinned`, a low-poly shambling enemy husk),
`caldera-slag` (`sn-skinned`, a smooth molten creature), and `sunfront-trooper`
(`dc-skinned`, armored hard-surface infantry). Read the one matching the surface
you are authoring.

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
```

A run receives the selected variant's brief, the seeded config the binary reads
(`mc-skin.config.json`, `sn-skin.config.json`, or `dc-skin.config.json`: the
field bounds, background, and the log, preview, mesh, and rig paths), an empty
action log, a blank starting preview, and a `rig.json` pre-populated with the
case's required animation declarations. The skinning binary is on its `PATH` and
its `--help` is the operations contract, so no operations schema is seeded.

Running `render` emits the skinned `mesh.glb` and `rig.json`. `mesh.glb` carries
the geometry plus the glTF skin, its per-vertex bone weights, and its
inverse-bind matrices. `rig.json` carries the skeleton, the joint interface, and
the F-curve animations. Core emits both, and neither is declared in the manifest.

## Procedure

### 1. Choose the subject

Pick a catalog slug for the lineage and the character to sculpt. A good subject
is a body whose motion is continuous skin deformation, reads clearly at the
volume size from silhouette and palette alone, needs no surrounding game context,
and is achievable with the CSG primitives and their soft-`--blend` unions. Pick a
`version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md`, a single self-contained file describing:

- the character: what it is, its silhouette and proportions, its orientation, and
  how it reads at rest;
- the exact palette: named opaque `#rrggbb` values, stated as the only colors
  allowed;
- the required animations, and how each reads as continuous-skin deformation: a
  `walk` whose legs plant and swing while the pelvis and spine flex, a `melee`
  swing that carries the shoulder and torso, an `idle` breathing sway. Name what
  makes each convincing so the reviewer can score the motion the model produced;
- that the skeleton is the model's to invent. The case fixes which animations
  must exist; the bones, joints, and the per-vertex weights that bind the skin
  are devised at run time, with weights derived by bone-heat diffusion and capped
  at four influences per vertex;
- how the tool behaves: the binary is the only way to sculpt and rig, it sculpts
  one whole-body field with no `--part` flag, and `render` is a separate
  on-request step that extracts the surface, derives the skin weights, and writes
  the mesh and the preview PNG. With `--time` and `--animation` it renders a
  posed preview showing the deformation. The model must render before finishing.

A brief authored as `specs/brief.md.hbs` reads its bounds from `{{voxel.width}}`,
`{{voxel.height}}`, `{{voxel.depth}}`, and the inclusive maxima `{{voxel.maxX}}`,
`{{voxel.maxY}}`, and `{{voxel.maxZ}}`, so one brief serves every size variant.

The self-containment and precise-values rules that govern an end-to-end spec
apply. The shared quality directive (`ASSET_QUALITY_PREAMBLE` in
`crates/core/src/prompt.rs`) is prepended to every asset-generation prompt at
render time, so the brief stays factual.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read
the binary's `--help` for the field, skeleton, and animation operations, and
states the hard requirements: sculpt and rig only through the tool, author every
required animation so it actually animates, run `render` before returning, and
return when finished. The template renders in strict mode, and the available
variables are `{{workspace}}`, `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{#each specs}}`, `{{time_limit_hours}}`, and
`{{voxel}}`.

### 4. Write the manifest

Author `test-case.toml` per the
[Skinned cases](/testing/asset-generation/manifests/skinned-cases/) schema. A
skinned case declares a `[voxel]` volume bounding the one whole-body field and a
`[model]` table of required animations.

```toml
slug       = "sunfront-trooper"
name       = "Sunfront Trooper"
difficulty = "medium"
tags        = ["skinned", "character"]
summary     = "Armored hard-surface infantry that marches, fires, and braces."
description = "description.md"
prompt      = "prompt.hbs"
max_runtime_hours = 1.5
type        = "asset-generation"
asset_kind  = "dc-skinned"

# Ordered variant list; the first is the default. A root key, so it precedes the
# first table header.
variants = ["variants/base.toml", "variants/half.toml", "variants/double.toml"]

# The bounds of the ONE whole-body field the skin is extracted from. Material is
# opaque #rrggbb; the field starts empty; `background` is the preview clear color.
[voxel]
width      = 24
height     = 48
depth      = 20
background = "transparent"

# The skinning tool. `preview` and `actions` are single files: the character is
# one field and one mesh, so neither carries a {part} token.
[tool]
binary  = "dc-skin"
preview = "model.png"

[output]
actions = "actions.json"

# The required rig contract: the animations the model must author, by identity
# alone. The case declares no bones, joints, or weights.
[model]

[[model.animation]]
name      = "march"
loop      = true
auto_play = false

[[model.animation]]
name      = "fire"
loop      = false
auto_play = false

[[model.animation]]
name      = "brace"
loop      = false
auto_play = false

# The self-contained brief, seeded for every variant.
[[spec]]
source = "specs/brief.md.hbs"

# The single scoring domain, and the whole review.
[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

Key manifest rules for a skinned case:

- Single files, not `{part}` templates. A skinned model builds one whole-body
  field, so `[tool].preview` and `[output].actions` name single files and must
  not carry a `{part}` token. The rigid `-animation` kinds require the token; a
  skinned kind forbids it.
- `[voxel]` is the field bounds. `width`, `height` (up), `depth`, and a
  `background` used as the preview clear color. It replaces `[canvas]`, and
  material is opaque `#rrggbb`.
- `[model]` fixes the required animations. Each `[[model.animation]]` entry
  declares a unique `name`, a `loop` flag (default `true`), and an `auto_play`
  flag (default `false`; `true` plays continuously on its own, such as a
  breathing idle). Declare no bones, joints, weights, period, or keyframes: the
  model invents the whole skeleton and its binding and authors the motion as
  F-curves at run time. A case may also declare `[[model.joint]]` caller DOFs,
  the runtime-drivable degrees of freedom a game sets each frame.
- The mesh and rig are core-emitted. `mesh.glb` and `rig.json` are produced
  by `render` and never named in the manifest.
- No `[[reference]]`, `[build]`, or `[[check]]`. Resolution rejects all
  three, and the emitted geometry and rig are what is judged.
- `[[domain]]` declares the single `overall` scoring domain, and the case
  declares no review checklist. How faithfully the character matches the brief
  and how convincingly the skin deforms across its joints are judged together as
  one rating.
- Metadata. `slug`, `name`, `difficulty`, and `tags` are required and
  site-facing. `type = "asset-generation"` is required; without it the case
  resolves as end-to-end, which rejects these tables.

### 5. Write the non-seeded docs

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
model would receive: the brief, the seeded skinning config, and the pre-seeded
`rig.json` carrying the required animation declarations.

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
  the 3D viewer posing the rig by linear-blend skinning, and reconciles the
  produced animations against the required set.
