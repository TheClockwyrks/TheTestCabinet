---
title: Overview
---

A full-stack test case is an [end-to-end](/testing/end-to-end/overview/) case
with one addition: the model produces the program's own 2D assets during the
run. One model draws the sprites, authors the effects and the sound, and writes
the code that ships them.

Everything an end-to-end case requires still holds. A full-stack case builds a
self-contained static site through the same fixed build interface, is validated
automatically, is judged by a person who plays it, and reuses the same versioned
definitions, variants, specs, references, proofs, review items, scoring domains,
and instrumentation. Read the
[end-to-end overview](/testing/end-to-end/overview/) for that shared machinery.
This page covers what the full-stack type adds.

## The run image

A full-stack run executes in the `test-cabinet-full-stack-2d` image. The image
is selected by the test type, so a case declares nothing to get the tools. A
deployment pins it with `TCAB_CONTAINER_IMAGE_FULL_STACK_2D`.

The image is the base-wasm image plus six 2D asset-generation binaries on
`PATH`:

| Binary | Produces | Reference |
| --- | --- | --- |
| `draw` | a single sprite → PNG | [The sprite binaries](/testing/asset-generation/sprite-binaries/) |
| `draw-sheet` | a sprite sheet → per-frame PNGs | [The sprite binaries](/testing/asset-generation/sprite-binaries/) |
| `particle-2d` | a particle system → `system.json` | [The particle binaries](/testing/asset-generation/particle-binaries/) |
| `sfx-synth` | a procedural sound effect → `.wav` | [The audio binaries](/testing/asset-generation/audio-binaries/) |
| `sfx-sample` | a sampled sound effect → `.wav` | [The audio binaries](/testing/asset-generation/audio-binaries/) |
| `music` | sequenced music → `.wav` + `.mid` | [The audio binaries](/testing/asset-generation/audio-binaries/) |

Each binary is the same tool the corresponding
[asset-generation](/testing/asset-generation/overview/) case uses, invoked as a
CLI whose `--help` states its operations. A run seeds no operations schema. The
linked pages are the authoritative reference for each tool's operations, output,
and previews.

The image bakes the `combat-core` sample pack and every instrument bank. A config
that names no palette gets `combat-core` for `sfx-sample` and `gm-lite` for
`music`, and a config may name any other baked bank instead.

The image carries the 2D tooling only. Because it inherits base-wasm, a
full-stack build may author its simulation core in Rust and compile it to a
committed wasm build input, exactly as an end-to-end build may.

## Produced assets as build inputs

The model produces its asset files into the run workspace and its program
consumes them directly, the way an end-to-end build consumes seeded assets. The
produced files are build inputs. They are judged as part of the running program
a reviewer plays, so an asset's quality is a dimension of the experience rather
than a separately scored artifact.

Asset generation therefore happens once and the generated files are committed.
The binaries are on `PATH` only while the run is live. They are absent when the
build is re-run to [validate](/components/core/validation/) it and when the
published source is rebuilt, so a case's build must be self-contained: it
bundles the committed asset files. A build that shells out to `draw` or the
other binaries fails wherever those tools are absent, which is a load failure
even when the game itself is complete. The same holds for a Rust core: the build
bundles the committed `.wasm` rather than invoking `cargo` or `wasm-pack`.
Producing an asset some other way is equally acceptable; what matters is that
the committed files are what the build consumes.

How each kind is consumed mirrors how an end-to-end build consumes a provided
asset:

- Sprites and sheets (`draw`, `draw-sheet`) are plain PNG files the game draws
  directly, either as a static sprite or as a sheet's per-frame PNGs animated by
  the game.
- Particle systems (`particle-2d`) are a `system.json` definition a simulator
  plays live. The game plays it through the `canvas` entry point of
  [`@test-cabinet/particle-runtime`](/testing/asset-generation/particle-binaries/),
  the same runtime the review UI uses, so the case declares that package. See
  [Manifests](/testing/full-stack/manifests/).
- Audio (`sfx-synth`, `sfx-sample`, `music`) is a finished `.wav` the game plays
  through `<audio>` or the Web Audio API. `music` additionally emits a `.mid`
  score alongside the `.wav`.

The produced files ship inside the static build, so they travel with the run and
play back in the console exactly as the game plays them.

## The standing quality directive

Every full-stack case's prompt is prefixed at render time with a standing
quality directive (`FULL_STACK_PREAMBLE` in `crates/core/src/prompt.rs`). It
tells the model that this is a full-stack build, that the on-`PATH` binaries are
there to author real art, animation, effects, and sound, that the build must be
self-contained and bundle the committed files, and that the assets are held to
the same quality ceiling as the code.

The directive is prepended by The Test Cabinet at the one point every prompt
renders through. A case's `prompt.hbs` covers only what is specific to that
case, exactly as an end-to-end prompt does.
