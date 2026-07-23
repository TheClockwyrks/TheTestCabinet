---
title: Create a Voxel Model Variant
---

Add a new [variant](/testing/end-to-end/overview/#variants) to an existing static
voxel-model [asset-generation](/testing/asset-generation/overview/) version
(`asset_kind = "voxel-model"` — one 3D model sculpted from opaque voxels into a
fixed `[voxel]` volume). The full procedure is in
[Creating a Voxel Model Variant](/guides/authoring/creating-a-voxel-model-variant/).

The key constraint: a voxel case declares **no references at all** and resolution
**rejects any** (common or per-variant). There is no target model — a variant
varies only the additive **brief** the model sculpts toward: a tighter palette, a
stricter operation budget, an added technique or rule. The `asset_kind` and the
`[voxel]` volume are fixed at the **version** level and a variant cannot touch them.

Animating a rig instead (`asset_kind = "voxel-animation"`)? See
[Create a Voxel Animation Variant](/quickstarts/authoring/create-a-voxel-animation-variant/).
Meshed (mc/sn/dc) model? See
[Create a Mesh Model Variant](/quickstarts/authoring/create-a-mesh-model-variant/).

## Steps

1. Choose a consistent **slug** (e.g. `symmetric`) and **display name** (e.g.
   `Mirror-Symmetric`) naming the constraint it imposes — favor one a reviewer can
   observe in the regenerated model.
2. Write `specs/<slug>.md`: an additive brief stated as a delta against the common
   brief ("same subject and volume, except …"), with **precise, testable** terms
   (exact colors, an operation cap, the technique required). It may reference the
   common specs but **not** another variant's spec.
3. Create `variants/<slug>.toml` (a standalone TOML file whose top-level keys are
   the variant's fields; `dest` defaults to `source`) and add its path to the
   `variants` list in `test-case.toml` (first = default):

```toml
# variants/symmetric.toml
slug = "symmetric"
name = "Mirror-Symmetric"
description = "Same subject and volume, built left/right symmetric using the mirror op."
spec = [{ source = "specs/symmetric.md" }]
```

`spec` entries are **additive** on the common ones; within one variant no two
seeded specs may share a `dest`. A variant declares **no** `review_item`s — an
asset-generation case has no reviewer checklist. Do **not** add a `reference`, a
`[voxel]` table, or `asset_kind` — references are rejected and both the volume and
kind are version-level.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm
the brief resolves self-contained (no target model seeded), the `[voxel]` volume is
intact, and nothing else changed.
