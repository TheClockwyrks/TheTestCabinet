---
format: nyxsis-issue
version: 3
id: h13qj6u6mgmcx0fmcpdyp3p0
zone: REPOS
number: 14
title: Extract the artifacts service into microservice-artifacts
type: generic
state: done
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:16.321142018Z
done: 2026-10-21T07:40:59.880450011Z
outcome: |
  Landed in PR 4908 into nightly: microservice-artifacts exists on Azure with
  crates/artifacts' history, kit render, pipeline pushing
  microservice-artifacts:<commit> (master ae03ff8 green), branch protection and
  GitHub mirror; the superrepo pins it as a submodule with branch ., the staging
  and prod deploy sets and pin-images.sh pin tcab-artifacts at the submodule
  pointer, the artifacts target leaves services.Dockerfile and crates/artifacts is
  removed. The backend carries an interim copy of the R2 client until DATA-3 moves
  publishing behind the artifacts service. Superrepo gates 28 of 28,
  microservice-artifacts 14 of 14. Not verified: a staging rollout and a run tree
  served through the console, which follow the staging promotion (CICD-4).
---

The artifacts crate lives in the superrepo. The documentation places it in
the `microservice-artifacts` repository, an application depending on
`contracts`: `apps/docs/src/content/docs/components/artifacts/overview.md`,
section "Deployment", and
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories" and "The edges".

## What is missing

The `microservice-artifacts` repository on Azure, populated with the crate's
history, rendered by the kit with its gates, `build-context` and pipeline,
pushing `tcab-artifacts:<commit>`, mirrored to GitHub, and pinned by the
superrepo's deploy sets as the "The record of what builds together" section
states. The crate is removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, a staging
deploy rolls the artifacts image at the submodule pointer, and a run's tree
on staging is served through the console.
