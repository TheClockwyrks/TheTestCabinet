---
title: Validation
---

## Overview

Validation is the automated pass over a finished implementation. It builds and
load-checks the produced tree, then decides the objective, mechanically
verifiable review points and synthesizes their evidence. A run under an
[engine](/components/core/engines/) decides those points with a vitest suite run
in process against the game the build produced. A run under no engine drives the
build's [instrumentation](/testing/end-to-end/instrumentation/) in a browser.

Validation assesses part of an implementation, not all of it. A game's feel and
quality are graded by a person playing the build and writing its
[review](/components/core/results/#reviews), which is where the per-domain
ratings and the subjective checklist verdicts come from. What validation can
decide, it decides: an objective point backed by a validator is scored from that
validator's result, pre-filled into the reviewer's checklist and overridable
there.

## Load check

The most important automated check is whether the implementation runs at all.
Many failures are gross: the build fails, or the page throws on load and nothing
renders. Validation must:

- Build the implementation, running the test case's required `[build]` install
  and build commands from the produced repository, and serve its output
  directory (`dist/`, `build/`, or `out/`) as a static site.
- Load it in a headless browser.
- Detect fatal errors, including build failures and uncaught runtime errors that
  prevent the application from rendering.

A run that cannot load is the clearest possible signal and is recorded as such.

## Validators

A case that supports an [engine](/components/core/engines/) ships a validator per
verdict unit for that engine, written as a TypeScript test file and run by
vitest. Validators live with the case, are never seeded into the run workspace,
and run after the produced repository's dependencies are installed.

A validator runs in process. It imports the engine package directly, and it
imports the module the case requires the build to export its game from, so it
exercises the game the model wrote rather than a page serving it. The case's
module contract is what makes that import valid for every build.

A validator builds the engine itself: a canvas from `@napi-rs/canvas`, a clock
that supplies a scripted sequence of deltas, the engine's own initialization, and
an exact number of frames stepped one call at a time. A scenario therefore runs
synchronously and reproducibly, with no browser, no server, and nothing to wait
for. Setup runs the real game forward, so a validator poses a situation through
the game's own update and reads the outcome back from the state that update left.

Observation has three channels:

- The engine's own values: the game state, the frame counter and accumulated
  simulated time, and the viewport.
- The engine's events, which report each asset resolution and each cue played at
  the moment it happens.
- The canvas. Pixel readback decides what a frame actually drew, and a recording
  wrapper around the 2D context captures the draw-call stream where the calls
  carry the requirement more directly than the pixels do.

A validator is written against one engine's API and uses that engine's own
vocabulary, so a case supporting several engines ships a validator per verdict
unit per engine.

Each validator produces an auto verdict, decided from a list of assertions and
passing only when every assertion passed, together with the media outputs it
declares. Media is captured from the model's build as the actual result; the
matching baseline is captured once by running the same validator against the
case's reference implementation and is served case-scoped, so a reviewer sees the
two side by side.

## Checks

A check scores a screenshot of a driven view against a rendered reference
baseline and records the similarity with the run. Checks remain supported for the
case versions that declare them. A new case version decides its objective points
with validators instead, which reach the state a check would have to drive a
browser into and assert on it directly.

## Proofs

A proof is a screenshot or short clip the build writes to a known path as
evidence that a feature works. Validation records, for each declared proof,
whether the file turned up in the produced tree and is non-empty, judges no
proof's contents, and uploads each present proof when the run finishes to be
served back as per-run media (see
[run records](/components/core/run-records/)). A proof is informational, so a
missing one leaves the run's load result and status untouched. Proofs remain
supported for the case versions that declare them. A new case version captures
its media from its validators, which produce it from a scenario the case
controls.

## Instrumentation

A run under no engine decides its objective points by driving the case's required
[instrumentation](/testing/end-to-end/instrumentation/): the debug API the build
installs on a case-specific global, backed by a deterministic core. This is what
lets it check requirements a screenshot cannot. A script resets the build to a
known state, calls the case's control operations to set up a verdict's
precondition, steps the real simulation forward, and reads the outcome back from
a state snapshot and the rendered canvas.

A script runs per verdict unit, meaning a whole review item or an individual
sub-item, so each independently graded point gets its own script and its own
evidence. Each script produces an auto verdict and media outputs exactly as a
validator does.

### Validation that fails to complete

A validator or script that could be run but did not complete against a conformant
build fails the checklist point it backs. The case mandates the surface it drives,
so a missing module, a call that threw, a malformed return, or a declared output
the build never produced synthesizes a failed verdict for that point. The verdict
is pre-filled into the review like any auto verdict and the reviewer may override
it. The run itself stays reviewable: a build that loads is scored down by exactly
the points its checks could not answer.

An unmet precondition is held apart. A setup often searches the model's own world
for a place to pose its scenario, such as a blind corner in an invented maze or a
legal build tile, and that search can come up empty against a fully conformant
build. That outcome is inconclusive, so no verdict is synthesized and the reviewer
decides the point by hand.

A point excluded from scoring for the version, through an
[erratum](/testing/end-to-end/manifests/) that links its verdict id, is still
driven and its media still captured, but a failed drive costs it nothing.

## Results

Validation output is summarized into the [run
record](/components/core/run-records/) so the site can surface what validation
did. Building an implementation is reported as its constituent steps. The
dependency install and the static build are required steps that every run
performs, and each is reported as its own result with its outcome rather than
being folded into the load signal.

The summary therefore covers the install and the build alongside whether the
implementation loaded. It also carries:

- A validation result per verdict unit: the item and sub-item ids, the validator
  or script that ran, whether it ran, whether it gates, its auto verdicts and
  their assertions, and its captured outputs.
- A check result per declared check, carrying its display name as well as its
  view slug so the site can label it without re-deriving one.
- A proof result per declared proof: its id, display name, media kind, expected
  `dest`, and whether it was present.
- For a run of any other test type, that type's own result block in place of the
  end-to-end checks. An [asset-generation](/testing/asset-generation/overview/)
  run records the produced media, the recorded action log, and the operation
  count for its [asset kind](/testing/asset-generation/overview/#asset-kinds).
