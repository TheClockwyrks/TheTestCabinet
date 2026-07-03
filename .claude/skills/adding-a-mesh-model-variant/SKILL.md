---
description: Read this skill before adding a new variant to an existing STATIC meshed asset-generation test case (asset_kind = "mc-model", "sn-model", or "dc-model") — a brief variation (tighter palette, operation budget, CSG technique) the model sculpts a signed-distance field toward with the `mc`/`sn`/`dc` meshing binary, registered in a version's test-case.toml. For a variant of an ANIMATED meshed case (any `-animation` kind) use adding-a-mesh-animation-variant; for a static VOXEL (cube) case use adding-a-voxel-model-variant; for a 2D sprite/sprite-sheet case use adding-a-sprite-variant / adding-a-sprite-sheet-variant; for an end-to-end case use adding-an-end-to-end-variant.
name: adding-a-mesh-model-variant
---

# Adding a Static Meshed-Model Variant

## What a mesh-model variant is

A static meshed
[asset-generation](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
test case (`asset_kind = "mc-model"`, `"sn-model"`, or `"dc-model"`) sculpts **one
3D model** by **compositing a continuous signed-distance field** — a CSG paradigm —
with a meshing binary (`mc`, `sn`, or `dc`), which extracts a triangle mesh; the
model builds toward a goal **described in a brief** (there is no target model). Its
version offers one or more **variants**, and a run selects exactly one. Every variant
seeds the version's **common specs** (the brief) plus its own **additive** specs. The
chosen variant's slug is recorded in the run record.

This skill covers variants of **static meshed** cases. For a variant of an
**animated meshed** case — one whose `[model]` table declares a rig of parts and
joints (any `-animation` kind) — use the
[`adding-a-mesh-animation-variant`](../adding-a-mesh-animation-variant/SKILL.md)
skill. For a variant of a **static VOXEL (cube)** case use
[`adding-a-voxel-model-variant`](../adding-a-voxel-model-variant/SKILL.md); for a
**2D** case use
[`adding-a-sprite-variant`](../adding-a-sprite-variant/SKILL.md) or
[`adding-a-sprite-sheet-variant`](../adding-a-sprite-sheet-variant/SKILL.md); for an
**end-to-end** case use
[`adding-an-end-to-end-variant`](../adding-an-end-to-end-variant/SKILL.md). To author
a brand-new case, use
[`authoring-a-mesh-model-test-case`](../authoring-a-mesh-model-test-case/SKILL.md).

The authoritative schema lives in
[`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
(the **Voxel cases** section) and the tool interface in
[`testing/asset-generation/mesh-binaries.md`](../../../apps/docs/src/content/docs/testing/asset-generation/mesh-binaries.md);
read them before starting.

## The defining constraint: a variant varies the brief

This is where asset-generation variants differ sharply from end-to-end ones. There
is **no target model** at all, and resolution **forbids any `[[reference]]`**
(common *or* per-variant). The model is human-reviewed against the brief, so a
variant has nothing to "change the target" of — there is none.

The **`asset_kind`** (which fixes the algorithm and its surface character — an `mc`
low-poly, `sn` smooth, or `dc` sharp mesh) and the **`[voxel]`** volume are fixed at
the **version level** — a variant cannot switch the meshing binary, turn a static
model into an animation, change the field bounds, or change the preview background.

What a variant *can* do is vary the **brief** the model sculpts toward, via an
additive spec:

- a **tighter palette** (a subset of the base colors);
- a **stricter operation budget** (fewer primitives / CSG operations allowed);
- a **required technique** (symmetric via the `mirror` op only; hard unions only —
  no `--blend` — or, for `dc`, mandatory `--sharp` on all armor edges; a primitive
  count cap);
- another **observable stylistic constraint** visible in the extracted mesh.

If you need a genuinely different subject, a different algorithm, or a different
volume, that is a new **case** (or a new version), not a variant.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the spec filename (e.g.
  `symmetric`);
- **display name** — title case, the variant's `name` (e.g. `Mirror-Symmetric`);
- **description** — one line naming the constraint.

Favor a single constraint a reviewer can observe in the extracted mesh (rotating in
the 3D viewer, or in the wgpu preview).

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief:

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact
  colors, an operation cap, the CSG technique required);
- reaffirm it sculpts toward the **same** brief in the **same** `[voxel]` volume with
  the **same** meshing binary — the subject and the surface character described do
  not change, only the added constraint.

A variant spec **may** reference the common specs freely (always seeded) but must
**not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the
variation makes checkable that the base does not (e.g. "the model is left/right
symmetric across the mirror plane", or "all armor edges are crisply preserved with
`--sharp`"). Each item is reporter-side (never seeded), carries a stable `id` unique
within the variant's effective set, and carries only a scoring `domain` (no
`reference` — there is no target to pair with).

### 4. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose **top-level keys
are the variant's fields**, then add its path to the `variants` array in
`test-case.toml` (the first entry is the default). Do **not** add or change a
`[voxel]` table or `asset_kind` here — both are version-level. Paths inside resolve
against the version folder, and `dest` defaults to `source`:

```toml
# variants/symmetric.toml
slug = "symmetric"
name = "Mirror-Symmetric"
description = "Same subject, volume, and mesher, built left/right symmetric using the mirror op."
spec = [{ source = "specs/symmetric.md" }]
review_item = [
  { id = "symmetric", title = "Left/right symmetric", text = "The extracted mesh is mirror-symmetric across the volume's central plane.", domain = "fidelity" },
]
```

```toml
# test-case.toml — add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/symmetric.toml"]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- **No `reference` entry** — an asset-generation case declares no references at all,
  so any reference (common or per-variant) is rejected.
- **No per-variant `[voxel]` / `asset_kind`** — both are version-level; a variant
  cannot redeclare them or switch the meshing binary.
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
target model is seeded), and that it leaves the `[voxel]` volume and the meshing
binary intact.

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
to the case, e.g. `feat(<slug>): add symmetric variant …`. Do not commit
`node_modules/` or local seed output.
