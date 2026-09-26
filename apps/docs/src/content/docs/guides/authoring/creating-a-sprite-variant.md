---
title: Creating a Single-Sprite Variant
---

## Overview

A single-sprite [asset-generation](/testing/asset-generation/overview/) test case
(`asset_kind = "sprite"`, the default) draws one sprite onto the whole canvas to
match a written brief. Its version offers one or more variants, and a run selects
exactly one. Every variant seeds the version's common specs plus its own additive
specs. The chosen variant's slug is recorded in the run record, so every result
is attributed to a specific build.

This guide is the procedure for adding a variant to an existing single-sprite
version. The authoritative rules live in
[Sprite cases](/testing/asset-generation/manifests/sprite-cases/) and the
[Manifests overview](/testing/asset-generation/manifests/overview/).

## Variant scope

An asset-generation case has no target image and declares no `[[reference]]`;
resolution rejects any reference, common or per-variant. A variant therefore has
nothing to repoint: the model draws to match the brief.

What a variant varies is the brief itself, through an additive spec: a tighter
palette, a stricter operation budget, a required drawing technique such as flat
fills only, or another stylistic constraint. A genuinely different subject is a
new case rather than a variant.

The `asset_kind` and the `[canvas]` are version-level, so every variant draws the
same size sprite.

An asset-generation case declares no reviewer checklist. The sprite is judged as
a whole against the brief it was seeded with, on the case's single `overall`
domain (see
[Judged on one overall rating](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating)).
The variant brief is therefore the only place its constraint is recorded, so
write it precisely enough that a reviewer can weigh it.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- slug, lowercase, used in `test-case.toml` and the spec filename, such as
  `flat`;
- display name, title case, the variant's `name`, such as `Flat Shading`;
- description, one line naming the constraint.

Favor a single constraint a reviewer can observe in the regenerated sprite.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a delta against the common brief:

- open by stating which common brief it builds on, by name;
- state the added or tightened constraint in precise, testable terms: exact
  colors, an operation cap, the technique required;
- reaffirm that it draws to match the same brief, with only the added constraint
  changing.

A variant spec may reference the common specs freely, since they are always
seeded, and must never reference another variant's spec.

### 3. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose top-level keys
are the variant's fields, then add its path to the `variants` array in
`test-case.toml`. The first entry is the default. Paths inside resolve against
the version folder, and `dest` defaults to `source`.

```toml
# variants/flat.toml
slug = "flat"
name = "Flat Shading"
description = "Same brief, drawn with flat fills only rather than gradients or dithering."
spec = [{ source = "specs/flat.md" }]
```

```toml
# test-case.toml: add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/flat.toml"]
```

What resolution enforces, and what a variant leaves alone:

- `spec` entries are additive on the common specs. Within one variant, no two
  seeded specs may share a `dest`.
- A `reference` entry is rejected for this test type, on the case and on a
  variant.
- `asset_kind` and `[canvas]` are version-level, so a variant declares neither.
- A variant declares no review items, matching the case.

Update the human-readable comment in the manifest that enumerates the variants so
the list stays accurate.

## Validate your work

Seed and render the new variant, and re-check the existing ones to confirm your
edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained, then
lint the specs with `npm run lint:specs`. If `cspell` flags a legitimate domain
term, add it to `.cspell/project-words.txt`.

The backend's definition store is immutable per case version, so force a
re-ingest before running:

```sh
scripts/reingest.sh --force <slug>
```

Force re-ingest overwrites the stored version in place and is for development
only. Adding a variant edits an existing version, so do it only while that
version is unpublished; a version a published run references is
[frozen](/development/frozen-versions/) and needs a new version instead. Then
exercise the variant with
[Run a Test Case](/quickstarts/development/run-a-test-case/).
