---
title: Creating a Mesh Animation Variant
---

An animated meshed [asset-generation](/testing/asset-generation/overview/) test case
(`asset_kind = "mc-animation"`, `"sn-animation"`, or `"dc-animation"`) sculpts and
rigs a 3D model by **compositing per-part signed-distance fields** — a CSG paradigm —
with a `-anim` meshing binary (`mc-anim` / `sn-anim` / `dc-anim`), which extracts a
triangle mesh per part. Its `[model]` table declares only the **required animations**
(`[[model.animation]]` entries: a `name`, a `loop` flag, and an `auto_play` flag) the
model must author as F-curves; the parts, joints, and pivots are the model's to invent —
each part sculpted toward a goal **described in a brief**, with **no target model**. Its
version offers one or more [variants](/testing/end-to-end/overview/#variants), and a run
selects exactly one. Every variant seeds the version's **common specs** (the brief) plus
its own **additive** specs. The chosen variant's slug is recorded in the run record, so
every result is attributed to a specific build.

This guide is the full procedure for adding a variant to an **existing** mesh animation
version. The authoritative rules live in
[Manifests](/testing/asset-generation/manifests/#voxel-cases) (the **Voxel cases**
section) and the tool interface in [Mesh binaries](/testing/asset-generation/mesh-binaries/);
read them first, including the `[model]` animation-contract rules (which are identical to
`voxel-animation`).

For a variant of a **static meshed** case — one model, no rig (any `-model` kind) — see
[Creating a Mesh Model Variant](/guides/authoring/creating-a-mesh-model-variant/) instead. For a
variant of a rigged **VOXEL (cube)** case see
[Creating a Voxel Animation Variant](/guides/authoring/creating-a-voxel-animation-variant/); for a
**2D** sprite case see [Creating a Single-Sprite Variant](/guides/authoring/creating-a-sprite-variant/).
To add a mode to an [end-to-end](/testing/end-to-end/overview/) case instead, see
[Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/). To author a
brand-new case, see
[Authoring a Mesh Animation Test Case](/guides/authoring/authoring-a-mesh-animation-test-case/).

## What a mesh animation variant can (and cannot) change

This is where asset-generation variants differ sharply from end-to-end ones. There is
**no target model** at all, and resolution **forbids any `[[reference]]`** (common *or*
per-variant): the model is human-reviewed against the brief, so a variant has nothing to
repoint — there is none.

Three things are fixed at the **version level** and a variant cannot touch them:

- the **`asset_kind`** — a variant cannot turn an animation into a static model, nor
  switch the meshing binary (the `mc` / `sn` / `dc` surface character is fixed);
- the **`[voxel]`** volume — the field bounds and preview background;
- the **`[model]`** animation contract — the required animation declarations (the
  stable, game-facing set a game plays) are version-level metadata, so every variant
  produces the **same** required animations by the **same** names. The case fixes no
  parts or joints, so those are the model's to invent under every variant, as always.

What a variant *can* do is vary the **brief** the model sculpts toward across that fixed
rig, via an additive spec:

- a **tighter palette** (a subset of the base colors), applied across every part;
- a **stricter operation budget** (fewer primitives / CSG operations across all parts);
- a **required technique** (symmetric parts via the `mirror` op; hard unions only — no
  `--blend` — or, for `dc-anim`, mandatory `--sharp` on all armor edges; a per-part
  primitive cap);
- an **animation constraint** the produced motion makes observable (e.g. the walk must
  keep the fortress supported on at least three feet at all times, or the turret must
  clear the hull across its whole sweep) — stated as a behaviour, not by naming a joint
  the case does not declare.

Review stays exactly as the base: each regenerated **part** is reviewed against the brief
— per part, with no assembled aggregate — and the review UI plays the produced animations
and poses the rig. If you need a genuinely different subject, a different animation
contract, a different algorithm, or a different volume, that is a new **case** (or a new
version), not a variant.

A variant's `spec` entries are **additive** — they layer on top of the common ones
rather than replacing them. A variant adds **no review items**: an asset-generation
case has no reviewer checklist at all, and the produced asset is judged as a whole
against the brief the run was seeded with, on the case's single `overall` domain
(see
[Judged on one overall rating](/testing/asset-generation/manifests/#judged-on-one-overall-rating)).
The variant brief is therefore the *only* place its constraint is recorded — write
it precisely enough that a reviewer can weigh it.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the spec filename (e.g. `armored`);
- **display name** — title case, the variant's `name` (e.g. `Up-Armored`);
- **description** — one line naming the constraint, since there is no menu label to
  carry it.

Favor a single constraint a reviewer can observe in the regenerated model — either in a
still part preview or in the posed 3D viewer (playing the produced animations).

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief ("same subject,
required animations, and mesher as the brief, except …"):

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact colors,
  an operation cap, the CSG technique required), and say whether it applies to every part,
  to a named feature, or to the behaviour of a named animation;
- reaffirm it sculpts toward the **same** brief with the **same** required animations and
  the **same** meshing binary — neither the subject, the surface character, nor the
  animation contract changes, only the added constraint.

A variant spec **may** reference the common specs freely (they are always seeded) but
must **not** reference another variant's spec.

### 3. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose **top-level keys are the
variant's fields**, then add its path to the `variants` array in `test-case.toml` (the
first entry is the default). Do **not** add or change a `[voxel]`, `[model]`, or
`asset_kind` here — all are version-level. Paths inside resolve against the version
folder, and `dest` defaults to `source`:

```toml
# variants/armored.toml
slug = "armored"
name = "Up-Armored"
description = "Same subject, required animations, and mesher, with heavier chassis and turret plating — still clearing the hull as the turret sweeps."
spec = [{ source = "specs/armored.md" }]
```

```toml
# test-case.toml — add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/armored.toml"]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two seeded
  specs (common + own) may share a `dest`.
- **No `reference` entry** — an asset-generation case declares no references at all, so
  any reference (common or per-variant) is rejected.
- **No per-variant `[voxel]` / `[model]` / `asset_kind`** — the volume, the required
  animations, and the asset kind (with its meshing binary) are version-level; a variant
  cannot redeclare them.
- **No `review_item` entries** — an asset-generation case declares no reviewer
  checklist, on the case or on a variant.

Also update the human-readable comment in the manifest that enumerates the variants so
the list stays accurate.

## Validate your work

From the repository root, run the specs linter:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

If `cspell` flags a legitimate domain term, add it to `.cspell/project-words.txt` — do
not reword good prose to dodge the dictionary.

Seed and render the **new** variant, and re-check the **existing** ones to confirm your
edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained (no target
model is seeded), and that it leaves the `[voxel]` volume and the `[model]` animation
contract (the pre-seeded `rig.json`) intact.

A backend-driven run resolves its definition from the backend's store, which skips a
version it already holds — so after adding the variant, **force a re-ingest** or the new
variant will not appear in a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place and is for **development** only.
Adding a variant edits an existing version, so do it only while that version is
unpublished; once a published run references the version it is immutable and a variant
change requires a **new version** instead. See
[Running the services locally](/development/running/).

Then exercise it with [Run a Test Case](/quickstarts/development/run-a-test-case/). Commit on the
repository's default branch with a conventional-commit message scoped to the case, e.g.
`feat(<slug>): add armored variant …`. Do not commit `node_modules/` or local seed
output.
