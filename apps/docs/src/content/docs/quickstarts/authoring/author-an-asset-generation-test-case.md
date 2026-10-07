---
title: Author an Asset-Generation Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case of
`asset_kind` `sprite` or `sprite-sheet`: a 2D image a model draws with the `draw`
or `draw-sheet` binary, one recorded operation at a time, to match a written
brief. Read
[Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/)
for the full procedure;
[Sprite cases](/testing/asset-generation/manifests/sprite-cases/) is the
authoritative schema.

The sibling asset kinds each have their own quickstart: 3D models and rigs, UI
art, PBR materials, particle effects, and audio.

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, canvas, tool, output
  variants/              # one standalone TOML file per variant
  prompt.hbs             # rendered into the harness instruction; not seeded
  changelog.md           # required per-version entry; not seeded
  description.md         # site blurb; not seeded
  specs/brief.md         # what to draw and how the tool behaves; seeded
```

The case is reviewed by a human against its brief, so it declares no
`[[reference]]` and carries no target image.

## Steps

1. Pick a catalog slug and the subject to draw. It should read clearly at the
   canvas size and need no in-game context.
2. Write `specs/brief.md`: the subject, its silhouette, the exact palette,
   framing, and how the tool behaves, including that `--help` lists the
   operations. Keep it self-contained; the model sees only the seeded files.
3. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, and `{{time_limit_hours}}`. Point the
   model at the binary's `--help`.
4. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`), the required
   `changelog`, `type = "asset-generation"`, `asset_kind` (`"sprite"`, the
   default, or `"sprite-sheet"`), the `variants` list, and the `[canvas]`,
   `[tool]`, and `[output]` tables.
5. A sprite-sheet case adds the `[sheet]` table: `[[sheet.frame]]` entries, each
   carrying just an `index`, and named `[[sheet.sequence]]` animations, each
   carrying a `slug`, an ordered `frames` list, and an `fps` rate.
6. Declare the single `overall` `[[domain]]` a human rates the drawing under.
   The drawing is judged as a whole against its brief on that one rating, so the
   case declares no `[[review_item]]` checklist, no `[build]`, and no
   `[[check]]`.

Worked examples: `spectra-fighter`, `spectra-flux`, `spectra-prism`, and
`spectra-shard` for single sprites; `lanternjaw`, `drifter`, `gloamfin`,
`flarefish`, `trench-walls`, and `flare-bloom` for sprite sheets. Read the one
matching the kind you are authoring.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors. `seed` writes the
seeded repository under `tmp/`, holding the brief, `draw.config.json`, an empty
`layers.json`, and a blank starting frame per declared frame.

## Next steps

- [Create a Single-Sprite Variant](/quickstarts/authoring/create-a-sprite-variant/)
  or
  [Create a Sprite-Sheet Variant](/quickstarts/authoring/create-a-sprite-sheet-variant/),
  picked by the case's `asset_kind`.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
