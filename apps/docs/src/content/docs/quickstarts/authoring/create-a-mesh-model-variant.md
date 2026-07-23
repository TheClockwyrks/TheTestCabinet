---
title: Create a Mesh Model Variant
---

Add a new [variant](/testing/end-to-end/overview/#variants) to an existing static
meshed [asset-generation](/testing/asset-generation/overview/) version
(`asset_kind = "mc-model"`, `"sn-model"`, or `"dc-model"` — one 3D model sculpted from a
signed-distance field and meshed by the `mc`, `sn`, or `dc` binary). The full procedure
is in [Creating a Mesh Model Variant](/guides/authoring/creating-a-mesh-model-variant/).

The key constraint: an asset-generation case declares **no references at all** and
resolution **rejects any** (common or per-variant) — there is no target model. The
`asset_kind` and the `[voxel]` volume are fixed at the version level, so a variant cannot
switch the meshing binary or change the field bounds. A variant varies only the **brief**
(an additive spec) the model sculpts toward: a tighter palette, a stricter operation
budget, a required CSG technique (mirror-only symmetry, hard unions, `dc` `--sharp` edges).

For an **animated** meshed case (a `[model]` rig, any `-animation` kind)? See
[Create a Mesh Animation Variant](/quickstarts/authoring/create-a-mesh-animation-variant/).
For a **static VOXEL (cube)** case? See
[Create a Voxel Model Variant](/quickstarts/authoring/create-a-voxel-model-variant/).

## Steps

1. Choose a consistent **slug** (e.g. `symmetric`) and **display name** (e.g.
   `Mirror-Symmetric`) naming the constraint the variant imposes — favor one a reviewer
   can observe in the extracted mesh.
2. Write `specs/<slug>.md`: an additive brief stated as a delta against the common brief
   ("same subject, volume, and mesher, except …"), with **precise, testable** constraints
   (exact colors, an operation cap, the required CSG technique). It may reference the
   common specs but **not** another variant's spec.
3. Create `variants/<slug>.toml` (a standalone TOML file whose top-level keys are the
   variant's fields; `dest` defaults to `source`) and add its path to the `variants` list
   in `test-case.toml` (first = default). Do **not** declare a `[voxel]` table or
   `asset_kind` here — both are version-level:

```toml
# variants/symmetric.toml
slug = "symmetric"
name = "Mirror-Symmetric"
description = "Same subject, volume, and mesher, built left/right symmetric using the mirror op."
spec = [{ source = "specs/symmetric.md" }]
```

`spec` entries are additive on the common ones; within one variant no two seeded
specs may share a `dest`. A variant declares **no** `review_item`s — an
asset-generation case has no reviewer checklist. Do **not** add a `reference` — resolution rejects any
reference for this test type.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm nothing
else changed — the brief resolves self-contained (no target model seeded) and leaves the
`[voxel]` volume and meshing binary intact.
