---
title: Authoring a UI Test Case
---

A **UI** [asset-generation](/testing/asset-generation/overview/) test case
(`asset_kind = "ui"`) asks a model to **paint a high-resolution interface asset** —
a HUD plate, a panel, a button, a frame, an icon, insignia, a title, or a
full-screen background — to **match a written brief**, rather than to build a game or
draw a small pixel sprite. Like every asset-generation case there is **no target
image**: the model is given a precise description and the freedom to paint something
that matches it, so the case rewards craft rather than the faithful reproduction of a
supplied picture. Authoring one is mostly writing a precise, **self-contained brief**.

Where a [sprite case](/guides/authoring-an-asset-generation-test-case/) draws a
32–64 px canvas with the replace-pixel `draw` tool, a UI case paints a **large RGBA
canvas** (typically 256–2048 px) with a full layer stack, alpha compositing, and the
finishing passes a professional interface needs. It uses **two binaries** — read
[The UI binaries](/testing/asset-generation/ui-binaries/) first, it is the key
tool-behavior reference — and produces **either one full-canvas image or a kit of
named elements**. [Manifests](/testing/asset-generation/manifests/#ui-cases) is the
authoritative schema (the `[ui]`, `[canvas]`, `[tool]`, and `[output]` tables and the
rules enforced at resolution); the [Overview](/testing/asset-generation/overview/#user-interface-assets)
explains what the kind is for; and [Evaluation](/testing/asset-generation/evaluation/#ui-validation)
covers how a UI run is validated and reviewed. Read those before you start.

Building a playable game instead is a different test type with its own manifest; see
[Authoring an End-to-End Test Case](/guides/authoring-an-end-to-end-test-case/). For a
2D pixel sprite or sheet use
[Authoring an Asset-Generation Test Case](/guides/authoring-an-asset-generation-test-case/).

Throughout this guide the worked example is **`thunderhead-hud`**, a fleet-command
HUD **kit** of three elements — a health-bar frame, a minimap bezel, and a faction
crest — authored alongside this guide. A new UI case should look like it.

## The two tools

A UI case's brief must direct the model to **both** binaries, which ship in the one
**`ui` run-container image** and are both on `PATH`:

- **`paint`** — the **primary** layered raster painter (named in `[tool].binary`): a
  Photoshop-style editor with named layers, alpha compositing and blend modes,
  soft/hard/textured brushes, gradients, selections, masks, filters, and layer
  effects (bevels, inner shadows, strokes, glows). It is the tool for painterly
  work — soft shading, glows, gradients, grime.
- **`ui`** — the companion **crisp UI-composition tool** layered over the same
  workspace: exact anti-aliased vector shapes (rounded rectangles, strokes,
  polygons), **text** in baked fonts, and **nine-slice** authoring. It is the tool
  for the structural, pixel-crisp parts — a panel frame, a button body, a label, a
  set of scalable insets.

The two are front-ends over **one shared workspace and one recorded operation log**,
so a run freely interleaves them: block a panel out with `ui rounded-rect`, shade it
with `paint gradient`, stamp a label with `ui text`, then mark its stretch region
with `ui set-nine-slice`. Both are the **only** channel that counts — the emitted
flattened PNGs are the run's authoritative output, and anything produced by other
means contributes nothing.

## What a case is, and what gets seeded

A version lives under `test-cases/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, canvas, ui, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: what to paint + how the tools behave — SEEDED
```

A run receives only the seeded files: the selected variant's brief. There is **no
target image** — the model paints to match the brief, not to copy a supplied picture.
It also gets the `paint` and `ui` binaries in its environment (whose `--help` is the
operations contract) and a seeded `paint.config.json` plus a blank workspace per
element; **no operations schema is seeded**. Everything marked *NOT seeded* is
authoring- or site-side only.

## Procedure

### 1. Choose the subject and confirm it qualifies

Pick a catalog **slug** for the lineage (e.g. `thunderhead-hud`) and the **asset** to
paint. Then decide the case's **shape** — this is a version-level choice, not a
variant axis:

- a **single full-canvas image** (a title screen, one HUD backdrop) — declare no
  `[ui]` table, and the case has one implicit element, the whole `[canvas]`; or
- a **kit** of named elements (a `panel`, a `frame`, an `icon`) — declare a `[ui]`
  table listing each element, its size, and any fixed nine-slice insets.

A good UI subject reads clearly at its authored resolution, needs no surrounding game
context, and exercises what the kind is for — crisp structure from `ui`, painterly
depth from `paint`, and, for a frame or panel, a **nine-slice** stretch region.
`thunderhead-hud` is a kit because its three pieces are distinct interface parts of
different sizes. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file describing:

- **the interface's role** — what the asset is, where it sits in a game's UI, and
  the mood it must convey (for `thunderhead-hud`: a cold, military fleet-command
  overlay), so a reviewer can judge whether the painted result reads correctly;
- **the exact palette** — named colors with **hex values**, stated as the colors the
  asset is built from, so a reviewer can judge it against the brief unambiguously;
- **the element kit** — name every element and give, for each, its **size** and — for
  a frame, panel, or button — the **nine-slice stretch region**: which border margins
  stay fixed (corners, a crest, a rivet) while the center and edges stretch, so the
  piece scales to any size in-game without distorting. For a single-image case,
  describe the one full-canvas composition instead;
- **how the two tools behave** — that `paint` is the primary painter and `ui` the
  companion crisp-shape/text/nine-slice tool, that both are on `PATH`, that they share
  one workspace and one recorded log, that each re-renders the affected element's
  preview after every operation, and that **only marks made through the two binaries
  count** — the emitted flattened PNGs are the output, and anything drawn outside the
  tools is discarded.

The same self-containment and precise-values rules as any spec apply: the brief must
stand on its own, with no link outside the seeded set, and every visual detail —
palette, sizes, insets, framing — written in real terms. You do **not** need to
restate "make it look good": a shared **quality directive** (the brief is the floor,
not the goal — produce the best-looking asset you can within its constraints) is
prepended to every asset-generation prompt at render time, so keep `prompt.hbs` and
the brief factual.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read
**both** binaries' `--help` for the operations, and states the hard requirements
(paint only through `paint`/`ui`; target each element with `--element`; stop when
finished). The template renders in **strict mode**, so use only the documented
variables — `{{variant.slug}}` / `{{variant.name}}` / `{{variant.description}}`,
`{{#each specs}}` (each `{{this.path}}` a seeded brief path), and `{{workspace}}`
(the seeded workspace directory). Referencing anything else fails the render.

### 4. Write the manifest

Author `test-case.toml` per the [schema](/testing/asset-generation/manifests/#ui-cases).
Here is a complete, realistic manifest for the `thunderhead-hud` kit:

```toml
# test-cases/thunderhead-hud/v1.0.0/test-case.toml
slug = "thunderhead-hud"
name = "Thunderhead HUD"
difficulty = "hard"
tags = ["asset-generation", "ui", "hud"]
summary = """
Paint the Thunderhead fleet-command HUD kit — a stretchable health-bar frame, a \
minimap bezel, and a faction crest — as high-resolution interface art, using the \
paint and ui binaries, one recorded operation at a time."""
description = "description.md"
prompt = "prompt.hbs"
max_runtime_hours = 1
type = "asset-generation"            # REQUIRED; omitting it defaults to end-to-end
asset_kind = "ui"

# Variants: an ORDERED list of standalone variant files (first = default). A root
# key, so it must precede the first table header.
variants = ["variants/base.toml"]

# The base element size (also the single-image size) and initial background.
[canvas]
width = 512
height = 512
background = "transparent"

# The drawing tools. `binary` names the PRIMARY painter (`paint`); the companion
# `ui` binary (crisp shapes, text, nine-slice) ships in the SAME image and is on
# PATH — the brief directs the model to both. `preview` is an {element} template for
# a kit (a single file, e.g. "canvas.png", for a single-image case).
[tool]
binary = "paint"
preview = "elements/{element}.png"

# The recorded op log — a SINGLE interleaved record for the whole asset (each op
# carries --element). NOT an {element} template. Core emits the flattened per-element
# PNGs and ui.json automatically; those are not declared here.
[output]
actions = "actions.json"

# The KIT of named elements. Each is its own document of its own size — the
# interface analogue of a sprite sheet's frames. Omit the whole [ui] table for a
# single full-canvas image.
[ui]

# A wide health-bar frame that stretches horizontally: the left cap, right cap, and
# top/bottom rails stay fixed while the center rail tiles to fit any bar length.
[[ui.element]]
name = "health-bar-frame"
width = 512
height = 96
nine_slice = { left = 40, right = 40, top = 24, bottom = 24 }

# A square minimap bezel that stretches to any minimap size, its riveted corners held.
[[ui.element]]
name = "minimap-bezel"
width = 384
height = 384
nine_slice = { left = 48, right = 48, top = 48, bottom = 48 }

# A fixed-size insignia — no nine-slice, it is never stretched.
[[ui.element]]
name = "faction-crest"
width = 256
height = 256

# Common specs, seeded for EVERY variant (dest defaults to source).
[[spec]]
source = "specs/brief.md"

# At least one scoring domain, rated for EVERY variant.
[[domain]]
id = "fidelity"
name = "Fidelity"
description = "How faithfully the painted kit matches the brief — role, palette, and each element's form."

# Reporter-side reviewer checklist (NOT seeded). A review item carries only a
# `domain` and optional weight/title/text/id; it must NOT carry a `reference`.
[[review_item]]
id = "palette"
title = "Cold command palette"
text = """
Every element uses the fleet-command palette from the brief (hull navy, hologram \
cyan, warning amber, steel edge) with no out-of-palette colors."""
weight = 1
domain = "fidelity"

[[review_item]]
id = "nine-slice-holds"
title = "Frame and bezel stretch cleanly"
text = """
The health-bar frame and minimap bezel keep their corners and caps crisp when \
stretched to a game size — the nine-slice stretch preview shows no distorted \
corners or smeared rivets."""
weight = 3
domain = "fidelity"

[[review_item]]
id = "crest-reads"
title = "Faction crest reads as insignia"
text = """
The faction crest reads clearly as a military emblem at its 256x256 size — a bold, \
centered silhouette, not a soft blob — using both crisp `ui` shapes and `paint` \
shading."""
weight = 2
domain = "fidelity"
```

Key rules the resolver enforces (see [the schema](/testing/asset-generation/manifests/#ui-cases)):

- **`type = "asset-generation"`** is required; omitting it defaults to `end-to-end`,
  which then rejects the `[canvas]`/`[ui]`/`[tool]`/`[output]` tables.
- **`[canvas]`** fixes the base element size and initial `background` (the whole
  canvas for a single-image case; the base size a kit's elements are declared
  against).
- **`[ui]`** is **optional** and valid only for `asset_kind = "ui"`. When present it
  declares one or more `[[ui.element]]` entries, each with a **unique `name`**, a
  `width`, a `height`, and an optional `nine_slice = { left, right, top, bottom }`.
  Omit `[ui]` entirely for a single full-canvas image. Resolution checks that names
  are unique and that any fixed `nine_slice` insets fit within the element's bounds.
  An element that carries no `nine_slice` here can still have the model author one at
  run time with `ui set-nine-slice`.
- **`[tool].binary`** is `paint` (the primary painter). **`[tool].preview`** carries
  the `{element}` token for a kit and is a single file (e.g. `canvas.png`) for a
  single-image case.
- **`[output].actions`** is a **single** interleaved op log (e.g. `actions.json`) —
  **not** an `{element}` template — because the two binaries share one recorded
  stream and each op carries its own `--element`.
- **Core emits the flattened per-element PNGs (`elements/{element}.png`, or
  `canvas.png`) and `ui.json` automatically** — these are the authoritative output,
  and they are **not** manifest-declared paths.
- **No `[[reference]]`, no `[build]`, no `[[check]]`.** A UI case has no target image
  (declaring a `[[reference]]`, common or per-variant, is rejected); it produces
  emitted image data, not a static site; and — unlike `draw`/`draw-sheet` — it has
  **no cheat-divergence check**, because the emitted PNGs are the authoritative
  output however they were produced.
- A **`variants`** list (an ordered array of standalone TOML files under `variants/`;
  the first is the default, at least one required, usually `base`) and at least one
  **`[[domain]]`**. A variant here varies only the seeded **brief** (an additive
  `[[spec]]`) — a tighter palette, an operation budget, a required technique — never a
  reference. Its file looks like:

  ```toml
  # test-cases/thunderhead-hud/v1.0.0/variants/base.toml
  slug = "base"
  name = "Base"
  spec = []                # ADDITIVE specs on top of the common specs
  # review_item = [...]    # ADDITIVE reviewer items (optional)
  # [[domain]]             # ADDITIONAL domains rated only for this variant (optional)
  ```

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded (the brief only) and what core emits (the
flattened PNGs and `ui.json`).

## Validate your work

There is no separate authoring linter — you validate a case by resolving and seeding
it. For **every** variant:

```sh
tcab prompt --test-case thunderhead-hud --version v1.0.0 --variant base
tcab seed   --test-case thunderhead-hud --version v1.0.0 --variant base
```

`prompt` renders the instruction (catching strict-mode template errors and manifest
problems); `seed` writes the seeded repository to disk so you can read exactly what
the model would receive — the brief, plus the seeded `paint.config.json` and blank
per-element workspace — and confirm it is self-contained. When the case is ready,
exercise it end to end with [Run a Test Case](/quickstarts/run-a-test-case/).

## Next steps

- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess a run of
  your case against its brief (the rendered elements and their nine-slice stretch
  previews).
