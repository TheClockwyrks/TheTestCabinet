---
format: nyxsis-issue
version: 2
id: o8kk32ynvy3w5zi5gvketnyf
zone: REPOS
number: 13
title: Extract the dispatcher into microservice-dispatcher
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:12.247705977Z
---

The dispatcher crate lives in the superrepo. The documentation places it in
the `microservice-dispatcher` repository, an application depending on
`contracts`: `apps/docs/src/content/docs/components/dispatcher/overview.md`
and `apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories" and "The edges".

## What is missing

The `microservice-dispatcher` repository on Azure, populated with the crate's
history, rendered by the kit with its gates, `build-context` and pipeline,
pushing `tcab-dispatcher:<commit>`, mirrored to GitHub, and pinned by the
superrepo's deploy sets as the "The record of what builds together" section
states. The crate is removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, a staging
deploy rolls the dispatcher image at the submodule pointer, and a queued run
on staging is claimed and started.
