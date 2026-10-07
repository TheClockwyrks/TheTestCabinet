---
title: Authoring a Particle Test Case
---

## Overview

A particle [asset-generation](/testing/asset-generation/overview/#particle-effects)
test case asks a model to author a visual effect to match a written brief: an
explosion, a muzzle flash, an engine plume, a splash, a victory burst. The model
authors a system of emitters, forces, and per-particle F-curves rather than
placing individual particles, and the review UI and a game simulate that system
live. The authored `system.json` is the asset. There is no target frame sequence
and no bake.

Read [Particle cases](/testing/asset-generation/manifests/particle-cases/) for
the authoritative manifest schema and
[The particle binaries](/testing/asset-generation/particle-binaries/) for the
emitter, force, and curve operations.

A case authors one effect in either 2D or 3D, chosen by `asset_kind`. This is a
version-level choice rather than a variant axis:

- `particle-2d` is a planar, screen-space effect with width and height only,
  drawn with the `particle-2d` binary and composited in a 2D raster path. The
  worked example is `spectra-burst`.
- `particle-3d` is a volumetric effect with width, height, and depth, drawn with
  the `particle-3d` binary and rendered as `wgpu` orbit billboards. This is what
  the 3D cases consume. The worked example is `thunderhead-flak`, used in the
  manifest below.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/` and is
immutable once a run references it. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, particle, tool, output, domain
  variants/              # one standalone TOML file per variant, listed in `variants`
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # required per-version changelog entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief (SEEDED)
```

A run receives the selected variant's specs, the particle binary whose `--help`
is the operations contract, and a seeded `particle-3d.config.json` or
`particle-2d.config.json` carrying the field dimensions, the duration and
playback fps, and the log, preview, and `system.json` paths. No operations
schema is seeded, and neither an operation nor `render` needs those flags.

## Procedure

### 1. Choose 2D or 3D and the subject

Pick `particle-2d` for a planar, screen-space effect and `particle-3d` for a
volumetric one that lives in a 3D scene, driven by where the effect is consumed.
Then pick a catalog slug for the lineage and the subject: a self-contained VFX
moment that reads on its own from its motion, color, and timing, needs no
surrounding game context, and is achievable within the tool's emitter, force,
and curve vocabulary. Pick a `version` (`vX.Y.Z`).

The effect is simulated live and varies slightly from one play to the next, so
choose a subject whose character is what matters: the read of an explosion, a
plume, a burst. A good particle subject reads the same across replays.

### 2. Write the brief

Write `specs/brief.md` as a single self-contained file describing:

- what the effect depicts: the VFX moment, its overall silhouette, and how it
  sits in the `[particle]` field;
- its lifecycle and timing over `duration_ms`: the initial burst or ignition,
  the middle of expansion, drift, and secondary sparks, and the end, either a
  decay to empty for a one-shot or the steady state a loop settles into;
- the emitters and forces conceptually: what spawns, roughly how fast and for
  how long, and which forces shape the motion, such as gravity, drag, a radial
  explosion push, a vortex, curl-noise turbulence, or wind. Write this as intent
  rather than exact flags, since the model reads the binary's `--help` for the
  operations;
- the color, opacity, and size curves: how each particle looks over its life,
  stated as the read you want;
- the exact palette, as named colors with hex values, stated as the only colors
  allowed;
- one-shot or loop, matching the manifest's `loop` flag;
- how the tool behaves: that the binary is the only way to shape the effect,
  that it authors a system rather than individual particles, that `render`
  simulates the system and emits the `system.json` the result is built from, and
  that the effect varies slightly from play to play and should read well across
  replays.

The brief must stand on its own with no link outside the seeded set, and every
visual detail written in real terms. A shared quality directive is prepended to
every asset-generation prompt at render time, so keep the brief factual.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read
the binary's `--help` for the operations, and stating the hard requirements:
shape the effect only through the tool, author a system of emitters, forces, and
per-particle curves rather than individual particles, run `render` to simulate
and emit `system.json` before finishing, and return when done. The template
renders in strict mode, so use only the documented variables:
`{{variant.slug}}`, `{{variant.name}}`, `{{variant.description}}`,
`{{time_limit_hours}}`, `{{workspace}}`, and `{{#each specs}}`.

### 4. Write the manifest

Author `test-case.toml` per
[Particle cases](/testing/asset-generation/manifests/particle-cases/). The
tables specific to this kind:

```toml
type = "asset-generation"    # required; omitting it defaults to end-to-end
asset_kind = "particle-3d"   # "particle-2d" | "particle-3d"

variants = ["variants/base.toml"]

# The field the effect plays in. Replaces [canvas]/[voxel]. A particle-2d case
# gives width/height only; particle-3d adds depth.
[particle]
width       = 48             # extent along x
height      = 48             # extent along y (up)
depth       = 48             # particle-3d only
duration_ms = 1500           # the effect's length in milliseconds
fps         = 60             # preview/playback frame rate
loop        = false          # one-shot (the default) or looping, as fire or smoke
background  = "transparent"  # preview clear color only

[tool]
binary  = "particle-3d"
preview = "effect.gif"       # where the binary writes the preview animation

[output]
actions = "actions.json"

[[spec]]
source = "specs/brief.md"

[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

Points to get right:

- `[particle]` is required for, and only for, a particle case. `depth` is
  required for `particle-3d` and rejected for `particle-2d`. There is no
  simulation seed.
- Core emits the authored `system.json`, the emitter, force, and curve
  definition the review UI and a game simulate live, to a path it provides. It
  is not manifest-declared.
- A particle case declares no `[model]`, no `[[reference]]`, no `[build]`, and
  no `[[check]]`.
- The single `overall` `[[domain]]` is the whole review. The simulated effect is
  judged as a whole against its brief, so the case declares no `[[review_item]]`
  on itself or on a variant. See
  [Judged on one overall rating](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating).
- A variant varies only the seeded brief through an additive `[[spec]]`.

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md` (the required per-version entry),
and `README.md` (human overview). These never reach a run.

## Validate your work

Resolve and seed the case. For every variant:

```sh
tcab prompt --test-case thunderhead-flak --version v1.0.0 --variant base
tcab seed   --test-case thunderhead-flak --version v1.0.0 --variant base
```

`prompt` renders the instruction, catching strict-mode template errors and
manifest problems. `seed` writes the seeded repository to disk so you can read
exactly what the model would receive and confirm it is self-contained. Lint the
specs with `npm run lint:specs`, then exercise the case end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case, playing the emitted system live in the review UI.
