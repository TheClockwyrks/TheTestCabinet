---
format: nyxsis-issue
version: 3
id: n78e029uw7xcnx8uz1lctj6d
zone: REPOS
number: 11
title: Extract the driver and the CLI into microservice-driver
type: generic
state: done
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
  - why63p6o1vq24lae4hpsex0h
  - z144xga276q9j4rmlzsibbwf
  - m12w5wiiu79bndk4ro5ig45l
  - poskdbz9r08ecr4qziroj0xr
  - nucz4aaupa56b5r8erjhq960
created: 2026-10-13T21:13:03.863838776Z
done: 2026-10-21T03:27:09.820143294Z
outcome: |
  Landed in PR 4878 into nightly: microservice-driver added as a submodule (master
  8783b0bd; kit render with scripts-test and containers-test gates, pipeline 163
  publishing tcab on a tag and pushing microservice-driver:<commit> and the run
  images, protection, GitHub mirror), the deploy sets pin the driver image and the
  run images at the submodule pointer, crates/driver, crates/cli and containers/
  removed with the audio-store scripts, and the contracts v0.2.3 move carried from
  REPOS-12's branch. Superrepo gates 28/28 on the merged tree and npm ci --offline
  resolves. Not verified: a staging deploy of the driver at the pointer and a run
  completing on staging (follow the staging promotion, CICD-4, and the driver's
  master run on 8783b0bd being green), the local stack, a v* tag run.
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
