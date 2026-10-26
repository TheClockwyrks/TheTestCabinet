---
title: Releasing
---

This page covers what a version tag releases from each repository, `tcab`,
[`gg`](/gg/overview/), the operator client and the microservice images, and
the one-time configuration behind the project's deployed static sites. For
the whole `vX.Y.Z` sequence the tags sit inside, from preparing the release on
`nightly` and rehearsing it on staging to landing the catalog and the services
in production, see [Cutting a Release](/guides/devops/cutting-a-release/) and
its [quickstart](/quickstarts/devops/cut-a-release/). Standing the always-on
services up as staging or production environments is covered by
[Deployment](/deployment/overview/); running them on your own machine is
covered by [Running](/development/running/); building locally is covered by
[Building](/development/building/).

## Release tags

A release is a `vX.Y.Z` tag on a repository's `master` in Azure Repos. The
tag runs that repository's own pipeline (see
[A repository's gates and pipeline](/development/repositories/#a-repositorys-gates-and-pipeline)):
the gates, then the publish of every public package of its workspace to the
feed at the tag's version, then the release jobs of its kind, then the mirror
of the tag to GitHub. A tag's pins are not kept, so a tag whose run failed is
followed by a patch tag on a commit carrying current pins.

| Repository | What its tag releases |
| --- | --- |
| `contracts`, `engines`, `ui-common`, every `tool-*` | Its packages, to the feed; its crates, at the tag its dependents pin |
| `microservice-driver` | `tcab`, as pipeline artifacts |
| `gg` | gg's binaries and reference, to the release container |
| `client-tauri` | The operator client's bundles, as pipeline artifacts |

The microservice images and the static sites ship from `master` and `staging`
on every gated push, so a tag releases no service or site of its own.

## Releasing `tcab`

`tcab` is the second binary of `microservice-driver`. Its pipeline
release-builds it, runs the suite in the release profile, and smoke-tests the
produced binary with `scripts/ci/smoke-binary.sh`, on every run. A tag's run
publishes that smoke-tested binary as a pipeline artifact:

| Artifact       | Contents                  |
| -------------- | ------------------------- |
| `tcab-linux`   | `tcab` for Linux `x86_64` |
| `tcab-windows` | `tcab.exe` for Windows    |

The tag's run is where a release of `tcab` is downloaded from. Every other
platform builds `tcab` from source in the `microservice-driver` checkout with
`cargo build --release -p test-cabinet-driver --bin tcab`.

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

gg's pipeline uploads all three on every `v*` tag. Its `gg_amd64` and
`gg_arm64` jobs build the binaries natively with `scripts/ci/gg-dist.sh`,
which runs `scripts/build-gg-static.sh` and then projects and packs the
documents. Each job publishes its binary and its tarball as one `gg-<arch>`
artifact, which the run-image self-check consumes, so the release objects and
the self-check's copy come off one build. The `gg_publish` job then runs
`scripts/ci/publish-gg.sh` under the `tcab-gg-publish` service connection, a
workload-identity-federated identity holding Storage Blob Data Contributor on
the account. The version prefix is what the `x86_64` binary reports, and each
upload is read back without credentials.

A bare executable. The install inside a run container is a single `curl` of
`<base>/v<version>/gg-<target>`, so the object is uploaded under exactly that
name with no packaging around it. The base defaults to the container's URL and
`TCAB_GG_RELEASE_URL` overrides it. The driver picks the target from its own
architecture, so an arm64 deployment asks for `gg-aarch64-unknown-linux-musl`
and an amd64 one for the `x86_64` object; `TCAB_GG_RELEASE_TARGET` overrides
it.

The crate version is the release version. `gg --version` is read out of the
run container and recorded as a run's `subject.harnessVersion`. On a tag, gg's
release jobs fail when `gg --version` differs from the tag with its `v`
stripped, naming the crate to bump, and `publish-gg.sh` runs the same check
before it uploads anything.

The version a deployment runs is pinned once, in `microservice-driver`,
independent of any crate version. The driver image fetches that release at
build time, and `TCAB_GG_RELEASE_VERSION` overrides the pin on a deployment,
which is how a prerelease tag such as `v0.7.0-rc1` is tried.

### `gg-reference.tar.gz`

The same upload publishes the reference documents `tcab-backend` serves at
`GET /gg/reference` and `GET /gg/reference/{language}`: `index.json` plus one
document per program language, projected by the freshly built `gg` itself
(`gg reference --out`). The backend reads them from the directory
`TCAB_GG_REFERENCE` names, because it links nothing of gg's. The backend image
fetches the tarball of the version the driver pins from the release container
at build time, unpacks it at `/opt/gg-reference` and sets the variable itself,
so a deployed console's reference and the harness its runs execute describe
one release.

Without them the backend starts, serves everything else, logs one warning at
boot, and answers `503` on the two reference endpoints, so the console's gg
Reference section is the only thing that degrades.

It is a single object with no triple in its name, because the content is JSON
projected from data compiled into gg and is identical on every platform. Both
architectures project and pack it, so `gg reference --out` is gated on each;
the upload takes the `x86_64` one by name.

## Releasing the operator client

[`client-tauri`](/components/client/overview/) is a `shell`: a Tauri v2
workspace whose shell loads the console's URL in a WebView, with `prod` and
`staging` as build flavors differing in that URL alone. A tag's run builds a
bundle per target and publishes each as a pipeline artifact of the run:

| Artifact         | Contents                                    |
| ---------------- | ------------------------------------------- |
| `client-windows` | The Windows installer, both flavors         |
| `client-linux`   | The Linux AppImage and `.deb`, both flavors |
| `client-macos`   | The macOS app bundle, both flavors          |
| `client-android` | The Android APK, both flavors               |

Each artifact holds one directory per flavor, `prod/` and `staging/`, built
from the flavor's `tauri.<flavor>.conf.json`. The Android bundle and the Linux
bundle are built in the `android` CI image track the kit renders for the
`shell` kind; the Windows and macOS bundles on hosted agents of those
platforms. The tag's run is where a release of the client is downloaded from.

No bundle carries a publisher's signature. The desktop bundles are unsigned,
so an installer asks the platform's usual question about an unknown publisher.
The Android APK is the release build signed with the debug key the build
machine's Android SDK creates, and it is installed by sideloading. Each build
machine holds its own debug key, so Android installs a later APK over an
earlier one only once the earlier one is removed.

## The microservice images

Each `microservice-*` repository's pipeline builds its image on every gated
push to `master` and `staging`, natively per architecture and fused by
`scripts/ci/manifest.sh` into the multi-arch `<name>:<commit>` a deployment
pins, and pushes it to `testcabinet.azurecr.io`. `console.testcabinet.ai`'s
pipeline builds the console's image, nginx serving its `vite build` bundle,
the same way. `microservice-driver`'s run
also builds the run-container images under its `containers/`, each carrying
the binaries it copies from the `tool-*` images at the commits the driver
pins, and the `-gg` variants the toolchain tree of the gg release the driver
pins; see
[Checking gg's arms in a run image](/development/building/#checking-ggs-arms-in-a-run-image).

An environment's deploy set is its overlay with every image pinned to a
commit: each service's image at the commit the superrepo's submodule pointer
for that repository names, and the run images at `microservice-driver`'s.
`scripts/ci/pin-images.sh` writes the pins from the pointers, and the
superrepo's `deploy` and `prod` stages roll the environment's overlay onto the
set on every gated push to `staging` and `master`. Rolling a new image is
therefore a bump of that repository's pointer; see
[Rolling prod service images](/guides/devops/rolling-prod-service-images/).
The `k8s-deploy-sets` gate renders both sets and holds every image to the
registry and a full commit.

## Static-site topology

The project deploys five static sites, all on Cloudflare Pages. Each is its own
Pages project under its own domain, built elsewhere and pushed with `wrangler`
as a Direct Upload.

| Site | Project | Address | Built by |
| --- | --- | --- | --- |
| [Gallery](/components/site/overview/) (`testcabinet.ai`) | `the-test-cabinet` | `testcabinet.ai` (apex) | the `testcabinet.ai` pipeline, on `master` |
| [Docs](/components/docs/overview/) (`apps/docs`) | `test-cabinet-docs` | `docs.testcabinet.ai` | the superrepo pipeline's `docs` stage (`scripts/ci/deploy-docs.sh`) |
| Per-run playable builds | `test-cabinet-runs` | a per-run `*.pages.dev` URL | the [publisher](/components/backend/results/#publish) Job |
| [Reference implementations](/components/backend/results/#reference-implementations) | `test-cabinet-references` | a per-variant `*.pages.dev` URL | `tcab publish-reference` |
| [gg's public site](#ggrocks-cloudflare-pages-one-time) (`gg.rocks`) | `gg-rocks` | `gg.rocks` (apex) | the `gg.rocks` pipeline, on `master` |

The gallery reads the published dataset from the public bucket at runtime, so
a publish is an upload to the bucket and never a site build. Two Workers sit
beside it, deployed by the same pipeline: the `tcab.ai` share-link Worker and
the preview-tag Worker in front of the gallery's run routes; see
[Serving](/components/site/serving/).

Per-run builds are served from the root of their own `pages.dev` subdomain (see
[Site Hosting](/components/site/overview/#hosting) and
[Results](/components/backend/results/#publish)). Serving each at a root rather
than a subpath keeps it playable exactly as the test case's
[build interface](/testing/end-to-end/overview/#design-requirements) requires.

## Gallery (Cloudflare Pages and Workers, one-time)

The `testcabinet.ai` pipeline builds the gallery on every gated push and
deploys it with `wrangler pages deploy`: `master` to `the-test-cabinet`, served
at `testcabinet.ai`, and `staging` to `the-test-cabinet-staging`, served at
`staging.testcabinet.ai`. The build is pure Node and bakes in nothing of the
dataset: the page reads `index.json` and the objects it points at from the
[public bucket](/components/backend/snapshot/) in the browser, so a published
run appears without a build.

In the Cloudflare dashboard:

- Create two Direct Upload Pages projects, `the-test-cabinet` with `master` as
  its production branch and `the-test-cabinet-staging` with `staging`. The
  pipeline passes the branch to `wrangler` as `--branch`, so each upload is its
  project's production deployment.
- Add `testcabinet.ai` as a custom domain on `the-test-cabinet` and
  `staging.testcabinet.ai` on the staging project.
- Set the public bucket's read URL on the pipeline as `TCAB_SNAPSHOT_URL`,
  per branch, which the build writes into the page as the dataset's origin.
  The pipeline definition holds the two as `TCAB_SNAPSHOT_URL_MASTER` and
  `TCAB_SNAPSHOT_URL_STAGING`, and the deploy stage hands the build the one
  its branch names.
- Create the R2 buckets `tcab-snapshot` and `tcab-snapshot-staging`, with the
  custom domains `snapshot.testcabinet.ai` and `snapshot.staging.testcabinet.ai`.
  On each custom domain add a cache rule that makes every response eligible for
  cache, takes the edge TTL from the origin's `Cache-Control`, and sets the
  status-code TTL of a 404 to no-store, so the headers the artifacts service
  stores on each object decide its caching and a miss is never held.
- Add the `tcab.ai` zone. The pipeline deploys the two Workers from the same
  repository with `wrangler deploy`: the share-link Worker, bound to the
  production bucket at the custom domain `tcab.ai`, with `staging.tcab.ai` over
  the staging bucket; and the preview-tag Worker, bound to the same bucket and
  routed on the gallery's run routes. The deploy creates each route and custom
  domain.
- Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on the pipeline, a
  token holding "Cloudflare Pages: Edit" and "Workers Scripts: Edit" on the
  account, and "Workers Routes: Edit" and "DNS: Edit" on the `testcabinet.ai`
  and `tcab.ai` zones.

Every other project is served from `*.pages.dev` or a subdomain, so no
`*.testcabinet.ai` wildcard or organization domain verification is required.

Each per-run build is deployed under its own Cloudflare Pages branch alias
(`--branch=<run-id>`), and the served URL is read back from `wrangler`'s output
rather than constructed, because Cloudflare sanitizes and truncates long
branch-alias subdomains.

## Docs (Cloudflare Pages, one-time)

The developer docs (`apps/docs`) deploy to Cloudflare Pages at
`docs.testcabinet.ai` from the superrepo pipeline's `docs` stage, which runs
`scripts/ci/deploy-docs.sh` on every `master` and `staging` build that passed
the gates stage. The deploy target follows the branch: `master` publishes to
`test-cabinet-docs` and `staging` to `test-cabinet-docs-staging`. It is a pure
static build with no Rust step.

- Create Direct Upload Pages projects named `test-cabinet-docs`, with its
  production branch set to `master`, and `test-cabinet-docs-staging`, with its
  production branch set to `staging`. The script passes the branch to `wrangler`
  as `--branch`, so each upload is its project's production deployment.
- Add `docs.testcabinet.ai` as a custom domain on `test-cabinet-docs`, with a
  `docs.testcabinet.ai` CNAME pointing at `test-cabinet-docs.pages.dev`.
- Create a Cloudflare API token with the "Cloudflare Pages: Edit" permission and
  note the account ID. Set both on the superrepo pipeline as the secret
  variables `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## gg.rocks (Cloudflare Pages, one-time)

gg's public site is the `gg.rocks` repository, a site the kit renders that
names no package of the project. Its one input from the project is the `gg`
repository's documentation pages, read at the gg version it pins, from which it
presents gg. Its pipeline's `deploy` stage builds it and uploads it with
`wrangler pages deploy` on every `master` and `staging` build that passed the
gates stage: `master` to `gg-rocks`, served at `gg.rocks`, and `staging` to
`gg-rocks-staging`, served at `staging.gg.rocks`.

In the Cloudflare dashboard:

- Create two Direct Upload Pages projects, `gg-rocks` with `master` as its
  production branch and `gg-rocks-staging` with `staging`. The pipeline passes
  the branch to `wrangler` as `--branch`, so each upload is its project's
  production deployment.
- Add `gg.rocks` as a custom domain on `gg-rocks` and `staging.gg.rocks` on the
  staging project, each with a proxied CNAME in the `gg.rocks` zone pointing at
  its project's `pages.dev` host.
- Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on the `gg.rocks`
  pipeline as secret variables, a token holding "Cloudflare Pages: Edit".

## Per-run builds (Cloudflare Pages)

A [publish](/components/backend/results/#publish) deploys each run's static
build to Cloudflare Pages under a per-run branch alias (`--branch=<run-id>`),
served at the `*.pages.dev` URL `wrangler` reports and embedded by the gallery
from there. The per-publish `tcab-publisher` Job holds the Cloudflare
credentials it uses, from the Secret the dispatcher mounts into it (see
[Secrets](/deployment/overview/#secrets)). Beyond those credentials there is
nothing to configure, and builds served from `pages.dev` need no custom DNS.

## Reference implementations (Cloudflare Pages, one-time)

A [reference implementation](/components/backend/results/#reference-implementations)
is a test-case variant's authored, correct static build, deployed out-of-band by
`tcab publish-reference` to its own Cloudflare Pages project. Its served URL is
written into a committed lockfile in the `test-suites` repository
(`test-cases/reference-builds.lock.json`) rather than pushed to the backend,
and the backend ingests it from its own checkout on the next
[`tcab ingest --env <env>`](/components/cli/overview/#definitions). The
operator workflow, prerequisites, and the release gate live in the
[reference-implementation guide](/guides/devops/publishing-a-reference-implementation/).

- Create two Direct Upload Pages projects: `test-cabinet-references` for
  production and `test-cabinet-references-staging` for staging.
  `tcab publish-reference` picks between them with its required `--env` flag, so
  a publish always names its target. Neither needs a custom domain: each variant
  is served from the `*.pages.dev` URL `wrangler` reports, under a per-variant
  branch alias (`<slug>-<version-with-dots-as-dashes>-<variant>`), and that URL is
  read back from `wrangler` rather than constructed.
- Both reuse the same `CLOUDFLARE_API_TOKEN` ("Cloudflare Pages: Edit") and
  `CLOUDFLARE_ACCOUNT_ID` as the docs deploy. They are the only secrets
  involved, since there is no backend push. After committing the updated
  lockfile, an operator runs `tcab ingest --env <env> --changed` with the
  environment's Access service token (see
  [Pointing `tcab` at a deployment](/development/running/#pointing-tcab-at-a-deployment)).

The lockfile holds a URL per environment, keyed by environment first. Each
backend reads only its own environment's entries, selected by its `TCAB_ENV`, so
one file serves both.
