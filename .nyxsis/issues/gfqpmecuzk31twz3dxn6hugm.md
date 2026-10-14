---
format: nyxsis-issue
version: 2
id: gfqpmecuzk31twz3dxn6hugm
zone: REPOS
number: 9
title: Extract the engines into the engines repository
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:12:49.120380544Z
---

The authored engines, the voxel and particle runtimes, `case-harness` and the
foray and lattice crates live in the superrepo, and the lattice playback is the
console's `pages/runs/lattice` renderer and interpolation over the case bundle's
`lattice-core.wasm`. The documentation places them in the `engines` repository,
a library depending on `contracts` that publishes `built_in_catalog`, the
packages the driver vendors into a model's workspace and
`@clockwyrks/lattice-runtime`:
`apps/docs/src/content/docs/components/engines/overview.md` and
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories", "The edges" and "Where each responsibility lives".

## What is missing

- The `engines` repository on Azure, populated with the crates' and packages'
  history, rendered by the kit with its gates (`seeded-contract` among them) and
  pipeline, publishing its packages to the feed on a tag, mirrored to GitHub,
  and the driver, the backend and the arena depending on it as the "How a
  dependency is named" section states. The crates and packages are removed from
  the superrepo.
- `packages/lattice-runtime`, holding the renderer and the interpolation moved
  from `@clockwyrks/ui` and `lattice-core` compiled to the playback ABI, with
  the script that rebuilds the wasm from the crate; the console's lattice page
  and Reference tab importing it, the sprite atlas and reference scenarios still
  vendored from the case bundle, and the `@clockwyrks/lattice-runtime` row in
  the kit's `edges.py`.

## Verify

`make gate` passes in the new repository and in every consumer, the
`dependency-graph` gate accepts the new edges, a test case run with each of the
2D, 3D and "none" engines on the local stack produces the same workspace it does
today, and a performance run's playback and the lattice case's Reference tab
draw in the console as they do today.
