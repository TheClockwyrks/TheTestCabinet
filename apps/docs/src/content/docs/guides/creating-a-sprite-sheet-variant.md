---
title: Creating a Sprite-Sheet Variant
---

A sprite-sheet [asset-generation](/testing/asset-generation/overview/) test case
(`asset_kind = "sprite-sheet"`) draws a **set of animation frames**, each its own
separate file — described by a `[sheet]` table (the declared `[[sheet.frame]]`
entries and one or more named `[[sheet.sequence]]` animations) — to match a written
brief. There is **no target image** for any frame. Its version offers one or more
[variants](/testing/end-to-end/overview/#variants), and a run selects exactly one.
Every variant seeds the version's **common specs** (the brief) plus its own
**additive** specs. The chosen variant's slug is recorded in the run record, so
every result is attributed to a specific build.

This guide is the full procedure for adding a variant to an **existing**
sprite-sheet asset-generation version. The authoritative rules live in
[Manifests](/testing/asset-generation/manifests/) — including the `[sheet]` rules;
read them first. While doing the work, follow the `adding-a-sprite-sheet-variant`
skill.

For a **single-sprite** case (`asset_kind = "sprite"`) — one sprite on the whole
canvas, with no `[sheet]` table — see
[Creating a Single-Sprite Variant](/guides/creating-a-sprite-variant/) instead. To
author a brand-new case, see
[Authoring an Asset-Generation Test Case](/guides/authoring-an-asset-generation-test-case/).
To add a mode to an [end-to-end](/testing/end-to-end/overview/) case instead, see
[Creating an End-to-End Variant](/guides/creating-an-end-to-end-variant/).

## What a sprite-sheet variant can (and cannot) change

This is the one place asset-generation variants differ sharply from end-to-end
ones. An asset-generation case has **no target image** and declares **no
`[[reference]]`** — resolution rejects any reference, common or per-variant. It also
**forbids per-variant `[sheet]` tables**. A variant therefore has no targets to
repoint: the model draws to match the brief, not to copy supplied pictures.

For a sprite sheet, two things are fixed at the **version level** and a variant
cannot touch them: the **`asset_kind`** itself, and the **`[sheet]` layout** — the
declared `[[sheet.frame]]` entries (each just the index it is written to) and the
named `[[sheet.sequence]]` animations. Those are version-level, so every variant
draws the same frames and animates them at the same fps.

What a variant *can* do is vary the **brief** the model draws toward, via an
additive spec: a tighter palette applied across every frame, a stricter operation
budget across all frames, a required drawing technique (flat fills only; no
dithering; left/right symmetry between mirrored directions), or a cross-frame
consistency rule the animation makes observable. If you need a genuinely different
subject, a different set of frames, or different sequences, that is a new **case**
(or a new version), not a variant.

Review stays exactly the same as the base: each regenerated **frame** is judged
against the brief — **per frame**, with no whole-sheet aggregate. The sequences only
drive the review UI's animated playback.

A variant's `spec` and `review_item` entries are **additive** — they layer on top
of the common ones rather than replacing them.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the spec filename (e.g.
  `flat`);
- **display name** — title case, the variant's `name` (e.g. `Flat Shading`);
- **description** — one line naming the constraint, since there is no menu label
  to carry it.

Favor a single constraint a reviewer can observe in the regenerated sheet — either
in a still frame or in a sequence the review UI plays back.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief ("same
subject, frames, and palette as the brief, except …"):

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact
  colors, an operation cap, the technique required), and say whether it applies to
  every frame, to a named sequence, or across frames;
- reaffirm that it draws to match the **same brief** against the **same** `[sheet]`
  frames and sequences — neither the subject nor the frame layout changes, only the
  added constraint does.

A variant spec **may** reference the common specs freely (they are always seeded)
but must **not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the
variation makes checkable that the base does not — for a sheet this can be
something the **animation** reveals, for example "the walk sequences keep a
constant silhouette height across all frames" or "uses flat fills only, with no
gradients or dithering." Each item is reporter-side (never seeded), carries a
stable `id` unique within the variant's effective set, and a scoring `domain`. It
must **not** carry a `reference` field — there is no target to point at, and one is
rejected.

### 4. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose **top-level keys
are the variant's fields**, then add its path to the `variants` array in
`test-case.toml` (the first entry is the default). Do **not** add or change a
`[sheet]` table here — the sheet is declared once at the version level. Paths
inside resolve against the version folder, and `dest` defaults to `source`:

```toml
# variants/flat.toml
slug = "flat"
name = "Flat Shading"
description = "Same brief and sheet, drawn with flat fills only — no gradients or dithering, across every frame."
spec = [{ source = "specs/flat.md" }]
review_item = [
  { id = "flat-fills", title = "Flat fills only", text = "Every frame is filled with flat colors — no gradients or dithering in any cell.", domain = "technique" },
]
```

```toml
# test-case.toml — add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/flat.toml"]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- **No `reference` entry** — references are rejected for this test type entirely
  (an asset-generation case has no target image), so neither the case nor a variant
  may declare one.
- **No per-variant `[sheet]` / `asset_kind`** — the sheet's frames and sequences,
  and the asset kind, are version-level; a variant cannot redeclare them.
- `review_item` entries are additive on the common ones; an item `id` must be
  unique within the variant's effective set, and an item must not carry a
  `reference`.

Also update the human-readable comment in the manifest that enumerates the
variants so the list stays accurate.

## Validate your work

Seed and render the **new** variant, and re-check the **existing** ones to confirm
your edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained and
leaves the `[sheet]` frames and sequences intact. Then exercise it with
[Run a Test Case](/quickstarts/run-a-test-case/).
