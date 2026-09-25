# Cut v0.7.0 through the Azure release route

Ship v0.7.0 as the first release that goes out entirely through the Azure
pipeline: gates, mirror, images, and deploys on Azure, with the tag mirrored to
GitHub afterwards.

This issue depends on every other release-blocking issue in this folder:
[the port](done/port-the-gg-and-tooling-changes-from-the-spec-cabinet-branch-onto-feat-gg.md),
[the baselines move](done/move-validation-baselines-into-the-cold-storage-submodule.md),
[the history rewrite](rewrite-the-repository-history-without-baselines-and-wasm-blobs.md),
[the submodule addressing](done/address-submodules-by-relative-url-and-mirror-them-to-github.md),
[the desktop drop](done/drop-the-desktop-app.md),
[the gallery design pages](move-the-gallery-origin-design-pages-onto-the-share-links-branch.md),
[the Azure CI/CD](done/build-ci-cd-on-azure-pipelines-with-deploys-to-staging-and-prod.md),
[the gg binaries](done/publish-gg-release-binaries-to-azure-blob-storage.md), and
[the GitHub retirement](done/retire-the-github-workflows-and-ghcr.md).

## Current state

The cut-a-release quickstart, the cutting-a-release guide and
`development/releasing.md` describe the Azure release route: `rel/vX.Y.Z` into
`nightly`, `nightly` into `staging` as an rc, `staging` into `master`, then a
`vX.Y.Z` tag on `master` whose pipeline run publishes `tcab` as the
`tcab-linux` and `tcab-windows` artifacts, uploads gg, and mirrors the tag. No
release has been cut through that route yet.

`rel/v0.7.0` is recreated from `feat/gg` and holds the v0.7.0 changelog page,
registered in the sidebar. `crates/gg` and `crates/core` carry version `0.7.0`.
The reference implementations of every non-experimental case version are
published to prod and recorded in the lockfile, with their baselines recaptured
into cold-storage.

The history rewrite has not run: every branch still reaches the baseline
blobs, and the GitHub mirror holds the `v0.3.2` to `v0.6.3` tags that Azure
lacks, so the rewrite fetches and rewrites those too. It has to land before the
pipeline's mirror job pushes `nightly` or `staging`, or the unrewritten pack
goes to GitHub.

## Design

### Prepare

Recreate `rel/v0.7.0` from `feat/gg` once the other issues have landed. Write
`apps/docs/src/content/docs/changelogs/v0.7.0.md` with the title
`v0.7.0 (YYYY-MM-DD)` and register it in `apps/docs/astro.config.mjs` newest
first. It covers gg, the test-case and validator rework, the validation
baselines in cold-storage, the desktop app's removal, and the Azure release
route.

Run the reference-implementation release gate from the quickstart, so every
non-experimental variant that declares a `reference_implementation` has a prod
entry in `test-cases/reference-builds.lock.json`.

### Land

Merge `rel/v0.7.0` into `nightly`, then `nightly` into `staging`. The pipeline
deploys `staging` to the staging cluster and the backend's ingest sidecar
re-ingests the catalog when its pod restarts. Rehearse real runs of the cases
that changed and review one end to end; fixes go onto `nightly` and return as
the next rc. Merge `staging` into `master`, which the pipeline deploys to prod
the same way.

Tag `v0.7.0` on `master` in Azure. The mirror job pushes the tag to GitHub, and
the pipeline's version gate checks that the built `gg --version` reports the
tag's version.

### Document the route

Correct the cut-a-release quickstart, the cutting-a-release guide, and
`development/releasing.md` wherever the release as followed differs from what
they describe.

## Done when

- [x] `rel/v0.7.0` is recreated from `feat/gg` and holds the changelog page,
      registered in the sidebar.
- [x] The reference-implementation gate passes on the release branch.
- [ ] `staging` deployed automatically, was rehearsed with real runs, and
      `master` deployed automatically to prod.
- [ ] The `v0.7.0` tag exists on Azure and on the GitHub mirror at the same
      commit.
- [ ] Prod serves the v0.7.0 catalog.
- [ ] The quickstart, the guide, and `development/releasing.md` describe the
      route that was actually followed.
- [ ] Gates green.
