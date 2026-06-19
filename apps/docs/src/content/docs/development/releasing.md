---
title: Releasing
---

This page covers cutting a release of the downloadable binaries and the desktop
app, and the one-time configuration behind the project's three deployed
**static** sites. It is the release-time half of shipping the project: the
downloadable artifacts and the CI-built sites. Standing up the always-on
**services** — the
[backend](/components/backend/overview/) and
[workers](/components/worker/overview/) — as staging or production environments
is covered separately under [Deployment](/deployment/overview/), and running any
of this on your own machine is covered under [Running](/development/running/).
For building locally see [Building](/development/building/); for what a *run*
publishes (its source repository and playable build) see
[Results](/components/core/results/) and
[Publishing a Test Run Result](/guides/publishing-a-test-run-result/). For
pointing a deployed service's telemetry at a collector see
[Observability](/development/observability/#production-and-staging).

## Releasing the binaries and desktop app

Public releases are cut on **GitHub** (the Azure DevOps repository is private to
the org), driven by two manual workflows. The process is deliberately two-phase
so artifacts are tested before they reach users:

1. Run the **Release** workflow (`.github/workflows/release.yml`,
   `workflow_dispatch`) with the version tag (for example `v0.1.0`). For Linux
   (static musl — see
   [Portable builds](/development/building/#portable-static-builds)), Windows,
   and macOS it builds:
   - the three headless binaries — the `tcab` CLI, the `tcab-worker` server, and
     the `tcab-backend` store/API — as archives, smoke-testing each platform's
     `tcab` with `scripts/ci/smoke-binary.sh`;
   - the [Tauri desktop app](/components/tauri/overview/) as the platform's
     installer (a `.deb` on Linux, a `.dmg` on macOS, an `.msi` and an NSIS
     `.exe` on Windows).

   It then publishes everything — with a `SHA256SUMS` — to a GitHub
   **prerelease** at that tag. Re-running for the same tag refreshes its assets.
2. Download the prerelease artifacts and exercise them.
3. Once satisfied, run the **Release (promote)** workflow
   (`.github/workflows/release-promote.yml`) with the same tag to flip the
   prerelease into the latest full release. It does **not** rebuild, so the exact
   artifacts you tested are the ones published.

The per-platform `tcab` smoke check is the same `scripts/ci/smoke-binary.sh` the
CI binary job runs, so the CLI is validated both continuously (Azure, on Linux
and Windows) and again on the shipped artifact (the Release workflow, on every
platform). The worker and backend are servers and the desktop app is graphical,
so for those the build itself is the gate and they are exercised by hand from the
prerelease.

## Static-site topology

The project deploys three independent static sites. Two are project sites built
in CI; the third is the per-run playable builds produced by
[publishing](/guides/publishing-a-test-run-result/).

| Site | Host | Address | Driven by |
| ---- | ---- | ------- | --------- |
| [Gallery](/components/site/overview/) (`apps/site`) | GitHub Pages | `testcabinet.ai` (apex) | `deploy-site.yml` |
| [Docs](/components/docs/overview/) (`apps/docs`) | Cloudflare Pages | `docs.testcabinet.ai` | `deploy-docs.yml` |
| Per-run playable builds | Cloudflare Pages | a per-run `*.pages.dev` URL | `tcab publish` |

The gallery owns the apex on GitHub Pages, and GitHub Pages allows only one
custom domain per repository — which is why the docs are a **separate**
Cloudflare Pages deployment under their own subdomain rather than a path on the
gallery. Per-run builds are served from Cloudflare Pages at their own `pages.dev`
subdomain root (see [Site Hosting](/components/site/overview/#hosting) and
[Results](/components/core/results/#publishing)); serving each at a root rather
than a subpath keeps it playable exactly as the test case's
[build interface](/components/core/test-cases/#design-requirements) requires.

## Gallery (GitHub Pages, one-time)

The gallery is built and deployed by `.github/workflows/deploy-site.yml`, which
regenerates the bundled model dataset (`models.json`) from `models/` as part of
the build (so the deployed site always reflects current model prices) and
publishes the static output to GitHub Pages. The test-case and run data the
gallery shows are *not* baked in here — they come from the
[backend's public R2 snapshot](/components/backend/snapshot/), fetched at build
time. The workflow is dormant until the repository is mirrored to GitHub with
Pages enabled.

- Enable GitHub Pages on the gallery repository and point the apex
  `testcabinet.ai` at it, with the repository claiming it as its custom domain,
  so the site is served from the apex.

Because per-run builds now live on Cloudflare Pages (below) rather than on
per-run GitHub Pages subdomains, no `*.testcabinet.ai` wildcard or organization
domain verification is required for them.

Each per-run build is deployed under its own Cloudflare Pages **branch alias**
(`--branch=<run-id>`), and the served URL is read back from `wrangler`'s output
rather than constructed — Cloudflare sanitizes and truncates long branch-alias
subdomains, so the literal `<run-id>.<project>.pages.dev` is not a reliable host.

## Docs (Cloudflare Pages, one-time)

The developer docs (`apps/docs`) deploy to Cloudflare Pages at
`docs.testcabinet.ai`, separately from the gallery, driven by
`.github/workflows/deploy-docs.yml`. They are a pure static build with no
Rust/catalog step.

- In the Cloudflare dashboard, create a Pages project named `test-cabinet-docs`
  (this must match `--project-name` in the deploy workflow). Use a
  *Direct Upload* project — the build runs in GitHub Actions, not on
  Cloudflare — and set its production branch to `master`.
- Add `docs.testcabinet.ai` as a custom domain on that Pages project, with a
  `docs.testcabinet.ai` CNAME pointing at `test-cabinet-docs.pages.dev`.
- Create a Cloudflare API token with the *Cloudflare Pages: Edit* permission and
  note the account ID. Add both to the repository as the GitHub Actions secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Per-run builds (Cloudflare Pages)

A [publish](/guides/publishing-a-test-run-result/) deploys each run's static
build to Cloudflare Pages under a per-run branch alias (`--branch=<run-id>`),
served at the `*.pages.dev` URL `wrangler` reports and embedded by the gallery
from there. This is the operator's half of a publish, so the operator holds the
Cloudflare credentials it uses (see
[CLI Authentication](/components/cli/overview/#authentication)); there is no
shared infrastructure to configure beyond those credentials, and because builds
are served from `pages.dev` they need no custom DNS.
