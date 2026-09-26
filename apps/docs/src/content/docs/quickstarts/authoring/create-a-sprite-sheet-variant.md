---
title: Create a Sprite-Sheet Variant
---

## Overview

Add a variant to an existing sprite-sheet asset-generation version
(`asset_kind = "sprite-sheet"`, a `[sheet]` of frames each written to its own
file).
[Creating a Sprite-Sheet Variant](/guides/authoring/creating-a-sprite-sheet-variant/)
is the full procedure.

A variant varies the brief the model draws toward: a tighter palette, a stricter
operation budget, an added stylistic rule. The `asset_kind`, the `[canvas]` and
the `[sheet]` frames and named sequences are version-level, so every variant
draws toward the same layout. An asset-generation case declares no references, so
resolution rejects a `reference` on the case or on any variant.

## Steps

1. Choose a consistent slug (`flat`) and display name (`Flat Shading`) naming
   the drawing constraint the variant imposes.
2. Write `specs/<slug>.md` as an additive brief, stated as a delta against the
   common brief ("same subject, frames and palette, except …") with precise,
   testable constraints. Say whether each applies to every frame, to a named
   sequence, or across frames. It may reference the common specs. It may not
   reference another variant's spec.
3. Create `variants/<slug>.toml`, a standalone TOML file whose top-level keys are
   the variant's fields, and add its path to the `variants` list in
   `test-case.toml`. The first entry in that list is the default variant.

```toml
# variants/flat.toml
slug = "flat"
name = "Flat Shading"
description = "Same brief, drawn with flat fills only, across every frame."
spec = [{ source = "specs/flat.md" }]
```

A spec entry's `dest` defaults to its `source` with any trailing `.hbs` removed.
Spec entries are additive on the common specs, and within one variant two seeded
entries may not share a `dest`. An asset-generation case is judged on one
overall rating, so a variant declares no `[[review_item]]`.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the new variant, then repeat for the existing variants to
confirm nothing else changed, the brief still resolves self-contained, and the
`[sheet]` frames and sequences are intact.
