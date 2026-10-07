---
title: Creating a Voxel Model Variant
---

## Overview

A static voxel-model [asset-generation](/testing/asset-generation/overview/)
test case (`asset_kind = "voxel-model"`) sculpts one 3D model out of opaque
`#rrggbb` voxels into a `[voxel]` volume, toward a goal described in a brief. Its
version offers one or more variants, and a run selects exactly one. Every variant
seeds the version's common specs plus its own additive specs. The chosen
variant's slug is recorded in the run record, so every result is attributed to a
specific build.

This guide is the procedure for adding a variant to an existing static
voxel-model version. The authoritative rules live in
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/) and the
[Manifests overview](/testing/asset-generation/manifests/overview/).

For a rigged case (`asset_kind = "voxel-animation"`) see
[Creating a Voxel Animation Variant](/guides/authoring/creating-a-voxel-animation-variant/).

## Variant scope

An asset-generation case has no target model and declares no `[[reference]]`;
resolution rejects any reference, common or per-variant. The model is
human-reviewed against the brief, so a variant has no target to repoint.

A variant varies two things:

- the brief the model sculpts toward, through an additive spec: a tighter
  palette, a stricter operation budget, a required technique such as symmetry
  via the `mirror` op or a hard voxel-count cap, or another observable
  stylistic constraint;
- the bounding volume, by declaring its own `[voxel]` table. A variant's
  `[voxel]` replaces the case's for runs of that variant, so one case can offer
  the same subject at several sizes. A variant with no `[voxel]` inherits the
  case's volume. The effective volume flows to the seeded tool config, the
  scored model, and any `{{voxel}}` value a spec template reads.

The `asset_kind` is version-level, so a variant cannot turn a static model into
an animation. A genuinely different subject is a new case or a new version rather
than a variant.

An asset-generation case declares no reviewer checklist. The model is judged as a
whole against the brief it was seeded with, on the case's single `overall` domain
(see
[Judged on one overall rating](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating)).
The variant brief is therefore the only place its constraint is recorded, so
write it precisely enough that a reviewer can weigh it.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- slug, lowercase, used in `test-case.toml` and the spec filename, such as
  `symmetric`;
- display name, title case, the variant's `name`, such as `Mirror-Symmetric`;
- description, one line naming the constraint.

Favor a single constraint a reviewer can observe in the regenerated model, either
rotating in the 3D viewer or in the preview PNG.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a delta against the common brief:

- open by stating which common brief it builds on, by name;
- state the added or tightened constraint in precise, testable terms: exact
  colors, an operation cap, the technique required;
- reaffirm that it sculpts toward the same brief, with only the added constraint
  changing.

A spec whose source ends in `.hbs` is rendered per run and may read
`{{voxel.width}}`, `{{voxel.height}}`, and `{{voxel.depth}}`, so a brief that
states its volume reads correctly at every size variant.

A variant spec may reference the common specs freely, since they are always
seeded, and must never reference another variant's spec.

### 3. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose top-level keys
are the variant's fields, then add its path to the `variants` array in
`test-case.toml`. The first entry is the default. Paths inside resolve against
the version folder, and `dest` defaults to `source`.

```toml
# variants/symmetric.toml
slug = "symmetric"
name = "Mirror-Symmetric"
description = "Same subject and volume, built left/right symmetric using the mirror op."
spec = [{ source = "specs/symmetric.md" }]
```

```toml
# variants/double.toml: the same subject in a doubled volume
slug = "double"
name = "Double Size"

[voxel]
width  = 100
height = 40
depth  = 152
background = "transparent"
```

```toml
# test-case.toml: add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/symmetric.toml"]
```

What resolution enforces, and what a variant leaves alone:

- `spec` entries are additive on the common specs. Within one variant, no two
  seeded specs may share a `dest`.
- A `reference` entry is rejected for this test type, on the case and on a
  variant.
- A variant's `[voxel]` is validated exactly as the case's: `width`, `height`,
  and `depth` greater than zero, and a valid `background`.
- `asset_kind` is version-level, so a variant declares none.
- A variant declares no review items, matching the case.

Update the human-readable comment in the manifest that enumerates the variants so
the list stays accurate.

## Validate your work

From the repository root, lint the specs:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

If `cspell` flags a legitimate domain term, add it to `.cspell/project-words.txt`
rather than rewording good prose to dodge the dictionary.

Seed and render the new variant, and re-check the existing ones to confirm your
edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained and
that its effective volume is the one you intended.

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
