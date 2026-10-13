---
format: nyxsis-issue
version: 2
id: i10ntz2mllqjkvg6fo0u3jcy
zone: REPOS
number: 16
title: Extract the arena into microservice-arena
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:24.32839863Z
---

The arena crate lives in the superrepo. The documentation places it in the
`microservice-arena` repository, an application depending on `contracts` and
`engines`: `apps/docs/src/content/docs/components/arena/overview.md` and
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories" and "The edges".

## What is missing

The `microservice-arena` repository on Azure, populated with the crate's
history, rendered by the kit with its gates, `build-context` and pipeline,
pushing `tcab-arena:<commit>`, mirrored to GitHub, and pinned by the
superrepo's deploy sets as the "The record of what builds together" section
states. The crate is removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, a staging
deploy rolls the arena image at the submodule pointer, and a match on staging
completes.
