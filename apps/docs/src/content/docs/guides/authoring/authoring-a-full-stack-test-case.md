---
title: Authoring a Full-Stack Test Case
---

## Overview

A [full-stack](/testing/full-stack/overview/) test case is a playable game a
model builds from a self-contained spec, and whose assets the model must also
produce during the run using the asset-generation binaries on the run image's
`PATH`. Authoring one is the
[end-to-end procedure](/guides/authoring/authoring-an-end-to-end-test-case/) plus
an asset-production contract. This guide covers what full-stack adds; read the
end-to-end guide first for the shared work, and
[Full-Stack Tests](/testing/full-stack/overview/) for the authoritative schema.

The editorial rules for the seeded specs and the prompt apply unchanged; see
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/).

The worked example is the Hollowdeep case
(`test-cases/full-stack/medium/hollowdeep/v1.0.0/`), a sealed-colony survival sim
whose model draws every sprite, authors every particle overlay, and synthesizes
every sound it plays.

## Choosing the full-stack type

The choice between the three types is about where the art comes from.

- To measure software development alone, pre-provide the art and author an
  [end-to-end](/guides/authoring/authoring-an-end-to-end-test-case/) case. Fixed
  seeded assets keep runs comparable.
- To measure asset creation alone, author an
  [asset-generation](/guides/authoring/authoring-an-asset-generation-test-case/)
  case.
- To measure whether one model can carry a whole small product, covering art
  direction, effects, audio, and code, author a full-stack case.

## The run image

A full-stack run executes in one of two
[run images](/testing/full-stack/overview/#the-run-image), picked by the case's
`asset_dimension`. Both are the Rust and wasm base image plus asset-generation
binaries on `PATH`.

`asset_dimension = "2d"`, the default, carries the six 2D binaries.

| Binary        | Produces                                                          | Consumed as                                                         |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `draw`        | a single sprite → PNG                                             | a PNG the game draws                                                |
| `draw-sheet`  | a sprite sheet → per-frame PNGs                                   | frames the game animates                                            |
| `particle-2d` | a particle system → `system.json`                                 | played live via `@clockwyrks/particle-runtime`'s `./canvas` binding |
| `sfx-synth`   | a procedural sound effect → `.wav`                                | played via Web Audio                                                |
| `sfx-sample`  | a sampled effect over a declared sample pack → `.wav`             | played via Web Audio                                                |
| `music`       | sequenced music over a declared instrument bank → `.wav` + `.mid` | played via Web Audio                                                |

`asset_dimension = "3d"` carries those six and three more.

| Binary        | Produces                                                | Consumed as                                                        |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `voxel`       | a static voxel model → `mesh.glb`                       | decoded by `@clockwyrks/voxel-runtime`'s `parseGlb`                |
| `voxel-anim`  | a rigged, animated model → per-part `.glb` + `rig.json` | posed and drawn via the voxel runtime's `./three` binding          |
| `particle-3d` | a volumetric particle system → `system.json`            | played live via `@clockwyrks/particle-runtime`'s `./three` binding |

Each binary's `--help` is its contract, and the
[asset-generation binary pages](/testing/asset-generation/overview/) are the
authoritative reference for what each one does. Pick the dimension the concept's
art asks for and declare it in the manifest, since it fixes the tooling for
every variant of the version.

The produced files are build inputs rather than separately-scored artifacts. The
model produces them once, commits them, and the build consumes them exactly as
an end-to-end build consumes seeded art. They are judged as part of the running
program a reviewer plays.

## Procedure

Follow the
[end-to-end procedure](/guides/authoring/authoring-an-end-to-end-test-case/#procedure).
The steps below replace or add to it; everything not mentioned is unchanged.

### 1. Confirm it qualifies, and pin the difficulty

Every [end-to-end design requirement](/testing/end-to-end/overview/#design-requirements)
still holds. Two additions:

- The game's art must be producible with the binaries of the dimension the case
  declares: the six 2D tools, or those plus `voxel`, `voxel-anim`, and
  `particle-3d`. A concept whose art needs meshed or SDF geometry, `ui` screens,
  or `material` textures belongs to another type.
- The model builds the game and produces a full asset set, so a full-stack case
  is heavier than the same game as end-to-end. Set `difficulty` and
  `max_runtime_hours` accordingly; Hollowdeep is `medium` with eight hours.

### 2–5. Foundations, spec decomposition, prompt, reference implementations

Unchanged from end-to-end, with two notes.

- The asset-quality directive stays out of the prompt. The harness prepends the
  standing
  [quality directive](/testing/full-stack/overview/#the-standing-quality-directive)
  at render time, which tells the model to author real assets with the binaries
  the case's `asset_dimension` puts on `PATH` and keep the build
  self-contained. Cover only case-specific detail in `prompt.hbs`.
- A new case declares no reference views. The visual bar is stated in the
  specs, and the reviewer judges the produced build against them.

### 6. Write `specs/assets.md`, the asset-production contract

This seeded spec tells the model what to produce and to what bar. For every asset
the game needs, state:

- which binary produces it;
- where the produced file lands in the workspace, and how the build wires it in
  (drawn directly, animated frame by frame, played through the particle runtime,
  posed through the voxel runtime, played via Web Audio);
- the quality bar in real, testable terms, covering art direction, motion, the
  feel of the effects, and the character of the sound.

Where the game needs sound, name the packs the manifest declares and state that
they are already present in the container, browsable with `list-samples` and
`list-instruments`.

Follow the general
[asset-brief craft](/guides/authoring/authoring-an-asset-generation-test-case/):
set mood and tone, and leave the creative decisions to the model. Keep
`specs/assets.md` and the produced-asset review points in lockstep, so every
produced asset the reviewer checks traces to a line in this spec.

### 7. Write the manifest

Author `test-case.toml` per the
[end-to-end schema](/testing/end-to-end/manifests/) with the full-stack
[differences](/testing/full-stack/manifests/).

- `type = "full-stack"` identifies the type, and `asset_dimension` selects the
  run image: `"2d"` by default, or `"3d"` for the voxel and volumetric-particle
  tooling. Both are root keys, so they sit above the first table header.
- The `assets` list is omitted. A full-stack case produces its own art.
- The asset-generation tables are omitted. `asset_kind`, `[sheet]`, `[canvas]`,
  `[tool]`, `[output]`, `[voxel]`, `[model]`, `[ui]`, `[material]`, and
  `[particle]` are all rejected at resolution. Everything about the produced
  assets belongs in `specs/assets.md`.
- `[audio] packs` declares the audio packs the run may reach, as a list of
  `name@version` refs. It is required, and the run container carries exactly
  what it names, so declare the full published set unless the case's brief calls
  for a narrower palette. Order fixes the defaults; see
  [`[audio]`](/testing/full-stack/manifests/#audio).
- `[build]` is required and works exactly as end-to-end: explicit `install` and
  `build`, emitting a static site into `dist/`, `build/`, or `out/`. The build
  must bundle the committed asset files and run with the generation binaries
  absent, since validation and rebuild time have no access to them. A build that
  regenerates its own assets fails the load check.
- `packages` ships a Test Cabinet runtime library into the run, and is valid for
  an end-to-end, full-stack, or game-jam case. Its common use is
  `packages = ["@clockwyrks/particle-runtime"]` so the game can play a produced
  `system.json` through the runtime's `./canvas` binding; a 3D case that ships a
  produced voxel model adds `@clockwyrks/voxel-runtime`. The case's seeded
  workspace `package.json` must already depend on each declared package as
  `file:./.vendor/packages/<name>`, and resolution rejects a mismatch. Pair it with
  `init = "npm install …"` so the lockfile completes at seed time while
  `[build].install` stays `npm ci`.
- `[[domain]]` entries must cover the produced assets as first-class quality
  dimensions. Hollowdeep rates a `simulation` domain for the code and a
  `presentation` domain for the produced art, motion, effects, and audio; the
  overall rating is the worst across the set. See
  [Review](/testing/full-stack/evaluation/#review).
- `variants`, engines, the `[toolchain]` table, and the validators work
  exactly as end-to-end. `[[reference]]`, `[[proof]]`, and `[[check]]` are
  retained for shipped versions; a new case declares none.

### 8. Write the non-seeded docs

`description.md`, `changelog.md`, and `README.md`, unchanged from end-to-end.

## Validate your work

Validate by resolving and seeding, for every variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template errors and manifest problems, including a
forbidden asset-generation table and a malformed pack ref. `seed` writes the
seeded repository to disk so you can confirm the seeded set, `specs/assets.md`
included, is complete and self-contained and that no pre-provided `assets/`
leaked in. Resolve the declared packs against the registry with
`node scripts/ci/audio-packs-check.mjs`. Lint the specs and prose with
`npm run lint:specs`.

When the case is ready, exercise it with
[Run a Test Case](/quickstarts/development/run-a-test-case/); a full-stack run is
scheduled onto the image its `asset_dimension` selects. Re-ingest the case before
running if a backend already holds an earlier definition. See
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Specs and prompts](/guides/authoring/writing-case-specifications/) gives the
  editorial rules and the revision checklist for the seeded set.
- [Instrumentation](/testing/end-to-end/instrumentation/) covers the debug API,
  render-free core, and overlay a full-stack case must mandate.
- [Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/)
  gives the design rules for that API and the validators that drive it.
- [Full-Stack Tests](/testing/full-stack/evaluation/) covers how a finished run
  is validated, reviewed, and scored.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case.
