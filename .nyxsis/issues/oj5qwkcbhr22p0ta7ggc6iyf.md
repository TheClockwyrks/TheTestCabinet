---
format: nyxsis-issue
version: 2
id: oj5qwkcbhr22p0ta7ggc6iyf
zone: REPOS
number: 12
title: Extract the backend into microservice-backend
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:08.379701475Z
---

The backend crate, `entities`, `migration` and `db-auth` live in the
superrepo. The documentation places them in the `microservice-backend`
repository, an application depending on `contracts` and `engines`:
`apps/docs/src/content/docs/components/backend/overview.md` and
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories", "The edges" and "Where each responsibility lives".

## What is missing

The `microservice-backend` repository on Azure, populated with the crates'
history and the ingest sidecar, rendered by the kit with its gates,
`build-context` and pipeline, pushing `tcab-backend:<commit>`, mirrored to
GitHub, and pinned by the superrepo's deploy sets as the "The record of what
builds together" section states. The crates are removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, a staging
deploy rolls the backend image at the submodule pointer, and the console on
staging lists runs and launches one.
