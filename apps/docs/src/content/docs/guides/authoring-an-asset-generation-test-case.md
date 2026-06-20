---
title: Authoring an Asset-Generation Test Case
---

An [asset-generation](/testing/asset-generation/overview/) test case asks a model
to **draw a small pixel sprite** with the `draw` tool — one recorded operation at
a time — toward a fixed target, rather than to build a game. Authoring one is
mostly writing a precise, **self-contained brief** and a fair target.
[Manifests](/testing/asset-generation/manifests/) is the authoritative schema —
every field and the rules enforced at resolution — and you should read it first,
along with the [Overview](/testing/asset-generation/overview/) (why the recorded
actions, not the pixels on disk, are the output) and
[Evaluation](/testing/asset-generation/evaluation/) (how fidelity and
cheat-divergence are scored). While doing the work, follow the
`authoring-an-asset-generation-test-case` skill.

Building a playable game instead is a different test type with its own manifest;
see [Authoring an End-to-End Test Case](/guides/authoring-an-end-to-end-test-case/).

The worked examples are the `gloamfin` and `lanternjaw` cases
(`test-cases/gloamfin/v1.0.0/`). Read one alongside this guide; a new case should
look like it.

## What a case is, and what gets seeded

A version lives under `test-cases/<slug>/<version>/`. Versioning is per-case and
**immutable**: once a run references a version, that version is frozen. Revise by
adding a new version, never by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, canvas, tool, output, target, variants
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief: what to draw + how the tool behaves — SEEDED
  schemas/operations.json # the draw operations the model may call — SEEDED
  reference/
    target.png           # the visual goal the regenerated sprite is scored against — SEEDED
    target.actions.json  # the action log target.png was rendered from — NOT seeded
```

A run receives only the seeded files: the selected variant's brief, the operations
schema, and the rendered `target.png`. It also gets the `draw` binary in its
environment. Everything marked *NOT seeded* is authoring- or site-side only.

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
  allowed, so fidelity scoring is unambiguous;
- **how the tool behaves** — that `draw` is the only way to make a mark, that it
  re-renders the preview after each call, and that the recorded actions are the
  output (anything drawn outside the tool is discarded).

The same self-containment and precise-values rules as an end-to-end spec apply:
the brief must stand on its own, with no link outside the seeded set, and every
visual detail written in real terms.

### 3. Seed the operations schema verbatim

The `[tool]` `operations` JSON Schema is seeded like a spec so the model knows the
drawing vocabulary. It must be the **canonical** schema the binary emits — copy it
from `draw schema` into `schemas/operations.json` and keep it **byte-for-byte
identical** so it never drifts from the tool.

### 4. Render the target from an action log

Do not hand-pixel the target. Author it as its own action log and render it
through the **same** binary, keeping the log as the un-seeded source beside it:

```sh
draw render --actions reference/target.actions.json --out reference/target.png
```

Rendering the goal through the tool guarantees it is achievable within the
operation set, so the fidelity baseline is fair. The rendered `target.png` is the
single `[[reference]]` (`view = "target"`), seeded as the visual goal. There are
no per-view reference mockups and no `theme.css`.

### 5. Write `prompt.hbs`

A short instruction that points the model at the seeded brief and operations
schema and states the hard requirements (draw only through the tool; return when
finished). The template renders in **strict mode**, so use only the documented
variables — `{{variant.slug}}`/`{{variant.name}}`/`{{variant.description}}` and
`{{#each specs}}`.

### 6. Write the manifest

Author `test-case.toml` per the [schema](/testing/asset-generation/manifests/):

- **Metadata** — `name`, `difficulty`, and `tags`, all required and site-facing.
- **`type = "asset-generation"`** — required. Omitting it defaults to
  `end-to-end`, which then rejects the tables below.
- **`[canvas]`** — the fixed `width`, `height`, and `background` the model draws
  on. Fixing the canvas keeps runs comparable.
- **`[tool]`** — the `binary` (`draw`), the seeded `operations` schema, and the
  `preview` path the binary re-renders to after each call.
- **`[output]`** — the `actions` log the binary records; this is the
  **authoritative output** the scored image is regenerated from.
- **One common `[[reference]]`** — `view = "target"` pointing at `target.png`.
  Exactly one is required, and a variant may **not** declare its own.
- At least one **`[[variant]]`** (the first is the default — usually `base`); see
  [Creating an Asset-Generation Variant](/guides/creating-an-asset-generation-variant/).
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain (e.g.
  `fidelity`) and the reviewer checklist that judges how faithfully the
  regenerated sprite matches the target. Each item typically pairs
  `reference = "target"` and a `domain`. These are reporter-side and **not
  seeded**.

There is **no `[build]` table** and **no `[[check]]`** — an asset-generation run
produces a recorded action log, not a static site, and its single
fidelity/divergence signal is computed by the validator, not by a declared check.

### 7. Write the non-seeded docs

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
exactly what the model would receive — the brief, the operations schema, and the
target screenshot — and confirm it is self-contained. When the case is ready,
exercise it end to end with [Run a Test Case](/quickstarts/run-a-test-case/).

## Next steps

- [Creating an Asset-Generation Variant](/guides/creating-an-asset-generation-variant/)
  — add a brief variation against the same target.
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess a run
  of your case.
