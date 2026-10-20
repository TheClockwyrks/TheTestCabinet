---
format: nyxsis-issue
version: 3
id: j10x004gco5coyozcwcqla2b
zone: CICD
number: 1
title: Rebuild the CI images on nightly and move the ciImageTag pin
type: generic
state: open
created: 2026-10-20T06:14:56.137595413Z
---

The gates of every superrepo pipeline job run inside the CI images at the
commit `ci/images/tags.yml` pins as `ciImageTag`, and a change to a file an
image is built from is complete once the image pipeline has pushed the images
and the pin names that commit:
`apps/docs/src/content/docs/development/building.md`, section "Continuous
integration".

## What is wrong

- `ciImageTag` names `af509db605fd49250ddd49aece1177ab9f5d69d1`, built before
  the superrepo consumed `engines`, `gg` and `microservice-repos` as
  submodules and before `scripts/gg-cargo-lock.sh` and the devcontainer's gg
  slice changed what the images copy.
- The `tcab-ci-images` pipeline's latest run on `nightly` (run 16938, commit
  440c589b) failed in the job "Rust browser CI image" at the step "Build and
  push the Rust browser CI image". Its run on `issue/repos-10` (6ec179e6)
  succeeded, so the failure is in what nightly holds beyond that branch.

## What to do

Make the image pipeline's run on `nightly` succeed, then write the commit it
built into `ciImageTag` and push the pin, as the documentation's two steps
state.

## Verify

The `tcab-ci-images` run on the pinned commit is green, `ci-image-pins`
passes, and the gate jobs of the next `nightly` run pull
`<repository>:<pinned commit>`.
