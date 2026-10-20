---
format: nyxsis-issue
version: 3
id: why63p6o1vq24lae4hpsex0h
zone: REPOS
number: 3
title: Extract the sprite tool into tool-sprite
type: generic
state: open
created: 2026-10-13T21:11:43.718637605Z
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

## Blocked

`az repos create -p the-test-cabinet --name tool-sprite` fails with
TF401027: the service principal `az` runs as (nyxsis-workspaces) lacks the
project-level Git 'CreateRepository' permission (verified 2026-10-20). No
`tool-sprite` repository exists in the project. Without it the push, the
branch protection (`protect.py`), the pipeline, the mirror's secure-file
authorization and the first `master` run cannot happen.

The user must decide one of:

- Create the empty Azure DevOps repository `tool-sprite` in project
  `the-test-cabinet` by hand, or
- Grant nyxsis-workspaces the Git 'Create repository' permission at project
  scope (this also unblocks the other extraction issues that need new
  repositories).
