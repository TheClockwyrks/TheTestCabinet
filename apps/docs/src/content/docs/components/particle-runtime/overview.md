---
title: Overview
---

The particle runtime (`@test-cabinet/particle-runtime`, in
`packages/particle-runtime`) is the shared TypeScript library that turns a
[particle](/testing/asset-generation/overview/) run's produced `system.json` into a
**playable effect** by **simulating it live** — stepping its emitters and forces and
evaluating each particle's life-curves every frame. It is the **particle analogue of
[`@test-cabinet/voxel-runtime`](/components/voxel-runtime/overview/)**, with one
defining difference: a voxel rig is *posed* (its geometry arrives ready-made and the
runtime only resolves transforms), whereas a particle system is *simulated* — there is
no baked frame data, so the runtime **integrates the effect forward from the authored
description**. It is consumed by the in-repo [particle viewer](/components/ui/overview/)
that reviews particle runs *and* by real games that embed a produced effect, so the
simulation math lives in one place rather than being reimplemented per consumer.

Like the voxel runtime, it is a code-sharing library, not a component itself: it ships
no service and runs in no process of its own.

## The pure-core / bindings split

The package ships **three subpath entries** so a consumer takes only what it needs:

- **`@test-cabinet/particle-runtime`** (the root) — the **pure core**: the contract
  types, the curve/gradient sampling, the deterministic PRNG (`Rng`), and the
  **`ParticleSimulator`**, with **no rendering dependency**. A game with its own
  renderer, or a headless consumer (a test, a server), uses this alone. It captures
  render-ready particles as plain data (`RenderParticle[]`), so any renderer can draw
  them.
- **`@test-cabinet/particle-runtime/three`** — the **three.js binding**: a
  `ParticleSystemPlayer` that draws the simulator's particles as a GPU **billboard
  point cloud** (additive blending by default, for fire/energy VFX; normal blending for
  smoke/debris). `three` is a **peer dependency** (not bundled), so a consuming game
  shares its single `three` instance with the runtime.
- **`@test-cabinet/particle-runtime/canvas`** — the **2D-canvas binding**: a
  `ParticleCanvasPlayer` that composites the same simulated particles as soft
  radial-gradient discs into a `CanvasRenderingContext2D` (`lighter`/additive by
  default). The canvas analogue of the `three` binding — same simulated state, a 2D
  raster path instead of billboards — for a `particle-2d` effect that composites into a
  flat scene.

The tooling mirrors [`@test-cabinet/voxel-runtime`](/components/voxel-runtime/overview/)
and [`@test-cabinet/run-record`](/components/core/run-records/) — a composite `tsc -b`
build. The core re-exports the one shared enum it needs —
[`InterpSpec`](/components/core/run-records/), the F-curve interpolation — from the
generated run-record package, so there is a single source of truth for it (exactly as
the voxel runtime's contract re-exports the rig types). The rest of the `system.json`
shapes are declared locally, matching the documented contract, until contract-codegen
emits a particle-system type.

## The contract it loads

The runtime consumes exactly the one artifact a particle run produces — the
`system.json` emitted by the
[particle binaries](/testing/asset-generation/particle-binaries/):

- **`system.json`** — the whole authored **`ParticleSystem`**: its `dimensions`
  (`2` planar / `3` volumetric), its bounding `field`, `durationMs`, `fps`, `loop`
  intent, its **emitters** (each an emission source — `point`/`disc`/`sphere`/`cone`/
  `box`/`edge` — releasing particles at a `rate` or as a timed `burst`, with per-particle
  lifetime/speed/direction and their spreads), the **forces** integrated into motion
  (gravity, drag, radial push, vortex, curl-noise turbulence, wind — global, with
  per-emitter overrides), the per-particle **appearance** over normalized life (size and
  opacity F-curves, a keyed color gradient, spin, velocity-stretch, an optional
  cross-asset sprite), and the **sub-emitter** links (a child system fired on a parent
  particle's `death` or along its `step` path).

The system shape is governed by the documented
[particle contract](/testing/asset-generation/particle-binaries/), so a consuming game
can rely on it the same way the review UI does.

## Simulation

The core is framework-agnostic. Its central primitive is the **`ParticleSimulator`**,
which advances a system's live state and captures a render-ready snapshot:

```ts
const sim = new ParticleSimulator(system, { seed, maxParticles });
sim.step(dtMs);                  // integrate + age live particles, then emit over the window
const particles = sim.capture(); // RenderParticle[] — appearance evaluated at each life
```

Each `step(dtMs)` integrates and ages every live particle (firing sub-emitters and
removing the dead), then emits new particles over the elapsed window; `capture()`
evaluates each surviving particle's appearance at its current normalized life (size,
opacity, color, velocity-stretch) into a `RenderParticle` the bindings draw. The
simulator also exposes `clockMs` (the monotonic play clock, advancing across loop
cycles), `liveCount`, `isNonEmpty`, and `reset()` (rewind and re-seed, re-firing any
zero-time bursts so frame 0 already carries them).

Stepping the system is **main-thread work in the viewer**, so the live count is
capped at **10,000** — the same
[live-particle budget](/testing/asset-generation/particle-binaries/#the-live-particle-budget)
the binaries enforce when the system is authored, mirrored here so a `system.json`
that predates the budget (or was written by hand) still cannot freeze the tab.
Spawns past the cap are dropped; `maxParticles` lowers it further for a constrained
client.

**Turbulence** is the one force whose cost is not proportional to anything visible.
Curl noise is the curl of a hash-based potential, and evaluating it per particle per
frame means hundreds of exact 64-bit hashes — cheap in native Rust, ruinous in
JavaScript. The lattice those hashes sit on is small, shared by every particle, and
constant over time, so `CurlNoise` memoizes it in a fixed-size open-addressed table
and reads only the six partial-derivative components the curl actually uses (rather
than three full potential evaluations per axis). Both are **exact**: the values are
bit-identical to the naive form, and to the Rust simulator's, so a seeded play still
matches the binary's. Together they take a turbulent system at the particle cap from
about 670 ms a frame to about 10 ms.

### Determinism

Every random draw folds in a base `seed`. Pass a fixed seed to make a play
**reproducible** — the same effect every time, which is how the binary's headless
preview renders — or omit it to let each play vary. This mirrors the voxel runtime's
posing determinism: given the same input the output is stable.

:::note[Two renderers of the same system]
This library is the **browser** renderer (three billboards or a 2D canvas). The
[particle binaries](/testing/asset-generation/particle-binaries/) also render their own
**preview** of the same `system.json` headlessly. Both simulate the same authored
description; the browser path lives here.
:::

## Consuming a produced effect

The runtime has two consumers, exactly like the voxel runtime:

- **The review UI.** The [particle viewer](/components/ui/overview/) mounts the `three`
  binding's `ParticleSystemPlayer` to replay a produced `system.json` for a run, and the
  [live asset view](/components/live-streaming/) plays the in-progress system as it
  streams. A game and the review UI therefore simulate a produced effect identically.
- **A real game, via the manifest `packages` key.** `@test-cabinet/particle-runtime` is
  one of the **shippable Test Cabinet runtime libraries** (alongside
  `@test-cabinet/voxel-runtime`) an [end-to-end](/testing/end-to-end/manifests/) case may
  request in its `packages` list. When a case declares it, the driver vendors it into the
  run repository as an in-repo `file:` dependency, so the built game can
  `import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas"` to load a
  seeded, cross-asset `system.json` (for example a produced VFX burst) and simulate it
  live in-game — the same way the gallery plays it. The allowlist of shippable packages
  lives in `crates/core/src/test_case.rs` (`SHIPPABLE_PACKAGES`) and must stay in lockstep
  with `scripts/stage-tcab-packages.mjs`, which bakes them into the run image.

## Status

Implemented in `packages/particle-runtime`. The pure core has no rendering dependency;
both the `three` and `canvas` bindings take `three` / the DOM canvas only in their
subpaths. It is consumed by the [UI library](/components/ui/overview/)'s particle viewer
and live asset view, and is publishable — via the manifest `packages` key — for games
that embed a produced particle effect.
