---
title: Author a UI Test Case
---

Scaffold a new [asset-generation](/testing/asset-generation/overview/) test case
of `asset_kind = "ui"` — a high-resolution interface asset (HUD plate, panel,
button, frame, icon, insignia, title, or background) the model **paints** to
match a written brief, one recorded operation at a time, using the **`paint`**
(primary layered painter) and **`ui`** (crisp shapes, text, nine-slice) binaries.
This is the short version;
[Authoring a UI Test Case](/guides/authoring/authoring-a-ui-test-case/) covers it
in full, and [Manifests](/testing/asset-generation/manifests/#ui-cases) is the
authoritative schema.

Painting a tileable PBR material instead? See
[Author a Material Test Case](/quickstarts/authoring/author-a-material-test-case/).

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, canvas, ui, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  description.md         # site blurb (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # what to paint + how the two tools behave — SEEDED
```

There is **no target image** and **no `reference/` directory** — a UI case
declares no references and is reviewed by a human against its brief. Core emits
the flattened per-element PNGs and `ui.json`; those are not manifest-declared.

## Steps

1. Pick a catalog **slug** (e.g. `thunderhead-hud`) and the **asset** to paint,
   then decide the version's **shape**: a **single full-canvas image** (omit the
   `[ui]` table) or a **kit** of named elements (declare `[ui]`).
2. Write `specs/brief.md`: the interface's role and mood, the **exact palette**
   (named colors with hex), each element's **size** and — for a frame/panel/button
   — its **nine-slice** stretch region, and how the tools behave (both on `PATH`,
   sharing one workspace and op log; only marks made through `paint`/`ui` count).
   Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications).
3. Write `prompt.hbs` using only the documented template variables
   (`{{variant.*}}`, `{{#each specs}}`, `{{workspace}}`) — it renders in strict
   mode — pointing the model at **both** binaries' `--help`.
4. Write `test-case.toml`: metadata, `type = "asset-generation"`,
   `asset_kind = "ui"`, a `variants` list of paths to standalone files under
   `variants/` (a root key, so it must precede the first table header; first =
   default), and these tables: `[canvas]` (base size + `background`); `[tool]`
   (`binary = "paint"`, a `preview` with the `{element}` token for a kit or a
   single file for one image); `[output].actions` (a **single** interleaved op
   log, **not** an `{element}` template); optional `[ui]` with `[[ui.element]]`
   entries (unique `name`, `width`, `height`, optional `nine_slice`); and the
   `[[domain]]`/`[[review_item]]`s a human reviews under (each review item carries
   only a `domain` — **no `reference`**).
5. The case declares **no `[[reference]]`** (no target image), **no `[build]`**,
   and **no `[[check]]`** (no cheat-divergence check — the emitted PNGs are
   authoritative). Resolution rejects all three.
6. Write the non-seeded `description.md` and `README.md`.

[Authoring a UI Test Case](/guides/authoring/authoring-a-ui-test-case/) is the
full procedure to follow; read it before you start. The worked example is
`thunderhead-hud`, a three-element HUD kit — read it as the model to follow.

## Validate

For **every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

Render the prompt (catching strict-mode template and manifest errors) and inspect
the seeded repository to confirm the seeded set (the brief, plus the seeded
`paint.config.json` and blank per-element workspace) is self-contained.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the result
  against its brief.
