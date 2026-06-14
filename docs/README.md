# The Test Cabinet

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

## System

The Test Cabinet is made up of the following parts:

- The [testing harness application](./application.md) is the locally run
  application that orchestrates benchmark runs.
- The [test case catalog](./test-cases.md) defines the games that models are
  asked to build, including their specs, assets, and validation criteria.
- The [agent harness layer](./harnesses.md) provides a unified way to invoke
  third party coding harnesses so that the same test case can be run against any
  of them.
- The [execution environment](./execution.md) isolates each run in its own
  container and its own fresh git repository.
- [Metrics](./metrics.md) defines the run time, token, and cost data that every
  run records.
- [Validation](./validation.md) describes the automated first pass that catches
  gross failures and compares against reference UIs.
- [Run records](./run-records.md) define the data contract that a run produces
  and the site consumes.
- [Results](./results.md) describes how a run's generated code and run record are
  published.
- The [public site](./site.md) is the gallery where published runs can be
  browsed and played.

## Terminology

To avoid ambiguity between the two kinds of "harness" involved:

- The *testing harness* is The Test Cabinet's own application that runs
  benchmarks.
- An *agent harness* is a third party coding tool (for example Claude Code or
  Codex) that drives a model through a test case.
