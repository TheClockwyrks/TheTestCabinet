---
title: Overview
---

The particle runtime (`@clockwyrks/particle-runtime`, in
`packages/particle-runtime`) is the shared TypeScript library that turns a
[particle](/testing/asset-generation/overview/#particle-effects) run's produced
`system.json` into a playable effect by simulating it live: stepping its
emitters and forces and evaluating each particle's life curves every frame. The
runtime integrates the effect forward from the authored description on every
play.

It is consumed by the in-repo [particle viewer](/components/ui/overview/) that
reviews particle runs and by games that embed a produced effect, so the
simulation math lives in one place. It is a code-sharing library rather than a
component: it ships no service and runs in no process of its own.

## The pure-core and bindings split

The package ships three subpath entries so a consumer takes only what it needs.

`@clockwyrks/particle-runtime`, the root, is the pure core: the contract
types, the curve and gradient sampling, the deterministic PRNG, and the
`ParticleSimulator`. It carries no rendering dependency and captures
render-ready particles as plain `RenderParticle[]` data, so any renderer can
draw them.

`@clockwyrks/particle-runtime/three` is the three.js binding: a
`ParticleSystemPlayer` that draws the simulator's particles as a GPU billboard
point cloud, additive by default for fire and energy effects and normal for
smoke and debris. `three` is a peer dependency, so a consuming game shares its
single `three` instance with the runtime.

`@clockwyrks/particle-runtime/canvas` is the 2D-canvas binding: a
`ParticleCanvasPlayer` that composites the same simulated particles as soft
radial-gradient discs into a `CanvasRenderingContext2D`, additive by default. It
serves a `particle-2d` effect that composites into a flat scene.

The core re-exports `InterpSpec`, the F-curve interpolation enum, from
[`@clockwyrks/run-record`](/components/core/run-records/), so that shape has a
single source of truth. The rest of the `system.json` shapes are declared
locally, matching the documented contract.

## Loaded artifact

The runtime consumes the one artifact a particle run produces, the `system.json`
emitted by the [particle
binaries](/testing/asset-generation/particle-binaries/). It is the whole
authored `ParticleSystem`:

- Its `dimensions` (`2` planar or `3` volumetric), bounding `field`,
  `durationMs`, `fps`, and `loop` intent.
- Its emitters, each a `point`, `disc`, `sphere`, `cone`, `box`, or `edge`
  source releasing particles at a `rate` or as a timed `burst`, with
  per-particle lifetime, speed, and direction and their spreads.
- Its forces, integrated into motion: gravity, drag, radial push, vortex,
  curl-noise turbulence, and wind, declared globally with per-emitter overrides.
- Its per-particle appearance over normalized life: size and opacity F-curves, a
  keyed color gradient, spin, velocity stretch, and an optional cross-asset
  sprite.
- Its sub-emitter links, a child system fired on a parent particle's `death` or
  along its `step` path.

## Simulation

The core's central primitive is the `ParticleSimulator`, which advances a
system's live state and captures a render-ready snapshot:

```ts
const sim = new ParticleSimulator(system, { seed, maxParticles });
sim.step(dtMs); // integrate + age live particles, then emit over the window
const particles = sim.capture(); // RenderParticle[] — appearance evaluated at each life
```

Each `step(dtMs)` integrates and ages every live particle, firing sub-emitters
and removing the dead, then emits new particles over the elapsed window.
`capture()` evaluates each surviving particle's appearance at its current
normalized life into a `RenderParticle` the bindings draw. The simulator also
exposes `clockMs`, the monotonic play clock advancing across loop cycles,
`liveCount`, `isNonEmpty`, and `reset()`, which rewinds and re-seeds, re-firing
any zero-time bursts so frame 0 already carries them.

Stepping the system is main-thread work in the viewer, so the live count is
capped at 10,000. This mirrors the live-particle budget the
[binaries](/testing/asset-generation/particle-binaries/) enforce at authoring
time, so a hand-written `system.json` cannot freeze the tab. Spawns past the cap
are dropped, and `maxParticles` lowers the cap further for a constrained client.

Turbulence is the runtime's most expensive force. Curl noise is the curl of a
hash-based potential, and evaluating it per particle per frame means hundreds of
exact 64-bit hashes. The lattice those hashes sit on is small, shared by every
particle, and constant over time, so `CurlNoise` memoizes it in a fixed-size
open-addressed table, verifying every hit against its stored key, and reads only
the six partial-derivative components the curl uses. Both are exact: the values
are identical to the naive form and to the Rust simulator's, so a seeded play
still matches the binary's.

### Determinism

Every random draw folds in a base `seed`. Pass a fixed seed to make a play
reproducible, which is how the binary's headless preview renders, or omit it to
let each play vary.

:::note[Two renderers of the same system]
This library is the browser renderer, over three billboards or a 2D canvas. The
[particle binaries](/testing/asset-generation/particle-binaries/) render their
own preview of the same `system.json` headlessly. Both simulate the same
authored description.
:::

## Consuming a produced effect

The runtime has two consumers.

The [review UI](/components/ui/overview/) mounts the `three` binding's
`ParticleSystemPlayer` to replay a produced `system.json`, and the [live asset
view](/components/live-streaming/) plays the in-progress system as it streams. A
game and the review UI therefore simulate a produced effect identically.

A game reaches the runtime through the manifest `packages` key.
`@clockwyrks/particle-runtime` is one of the shippable Test Cabinet runtime
libraries, alongside `@clockwyrks/voxel-runtime`, that an
[end-to-end](/testing/end-to-end/manifests/) case may request. When a case
declares it, the driver vendors it into the run repository as an in-repo `file:`
dependency, so the built game can import `ParticleCanvasPlayer` from
`@clockwyrks/particle-runtime/canvas`, load a seeded cross-asset
`system.json`, and simulate it live in-game. The allowlist of shippable packages
lives in `crates/core/src/test_case.rs` as `SHIPPABLE_PACKAGES` and must stay in
lockstep with `scripts/stage-tcab-packages.mjs`, which bakes them into the run
image.
