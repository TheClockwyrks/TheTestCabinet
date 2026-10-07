---
title: Author a Material Test Case
---

## Scope

Scaffold an [asset-generation](/testing/asset-generation/overview/) test case of
`asset_kind = "material"`: a tileable PBR material, authored as a set of seamless
maps with the `texture` painter and the companion `pbr` binary, which bakes
normal and AO, sets uniform scalar maps, assembles `material.json`, and renders
the lit preview. Read
[Authoring a Material Test Case](/guides/authoring/authoring-a-material-test-case/)
for the full procedure;
[Material cases](/testing/asset-generation/manifests/material-cases/) is the
authoritative schema.

For a high-resolution 2D interface image see
[Author a UI Test Case](/quickstarts/authoring/author-a-ui-test-case/).

## Layout

A version lives at
`test-cases/asset-generation/<difficulty>/<slug>/<version>/`. A version with runs
recorded against it is frozen; revise a case by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, material, tool, output
  variants/              # one standalone TOML file per variant
  prompt.hbs             # rendered into the harness instruction; not seeded
  changelog.md           # required per-version entry; not seeded
  description.md         # site blurb; not seeded
  specs/brief.md         # the surface, the maps, and tool behavior; seeded
```

A run seeds the brief, `material.config.json` carrying the map size, declared
channels, tiling, and log paths, a single empty action log, and a blank starting
preview per declared map. Core emits the per-map PNGs and `material.json`, so the
manifest names neither. The case is reviewed by a human against its brief, so it
declares no `[[reference]]` and carries no target image.

## Steps

1. Pick a catalog slug and a tileable surface, stated concretely as "weathered
   volcanic basalt" rather than "a rock". It must read as a repeating surface at
   a declared tile scale and exercise every map it emits.
2. Write `specs/brief.md`: the surface and its mesoscale structure, that it must
   tile seamlessly, the tiling-scale intent in real terms, the exact palette as
   hex values, and which maps to emit and what each encodes. Cover how `texture`
   and `pbr` behave and the height-to-normal bake workflow, where relief is
   painted into the grayscale `height` authoring aid and `normal` and `ao` are
   baked from it. Each binary's `--help` is the operation contract. Keep the
   brief self-contained.
3. Write `prompt.hbs`. It renders in strict mode against `{{variant.*}}`,
   `{{#each specs}}`, `{{workspace}}`, and `{{time_limit_hours}}`. Point the
   model at `texture --help` and `pbr --help`.
4. Write `test-case.toml`: metadata, the required `changelog`,
   `type = "asset-generation"`, `asset_kind = "material"`, and the `variants`
   list. It is a root key, so it precedes the first table header, and the first
   entry is the default variant. Omitting `type` defaults the case to end-to-end,
   which rejects every table below.
5. Declare `[material]` with a `size` that is a power of two, `tile = true`, a
   `background` for the preview, and `maps`. The list must include `base-color`;
   the rest is any subset of `normal`, `roughness`, `metallic`, `ao`, and
   `emissive`. The `height` and `curvature` channels are authoring aids that the
   run does not emit, so they stay out of `maps`.
6. Declare `[tool]` with `binary = "texture"`, with `pbr` on `PATH` in the same
   image, and `preview = "maps/{map}.png"`. Declare `[output]` with
   `actions = "actions.json"`, a single interleaved log where each operation
   carries its own `--map`; the `{map}` token is rejected there.
7. Declare the single `overall` `[[domain]]`, which is reporter-side and never
   seeded. The material is judged as a whole against its brief on that one
   rating, so the case declares no `[[review_item]]` checklist, no `[[reference]]`,
   no `[build]`, and no `[[check]]`.

`caldera-basalt` is the worked example.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case caldera-basalt --version v1.0.0 --variant base
tcab seed   --test-case caldera-basalt --version v1.0.0 --variant base
```

`prompt` catches strict-mode template errors and manifest problems, including a
missing `type`, a `[material]` without `base-color`, and a `size` that is not a
power of two. `seed` writes the seeded repository under `tmp/`, where you confirm
it is self-contained. Re-ingesting an already-ingested case must be forced.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end, then read the emitted `maps/`, `material.json`, and the `pbr` preview.
- [Review a Run](/quickstarts/development/review-a-run/) to judge the material per
  map, as a 2x2 tiling, and on the lit preview surface.
