---
title: Author an Asset-Generation Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case —
a sprite the model draws with the `draw` tool (or a sprite sheet with `draw-sheet`),
one recorded operation at a time (or a new version of an existing one). This is the
short version;
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/) is the
authoritative schema.

Building a playable game instead? See
[Author an End-to-End Test Case](/quickstarts/authoring/author-an-end-to-end-test-case/) —
that is a different test type with a `[build]` and reference mockups.

## Layout

A version lives at `test-cases/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, canvas, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  specs/brief.md         # what to draw + how the tool behaves — SEEDED
```

There is **no target image** and **no `reference/` directory** — an
asset-generation case declares no references and is reviewed by a human against
its brief.

## Steps

1. Pick a catalog **slug** (e.g. `gloamfin`) and the **subject** to draw. It
   should read clearly at the canvas size and need no in-game context.
2. Write `specs/brief.md`: the subject, silhouette, **exact palette**, framing,
   and how the tool behaves — including that its `--help` lists the operations.
   Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications) —
   the model sees only the seeded files. There is **no operations schema**.
3. Write `prompt.hbs` using only the documented template variables
   (`{{variant.*}}`, `{{#each specs}}`) — it renders in strict mode — and point the
   model at the binary's `--help`.
4. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`),
   `type = "asset-generation"`, `asset_kind` (`"sprite"` — the default — or
   `"sprite-sheet"`), a `variants` list of paths to standalone variant files under
   `variants/` (a root key, so it must precede the first table header; first =
   default), the `[canvas]`/`[tool]`/`[output]` tables, and the
   `[[domain]]`/`[[review_item]]`s a human reviews the drawing under (each review
   item carries only a `domain` — no `reference`). The
   case declares **no `[[reference]]`**: it has no target image, and resolution
   rejects any reference (common or per-variant). A sprite-sheet case also declares
   a `[sheet]` table (the `[[sheet.frame]]` entries, each just an `index`, and the
   named `[[sheet.sequence]]` animations). There is **no `[build]`** and **no
   `[[check]]`**.

[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/)
is the full procedure to follow; read it before you start. The single-sprite
worked examples are the `spectra-*` cases; the sprite-sheet worked examples are
`lanternjaw`, `gloamfin`, `flarefish`, `trench-walls`, `sonar-pulse`, and
`flare-bloom` — read the one matching the kind you are authoring.

## Validate

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

Render the prompt and inspect the seeded repository to confirm the manifest
resolves and the seeded set (brief + the seeded `draw.config.json` and blank
starting frame(s)) is self-contained.

## Next steps

- [Create a Single-Sprite Variant](/quickstarts/authoring/create-a-sprite-variant/) or
  [Create a Sprite-Sheet Variant](/quickstarts/authoring/create-a-sprite-sheet-variant/)
  (pick by the case's `asset_kind`) to add a brief variation.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
