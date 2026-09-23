# Retire the GitHub workflows and GHCR

Delete every GitHub Actions workflow and every reference to GHCR, so the GitHub
repository is a source mirror of Azure and nothing else.

This issue depends on
[`build-ci-cd-on-azure-pipelines-with-deploys-to-staging-and-prod.md`](build-ci-cd-on-azure-pipelines-with-deploys-to-staging-and-prod.md)
and
[`publish-gg-release-binaries-to-azure-blob-storage.md`](publish-gg-release-binaries-to-azure-blob-storage.md),
which take over everything the workflows did that still matters.

## Current state

`.github/workflows/` holds `binary-macos.yml`, `build-containers.yml`,
`build-gg-ci-image.yml`, `build-service-images.yml`, `ci.yml`,
`deploy-docs.yml`, `publish-reference.yml`, `release-promote.yml` and
`release.yml`. `scripts/ci/README.md` describes GitHub Actions as the secondary
CI that owns macOS validation, the Pages deploys and the images.

The `azure-staging` and `azure-prod` overlays, the dispatcher's defaults for
`TCAB_CONTAINER_REGISTRY`, and core's run-image resolution all name
`ghcr.io/theclockwyrks`. The cut-a-release quickstart and guide drive releases
through `gh`.

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

- [ ] `.github/` holds the mirror README and nothing else.
- [ ] `scripts/ci/README.md` and `development/building.md` name Azure Pipelines
      as the only CI.
- [ ] A search of the checkout for `ghcr.io` and `gh workflow` finds nothing.
- [ ] A run launched on a cluster deployed from the ACR pulls its run-container
      image from the ACR by default.
- [ ] Gates green.
