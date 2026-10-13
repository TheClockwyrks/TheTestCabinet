---
format: nyxsis-issue
version: 2
id: n78e029uw7xcnx8uz1lctj6d
zone: REPOS
number: 11
title: Extract the driver and the CLI into microservice-driver
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:03.863838776Z
---

The driver crate, the CLI crate and the run-container images live in the
superrepo. The documentation places the run engine and `tcab` in the
`microservice-driver` repository, an application depending on `contracts`
and `engines`, with the run-container images under its `containers/` and its
pipeline publishing `tcab` on a tag:
`apps/docs/src/content/docs/components/driver/overview.md`,
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories", "The edges" and "Where each responsibility lives", and
`apps/docs/src/content/docs/development/releasing.md`, sections "Releasing
`tcab`" and "The microservice images".

## What is missing

The `microservice-driver` repository on Azure, populated with the crates' and
images' history, rendered by the kit with its gates, `build-context` and
pipeline, pushing `tcab-driver:<commit>` and the run images, mirrored to
GitHub, and pinned by the superrepo's deploy sets as the "The record of what
builds together" section states. The crates and images are removed from the
superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, a staging
deploy rolls the driver image at the submodule pointer, and a run on staging
completes.
