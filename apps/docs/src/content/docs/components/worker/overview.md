---
title: Overview
---

The worker is an [Axum](https://github.com/tokio-rs/axum) server that exposes The
Test Cabinet's run functionality over an HTTP API. It is effectively the
[CLI](/components/cli/overview/) — or a headless [Tauri](/components/tauri/overview/)
instance — with a web API in front of it instead of a command line: the same
[core](/components/core/overview/) functionality, reached over the network rather
than from a shell.

Its purpose is to let test cases be invoked on a **remote** machine. A run needs
a container runtime and meaningful compute; the worker lets that machine be
separate from wherever a person is driving things, so runs can be launched on a
dedicated host (or several) instead of on a laptop.

## Relationship to the Core

Like every other runner, the worker re-implements none of a run's behavior. It
translates HTTP requests into core calls and streams the results back:

- It accepts a request to run a test case — a version, a
  [variant](/components/core/test-cases/#variants), a
  [harness](/components/core/harnesses/), and a model — and drives the run through
  the core.
- It surfaces the run's live [harness events](/components/core/events/) over the
  API so a caller can render progress remotely, exactly as the CLI prints them
  locally.
- It produces the same [run record](/components/core/run-records/) a local run
  would, and can [publish](/components/core/results/) on the same terms.

Because it is a [runner](/components/architecture/#runners-and-reporters), the
worker's host needs a supported container runtime, and it resolves test case and
container definitions from, and publishes results to, the
[backend](/components/backend/overview/). Like the backend, it is intended to live
on the private network rather than be exposed publicly.

## Status

The worker has **not** been implemented yet.
