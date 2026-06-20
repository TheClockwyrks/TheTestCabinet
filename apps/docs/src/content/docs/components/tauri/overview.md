---
title: Overview
---

The Test Cabinet's Tauri app is the desktop GUI, and is expected to be the
primary way The Test Cabinet is used when running test cases interactively (the
other being scripting through the [CLI](/components/cli/overview/)). It is built
on the [core](/components/core/overview/) like every other component, exposing
the same run functionality through an interactive window rather than a command
line or an HTTP API.

It is both a
[runner and a reporter](/components/architecture/#runners-and-reporters), which
is what makes it the natural hub: a person can launch a run, watch it, judge it,
and publish it without leaving the app.

Its console UI is shared with the [web console](/components/web/overview/)
through the [UI library](/components/ui/overview/): the two are the same console,
and the only substantive difference is what they connect to. The Tauri app ships
with a **built-in local worker** — its host's embedded core — pre-added, so it
can run a test case out of the box; the web console starts with no workers. Both
resolve the catalog from a [backend](/components/backend/overview/) and can add
further remote [workers](/components/worker/overview/).

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
  are pushed from the runner (no polling): a remote worker streams them over SSE,
  the built-in local worker over a Tauri event.
- **Read the specs.** Browse the [specification](/testing/end-to-end/overview/) a
  run was built from, so the produced implementation can be judged against what
  was actually asked for.
- **Review runs.** Record a [review](/components/core/results/#reviews) — the
  hand-written writeup and rating — after playing a finished build. This is the
  curatorial step that publishing requires.
- **Publish.** [Publish](/components/core/results/) a reviewed run: release its
  code and deploy its build, then submit its
  [run record](/components/core/run-records/) and review to the
  [backend](/components/backend/overview/).

As a runner the app needs a supported container runtime on the machine it runs
on, and it resolves definitions from and publishes to the
[backend](/components/backend/overview/).

## Status

The desktop app is **built around the full shared console**, not a stripped-down
shell. It mounts the same `GalleryApp` from the
[UI library](/components/ui/overview/) that the
[web console](/components/web/overview/) and the
[public site](/components/site/overview/) render, so its UI — the routed gallery
pages plus the run-execution screens (new run, live monitor, review, the
Connections settings) — is the web console's UI, not a separate, plainer one.

The desktop's only departures from the web console are its host wiring: it
provides the [UI library](/components/ui/overview/)'s `BackendClient` and
`WorkerClient` over Tauri commands instead of HTTP, resolving the catalog from
the embedded [core](/components/core/overview/) over IPC and pre-adding a single
**built-in local worker** (also the embedded core). Those commands cover the
whole flow end to end — resolving the catalog, configuring and launching a run
with a live event stream, reading the seeded specs, writing a review (writeup +
rating), and publishing a reviewed run. A run's loadable media — a produced run's
proof artifacts and an [asset-generation](/testing/asset-generation/overview/)
run's regenerated/target/preview images and action log — is served not over a
command but over custom URI schemes (`tcab-proof://` and `tcab-asset://`), since
the UI needs a real URL it can point an `<img>`/`<video>` at, where the HTTP
worker would expose `/runs/{id}/proof/{file}` and `/runs/{id}/asset/{file}`.

Because the UI is shared, the desktop build is expected to be feature-complete
against that shared app by construction rather than re-implemented; the desktop
binary has not yet been hand-tested end to end on every platform. Remaining work
is wiring and polish rather than missing screens. See the [Roadmap](/roadmap/).
