---
title: Authoring a Voxel Model Test Case
---

## Overview

A static voxel-model [asset-generation](/testing/asset-generation/overview/) test
case asks a model to sculpt a small 3D model out of opaque `#rrggbb` voxels with
the `voxel` binary, one recorded operation at a time, to match a written brief.
It is the 3D counterpart of a
[single sprite](/guides/authoring/authoring-an-asset-generation-test-case/): one
model sculpted into a fixed volume, with no target model. Authoring one is mostly
writing a precise, self-contained brief.

Read the authoritative pages first:
[Voxel binaries](/testing/asset-generation/voxel-binaries/) for the `voxel`
operation set, the seeded `voxel.config.json`, and the on-request preview;
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) for the schema;
and [Evaluation](/testing/asset-generation/evaluation/#voxel-validation) for how
the emitted geometry is validated and reviewed.

This guide covers the `voxel-model` kind. A rigged, animated cube model belongs
in [a voxel-animation case](/guides/authoring/authoring-a-voxel-animation-test-case/),
and a smooth model built from a signed-distance field in
[a mesh-model case](/guides/authoring/authoring-a-mesh-model-test-case/).
To add a variant to an existing version, see
[Creating a Voxel Model Variant](/guides/authoring/creating-a-voxel-model-variant/).

The worked example is the `skyshard` interceptor, a symmetric, forward-swept
fighter jet.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`.
Versioning is per-case and immutable: once a run references a version, that
version is frozen. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, [voxel], [tool], [output]
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  changelog.md            # per-version site-facing entry (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/brief.md          # the brief: what to sculpt + how the tool behaves (SEEDED)
```

A run receives the selected variant's brief, the seeded `voxel.config.json` (the
volume dimensions, background, and the log, preview, and mesh paths), an empty
action log, and a blank starting preview. The `voxel` binary is on its `PATH` and
its `--help` is the operations contract, so no operations schema is seeded. The
model sculpts toward the brief; there is no target model.

## Procedure

### 1. Choose the subject

Pick a catalog slug for the lineage and the subject to sculpt. A good subject
reads clearly at the volume size from silhouette and palette alone, needs no
surrounding game context, and is achievable within the `voxel` operation set:
boxes, lines, spheres, ellipsoids, cylinders, and a mirror plane. A subject with
a plane of symmetry suits `mirror` well. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write a single self-contained `specs/brief.md`. State:

- what to sculpt: the subject, its silhouette and orientation within the volume
  (which axis is up, which way is forward), and its footprint;
- the exact palette: named colors with `#rrggbb` values, declared as the only
  colors allowed, since voxels are opaque;
- the volume and orientation, so the brief pins framing to real coordinates, and
  where the subject sits within it;
- how the tool behaves: the `voxel` binary is the only way to place a voxel, its
  `--help` lists the operations, a sculpting operation only records, and
  `voxel render` meshes the model, draws the preview, and emits the geometry, so
  the model must render before finishing.

A brief authored as `specs/brief.md.hbs` may read the volume from `{{voxel.width}}`,
`{{voxel.height}}`, `{{voxel.depth}}`, and the inclusive maxima `{{voxel.maxX}}`,
`{{voxel.maxY}}`, and `{{voxel.maxZ}}`, so one brief serves every size variant.
The seeded destination drops the `.hbs`.

The [brief-writing rules](#writing-the-brief) below apply. The shared quality
directive (`ASSET_QUALITY_PREAMBLE` in `crates/core/src/prompt.rs`) is prepended
to every asset-generation prompt at render time, so the brief stays factual.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read
`voxel --help` for the operations, and restates the hard requirements: sculpt
only through the tool, run `voxel render` to draw and read the preview and again
before finishing so the geometry is emitted, and return when finished. The
template renders in strict mode, and the available variables are
`{{workspace}}`, `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{#each specs}}`, `{{time_limit_hours}}`, and
`{{voxel}}`.

### 4. Write the manifest

Author `test-case.toml` per the
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) schema.

```toml
slug       = "skyshard"
name       = "Skyshard Interceptor"
difficulty = "easy"
tags        = ["voxel", "ship"]
summary     = "A symmetric, forward-swept interceptor sculpted into a modest volume."
description = "description.md"
prompt      = "prompt.hbs"
max_runtime_hours = 1
type        = "asset-generation"
asset_kind  = "voxel-model"

# Ordered variant list; the first is the default. A root key, so it precedes the
# first table header.
variants = ["variants/base.toml", "variants/half.toml", "variants/double.toml"]

# The bounding volume, in voxels. Cells are opaque #rrggbb; the volume starts
# empty; `background` is the preview clear color.
[voxel]
width      = 50
height     = 20
depth      = 76
background = "transparent"

# The sculpting binary. `preview` is a single file: a static model has one
# geometry set, so no {part} token.
[tool]
binary  = "voxel"
preview = "model.png"

# The recorded operation log, the authoritative output. A single file.
[output]
actions = "actions.json"

# The self-contained brief, seeded for every variant.
[[spec]]
source = "specs/brief.md.hbs"

# The single scoring domain, and the whole review.
[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

A variant file is a standalone document that adds what varies from the common
set. A size variant declares its own `[voxel]` override; the default declares
none and inherits the case's volume.

```toml
slug = "base"
name = "Base Size"
```

Key manifest rules for a static voxel case:

- `[voxel]` fixes the volume. `width` across, `height` up, and `depth`, in
  voxels, plus a `background` used as the preview clear color. It replaces
  `[canvas]`, which a voxel case must not declare. See
  [Sizing the volume](#sizing-the-volume).
- `[tool]` and `[output]` name single files. `binary = "voxel"`, and neither
  `preview` nor `actions` may carry a `{part}` token, which belongs to an
  animated kind. `voxel render` also emits the `.glb` the 3D client renders, at a
  path core provides rather than the manifest.
- No `[model]` table. A static model has no rig, and declaring one is
  rejected.
- No `[[reference]]`, `[build]`, or `[[check]]`. A voxel case has no target
  model, produces emitted data rather than a static site, and carries no
  cheat-divergence check: the emitted geometry and preview are what is judged.
- One domain, no checklist. How convincingly the model realizes the brief is a
  judgment about the whole model, covering silhouette from every angle, palette,
  proportion, and symmetry, so the reviewer gives one rating and that rating is
  the run's.
- Metadata. `slug`, `name`, `difficulty`, and `tags` are required and
  site-facing. `type = "asset-generation"` is required; without it the case
  resolves as end-to-end, which rejects these tables.

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md`, and `README.md`. These never reach
a run.

## Sizing the volume

Size the volume from the subject's real dimensions at a fixed scale, so relative
sizes stay comparable across cases. Pick a plausible real size in metres, then
use 10 voxels per metre for smaller units whose longest side is about 8 m or
less, and 5 voxels per metre for larger units and structures. Keep the
proportions faithful to the subject and the largest resulting dimension roughly
within 40 to 150 voxels.

## Writing the brief

The brief is the test case. The rules that make one good:

- Be self-contained. A run seeds only the brief, in an isolated container
  with no target model. The brief is complete on its own and points at the
  binary's `--help` for the operations.
- Specify what rather than how. Describe what the subject is, covering its key
  features, silhouette, and palette, along with the requirements it must satisfy.
  Pin the volume, the exact palette, and the orientation, and leave the order of
  operations and the technique to the model.
- Use precise, testable values for what you pin. Exact `#rrggbb` colors,
  framing against the fixed volume, which axis is up and which way is forward,
  and the silhouette features that must read, stated as requirements rather than
  a voxel-by-voxel blueprint.
- Use emphasis sparingly. Bold a genuine hard constraint such as the palette
  or the volume, and let plain sentences carry the rest.
- Keep the bar high. Ask for a polished model that reads unmistakably as the
  subject from more than one angle; the frontend renders it rotating.

## Validate your work

Lint the specs from the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell
```

If `cspell` flags a legitimate domain term, add it to
`.cspell/project-words.txt`.

Then render the prompt and seed the repository for every variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including a stray
`{part}` token on `preview` or `actions` and a stray `[model]`, `[canvas]`, or
`[[reference]]` table. `seed` writes the seeded repository (under `tmp/` by
default) so you can read exactly what the model would receive: the brief, the
seeded `voxel.config.json`, the empty action log, and the blank preview.

### Re-ingest after editing

A backend-driven run resolves its definition from the backend's immutable
definition store, which skips a version it already holds. After editing a case,
force a re-ingest so the change reaches a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place, so use it only while
iterating on a version no run has been published against. Once a published run
references a version, revise by creating a new version. See
[Running the services locally](/development/running/).

When the case is ready, exercise it with
[Run a Test Case](/quickstarts/development/run-a-test-case/). Commit with a
conventional-commit message scoped to the case, such as
`feat(<slug>): add <version>`.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case. The reviewer judges how convincingly the model
  realizes the brief, with the 3D viewer rotating the emitted geometry.
