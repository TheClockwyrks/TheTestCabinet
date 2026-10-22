---
format: nyxsis-issue
version: 3
id: j10x004gco5coyozcwcqla2b
zone: CICD
number: 1
title: Rebuild the CI images on nightly and move the ciImageTag pin
type: generic
priority: 3
state: done
created: 2026-10-20T06:14:56.137595413Z
done: 2026-10-22T18:46:54.24828773Z
outcome: |
  The project setting "Protect access to repositories in YAML pipelines" is off,
  matching the vantaloc project, so the job token reads every repository; the docs
  state that rule (90802bab3). Landed in PR 5069 into nightly: the token-scoping
  uses: lists and per-repository checkouts removed (submodule_pins checks out the
  superrepo alone), the purge spares images pushed in the last day, the CI images
  rebuilt by the image pipeline on the branch at ed9c9929f and pinned as
  ciImageTag (39f826731), and every kit-rendered repository re-rendered onto that
  tag through PRs 5033-5058 into their masters with the gitlinks moved. Gates run
  18360 on the branch was green in every job, the Rust jobs included; superrepo
  gates 22 of 22. Left for decisions: the kit's rendered pipelines still declare
  the Rust-edge closure under resources and uses: because repositories.md "The
  kit" mandates it; gg took a pin-only commit with its copier record at the old
  commit, since no gg image build exists (build one or exempt gg from the image
  kinds).
---

The gates of every superrepo pipeline job run inside the CI images at the
commit `ci/images/tags.yml` pins as `ciImageTag`, and a change to a file an
image is built from is complete once the image pipeline has pushed the images
and the pin names that commit:
`apps/docs/src/content/docs/development/building.md`, section "Continuous
integration". The job's access token reads every repository of the project,
so no job names a repository under `uses:` or `resources.repositories` for
the token's sake and `submodule_pins` checks out the superrepo alone:
`building.md`, section "Submodules in CI", and
`apps/docs/src/content/docs/development/repositories.md`, section "A
repository's gates and pipeline". The project setting "Protect access to
repositories in YAML pipelines" is already off.

## What is wrong

- `ciImageTag` names `af509db605fd49250ddd49aece1177ab9f5d69d1`, built before
  the superrepo consumed most of its submodules and before
  `scripts/gg-cargo-lock.sh` and the devcontainer's gg slice changed what the
  images copy.
- `azure-pipelines.yml`, `azure-pipelines-ci-images.yml`, `.azure/project/`
  and `.azure/tcab/` still name every submodule repository under `resources`
  and `uses:` to scope the token, `submodule_pins` checks every repository
  out, and the comments of `scripts/ci/submodule-pins.sh` and those files
  state the scoping rule.
- The `tcab-ci-images` pipeline's latest run on `nightly` (18193) failed on
  the twenty-repository cap those lists hit.

## What to do

Remove the token-scoping lists and checkouts and their prose, keeping the
`resources.repositories` entries a job checks out, make the image pipeline's
run on `nightly` succeed, then write the commit it built into `ciImageTag` and
push the pin, as the documentation's two steps state. The purge change that
spares images pushed in the last day, with its tests and prose, is commit
`fcda4495d` and lands with this work.

## Verify

The `tcab-ci-images` run on the pinned commit is green, `ci-image-pins`,
`ci-tests` and `shell-tests` pass, the `submodule_pins` job and the gate jobs
of the next `nightly` run are green, and the gate jobs pull
`<repository>:<pinned commit>`.
