---
title: Create a Single-Sprite Variant
---

Add a new [variant](/testing/end-to-end/overview/#variants) to an existing
single-sprite [asset-generation](/testing/asset-generation/overview/) version
(`asset_kind = "sprite"`, the default — one sprite on the whole canvas). The full
procedure is in
[Creating a Single-Sprite Variant](/guides/authoring/creating-a-sprite-variant/).

The key constraint: an asset-generation case declares **no references at all**
and resolution **rejects any** (common or per-variant). There is no target image
— a variant varies only the **brief** (an additive spec) the model draws toward:
a tighter palette, a stricter operation budget, an added stylistic rule.

For a **sprite-sheet** case (`asset_kind = "sprite-sheet"`) instead? See
[Create a Sprite-Sheet Variant](/quickstarts/authoring/create-a-sprite-sheet-variant/).
Adding a mode to an [end-to-end](/testing/end-to-end/overview/) case? See
[Create an End-to-End Variant](/quickstarts/authoring/create-an-end-to-end-variant/).

## Steps

1. Choose a consistent **slug** (e.g. `flat`) and **display name** (e.g. `Flat
   Shading`) describing the drawing constraint it imposes.
2. Write `specs/<slug>.md`: an additive brief stated as a delta against the common
   brief ("same subject and palette, except …"), with **precise, testable**
   constraints. It may reference the common specs but **not** another variant's
   spec.
3. Create `variants/<slug>.toml` (a standalone TOML file whose top-level keys are
   the variant's fields; `dest` defaults to `source`) and add its path to the
   `variants` list in `test-case.toml` (first = default):

```toml
# variants/flat.toml
slug = "flat"
name = "Flat Shading"
description = "Same brief, drawn with flat fills only — no gradients or dithering."
spec = [{ source = "specs/flat.md" }]
```

`spec` entries are additive on the common specs; within one variant no two seeded
specs may share a `dest`. A variant declares **no** `review_item`s — an
asset-generation case has no reviewer checklist. Do **not** add a `reference` — resolution rejects a
variant-specific reference for this test type.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm
nothing else changed and the brief still resolves self-contained.
