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

## What it does

- **Run test cases.** Configure a run — choosing a test case version, a
  [variant](/components/core/test-cases/#variants), a
  [harness](/components/core/harnesses/), and a model — and launch it, watching
  the live [harness event](/components/core/events/) stream as it progresses.
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

As a runner the app needs a supported container runtime on the machine it runs on,
and it resolves definitions from and publishes to the
[backend](/components/backend/overview/).

## Status

This app has **not** been implemented yet. It is planned to follow the
[backend](/components/backend/overview/); see the [Roadmap](/roadmap/).
