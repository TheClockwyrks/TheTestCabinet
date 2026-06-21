---
description: Read this skill before adding a new variant to an existing SPRITE-SHEET asset-generation test case (asset_kind = "sprite-sheet") — a brief variation (tighter palette, operation budget, drawing technique, cross-frame consistency) the model draws toward the case's single shared target sheet and fixed [sheet] frame grid, registered in a version's test-case.toml. For a variant of a single-sprite case (asset_kind = "sprite") use adding-a-sprite-variant instead; for a variant of an end-to-end case (a playable mode) use adding-an-end-to-end-variant.
name: adding-a-sprite-sheet-variant
---

# Adding a Sprite-Sheet Variant

## What a sprite-sheet variant is

A sprite-sheet [asset-generation](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
test case (`asset_kind = "sprite-sheet"`) draws a **grid of animation frames** that
tiles the canvas, described by a `[sheet]` table and one or more named
`[[sheet.sequence]]` animations, toward a fixed target sheet. Its version offers one
or more **variants**, and a run selects exactly one. Every variant seeds the
version's **common specs** (the brief and the operations schema) plus its own
**additive** specs. The chosen variant's slug is recorded in the run record.

This skill covers variants of **sprite-sheet** asset-generation cases. For a variant
of a **single-sprite** case — one sprite drawn onto the whole canvas, with no
`[sheet]` table — use the
[`adding-a-sprite-variant`](../adding-a-sprite-variant/SKILL.md) skill. For a variant
of an **end-to-end** case — a playable mode with its own menu and rules — use the
[`adding-an-end-to-end-variant`](../adding-an-end-to-end-variant/SKILL.md) skill. To
author a brand-new case, use
[`authoring-an-asset-generation-test-case`](../authoring-an-asset-generation-test-case/SKILL.md).

The authoritative schema lives in
[`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md);
read it before starting — including the `[sheet]` rules.

## The defining constraint: a variant shares the target *and* the sheet

This is where asset-generation variants differ sharply from end-to-end ones.
Resolution requires **exactly one common `target` reference** and **forbids
per-variant references**. A variant therefore **cannot change the target image** —
every variant of a case is scored against the same sheet.

For a sprite sheet, two more things are fixed at the **version level** and a variant
cannot touch them:

- the **`asset_kind`** itself — a variant cannot turn a sheet into a single sprite
  (or vice versa);
- the **`[sheet]` layout** — the frame grid (`frame_width`, `frame_height`,
  `columns`, `rows`) and the named `[[sheet.sequence]]` animations are version-level
  metadata that travel with the one shared target, so every variant animates the
  same frames at the same fps.

What a variant *can* do is vary the **brief** the model draws toward that shared
target sheet, via an additive spec:

- a **tighter palette** (a subset of the base colors), applied across every frame;
- a **stricter operation budget** (fewer operations allowed for the whole sheet);
- a **required technique** (flat fills only; no dithering; left/right symmetry
  between mirrored directions);
- a **cross-frame consistency** rule the animation makes observable (e.g. a fixed
  silhouette height across a walk cycle, or a two-frame economy on a "tell").

Scoring stays exactly the same as the base: the regenerated **whole sheet** is
compared to the **whole target sheet** — fidelity is one number over the entire
image, not per frame or per sequence. The sequences only drive the review UI's
animated playback. If you need a genuinely different subject, a different grid, or
different sequences, that is a new **case** (or a new version), not a variant.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the spec filename (e.g.
  `flat`);
- **display name** — title case, the variant's `name` (e.g. `Flat Shading`);
- **description** — one line naming the constraint (there is no menu label to
  carry it).

Favor a single constraint a reviewer can observe in the regenerated sheet — either
in a still frame or in a sequence the review UI plays back.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief:

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact
  colors, an operation cap, the technique required), and say whether it applies to
  every frame, to a named sequence, or across frames;
- reaffirm it draws toward the **same** `target` sheet and the **same** `[sheet]`
  grid and sequences — neither the goal image nor the frame layout changes.

A variant spec **may** reference the common specs freely (always seeded) but must
**not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the
variation makes checkable that the base does not — for a sheet this can be something
the **animation** reveals (e.g. "the walk sequences keep a constant silhouette
height across all frames" or "uses flat fills only, with no gradients or
dithering"). Each item is reporter-side (never seeded), carries a stable `id` unique
within the variant's effective set, and typically pairs `reference = "target"` and a
scoring `domain`.

### 4. Register the variant in `test-case.toml`

Add a `[[variant]]` table after the existing ones (the first variant is the
default). Do **not** add or change a `[sheet]` table here — the sheet is declared
once at the version level:

```toml
[[variant]]
slug = "flat"
name = "Flat Shading"
description = "Same sheet, drawn with flat fills only — no gradients or dithering, across every frame."
spec = [{ source = "specs/flat.md", dest = "specs/flat.md" }]
review_item = [
  { id = "flat-fills", title = "Flat fills only", text = "Every frame is filled with flat colors — no gradients or dithering in any cell.", reference = "target", domain = "fidelity" },
]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- **No `reference` entry** — a variant-specific reference is rejected for this test
  type, because the `target` is shared by every variant.
- **No per-variant `[sheet]` / `asset_kind`** — the sheet layout and asset kind are
  version-level; a variant cannot redeclare them.
- `review_item` entries are additive on the common ones; an item `id` must be
  unique within the variant's effective set, and any paired `reference` must be the
  common `target` (the only reference that exists).

Also update the human-readable comment in the manifest that enumerates the variants
so the list stays accurate.

## Validating

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not reword
  good prose to dodge the dictionary.
- Seed and render the **new** variant, and re-check the **existing** ones to
  confirm nothing else changed:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's brief is self-contained against
the shared target sheet, and that it leaves the `[sheet]` grid and sequences intact.

A backend-driven run resolves its definition from the backend's store, which skips
a version it already holds — so after adding the variant, **force a re-ingest** or
the new variant will not appear in a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place and is for **development**
only. Adding a variant edits an existing version, so do it only while that version
is unpublished; once a published run references the version it is immutable and a
variant change requires a **new version** instead. See
[`development/running.md`](../../../apps/docs/src/content/docs/development/running.md).

Commit on the repository's default branch with a conventional-commit message scoped
to the case, e.g. `feat(<slug>): add flat variant …`. Do not commit `node_modules/`
or local seed output.
