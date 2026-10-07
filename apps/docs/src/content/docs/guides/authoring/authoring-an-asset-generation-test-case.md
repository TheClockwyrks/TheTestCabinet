---
title: Authoring an Asset-Generation Test Case
---

## Overview

A 2D [asset-generation](/testing/asset-generation/overview/) test case asks a
model to draw a small pixel sprite with the `draw` tool, or a sprite sheet with
`draw-sheet`, one recorded operation at a time, to match a written brief. The
model is given the brief and the freedom to draw something that matches it, so
the case measures creativity rather than the reproduction of a supplied picture.
Authoring one is mostly writing a precise, self-contained brief.

Read the authoritative pages first:
[Sprite cases](/testing/asset-generation/manifests/sprite-cases/) for the schema,
[Overview](/testing/asset-generation/overview/) for why the recorded actions are
the output, and [Evaluation](/testing/asset-generation/evaluation/) for how the
asset is reviewed and how cheat divergence is detected.

A case draws either a single sprite or a sprite sheet, chosen by the manifest's
`asset_kind`. This is a version-level choice, not a variant axis. The worked
examples are `spectra-fighter` and its siblings for `asset_kind = "sprite"`, and
`fathom-gloamfin`, `fathom-trench-walls`, and `fathom-flare-bloom` for
`asset_kind = "sprite-sheet"`. Read the one matching the kind you are authoring.

The 3D kinds are authored through their own guides:
[voxel models](/guides/authoring/authoring-a-voxel-model-test-case/),
[voxel animations](/guides/authoring/authoring-a-voxel-animation-test-case/),
[mesh models](/guides/authoring/authoring-a-mesh-model-test-case/),
[mesh animations](/guides/authoring/authoring-a-mesh-animation-test-case/),
[skinned characters](/guides/authoring/authoring-a-skinned-test-case/), and
[Blender characters](/guides/authoring/authoring-a-blender-character-test-case/).

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/`.
Versioning is per-case and immutable: once a run references a version, that
version is frozen. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, canvas, tool, output, sheet, the overall domain
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # per-version site-facing entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: what to draw + how the tool behaves (SEEDED)
```

A run receives the selected variant's brief, the seeded `draw.config.json`, and
an empty action log plus a blank starting preview per frame. The drawing binary
is on its `PATH` and its `--help` is the operations contract, so no operations
schema is seeded. The model draws toward the brief; there is no target image.

## Procedure

### 1. Choose the subject

Pick a catalog slug for the lineage and the subject to draw. A good subject reads
clearly at the canvas size from silhouette and palette alone, needs no
surrounding game context, and is achievable within the tool's operation set. Pick
a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md`, a single self-contained file describing:

- what to draw: the subject, its silhouette and orientation, and its framing
  within the canvas;
- the exact palette: named colors with hex values, stated as the only colors
  allowed, so a reviewer can judge the asset against the brief;
- how the tool behaves: the binary is the only way to make a mark, it re-renders
  the preview after each call, and the recorded actions are the output.

The self-containment and precise-values rules that govern an end-to-end spec
apply here: the brief stands on its own, with no link outside the seeded set, and
every visual detail is written in real terms.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read
the binary's `--help` for the operations, and states the hard requirements: draw
only through the tool, and return when finished. The template renders in strict
mode, and the available variables are `{{workspace}}`, `{{variant.slug}}`,
`{{variant.name}}`, `{{variant.description}}`, `{{#each specs}}`, and
`{{time_limit_hours}}`.

The shared quality directive (`ASSET_QUALITY_PREAMBLE` in
`crates/core/src/prompt.rs`) is prepended to every asset-generation prompt at
render time, so `prompt.hbs` stays factual.

### 4. Write the manifest

Author `test-case.toml` per the
[schema](/testing/asset-generation/manifests/sprite-cases/).

- Metadata. `slug`, `name`, `difficulty`, and `tags` are required and
  site-facing.
- `type = "asset-generation"` is required. Without it the case resolves as
  end-to-end, which then rejects the tables below.
- `[canvas]` fixes the `width`, `height`, and `background` the model draws on.
  For a sprite sheet this is one frame; every frame is a separate file of this
  size.
- `[tool]` names the `binary` (`draw`, or `draw-sheet` for a sheet) and the
  `preview` path the binary re-renders to after each call, a `{frame}` template
  for a sheet.
- `[output]` names the `actions` log the binary records, a `{frame}` template for
  a sheet. This log is the authoritative output the reviewed image is regenerated
  from.
- `[sheet]` (sprite sheets only) declares the `[[sheet.frame]]` entries, each
  carrying the `index` it is written to, and the named `[[sheet.sequence]]`
  animations, each with a `slug`, a `name`, and its `frames`.
- `variants` is an ordered array of paths to standalone variant files under
  `variants/`. The first is the default, at least one is required (usually
  `base`), and as a root key it must precede the first table header. To add more,
  see [creating a single-sprite variant](/guides/authoring/creating-a-sprite-variant/)
  or [a sprite-sheet variant](/guides/authoring/creating-a-sprite-sheet-variant/).
- `[[spec]]` entries are seeded for every variant, and a `dest` defaults to the
  `source` with a trailing `.hbs` stripped.
- `[[domain]]` declares the single `overall` scoring domain, which is the
  whole review. A produced asset is judged as a whole against its brief, so the
  case declares no review checklist and the reviewer's one rating is the run's.

  ```toml
  [[domain]]
  id = "overall"
  name = "Overall"
  description = "How good the produced asset is overall, judged against the brief."
  ```

  Anything a checklist item would have said belongs in `specs/brief.md`, which is
  what the rating is given against.

Resolution rejects a `[build]` table, any `[[check]]`, and any `[[reference]]`. A
sprite case produces a recorded action log rather than a static site, and its
cheat-divergence signal is computed by the validator.

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
manifest problems. `seed` writes the seeded repository to disk (under `tmp/` by
default) so you can read exactly what the model would receive: the brief, the
seeded `draw.config.json`, and the blank starting frames.

Lint the specs and prose from the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell
```

If `cspell` flags a legitimate domain term, add it to
`.cspell/project-words.txt`.

When the case is ready, exercise it with
[Run a Test Case](/quickstarts/development/run-a-test-case/). A backend that
already holds the version keeps serving it until a forced re-ingest, so re-ingest
an edited case before running it. See
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Creating a single-sprite variant](/guides/authoring/creating-a-sprite-variant/)
  or [a sprite-sheet variant](/guides/authoring/creating-a-sprite-sheet-variant/), per
  the case's `asset_kind`.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case.
