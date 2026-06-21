---
title: Create a Sprite-Sheet Variant
---

Add a new [variant](/testing/end-to-end/overview/#variants) to an existing
sprite-sheet [asset-generation](/testing/asset-generation/overview/) version
(`asset_kind = "sprite-sheet"` — a `[sheet]` grid of animation frames). The full
procedure is in
[Creating a Sprite-Sheet Variant](/guides/creating-a-sprite-sheet-variant/);
the `adding-a-sprite-sheet-variant` skill is the hands-on guide to follow.

The key constraint: an asset-generation case has **exactly one common `target`**
reference and resolution **forbids per-variant references**. So a variant cannot
change the target image — it varies the **brief** (an additive spec) the model
draws toward that same shared target sheet: a tighter palette, a stricter operation
budget, an added stylistic rule. For a sheet, the **`[sheet]` grid and named
sequences are version-level too** — a variant shares them and cannot redeclare
them, and scoring stays whole-sheet (the sequences only drive the review UI's
animated playback).

For a **single-sprite** case (`asset_kind = "sprite"`) instead? See
[Create a Single-Sprite Variant](/quickstarts/create-a-sprite-variant/). Adding a
mode to an [end-to-end](/testing/end-to-end/overview/) case? See
[Create an End-to-End Variant](/quickstarts/create-an-end-to-end-variant/).

## Steps

1. Choose a consistent **slug** (e.g. `flat`) and **display name** (e.g. `Flat
   Shading`) describing the drawing constraint it imposes.
2. Write `specs/<slug>.md`: an additive brief stated as a delta against the common
   brief ("same subject, frame grid, and palette, except …"), with **precise,
   testable** constraints, saying whether each applies to every frame, a named
   sequence, or across frames. It may reference the common specs but **not** another
   variant's spec, and it draws toward the **same** `target` sheet and `[sheet]`
   layout.
3. Add `[[review_item]]`s for what the variation makes observable — including
   anything the **animation** reveals — each pairing `reference = "target"` and a
   scoring `domain`.
4. Register the variant in `test-case.toml` (do **not** add a `[sheet]` table — it
   is declared once at the version level):

```toml
[[variant]]
slug = "flat"
name = "Flat Shading"
description = "Same sheet, drawn with flat fills only — no gradients or dithering, across every frame."
spec = [{ source = "specs/flat.md", dest = "specs/flat.md" }]
```

`spec` entries are additive on the common specs; within one variant no two seeded
specs may share a `dest`. Do **not** add a `reference` (resolution rejects a
variant-specific reference for this test type) or a per-variant `[sheet]` /
`asset_kind`.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm
nothing else changed and the brief still resolves self-contained against the shared
target sheet, leaving the `[sheet]` grid and sequences intact.
