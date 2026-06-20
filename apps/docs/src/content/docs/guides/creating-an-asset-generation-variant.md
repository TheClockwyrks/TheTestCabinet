---
title: Creating an Asset-Generation Variant
---

An [asset-generation](/testing/asset-generation/overview/) test case version
offers one or more [variants](/testing/end-to-end/overview/#variants), and a run
selects exactly one. Every variant seeds the version's **common specs** (the
brief and the operations schema) plus its own **additive** specs. The chosen
variant's slug is recorded in the run record, so every result is attributed to a
specific build.

This guide is the full procedure for adding a variant to an **existing**
asset-generation version. The authoritative rules live in
[Manifests](/testing/asset-generation/manifests/); read them first. While doing
the work, follow the `adding-an-asset-generation-variant` skill.

To author a brand-new case, see
[Authoring an Asset-Generation Test Case](/guides/authoring-an-asset-generation-test-case/).
To add a mode to an [end-to-end](/testing/end-to-end/overview/) case instead, see
[Creating an End-to-End Variant](/guides/creating-an-end-to-end-variant/).

## What an asset-generation variant can (and cannot) change

This is the one place asset-generation variants differ sharply from end-to-end
ones. Resolution requires **exactly one common `target` reference** and
**forbids per-variant references**. A variant therefore **cannot** change the
target image — every variant of a case is scored against the same sprite.

What a variant *can* do is vary the **brief** the model draws toward that shared
target, via an additive spec: a tighter palette, a stricter operation budget, a
required drawing technique (flat fills only; no dithering), or a different
stylistic constraint. If you need a genuinely different subject, that is a new
**case**, not a variant.

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

Favor a single constraint a reviewer can observe in the regenerated sprite.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief ("same
subject, silhouette, and palette as the brief, except …"):

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact
  colors, an operation cap, the technique required);
- reaffirm that it draws toward the **same** `target` — the goal image does not
  change.

A variant spec **may** reference the common specs freely (they are always seeded)
but must **not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the
variation makes checkable that the base does not — for example "uses flat fills
only, with no gradients or dithering." Each item is reporter-side (never seeded),
carries a stable `id` unique within the variant's effective set, and typically
pairs `reference = "target"` and a scoring `domain`.

### 4. Register the variant in `test-case.toml`

Add a `[[variant]]` table after the existing ones (the first variant is the
default):

```toml
[[variant]]
slug = "flat"
name = "Flat Shading"
description = "Same target, drawn with flat fills only — no gradients or dithering."
spec = [{ source = "specs/flat.md", dest = "specs/flat.md" }]
review_item = [
  { id = "flat-fills", title = "Flat fills only", text = "Every region is a flat color with no gradients or dithering.", reference = "target", domain = "fidelity" },
]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- **No `reference` entry** — a variant-specific reference is rejected for this
  test type, because the `target` is shared by every variant.
- `review_item` entries are additive on the common ones; an item `id` must be
  unique within the variant's effective set.

Also update the human-readable comment in the manifest that enumerates the
variants so the list stays accurate.

## Validate your work

Seed and render the **new** variant, and re-check the **existing** ones to confirm
your edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained
against the shared target. Then exercise it with
[Run a Test Case](/quickstarts/run-a-test-case/).
