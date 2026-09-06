---
title: Releasing
---

This page covers cutting a release of the downloadable binaries and the desktop
app, and the one-time configuration behind the project's deployed static sites.
For the whole `vX.Y.Z` sequence these workflows sit inside — preparing the
release on `nightly`, rehearsing it on staging, and landing the catalog and the
services in production afterwards — see
[Cutting a Release](/guides/devops/cutting-a-release/) and its
[quickstart](/quickstarts/devops/cut-a-release/). Standing the always-on services
up as staging or production environments is covered by
[Deployment](/deployment/overview/); running them on your own machine is covered
by [Running](/development/running/); building locally is covered by
[Building](/development/building/).

## Releasing the binaries and desktop app

Public releases are cut on GitHub, driven by two manual workflows so artifacts
are tested before they reach users.

1. Run the Release workflow (`.github/workflows/release.yml`,
   `workflow_dispatch`) with the version tag, for example `v0.1.0`. For Linux
   (static musl, see
   [Portable builds](/development/building/#portable-static-builds)), Windows,
   and macOS it builds:
   - the headless binaries as archives, covering the `tcab` CLI, the
     `tcab-backend` store/API, and the `tcab-dispatcher`, `tcab-driver`, and
     `tcab-artifacts` services, smoke-testing each platform's `tcab` with
     `scripts/ci/smoke-binary.sh`;
   - [`gg`](/gg/overview/), the in-container coding harness, as a bare
     static-musl executable for `x86_64` and `aarch64`, plus gg's reference
     documents as one arch-independent `gg-reference-<version>.tar.gz` (see
     [Releasing `gg`](#releasing-gg));
   - the [Tauri desktop app](/components/tauri/overview/) as the platform's
     installer: a `.deb` on Linux, a `.dmg` on macOS, an `.msi` and an NSIS
     `.exe` on Windows.

   It publishes everything, with a `SHA256SUMS`, to a GitHub prerelease at
   that tag. Re-running for the same tag refreshes its assets.

2. Download the prerelease artifacts and exercise them.
3. Run the Release (promote) workflow
   (`.github/workflows/release-promote.yml`) with the same tag to flip the
   prerelease into the latest full release. It rebuilds nothing, so the artifacts
   you tested are the ones published.

The per-platform `tcab` smoke check is the same `scripts/ci/smoke-binary.sh` the
CI binary job runs, so the CLI is validated continuously and again on the shipped
artifact. The services and the desktop app are exercised by hand from the
prerelease.

Both halves of the desktop app are compiled and tested on every change by
`scripts/ci/desktop-build.sh`, on Linux and Windows in Azure and on the same
`ubuntu-22.04` image `release.yml` bundles on in GitHub. `release.yml` builds the
desktop UI through the root `build:packages` script, which is the single source
of truth for which workspace packages the UI's typecheck resolves its imports
against. The macOS desktop app is the one artifact a release is first to build,
because no Azure agent can build it.

### Releasing `gg`

[`gg`](/gg/overview/) is fetched by a running deployment into a run container
rather than downloaded by a person, and its release job encodes three
consequences of that.

Two architectures, both native. `core`, running in the driver, picks the
asset triple from its own architecture, so an arm64 deployment asks for
`gg-aarch64-unknown-linux-musl` and an amd64 one for the `x86_64` asset. Each leg
builds on a runner of that architecture via `scripts/build-gg-static.sh`, the
same script the driver image runs to bake gg in, so the release asset and the
image's binary come off one build path.

A bare executable. The install inside a run container is a
single `curl` of
`https://github.com/<owner>/<repo>/releases/download/v<version>/gg-<target>`
(`core::gg_exec::release_asset_url`), so the asset is uploaded under exactly that
name with no packaging around it.

The crate version is the release version. `gg --version` is read out of the
run container and recorded as a run's `subject.harnessVersion`, and `core`
derives the release tag it fetches from its own package version. Bump both
`crates/gg` and `crates/core` to the release version before running the workflow.
A test pins them to each other, and the `gg` job fails the release when the tag
and the binary's reported version disagree.

A prerelease tag such as `v0.7.0-rc1` equals no crate version, so nothing
resolves it by default. Point a deployment at one explicitly with
`TCAB_GG_RELEASE_VERSION=0.7.0-rc1`.

#### `gg-reference-<version>.tar.gz`

The same job publishes the reference documents `tcab-backend` serves at
`GET /gg/reference` and `GET /gg/reference/{language}`: `index.json` plus one
document per program language, projected by the freshly built `gg` itself
(`gg reference --out`). The backend reads them from disk because it must not link
`test-cabinet-gg`.

A backend deployed from these tarballs rather than from the container image needs
this asset unpacked too:

```sh
tar -xzf gg-reference-v0.7.0.tar.gz -C /srv/test-cabinet
# then, in the backend's environment:
TCAB_GG_REFERENCE=/srv/test-cabinet/gg-reference
```

Without it the backend starts, serves everything else, logs one warning at boot,
and answers `503` on the two reference endpoints, so the console's gg Reference
section is the only thing that degrades. The container images need none of this:
the backend image bakes the identical files at `/opt/gg-reference` and sets the
variable itself.

It is a single asset built on the `x86_64` leg alone, with no triple in its name,
because the content is JSON projected from data compiled into gg and is identical
on every platform.

### The audio store a released driver needs

A driver stages each run's declared [audio packs](/components/core/execution/#staged-audio)
into the run container out of a host audio store, so a `tcab-driver` (or `tcab`)
deployed from these tarballs rather than from the driver image needs one on disk:

```sh
scripts/fetch-audio-store.sh /srv/test-cabinet/audio-store
# then, in the driver's environment:
TCAB_AUDIO_STORE=/srv/test-cabinet/audio-store
```

The script pulls the public `test-cabinet-audio-store` image and copies the tree
out of it, so it needs no audio credential. Without a store, a run whose case
declares packs fails at container start naming both the path and the script;
end-to-end, adversarial, and performance runs are unaffected. The `tcab-driver`
container image needs none of this: it copies the same tree in at
`/opt/tcab-audio`, which is where the driver looks by default.

### macOS code signing

The macOS `.dmg` is neither code-signed nor notarized: the Release workflow
builds it with a bare `cargo tauri build`. macOS therefore marks a downloaded app
with the `com.apple.quarantine` attribute, and Gatekeeper refuses to launch it,
reporting "“The Test Cabinet” is damaged and can't be opened. You should move it
to the Trash." The app is unsigned rather than corrupt, and the symptom is most
pronounced on Apple Silicon.

The prerelease notes carry the workaround, which is to clear the quarantine
attribute once after installing:

```sh
xattr -dr com.apple.quarantine "/Applications/The Test Cabinet.app"
```

`xattr` is more reliable than right-click Open, which Gatekeeper withholds for
the "damaged" state on Apple Silicon. Signing with a Developer ID Application
certificate and notarizing the `.dmg` in the workflow removes the step; Tauri
reads `APPLE_CERTIFICATE`/`APPLE_SIGNING_IDENTITY` and the notarization
credentials from the environment.

## Static-site topology

The project deploys three static sites, all on Cloudflare Pages. Each is its own
Pages project under its own domain, built elsewhere and pushed with `wrangler`
as a Direct Upload project.

| Site                                                                             | Project                   | Address                         | Built by                                        |
| -------------------------------------------------------------------------------- | ------------------------- | ------------------------------- | ----------------------------------------------- |
| [Docs](/components/docs/overview/) (`apps/docs`)                                 | `test-cabinet-docs`       | `docs.testcabinet.ai`           | GitHub Actions → `wrangler` (`deploy-docs.yml`) |
| Per-run playable builds                                                          | `test-cabinet-runs`       | a per-run `*.pages.dev` URL     | `tcab publish` → `wrangler`                     |
| [Reference implementations](/components/core/results/#reference-implementations) | `test-cabinet-references` | a per-variant `*.pages.dev` URL | `tcab publish-reference` → `wrangler`           |

The [gallery](/components/site/overview/) is served by an origin rather than
built as a static site; see [Public Gallery](/deployment/public-gallery/).

Per-run builds are served from the root of their own `pages.dev` subdomain (see
[Site Hosting](/components/site/overview/#hosting) and
[Results](/components/core/results/#publish)). Serving each at a root rather than
a subpath keeps it playable exactly as the test case's
[build interface](/testing/end-to-end/overview/#design-requirements) requires.

Every Pages project is served from `*.pages.dev` or a subdomain, so no
`*.testcabinet.ai` wildcard or organization domain verification is required.

Each per-run build is deployed under its own Cloudflare Pages branch alias
(`--branch=<run-id>`), and the served URL is read back from `wrangler`'s output
rather than constructed, because Cloudflare sanitizes and truncates long
branch-alias subdomains.

## Docs (Cloudflare Pages, one-time)

The developer docs (`apps/docs`) deploy to Cloudflare Pages at
`docs.testcabinet.ai`, driven by `.github/workflows/deploy-docs.yml`. The deploy
target follows the branch: `master` publishes to `test-cabinet-docs` and
`staging` to `test-cabinet-docs-staging`. It is a pure static build with no Rust
step.

- Create a Direct Upload Pages project named `test-cabinet-docs`, matching
  `--project-name` in the deploy workflow, with its production branch set to
  `master`.
- Add `docs.testcabinet.ai` as a custom domain on that project, with a
  `docs.testcabinet.ai` CNAME pointing at `test-cabinet-docs.pages.dev`.
- Create a Cloudflare API token with the "Cloudflare Pages: Edit" permission and
  note the account ID. Add both to the repository as the GitHub Actions secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Per-run builds (Cloudflare Pages)

A [publish](/guides/devops/publishing-a-test-run-result/) deploys each run's
static build to Cloudflare Pages under a per-run branch alias
(`--branch=<run-id>`), served at the `*.pages.dev` URL `wrangler` reports and
embedded by the gallery from there. This is the operator's half of a publish, so
the operator holds the Cloudflare credentials it uses (see
[CLI Authentication](/components/cli/overview/#authentication)). Beyond those
credentials there is nothing to configure, and builds served from `pages.dev`
need no custom DNS.

## Reference implementations (Cloudflare Pages, one-time)

A [reference implementation](/components/core/results/#reference-implementations)
is a test-case variant's authored, correct static build, deployed out-of-band by
`tcab publish-reference` to its own Cloudflare Pages project. Its served URL is
written into a committed lockfile (`test-cases/reference-builds.lock.json`)
rather than pushed to the backend, because the backends are VPN-only; the backend
ingests it from its own checkout on the next
[`scripts/reingest-cluster.sh`](/deployment/overview/). The operator workflow,
prerequisites, and the release gate live in the
[reference-implementation guide](/guides/devops/publishing-a-reference-implementation/).

- Create two Direct Upload Pages projects: `test-cabinet-references` for
  production and `test-cabinet-references-staging` for staging.
  `tcab publish-reference` picks between them with its required `--env` flag, so
  a publish always names its target. Neither needs a custom domain: each variant
  is served from the `*.pages.dev` URL `wrangler` reports, under a per-variant
  branch alias (`<slug>-<version-with-dots-as-dashes>-<variant>`), and that URL is
  read back from `wrangler` rather than constructed.
- Both reuse the same `CLOUDFLARE_API_TOKEN` ("Cloudflare Pages: Edit") and
  `CLOUDFLARE_ACCOUNT_ID` as the docs deploy. They are the only secrets involved,
  since there is no backend push. The
  [`publish-reference.yml`](/guides/devops/publishing-a-reference-implementation/#from-ci)
  `workflow_dispatch` job derives its environment from the branch (`master` →
  prod, `staging` → staging), deploys, and commits the updated lockfile back to
  the branch, which needs `contents: write`. An operator then runs
  `scripts/reingest-cluster.sh --env <env>` from a VPN-connected machine.

The lockfile holds a URL per environment, keyed by environment first. Each
backend reads only its own environment's entries, selected by its `TCAB_ENV`, so
one file serves both.
