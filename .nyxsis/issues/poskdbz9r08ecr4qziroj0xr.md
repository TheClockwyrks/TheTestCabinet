---
format: nyxsis-issue
version: 2
id: poskdbz9r08ecr4qziroj0xr
zone: REPOS
number: 6
title: Extract the particle tool into tool-particle
type: generic
state: open
created: 2026-10-13T21:11:56.224227743Z
---

The `particle-core`, `particle-2d` and `particle-3d` crates live under the
superrepo's `crates/`. The documentation places all three in the
`tool-particle` repository, a `tool` kind rendered by the repository kit:
`apps/docs/src/content/docs/development/repositories.md`, sections "The
kinds", "The repositories" and "The edges", and
`apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md`.

## What is missing

The `tool-particle` repository on Azure, populated with the crates' history,
rendered by the kit with its gates and pipeline, mirrored to GitHub, and
pinned by the driver's image builds. The crates are removed from the
superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, and a particle
test case runs on the local stack with the binaries the run image copies.
