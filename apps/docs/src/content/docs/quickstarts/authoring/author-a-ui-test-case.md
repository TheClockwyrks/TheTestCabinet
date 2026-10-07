---
title: Author a UI Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case of
`asset_kind = "ui"`: a high-resolution interface asset such as a HUD plate,
panel, button, frame, icon, insignia, title, or background, painted one recorded
operation at a time with the `paint` layered painter and the `ui` binary for
crisp shapes, text, and nine-slice. Read
[Authoring a UI Test Case](/guides/authoring/authoring-a-ui-test-case/) for the
full procedure;
[UI cases](/testing/asset-generation/manifests/ui-cases/) is the authoritative
schema.

For a tileable PBR material see
[Author a Material Test Case](/quickstarts/authoring/author-a-material-test-case/).

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, canvas, ui, tool, output
  variants/              # one standalone TOML file per variant
  prompt.hbs             # rendered into the harness instruction; not seeded
  changelog.md           # required per-version entry; not seeded
  description.md         # site blurb; not seeded
  specs/brief.md         # what to paint and how the tools behave; seeded
```

A run seeds the brief, `paint.config.json`, a single empty action log, and a
blank starting preview per element. Core emits the flattened per-element PNGs and
`ui.json`, so the manifest names neither. The case is reviewed by a human against
its brief, so it declares no `[[reference]]` and carries no target image.

## Steps

1. Pick a catalog slug and the asset to paint, then decide the version's shape: a
   single full-canvas image, which omits the `[ui]` table, or a kit of named
   elements, which declares it.
2. Write `specs/brief.md`: the interface's role and mood, the exact palette as
   named colors with hex values, each element's size, the nine-slice stretch
   region for any frame, panel, or button, and how the tools behave. Both
   binaries are on `PATH`, share one workspace and one operation log, and only
   marks made through them count. Keep the brief self-contained.
3. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, and `{{time_limit_hours}}`. Point the
   model at both binaries' `--help`.
4. Write `test-case.toml`: metadata, the required `changelog`,
   `type = "asset-generation"`, `asset_kind = "ui"`, and the `variants` list of
   paths to standalone files under `variants/`. It is a root key, so it precedes
   the first table header, and the first entry is the default variant.
5. Declare `[canvas]` with the base element size and a `background`, and `[tool]`
   with `binary = "paint"`. `[tool].preview` carries the `{element}` token for a
   kit and names a single file for one image. `[output].actions` names a single
   interleaved log and rejects the `{element}` token.
6. For a kit, declare `[ui]` with one `[[ui.element]]` per element, each carrying
   a unique `name`, a positive `width` and `height`, and an optional `nine_slice`
   that fits within those bounds.
7. Declare the single `overall` `[[domain]]` a human rates the kit under. The kit
   is judged as a whole against its brief on that one rating, so the case
   declares no `[[review_item]]` checklist, no `[[reference]]`, no `[build]`, and
   no `[[check]]`.

`thunderhead-hud`, a five-element fleet-command HUD kit, is the worked example.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors, including a missing
`{element}` token on a kit's `preview` and an `{element}` token on the action
log. `seed` writes the seeded repository under `tmp/`, where you confirm the
seeded set is self-contained.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the result
  against its brief.
