---
title: Particle binaries
description: The emitter/force/curve authoring interface, the live particle simulator, and the system.json output contract for the 2D and 3D particle-effect binaries (particle-2d / particle-3d).
---

A **particle** asset-generation run authors the VFX a game leans on —
explosions, muzzle flashes, impacts, engine exhaust, splashes, victory bursts,
fire and smoke — through a **particle binary** on its `PATH`, the only channel
for shaping the effect. The paradigm is the one thing to fix up front: the model
does **not** place individual particles. It **authors a system** — emitters,
forces, and per-particle curves — that a **live simulation** plays, exactly the
way a real particle editor (Unreal's Niagara, Unity's VFX Graph) plays a system:
the authored **system definition is the asset**, and whatever plays it —
the binary's preview, the review UI, or a consuming game — **simulates it live**.
Being a stochastic simulation, an effect **varies slightly from one play to the
next**, which is exactly right for VFX: a reviewer judges the *character* of the
effect, not a frozen frame sequence.

There are two binaries, both built on the shared `particle-core` library:

- **`particle-2d`** — for a 2D effect (`asset_kind = "particle-2d"`): a planar
  particle system for UI, 2D-game, and screen-space VFX.
- **`particle-3d`** — for a 3D effect (`asset_kind = "particle-3d"`): a
  volumetric particle system, the kind the [3D games](/testing/asset-generation/mesh-binaries/)
  consume.

The binaries are built from `crates/particle-2d` and `crates/particle-3d` on the
shared `crates/particle-core` library — the system model, the particle simulator,
and the [F-curve](/testing/asset-generation/voxel-binaries/#f-curves) reuse from
`model-core` — and each is baked into its own
[run-container image](/components/core/execution/#containerization) — one image
per `asset_kind` — so a run carries only the tool it uses. The 3D binary renders
billboards through `model-core`'s `wgpu` renderer; the 2D binary composites in a
2D raster path. Nothing is regenerated after the run: the binary **emits** the
authored `system.json`, and the [validator](/testing/asset-generation/evaluation/)
parses it and confirms it is well-formed.

The two binaries share the **whole op vocabulary and the simulator**. They differ
only in **dimensionality** (2D omits `z`; forces are planar), the **preview
renderer** (a 2D raster path vs. `wgpu` 3D billboards from an orbit camera), and
the **runtime binding** (a 2D canvas binding vs. the `three` binding). So this
page documents **one shared vocabulary** and calls out the 2D/3D differences
inline, exactly as
[mesh-binaries](/testing/asset-generation/mesh-binaries/) covers `mc`/`sn`/`dc`
from one shared vocabulary.

A particle case authors **one effect** — the way a
[single sprite](/testing/asset-generation/sprite-binaries/) is one image — so a
game needing many effects uses many cases or variants. There is **no
required-animation-style contract table**: a particle effect carries no
game-facing rig interface, and is judged **subjectively against its brief**.

## The operations are ordinary CLI subcommands

A case seeds **no** operations schema. The vocabulary is the binary's own
`--help`, exactly as with the [drawing](/testing/asset-generation/sprite-binaries/),
[voxel](/testing/asset-generation/voxel-binaries/), and
[meshing](/testing/asset-generation/mesh-binaries/) tools, and the brief tells
the model to read it:

```
particle-3d --help                 # every operation
particle-3d add-emitter --help     # one operation's exact flags
```

Each operation is a subcommand with flags — there is no JSON. For example:

```
particle-3d add-emitter --name blast --shape sphere --x 0 --y 1 --z 0 --radius 0.2 \
                        --burst 400 --at 0 --lifetime 700 --speed 9 --dir-y 1 --cone-angle 180 --seed 7
particle-3d set-forces --emitter blast --gravity -6 --drag 1.4 --radial 12
particle-3d set-particle --emitter blast --size-curve ease-out \
                        --color-gradient "#ffffff@0,#ffb23a@0.3,#c02010@0.7,#333333@1" --opacity-curve ease-in
particle-3d add-subemitter --parent blast --on death --emitter embers
```

The operations, categorized:

- **`add-emitter`** — an emission source. Its `--shape` is one of `point` /
  `disc` / `sphere` / `cone` / `box` / `edge` positioned at `--x --y` (**3D adds
  `--z`**), with a shape extent (`--radius` / `--size ...`). It emits either
  continuously (`--rate <particles/s>`) or as a timed burst (`--burst <count>
  --at <ms>`) — **one-shot effects use bursts; continuous effects use a rate** —
  and gives each particle a `--lifetime <ms>` (`±spread`), a `--speed <v>`
  (`±spread`), and a launch direction `--dir-x --dir-y` (**3D adds `--dir-z`**)
  with an optional `--cone-angle <deg>` spread. An optional `--seed <n>` pins the
  emitter's random draws for a repeatable look; without it, each play varies.
- **`set-forces`** — the forces integrated into the motion each step, global or
  scoped to one `--emitter <n>`: `--gravity <v>` (with an optional `--dir`),
  `--drag <k>`, `--radial <v>` (an explosion push out from a center point),
  `--vortex <v>`, `--turbulence <amp,scale>` (curl-noise), and `--wind <v,dir>`.
  In 2D the direction components are planar; in 3D they carry the full
  `z` axis.
- **`set-particle`** — the per-particle appearance over a particle's **normalized
  life**, scoped to an `--emitter`: `--size-curve <curve>` and `--opacity-curve
  <curve>` are [F-curves](/testing/asset-generation/voxel-binaries/#f-curves)
  (the same `model-core` curves, `constant` / `linear` / `bezier` plus the
  `ease-in` / `ease-out` / `ease-in-out` presets), and `--color-gradient
  <#c@t,...>` is a set of keyed **opaque `#rrggbb`** color stops over life (fire
  runs white→orange→red→smoke). Optional `--rotation` and `--stretch` shape spin
  and velocity-stretch, and an optional `--sprite <ref>` textures the particles
  with a produced sprite or atlas — a cross-asset reference into another
  produced asset.
- **`add-subemitter`** — a secondary system spawned from a parent's particles,
  `--parent <emitter> --on death|step --emitter <child>`: on a particle's
  **death** (a shell that bursts into embers) or along its **step** path (a spark
  that trails smoke). The child is itself an authored emitter.
- **`set-timeline`** — `--loop true|false`: a **one-shot** effect (an explosion
  that decays to empty) vs. a **looping** one (fire or smoke settling into a
  steady state). The effect's duration and the playback fps come from the case's
  `[particle]` table, not a flag.
- **`render`** — the separate, on-request preview (below).
- **`init`** — seed an empty log; a run starts pre-seeded.

The coordinate convention matches the voxel and mesh tools: `x` across, `y`
**up**, `z` in depth, forward = `+z`. `particle-2d` simply omits the `z`
component everywhere — positions, directions, and forces are planar.

## The effect is simulated live, not baked

There is **no bake and no determinism requirement**. Where the meshing tools
composite a field once and extract a fixed mesh, a particle effect is a **live
simulation of the authored system** — the same model a real particle editor uses.
The authored **`system.json` is the whole asset**; whatever plays it simulates it
in real time from the emitters, forces, and curves it declares. A stochastic
simulation naturally **varies from play to play**, and that is correct for an
explosion or a plume — there is nothing to freeze and nothing to reproduce
frame-for-frame.

This keeps the [actions-are-the-output](/testing/asset-generation/evaluation/#regeneration)
property cleanly: the authored system **is** the recorded operations, resolved
into their emitters and forces, so there is no separate baked artifact a model
could produce outside the tool. The only output is the system the model built
through the binary; every consumer simulates it.

## How a call records; rendering is on request

Each operation **only appends itself to the run's operation log** — that is all
an authoring call does. Simulating an effect over its whole duration and rendering
it is far more expensive than recording an intent, so — like the
[voxel](/testing/asset-generation/voxel-binaries/#how-a-call-records-rendering-is-on-request)
and [meshing](/testing/asset-generation/mesh-binaries/#how-a-call-records-rendering-is-on-request)
tools — these binaries do **not** re-simulate after every call. Rendering is a
separate, **on-request** step, the `render` command. The orchestrator seeds a
`particle-3d.config.json` (or `particle-2d.config.json`) next to the workspace
giving the `[particle]` field dimensions, the duration and playback fps, and the
log / preview / `system.json` paths, so neither an operation nor `render` needs
any of those flags.

The **`render` command** simulates the authored system over the effect's duration
and, from the resulting motion, **renders the preview frames plus a GIF** (reusing
the existing [animation GIF export](/testing/asset-generation/sprite-binaries/))
and **emits `system.json`**. A model runs it to see its progress and, **before it
finishes, to emit the `system.json` the run's result is built from** — an
unrendered effect leaves an empty system, which the validator records as empty. The
preview is a **representative capture** of one live play, not a canonical bake —
another play of the same system reads the same but is not pixel-identical.

```
particle-3d init                 # write an empty log (a run starts pre-seeded); renders nothing
particle-3d render               # simulate the system; render preview frames + GIF; emit system.json
particle-3d render --frame 12    # capture a single preview frame to a still
```

## The preview

The preview `render` produces is the **played effect**. For `particle-3d` it is a
real 3D render: the binary billboards each live particle and rasterizes it with
**`wgpu` targeting Mesa lavapipe** — software Vulkan, running on the CPU,
headless (there is no GPU in the run container) — through an **orbit camera**, so
the previews are apples-to-apples with the other voxel-family binaries. For
`particle-2d` the frames come from the **2D raster path**, compositing the
particles in the planar `[particle]` field. Either way the per-frame images are
packed into a **GIF** — one-shot for a decaying effect, looping for a
steady-state one — via the same animation GIF export the
[sprite-sheet](/testing/asset-generation/sprite-binaries/) sequences use. That
GIF (and its frames) is what the model reads to judge its effect and a still the
result page can show; the interactive, live-playing view is the frontend's
**live simulation** of the emitted `system.json` (see [Runtime
consumption](#runtime-consumption)), not something the binary produces.

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` —
the model's authoring is streamed to the viewer in real time, mechanically
identical to the [voxel](/testing/asset-generation/voxel-binaries/#live-preview)
and [meshing](/testing/asset-generation/mesh-binaries/#live-preview) tools: the
orchestrator adds a `live` block (a `host.docker.internal` endpoint and an opaque
per-run token) to the seeded config, and **when the model runs `render`** the
binary connects back to the run host and streams a one-line JSON header
(`{ token, frame, operationCount, operation, length, ... }`) followed by the
freshly rendered preview frame's raw bytes and then the current `system.json`
payload. That payload lets the viewer **simulate the effect live** as it is
authored — looping or replaying it exactly as the finished-run view does — rather
than showing only the flat preview frame; a frame-only viewer simply ignores it.
Streaming is **best-effort and non-essential** — absent for an unwatched run,
never fails an operation, and never recorded; the recorded **operation log** and
the emitted `system.json` remain the run's authoritative output.

## The output contract

`render` emits a single artifact:

- **`system.json`** — the **authored particle-system definition**: its emitters,
  forces, per-particle curves, sub-emitters, duration, and loop flag. It is
  compact **metadata** — the [`rig.json`](/testing/asset-generation/voxel-binaries/#rig-subcommands)
  analogue, but where a rig is *posed*, a system is *simulated*. Every consumer —
  the review UI, an embedding game — plays the effect by **running the simulation
  live** from this definition.

The **preview GIF a reviewer plays and the live-simulated effect are what is
scored** — the *character of the effect*, the way a
[sprite-sheet's sequences](/testing/asset-generation/sprite-binaries/) are what a
reviewer plays. The [validator](/testing/asset-generation/evaluation/) parses
`system.json`, confirms it is well-formed and readable, and checks that it is
**non-empty** — that the system actually emits particles rather than declaring
emitters that produce nothing.

## Runtime consumption

A shared TypeScript package `@test-cabinet/particle-runtime` (mirroring
[`@test-cabinet/voxel-runtime`](/components/voxel-runtime/overview/)) turns a
particle run's `system.json` into a **playable effect** by **simulating it live**
— the difference from the voxel runtime being that a rig is *posed* from decoded
geometry, while a particle system is *simulated* from its definition:

- the **pure core** runs the simulation from `system.json` — stepping the emitters
  and forces and evaluating the per-particle curves each frame;
- a **`three` binding** renders the 3D effect as **billboards** — instanced quads
  or `THREE.Points` — from the simulated state; and
- a **2D canvas binding** composites the same simulated state in a 2D context.

The in-repo web viewer **plays the effect live** — **looping**, or **one-shot
with replay** — the way the [voxel viewer](/components/voxel-runtime/overview/#the-voxelrig-api-for-game-integrators)
poses a rig, a running particle editor rather than a frozen clip. A consuming game
embeds this runtime to play the effect, or **re-authors `system.json`** into its
own particle system (Niagara, VFX Graph) — the same portable definition either way.

## 2D vs 3D

The two binaries share everything above; their specifics differ only where
dimensionality forces it:

- **`particle-2d`** — its `[particle]` table gives **`width` / `height`**, a 2D
  field like [`[canvas]`](/testing/asset-generation/manifests/); forces are
  **planar**; the preview is a **2D raster animation**; and the runtime is the
  **canvas binding**. Good for UI, 2D-game, and screen-space VFX. Unlike a model
  coding an effect inline, this produces a **reusable system asset** a game plays
  through the runtime, distinct from an effect authored in a game's own code.
- **`particle-3d`** — its `[particle]` table gives **`width` / `height` /
  `depth`**, a volume like [`[voxel]`](/testing/asset-generation/manifests/#voxel-cases);
  it carries the **full 3D forces** (gravity, vortex, curl-noise turbulence,
  radial push); the preview is the **`wgpu` orbit billboard render**; and the
  runtime is the **`three` binding**. This is what the
  [3D games](/testing/asset-generation/mesh-binaries/) consume.
