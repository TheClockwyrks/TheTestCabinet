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

## Blocked

The docs require one scoped job token to reach every submodule repository,
and Azure DevOps caps a scoped job token at 20 repositories.

- `building.md` ("Submodules in CI"): the project scopes the job's access
  token to the repositories a job names. `building.md` (CI images purge) and
  `repositories.md`: the image pipeline declares every submodule repository
  under `resources` and each of its jobs names it under `uses:`; a
  repository the purge cannot read stops it. `submodule_pins` checks every
  submodule's repository out in one job.
- `.gitmodules` on `nightly` names 21 repositories by relative URL (22 once
  REPOS-11 adds `microservice-driver`; more extractions will follow).
- Azure rejects the job: "Tokens may be scoped to a maximum of 20
  repositories. Reference fewer repositories in YAML or disable Scoped
  Tokens." Seen in `tcab-ci-images` run 17640 (both image jobs) and in the
  gates pipeline's `submodule_pins` job on `nightly` (17553, 17568, 17578).
  So no image run on `nightly` can start, and the pin cannot move.

The user must decide one of:

1. Turn off "Limit job authorization scope to referenced Azure DevOps
   repositories" for the project (or the pipelines), and drop the scoped
   token rule from the docs.
2. Split the work across jobs of at most 20 repositories each: jobs that read
   the submodules' pins (and check `submodule_pins`) per batch and hand them
   to one purge job. The docs then state the batching.
3. Narrow the repositories the purge reads (for example only those whose
   pipelines run in a CI image), changing the "every submodule" rule.
4. Read the repositories through another credential (for example a
   workload-identity service connection with read access to the project's
   repositories), changing the "job token" and credentials table rules.

Which one, and does the same choice apply to `submodule_pins`?

The purge change that spares images pushed in the last day, with its tests
and prose, is on `origin/issue/cicd-1` (fcda4495d) and lands with the
unblocked work.
