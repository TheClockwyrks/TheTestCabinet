---
title: Particle binaries
description: The emitter/force/curve authoring interface, the live particle simulator, and the system.json output contract for the 2D and 3D particle-effect binaries (particle-2d / particle-3d).
---

A particle asset-generation run authors the VFX a game leans on: explosions,
muzzle flashes, impacts, engine exhaust, splashes, victory bursts, fire and
smoke. A single particle binary on the run's `PATH` is the only channel for
shaping the effect.

A model authors a system of emitters, forces, and per-particle curves rather
than placing individual particles, and a live simulation plays that system the
way a real particle editor plays one. The authored system definition is the
asset, and whatever plays it simulates it live: the binary's preview, the review
UI, or a consuming game. A stochastic simulation varies slightly from one play to
the next, which is right for VFX. A reviewer judges the character of the effect
rather than a frozen frame sequence.

There are two binaries, one per `asset_kind`:

- `particle-2d` authors a planar particle system for UI, 2D-game, and
  screen-space VFX.
- `particle-3d` authors a volumetric particle system, the kind the
  [3D games](/testing/asset-generation/mesh-binaries/) consume.

They are built from `crates/particle-2d` and `crates/particle-3d` over the shared
`crates/particle-core` library, which owns the system model, the simulator, and
the [F-curve](/testing/asset-generation/voxel-binaries/#f-curves) reuse from
`model-core`. Each is baked into its own run-container image, so a run carries
only the tool it uses.

The two binaries share the whole operation vocabulary and the simulator. They
differ in dimensionality (`particle-2d` is planar and rejects `--z`, `--size-z`,
and `--dir-z`), in the preview renderer (a 2D raster path against `wgpu` 3D
billboards), and in the runtime binding (a 2D canvas binding against the `three`
binding). This page documents the shared vocabulary and calls out the 2D and 3D
differences inline.

A particle case authors one effect, so a game needing many effects uses many
cases or variants. A particle effect carries no game-facing rig interface and is
judged subjectively against its brief.

## Operations

The vocabulary is the binary's own `--help`, and the brief tells the model to
read it:

```
particle-3d --help                 # every operation
particle-3d add-emitter --help     # one operation's exact flags
```

Every operation is a subcommand with flags. For example:

```
particle-3d add-emitter --name blast --shape sphere --x 0 --y 1 --z 0 --radius 0.2 \
                        --burst 400 --at 0 --lifetime 700 --speed 9 --dir-y 1 \
                        --cone-angle 180 --seed 7
particle-3d set-forces --emitter blast --gravity -6 --drag 1.4 --radial 12
particle-3d set-particle --emitter blast --size-curve ease-out \
                        --color-gradient "#ffffff@0,#ffb23a@0.3,#c02010@0.7,#333333@1" \
                        --opacity-curve ease-in
particle-3d add-subemitter --parent blast --on death --emitter embers
```

The operations:

- `add-emitter` declares an emission source. Its `--shape` is one of `point`,
  `disc`, `sphere`, `cone`, `box`, or `edge`, positioned at `--x --y` (3D adds
  `--z`), sized by `--radius` for the round shapes or `--size-x --size-y`
  (3D adds `--size-z`) for `box` and `edge`. It emits either continuously
  (`--rate <particles/s>`) or as a timed burst (`--burst <count> --at <ms>`), one
  or the other. One-shot effects use bursts and continuous effects use a rate.
  Each particle gets a `--lifetime <ms>` and a `--speed <v>`, each with an
  optional `--lifetime-spread` / `--speed-spread`, and a launch direction
  `--dir-x --dir-y` (3D adds `--dir-z`) with an optional `--cone-angle <deg>`
  spread. An optional `--seed <n>` pins the emitter's random draws for a
  repeatable look.
- `set-forces` declares the forces integrated into the motion each step, global
  or scoped to one `--emitter`: `--gravity <v>` with an optional
  `--gravity-dir x,y[,z]`, `--drag <k>`, `--radial <v>` for an explosion push out
  from the center, `--vortex <v>`, `--turbulence <amplitude,scale>` for curl
  noise, and `--wind <x,y[,z]>`.
- `set-particle` declares the per-particle appearance over a particle's
  normalized life, scoped to an `--emitter`. `--size-curve` and `--opacity-curve`
  choose an [F-curve](/testing/asset-generation/voxel-binaries/#f-curves)
  interpolation (`constant`, `linear`, `bezier`, `ease-in`, `ease-out`,
  `ease-in-out`), with `--size-from` / `--size-to` and `--opacity-from` /
  `--opacity-to` setting the endpoints. `--color-gradient "#rrggbb@t,…"` keys
  opaque color stops over life, so fire runs white to orange to red to smoke.
  `--rotation <deg/s>` and `--stretch <k>` shape spin and velocity-stretch, and
  `--sprite <ref>` textures the particles with a produced sprite or atlas.
- `add-subemitter --parent <emitter> --on <death|step> --emitter <child>` spawns
  a secondary system from a parent's particles, either when a particle dies (a
  shell that bursts into embers) or along its step path (a spark that trails
  smoke). The child is itself a declared emitter.
- `set-timeline --loop <true|false>` chooses a one-shot effect that decays to
  empty or a looping one that settles into a steady state. The effect's duration
  and playback fps come from the case's `[particle]` table.
- `render` runs the on-request simulate-and-render step.
- `init` writes an empty log. A run starts pre-seeded.

The coordinate convention matches the voxel and mesh tools: `x` across, `y` up,
`z` in depth, forward `+z`. `particle-2d` omits the `z` component everywhere, so
positions, directions, and forces are planar.

## Live simulation

A particle effect is a live simulation of the authored system, the same model a
real particle editor uses. The authored `system.json` is the whole asset, and
whatever plays it simulates it in real time from the emitters, forces, and curves
it declares. A stochastic simulation varies from play to play, which is correct
for an explosion or a plume.

This keeps the
[actions-are-the-output](/testing/asset-generation/evaluation/#regeneration)
property clean: the authored system is the recorded operations resolved into
their emitters and forces, so the only output is the system the model built
through the binary, and every consumer simulates it.

## The live-particle budget

Every consumer simulates the system live, every frame, so the number of particles
alive at once is a cost the reviewer's browser and the consuming game pay
continuously. The authoring flags hide that cost. Nothing in
`--rate 20000 --lifetime 1600` announces thirty-two thousand live particles, and
the binary's own preview draws at most 8,000 billboards a frame however many the
system holds, so an effect can look right in the run and stutter in the review
UI.

The binaries therefore enforce a hard ceiling of 10,000 live particles for the
whole system, at authoring time. The ceiling is set by what a reviewer's browser
can simulate smoothly: measured on the pure simulator, roughly 12,000 live
particles cost about 2.7 ms a frame and 24,000 cost about 7 ms, so 10,000 leaves
an ordinary machine most of a 60 fps frame for the rest of the page.

Every operation is projected forward to the peak live count the system would
settle at. An operation that pushes the projection past the ceiling is rejected,
nothing is recorded, and the tool reports the projection, the emitters spending
it, and the flags to turn down. The check compares the projection before and
after, so an operation that leaves an already-over-budget log no worse, such as
turning a rate down, still records.

```
particle-3d: this system would hold about 35200 particles alive at once, over the
10000-particle budget an effect has to fit in (every consumer simulates the system
live, every frame). ...

What the system spends its particles on:
  flood                ~32000 live
  fall                 ~3200 live
```

The projection mirrors the simulator's own rules as an upper bound:

- A rate emitter holds roughly `rate x lifetime` particles alive
  (`--rate 2000 --lifetime 1500` is about 3,000 live), counting a
  `--lifetime-spread` at its maximum.
- A burst holds its `--burst` count, re-fired every cycle on a looping timeline,
  so a lifetime longer than the loop window overlaps into itself.
- A sub-emitter child is projected from the traffic its parent hands it, one
  child burst per parent death or a trail along every live parent particle,
  generation by generation to the depth the simulator stops triggering at. A
  chain that multiplies is caught where it multiplies.

This is a ceiling on count. A fuller-looking effect comes from particle size,
opacity, and color, which cost nothing per frame, and 10,000 particles is already
denser than any preview a model can see. The simulator and the
[browser runtime](/components/particle-runtime/overview/) enforce the same
ceiling as a backstop, so a system that reaches it another way stops spawning
rather than growing without bound.

## Recording and on-request rendering

Each authoring operation appends itself to the run's operation log and nothing
more. Simulating an effect over its whole duration and rendering it costs far
more than recording an intent, so rendering is a separate, on-request step. The
orchestrator seeds a `particle-3d.config.json` (or `particle-2d.config.json`)
next to the workspace giving the `[particle]` field dimensions, the duration,
the playback fps, the loop default, and the log, preview, and `system.json`
paths, so neither an operation nor `render` needs those flags.

`render` simulates the authored system over the effect's duration, emits
`system.json`, and renders the preview frames packed into a GIF.
`render --frame <n>` captures a single frame to a still PNG instead, and `--out`
overrides the destination. A model runs `render` to see its progress and, before
the run finishes, to emit the `system.json` the run's result is built from. A run
that never renders leaves an empty system, which the validator records as empty.

```
particle-3d init                 # write an empty log; renders nothing
particle-3d render               # simulate; render preview frames + GIF; emit system.json
particle-3d render --frame 12    # capture a single preview frame to a still
```

## The preview

The preview `render` produces is the played effect, simulated from a fixed
preview seed so a model re-running `render` sees a stable capture of its system.

For `particle-3d` the preview is a real 3D render: the binary billboards each
live particle toward the camera and rasterizes it with `wgpu` targeting Mesa
lavapipe, software Vulkan running headless on the CPU, from the same isometric
orbit view the other voxel-family binaries use. The field's eight corners are
included as zero-area triangles so the camera frames the whole field volume
consistently across frames rather than jittering with the particle cloud. For
`particle-2d` the frames come from the 2D raster path, compositing the particles
in the planar `[particle]` field.

Either way the per-frame images are packed into a GIF, looping for a steady-state
effect and one-shot for a decaying one. That GIF and its frames are what the
model reads to judge its effect and what the result page shows as a still. The
interactive view is the frontend's live simulation of the emitted `system.json`.

## Live preview

When a run is watched, driven by a [driver](/components/driver/overview/) or the
[Tauri app](/components/tauri/overview/) rather than a plain `tcab run`, the
model's authoring streams to the viewer in real time. The orchestrator adds a
`live` block to the seeded config carrying a `host.docker.internal` endpoint and
an opaque per-run token. When the model runs `render`, the binary connects back
to the run host and streams a one-line JSON header
(`{ token, frame, operation, operationCount, length, systemLength }`) followed by
a representative preview frame's raw bytes and then the current `system.json`
payload. That payload lets the viewer simulate the effect live as it is authored,
looping or replaying it exactly as the finished-run view does; a frame-only
viewer ignores it.

Streaming is best-effort: it is absent for an unwatched run, it never fails an
operation, and it is never recorded. The recorded operation log and the emitted
`system.json` remain the run's authoritative output.

## The output contract

`render` emits one artifact, `system.json`, the authored particle-system
definition: its dimensionality, field, duration, fps, loop flag, emitters,
forces, per-particle curves, and sub-emitters. It is compact metadata, the
[`rig.json`](/testing/asset-generation/voxel-binaries/#rig-subcommands) analogue
for an effect that is simulated rather than posed. Every consumer, the review UI
and an embedding game alike, plays the effect by running the simulation live from
this definition.

The preview GIF a reviewer plays and the live-simulated effect are what is
scored, judged as the character of the effect. The
[validator](/testing/asset-generation/evaluation/#particle-validation) parses
`system.json`, confirms it is well-formed, and checks that it is non-empty, that
the system actually emits particles rather than declaring emitters that produce
nothing.

## Runtime consumption

The shared TypeScript package
[`@test-cabinet/particle-runtime`](/components/particle-runtime/overview/) turns a
particle run's `system.json` into a playable effect by simulating it live:

- The pure core runs the simulation from `system.json`, stepping the emitters and
  forces and evaluating the per-particle curves each frame.
- A `three` binding renders the 3D effect as billboards from the simulated state.
- A 2D canvas binding composites the same simulated state in a 2D context.

The in-repo web viewer plays the effect live, looping or one-shot with replay, a
running particle editor rather than a frozen clip. A consuming game embeds this
runtime to play the effect, or re-authors `system.json` into its own particle
system such as Niagara or VFX Graph.

## 2D vs 3D

The two binaries share everything above and differ where dimensionality forces
it:

- `particle-2d` takes `width` and `height` in its `[particle]` table, a planar
  field. Its forces are planar, its preview is a 2D raster animation, and its
  runtime is the canvas binding. It suits UI, 2D-game, and screen-space VFX, and
  it produces a reusable system asset a game plays through the runtime.
- `particle-3d` takes `width`, `height`, and `depth`, a volume. It carries the
  full 3D forces (gravity, vortex, curl-noise turbulence, radial push), its
  preview is the `wgpu` orbit billboard render, and its runtime is the `three`
  binding. This is what the [3D games](/testing/asset-generation/mesh-binaries/)
  consume.
