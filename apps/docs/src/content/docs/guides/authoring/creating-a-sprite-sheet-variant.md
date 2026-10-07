---
title: Creating a Sprite-Sheet Variant
---

## Overview

A sprite-sheet [asset-generation](/testing/asset-generation/overview/) test case
(`asset_kind = "sprite-sheet"`) draws a set of animation frames, each its own
file, to match a written brief. A `[sheet]` table declares the frames and the
named sequences a reviewer plays back. Its version offers one or more variants,
and a run selects exactly one. Every variant seeds the version's common specs
plus its own additive specs. The chosen variant's slug is recorded in the run
record, so every result is attributed to a specific build.

This guide is the procedure for adding a variant to an existing sprite-sheet
version. The authoritative rules live in
[Sprite cases](/testing/asset-generation/manifests/sprite-cases/) and the
[Manifests overview](/testing/asset-generation/manifests/overview/).

## Variant scope

An asset-generation case has no target image and declares no `[[reference]]`;
resolution rejects any reference, common or per-variant. A variant therefore has
nothing to repoint: the model draws to match the brief.

Three things are version-level, so a variant leaves them alone: the
`asset_kind`, the `[canvas]` frame size, and the `[sheet]` layout of declared
frames and named sequences. Every variant therefore draws the same frames and
animates them at the same fps.

What a variant varies is the brief itself, through an additive spec: a tighter
palette applied across every frame, a stricter operation budget, a required
drawing technique such as flat fills or left-right symmetry between mirrored
directions, or a cross-frame consistency rule the animation makes observable. A
different subject, a different set of frames, or different sequences is a new
case or a new version rather than a variant.

Review is the same as the base. Each regenerated frame is judged against the
brief, per frame, and the sequences drive the review UI's animated playback. An
asset-generation case declares no reviewer checklist, so the produced sheet is
judged as a whole on the case's single `overall` domain (see
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

Favor a single constraint a reviewer can observe in the regenerated sheet, either
in a still frame or in a sequence the review UI plays back.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a delta against the common brief:

- open by stating which common brief it builds on, by name;
- state the added or tightened constraint in precise, testable terms, such as
  exact colors, an operation cap, or the technique required, and say whether it
  applies to every frame, to a named sequence, or across frames;
- reaffirm that it draws to match the same brief against the same frames and
  sequences, with only the added constraint changing.

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
description = "Same brief and sheet, drawn with flat fills only, across every frame."
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
- `asset_kind`, `[canvas]`, and `[sheet]` are version-level, so a variant
  declares none of them.
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

Read the seeded output to confirm the new variant's brief is self-contained and
leaves the `[sheet]` frames and sequences intact, then lint the specs with
`npm run lint:specs`. If `cspell` flags a legitimate domain term, add it to
`.cspell/project-words.txt`.

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
