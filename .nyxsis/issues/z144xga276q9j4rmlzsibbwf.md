---
format: nyxsis-issue
version: 3
id: z144xga276q9j4rmlzsibbwf
zone: REPOS
number: 4
title: Extract the paint tool into tool-paint
type: generic
state: done
created: 2026-10-13T21:11:46.957859965Z
done: 2026-10-20T11:56:56.369992574Z
outcome: |
  tool-paint (pipeline 152, image tool-paint:3346d5df) and, as its prerequisite,
  tool-model-core (pipeline 151) exist on Azure with their crates' history, kit
  render, protection and GitHub mirrors; the superrepo pins both as submodules,
  consumers take the model crates from tool-model-core, the ui and material run
  images copy paint's binaries from the tool-paint image, and
  crates/{paint,model-core,voxel-mesh,model-skin} are removed (PR 4696 into
  nightly; gates 28/28). Not verified: a UI and a material case on the local
  stack.
---

The `paint` crate lives under the superrepo's `crates/`. The documentation
places it in the `tool-paint` repository, a `tool` kind rendered by the
repository kit, whose image the driver's run-container images copy the
binaries from: `apps/docs/src/content/docs/development/repositories.md`,
sections "The kinds", "The repositories" and "The edges", and
`apps/docs/src/content/docs/testing/asset-generation/material-binaries.md`
and `ui-binaries.md` beside it.

## What is missing

The `tool-paint` repository on Azure, populated with the crate's history,
rendered by the kit with its gates and pipeline, mirrored to GitHub, and
pinned by the superrepo and the driver's image builds. The crate is removed
from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, and a material
and a UI test case run on the local stack with the binaries the run image
copies.
