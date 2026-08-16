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

The project deploys three independent static sites, all on **Cloudflare Pages**,
plus one **Worker** for the short domain. Each site is its own Pages project under
its own domain; they differ only in how they are built.

| Site | Project | Address | Built by |
| ---- | ------- | ------- | -------- |
| [Gallery](/components/site/overview/) (`apps/site`) | `the-test-cabinet` | `testcabinet.ai` (apex) | Cloudflare (git-connected) |
| [Docs](/components/docs/overview/) (`apps/docs`) | `test-cabinet-docs` | `docs.testcabinet.ai` | GitHub Actions → `wrangler` (`deploy-docs.yml`) |
| Per-run playable builds | `test-cabinet-runs` | a per-run `*.pages.dev` URL | `tcab publish` → `wrangler` |
| [Reference implementations](/components/core/results/#reference-implementations) | `test-cabinet-references` | a per-variant `*.pages.dev` URL | `tcab publish-reference` → `wrangler` |
| Short links (`apps/edge`) | `tcab-short-links` (Worker) | `tcab.ai` | `wrangler` |

**Staging mirrors this.** Staging is a full mirror of production, not a reduced
one, so the surfaces a change has to be verified on exist there too, under their
own names — sharing a name between the two would mean staging traffic resolving
against production's data:

| Site | Staging project | Staging address |
| ---- | --------------- | --------------- |
| Gallery | `the-test-cabinet-staging` | `the-test-cabinet-staging.pages.dev` |
| Reference implementations | `test-cabinet-references-staging` | a per-variant `*.pages.dev` URL |
| Short links | `tcab-short-links-staging` (Worker) | `staging.tcab.ai` |

The staging gallery has **no custom domain** — its `*.pages.dev` address is the
address, and everything that needs to name it (the staging Worker's
`GALLERY_ORIGIN`, the staging build's `TCAB_SITE_ORIGIN`) names that. The docs and
per-run builds have no staging counterpart: the docs are one published site, and a
per-run build is addressed by the run that produced it rather than by an
environment.

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

In the Cloudflare dashboard, create a Pages project named `the-test-cabinet`
(distinct from the `test-cabinet-docs` and `test-cabinet-runs` projects)
connected to the GitHub mirror:

- Set the **production branch** to `master`.
- **Build command:** `npm ci && npm run build:site`. The `build:site` root
  script builds the site's transitive workspace runtime packages in dependency
  order before the site itself — `run-record`, then `run-stats`, `share-links`,
  `voxel-runtime`, and `particle-runtime` (which the `ui` package and the site's
  build plugins import, and which publish types only from their built `dist/`),
  then `apps/site`. Building the site alone
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
- Set the three **build variables**, all of them per-environment. Each names
  something outside the repository, which is exactly why none of them can be
  compiled in:
  - **`TCAB_SNAPSHOT_URL`** — the public read base of this environment's snapshot
    bucket, the dataset the build fetches. Must equal the backend's
    `TCAB_SNAPSHOT_PUBLIC_URL` for the same environment (mirrored in
    `scripts/lib/env.sh`). Unset, the gallery builds with an empty published
    dataset rather than failing, which is the fresh-deployment case.
  - **`TCAB_SITE_ORIGIN`** — this gallery's own public address, recorded in the
    `share-index.json` the build emits as the origin every short link resolves
    against. Defaults to `https://testcabinet.ai`, so **the staging project must
    set it** or staging's index will claim production's origin and send anyone
    following a staging short link into production.
  - **`VITE_TCAB_SHARE_BASE_URL`** — the short domain the gallery's own share
    control builds links against. Defaults to `https://tcab.ai`; staging sets
    `https://staging.tcab.ai`. An empty string offers no share control at all.
- Nothing to configure for **client-side routing**, and nothing to add: because
  the build ships **no `404.html`**, Pages answers an unmatched path with
  `/index.html` at the requested URL with a `200`, which is exactly the SPA
  fallback the gallery needs. This is what makes a run page shareable and
  indexable — a deep link that 404s is invisible to every crawler. Do **not** add
  a `/* /index.html 200` rule to `_redirects`: Pages rejects it as an infinite
  loop and ignores it. `apps/site/public/_redirects` is kept, with no rules, to
  say so. Do **not** re-add a `404.html` either: Pages would then serve it for
  every deep link and break exactly what this arrangement buys.
- **Unrecognized URLs still 404**, and that is the middleware's job rather than
  the host's. The SPA fallback above is indiscriminate — a mistyped path is
  answered with the shell and a `200` just as a real run page is — so
  `functions/_middleware.ts` sets the status itself: it matches the path against
  the app's own route table (`isKnownRoute`, imported from
  `@test-cabinet/ui/routes`) and, for a `/runs/<id>` path, against the share index,
  and answers a path that addresses nothing with the shell, a `404`, and
  `x-robots-tag: noindex`. The app's catch-all route draws the not-found page
  inside it. Two consequences worth knowing: a console-only route requested on the
  gallery (`/runs/new`, say) is answered `200` with that same not-found page,
  because the middleware reads the route table and not the host gates; and if the
  share index cannot be read, no 404 is manufactured — the page is served as-is,
  since an infrastructure hiccup must not turn real pages into errors.
- The gallery's **preview tags** are injected at request time by the same
  middleware. It reads `share-index.json` (an asset the build emits) and gives
  `/runs/<id>` and `/runs/<id>/play` their OpenGraph and Twitter tags, so a shared
  or indexed run link unfurls as that run rather than as a bare URL. The tags go
  into the same document every visitor gets — serving crawlers something different
  is cloaking.
- **Where the Functions live:** Pages resolves `functions/` from the *project*
  root, which for this repo is the repository root (the build command runs there
  because the gallery is one workspace of an npm workspace repo). So the
  middleware is at `/functions/_middleware.ts`, not under `apps/site/`. Leave the
  project's **Root directory** setting empty.
- **Which requests reach the Function** is decided by
  `apps/site/public/_routes.json`, and it is a **billing** control as much as a
  routing one. A root `_middleware.ts` runs in front of *everything* — every
  hashed JS chunk, every stylesheet, every logo — and each of those is a billable
  Worker invocation, where a static asset served without a Function is free.
  Absent this file Pages generates `include: ["/*"]` with no exclusions, so a
  single page view spends a dozen invocations to decorate one document.
  The file therefore keeps the `/*` include the 404 handling needs, and excludes
  the paths that are purely static: `/assets/*` (the bundle, and the bulk of the
  traffic), `/logos/*`, `/run-events/*`, `share-index.json`, and the standalone
  SVGs. It is plain JSON and cannot carry comments, which is why the reasoning is
  written down here.
  One path is deliberately **not** excluded: the build's per-run
  `/runs/<id>.json` records sit under the same prefix as the run pages, and a
  `_routes.json` rule may only wildcard at its end, so no rule separates them. The
  middleware answers those cheaply — it returns the response untouched as soon as
  it sees a non-HTML content type — and one extra invocation per run-page view is
  the price of keeping the run records where they are.
- Create the project's **deploy hook** and give its URL to the backend as
  `TCAB_SITE_DEPLOY_HOOK_URL` (see [Deployment](/deployment/overview/)). The
  backend fires it after each snapshot upload, so a published run rebuilds the
  gallery without a code push.

The **staging gallery** is a second project of the same shape, named
`the-test-cabinet-staging`, connected to the same mirror with its production
branch set to `staging`. Everything above applies to it unchanged except its
address and the three build variables, which name staging's own snapshot bucket,
its own `*.pages.dev` origin, and its own short domain:

| Variable | Production | Staging |
| -------- | ---------- | ------- |
| `TCAB_SNAPSHOT_URL` | `https://snapshot.testcabinet.ai` | `https://snapshot.staging.testcabinet.ai` |
| `TCAB_SITE_ORIGIN` | `https://testcabinet.ai` | `https://the-test-cabinet-staging.pages.dev` |
| `VITE_TCAB_SHARE_BASE_URL` | `https://tcab.ai` | `https://staging.tcab.ai` |

It gets its own **deploy hook**, given to the *staging* backend as its
`TCAB_SITE_DEPLOY_HOOK_URL`, so a staging publish rebuilds the staging gallery and
nothing else. There is no custom domain to add.

Per-run builds and the docs are separate Cloudflare Pages projects; because every
build is served from `*.pages.dev` or a subdomain, no `*.testcabinet.ai` wildcard
or organization domain verification is required.

Each per-run build is deployed under its own Cloudflare Pages **branch alias**
(`--branch=<run-id>`), and the served URL is read back from `wrangler`'s output
rather than constructed — Cloudflare sanitizes and truncates long branch-alias
subdomains, so the literal `<run-id>.<project>.pages.dev` is not a reliable host.

## Short links (Cloudflare Worker, one-time)

`tcab.ai` is the short domain for sharing a run. `apps/edge` is the Worker behind
it: `/r/<code>` opens a run's verdict page on the gallery and `/p/<code>` opens its
play page, with a crawler answered by the run's preview card instead of a redirect.

Two properties are worth knowing before deploying it, because they are why it needs
so little setup:

- **It has no write surface.** A code is *derived* from a run id — the leading
  characters of it, see `@test-cabinet/share-links` — rather than minted and stored.
  So the set of valid links is exactly the set of published runs, only the backend
  can extend that set, and there is no endpoint to rate-limit or exhaust. This is
  what makes the short domain safe to expose publicly.
- **It has no state.** It resolves against `share-index.json`, an asset of the
  *gallery* deployment, fetched over HTTP and edge-cached. No KV, no database, and
  no deploy when a run is published: the gallery rebuild that publishes the run is
  what makes its link resolvable.

A path the resolver cannot serve — a code that names no run, or anything that is
not a short link — answers **404** with `noindex`, offering the gallery as the way
out. It does not quietly redirect: a dead link that lands somewhere tells the
person who followed it that they arrived, and tells a crawler the URL is real. The
one exception is a resolver that cannot read the index at all, which redirects
rather than manufacture a 404 out of an infrastructure failure.

### Two environments, two namespaces

The short domain is namespaced by environment exactly like everything else, and
for a sharper reason: a short code addresses **one** corpus of published runs, so
the same code resolved against the wrong environment points at a different run or
at none. Sharing a hostname between the two would make that a coin flip.

| | Production | Staging |
| --- | --- | --- |
| Worker | `tcab-short-links` | `tcab-short-links-staging` |
| Hostname | `tcab.ai`, `www.tcab.ai` | `staging.tcab.ai` |
| Resolves against | `https://testcabinet.ai` | `https://the-test-cabinet-staging.pages.dev` |
| Deploy | `npm run deploy -w @test-cabinet/edge` | `npm run deploy:staging -w @test-cabinet/edge` |

The apex is production's alone. Staging takes a subdomain because the *point* of
the short apex is the shortness, and that only pays off on links people actually
share; a staging link goes to a developer or into a test, where nine more
characters cost nothing. Sharing must nonetheless work on staging — staging
mirrors production, and it is where a share link is verified before the change
reaches the live domain.

### Setup

- Add `tcab.ai` as a zone in the same Cloudflare account, and a DNS record for
  `staging.tcab.ai` alongside the apex. A Worker route needs a record to attach
  to; a proxied `AAAA` to `100::` (the discard prefix) is the usual placeholder,
  since nothing but the Worker ever answers on it.
- Deploy each environment with the command in the table above. Both read
  `apps/edge/wrangler.toml` — the top level is production, `[env.staging]`
  overrides the name, route, and `GALLERY_ORIGIN`. They reuse the same
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as the other `wrangler`
  deploys, but the token needs the *Workers Scripts: Edit* permission rather than
  *Cloudflare Pages: Edit*.
- There is no deploy hook and nothing to rebuild per publish; redeploy only when
  the Worker's own code changes.

Then tell the two UIs the domain exists, so each offers its run pages a **share**
control (each hides it when unset, so nothing breaks if you skip one). Both are
per-environment, and both name that environment's *own* resolver:

- The **gallery** builds its links against `https://tcab.ai` by default; the
  staging project sets `VITE_TCAB_SHARE_BASE_URL` to `https://staging.tcab.ai`
  (see the [build variables](#gallery-cloudflare-pages-one-time) above). An empty
  string offers no share control at all.
- The **consoles** read it from the backend's `GET /config`, so set
  `TCAB_SHARE_BASE_URL` on the backend — `https://tcab.ai` on production,
  `https://staging.tcab.ai` on staging (see
  [Kubernetes](/deployment/kubernetes/)).

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
