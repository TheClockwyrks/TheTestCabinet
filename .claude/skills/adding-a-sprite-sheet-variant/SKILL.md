---
description: Read this skill before adding a new variant to an existing SPRITE-SHEET asset-generation test case (asset_kind = "sprite-sheet") — a brief variation (tighter palette, operation budget, drawing technique, cross-frame consistency) the model draws toward the brief across the case's fixed [sheet] frames and sequences, registered in a version's test-case.toml. For a variant of a single-sprite case (asset_kind = "sprite") use adding-a-sprite-variant instead; for a variant of an end-to-end case (a playable mode) use adding-an-end-to-end-variant.
name: adding-a-sprite-sheet-variant
---

# Adding a Sprite-Sheet Variant

## What a sprite-sheet variant is

A sprite-sheet [asset-generation](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
test case (`asset_kind = "sprite-sheet"`) draws a **set of animation frames**, each
its own separate file, described by a `[sheet]` table (the declared
`[[sheet.frame]]` entries and one or more named `[[sheet.sequence]]` animations),
each drawn toward a goal **described in a brief** (there is no target image). Its
version offers one or more **variants**, and a run selects exactly one. Every
variant seeds the version's **common specs** (the brief) plus its own **additive**
specs. The chosen variant's slug is recorded in the run record.

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

## The defining constraint: a variant varies the brief; the sheet is fixed

This is where asset-generation variants differ sharply from end-to-end ones. There
is **no target image** at all, and resolution **forbids any `[[reference]]`**
(common *or* per-variant) and per-variant `[sheet]` tables. The frames are
human-reviewed against the brief, so a variant has nothing to "change the target"
of — there is none.

For a sprite sheet, two more things are fixed at the **version level** and a variant
cannot touch them:

- the **`asset_kind`** itself — a variant cannot turn a sheet into a single sprite
  (or vice versa);
- the **`[sheet]` layout** — the declared `[[sheet.frame]]` entries (each frame's
  index) and the named `[[sheet.sequence]]` animations are version-level metadata,
  so every variant draws the same frames and animates them at the same fps.

What a variant *can* do is vary the **brief** the model draws toward across those
fixed frames, via an additive spec:

- a **tighter palette** (a subset of the base colors), applied across every frame;
- a **stricter operation budget** (fewer operations allowed across all frames);
- a **required technique** (flat fills only; no dithering; left/right symmetry
  between mirrored directions);
- a **cross-frame consistency** rule the animation makes observable (e.g. a fixed
  silhouette height across a walk cycle, or a two-frame economy on a "tell").

Review stays exactly the same as the base: each regenerated **frame** is reviewed
against the brief — **per frame**, with no whole-sheet aggregate — and the sequences
drive the review UI's animated playback. If you need a genuinely different subject, a
different set of frames, or different sequences, that is a new **case** (or a new
version), not a variant.

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
- reaffirm it draws toward the **same** brief across the **same** `[sheet]` frames
  and sequences — neither the subject described nor the frame layout changes.

A variant spec **may** reference the common specs freely (always seeded) but must
**not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the
variation makes checkable that the base does not — for a sheet this can be something
the **animation** reveals (e.g. "the walk sequences keep a constant silhouette
height across all frames" or "uses flat fills only, with no gradients or
dithering"). Each item is reporter-side (never seeded), carries a stable `id` unique
within the variant's effective set, and a scoring `domain`. A sheet has no single
`target` reference, so its items carry just the `domain` (no `reference`).

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
  { id = "flat-fills", title = "Flat fills only", text = "Every frame is filled with flat colors — no gradients or dithering in any cell.", domain = "fidelity" },
]
```

```toml
# test-case.toml — add the new file to the ordered list (first = default)
variants = ["variants/base.toml", "variants/flat.toml"]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- **No `reference` entry** — an asset-generation case declares no references at all,
  so any reference (common or per-variant) is rejected; the sheet is reviewed against
  its brief.
- **No per-variant `[sheet]` / `asset_kind`** — the sheet's frames and sequences,
  and the asset kind, are version-level; a variant cannot redeclare them.
- `review_item` entries are additive on the common ones; an item `id` must be
  unique within the variant's effective set, and an item must **not** carry a
  `reference` field (there is no target to pair with).

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

Read the seeded output to confirm the new variant's brief is self-contained (no
target image is seeded), and that it leaves the `[sheet]` frames and sequences
intact.

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
