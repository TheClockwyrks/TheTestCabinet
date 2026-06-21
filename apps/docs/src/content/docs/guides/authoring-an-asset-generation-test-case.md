---
title: Authoring an Asset-Generation Test Case
---

An [asset-generation](/testing/asset-generation/overview/) test case asks a model
to **draw a small pixel sprite** with the `draw` tool (or `draw-sheet` for a sprite
sheet) — one recorded operation at a time — to **match a written brief**, rather
than to build a game. There is **no target image**: the model is given a precise
description and the freedom to draw something that matches it, so the case rewards
creativity rather than the faithful reproduction of a supplied picture. Authoring
one is mostly writing a precise, **self-contained brief**.
[Manifests](/testing/asset-generation/manifests/) is the authoritative schema —
every field and the rules enforced at resolution — and you should read it first,
along with the [Overview](/testing/asset-generation/overview/) (why the recorded
actions, not the pixels on disk, are the output) and
[Evaluation](/testing/asset-generation/evaluation/) (how the asset is
human-reviewed against the brief, and how cheat-divergence is detected). While
doing the work, follow the `authoring-an-asset-generation-test-case` skill.

Building a playable game instead is a different test type with its own manifest;
see [Authoring an End-to-End Test Case](/guides/authoring-an-end-to-end-test-case/).

A case draws **either a single sprite or a sprite sheet** (a set of animation
frames, each its own separate file), chosen by the manifest's `asset_kind` field —
a version-level choice, not a variant. The worked examples: the `spectra-fighter`,
`spectra-shard`, `spectra-flux`, and `spectra-prism` cases are **single sprites**
(`asset_kind = "sprite"`, the default), drawn with `draw`; the `gloamfin`,
`lanternjaw`, and `emberfin` cases are **sprite sheets**
(`asset_kind = "sprite-sheet"`), drawn with `draw-sheet --frame <index>`, with a
`[sheet]` table of declared frames and named animation sequences. Read the one
matching the kind you are authoring alongside this guide; a new case should look
like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, canvas, tool, output, sheet, variants
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: what to draw + how the tool behaves — SEEDED
```

A run receives only the seeded files: the selected variant's brief. There is **no
target image** — the model draws to match the brief, not to copy a supplied
picture. It also gets the `draw` (or `draw-sheet`) binary in its environment, whose
`--help` is the operations contract; **no operations schema is seeded**. Everything
marked *NOT seeded* is authoring- or site-side only.

## Procedure

### 1. Choose the subject and confirm it qualifies

Pick a catalog **slug** for the lineage (e.g. `gloamfin`) and the **subject** to
draw. A good subject reads clearly at the canvas size from silhouette and palette
alone, needs no surrounding game context, and is achievable within the tool's
operation set. Pick a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` — a single self-contained file describing:

- **what to draw** — the subject, its silhouette and orientation, and the framing
  within the canvas;
- the **exact palette** — named colors with hex values, stated as the only colors
  allowed, so a reviewer can judge the asset against the brief unambiguously;
- **how the tool behaves** — that `draw` is the only way to make a mark, that it
  re-renders the preview after each call, and that the recorded actions are the
  output (anything drawn outside the tool is discarded).

The same self-containment and precise-values rules as an end-to-end spec apply:
the brief must stand on its own, with no link outside the seeded set, and every
visual detail written in real terms.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the operations, and states the hard requirements (draw only
through the tool; return when finished). The template renders in **strict mode**, so
use only the documented variables —
`{{variant.slug}}`/`{{variant.name}}`/`{{variant.description}}` and
`{{#each specs}}`.

### 4. Write the manifest

Author `test-case.toml` per the [schema](/testing/asset-generation/manifests/):

- **Metadata** — `name`, `difficulty`, and `tags`, all required and site-facing.
- **`type = "asset-generation"`** — required. Omitting it defaults to
  `end-to-end`, which then rejects the tables below.
- **`[canvas]`** — the fixed `width`, `height`, and `background` the model draws
  on. For a sprite sheet this is **one frame** (each frame is a separate file of
  this size). Fixing it keeps runs comparable.
- **`[tool]`** — the `binary` (`draw`, or `draw-sheet` for a sheet) and the
  `preview` path the binary re-renders to after each call (a `{frame}` template for
  a sheet). **No operations schema** — the binary's `--help` is the contract.
- **`[output]`** — the `actions` log the binary records (a `{frame}` template for a
  sheet, one log per frame); this is the **authoritative output** the reviewed image
  is regenerated from.
- **No references** — an asset-generation case declares **no `[[reference]]`** at
  all. It has no target image; the regenerated asset is reviewed against the brief.
  Declaring a `[[reference]]` — common or per-variant — is rejected.
- **`[sheet]` (sprite sheets only)** — the `[[sheet.frame]]` entries (each just the
  `index` it is written to) and the named `[[sheet.sequence]]` animations.
- At least one **`[[variant]]`** (the first is the default — usually `base`); to
  add more, see
  [Creating a Single-Sprite Variant](/guides/creating-a-sprite-variant/) or
  [Creating a Sprite-Sheet Variant](/guides/creating-a-sprite-sheet-variant/),
  per the case's `asset_kind`.
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain and the
  reviewer checklist that guides how the regenerated sprite (or sheet) is judged
  against the brief. A review item carries only a `domain` (and an optional weight,
  title, text, or id); it must **not** carry a `reference` field — there is no
  target to point at, and one is rejected. These are reporter-side and **not
  seeded**.

There is **no `[build]` table** and **no `[[check]]`** — an asset-generation run
produces a recorded action log, not a static site, and its cheat-divergence signal
is computed by the validator, not by a declared check.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach
a run; keep them honest about what is seeded.

## Validate your work

There is no separate authoring linter — you validate a case by resolving and
seeding it. For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` renders the instruction (catching strict-mode template errors and
manifest problems); `seed` writes the seeded repository to disk so you can read
exactly what the model would receive — the brief, plus the seeded
`draw.config.json` and blank starting frame(s) — and confirm it is self-contained.
When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/run-a-test-case/).

## Next steps

- [Creating a Single-Sprite Variant](/guides/creating-a-sprite-variant/) or
  [Creating a Sprite-Sheet Variant](/guides/creating-a-sprite-sheet-variant/)
  (per the case's `asset_kind`) — add a brief variation the model draws toward.
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess a run
  of your case.
