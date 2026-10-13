---
format: nyxsis-issue
version: 2
id: h13qj6u6mgmcx0fmcpdyp3p0
zone: REPOS
number: 14
title: Extract the artifacts service into microservice-artifacts
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:16.321142018Z
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
