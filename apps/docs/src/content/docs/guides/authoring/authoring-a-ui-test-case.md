---
title: Authoring a UI Test Case
---

## Overview

A UI [asset-generation](/testing/asset-generation/overview/#interface-assets)
test case (`asset_kind = "ui"`) asks a model to paint a high-resolution
interface asset to match a written brief: a HUD plate, a panel, a button, a
frame, an icon, an insignia, a title, or a full-screen background. There is no
target image. The model is given a precise description and paints something that
matches it.

Read [UI cases](/testing/asset-generation/manifests/ui-cases/) for the
authoritative manifest schema and
[The UI binaries](/testing/asset-generation/ui-binaries/) for how the two tools
behave. The worked example is `thunderhead-hud`, a fleet-command HUD kit of five
elements under `test-cases/asset-generation/medium/thunderhead-hud/`.

## The two tools

A UI case's brief must direct the model to both binaries. Both ship in the one
`ui` run-container image and both are on `PATH`.

- `paint` is the primary layered raster painter, named in `[tool].binary`. It
  carries named layers, alpha compositing and blend modes, soft, hard and
  textured brushes, gradients, selections, masks, filters, and layer effects. It
  is the tool for painterly work: soft shading, glows, gradients, grime.
- `ui` is the companion crisp composition tool over the same workspace: exact
  anti-aliased vector shapes, text in baked fonts, and nine-slice authoring. It
  is the tool for structural, pixel-crisp parts such as a panel frame, a button
  body, a label, or a set of scalable insets.

The two are front-ends over one shared workspace and one recorded operation log,
so a run interleaves them freely. Both are the only channel that counts. The
flattened PNGs core emits are the run's authoritative output.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/` and is
immutable once a run references it. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, canvas, ui, tool, output, domain
  variants/              # one standalone TOML file per variant, listed in `variants`
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # required per-version changelog entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief (SEEDED)
```

A run receives the selected variant's specs, the `paint` and `ui` binaries whose
`--help` is the operations contract, a seeded `paint.config.json` carrying the
canvas, the declared elements, and the log, preview, and `ui.json` paths, and one
blank preview PNG per element. No operations schema is seeded.

## Procedure

### 1. Choose the subject and the shape

Pick a catalog slug for the lineage and the asset to paint, then decide the
case's shape. This is a version-level choice rather than a variant axis:

- a single full-canvas image, such as a title screen or one HUD backdrop.
  Declare no `[ui]` table and the case has one implicit element, the whole
  `[canvas]`.
- a kit of named elements, such as a panel, a frame, and an icon. Declare a
  `[ui]` table listing each element, its size, and any fixed nine-slice insets.

A good UI subject reads clearly at its authored resolution, needs no surrounding
game context, and exercises both crisp structure and painterly depth. A frame or
panel should also exercise a nine-slice stretch region. Pick a `version`
(`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` as a single self-contained file describing:

- the interface's role: what the asset is, where it sits in a game's UI, and the
  mood it conveys, so a reviewer can judge whether the painted result reads
  correctly;
- the exact palette, as named colors with hex values, stated as the colors the
  asset is built from;
- the element kit: name every element and give each one its size and, for a
  frame, panel, or button, its nine-slice stretch region. The stretch region
  names which border margins stay fixed while the center and edges stretch, so
  the piece scales in-game without distorting. For a single-image case, describe
  the one full-canvas composition instead;
- how the two tools behave: that `paint` is the primary painter and `ui` the
  companion crisp shape, text, and nine-slice tool, that both are on `PATH`,
  that they share one workspace and one recorded log, that each re-renders the
  affected element's preview after every operation, and that the emitted
  flattened PNGs are the output.

The brief must stand on its own with no link outside the seeded set, and every
visual detail written in real terms. A shared quality directive is prepended to
every asset-generation prompt at render time, so keep the brief factual.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read
both binaries' `--help` for the operations, and stating the hard requirements:
paint only through `paint` and `ui`, target each element with `--element`, and
stop when finished. The template renders in strict mode, so use only the
documented variables: `{{variant.slug}}`, `{{variant.name}}`,
`{{variant.description}}`, `{{time_limit_hours}}`, `{{workspace}}`, and
`{{#each specs}}` over each seeded spec's `{{this.path}}`.

### 4. Write the manifest

Author `test-case.toml` per
[UI cases](/testing/asset-generation/manifests/ui-cases/). The tables specific to
this kind:

```toml
type = "asset-generation"    # required; omitting it defaults to end-to-end
asset_kind = "ui"

variants = ["variants/base.toml"]

# The base element size, also the single-image size, and initial background.
[canvas]
width = 512
height = 512
background = "transparent"

# `binary` names the PRIMARY painter; `ui` ships in the same image and is on PATH.
# `preview` carries {element} for a kit and is a single file otherwise.
[tool]
binary = "paint"
preview = "elements/{element}.png"

# One interleaved log for the whole asset; each op carries its own --element.
[output]
actions = "actions.json"

# The KIT of named elements. Omit [ui] entirely for a single full-canvas image.
[ui]

[[ui.element]]
name = "health-bar-frame"
width = 512
height = 96
nine_slice = { left = 40, right = 40, top = 24, bottom = 24 }

[[ui.element]]
name = "faction-crest"      # fixed size, never stretched, so no nine_slice
width = 256
height = 256

[[spec]]
source = "specs/brief.md"

[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

Points to get right:

- `[canvas]` fixes the base element size and initial `background`.
- Every `[[ui.element]]` needs a unique `name`, a `width`, and a `height`. Any
  fixed `nine_slice` insets must fit within the element's bounds. An element
  with no declared `nine_slice` can still have the model author one at run time
  with `ui set-nine-slice`.
- `[output].actions` is a single log rather than an `{element}` template,
  because the two binaries share one recorded stream.
- Core emits the flattened per-element PNGs and `ui.json` to paths it provides,
  so neither is manifest-declared.
- A UI case declares no `[[reference]]`, no `[build]`, and no `[[check]]`.
- The single `overall` `[[domain]]` is the whole review. The painted kit is
  judged as a whole against its brief, so the case declares no `[[review_item]]`
  on itself or on a variant. See
  [Judged on one overall rating](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating).
- A variant varies only the seeded brief through an additive `[[spec]]`: a
  tighter palette, an operation budget, a required technique.

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md` (the required per-version entry),
and `README.md` (human overview). These never reach a run.

## Validate your work

Resolve and seed the case. For every variant:

```sh
tcab prompt --test-case thunderhead-hud --version v1.0.0 --variant base
tcab seed   --test-case thunderhead-hud --version v1.0.0 --variant base
```

`prompt` renders the instruction, catching strict-mode template errors and
manifest problems. `seed` writes the seeded repository to disk so you can read
exactly what the model would receive and confirm it is self-contained. Lint the
specs with `npm run lint:specs`, then exercise the case end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case against its brief.
