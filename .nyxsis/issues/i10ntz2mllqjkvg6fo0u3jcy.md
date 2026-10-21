---
format: nyxsis-issue
version: 3
id: i10ntz2mllqjkvg6fo0u3jcy
zone: REPOS
number: 16
title: Extract the arena into microservice-arena
type: generic
state: done
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:24.32839863Z
done: 2026-10-21T09:54:54.343634467Z
outcome: |
  Landed in PR 4917 into nightly: microservice-arena exists on Azure with
  crates/arena's history, kit render naming contracts v0.2.3 and engines v1.1.2,
  pipeline pushing microservice-arena:<commit> (master e6ed410 green), branch
  protection and GitHub mirror; the superrepo pins it as a submodule with branch
  ., the staging and prod deploy sets and pin-images.sh pin the arena image at the
  submodule pointer, the arena target and runtime-slim stage leave
  services.Dockerfile, and crates/arena is removed. Superrepo gates 28 of 28. Not
  verified: the staging rollout and a match completing on staging, which follow
  the staging promotion (CICD-4).
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
