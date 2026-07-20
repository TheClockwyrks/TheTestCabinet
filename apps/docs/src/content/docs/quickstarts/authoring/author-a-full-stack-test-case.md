---
title: Author a Full-Stack Test Case
---

Scaffold a new [full-stack](/testing/full-stack/overview/) test case — a playable
game a model builds from a spec **and produces its own 2D assets for during the
run** (or a new version of an existing one). This is the short version;
[Authoring a Full-Stack Test Case](/guides/authoring/authoring-a-full-stack-test-case/)
covers the procedure and the asset contract in full,
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
is the editorial rulebook for the seeded specs and the prompt, and
[Full-Stack Tests](/testing/full-stack/overview/) is the authoritative type doc.

A full-stack case is an [end-to-end](/testing/end-to-end/overview/) case with one
addition: instead of pre-providing the game's art, the case asks the model to
**draw the sprites, author the effects, and synthesize the sound itself** with
the six asset-generation binaries on the [`test-cabinet-full-stack-2d` run
image](/testing/full-stack/overview/#the-full-stack-2d-run-image)'s `PATH`, then
build the game that ships them. Read
[Author an End-to-End Test Case](/quickstarts/authoring/author-an-end-to-end-test-case/)
first — everything there still holds; this quickstart covers only what full-stack
adds.

Building a game from **provided** art instead? That is a plain
[end-to-end](/quickstarts/authoring/author-an-end-to-end-test-case/) case.
Producing an asset with **no** game around it? That is an
[asset-generation](/quickstarts/authoring/author-an-asset-generation-test-case/)
case. Full-stack is the one type that does both in one run.

## Layout

Identical to an end-to-end case — a version lives at
`test-cases/full-stack/<difficulty>/<slug>/<version>/` and is **immutable** once
runs reference it. The only structural difference is that a full-stack case has
**no `assets/`** (the model produces them) and it carries a defining
**`specs/assets.md`** — the asset-production contract.

```text
test-cases/full-stack/<difficulty>/<slug>/<version>/
  test-case.toml     # manifest: type = "full-stack", specs, references, checks, domains
  variants/          # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs         # rendered into the harness instruction (NOT seeded)
  specs/             # the spec, decomposed by concern, INCLUDING assets.md — SEEDED
  reference/         # mockup source, rendered to screenshots — NOT seeded
  # NO assets/ — the model produces the game's assets during the run
```

## Steps

Follow the [end-to-end steps](/quickstarts/authoring/author-an-end-to-end-test-case/#steps)
for everything shared, with these differences:

1. Set **`type = "full-stack"`** in `test-case.toml`. That one key selects the
   full-stack-2d run image and puts `draw`, `draw-sheet`, `particle-2d`,
   `sfx-synth`, `sfx-sample`, and `music` on the model's `PATH` — no other
   manifest key is needed to get the tools.
2. **Declare no `assets`.** A full-stack case never pre-provides art; declaring
   an `assets` list defeats the point. The asset-generation-only tables
   (`asset_kind`, `[sheet]`, `[canvas]`, `[tool]`, `[output]`, `[voxel]`,
   `[ui]`, `[material]`, `[particle]`, `[audio]`) are **rejected at resolution**
   on a full-stack case.
3. Write **`specs/assets.md`** — the asset-production contract: every asset the
   game needs, which of the six binaries produces it, where the file lands in the
   workspace, and how the build wires it in. This is the defining spec of the
   type; seed it for every variant.
4. Word the **`[[domain]]`** and **`[[review_item]]`** entries to cover the
   **produced** art, motion, effects, and sound as first-class quality
   dimensions — because in a full-stack run the model made them. Hollowdeep splits
   its domains into `simulation` (the code) and `presentation` (the produced
   assets); mirror that split.
5. If the game plays a produced **particle** `system.json`, declare
   `packages = ["@test-cabinet/particle-runtime"]` and use `npm install` (not
   `npm ci`) at `init`, exactly as an end-to-end case that consumes a produced
   effect does.
6. Do **not** restate an asset-quality directive in `prompt.hbs`. The harness
   auto-prepends the standing
   [full-stack quality directive](/testing/full-stack/overview/#the-standing-quality-directive)
   at render time.

Keep the build **self-contained**: it must bundle the committed asset files and
**must not** shell out to `draw` or the other binaries — those are on `PATH` only
while the run is live, not when the build is re-validated or rebuilt. A build that
regenerates its assets fails wherever the tools are absent.

[Authoring a Full-Stack Test Case](/guides/authoring/authoring-a-full-stack-test-case/)
is the full procedure; read it before you start. The `hollowdeep` case
(`test-cases/full-stack/medium/hollowdeep/v1.0.0/`) is the worked example a new case
should resemble.

## Validate

```sh
tcab prompt  --test-case <slug> --version <version> --variant <variant>
tcab seed    --test-case <slug> --version <version> --variant <variant>
```

Render the prompt and inspect the seeded repository for every variant to confirm
the manifest resolves, the seeded set (including `specs/assets.md`) is
self-contained, and no forbidden asset-generation table slipped in.

A full-stack case must mandate the same
[instrumentation](/testing/end-to-end/instrumentation/) an end-to-end case does —
a debug API on a case-specific global, a deterministic core, and a debug overlay —
so a run can be validated automatically.

## Next steps

- [Instrumentation](/testing/end-to-end/instrumentation/) — the debug API,
  deterministic core, and overlay your case must mandate (identical to
  end-to-end).
- [Create an End-to-End Variant](/quickstarts/authoring/create-an-end-to-end-variant/) —
  variants work identically for a full-stack case (a full-stack case adds a mode
  the same way).
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
