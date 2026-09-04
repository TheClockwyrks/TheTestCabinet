---
title: Author a Full-Stack Test Case
---

## Scope

Scaffold a [full-stack](/testing/full-stack/overview/) test case: a playable game
a model builds from a seeded specification while producing the game's own assets
during the same run. Everything in
[Author an End-to-End Test Case](/quickstarts/authoring/author-an-end-to-end-test-case/)
holds; this page covers what full-stack adds. Read
[Authoring a Full-Stack Test Case](/guides/authoring/authoring-a-full-stack-test-case/)
for the full procedure and the asset contract.

## Layout

A version lives at `test-cases/full-stack/<difficulty>/<slug>/<version>/` and
follows the end-to-end layout, with `specs/assets.md` added and `assets/`
omitted.

```text
test-cases/full-stack/<difficulty>/<slug>/<version>/
  test-case.toml     # manifest: type = "full-stack", build, specs, domains
  variants/          # one standalone TOML file per variant
  prompt.hbs         # rendered into the harness instruction; not seeded
  changelog.md       # required per-version entry; not seeded
  description.md     # site blurb; not seeded
  specs/             # the spec, including assets.md; seeded
  reference/         # mockup source, rendered to screenshots; not seeded
  workspaces/        # starter project seeded at the run root (optional)
```

## Steps

Follow the
[end-to-end steps](/quickstarts/authoring/author-an-end-to-end-test-case/#steps)
for everything shared, with these differences.

1. Set `type = "full-stack"` in `test-case.toml`, plus
   `asset_dimension = "3d"` when the game's art is 3D. The two keys schedule the
   run onto the matching image: `test-cabinet-full-stack-2d` puts `draw`,
   `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, and `music` on the
   model's `PATH`, and `test-cabinet-full-stack-3d` adds `voxel`, `voxel-anim`,
   and `particle-3d`. The dimension defaults to `"2d"` and applies to every
   variant of the version.
2. Leave the case's art to the model. A full-stack case declares no `assets`
   list, and resolution rejects the asset-generation tables (`asset_kind`,
   `[sheet]`, `[canvas]`, `[tool]`, `[output]`, `[voxel]`, `[model]`, `[ui]`,
   `[material]`, `[particle]`).
3. Declare the audio palette in `[audio] packs`, a list of `name@version` refs.
   It is required, and the run container carries exactly what it names, so
   declare the full published set unless the brief calls for a narrower one. The
   first entry of each kind is what a tool config naming no pack plays. See
   [`[audio]`](/testing/full-stack/manifests/#audio).
4. Write `specs/assets.md`, the asset-production contract: every asset the game
   needs, which binary produces it, where the file lands in the workspace, and
   how the build wires it in. Seed it for every variant.
5. Word the `[[domain]]` and `[[review_item]]` entries so the produced art,
   motion, effects, and sound are first-class quality dimensions. `hollowdeep`
   splits its domains into `simulation` for the code and `presentation` for the
   produced assets; mirror that split.
6. When the game plays a produced particle `system.json`, declare
   `packages = ["@test-cabinet/particle-runtime"]`, and add
   `"@test-cabinet/voxel-runtime"` when it draws a produced voxel model. Set the
   case's `init` command to `npm install` so the injected `file:` dependencies
   resolve.
7. Keep the asset-quality wording out of `prompt.hbs`. The harness prepends the
   standing
   [full-stack quality directive](/testing/full-stack/overview/#the-standing-quality-directive)
   at render time.
8. Keep the build self-contained. It bundles the committed asset files that the
   run produced, because the generation binaries are on `PATH` only while the run
   is live. A build that shells out to `draw` or its siblings fails wherever
   those binaries are absent.

`test-cases/full-stack/medium/hollowdeep/v1.0.0/` is the worked example a new
case should resemble.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

Confirm the manifest resolves, that the seeded set including `specs/assets.md`
is self-contained, and that no asset-generation table slipped in.

## Next steps

- [Create an End-to-End Variant](/quickstarts/authoring/create-an-end-to-end-variant/).
  Variants work identically for a full-stack case.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
