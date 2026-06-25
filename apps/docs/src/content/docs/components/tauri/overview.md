---
title: Overview
---

The Test Cabinet's Tauri app is the desktop GUI, and is expected to be the
primary way The Test Cabinet is used when launching test cases interactively (the
other being scripting through the [CLI](/components/cli/overview/)). It is an
**enqueue + watch** client of the [backend](/components/backend/overview/) and a
reporter, exposing the run lifecycle through an interactive window rather than a
command line or an HTTP API.

A person can sign in, launch a run, watch it, judge it, and push or publish it
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
a **reachable backend** (and, for local development, the
[k3d service stack](/development/running/)) to launch anything.

## What it does

- **Run test cases.** Configure a run — choosing a test case version, a
  [variant](/testing/end-to-end/overview/#variants), a
  [harness](/components/core/harnesses/), and a model — and launch it, watching
  the live [harness event](/components/core/events/) stream as it progresses.
- **Track runs in progress.** Return to any still-executing run from the Runs
  list (its spinner row links straight to the live monitor), and get a
  notification — a toast, with a bell and a slide-out list of unread alerts —
  when a run completes, even while working elsewhere in the console. The alert
  links to the finished run, and opening it dismisses the alert. Notifications
  are pushed from the backend (no polling), streamed over SSE.
- **Read the specs.** Browse the [specification](/testing/end-to-end/overview/) a
  run was built from, so the produced implementation can be judged against what
  was actually asked for.
- **Sign in.** Log in to (or register with) the
  [auth service](/components/auth/overview/) so that pushes, reviews, and
  publishes are attributed to an [account](/components/backend/overview/#accounts).
- **Push runs.** [Push](/components/core/results/#push) a finished run — release
  its code and deploy its build, then store its
  [run record](/components/core/run-records/) on the
  [backend](/components/backend/overview/) — so the playable build can be reviewed.
  Pushing needs **no** review; the run stays private until it is published.
- **Review runs.** Record a [review](/components/core/results/#reviews) — the
  hand-written writeup and rating — after playing a finished build, attributed to
  the signed-in account. A run may carry several reviews, one per account.
- **Publish.** [Publish](/components/core/results/#publish) a pushed, reviewed run
  to flip it public. The solo path (push + self-review + publish in one action) is
  available too, for when the same person does all three.

The app needs **no** container runtime of its own — it enqueues runs at the
[backend](/components/backend/overview/) (which drives them server-side), resolves
definitions from it, and pushes/reviews/publishes to it. It requires a reachable
backend and, in local development, the [k3d service stack](/development/running/).
The only work the app performs on its own machine is the local adversarial arena.

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
the seeded specs, push a finished run, write a review, and publish. A run's
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
