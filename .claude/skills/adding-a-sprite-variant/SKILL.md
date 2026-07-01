---
description: Read this skill before adding a new variant to an existing SINGLE-SPRITE asset-generation test case (asset_kind = "sprite") — a brief variation (tighter palette, operation budget, drawing technique) the model draws toward the brief, registered in a version's test-case.toml. For a variant of a sprite-sheet case (asset_kind = "sprite-sheet") use adding-a-sprite-sheet-variant instead; for a variant of an end-to-end case (a playable mode) use adding-an-end-to-end-variant.
name: adding-a-sprite-variant
---

# Adding a Single-Sprite Variant

## What a single-sprite variant is

A single-sprite [asset-generation](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
test case (`asset_kind = "sprite"`, the default) draws **one sprite onto the whole
canvas** toward a goal **described in a brief** (there is no target image). Its
version offers one or more **variants**, and a run selects exactly one. Every
variant seeds the version's **common specs** (the brief) plus its own **additive**
specs. The chosen variant's slug is recorded in the run record.

This skill covers variants of **single-sprite** asset-generation cases. For a
variant of a **sprite-sheet** case — one whose `[sheet]` table declares a set of
animation frames, each a separate file — use the
[`adding-a-sprite-sheet-variant`](../adding-a-sprite-sheet-variant/SKILL.md) skill,
where a variant draws toward the brief across the version's fixed frames and named
sequences. For a variant of an
**end-to-end** case — a playable mode with its own menu and rules — use the
[`adding-an-end-to-end-variant`](../adding-an-end-to-end-variant/SKILL.md) skill. To
author a brand-new case, use
[`authoring-an-asset-generation-test-case`](../authoring-an-asset-generation-test-case/SKILL.md).

The authoritative schema lives in
[`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md);
read it before starting.

## The defining constraint: a variant varies the brief

This is where asset-generation variants differ sharply from end-to-end ones. There
is **no target image** at all, and resolution **forbids any `[[reference]]`**
(common *or* per-variant). The asset is human-reviewed against the brief, so a
variant has nothing to "change the target" of — there is none.

What a variant *can* do is vary the **brief** the model draws toward, via an
additive spec:

- a **tighter palette** (a subset of the base colors);
- a **stricter operation budget** (fewer operations allowed);
- a **required technique** (flat fills only; no dithering; symmetry);
- another **stylistic constraint** observable in the regenerated sprite.

If you need a genuinely different subject, that is a new **case**, not a variant.

## Procedure

### 1. Choose the variation

Decide the constraint the variant imposes and keep it consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the spec filename (e.g.
  `flat`);
- **display name** — title case, the variant's `name` (e.g. `Flat Shading`);
- **description** — one line naming the constraint (there is no menu label to
  carry it).

Favor a single constraint a reviewer can observe in the regenerated sprite.

### 2. Write the variant brief

Create `specs/<slug>.md`, stated as a **delta** against the common brief:

- open by stating it builds on the common brief, by name;
- state the added or tightened constraint with **precise, testable** terms (exact
  colors, an operation cap, the technique required);
- reaffirm it draws toward the **same** brief — the subject described does not
  change, only the added constraint.

A variant spec **may** reference the common specs freely (always seeded) but must
**not** reference another variant's spec.

### 3. Add review items for what the variation makes observable

In the manifest, add `[[review_item]]`s under the variant for the thing the
variation makes checkable that the base does not (e.g. "uses flat fills only, with
no gradients or dithering"). Each item is reporter-side (never seeded), carries a
stable `id` unique within the variant's effective set, and carries only a scoring
`domain` (no `reference` — there is no target to pair with).

### 4. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose **top-level keys
are the variant's fields**, then add its path to the `variants` array in
`test-case.toml` (the first entry is the default). Paths inside resolve against the
version folder, and `dest` defaults to `source`, so the brief spec just names its
`source`:

```toml
# variants/flat.toml
slug = "flat"
name = "Flat Shading"
description = "Same brief, drawn with flat fills only — no gradients or dithering."
spec = [{ source = "specs/flat.md" }]
review_item = [
  { id = "flat-fills", title = "Flat fills only", text = "Every region is a flat color with no gradients or dithering.", domain = "fidelity" },
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
  so any reference (common or per-variant) is rejected; the case is reviewed against
  its brief.
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
target image is seeded).

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
