---
format: nyxsis-issue
version: 2
id: ilzgslw4gum3exp3bj5w3mbg
zone: REPOS
number: 15
title: Extract the publisher into microservice-publisher
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:20.479525722Z
---

The publisher crate lives in the superrepo. The documentation places it in
the `microservice-publisher` repository, an application depending on
`contracts`, whose image the dispatcher runs as the per-publish Job:
`apps/docs/src/content/docs/components/backend/results.md`, section
"Publish", and `apps/docs/src/content/docs/development/repositories.md`,
sections "The repositories" and "The edges".

## What is missing

The `microservice-publisher` repository on Azure, populated with the crate's
history, rendered by the kit with its gates, `build-context` and pipeline,
pushing `tcab-publisher:<commit>`, mirrored to GitHub, and pinned by the
superrepo's deploy sets as the "The record of what builds together" section
states. The crate is removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, and a publish
on staging runs the Job from the image at the submodule pointer.
