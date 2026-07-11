---
title: Authoring a Voxel Model Test Case
---

A **static voxel-model** [asset-generation](/testing/asset-generation/overview/)
test case asks a model to **sculpt a small 3D model** out of **opaque `#rrggbb`
voxels** with the `voxel` binary, one recorded operation at a time, to **match a
written brief**. It is the 3D counterpart of a
[single sprite](/guides/authoring/authoring-an-asset-generation-test-case/): one model
sculpted into a fixed voxel volume, with **no target model**. It does not measure
code generation; it measures how well a model drives the voxel tool toward that
description through many small, deliberate steps. The result is **subjective** — the
model is given a precise written brief and the freedom to build something that reads
as it, so the case rewards creativity rather than the faithful reproduction of a
supplied model. Authoring one is mostly writing a precise, **self-contained brief**.

Read the authoritative pages first: the
[Overview](/testing/asset-generation/overview/#voxel-models-and-rigs) (what the type
measures, why the recorded **operation log** — not the voxels on disk — is the
authoritative output, and the opaque-voxel/empty-volume model), the
[Voxel binaries](/testing/asset-generation/voxel-binaries/) (the `voxel` operation
set, the seeded `voxel.config.json`, the on-request `wgpu` PNG preview, and how a
call records), [Manifests](/testing/asset-generation/manifests/#voxel-cases) — the
authoritative schema, whose **Voxel cases** section is the one that governs here —
and [Evaluation](/testing/asset-generation/evaluation/#voxel-validation) (how the
emitted geometry is validated and human-reviewed against the brief, with no automated
fidelity score and no cheat check for the voxel family). This guide is
self-contained and is the sole authoring reference for the static voxel kind.

This guide covers the **`voxel-model`** kind only. For a **rigged, animated** model
(named parts + joints), see
[Authoring a Voxel Animation Test Case](/guides/authoring/authoring-a-voxel-animation-test-case/);
for a **smooth, meshed** model (a signed-distance field rather than cube cells), see
[Authoring a Mesh Model Test Case](/guides/authoring/authoring-a-mesh-model-test-case/). A 2D
sprite or sprite sheet is
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/);
building a playable game instead is a different test type with its own manifest —
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/). To
add a variant to an existing static-voxel version, see
[Creating a Voxel Model Variant](/guides/authoring/creating-a-voxel-model-variant/).

The worked example authored alongside this guide is the `skyshard` interceptor — a
symmetric, forward-swept fighter jet sculpted into a modest cube. Read it alongside
this guide; a new case should look like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, [voxel], [tool], [output], domains, review items
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/brief.md          # the brief: what to sculpt + how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief (the common brief
plus any variant-additive brief). There is **no target model** — the model sculpts
toward the brief alone. It also gets the `voxel` binary in its environment, whose
`--help` is the operations contract, and a pre-seeded `voxel.config.json` (the volume
dimensions, background, and the log/preview/geometry paths, so neither an operation
nor `render` needs any volume flags). **No operations schema is seeded** — the
binary's `--help` is the contract. Everything marked *NOT seeded* is authoring- or
site-side only; the prompt is rendered and handed to the harness as the instruction,
never written to disk.

## Procedure

### 1. Choose the subject and confirm it qualifies

Pick a catalog **slug** for the lineage (e.g. `skyshard`) and the **subject** to
sculpt. A good subject reads clearly at the volume size from silhouette and palette
alone, needs no surrounding game context, and is achievable within the `voxel`
operation set (boxes, lines, spheres, ellipsoids, cylinders, a mirror plane).
Subjects with a **plane of symmetry** suit the `mirror` op well. Pick a `version`
(`vX.Y.Z`); a version is **immutable** once runs reference it — revise by adding a
new version, not by editing a published one.

### 2. Write the brief

Write a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation within the volume
  (which way is forward, which axis is up), and its footprint;
- the **exact palette** — named colors with `#rrggbb` values, declared as the only
  colors allowed (voxels are opaque; there is no alpha);
- **the volume and orientation** — the `[voxel]` dimensions (`x` across, `y` up, `z`
  depth) so the brief pins framing to real coordinates, and where the subject sits
  within it;
- **how the tool behaves** — the `voxel` binary is the only way to place a voxel, its
  `--help` lists the operations, a sculpting op **only records** (it renders nothing);
  `voxel render` on request meshes the model and draws the preview so the model can
  read its progress — and emits the geometry, so it must render **before finishing**;
  the volume starts empty, and the recorded operations are the output (anything placed
  outside the tool is discarded).

The self-containment, *what-not-how*, and precise-values rules under
[Writing the brief](#writing-the-brief) below apply. The shared **quality directive**
— the brief is the floor, not the goal; produce the best-looking asset you can within
its constraints — is prepended to every asset-generation prompt at render time, so
the brief itself stays factual and need not restate it.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
`voxel` binary's `--help` for the operations, and restates the hard requirements
(sculpt only through the tool; a sculpting op renders nothing — run `voxel render` to
(re)draw and read the preview, and **before finishing** so the geometry is emitted;
return when finished). It renders in **strict mode**, so use only the documented
template variables — `{{variant.slug}}` / `{{variant.name}}` /
`{{variant.description}}` and `{{#each specs}}`; any other reference is an error.
Model it on `skyshard`'s `prompt.hbs`, and keep it factual — do not restate the
"aim high" quality framing, which is prepended automatically.

### 4. Write the manifest

Author `test-case.toml` per the
[Voxel cases](/testing/asset-generation/manifests/#voxel-cases) schema. A realistic
`voxel-model` example (`skyshard`):

```toml
# test-cases/asset-generation/easy/skyshard/v1.0.0/test-case.toml
slug       = "skyshard"
name       = "Skyshard Interceptor"
difficulty = "medium"
tags       = ["asset-generation", "3d", "voxel"]
summary     = "A symmetric, forward-swept interceptor sculpted into a modest cube."
description = "description.md"
prompt      = "prompt.hbs"
max_runtime_hours = 0.5
type        = "asset-generation"     # required; omitting it defaults to end-to-end
asset_kind  = "voxel-model"          # a static cube-voxel model

# Ordered variant list; first is the default. Root key — must precede the first table.
variants = ["variants/base.toml"]

# The bounding volume the model sculpts into — the 3D analog of [canvas]. Cells are
# OPAQUE #rrggbb (no alpha); the volume starts EMPTY; `background` is the preview
# clear color only. A voxel case must NOT declare [canvas].
[voxel]
width      = 48                      # extent along x — across
height     = 16                      # extent along y — up
depth      = 56                      # extent along z — nose-to-tail, forward at +z
background = "transparent"

# The building binary. `preview` is a SINGLE file (NO {part} token for a static
# model) the binary rasterizes the wgpu PNG to when the model runs `render`.
[tool]
binary  = "voxel"
preview = "model.png"

# The recorded operation log the binary appends to — the AUTHORITATIVE output. A
# SINGLE file (NO {part} token). `render` also emits the .glb the 3D client renders,
# produced on request, not declared here.
[output]
actions = "actions.json"

# The self-contained brief, seeded for EVERY variant (dest defaults to source).
[[spec]]
source = "specs/brief.md"

# At least one scoring domain, rated for EVERY variant. Reporter-side; NOT seeded.
[[domain]]
id          = "fidelity"
name        = "Fidelity"
description = "How faithfully the regenerated model matches the brief."
```

The default variant file (`variants/base.toml`) is a standalone document that adds
only what varies from the common set — here nothing beyond identity, since the base
*is* the brief:

```toml
# test-cases/asset-generation/easy/skyshard/v1.0.0/variants/base.toml
slug = "base"
name = "Base"
spec = []                            # ADDITIVE specs on top of the common specs
# review_item = [...]                # ADDITIVE reviewer items (may name a common domain)
# [[domain]]                         # ADDITIONAL scoring domains, rated only for this variant
```

Key manifest rules for a static voxel case:

- **`[voxel]` fixes the volume** — `width`, `height` (up), and `depth` in voxels, and
  a `background` used **only** as the preview clear color (it never places a voxel;
  the volume starts empty). It replaces `[canvas]`; a voxel case declaring `[canvas]`
  is rejected. Material is **opaque `#rrggbb`**, no alpha. **Size the volume from the
  subject's real dimensions at a fixed scale** so relative sizes are comparable across
  cases: pick a plausible real size in metres, then **10 voxels/metre for smaller
  units** (longest side ≤ ~8 m) or **5 voxels/metre for larger units and structures**,
  with proportions that match the subject. Keep the largest resulting dimension
  roughly in the 40–150 band.
- **`[tool]` and `[output]` are single files.** `binary = "voxel"`, and both
  `[tool].preview` and `[output].actions` name **single files** (`"model.png"`,
  `"actions.json"`) — a static model has one geometry set and one log, so **neither
  may carry a `{part}` token** (that is required only for an animated kind). There is
  **no operations schema** — `--help` is the contract. `render` also emits the `.glb`
  the 3D client renders, produced on request and **not** declared in the manifest.
- **No `[model]` table** — a static model has no rig; declaring one is rejected. The
  `[model]` required-animation contract is for the animated kinds only.
- **No `[[reference]]`, no `[build]`, no `[[check]]`.** A voxel case has no target
  model to score against (declaring a reference, common or per-variant, is rejected),
  produces emitted data rather than a static site, and — unlike the `draw`/`draw-sheet`
  sprite kinds — has **no cheat-divergence check**: its emitted geometry and preview
  are what is judged, however they were produced (see
  [Evaluation](/testing/asset-generation/evaluation/#voxel-validation)).
- **Domains and review items.** Declare at least one scoring `[[domain]]` (e.g.
  `fidelity`) and the `[[review_item]]` checklist judging how convincingly the
  regenerated model realizes the brief (silhouette from multiple angles, palette,
  proportion, symmetry). Each item carries only a `domain` (plus
  `id`/`title`/`text`/optional `weight`) — no `reference`, since there is no target to
  pair with. Reporter-side; **not seeded**.
- **Metadata and seeding** — `name`, `difficulty`, `tags` (include `3d`/`voxel`; all
  required, site-facing), `type = "asset-generation"` (required; omitting it defaults
  to `end-to-end`, which then rejects these tables), the `variants` list (first is the
  default; at least one, usually `base`), and the `[[spec]]`/`[[domain]]` seeding
  rules behave exactly as for any asset-generation case.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** A run seeds only the brief, in an isolated container with no
  access to these docs and no target model. The brief must be complete on its own — no
  link outside the seeded set — and it points at the binary's `--help` for the
  operations.
- **Specify *what*, not *how* — measure creativity, not instruction-following.**
  Describe *what the subject is* (its key features, silhouette, and palette) and the
  requirements it must satisfy — not exact dimensions, coordinates, or shapes. The
  test rewards a model that invents a convincing model from the brief; a brief that
  dictates every voxel just measures whether it can follow instructions. Pin only
  what's truly required: the `[voxel]` volume, the exact palette, and the orientation
  (which axis is up, which way is forward). Leave the order of operations and technique
  to the model (except where a variant deliberately constrains technique).
- **Use precise, testable values for what you DO pin.** Pin the palette to exact
  `#rrggbb` values, frame the subject against the fixed `[voxel]` volume, name which
  axis is up and which way is forward, and name the silhouette features that must read
  — as requirements, not as a voxel-by-voxel blueprint. Vague prose about the *subject*
  is the most common failure; over-specified footprints are the opposite trap.
- **Use emphasis sparingly.** Bold a genuine hard constraint (the palette, the volume)
  where it must not be missed — not half the words in a paragraph. Prose where
  everything is bold reads as noise; prefer plain sentences and let the few bolded
  constraints carry weight.
- **Keep the bar high.** Ask for a faithful, polished model that reads unmistakably as
  the subject from more than one angle — the frontend renders it rotating — not a rough
  blocky approximation.

## Validate your work

From the repository root, lint the specs:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

If `cspell` flags a legitimate domain term, add it to `.cspell/project-words.txt` — do
not reword good prose to dodge the dictionary.

Then confirm the manifest resolves and the seeded set is self-contained by rendering
the prompt and seeding the repository for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors (including a stray `{part}`
token on `preview`/`actions`, or a stray `[model]`/`[canvas]`/`[[reference]]` table).
`seed` writes the seeded repository (under `tmp/` by default) so you can read exactly
what the model would receive — the brief, plus the seeded `voxel.config.json` — and
confirm it is self-contained, with no target model seeded.

### Re-ingest after editing

A backend-driven run (the desktop and web consoles) resolves its definition from the
backend's **immutable def store**, which skips a version it already holds — and the
asset-generation tables (`type`, `[voxel]`, `[tool]`, `[output]`) are newer fields, so
a stale def serves them empty and the run is treated as end-to-end. After editing a
case you must **force a re-ingest** for the change to reach a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — do this **only during
development**, while iterating on a version no run has been published against. Once a
published run references a version it is **immutable**: revise by creating a **new
version** (bump `vX.Y.Z`), never by editing and re-ingesting the published one. See
[Running the services locally](/development/running/).

Commit on the repository's default branch with a conventional-commit message scoped to
the case (e.g. `feat(<slug>): add <version> …`). Do not commit `node_modules/` or the
rendered local `tmp/` seed output.

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — assess a run of
  your case: the reviewer judges how convincingly the regenerated model realizes the
  brief (silhouette, palette, proportion, symmetry), with the 3D viewer auto-rotating
  the emitted geometry the binary produced.
