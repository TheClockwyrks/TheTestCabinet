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
  states, and rules.
- **Reference visuals** in the form of mockups representative of the UIs that
  must be implemented. Each is rendered to a screenshot that is seeded into the
  run as a visual target for the model; the same screenshot is the baseline for
  any validation check that names the view. The mockup *source* is not seeded.
- **Assets** such as sprites that the model should use, when the case requires
  assets that should not be left to the model to generate.
- **Validation criteria** describing what can be checked automatically. See
  [Validation](./validation.md).

The specification, assets, and rendered reference screenshots are what gets
seeded into a run. See [Execution](./execution.md#seeding).

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
spec = "specification.md"    # the specification, seeded (relative to this folder)
assets = []                  # asset files/directories, seeded (relative paths)

# Reference views. Each `path` mockup is rendered to a screenshot that is seeded
# as a visual target; the source is not seeded. References are not validated
# unless a check below names them.
[[reference]]
view = "title"               # view slug
path = "reference/menu.html" # the reference source mockup (relative to this folder)

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
  the site. Unlike `spec` and `assets`, it is **never seeded** into a run — it
  is site-only prose. Like every other path it must resolve inside the version
  folder, and it is validated to exist when declared.
- `spec`, every entry in `assets`, and the **rendered** reference screenshots are
  what is seeded into a run. Asset entries may be files or directories; a
  directory is seeded recursively.
- Each `[[reference]]` is rendered to a screenshot (seeded as a visual target);
  its `path` **source** is never seeded. All paths are relative to the version
  folder and must resolve inside it, keeping a version self-contained.
- Each `[[check]]` is an opt-in validation comparison. Its `reference` must name a
  declared reference view, whose rendered screenshot is the baseline; `actions`
  drive the built implementation into the view before capture. Its optional
  `name` is a display label, defaulting to a humanized form of `view`. See
  [Validation](./validation.md#checks).

## Self-Contained Specifications

A test case's specification is seeded into an isolated run container that does
**not** have access to these vision specs, the harness, or any part of the test
case other than what is seeded. The specification must therefore be completely
self-contained.

- It must **not** link to or reference these vision specs, the harness docs, or
  any other file outside what is seeded with the run. Anything the model needs
  must be stated inline.
- It may point at the seeded reference **screenshots** (the rendered visual
  targets), but must **not** depend on the reference **source** mockups, which
  are deliberately not seeded so a model cannot copy them in place of building
  from the spec. Every visual detail a model needs — palette, layout,
  measurements, screen contents — must still be written into the specification
  itself; the screenshots illustrate the target, they do not replace the spec.
- Everything required to build the game must live in the seeded files: the
  specification and the test case's assets.

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
