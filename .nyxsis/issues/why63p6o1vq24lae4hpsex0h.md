---
format: nyxsis-issue
version: 3
id: why63p6o1vq24lae4hpsex0h
zone: REPOS
number: 3
title: Extract the sprite tool into tool-sprite
type: generic
state: done
created: 2026-10-13T21:11:43.718637605Z
done: 2026-10-20T08:37:03.161614132Z
outcome: |
  tool-sprite exists on Azure with crates/draw's history, kit render, protection,
  pipeline 149 (run 17295 green, image tool-sprite:d784be5) and GitHub mirror; the
  superrepo pins it as a submodule, the driver takes test-cabinet-draw from it,
  the run images copy draw and draw-sheet from its image, and crates/draw is
  removed (PR 4661 into nightly). Not verified: a sprite case on the local stack.
---

The `draw` crate lives under the superrepo's `crates/`. The documentation
places it in the `tool-sprite` repository, a `tool` kind rendered by the
repository kit, whose image the driver's run-container images copy the binary
from: `apps/docs/src/content/docs/development/repositories.md`, sections "The
kinds", "The repositories" and "The edges", and
`apps/docs/src/content/docs/testing/asset-generation/sprite-binaries.md`.

## What is missing

The `tool-sprite` repository on Azure, populated with the crate's history,
rendered by the kit with its gates and pipeline, mirrored to GitHub, and
pinned by the superrepo and the driver's image builds as the "The record of
what builds together" section states. The crate is removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, and a sprite
test case runs on the local stack with the binary the run image copies.
