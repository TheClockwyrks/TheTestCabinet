# Retire the GitHub workflows and GHCR

Delete every GitHub Actions workflow and every reference to GHCR, so the GitHub
repository is a source mirror of Azure and nothing else.

This issue depends on
[`build-ci-cd-on-azure-pipelines-with-deploys-to-staging-and-prod.md`](done/build-ci-cd-on-azure-pipelines-with-deploys-to-staging-and-prod.md)
and
[`publish-gg-release-binaries-to-azure-blob-storage.md`](done/publish-gg-release-binaries-to-azure-blob-storage.md),
which take over everything the workflows did that still matters.

## Current state

`.github/` holds the mirror README alone, and Azure Pipelines is the only CI.
The run-container registry defaults to `testcabinet.azurecr.io`, and the
release docs follow the Azure tag route.

The remaining `ghcr.io` references are in the desktop app:
`deployments/k8s/overlays/app` and `crates/desktop/src/cluster.test.rs`, which
[`drop-the-desktop-app.md`](drop-the-desktop-app.md) deletes. The desktop build
scripts and `scripts/ci/desktop-build.sh` still name `release.yml` and GHCR for
the same reason.

The project stays open source because a closed benchmark is not one to trust,
and that means the code is readable. Nobody is expected to run their own
instance, since doing so means paying for every model call, so images reachable
from GitHub serve no one.

## Design

### The mirror

Every workflow is deleted. `.github/README.md` states, in the style of the
Nyxsis mirror README, that the repository lives on Azure Repos, that GitHub
holds a force-pushed mirror receiving gated commits only, and that anything
committed on GitHub directly is lost.

### CI documentation

`scripts/ci/README.md` and the CI section of `development/building.md` describe
Azure Pipelines as the only CI, with the gates, the mirror, the images and the
deploys it owns. The macOS validation leaves with the GitHub workflows.

### Registries

The dispatcher's and core's defaults for the run-container registry point at
the Test Cabinet ACR, and no manifest, script or page names `ghcr.io`. The
GHCR packages may be deleted once production has rolled from the ACR.

### Reference implementations

Publishing a reference implementation stays the manual
`tcab publish-reference` flow documented in
`quickstarts/devops/publish-a-reference.md`. The workflow that wrapped it is
deleted with the others.

## Done when

- [x] `.github/` holds the mirror README and nothing else.
- [x] `scripts/ci/README.md` and `development/building.md` name Azure Pipelines
      as the only CI.
- [ ] A search of the checkout for `ghcr.io` and `gh workflow` finds nothing.
- [x] A run launched on a cluster deployed from the ACR pulls its run-container
      image from the ACR by default.
- [ ] Gates green.
