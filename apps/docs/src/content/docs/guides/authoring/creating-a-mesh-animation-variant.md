---
title: Creating a Mesh Animation Variant
---

## Overview

An animated meshed [asset-generation](/testing/asset-generation/overview/) test
case (`asset_kind = "mc-animation"`, `"sn-animation"`, or `"dc-animation"`)
sculpts and rigs a 3D model by compositing per-part signed-distance fields with a
`-anim` meshing binary, which extracts a triangle mesh per part. Its `[model]`
table declares only the required animations the model must author as F-curves;
the parts, joints, and pivots are the model's to invent. The version offers one
or more variants, and a run selects exactly one. Every variant seeds the
version's common specs plus its own additive specs. The chosen variant's slug is
recorded in the run record, so every result is attributed to a specific build.

This guide is the procedure for adding a variant to an existing mesh-animation
version. The authoritative rules live in
[Voxel cases](/testing/asset-generation/manifests/voxel-cases/), including the
`[model]` animation contract, the tool interface in
[Mesh binaries](/testing/asset-generation/mesh-binaries/), and the
[Manifests overview](/testing/asset-generation/manifests/overview/).

For a static meshed case (any `-model` kind) see
[Creating a Mesh Model Variant](/guides/authoring/creating-a-mesh-model-variant/).
For a rigged cube case see
[Creating a Voxel Animation Variant](/guides/authoring/creating-a-voxel-animation-variant/).

## Variant scope

An asset-generation case has no target model and declares no `[[reference]]`;
resolution rejects any reference, common or per-variant. The model is
human-reviewed against the brief, so a variant has no target to repoint.

A variant varies two things:

- the brief the model sculpts toward across the fixed rig, through an
  additive spec: a tighter palette applied across every part, a stricter budget
  of primitives or CSG operations, a required technique such as symmetric parts
  via the `mirror` op, hard unions with no `--blend`, or mandatory `--sharp` on
  armor edges for a `dc-anim` case, or an animation constraint the produced
  motion makes observable, such as a walk keeping the chassis supported on at
  least three feet. State such a constraint as a behavior rather than by naming
  a joint the case does not declare;
- the field bounds, by declaring its own `[voxel]` table. A variant's
  `[voxel]` replaces the case's for runs of that variant. A variant with no
  `[voxel]` inherits the case's bounds.

Two things are version-level, so a variant leaves them alone: the `asset_kind`,
which fixes the meshing binary and its `mc`, `sn`, or `dc` surface character, and
the `[model]` animation contract. Every variant therefore produces the same
required animations by the same names. The case fixes no parts or joints, so
those stay the model's to invent under every variant.

Review is the same as the base: each regenerated part is reviewed against the
brief, per part, and the review UI plays the produced animations and poses the
rig. An asset-generation case declares no reviewer checklist, so the produced
asset is judged as a whole on the case's single `overall` domain (see
[Judged on one overall rating](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating)).
The variant brief is therefore the only place its constraint is recorded, so
write it precisely enough that a reviewer can weigh it. A different subject, a
different animation contract, or a different algorithm is a new case or a new
version rather than a variant.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- slug, lowercase, used in `test-case.toml` and the spec filename, such as
  `armored`;
- display name, title case, the variant's `name`, such as `Up-Armored`;
- description, one line naming the constraint.

Favor a single constraint a reviewer can observe in the regenerated model, either
in a still part preview or in the posed 3D viewer playing the produced
animations.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a delta against the common brief:

- open by stating which common brief it builds on, by name;
- state the added or tightened constraint in precise, testable terms, such as
  exact colors, an operation cap, or the CSG technique required, and say whether
  it
  applies to every part, to a named feature, or to the behavior of a named
  animation;
- reaffirm that it sculpts toward the same brief with the same required
  animations and the same meshing binary, with only the added constraint
  changing.

A spec whose source ends in `.hbs` is rendered per run and may read
`{{voxel.width}}`, `{{voxel.height}}`, and `{{voxel.depth}}`, so a brief that
states its bounds reads correctly at every size variant.

A variant spec may reference the common specs freely, since they are always
seeded, and must never reference another variant's spec.

### 3. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose top-level keys
are the variant's fields, then add its path to the `variants` array in
`test-case.toml`. The first entry is the default. Paths inside resolve against
the version folder, and `dest` defaults to `source`.

```toml
# variants/armored.toml
slug = "armored"
name = "Up-Armored"
description = "Same subject, required animations, and mesher, with heavier plating."
spec = [{ source = "specs/armored.md" }]
```

```toml
# test-case.toml: add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/armored.toml"]
```

What resolution enforces, and what a variant leaves alone:

- `spec` entries are additive on the common specs. Within one variant, no two
  seeded specs may share a `dest`.
- A `reference` entry is rejected for this test type, on the case and on a
  variant.
- A variant's `[voxel]`, when declared, is validated exactly as the case's.
- `asset_kind` and `[model]` are version-level, so a variant declares neither and
  cannot switch the meshing binary.
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
that it leaves the `[model]` animation contract intact, which the seeded
`rig.json` carries.

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
