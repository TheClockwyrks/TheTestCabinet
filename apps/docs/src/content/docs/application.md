---
title: Testing Harness Application
---

## Overview

The testing harness application is the locally run program that orchestrates
benchmark runs. It ties together the [test case catalog](/test-cases/), the
[agent harness layer](/harnesses/), the [execution environment](/execution/),
[metrics](/metrics/), [validation](/validation/),
[publishing](/results/), and the live [harness event](/events/) stream that
lets an interface show a run's progress as it happens.

## Local Operation

The application runs locally on a user's machine and drives runs through a
container runtime on that machine. It requires a supported container runtime
(Docker or a compatible runtime) to be available on the host.

## Structure

The application must be structured as a headless core with a graphical shell on
top, rather than building all logic into the user interface.

- The **core** owns all orchestration: resolving a test case version, seeding a
  run's repository, executing the run in a container, invoking the agent harness,
  collecting metrics, running validation, writing the run record, and publishing.
- A **command line interface** exposes the core so that runs can be scripted and
  benchmark sweeps can be run in batch without a person driving the interface.
- A **desktop interface**, built with Tauri, provides the local, interactive way
  to configure and launch runs and to review their results. This is the primary
  way a user interacts with The Test Cabinet locally.

Keeping orchestration in the core and out of the interface is what makes batch
runs, automation, and unattended sweeps possible.

## A Run

At a high level, launching a run must:

- Select a test case version, an agent harness, and a model.
- Seed a fresh git repository with the test case's data.
- Start a container and invoke the agent harness against the seeded repository.
- Surface the harness's activity as a live stream of [harness events](/events/)
  while the run is in progress.
- Record metrics as the run proceeds and collect the produced repository when it
  finishes.
- Run validation over the produced implementation.
- Write a run record, and optionally publish the run.
