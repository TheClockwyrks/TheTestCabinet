---
title: Author an Asset-Generation Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case —
a sprite the model draws with the `draw` tool (or a sprite sheet with `draw-sheet`),
one recorded operation at a time (or a new version of an existing one). This is the
short version;
[Authoring an Asset-Generation Test Case](/guides/authoring-an-asset-generation-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/) is the
authoritative schema.

Building a playable game instead? See
[Author an End-to-End Test Case](/quickstarts/author-an-end-to-end-test-case/) —
that is a different test type with a `[build]` and reference mockups.

## Layout

A version lives at `test-cases/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, canvas, tool, output, target, variants
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  specs/brief.md         # what to draw + how the tool behaves — SEEDED
  reference/
    target.png           # SINGLE SPRITE: the goal the sprite is scored against — SEEDED
    target.actions.json  # the action log target.png was rendered from — NOT seeded
    frames/<index>.png   # SPRITE SHEET instead: one target per declared frame — SEEDED
```

## Steps

1. Pick a catalog **slug** (e.g. `gloamfin`) and the **subject** to draw. It
   should read clearly at the canvas size and need no in-game context.
2. Write `specs/brief.md`: the subject, silhouette, **exact palette**, framing,
   and how the tool behaves — including that its `--help` lists the operations.
   Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications) —
   the model sees only the seeded files. There is **no operations schema**.
3. **Render the target(s) from action logs, don't hand-pixel them.** Author each
   goal as its own log and render it through the same binary, keeping the log as the
   un-seeded source. A single sprite is one `target.png`; a sprite sheet is one
   `reference/frames/<index>.png` per declared frame, each rendered at the frame
   size:

   ```sh
   draw render --actions reference/target.actions.json --out reference/target.png \
     --width <w> --height <h> --background transparent
   ```

   This guarantees the target is achievable within the operation set, so fidelity
   scoring is fair.
4. Write `prompt.hbs` using only the documented template variables
   (`{{variant.*}}`, `{{#each specs}}`) — it renders in strict mode — and point the
   model at the binary's `--help`.
5. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`),
   `type = "asset-generation"`, `asset_kind` (`"sprite"` — the default — or
   `"sprite-sheet"`), the `[canvas]`/`[tool]`/`[output]` tables, at least one
   `[[variant]]`, and the `[[domain]]`/`[[review_item]]`s that score the drawing. A
   single sprite declares one `[[reference]]` named `target`; a sprite-sheet case
   declares a `[sheet]` table (the `[[sheet.frame]]` entries with per-frame targets
   and the named `[[sheet.sequence]]` animations) and **no `[[reference]]`**. There
   is **no `[build]`** and **no `[[check]]`**.

The `authoring-an-asset-generation-test-case` skill is the practical procedure to
follow; read it before you start. The single-sprite worked examples are the
`spectra-*` cases; the sprite-sheet worked examples are `gloamfin`, `lanternjaw`,
and `emberfin` — read the one matching the kind you are authoring.

## Validate

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

Render the prompt and inspect the seeded repository to confirm the manifest
resolves and the seeded set (brief + target(s) + the seeded `draw.config.json` and
blank starting frame(s)) is self-contained.

## Next steps

- [Create a Single-Sprite Variant](/quickstarts/create-a-sprite-variant/) or
  [Create a Sprite-Sheet Variant](/quickstarts/create-a-sprite-sheet-variant/)
  (pick by the case's `asset_kind`) to add a brief variation against the same
  target.
- [Run a Test Case](/quickstarts/run-a-test-case/) to exercise it end to end.
