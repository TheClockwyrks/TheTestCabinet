---
title: Releasing
---

This page covers cutting a release of the downloadable binaries and the desktop
app, and the one-time configuration behind the project's three deployed
**static** sites. It is the release-time half of shipping the project: the
downloadable artifacts and the CI-built sites. For the *whole* `vX.Y.Z` sequence
these workflows sit inside — preparing the release on `nightly`, rehearsing on
staging, and landing the catalog and the services in production afterwards — see
[Cutting a Release](/guides/devops/cutting-a-release/) (and its
[quickstart](/quickstarts/devops/cut-a-release/)). Standing up the always-on
**services** — the
[backend](/components/backend/overview/), the run-queue
[dispatcher](/components/dispatcher/overview/), and the per-run
[driver](/components/driver/overview/) `Job`s it creates — as staging or production environments
is covered separately under [Deployment](/deployment/overview/), and running any
of this on your own machine is covered under [Running](/development/running/).
For building locally see [Building](/development/building/); for what a *run*
publishes (its source repository and playable build) see
[Results](/components/core/results/) and
[Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/). For
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
   - the three headless binaries — the `tcab` CLI, the `tcab-driver` run executor, and
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

### macOS: the desktop app is unsigned

The macOS `.dmg` is **not yet code-signed or notarized** — the Release workflow
builds it with a bare `cargo tauri build` and there is no Apple Developer ID
certificate or notarization step. Because of that, when a user downloads the app
macOS marks it with the `com.apple.quarantine` attribute and Gatekeeper refuses
to launch it, reporting *"“The Test Cabinet” is damaged and can't be opened. You
should move it to the Trash."* This message is misleading: the app is not
corrupt, it is simply unsigned, and the symptom is most pronounced on Apple
Silicon (the `macos-aarch64` build).

Until Developer ID signing + notarization is wired into the Release workflow, the
download is opened by clearing the quarantine attribute once after installing —
this is the workaround included in the prerelease notes:

```sh
xattr -dr com.apple.quarantine "/Applications/The Test Cabinet.app"
```

(`xattr` is more reliable than right-click → **Open**, which Gatekeeper does not
offer for the "damaged" state on Apple Silicon.) The durable fix is to sign with
a Developer ID Application certificate and notarize the `.dmg` in the workflow
(Tauri reads `APPLE_CERTIFICATE`/`APPLE_SIGNING_IDENTITY` and the notarization
credentials from the environment); that has not been set up yet.

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
| [Reference implementations](/components/core/results/#reference-implementations) | `test-cabinet-references` | a per-variant `*.pages.dev` URL | `tcab publish-reference` → `wrangler` |

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
[Results](/components/core/results/#publish)); serving each at a root rather
than a subpath keeps it playable exactly as the test case's
[build interface](/testing/end-to-end/overview/#design-requirements) requires.

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
- **Build command:** `npm ci && npm run build:site`. The `build:site` root
  script builds the site's transitive workspace runtime packages in dependency
  order before the site itself — `run-record`, then `voxel-runtime` and
  `particle-runtime` (whose types the `ui` package imports and which publish
  types only from their built `dist/`), then `apps/site`. Building the site alone
  fails to resolve those runtime modules on a clean checkout, so keep this list in
  the root script (not inlined here) as the single source of truth when `ui` gains
  another workspace runtime dependency.
- **Build output directory:** `apps/site/dist`.
- The build is **pure Node** — Cloudflare's build image has no Rust, and none is
  needed. The model catalog is no longer a release artifact: it is owned by the
  backend and baked into the public R2 snapshot (as `models.json`, pointed to by
  the snapshot `index.json`'s `modelsKey`), which the site consumes at runtime.
  Model curation and refreshed prices reach the gallery through the next snapshot
  publish, not a repo commit and rebuild.
- Add `testcabinet.ai` as a **custom domain** on the project (apex), so the
  gallery is served from the apex.
- Nothing to configure for **client-side routing**, and nothing to add: because
  the build ships **no `404.html`**, Pages answers an unmatched path with
  `/index.html` at the requested URL with a `200`, which is exactly the SPA
  fallback the gallery needs. This is what makes a run page shareable and
  indexable — a deep link that 404s is invisible to every crawler. Do **not** add
  a `/* /index.html 200` rule to `_redirects`: Pages rejects it as an infinite
  loop and ignores it. `apps/site/public/_redirects` is kept, with no rules, to
  say so.
- Nothing to configure for **client-side routing**: `apps/site/public/_redirects`
  ships a `/* /index.html 200` rule, so a deep link such as `/runs/<id>` is
  rewritten to the app shell and answered `200` at its own URL. This is what makes
  a run page shareable and indexable — without it every deep link is an HTTP 404
  to a crawler. Existing static assets are matched first, so the build's per-run
  `/runs/<id>.json` and `/run-events/<id>.json` assets are unaffected.
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
`.github/workflows/deploy-docs.yml`. They are a pure static build with no Rust
step.

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

A [publish](/guides/devops/publishing-a-test-run-result/) deploys each run's static
build to Cloudflare Pages under a per-run branch alias (`--branch=<run-id>`),
served at the `*.pages.dev` URL `wrangler` reports and embedded by the gallery
from there. This is the operator's half of a publish, so the operator holds the
Cloudflare credentials it uses (see
[CLI Authentication](/components/cli/overview/#authentication)); there is no
shared infrastructure to configure beyond those credentials, and because builds
are served from `pages.dev` they need no custom DNS.

## Reference implementations (Cloudflare Pages, one-time)

A [reference implementation](/components/core/results/#reference-implementations) —
a test-case variant's authored, correct static build — is deployed out-of-band by
`tcab publish-reference` to its own Cloudflare Pages project, the case-variant
analogue of a per-run build. Unlike a per-run build, its served URL is **not** pushed
to the backend: the backends are private (VPN-only), so `publish-reference` writes
the URL into a committed lockfile (`test-cases/reference-builds.lock.json`) and the
backend **ingests** it from its own checkout on the next
[`scripts/reingest-cluster.sh`](/deployment/overview/) — the same pull path that
refreshes catalog edits. The full operator workflow, prerequisites, and the non-experimental
**release gate** (every reference-capable case must ship a reference by the release
that makes it non-experimental) live in
[Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/).

- In the Cloudflare dashboard, create two **Direct Upload** Pages projects:
  `test-cabinet-references` (prod) and `test-cabinet-references-staging` (staging).
  `tcab publish-reference` picks between them with its **required** `--env`
  flag — `--env prod` deploys to the former, `--env staging` to the latter — so a
  publish can never silently land in front of the public gallery. Neither needs a
  custom domain: each variant is served from the `*.pages.dev` URL `wrangler`
  reports, under a per-variant branch alias
  (`<slug>-<version-with-dots-as-dashes>-<variant>`), and the served URL is read
  back from `wrangler` rather than constructed.
- Both reuse the same `CLOUDFLARE_API_TOKEN` (*Cloudflare Pages: Edit*) and
  `CLOUDFLARE_ACCOUNT_ID` as the docs deploy — the **only** secrets involved, since
  there is no backend push. The
  [`publish-reference.yml`](/guides/devops/publishing-a-reference-implementation/#from-ci)
  `workflow_dispatch` job derives its environment from the branch (`master` → prod,
  `staging` → staging), deploys, and commits the updated lockfile back to the branch
  (so it needs `contents: write`). It does not re-ingest — an operator runs
  `scripts/reingest-cluster.sh --env <env>` from a VPN/az machine afterward.

> **One lockfile, both environments.** Prod and staging deploy to different Pages
> projects, so the committed lockfile holds a URL per environment, keyed by env
> first. Each backend reads only its own environment's entries, selected by its
> `TCAB_ENV` (`prod`/`staging`), so the one file serves both without a per-branch
> divergence.
