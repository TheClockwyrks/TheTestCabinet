---
description: Read this skill before creating a new asset-generation test case or version (a sprite the model draws with the `draw` or `draw-sheet` tool, one recorded operation at a time), or when authoring or revising such a case's brief, prompt, or manifest under test-cases/. For an end-to-end case (building a playable game) use authoring-an-end-to-end-test-case instead.
name: authoring-an-asset-generation-test-case
---

# Authoring an Asset-Generation Test Case

## What an asset-generation test case is

An asset-generation test case asks a model to **draw a small pixel sprite** with a
drawing binary (`draw` for a single sprite, `draw-sheet` for a sprite sheet), one
recorded operation at a time, toward a goal **described in a brief**.
It does not measure code generation; it measures how well a model drives a drawing
tool toward that description through many small, deliberate steps. The result is
**subjective** — the model is given a precise written brief and the freedom to draw
something that matches it, so the case rewards creativity rather than the faithful
reproduction of a supplied picture. There is **no target image**. Authoring one is
mostly writing a precise, self-contained **brief**.

The authoritative docs are the source of truth — **read them first** and follow
them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures, and why the recorded **action log** (not the pixels on
  disk) is the authoritative output;
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field and the rules enforced at resolution;
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — how the regenerated asset is human-reviewed against the brief (there is no
  automated similarity score) and how cheat-divergence (vs. the on-disk preview)
  flags drawing outside the tool.

This skill covers the **asset-generation** test type only. For an **end-to-end**
case — building a playable game from a spec — use the
[`authoring-an-end-to-end-test-case`](../authoring-an-end-to-end-test-case/SKILL.md)
skill. To add a variant to an existing asset-generation version, use the skill
matching its `asset_kind`:
[`adding-a-sprite-variant`](../adding-a-sprite-variant/SKILL.md) for a
single-sprite case or
[`adding-a-sprite-sheet-variant`](../adding-a-sprite-sheet-variant/SKILL.md) for a
sprite-sheet case.

An asset-generation case draws **either a single sprite or a sprite sheet** (a set
of animation frames, each its own separate file), chosen by the manifest's
`asset_kind` field. This is a property of the whole version, **not** a variant — a
case is one or the other, never both. The worked examples:

- **Single sprite** (`asset_kind = "sprite"`, the default): the `spectra-fighter`,
  `spectra-shard`, `spectra-flux`, and `spectra-prism` cases — one 64×64 sprite
  each, drawn with `draw`.
- **Sprite sheet** (`asset_kind = "sprite-sheet"`): the `lanternjaw`, `gloamfin`,
  and `flarefish` creature cases — 32×32 frames of four-direction movement
  (`lanternjaw` also carries a signature on-body "tell" animation); the
  `trench-walls` tileset — a 32×32 autotile of seamless wall pieces plus the
  floor, fog, and gate; and the `sonar-pulse` and `flare-bloom` cases — large
  128×128 area-effect animations. All are drawn with `draw-sheet --frame <index>`
  and declared as named sequences the review UI plays back.

Read the one matching the kind you are authoring alongside this skill — a new case
should look like it.

## Anatomy of a test case version

```text
test-cases/<slug>/<version>/
  test-case.toml          # manifest: type, canvas, tool, output, variants, domains, review items
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/
    brief.md              # the brief: what to draw + how the tool behaves — SEEDED
```

What a run receives: the selected variant's seeded specs (the common brief + any
variant-additive brief). There is **no target image** — the model draws toward the
brief alone. It also gets the `draw` (or `draw-sheet`) binary in its environment,
whose `--help` is the operations contract; **no operations schema is seeded**.
Everything marked *NOT seeded* is site-side only; the prompt is rendered and handed
to the harness as the instruction, never written to disk.

## Creating a new case — procedure

### 1. Choose the subject and confirm it qualifies

Pick a **catalog slug** for the lineage (e.g. `gloamfin`) and the **subject** to
draw. A good subject reads clearly at the canvas size from silhouette and palette
alone, needs no surrounding game context, and is achievable within the tool's
operation set. Pick a `version` (`vX.Y.Z`); a version is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

### 2. Write the brief

Seed a single self-contained `specs/brief.md` (not a decomposed spec). State:

- **what to draw** — the subject, its silhouette and orientation, and the framing
  within the canvas;
- the **exact palette** — named colors with hex values, declared as the only
  colors allowed, so the brief is unambiguous;
- **how the tool behaves** — the drawing binary (`draw`, or `draw-sheet --frame
  <index>` for a sheet) is the only way to make a mark, its `--help` lists the
  operations, it re-renders the preview after each call so the model can read its
  progress, and the recorded actions are the output (anything drawn outside the
  tool is discarded).

The self-containment, *what-not-how*, and precise-values rules from **Writing the
brief** below apply.

### 3. Write `prompt.hbs`

A short instruction that points the model at the seeded brief, tells it to read the
binary's `--help` for the operations, and restates the hard requirements (draw only
through the tool; return when finished). It renders in **strict mode**, so use only
the documented template variables (`{{variant.*}}`, `{{#each specs}}`) — any other
reference is an error. Model it on an existing case's `prompt.hbs` (e.g.
`spectra-shard` for a single sprite, `gloamfin` for a sheet — a sheet's prompt also
explains the per-frame `--frame` model).

### 4. Write the manifest

Author `test-case.toml` per the
[manifests schema](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md):

- **Metadata** — `name`, `difficulty`, `tags` (site-facing), `summary`,
  `description`, `prompt`, `max_runtime_seconds`.
- **`type = "asset-generation"`** — required. Omitting it defaults to `end-to-end`,
  which then rejects the tables below.
- **`asset_kind`** — `"sprite"` (the default; omit it) or `"sprite-sheet"`. For a
  sprite sheet, also declare the **`[sheet]`** table (below). `asset_kind` is a
  version-level choice, not a variant.
- **`[canvas]`** — the fixed `width`, `height`, and `background`. Fixing it keeps
  runs comparable. For a sprite sheet this is **one frame** (every frame is a
  separate file of this size — e.g. `32×32`).
- **`[tool]`** — `binary = "draw"` (single sprite) or `"draw-sheet"` (sheet) and
  the `preview` path the binary re-renders to after each call (a `{frame}` template
  for a sheet, e.g. `frames/{frame}.png`). **No operations schema** — the binary's
  `--help` is the contract.
- **`[output]`** — the `actions` log the binary records; this ordered list is the
  **authoritative output** the scored image is regenerated from. A sheet records
  one log per frame, so its path is a `{frame}` template (e.g.
  `frames/{frame}.actions.json`).
- **`[sheet]`** — **sprite sheets only.** The case's frames as **`[[sheet.frame]]`**
  entries — each just the `index` it is written to (passed as `draw-sheet --frame`)
  — plus one or more **`[[sheet.sequence]]`** entries: each a `slug`, optional
  `name`, an ordered `frames` list of **declared** frame indices, and an `fps`. The
  number of frames is just how many are declared. The sequences are what the review
  UI animates (the per-frame regenerated images) so a reviewer can judge the motion
  against the brief. Omit this table entirely for a single sprite.
- **No targets** — an asset-generation case declares **no `[[reference]]`** at all
  (common *or* per-variant); resolution rejects any reference. The case is reviewed
  against its brief, with no goal image to score the regenerated asset against.
- At least one **`[[variant]]`** (the first is the default — usually `base`); to
  add more, see
  [`adding-a-sprite-variant`](../adding-a-sprite-variant/SKILL.md) (single sprite)
  or
  [`adding-a-sprite-sheet-variant`](../adding-a-sprite-sheet-variant/SKILL.md)
  (sprite sheet).
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain (e.g.
  `fidelity`) and the reviewer checklist judging how convincingly the regenerated
  sprite (or sheet) realizes the brief (silhouette, palette, framing, animation).
  Each item carries only a `domain` (plus its `id`/`title`/`text`/optional
  `weight`) — an item must **not** carry a `reference` field (there is no target to
  pair with; resolution rejects it). Reporter-side; **not seeded**.

There is **no `[build]` table** and **no `[[check]]`** — an asset-generation run
produces a recorded action log, not a static site, and resolution rejects both for
this type.

### 5. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** A run seeds only the brief, in an isolated container with
  no access to these docs and no target image. The brief must be complete on its own
  — no link outside the seeded set, and it points at the binary's `--help` for the
  operations.
- **Specify *what*, not *how*.** Describe the subject, palette, and framing the
  sprite must achieve; leave the order of operations and technique to the model
  (except where a variant deliberately constrains technique).
- **Use precise, testable values.** Pin the palette to exact hex values, state the
  framing in pixels against the fixed canvas, and name the silhouette features that
  must read. Vague prose is the most common failure.
- **Keep the bar high.** Ask for a faithful, polished sprite that reads
  unmistakably as the subject, not a rough approximation.

## Validating

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not reword
  good prose to dodge the dictionary.
- Confirm the manifest resolves and the seeded set is self-contained by rendering
  the prompt and seeding the repository for **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors; `seed` writes the seeded
repository (under `tmp/` by default) so you can read exactly what the model would
receive — the brief, plus the seeded `draw.config.json` and the blank starting
frame(s), and no target image. (`tcab validate` reads the local checkout directly
and is not affected by the backend store being stale.)

### Re-ingest after editing

A backend-driven run (the desktop and web consoles) resolves its definition from
the backend's **immutable def store**, which skips a version it already holds — and
the asset-generation tables (`type`, `[canvas]`, `[tool]`, `[output]`) are newer
fields, so a stale def serves them empty and the run is treated as end-to-end.
After editing a case you must **force a re-ingest** for the change to reach a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place — do this **only during
development**, while iterating on a version no run has been published against. Once
a published run references a version it is **immutable**: revise by creating a
**new version** (bump `vX.Y.Z`), never by editing and re-ingesting the published
one. See
[`development/running.md`](../../../apps/docs/src/content/docs/development/running.md).

Commit on the repository's default branch with a conventional-commit message scoped
to the case (e.g. `feat(<slug>): add <version> …`). Do not commit `node_modules/`
or the rendered local `tmp/` seed output.
