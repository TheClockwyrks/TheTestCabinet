---
description: Read this skill before adding a new variant to an existing VOXEL-ANIMATION asset-generation test case (asset_kind = "voxel-animation") — a brief variation (tighter palette, operation budget, sculpting technique, or an animation constraint) the model builds toward the brief across the case's fixed required animations, registered in a version's test-case.toml. For a variant of a static voxel-model case use adding-a-voxel-model-variant; for a 2D sprite/sprite-sheet case use adding-a-sprite-variant / adding-a-sprite-sheet-variant; for an end-to-end case use adding-an-end-to-end-variant.
name: adding-a-voxel-animation-variant
---

# Adding a Voxel-Animation (Rigged) Variant

## What a voxel-animation variant is

A voxel-animation
[asset-generation](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
test case (`asset_kind = "voxel-animation"`) sculpts and rigs a 3D model out of
opaque `#rrggbb` voxels — a `[model]` table declares only the **required animations**
(`[[model.animation]]` entries: a `name`, a `loop` flag, and an `auto_play` flag) the
model must author as F-curves; the parts, joints, and pivots are the model's to
invent — each sculpted toward a goal **described in a brief** (there is no
target model). Its version offers one or more **variants**, and a run selects
exactly one. Every variant seeds the version's **common specs** (the brief) plus
its own **additive** specs. The chosen variant's slug is recorded in the run
record.

This skill covers variants of **voxel-animation** cases. For a variant of a
**static voxel-model** case — one model, no rig — use the
[`adding-a-voxel-model-variant`](../adding-a-voxel-model-variant/SKILL.md) skill.
For a variant of a **2D** case use
[`adding-a-sprite-variant`](../adding-a-sprite-variant/SKILL.md) or
[`adding-a-sprite-sheet-variant`](../adding-a-sprite-sheet-variant/SKILL.md); for an
**end-to-end** case use
[`adding-an-end-to-end-variant`](../adding-an-end-to-end-variant/SKILL.md). To author
a brand-new case, use
[`authoring-a-voxel-animation-test-case`](../authoring-a-voxel-animation-test-case/SKILL.md).

The authoritative schema lives in
[`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
(the **Voxel cases** section); read it before starting — including the `[model]`
animation-contract rules.

## The defining constraint: a variant varies the brief; the rig is fixed

This is where asset-generation variants differ sharply from end-to-end ones. There
is **no target model** at all, and resolution **forbids any `[[reference]]`**
(common *or* per-variant), per-variant `[voxel]` tables, and per-variant `[model]`
tables. The model is human-reviewed against the brief, so a variant has nothing to
"change the target" of — there is none.

Three things are fixed at the **version level** and a variant cannot touch them:

- the **`asset_kind`** — a variant cannot turn an animation into a static model;
- the **`[voxel]`** volume — the dimensions and preview background;
- the **`[model]`** animation contract — the required animation declarations (the
  stable, game-facing set a game plays) are version-level metadata, so every variant
  produces the **same** required animations by the **same** names. The case fixes no
  parts or joints, so those are the model's to invent under every variant, as always.

What a variant *can* do is vary the **brief** the model sculpts toward across that
fixed rig, via an additive spec:

- a **tighter palette** (a subset of the base colors), applied across every part;
- a **stricter operation budget** (fewer operations allowed across all parts);
- a **required technique** (symmetric parts via the `mirror` op; solid fills only; a
  per-part voxel-count cap);
- an **animation constraint** the produced motion makes observable (e.g. the walk
  must keep the fortress supported on at least three feet at all times, or the turret
  must clear the hull across its whole sweep) — stated as a behaviour, not by naming
  a joint the case does not declare.

Review stays exactly the same as the base: each regenerated **part** is reviewed
against the brief — **per part**, with no assembled aggregate — and the review UI
plays the produced animations and poses the rig. If you need a genuinely different
subject, a different animation contract, or a different volume, that is a new
**case** (or a new version), not a variant.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the spec filename (e.g.
  `armored`);
- **display name** — title case, the variant's `name` (e.g. `Up-Armored`);
- **description** — one line naming the constraint.

Favor a single constraint a reviewer can observe in the regenerated model — either
in a still part preview or in the posed 3D viewer (playing the produced animations).

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief:

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact
  colors, an operation cap, the technique required), and say whether it applies to
  every part, to a named feature, or to the behaviour of a named animation;
- reaffirm it sculpts toward the **same** brief with the **same** required
  animations — neither the subject nor the animation contract changes, only the
  added constraint.

A variant spec **may** reference the common specs freely (always seeded) but must
**not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the
variation makes checkable that the base does not — this can be something the
**animated** model reveals (e.g. "the up-armored turret still clears the hull as it
sweeps"). Name the required animation the item judges in the item's `text` — the
review UI plays the produced animations and poses the rig beside the checklist. Each
item is reporter-side (never seeded), carries a stable `id` unique within the
variant's effective set, and a scoring `domain` (no `reference`).

### 4. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose **top-level keys
are the variant's fields**, then add its path to the `variants` array in
`test-case.toml` (the first entry is the default). Do **not** add or change a
`[voxel]`, `[model]`, or `asset_kind` here — all are version-level. Paths inside
resolve against the version folder, and `dest` defaults to `source`:

```toml
# variants/armored.toml
slug = "armored"
name = "Up-Armored"
description = "Same subject and required animations, with heavier chassis and turret plating — still clearing the hull as the turret sweeps."
spec = [{ source = "specs/armored.md" }]
review_item = [
  { id = "clears-sweep", title = "Turret clears the hull", text = "The up-armored turret does not intersect the hull as the `turret_sweep` animation plays across its full arc.", domain = "fidelity" },
]
```

```toml
# test-case.toml — add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/armored.toml"]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- **No `reference` entry** — an asset-generation case declares no references at all,
  so any reference (common or per-variant) is rejected.
- **No per-variant `[voxel]` / `[model]` / `asset_kind`** — the volume, the required
  animations, and the asset kind are version-level; a variant cannot redeclare them.
- `review_item` entries are additive on the common ones; an item `id` must be unique
  within the variant's effective set, and an item must **not** carry a `reference`.

Also update the human-readable comment in the manifest that enumerates the variants
so the list stays accurate.

## Validating

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not reword
  good prose to dodge the dictionary.
- Seed and render the **new** variant, and re-check the **existing** ones to confirm
  nothing else changed:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained (no
target model is seeded), and that it leaves the `[voxel]` volume and the `[model]`
animation contract (the pre-seeded `rig.json`) intact.

A backend-driven run resolves its definition from the backend's store, which skips a
version it already holds — so after adding the variant, **force a re-ingest** or the
new variant will not appear in a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place and is for **development**
only. Adding a variant edits an existing version, so do it only while that version
is unpublished; once a published run references the version it is immutable and a
variant change requires a **new version** instead. See
[`development/running.md`](../../../apps/docs/src/content/docs/development/running.md).

Commit on the repository's default branch with a conventional-commit message scoped
to the case, e.g. `feat(<slug>): add armored variant …`. Do not commit
`node_modules/` or local seed output.
