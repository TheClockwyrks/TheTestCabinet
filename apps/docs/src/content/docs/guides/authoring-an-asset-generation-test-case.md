---
title: Authoring an Asset-Generation Test Case
---

An [asset-generation](/testing/asset-generation/overview/) test case asks a model
to **draw a small pixel sprite** with the `draw` tool (or `draw-sheet` for a sprite
sheet) — one recorded operation at a time — toward a fixed target, rather than to
build a game. Authoring one is
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

A case draws **either a single sprite or a sprite sheet** (a set of animation
frames, each its own separate file), chosen by the manifest's `asset_kind` field —
a version-level choice, not a variant. The worked examples: the `spectra-fighter`,
`spectra-shard`, `spectra-flux`, and `spectra-prism` cases are **single sprites**
(`asset_kind = "sprite"`, the default), drawn with `draw`; the `gloamfin`,
`lanternjaw`, and `emberfin` cases are **sprite sheets**
(`asset_kind = "sprite-sheet"`), drawn with `draw-sheet --frame <index>`, with a
`[sheet]` table of per-frame targets and named animation sequences. Read the one
matching the kind you are authoring alongside this guide; a new case should look
like it.

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
  reference/
    target.png           # SINGLE SPRITE: the goal the sprite is scored against — SEEDED
    target.actions.json  # the action log target.png was rendered from — NOT seeded
    frames/<index>.png   # SPRITE SHEET instead: one target per declared frame — SEEDED
```

A run receives only the seeded files: the selected variant's brief and the seeded
target(s) — `target.png` for a single sprite, or `reference/frames/<index>.png` per
frame for a sheet. It also gets the `draw` (or `draw-sheet`) binary in its
environment, whose `--help` is the operations contract; **no operations schema is
seeded**. Everything marked *NOT seeded* is authoring- or site-side only.

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

### 3. Render the target(s) from action logs

Do not hand-pixel a target. Author it as its own action log and render it through
the **same** binary, keeping the log as the un-seeded source beside it. This
guarantees the goal is achievable within the operation set, so the fidelity
baseline is fair. There are no per-view reference mockups and no `theme.css`.

For a **single sprite**, render one `target.png`, the single `[[reference]]`
(`view = "target"`):

```sh
draw render --actions reference/target.actions.json --out reference/target.png \
  --width <canvas width> --height <canvas height> --background transparent
```

For a **sprite sheet**, every frame is a separate file: author one log per frame
and render each at the **frame size** to `reference/frames/<index>.png`, which a
`[[sheet.frame]]` declares as that frame's `target`.

### 4. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the operations, and states the hard requirements (draw only
through the tool; return when finished). The template renders in **strict mode**, so
use only the documented variables —
`{{variant.slug}}`/`{{variant.name}}`/`{{variant.description}}` and
`{{#each specs}}`.

### 5. Write the manifest

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
  sheet, one log per frame); this is the **authoritative output** the scored image
  is regenerated from.
- **The target(s)** — a single sprite declares one `[[reference]]`
  (`view = "target"`, pointing at `target.png`); a sprite sheet declares **no
  `[[reference]]`** and instead gives each `[[sheet.frame]]` its own `target`. A
  variant may **not** declare its own.
- **`[sheet]` (sprite sheets only)** — the `[[sheet.frame]]` entries (each frame's
  `index` and `target`) and the named `[[sheet.sequence]]` animations.
- At least one **`[[variant]]`** (the first is the default — usually `base`); to
  add more, see
  [Creating a Single-Sprite Variant](/guides/creating-a-sprite-variant/) or
  [Creating a Sprite-Sheet Variant](/guides/creating-a-sprite-sheet-variant/),
  per the case's `asset_kind`.
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain (e.g.
  `fidelity`) and the reviewer checklist that judges how faithfully the
  regenerated sprite (or sheet) matches the target. A single-sprite item may pair
  `reference = "target"` and a `domain`; a sheet has no single `target` reference,
  so its items carry just a `domain`. These are reporter-side and **not seeded**.

There is **no `[build]` table** and **no `[[check]]`** — an asset-generation run
produces a recorded action log, not a static site, and its fidelity/divergence
signals are computed by the validator, not by a declared check.

### 6. Write the non-seeded docs

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
exactly what the model would receive — the brief and the target(s), plus the
seeded `draw.config.json` and blank starting frame(s) — and confirm it is
self-contained. When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/run-a-test-case/).

## Next steps

- [Creating a Single-Sprite Variant](/guides/creating-a-sprite-variant/) or
  [Creating a Sprite-Sheet Variant](/guides/creating-a-sprite-sheet-variant/)
  (per the case's `asset_kind`) — add a brief variation against the same target.
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — assess a run
  of your case.
