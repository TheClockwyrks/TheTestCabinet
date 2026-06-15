# Test Cases

## Overview

A test case is a single game that a model is asked to build. Test cases range
from simple cases such as Pong through to highly complex cases that require
significant assistance from a coding harness for even the best models to
complete. Test cases are intentionally designed to exceed the capabilities of
current state of the art models so that they remain relevant as models and
harnesses improve.

## Catalog Layout

Test cases live in the repository under a top level `test-cases/` folder. Each
test case has its own folder named with a stable slug, and each slug contains one
folder per version:

```
test-cases/<slug>/<version>/
```

Versioning a test case independently allows its design to be revised over time.
Revisions are expected, both to refine a case and to change details between
benchmark runs so that contamination from training data has less impact. Each
version must be self contained so that a run always references an exact,
immutable version.

## Contents

Each test case version must contain:

- A **specification** that describes the game the model must build. This is the
  vision spec for the test case and is the primary material handed to the model.
  It may record both high and low level details, including mechanics, layouts,
  states, and rules. The specification may be split across multiple seeded files
  (see [Variants](#variants)) rather than living in a single file.
- A **prompt template** (`prompt.hbs`) that is rendered into the instruction
  handed to the harness. See [Prompt template](#prompt-template).
- **Reference visuals** in the form of mockups representative of the UIs that
  must be implemented. Each is rendered to a screenshot that is seeded into the
  run as a visual target for the model; the same screenshot is the baseline for
  any validation check that names the view. The mockup *source* is not seeded.
- **Assets** such as sprites that the model should use, when the case requires
  assets that should not be left to the model to generate.
- **Validation criteria** describing what can be checked automatically. See
  [Validation](./validation.md).

The selected variant's specs, the assets, and the rendered reference screenshots
are what gets seeded into a run; the prompt is rendered and handed to the harness
rather than seeded. See [Execution](./execution.md#seeding).

## Manifest

Each test case version declares its contents in a `test-case.toml` manifest in
the version folder. The testing harness reads this manifest to resolve the
version and to decide, unambiguously, what is seeded into a run, which references
are rendered as visual targets, and which validation checks run. Inferring this
from file names alone would be fragile, so it is stated explicitly.

```toml
# test-cases/<slug>/<version>/test-case.toml
name = "Carom"               # human-readable display name (site-facing)
difficulty = "medium"        # relative difficulty: easy | medium | hard (default medium)
tags = ["arcade", "2d"]      # free-form classification tags (site-facing, default empty)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
assets = []                  # asset files/directories, seeded (relative paths)

# Common specs, seeded for EVERY variant. Each maps a `source` inside the
# version folder to a `dest` in the run's workspace.
[[spec]]
source = "specs/overview.md" # source path (relative to this folder)
dest   = "specs/overview.md" # destination in the run workspace (relative)

# Variants. A case offers one or more; exactly one runs per run. Each seeds the
# common specs above plus its own additional specs, and may declare its own
# variant-specific references on top of the common ones.
[[variant]]
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
description = "..."          # optional inline prose (site-facing)
spec = []                    # ADDITIVE specs on top of the common specs
# ADDITIVE references on top of the common ones; same `{ view, path }` shape as a
# `[[reference]]`. Lets a view differ per variant (for example a per-variant menu).
reference = [{ view = "title", path = "reference/menu-base.html" }]

# Common reference views, rendered and seeded for EVERY variant. Each `path`
# mockup is rendered to a screenshot that is seeded as a visual target; the source
# is not seeded. References are not validated unless a check below names them.
[[reference]]
view = "gameplay"            # view slug
path = "reference/gameplay.html" # the reference source mockup (relative to this folder)

# Validation checks (opt-in). Only declared checks run.
[[check]]
view = "title"               # the view this check records under
name = "Title"               # display name (optional; default humanizes the view slug)
reference = "title"          # baseline: the rendered screenshot of this reference
actions = []                 # actions to drive the build into the view (empty = on load)
```

- `name`, `difficulty`, and `tags` are site-facing metadata used to present and
  filter the case; they have no bearing on how a run is executed. `difficulty`
  defaults to `medium` and `tags` to an empty list.
- `description` is an optional path to a Markdown file describing the case for
  the site. Unlike the specs and `assets`, it is **never seeded** into a run — it
  is site-only prose. Like every other path it must resolve inside the version
  folder, and it is validated to exist when declared.
- `prompt` is **required** and points at the Handlebars template that becomes the
  instruction handed to the harness. The template is **rendered, not seeded**;
  see [Prompt template](#prompt-template) below.
- Each `[[spec]]` declares a **common** spec — one seeded for every variant — by
  mapping a `source` file inside the version folder onto a `dest` path in the run
  workspace. The rendered reference screenshots are seeded too. Asset entries may
  be files or directories; a directory is seeded recursively.
- Each `[[variant]]` declares a build the case offers. A run selects exactly one
  variant, which seeds the common specs plus the variant's own `spec` entries;
  see [Variants](#variants) below.
- Each `[[reference]]` declares a **common** reference view — rendered to a
  screenshot and seeded as a visual target for **every** variant; its `path`
  **source** is never seeded. A variant may declare additional, variant-specific
  references through its own `reference` array (same `{ view, path }` shape); see
  [Variants](#variants). A view slug must not be declared both as a common
  reference and by a variant, and a variant must not declare the same view twice.
  All paths are relative to the version folder and must resolve inside it, keeping
  a version self-contained.
- Each `[[check]]` is an opt-in validation comparison. Its `reference` must name a
  reference view that resolves for **every** variant — a common reference, or one
  that each variant declares — whose rendered screenshot is the baseline;
  `actions` drive the built implementation into the view before capture. Its
  optional `name` is a display label, defaulting to a humanized form of `view`.
  See [Validation](./validation.md#checks).

## Prompt template

The instruction handed to the harness is not hard-coded; each version ships a
`prompt.hbs` Handlebars template (named by the manifest's required `prompt`
field) that The Test Cabinet renders into the prompt for a run. Rendering lets a
case word its own instruction while keeping run-specific details — the
in-container paths and the selected variant — out of the authored specifications.
The rendered prompt is handed to the harness; it is **not** seeded to disk. See
[Execution](./execution.md#seeding).

The template is rendered in **strict mode** with HTML escaping disabled (the
output is plain text). Strict mode means referencing any variable other than the
ones below is a render error, rather than silently producing an empty value. The
context exposes exactly:

- `{{workspace}}` — the absolute in-container path of the run workspace, where
  the seeded repository is mounted and the harness builds. This is always `/work`
  and comes from The Test Cabinet, never hardcoded in a spec, so specifications
  stay free of container paths.
- `{{variant.slug}}`, `{{variant.name}}`, and `{{variant.description}}` — the
  selected variant. `description` is empty when the variant declares none.
- `{{#each specs}} … {{/each}}` — the specs seeded for the selected variant, in
  **seed order**: the common specs first, then the variant's own specs. Each spec
  exposes:
  - `{{this.dest}}` — the spec's destination relative to the workspace (for
    example `specs/overview.md`).
  - `{{this.path}}` — the spec's absolute in-container path (for example
    `/work/specs/overview.md`).
  - `{{this.name}}` — the destination file stem (for example `overview`), handy
    for labeling.

Because the absolute paths and variant come from The Test Cabinet at render
time, a specification never needs to mention `/work` or know which variant is
running; the prompt points the model at the seeded files for it.

## Variants

A test case version offers one or more **variants**, and a run selects exactly
one. The chosen variant is recorded in the run record (see
[Run Records](./run-records.md#subject)), so every result is attributed to a
specific build. At least one `[[variant]]` must be declared.

A variant seeds the case's common specs **plus** its own additional specs, so a
single case can define several builds — for example the same game with or without
an extra mode — without duplicating the shared specification. A variant's `spec`
entries are additive: they layer on top of the common specs rather than replacing
them.

Each spec maps a `source` inside the version folder to a `dest` in the run
workspace, and the `dest` may differ from the `source`. This **dest remapping**
lets a variant present a stable path to the model: variant `frenzy` can seed
`specs/modes/frenzy.md` to `specs/mode.md` while variant `classic` seeds
`specs/modes/classic.md` to the same `specs/mode.md`, so the model always reads
the mode at one predictable location regardless of which variant runs.

Within a single variant the common specs and the variant's own specs must not
map two entries onto the same `dest` — a collision would clobber one of them, so
it is rejected at resolution. (Two *different* variants reusing the same `dest`,
as in the remapping example above, is exactly the point and is allowed.)

### Variant-specific references

A variant may also declare **variant-specific references** through a `reference`
array of `{ view, path }` tables, additive on top of the common `[[reference]]`
views just as `spec` is additive on top of the common specs. This lets a single
view differ per variant — for example a main-menu `title` mockup whose listed
modes change with the variant — while the views that look the same everywhere
stay common. Only the selected variant's references (the common set plus that
variant's own) are rendered and seeded for a run.

A view slug identifies a reference uniquely within a variant's effective set, so
a view declared as a common reference must not also be declared by a variant, and
a variant must not declare the same view twice; either collision is rejected at
resolution. (Different variants each declaring their own reference for the *same*
view slug — the per-variant menu above — is exactly the point and is allowed.)
Because a check's baseline must resolve whichever variant runs, a checked view
must be supplied either commonly or by **every** variant.

## Self-Contained Specifications

A test case's specification is seeded into an isolated run container that does
**not** have access to these vision specs, the harness, or any part of the test
case other than what is seeded. The specification must therefore be completely
self-contained.

- It must **not** link to or reference these vision specs, the harness docs, or
  any other file outside what is seeded with the run. Anything the model needs
  must be stated inline.
- When the specification is split across multiple seeded files, no spec may
  reference a file that the running variant does not seed. A common spec is
  seeded for every variant, so it must **not** reference a variant-only spec
  (for example, a common overview cannot point at a mode spec that only one
  variant seeds); a variant's own specs may reference the common specs, since
  those are always present. The selected variant's seeded set — common specs plus
  that variant's own — must be self-contained on its own.
- It may point at the seeded reference **screenshots** (the rendered visual
  targets), but must **not** depend on the reference **source** mockups, which
  are deliberately not seeded so a model cannot copy them in place of building
  from the spec. Every visual detail a model needs — palette, layout,
  measurements, screen contents — must still be written into the specification
  itself; the screenshots illustrate the target, they do not replace the spec.
- Everything required to build the game must live in the seeded files: the
  selected variant's specs and the test case's assets.

These same constraints apply to a test case's assets, which are seeded alongside
the specification: they must be usable without any file that is not seeded.

## Assets

The goal of The Test Cabinet is to evaluate model capability on large software
development tasks, not asset generation. A test case must therefore either be
simple enough that no assets are needed, or it must pre-provide the assets a
model should use.

- Simple cases such as Pong need no assets and may leave all visuals to the
  model.
- More involved cases must provide a set of assets so that each run does not have
  to produce its own, which would make runs less comparable.

## Design Requirements

Every test case must satisfy the following:

- It must be **inspired by but not a clone of** the original game. Test cases may
  reuse mechanics from the games that inspire them, but must not recreate the
  original assets, branding, or exact designs. All specifications, reference
  visuals, and assets must be original works produced for The Test Cabinet.
- The final product must **not require API keys**. A visitor must be able to play
  a published implementation without supplying any credentials or incurring any
  cost.
- The final product must **not require backend support**. Every test case must be
  runnable in a browser with no accounts, databases, or other significant server
  side dependencies.
- It must be possible to **specify visuals precisely enough** that an initial
  automated assessment pass can compare an implementation against the reference
  visuals.

## Provided Tests

A test case may provide some tests as part of its specification. These tests must
not be hidden from the model, and the model must not be blocked from writing
additional tests of its own. The challenge of a test case must come from the
case itself, not from the testing harness withholding information. See
[Execution](./execution.md#model-authored-tests).
