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

The project deploys three independent static sites, all on **Cloudflare Pages**.
Each is its own Pages project under its own domain; they differ only in how they
are built.

| Site | Project | Address | Built by |
| ---- | ------- | ------- | -------- |
| [Gallery](/components/site/overview/) (`apps/site`) | `test-cabinet-site` | `testcabinet.ai` (apex) | Cloudflare (git-connected) |
| [Docs](/components/docs/overview/) (`apps/docs`) | `test-cabinet-docs` | `docs.testcabinet.ai` | GitHub Actions → `wrangler` (`deploy-docs.yml`) |
| Per-run playable builds | `test-cabinet-runs` | a per-run `*.pages.dev` URL | `tcab publish` → `wrangler` |

The docs and per-run builds are **Direct Upload** projects — built elsewhere and
pushed with `wrangler` — while the gallery is **git-connected**: Cloudflare clones
the GitHub mirror and builds it itself. The gallery is git-connected on purpose,
because it is the only site that must rebuild when something *other* than a code
push changes — the backend's snapshot. A git-connected project has a **deploy
hook** (a unique URL that triggers a rebuild on a bare POST), which is exactly
what the backend fires after it uploads a new snapshot (see
[`TCAB_SITE_DEPLOY_HOOK_URL`](#gallery-cloudflare-pages-one-time)). Direct Upload
projects have no deploy hook, so they could not be rebuilt that way.

Per-run builds are served from Cloudflare Pages at their own `pages.dev`
subdomain root (see [Site Hosting](/components/site/overview/#hosting) and
[Results](/components/core/results/#publishing)); serving each at a root rather
than a subpath keeps it playable exactly as the test case's
[build interface](/components/core/test-cases/#design-requirements) requires.

## Gallery (Cloudflare Pages, one-time)

The gallery is a **git-connected** Cloudflare Pages project: Cloudflare clones the
[GitHub mirror](#releasing-the-binaries-and-desktop-app) and builds `apps/site`
itself, on every push to the production branch and whenever its deploy hook is
fired. The test-case and run data the gallery shows are *not* baked in — they
come from the [backend's public R2 snapshot](/components/backend/snapshot/),
fetched at build time. There is no GitHub Actions workflow for it; Cloudflare's
git integration is the whole pipeline.

In the Cloudflare dashboard, create a Pages project named `test-cabinet-site`
(distinct from the `test-cabinet-docs` and `test-cabinet-runs` projects)
connected to the GitHub mirror:

- Set the **production branch** to `master`.
- **Build command:** `npm ci && npm run build -w @test-cabinet/run-record && npm run build -w @test-cabinet/site`.
- **Build output directory:** `apps/site/dist`.
- The build is **pure Node** — Cloudflare's build image has no Rust, and none is
  needed: the bundled model dataset (`packages/ui/src/app/data/models.json`) is
  committed, so the site builds against whatever prices are in the repo. Refresh
  them by running `tcab catalog` and committing the result (or with a scheduled
  job that does the same); a commit triggers a rebuild like any other push.
- Add `testcabinet.ai` as a **custom domain** on the project (apex), so the
  gallery is served from the apex.
- Create the project's **deploy hook** and give its URL to the backend as
  `TCAB_SITE_DEPLOY_HOOK_URL` (see [Deployment](/deployment/overview/)). The
  backend fires it after each snapshot upload, so a published run rebuilds the
  gallery without a code push.

Per-run builds and the docs are separate Cloudflare Pages projects; because every
build is served from `*.pages.dev` or a subdomain, no `*.testcabinet.ai` wildcard
or organization domain verification is required.

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
