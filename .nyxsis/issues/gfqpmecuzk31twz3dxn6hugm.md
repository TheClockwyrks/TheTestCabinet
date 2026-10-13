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
foray and lattice crates live in the superrepo. The documentation places them
in the `engines` repository, a library depending on `contracts` that
publishes `built_in_catalog` and the packages the driver vendors into a
model's workspace: `apps/docs/src/content/docs/components/engines/overview.md`
and `apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories", "The edges" and "Where each responsibility lives".

## What is missing

The `engines` repository on Azure, populated with the crates' and packages'
history, rendered by the kit with its gates (`seeded-contract` among them) and
pipeline, publishing its packages to the feed on a tag, mirrored to GitHub,
and the driver, the backend and the arena depending on it as the "How a
dependency is named" section states. The crates and packages are removed from
the superrepo.

## Verify

`make gate` passes in the new repository and in every consumer, the
`dependency-graph` gate accepts the new edges, and a test case run with each
of the 2D, 3D and "none" engines on the local stack produces the same
workspace it does today.
