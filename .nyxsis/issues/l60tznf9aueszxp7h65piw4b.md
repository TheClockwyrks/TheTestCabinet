---
format: nyxsis-issue
version: 2
id: l60tznf9aueszxp7h65piw4b
zone: REPOS
number: 10
title: Extract gg into its own repository and consume it as a release
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:12:58.662570282Z
---

gg lives in `crates/gg` with its sandbox artifacts, SDK packages and
toolchain installers, and the driver and backend images build it from source
in the `gg-build` stage of `deployments/images/services.Dockerfile`. That
stage links an x86_64 binary that segfaults, and the header of
`scripts/gg-reference.sh` describes the stage as the source of the reference
documents. The documentation places gg in the `gg` repository, releasing its
binaries, `gg-reference.tar.gz` and the `gg-toolchains` image on a tag, and
has the driver pin a gg version and the images fetch that release:
`apps/docs/src/content/docs/development/releasing.md`, section "Releasing
`gg`"; `apps/docs/src/content/docs/development/building.md`, sections "`gg`
and its eleven toolchains" and "Checking gg's arms in a run image"; and
`apps/docs/src/content/docs/development/repositories.md`, section "Where each
responsibility lives".

## What is missing

- The `gg` repository on Azure, populated with gg's crates, packages,
  installers, skills, docs pages and history, rendered by the kit, running
  gg's test suite as its own gates, publishing the release objects and the
  toolchains image on a tag, and mirrored to GitHub.
- The driver declaring the pinned gg version once, the driver and backend
  images fetching that release, the `-gg` run images copying the toolchain
  tree from the `gg-toolchains` image, and the `gg-build` stage, the
  toolchain installers and the toolchain hydration steps gone from the
  superrepo, its pipeline and its devcontainer.
- `scripts/gg-reference.sh`'s header describing where the documents come
  from, matching `apps/docs/src/content/docs/gg/reference.md`.
- The docs site reading the gg pages from the `gg` checkout as
  `apps/docs/src/content/docs/components/docs/overview.md` states.

## Verify

`make gate` passes in both repositories, a cluster run records the pinned
version as `subject.harnessVersion`, the local image build of the driver and
backend targets succeeds on x86_64 and aarch64, and the docs site builds with
the gg section.
