---
format: nyxsis-issue
version: 2
id: z144xga276q9j4rmlzsibbwf
zone: REPOS
number: 4
title: Extract the paint tool into tool-paint
type: generic
state: open
created: 2026-10-13T21:11:46.957859965Z
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
