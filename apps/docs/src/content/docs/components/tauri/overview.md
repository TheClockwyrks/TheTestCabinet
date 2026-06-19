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
  [variant](/components/core/test-cases/#variants), a
  [harness](/components/core/harnesses/), and a model — and launch it, watching
  the live [harness event](/components/core/events/) stream as it progresses.
- **Track runs in progress.** Return to any still-executing run from the Runs
  list (its spinner row links straight to the live monitor), and get a
  notification — a toast, with a bell and a slide-out list of unread alerts —
  when a run completes, even while working elsewhere in the console. The alert
  links to the finished run, and opening it dismisses the alert. Notifications
  are pushed from the runner (no polling): a remote worker streams them over SSE,
  the built-in local worker over a Tauri event.
- **Read the specs.** Browse the [specification](/components/core/test-cases/) a
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

A **minimal functional shell** is implemented: every capability above is
reachable and works end to end over Tauri commands that delegate to the
[core](/components/core/overview/) — configuring and launching a run with a live
event stream, reading the seeded specs, writing a review (writeup + rating), and
publishing a reviewed run. The UI is plain; polish follows. See the
[Roadmap](/roadmap/).
