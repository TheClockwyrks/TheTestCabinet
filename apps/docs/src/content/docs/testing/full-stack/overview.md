---
title: Overview
---

A **full-stack** test case is an [end-to-end](/testing/end-to-end/overview/)
case — a single playable program a model builds from scratch — with one
addition: the model must **also produce the program's own 2D assets during the
run**, rather than being handed them. It is the same long-horizon,
fully-autonomous software task as an end-to-end case, scored the same way, but it
folds the [asset-generation](/testing/asset-generation/overview/) capability into
the build: one model both draws the sprites, authors the effects and sound, and
writes the code that ships them.

Everything an end-to-end case requires still holds — a full-stack case builds a
self-contained static site through the [fixed build
interface](/testing/end-to-end/overview/#design-requirements), is judged by a
human who plays it, and reuses the same versioned definitions, variants, specs,
references, proofs, review items, and scoring domains. This page covers only what
the full-stack type **adds**; read the [end-to-end
overview](/testing/end-to-end/overview/) first for the shared machinery, see
[Manifests](/testing/full-stack/manifests/) for the `test-case.toml` differences,
and [Evaluation](/testing/full-stack/evaluation/) for how a finished run is
scored.

## Why it exists

An end-to-end case that needs real art
[pre-provides](/testing/end-to-end/overview/#assets) it: The Test Cabinet's goal
there is to evaluate software development, so seeding fixed assets keeps runs
comparable and keeps the test about code. A separate
[asset-generation](/testing/asset-generation/overview/) case, conversely,
evaluates only asset creation and produces no program. Between them sits a
familiar **two-run pattern**: one asset-generation run produces an asset, and a
later end-to-end run merely **consumes** it.

A full-stack case collapses that seam. Instead of one model drawing the art and a
different model (in a different run) building the game around it, **one model does
both in one run** — it produces the sprites, sheets, particle effects, and sound
its program needs, then builds the program that ships them. This is a higher-
fidelity test: it measures whether a single model can carry a whole small product
— art direction, effects, audio, and code — to a coherent whole, the way a real
solo developer does, rather than integrating assets someone else made to spec.

## The full-stack-2d run image

An end-to-end run executes in the bare base container. A full-stack run instead
executes in a dedicated **`test-cabinet-full-stack-2d`** run image: the same base
plus the 2D asset-generation binaries baked onto `PATH`. Selecting the image is
automatic — the full-stack test type picks it in place of the base image — so a
case declares nothing to get the tools; they are simply present at run time.

Six binaries are on `PATH`, each the same tool the corresponding
[asset-generation](/testing/asset-generation/overview/) case uses, invoked as a
CLI whose `--help` is the contract (the model runs `<binary> --help` to learn its
operations — a run seeds no operations schema):

| Binary            | Produces                                                                   | Reference                                                             |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **`draw`**        | a single sprite → PNG                                                      | [The sprite binaries](/testing/asset-generation/sprite-binaries/)     |
| **`draw-sheet`**  | a sprite sheet → per-frame PNGs                                            | [The sprite binaries](/testing/asset-generation/sprite-binaries/)     |
| **`particle-2d`** | a particle system → `system.json`                                          | [The particle binaries](/testing/asset-generation/particle-binaries/) |
| **`sfx-synth`**   | a procedural sound effect → `.wav`                                         | [The audio binaries](/testing/asset-generation/audio-binaries/)       |
| **`sfx-sample`**  | a sampled sound effect over the baked `combat-core` pack → `.wav`          | [The audio binaries](/testing/asset-generation/audio-binaries/)       |
| **`music`**       | sequenced music over the baked `gm-lite` instrument bank → `.wav` + `.mid` | [The audio binaries](/testing/asset-generation/audio-binaries/)       |

The linked asset-generation binary pages are the **authoritative reference** for
each tool's operations, output, and previews; this type does not restate them.
The image is 2D only — there are no voxel, mesh, skinned, `ui`, or `material`
tools — because a full-stack program is a browser game built from sprite art,
2D particle effects, and audio. The `sfx-sample` and `music` binaries carry the
same baked [sample pack and instrument
bank](/testing/asset-generation/audio-binaries/#the-sample-library) their asset-
generation counterparts do (`combat-core` and `gm-lite`).

## Produced assets are build inputs

The crucial difference from the two-run pattern is **where the produced assets
go**. In an asset-generation run, the asset is the scored output and the run
regenerates it from a recorded action log to defeat cheating. In a full-stack run
there is **no separate scored asset and no action-log regeneration**: the model
produces the files into the run workspace and its program **consumes them
directly**, exactly as it would consume [seeded
assets](/testing/end-to-end/overview/#assets). The produced files are **build
inputs**, and they are judged only as part of the running program a reviewer
plays — the asset's quality is a dimension of the experience, not a
independently-scored artifact.

Because they are build *inputs*, asset generation happens **once** and the
generated files are committed. The asset-generation binaries are on `PATH` only
while the run is live — they are **not** present when the build is re-run to
[validate](/components/core/validation/) it, nor when the published source is
rebuilt. A case's build must therefore be **self-contained**: it bundles the
committed asset files and must not invoke `draw` or the other binaries. A build
that shells out to them (regenerating assets it already has) fails wherever those
tools are absent — a catastrophic load failure, even though the game itself is
complete. Producing the assets some other way is equally fine; what matters is
that the committed files are what the build consumes.

How each kind is consumed mirrors how an end-to-end build consumes a provided or
produced asset:

- **Sprites and sheets** (`draw`, `draw-sheet`) are plain **PNG** files the game
  draws directly — a static sprite, or a sheet's per-frame PNGs animated by the
  game.
- **Particle systems** (`particle-2d`) are a **`system.json`** that is not
  self-describing pixels but a definition a simulator **plays live**. The game
  plays it through the [`@test-cabinet/particle-runtime`
  package](/testing/asset-generation/particle-binaries/)'s **`./canvas`** 2D
  binding — the same runtime the review UI uses — so the case declares that
  package (see [Manifests](/testing/full-stack/manifests/)) exactly as an
  end-to-end case that [consumes a produced particle
  effect](/testing/end-to-end/overview/#packages) does.
- **Audio** (`sfx-synth`, `sfx-sample`, `music`) is a finished **`.wav`** the
  game plays directly through `<audio>` or the Web Audio API; `music`
  additionally emits a **`.mid`** score alongside the `.wav`.

Because the produced files ship inside the static build, they travel with the
run and play back in the console exactly as the game plays them — there is no
extra viewer for a full-stack asset the way there is for a standalone asset-
generation output.

## The standing quality directive

Every full-stack case's prompt is automatically prefixed at render time with a
standing **quality directive** — the full-stack analogue of the [asset-generation
quality preamble](/testing/asset-generation/overview/). It tells the model that
this is a full-stack build, that it must use the on-`PATH` binaries to author
**real** assets rather than placeholder rectangles or silence, and that it should
hold the produced art, motion, effects, and sound to the same bar as the code.
It is prepended by The Test Cabinet (`FULL_STACK_PREAMBLE` in
`crates/core/src/prompt.rs`), so an author does **not** need to restate any of it
in the case's `prompt.hbs`; the prompt template should cover only what is
specific to the case, exactly as an end-to-end prompt does.
