---
title: Create a Mesh Animation Variant
---

## Overview

Add a variant to an existing rigged meshed asset-generation version
(`asset_kind = "mc-animation"`, `"sn-animation"` or `"dc-animation"`, per-part
SDFs extracted to triangle meshes under a version-level animation contract).
[Creating a Mesh Animation Variant](/guides/authoring/creating-a-mesh-animation-variant/)
is the full procedure.

A variant varies the brief the model sculpts toward: a tighter palette, a
stricter operation budget, a required CSG technique, or an animation constraint
stated as observable behaviour. It may also declare its own `[voxel]` table,
which replaces the case's field bounds for runs of that variant. The
`asset_kind` and the `[model]` animation contract are version-level, so every
variant keeps the case's mesher and produces the same required animations under
the same names. An asset-generation case declares no references, so resolution
rejects a `reference` on the case or on any variant.

## Steps

1. Choose a consistent slug (`armored`), display name (`Up-Armored`) and
   one-line description naming the constraint the variant imposes.
2. Write `specs/<slug>.md` as an additive brief, stated as a delta against the
   common brief ("same subject, required animations and mesher, except …") with
   precise, testable constraints. Say whether each applies to every part, to a
   named feature, or to the behaviour of a named animation. It may reference the
   common specs. It may not reference another variant's spec.
3. Create `variants/<slug>.toml`, a standalone TOML file whose top-level keys are
   the variant's fields, and add its path to the `variants` list in
   `test-case.toml`. The first entry in that list is the default variant.

```toml
# variants/armored.toml
slug = "armored"
name = "Up-Armored"
description = "Same animations and mesher, with heavier chassis and turret plating."
spec = [{ source = "specs/armored.md" }]
```

A spec entry's `dest` defaults to its `source` with any trailing `.hbs` removed.
Spec entries are additive on the common specs, and within one variant two seeded
entries may not share a `dest`. An asset-generation case is judged on one
overall rating, so a variant declares no `[[review_item]]`.

## Varying the volume

A variant that declares a `[voxel]` table runs at those field bounds in place of
the case's. Declare `width`, `height`, `depth` and `background` exactly as the
case does. A brief that has to state its dimensions reads them from the
[spec-template context](/testing/end-to-end/overview/#spec-templates) as
`{{voxel.width}}`, `{{voxel.height}}`, `{{voxel.depth}}` and the inclusive
maximum index on each axis, so one `.hbs` brief serves every size.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the new variant, then repeat for the existing variants to
confirm nothing else changed, the brief resolves self-contained, and the seeded
`rig.json` still carries the version's required animations.
