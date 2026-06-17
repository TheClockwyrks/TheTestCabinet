---
title: The Test Cabinet
---

## Overview

The Test Cabinet is a benchmark for evaluating AI models and the coding
harnesses that drive them. It does this with a suite of test cases inspired by
old school arcade and flash games. Each test case asks a model to build a
substantial, playable game from a specification, producing far more code than
most software development benchmarks require while also exercising visual and
spatial reasoning.

These documents are the vision specs for The Test Cabinet. They lock down the
details that matter for the testing harness, the test case catalog, and the
public site. They record both high level intent and low level requirements so
that an implementation can follow them without re-deriving decisions.

The Test Cabinet's harness, test case specs, and published results are intended
to be released publicly. Everything described here must therefore be buildable
and runnable without any proprietary dependencies.

## Status

This project is currently in early development. Expect missing features, janky
implementations, and UI/UX built around knowing the project ahead of time. The
project is not at a state where a user could pick up the project without any
knowledge about it and be able to use it to its full extent.

## System

The Test Cabinet is built as a headless [core](/components/core/overview/) with
a set of components wrapping it. See [Architecture](/components/architecture/)
for how they fit together; the [core](/components/core/overview/) docs define the
domain concepts the rest of the system is built around:

- The [test case catalog](/components/core/test-cases/) defines the games that
  models are asked to build, including their specs, assets, and validation
  criteria.
- The [agent harness layer](/components/core/harnesses/) provides a unified way
  to invoke third party coding harnesses so that the same test case can be run
  against any of them.
- The [execution environment](/components/core/execution/) isolates each run in
  its own container and its own fresh git repository.
- [Metrics](/components/core/metrics/) defines the run time, token, and cost data
  that every run records.
- [Validation](/components/core/validation/) describes the automated first pass
  that catches gross failures and compares against reference UIs.
- [Run records](/components/core/run-records/) define the data contract that a
  run produces.
- [Results](/components/core/results/) describes how a run's generated code and
  run record are published.

The components that wrap the core are the [CLI](/components/cli/overview/),
[worker](/components/worker/overview/), and [Tauri app](/components/tauri/overview/)
(the ways runs are launched), the [backend](/components/backend/overview/) that
distributes definitions and stores results, and the
[public site](/components/site/overview/) where published runs are browsed and
played.

## Terminology

To avoid ambiguity between the two kinds of "harness" involved:

- The *testing harness* is The Test Cabinet's own application that runs
  benchmarks.
- An *agent harness* is a third party coding tool (for example Claude Code or
  Codex) that drives a model through a test case.
