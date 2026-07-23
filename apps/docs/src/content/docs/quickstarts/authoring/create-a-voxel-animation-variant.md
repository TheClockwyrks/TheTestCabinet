---
title: Create a Voxel Animation Variant
---

Add a new [variant](/testing/end-to-end/overview/#variants) to an existing
animated (rigged) voxel [asset-generation](/testing/asset-generation/overview/#voxel-models-and-rigs)
version (`asset_kind = "voxel-animation"` — a sculpted, rigged model whose
required animations are authored as F-curves). The full procedure is in
[Creating a Voxel Animation Variant](/guides/authoring/creating-a-voxel-animation-variant/).

The key constraint: there is **no target model** and resolution **rejects any
`[[reference]]`** (common or per-variant), plus any per-variant `[voxel]`,
`[model]`, or `asset_kind`. A variant varies only the **brief** (an additive
spec) the model sculpts toward — a tighter palette, a stricter operation budget,
a required technique, or an observable animation constraint. The `[voxel]` volume
and the `[model]` required-animation contract are fixed at the version level, so
every variant produces the **same** required animations by the **same** names.

Static (unrigged) voxel case (`asset_kind = "voxel-model"`)? See
[Create a Voxel Model Variant](/quickstarts/authoring/create-a-voxel-model-variant/).
Rigged **meshed** case (`mc-animation`/`sn-animation`/`dc-animation`)? See
[Create a Mesh Animation Variant](/quickstarts/authoring/create-a-mesh-animation-variant/).

## Steps

1. Choose a consistent **slug** (e.g. `armored`) and **display name** (e.g.
   `Up-Armored`) describing the constraint the variant imposes — favor one a
   reviewer can observe in a still part preview or the posed 3D viewer.
2. Write `specs/<slug>.md`: an additive brief stated as a delta against the
   common brief ("same subject and required animations, except …"), with
   **precise, testable** constraints; say whether it applies to every part, a
   named feature, or the behaviour of a named animation. It may reference the
   common specs but **not** another variant's spec.
3. Create `variants/<slug>.toml` (a standalone TOML file whose top-level keys are
   the variant's fields; `dest` defaults to `source`) and add its path to the
   `variants` list in `test-case.toml` (first = default):

```toml
# variants/armored.toml
slug = "armored"
name = "Up-Armored"
description = "Same subject and required animations, with heavier chassis and turret plating — still clearing the hull as the turret sweeps."
spec = [{ source = "specs/armored.md" }]
```

`spec` entries are additive on the common ones; within one variant no two seeded
specs may share a `dest`. A variant declares **no** `review_item`s — an
asset-generation case has no reviewer checklist. Do **not** add a `reference`,
`[voxel]`, `[model]`, or `asset_kind` — all are rejected or version-level.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm
nothing else changed, no target model is seeded, and the `[voxel]` volume and
`[model]` animation contract (the pre-seeded `rig.json`) resolve intact.
