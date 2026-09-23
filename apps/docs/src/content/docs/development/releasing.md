---
title: Releasing
---

This page covers releasing `tcab` and [`gg`](/gg/overview/) from a version
tag, and the one-time configuration behind the project's deployed static sites.
For the whole `vX.Y.Z` sequence the tag sits inside, from preparing the release
on `nightly` and rehearsing it on staging to landing the catalog and the
services in production, see
[Cutting a Release](/guides/devops/cutting-a-release/) and its
[quickstart](/quickstarts/devops/cut-a-release/). Standing the always-on services
up as staging or production environments is covered by
[Deployment](/deployment/overview/); running them on your own machine is covered
by [Running](/development/running/); building locally is covered by
[Building](/development/building/).

## Release tags

A release is a `vX.Y.Z` tag on `master` in Azure Repos. Pushing it runs the
[Azure pipeline](/development/building/#continuous-integration) for the tag:

- the gates, including the `binary` job on Linux and Windows and the gg version
  gate;
- `gg_publish`, which uploads gg's release objects;
- the `mirror` job, which pushes the tag to the GitHub mirror.

The services ship as the images the pipeline deploys from `master`, and the docs
site from the pipeline's `docs` job, so a tag releases no service or site of its
own.

The tag names the version of `gg`, so `crates/gg` and `crates/core` are bumped
to it before tagging; see [Releasing `gg`](#releasing-gg).

## Releasing `tcab`

The `binary` job release-builds `tcab` on Linux and Windows, runs the suite in
the release profile, and smoke-tests the produced binary with
`scripts/ci/smoke-binary.sh`. On a tag run it publishes that smoke-tested binary
as a pipeline artifact:

| Artifact       | Contents                  |
| -------------- | ------------------------- |
| `tcab-linux`   | `tcab` for Linux `x86_64` |
| `tcab-windows` | `tcab.exe` for Windows    |

The tag's pipeline run is where a release of `tcab` is downloaded from. Every
other platform builds `tcab` from source with `cargo build --release -p
test-cabinet-cli`.

## Releasing `gg`

[`gg`](/gg/overview/) is fetched by a running deployment into a run container
rather than downloaded by a person, so its release host is the Azure Blob
Storage container `gg-releases` in the storage account `testcabinetartifacts`.
The container allows anonymous blob read and no listing, so every object is
readable at a known URL under
`https://testcabinetartifacts.blob.core.windows.net/gg-releases/`. Each version
is laid out under its own prefix:

| Object                                     | Contents                                          |
| ------------------------------------------ | ------------------------------------------------- |
| `v<version>/gg-x86_64-unknown-linux-musl`  | The static-musl `gg` for `x86_64`                 |
| `v<version>/gg-aarch64-unknown-linux-musl` | The static-musl `gg` for `aarch64`                |
| `v<version>/gg-reference.tar.gz`           | gg's reference documents, identical on every arch |

The Azure pipeline uploads all three on every `master` build and every `v*` tag
build. The `gg_amd64` and `gg_arm64` gate jobs build the binaries natively with
`scripts/ci/gg-dist.sh`, which runs `scripts/build-gg-static.sh`, the same
script the driver image runs to bake gg in, so the release objects and the
image's binary come off one build path. The `gg_publish` job then runs
`scripts/ci/publish-gg.sh` under the `tcab-gg-publish` service connection, a
workload-identity-federated identity holding Storage Blob Data Contributor on
the account. The version prefix is what the `x86_64` binary reports, and each
upload is read back without credentials.

A bare executable. The install inside a run container is a single `curl` of
`<base>/v<version>/gg-<target>` (`core::gg_exec::release_asset_url`), so the
object is uploaded under exactly that name with no packaging around it. The base
defaults to the container's URL and `TCAB_GG_RELEASE_URL` overrides it. `core`,
running in the driver, picks the target from its own architecture, so an arm64
deployment asks for `gg-aarch64-unknown-linux-musl` and an amd64 one for the
`x86_64` object; `TCAB_GG_RELEASE_TARGET` overrides it.

The crate version is the release version. `gg --version` is read out of the
run container and recorded as a run's `subject.harnessVersion`, and `core`
derives the version it fetches from its own package version. Bump both
`crates/gg` and `crates/core` to the release version before tagging. A test pins
them to each other. On a tag build the gates fail when `gg --version` differs
from the tag with its `v` stripped, naming the two crates to bump, and
`publish-gg.sh` runs the same check before it uploads anything.

A prerelease tag such as `v0.7.0-rc1` equals no crate version, so nothing
resolves it by default. Point a deployment at one explicitly with
`TCAB_GG_RELEASE_VERSION=0.7.0-rc1`.

### `gg-reference.tar.gz`

The same upload publishes the reference documents `tcab-backend` serves at
`GET /gg/reference` and `GET /gg/reference/{language}`: `index.json` plus one
document per program language, projected by the freshly built `gg` itself
(`gg reference --out`). The backend reads them from the directory
`TCAB_GG_REFERENCE` names because it must not link `test-cabinet-gg`. The backend
image bakes the identical files at `/opt/gg-reference` and sets the variable
itself.

Without them the backend starts, serves everything else, logs one warning at
boot, and answers `503` on the two reference endpoints, so the console's gg
Reference section is the only thing that degrades.

It is a single object built on the `x86_64` leg alone, with no triple in its
name, because the content is JSON projected from data compiled into gg and is
identical on every platform.

## Static-site topology

The project deploys three static sites, all on Cloudflare Pages. Each is its own
Pages project under its own domain, built elsewhere and pushed with `wrangler`
as a Direct Upload project.

| Site                                                                             | Project                   | Address                         | Built by                                                      |
| -------------------------------------------------------------------------------- | ------------------------- | ------------------------------- | ------------------------------------------------------------- |
| [Docs](/components/docs/overview/) (`apps/docs`)                                 | `test-cabinet-docs`       | `docs.testcabinet.ai`           | the Azure pipeline → `wrangler` (`scripts/ci/deploy-docs.sh`) |
| Per-run playable builds                                                          | `test-cabinet-runs`       | a per-run `*.pages.dev` URL     | `tcab publish` → `wrangler`                                   |
| [Reference implementations](/components/core/results/#reference-implementations) | `test-cabinet-references` | a per-variant `*.pages.dev` URL | `tcab publish-reference` → `wrangler`                         |

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
`docs.testcabinet.ai` from the Azure pipeline's `docs` job, which runs
`scripts/ci/deploy-docs.sh` on every `master` and `staging` build that passed the
gates and the image builds. The deploy target follows the branch: `master`
publishes to `test-cabinet-docs` and `staging` to `test-cabinet-docs-staging`.
It is a pure static build with no Rust step.

- Create Direct Upload Pages projects named `test-cabinet-docs`, with its
  production branch set to `master`, and `test-cabinet-docs-staging`, with its
  production branch set to `staging`. The script passes the branch to `wrangler`
  as `--branch`, so each upload is its project's production deployment.
- Add `docs.testcabinet.ai` as a custom domain on `test-cabinet-docs`, with a
  `docs.testcabinet.ai` CNAME pointing at `test-cabinet-docs.pages.dev`.
- Create a Cloudflare API token with the "Cloudflare Pages: Edit" permission and
  note the account ID. Set both on the Azure pipeline as the secret variables
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
  since there is no backend push. After committing the updated lockfile, an
  operator runs `scripts/reingest-cluster.sh --env <env>` from a VPN-connected
  machine.

The lockfile holds a URL per environment, keyed by environment first. Each
backend reads only its own environment's entries, selected by its `TCAB_ENV`, so
one file serves both.
