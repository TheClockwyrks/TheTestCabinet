---
title: Overview
---

The Test Cabinet's Tauri app is the desktop GUI, and is expected to be the
primary way The Test Cabinet is used when launching test cases interactively (the
other being scripting through the [CLI](/components/cli/overview/)). It is an
**enqueue + watch** client of the [backend](/components/backend/overview/) and a
reporter, exposing the run lifecycle through an interactive window rather than a
command line or an HTTP API.

A person can sign in, launch a run, watch it, judge it, and publish it
without leaving the app — which is what makes it the natural hub. It does not run
a test case itself: like the [web console](/components/web/overview/), it
enqueues the run at the backend, a [dispatcher](/components/dispatcher/overview/)
claims it, and a per-run [driver](/components/driver/overview/) `Job` executes it
(see [Server-side Run Topology](/components/architecture/#server-side-run-topology)).
The one thing it still runs **locally, in-process** is the
[adversarial](/testing/adversarial/overview/) arena — quick matches and
tournaments are CPU-bound wasm the desktop plays itself (see
[Arena](/components/arena/overview/)).

Its console UI is shared with the [web console](/components/web/overview/)
through the [UI library](/components/ui/overview/): the two are the same console
over the **same HTTP transport** (promoted into
[`@test-cabinet/ui/transport`](/components/ui/overview/)), and differ only in
delivery — a desktop binary vs. a browser bundle — and in a few host details. Both
resolve the catalog from, and enqueue runs at, a
[backend](/components/backend/overview/), which drives each run server-side via a
per-run [driver](/components/driver/overview/) `Job`. The desktop therefore needs
a **reachable backend** to do anything — but, unlike the web console, the
shipped app can **stand one up itself**: on launch it brings up a local
[k3d](https://k3d.io) cluster from the published service images and ingests the
test cases it bundles, so a person who is not a TTC developer needs no checkout,
no `make`, and no manually-run services — only a container runtime (see
[Self-contained cluster](#self-contained-cluster) below).

## What it does

- **Run test cases.** Configure a run — choosing a test case version, a
  [variant](/testing/end-to-end/overview/#variants), a
  [harness](/components/core/harnesses/), and a model — and launch it, watching
  the live [harness event](/components/core/events/) stream as it progresses.
- **Track runs in progress.** Return to any still-executing run from the Runs
  list (its spinner row links straight to the live monitor), and get a
  notification — a toast, with a bell and a slide-out list of unread alerts —
  when a run completes, even while working elsewhere in the console. The alert
  links to the finished run, and opening it dismisses the alert. Both the alerts
  and the in-flight list are pushed from the backend over the multiplexed
  [console stream](/components/backend/api/#the-console-stream) (SSE); the list
  advances as each run does, and nothing polls. The active list is re-read only
  when the stream says it might have missed something — see
  [staying current without polling](/components/backend/api/#staying-current-without-polling).
- **Read the specs.** Browse the [specification](/testing/end-to-end/overview/) a
  run was built from, so the produced implementation can be judged against what
  was actually asked for.
- **Sign in.** Log in to (or register with) the
  [auth service](/components/auth/overview/) so that reviews and publishes are
  attributed to an [account](/components/backend/overview/#accounts).
- **Review runs.** Record a [review](/components/core/results/#reviews) — the
  hand-written writeup and rating — after playing a finished build, attributed to
  the signed-in account. A run may carry several reviews, one per account. A
  produced run's [record](/components/core/run-records/) is
  [stored](/components/core/results/#stored-when-produced) on the
  [backend](/components/backend/overview/) by the
  [driver](/components/driver/overview/) when the run finishes — so it is private
  but reviewable as soon as it is produced, with no separate push step in the
  console.
- **Publish.** [Publish](/components/core/results/#publish) a reviewed run to flip
  it public. The solo path (self-review + publish in one action) is available too,
  for when the same person reviews and publishes.

The app does not execute runs in-process — it enqueues them at the
[backend](/components/backend/overview/) (which drives them server-side), resolves
definitions from it, and reviews/publishes to it. It requires a reachable
backend, which it either **stands up itself** (the self-contained cluster below,
the default for a shipped app) or is **pointed at** (`TCAB_BACKEND_URL`, the
developer path). The only work the app performs in-process is the local
adversarial arena.

## Self-contained cluster

The shipped desktop app is meant to be the lowest-friction way to use The Test
Cabinet, so it does not assume a checkout, a container image build, or a
manually-run backend. Instead, **when no external backend is configured**
(`TCAB_BACKEND_URL` unset), the shell stands up the whole run topology itself on
a local [k3d](https://k3d.io) cluster — the same manifests a
[deployment](/deployment/kubernetes/) uses — and then talks to it exactly as the
web console talks to a remote backend:

- It pulls the **published service images** from GHCR (it never builds images),
  so no source tree is needed. The installer pins the image tag to the set built
  for its own release commit.
- It ingests the **test-case catalog it bundles** (the `test-cases/` tree ships
  inside the app), staged onto the cluster node and ingested by the backend.
- It bundles **k3d** and **kubectl** as sidecars; the one host prerequisite is a
  running container runtime (Docker, or a Docker-compatible one) — k3d hosts the
  cluster in containers.
- Standing the cluster up (pulling images, rolling out services, ingesting the
  catalog) takes a while, so the window shows a **loading screen** narrating each
  step until the stack is ready; on a failure (no container runtime, say) it
  shows the cause and a retry. The console is only revealed once the cluster is
  up, so it never flashes an empty catalog mid-bootstrap.

The cluster persists between launches (it is created once and reconciled on each
start) and its `kubectl port-forward`s are torn down on exit. **TTC developers take
the other path:** set `TCAB_BACKEND_URL` to a
[manually-run backend](/development/running/#iterating-on-the-backend-and-auth-services-as-bare-processes)
(or the [k3d service stack](/development/running/)) and the app skips the bootstrap
entirely, behaving as a thin client — so a definition change can be re-ingested
without cutting a new app release.

## Harness authentication

Because the desktop app *is* the cluster operator, it also owns the harness
credentials its driver `Job`s authenticate with — the
[two auth modes](/components/core/harnesses/#authentication) every deployment
uses. **Settings → Authentication** (a section present only under the desktop app,
gated on a `harnessAuth` capability the web console and static site omit) is the
control surface, and it actually configures the cluster — these are not display-only
toggles. Per harness it lets the user:

- **Select the authentication method** — `auto` (the default), `subscription`,
  or `api-key` — written into the driver Secret as `TCAB_AUTH_MODE_<SLUG>`, which
  core honors per harness.
- **Set an API key** — stored per harness and written as `TCAB_API_KEY_<SLUG>`,
  the [per-harness override](/components/core/harnesses/#authentication) core
  reads before the shared provider variable, so harnesses that share a provider
  key (the OpenRouter harnesses) get independent keys.
- **Refresh a subscription's auth files** — rebuild the
  `tcab-driver-subscription` Secret (the one the dispatcher mounts into each
  driver pod) from the host's currently signed-in CLI credential files, so a
  fresh sign-in on the host reaches the cluster.

Settings persist to `harness-auth.json` in the app-data directory and are layered
over the host environment (a key exported in the shell or a `.env.runner` file is
the discovered default; a saved override wins). They are applied to the running
cluster on every change and re-applied on each launch's bootstrap. Keys are stored
in plaintext, matching the app's posture of lifting plaintext keys into the
loopback-only cluster — appropriate for the single-user local machine it targets.

## Status

The desktop app is **built around the full shared console**, not a stripped-down
shell. It mounts the same `GalleryApp` from the
[UI library](/components/ui/overview/) that the
[web console](/components/web/overview/) and the
[public site](/components/site/overview/) render, so its UI — the routed gallery
pages plus the run-execution screens (new run, live monitor, review, the account
and sign-in/registration pages, the Connections settings) — is the web console's
UI, not a separate, plainer one.

The desktop's departures from the web console are now small. It uses the **same
HTTP transport** the web console does — the shared
[`@test-cabinet/ui/transport`](/components/ui/overview/) `BackendClient` — to
resolve the catalog, enqueue and watch runs, sign in to the auth service, read
the seeded specs, write a review, and publish. A run's
loadable media — a produced run's proof artifacts and an
[asset-generation](/testing/asset-generation/overview/) run's
regenerated/target/preview images and action log — is loaded over **HTTP from the
[artifact service](/components/artifacts/overview/)** at `/runs/{id}/proof/{file}`
and `/runs/{id}/asset/{file}` (the backend reports its public URL via `GET
/config`), exactly as in the browser; the old desktop-only `tcab-proof://` and
`tcab-asset://` URI schemes were removed. What remains Tauri-specific is the
**local adversarial arena**: the desktop runs matches and tournaments in-process
and serves a tournament's replay media over the `tcab-tournament://` scheme, since
that media is produced on the host rather than fetched from the artifact service.

Because the UI is shared, the desktop build is expected to be feature-complete
against that shared app by construction rather than re-implemented; the desktop
binary has not yet been hand-tested end to end on every platform. Remaining work
is wiring and polish rather than missing screens. See the [Roadmap](/roadmap/).
