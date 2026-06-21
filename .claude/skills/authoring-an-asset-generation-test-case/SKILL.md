---
description: Read this skill before creating a new asset-generation test case or version (a sprite the model draws with the `draw` tool, one recorded operation at a time), or when authoring or revising such a case's brief, prompt, target, operations schema, or manifest under test-cases/. For an end-to-end case (building a playable game) use authoring-an-end-to-end-test-case instead.
name: authoring-an-asset-generation-test-case
---

# Authoring an Asset-Generation Test Case

## What an asset-generation test case is

An asset-generation test case asks a model to **draw a small pixel sprite** with a
drawing binary (`draw`), one recorded operation at a time, toward a fixed target.
It does not measure code generation; it measures how well a model drives a drawing
tool toward a goal image through many small, deliberate steps. Authoring one is
mostly writing a precise, self-contained **brief** and a **fair target**.

The authoritative docs are the source of truth — **read them first** and follow
them as the authority:

- [`testing/asset-generation/overview.md`](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  — what the type measures, and why the recorded **action log** (not the pixels on
  disk) is the authoritative output;
- [`testing/asset-generation/manifests.md`](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md)
  — every manifest field and the rules enforced at resolution;
- [`testing/asset-generation/evaluation.md`](../../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md)
  — how fidelity (vs. the target) and cheat-divergence (vs. the on-disk preview)
  are scored.

This skill covers the **asset-generation** test type only. For an **end-to-end**
case — building a playable game from a spec — use the
[`authoring-an-end-to-end-test-case`](../authoring-an-end-to-end-test-case/SKILL.md)
skill. To add a variant to an existing asset-generation version, use the skill
matching its `asset_kind`:
[`adding-a-sprite-variant`](../adding-a-sprite-variant/SKILL.md) for a
single-sprite case or
[`adding-a-sprite-sheet-variant`](../adding-a-sprite-sheet-variant/SKILL.md) for a
sprite-sheet case.

An asset-generation case draws **either a single sprite or a sprite sheet** (a
grid of animation frames), chosen by the manifest's `asset_kind` field. This is a
property of the whole version, **not** a variant — a case is one or the other,
never both. The worked examples:

- **Single sprite** (`asset_kind = "sprite"`, the default): the `spectra-fighter`,
  `spectra-shard`, `spectra-flux`, and `spectra-prism` cases — one 64×64 sprite
  each.
- **Sprite sheet** (`asset_kind = "sprite-sheet"`): the `gloamfin`, `lanternjaw`,
  and `emberfin` cases — a 128×128 sheet of 32×32 frames with four-direction
  movement and a signature "tell" animation, declared as named sequences the
  review UI plays back.

Read the one matching the kind you are authoring alongside this skill — a new case
should look like it.

## Anatomy of a test case version

```text
test-cases/<slug>/<version>/
  test-case.toml          # manifest: type, canvas, tool, output, target, variants, domains, review items
  prompt.hbs              # rendered per run into the model's instruction (NOT seeded)
  description.md          # site-facing prose (NOT seeded)
  README.md               # human overview (NOT seeded)
  specs/
    brief.md              # the brief: what to draw + how the tool behaves — SEEDED
  schemas/
    operations.json       # the draw operations the model may call — SEEDED (verbatim `draw schema`)
  reference/
    target.png            # the visual goal the regenerated sprite is scored against — SEEDED
    target.actions.json   # the action log target.png was rendered from — NOT seeded (authoring source)
```

What a run receives: the selected variant's seeded specs (the common brief + the
operations schema + any variant-additive brief), and the rendered `target.png`. It
also gets the `draw` binary in its environment. Everything marked *NOT seeded* is
authoring- or site-side only; the prompt is rendered and handed to the harness as
the instruction, never written to disk.

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
  colors allowed, so fidelity scoring is unambiguous;
- **how the tool behaves** — `draw` is the only way to make a mark, it re-renders
  the preview after each call so the model can read its progress, and the recorded
  actions are the output (anything drawn outside the tool is discarded).

The self-containment, *what-not-how*, and precise-values rules from **Writing the
brief** below apply.

### 3. Seed the operations schema verbatim

The `[tool]` `operations` JSON Schema is seeded like a spec so the model knows the
drawing vocabulary. It must be the **canonical** schema the binary emits: copy it
from `draw schema` into `schemas/operations.json` and keep it **byte-for-byte
identical** so it never drifts from the binary.

### 4. Render the target from an action log

Do **not** hand-pixel the target. Author it as its own action log and render it
through the **same** binary, keeping the log as the un-seeded source beside it:

```sh
draw render --actions reference/target.actions.json --out reference/target.png \
  --width <canvas width> --height <canvas height> --background transparent
```

Rendering the goal through the tool guarantees it is achievable within the
operation set, so the fidelity baseline is fair. The rendered `target.png` is the
single `[[reference]]` (`view = "target"`); there are no per-view reference mockups
and no `reference/theme.css`.

For a **sprite sheet** the target is the full sheet: author every frame in its
grid cell (offset each operation by `(frame_width·col, frame_height·row)`) and
render at the sheet's `--width`/`--height`. Author and check one frame (or one
direction) at a time against the cell before filling the rest, and make sure the
frames each named `[[sheet.sequence]]` references actually animate cleanly — the
sequences are what a reviewer watches.

### 5. Write `prompt.hbs`

A short instruction that points the model at the seeded brief and operations schema
and restates the hard requirements (draw only through the tool; return when
finished). It renders in **strict mode**, so use only the documented template
variables (`{{variant.*}}`, `{{#each specs}}`) — any other reference is an error.
Model it on an existing case's `prompt.hbs` (e.g. `spectra-shard` for a single
sprite, `gloamfin` for a sheet — a sheet's prompt also explains the frame grid).

### 6. Write the manifest

Author `test-case.toml` per the
[manifests schema](../../../apps/docs/src/content/docs/testing/asset-generation/manifests.md):

- **Metadata** — `name`, `difficulty`, `tags` (site-facing), `summary`,
  `description`, `prompt`, `max_runtime_seconds`.
- **`type = "asset-generation"`** — required. Omitting it defaults to `end-to-end`,
  which then rejects the tables below.
- **`asset_kind`** — `"sprite"` (the default; omit it) or `"sprite-sheet"`. For a
  sprite sheet, also declare the **`[sheet]`** table (below). `asset_kind` is a
  version-level choice, not a variant.
- **`[canvas]`** — the fixed `width`, `height`, and `background`. Fixing the canvas
  keeps runs comparable. For a sprite sheet this is the **full sheet** size (e.g.
  `128×128` for a 4×4 grid of 32×32 frames).
- **`[tool]`** — `binary = "draw"`, the seeded `operations` schema, and the
  `preview` path the binary re-renders to after each call.
- **`[output]`** — the `actions` log the binary records; this ordered list is the
  **authoritative output** the scored image is regenerated from.
- **`[sheet]`** — **sprite sheets only.** The frame grid (`frame_width`,
  `frame_height`, `columns`, `rows`) that tiles the `[canvas]` exactly
  (`columns*frame_width == canvas width`, `rows*frame_height == canvas height`),
  plus one or more **`[[sheet.sequence]]`** entries — each a `slug`, optional
  `name`, an ordered `frames` list of row-major frame indices, and an `fps`. Frames
  are numbered row-major from the top-left. The sequences are what the review UI
  animates (regenerated vs target); they do not enter scoring, which stays
  whole-sheet. Omit this table entirely for a single sprite.
- **One common `[[reference]]`** — `view = "target"` with a static-image `media`
  pointing at `target.png`. Resolution requires **exactly one** and forbids a
  variant from declaring its own.
- At least one **`[[variant]]`** (the first is the default — usually `base`); to
  add more, see
  [`adding-a-sprite-variant`](../adding-a-sprite-variant/SKILL.md) (single sprite)
  or
  [`adding-a-sprite-sheet-variant`](../adding-a-sprite-sheet-variant/SKILL.md)
  (sprite sheet).
- **`[[domain]]`** and **`[[review_item]]`** — at least one scoring domain (e.g.
  `fidelity`) and the reviewer checklist judging how faithfully the regenerated
  sprite matches the target (silhouette, palette, framing). Each item typically
  pairs `reference = "target"` and a `domain`. Reporter-side; **not seeded**.

There is **no `[build]` table** and **no `[[check]]`** — an asset-generation run
produces a recorded action log, not a static site, and resolution rejects both for
this type.

### 7. Write the non-seeded docs

`description.md` (site blurb) and `README.md` (human overview). These never reach a
run; keep them honest about what is seeded.

## Writing the brief

The brief is the test case. The rules that make one good:

- **Be self-contained.** A run seeds only the brief, the operations schema, and the
  target screenshot, in an isolated container with no access to these docs. The
  brief must be complete on its own — no link outside the seeded set, no dependence
  on the un-seeded target action log.
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
receive — the brief, the operations schema, and the target screenshot. (`tcab
validate` reads the local checkout directly and is not affected by the backend
store being stale.)

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
