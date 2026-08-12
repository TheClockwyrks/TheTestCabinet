---
title: Create a Mesh Animation Variant
---

Add a new [variant](/testing/end-to-end/overview/#variants) to an existing animated
meshed (rigged) [asset-generation](/testing/asset-generation/overview/) version
(`asset_kind = "mc-animation"`, `"sn-animation"`, or `"dc-animation"` — per-part SDFs
extracted to a triangle mesh, with a version-level animation contract). The full
procedure is in
[Creating a Mesh Animation Variant](/guides/authoring/creating-a-mesh-animation-variant/).

The key constraint: an asset-generation case declares **no references at all** and
resolution **rejects any** (common or per-variant) — there is no target model. A variant
varies only the **brief** (an additive spec) the model sculpts toward: a tighter palette,
a stricter operation budget, a required CSG technique, or an animation constraint stated
as observable behaviour. It may **not** touch the version-level `asset_kind`, `[voxel]`
volume, or the `[model]` animation contract (its required animation names are fixed, so
every variant produces the same ones by the same names).

For a **static meshed** case (any `-model` kind, one model, no rig) see
[Create a Mesh Model Variant](/quickstarts/authoring/create-a-mesh-model-variant/). For a
rigged **VOXEL (cube)** case see
[Create a Voxel Animation Variant](/quickstarts/authoring/create-a-voxel-animation-variant/).

## Steps

1. Choose a consistent **slug** (e.g. `armored`) and **display name** (e.g.
   `Up-Armored`) describing the constraint it imposes, plus a one-line **description**
   (there is no menu label to carry it).
2. Write `specs/<slug>.md`: an additive brief stated as a delta against the common brief
   ("same subject, required animations, and mesher, except …"), with **precise, testable**
   constraints, saying whether each applies to every part, a named feature, or the
   behaviour of a named animation. It may reference the common specs but **not** another
   variant's spec.
3. Create `variants/<slug>.toml` (a standalone TOML file whose top-level keys are the
   variant's fields; `dest` defaults to `source`) and add its path to the `variants` list
   in `test-case.toml` (first = default):

```toml
# variants/armored.toml
slug = "armored"
name = "Up-Armored"
description = "Same subject, required animations, and mesher, with heavier chassis and turret plating — still clearing the hull as the turret sweeps."
spec = [{ source = "specs/armored.md" }]
```

`spec` entries are additive on the common ones; within one variant no two seeded
specs may share a `dest`. A variant declares **no** `review_item`s — an
asset-generation case has no reviewer checklist. Do **not** add a `reference`, `[voxel]`, `[model]`,
or `asset_kind` here — all are rejected or version-level.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm nothing
else changed and the brief still resolves self-contained (no target model seeded, with the
`[voxel]` volume and the `[model]` animation contract left intact).
