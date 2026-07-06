---
title: Creating a Voxel Model Variant
---

A static voxel-model [asset-generation](/testing/asset-generation/overview/) test
case (`asset_kind = "voxel-model"`) sculpts **one 3D model** out of opaque `#rrggbb`
voxels into a fixed `[voxel]` volume, toward a goal **described in a brief** — there
is **no target model**. Its version offers one or more
[variants](/testing/end-to-end/overview/#variants), and a run selects exactly one.
Every variant seeds the version's **common specs** (the brief) plus its own
**additive** specs. The chosen variant's slug is recorded in the run record, so every
result is attributed to a specific build.

This guide is the full procedure for adding a variant to an **existing** static
voxel-model version. The authoritative rules live in
[Manifests](/testing/asset-generation/manifests/#voxel-cases) (the **Voxel cases**
section); read them first.

For a **voxel-animation** case (`asset_kind = "voxel-animation"`) — one whose
`[model]` table declares a rig of required animations — see
[Creating a Voxel Animation Variant](/guides/creating-a-voxel-animation-variant/)
instead, where a variant also varies only the brief against the shared rig contract.
For a **2D** sprite case, see
[Creating a Single-Sprite Variant](/guides/creating-a-sprite-variant/). To add a mode
to an [end-to-end](/testing/end-to-end/overview/) case, see
[Creating an End-to-End Variant](/guides/creating-an-end-to-end-variant/). To author a
brand-new case, see
[Authoring a Voxel Model Test Case](/guides/authoring-a-voxel-model-test-case/).

## What a voxel-model variant can (and cannot) change

This is where asset-generation variants differ sharply from end-to-end ones. There is
**no target model** at all, and resolution **forbids any `[[reference]]`** (common
*or* per-variant). The model is human-reviewed against the brief, so a variant has
nothing to repoint — there is no target to "change."

The **`asset_kind`** and the **`[voxel]`** volume are fixed at the **version level** —
a variant cannot turn a static model into an animation, change the dimensions, or
change the preview background.

What a variant *can* do is vary the **brief** the model sculpts toward, via an
additive spec:

- a **tighter palette** (a subset of the base colors);
- a **stricter operation budget** (fewer operations allowed);
- a **required technique** (symmetric via the `mirror` op only; solid fills only; a
  hard voxel-count cap);
- another **observable stylistic constraint** visible in the regenerated model.

If you need a genuinely different subject or a different volume, that is a new **case**
(or a new version), not a variant. A variant's `spec` and `review_item` entries are
**additive** — they layer on top of the common ones rather than replacing them.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the spec filename (e.g.
  `symmetric`);
- **display name** — title case, the variant's `name` (e.g. `Mirror-Symmetric`);
- **description** — one line naming the constraint.

Favor a single constraint a reviewer can observe in the regenerated model (rotating in
the 3D viewer, or in the preview PNG).

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief ("same
subject and volume as the brief, except …"):

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact
  colors, an operation cap, the technique required);
- reaffirm it sculpts toward the **same** brief in the **same** `[voxel]` volume — the
  subject described does not change, only the added constraint.

A variant spec **may** reference the common specs freely (they are always seeded) but
must **not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the variation
makes checkable that the base does not — for example "the model is left/right
symmetric across the mirror plane." Each item is reporter-side (never seeded), carries
a stable `id` unique within the variant's effective set, and a scoring `domain`. It
must **not** carry a `reference` field — there is no target to point at, and one is
rejected.

### 4. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose **top-level keys are
the variant's fields**, then add its path to the `variants` array in `test-case.toml`
(the first entry is the default). Do **not** add or change a `[voxel]` table or
`asset_kind` here — both are version-level. Paths inside resolve against the version
folder, and `dest` defaults to `source`:

```toml
# variants/symmetric.toml
slug = "symmetric"
name = "Mirror-Symmetric"
description = "Same subject and volume, built left/right symmetric using the mirror op."
spec = [{ source = "specs/symmetric.md" }]
review_item = [
  { id = "symmetric", title = "Left/right symmetric", text = "The model is mirror-symmetric across the volume's central plane.", domain = "fidelity" },
]
```

```toml
# test-case.toml — add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/symmetric.toml"]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- **No `reference` entry** — an asset-generation case declares no references at all, so
  any reference (common or per-variant) is rejected.
- **No per-variant `[voxel]` / `asset_kind`** — both are version-level; a variant
  cannot redeclare them.
- `review_item` entries are additive on the common ones; an item `id` must be unique
  within the variant's effective set, and an item must **not** carry a `reference`.

Also update the human-readable comment in the manifest that enumerates the variants so
the list stays accurate.

## Validate your work

From the repository root, lint the specs:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

If `cspell` flags a legitimate domain term, add it to `.cspell/project-words.txt` — do
not reword good prose to dodge the dictionary.

Then seed and render the **new** variant, and re-check the **existing** ones to confirm
your edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained (no target
model is seeded) and that it leaves the `[voxel]` volume intact.

A backend-driven run resolves its definition from the backend's store, which skips a
version it already holds — so after adding the variant, **force a re-ingest** or the
new variant will not appear in a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place and is for **development** only.
Adding a variant edits an existing version, so do it only while that version is
unpublished; once a published run references the version it is **immutable**, and a
variant change requires a **new version** instead. See
[Running the services locally](/development/running/).

Commit on the repository's default branch with a conventional-commit message scoped to
the case, e.g. `feat(<slug>): add symmetric variant …`. Do not commit `node_modules/`
or local seed output. When the variant is ready, exercise it end to end with
[Run a Test Case](/quickstarts/run-a-test-case/).
