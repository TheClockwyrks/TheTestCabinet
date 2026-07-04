---
description: Read this skill before creating a new STATIC voxel asset-generation test case or version (asset_kind = "voxel-model" — a 3D opaque-RGB model the model sculpts with the `voxel` tool, one recorded operation at a time), or when authoring or revising such a case's brief, prompt, or manifest under test-cases/. For an ANIMATED, rigged voxel model use authoring-a-voxel-animation-test-case; for a 2D sprite/sprite-sheet use authoring-an-asset-generation-test-case; for a playable game use authoring-an-end-to-end-test-case.
name: authoring-a-voxel-model-test-case
---

# Authoring a Static Voxel-Model Test Case

## What a voxel-model test case is

A voxel-model test case asks a model to **sculpt a small 3D model** out of
**opaque `#rrggbb` voxels** with the `voxel` binary, one recorded operation at a
time, toward a goal **described in a brief**. It is the 3D counterpart of a
[single sprite](../authoring-an-asset-generation-test-case/SKILL.md): one model
sculpted into a fixed voxel volume, with **no target model**. It does not measure
code generation; it measures how well a model drives the voxel tool toward that
description through many small, deliberate steps. The result is **subjective** —
the model is given a precise written brief and the freedom to build something that
matches it, so the case rewards creativity rather than the faithful reproduction
of a supplied model. Authoring one is mostly writing a precise, self-contained
**brief**.

The authoritative docs are the source of truth — **read them first** and follow
them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures, why the recorded **operation log** (not the voxels on
  disk) is the authoritative output, and the opaque-voxel/empty-volume model;
- [`testing/asset-generation/voxel-binaries.md`](../../../apps/docs/src/content/docs/testing/asset-generation/voxel-binaries.md)
  — the `voxel` operation set, the seeded `voxel.config.json`, the per-op isometric
  PNG preview, and how a call records;
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field and the rules enforced at resolution (see **Voxel cases**);
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — how the regenerated model is human-reviewed against the brief (there is no
  automated fidelity score) and how cheat-divergence (vs. the on-disk isometric
  preview) flags sculpting outside the tool.

This skill covers the **`voxel-model`** kind only. For a **rigged, animated** model
(named parts + joints), use
[`authoring-a-voxel-animation-test-case`](../authoring-a-voxel-animation-test-case/SKILL.md).
For a **2D** sprite or sprite sheet use
[`authoring-an-asset-generation-test-case`](../authoring-an-asset-generation-test-case/SKILL.md);
for a playable game use
[`authoring-an-end-to-end-test-case`](../authoring-an-end-to-end-test-case/SKILL.md).
To add a variant to an existing static-voxel version use
[`adding-a-voxel-model-variant`](../adding-a-voxel-model-variant/SKILL.md).

The worked example: the `skyshard` interceptor — a symmetric, forward-swept fighter
jet sculpted into a modest cube. Read it alongside this skill — a new case should
look like it.

## Anatomy of a test case version

```text
test-cases/<slug>/<version>/
  test-case.toml          # manifest: type, asset_kind, voxel, tool, output, domains, review items
  variants/               # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/
    brief.md              # the brief: what to sculpt + how the tool behaves — SEEDED
```

What a run receives: the selected variant's seeded specs (the common brief + any
variant-additive brief). There is **no target model** — the model sculpts toward
the brief alone. It also gets the `voxel` binary in its environment, whose `--help`
is the operations contract; **no operations schema is seeded**. Everything marked
*NOT seeded* is site-side only; the prompt is rendered and handed to the harness as
the instruction, never written to disk.

## Creating a new case — procedure

### 1. Choose the subject and confirm it qualifies

Pick a **catalog slug** for the lineage (e.g. `skyshard`) and the **subject** to
sculpt. A good subject reads clearly at the volume size from silhouette and palette
alone, needs no surrounding game context, and is achievable within the `voxel`
operation set (boxes, lines, spheres, a mirror plane). Subjects with a **plane of
symmetry** suit the `mirror` op well. Pick a `version` (`vX.Y.Z`); a version is
**immutable** once runs reference it — revise by adding a new version, not by
editing a published one.

### 2. Write the brief

Seed a single self-contained `specs/brief.md`. State:

- **what to sculpt** — the subject, its silhouette and orientation within the
  volume (which way is forward, which axis is up), and its footprint;
- the **exact palette** — named colors with `#rrggbb` values, declared as the only
  colors allowed (voxels are opaque; there is no alpha);
- **the volume and orientation** — the `[voxel]` dimensions (`x` across, `y` up,
  `z` depth) so the brief pins framing to real coordinates, and where the subject
  sits within it;
- **how the tool behaves** — the `voxel` binary is the only way to place a voxel,
  its `--help` lists the operations, a sculpting op **only records** (it renders
  nothing); `voxel render` on request meshes the model and draws the preview so the
  model can read its progress — and emits the geometry, so it must render before
  finishing — the volume starts empty, and the recorded operations are the output
  (anything placed outside the tool is discarded).

The self-containment, *what-not-how*, and precise-values rules from **Writing the
brief** below apply.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
`voxel` binary's `--help` for the operations, and restates the hard requirements
(sculpt only through the tool; a sculpting op renders nothing — run `voxel render`
to (re)draw and read the preview, and **before finishing** so the geometry is
emitted; return when finished). It renders in **strict mode**, so use only the documented template
variables (`{{variant.*}}`, `{{#each specs}}`) — any other reference is an error.
Model it on `skyshard`'s `prompt.hbs`. A shared **quality directive** (the brief is
the floor, not the goal; produce the best-looking asset you can within its
constraints) is prepended to *every* asset-generation prompt automatically at
render time (`ASSET_QUALITY_PREAMBLE` in `crates/core/src/prompt.rs`), so keep your
`prompt.hbs` factual and do not restate that "aim high" framing yourself.

### 4. Write the manifest

Author `test-case.toml` per the
[manifests schema](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
(the **Voxel cases** section):

- **Metadata** — `slug` (the case's stable identity — the store key and what every run records; normally the folder name), `name`, `difficulty`, `tags` (include `3d`/`voxel`), `summary`,
  `description`, `prompt`, `max_runtime_hours`.
- **`type = "asset-generation"`** — required. Omitting it defaults to `end-to-end`,
  which then rejects the tables below.
- **`asset_kind = "voxel-model"`** — required for this kind.
- **`[voxel]`** — the fixed `width`, `height` (up), `depth` in voxels and the
  preview `background` (a hex color or `transparent`). The volume always starts
  **empty**; `background` is only the isometric preview PNG's clear color. A voxel
  case must **not** declare `[canvas]`. **Size the volume from the subject's real
  dimensions at a fixed scale** so relative sizes are comparable across cases: pick a
  plausible real size in metres, then **10 voxels/metre for smaller units** (longest
  side ≤ ~8 m) or **5 voxels/metre for larger units and structures**, with
  proportions that match the subject. Keep the largest resulting dimension roughly in
  the 40–150 band.
- **`[tool]`** — `binary = "voxel"` and the `preview` path the binary rasterizes
  the PNG to when the model runs `render` (a single file, e.g. `model.png` — **no**
  `{part}` token for a static model). **No operations schema** — `--help` is the
  contract.
- **`[output]`** — the `actions` log the binary records (a single file, e.g.
  `actions.json`); this ordered list is the **authoritative output**. `render` also
  emits the per-part `.glb` the 3D client renders — produced on request, not
  declared in the manifest.
- A **`variants`** list — an ordered array of paths to standalone variant files
  under `variants/` (the first the default — usually `base`; at least one
  required). It is a **root key**, so it must precede the first table header, and
  each `[[spec]]` `dest` defaults to its `source`.
- **No targets** — declare **no `[[reference]]`** (common *or* per-variant);
  resolution rejects any reference. The model is reviewed against its brief.
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain (e.g.
  `fidelity`) and the reviewer checklist judging how convincingly the regenerated
  model realizes the brief (silhouette from multiple angles, palette, proportion,
  symmetry). Each item carries only a `domain` (plus `id`/`title`/`text`/optional
  `weight`) — no `reference` (there is no target to pair with). Reporter-side; **not
  seeded**.

There is **no `[build]` table**, **no `[[check]]`**, and **no `[model]`** table (a
static model has no rig) — resolution rejects all three for this kind.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** A run seeds only the brief, in an isolated container with
  no access to these docs and no target model. The brief must be complete on its
  own — no link outside the seeded set — and it points at the binary's `--help` for
  the operations.
- **Specify *what*, not *how* — measure creativity, not instruction-following.**
  Describe *what the subject is* (its key features, silhouette, and palette) and the
  requirements it must satisfy — not exact dimensions, coordinates, or shapes. The
  test rewards a model that invents a convincing model from the brief; a brief that
  dictates every voxel just measures whether it can follow instructions. Pin only
  what's truly required: the `[voxel]` volume, the exact palette, and the orientation
  (which axis is up, which way is forward). Leave the order of operations and
  technique to the model (except where a variant deliberately constrains technique).
- **Use precise, testable values for what you DO pin.** Pin the palette to exact
  `#rrggbb` values, frame the subject against the fixed `[voxel]` volume, name which
  axis is up and which way is forward, and name the silhouette features that must
  read — as requirements, not as a voxel-by-voxel blueprint. Vague prose about the
  *subject* is the most common failure; over-specified footprints are the opposite
  trap.
- **Use emphasis sparingly.** Bold a genuine hard constraint (the palette, the
  volume) where it must not be missed — not half the words in a paragraph. Prose
  where everything is bold reads as noise; prefer plain sentences and let the few
  bolded constraints carry weight.
- **Keep the bar high.** Ask for a faithful, polished model that reads unmistakably
  as the subject from more than one angle — the frontend renders it rotating — not a
  rough blocky approximation.

## Validating

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not reword
  good prose to dodge the dictionary.
- Confirm the manifest resolves and the seeded set is self-contained by rendering
  the prompt and seeding the repository for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors; `seed` writes the seeded
repository (under `tmp/` by default) so you can read exactly what the model would
receive — the brief, plus the seeded `voxel.config.json` and the blank starting
isometric preview, and no target model.

### Re-ingest after editing

A backend-driven run (the desktop and web consoles) resolves its definition from
the backend's **immutable def store**, which skips a version it already holds — and
the asset-generation tables (`type`, `[voxel]`, `[tool]`, `[output]`) are newer
fields, so a stale def serves them empty and the run is treated as end-to-end.
After editing a case you must **force a re-ingest** for the change to reach a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — do this **only during
development**, while iterating on a version no run has been published against. Once
a published run references a version it is **immutable**: revise by creating a
**new version** (bump `vX.Y.Z`), never by editing and re-ingesting the published
one. See
[`development/running.md`](../../../apps/docs/src/content/docs/development/running.md).

Commit on the repository's default branch with a conventional-commit message scoped
to the case (e.g. `feat(<slug>): add <version> …`). Do not commit `node_modules/`
or the rendered local `tmp/` seed output.
