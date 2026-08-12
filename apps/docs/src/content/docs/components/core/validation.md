---
title: Validation
---

## Overview

Validation is the automated pass over a finished implementation. It builds and
load-checks the produced tree, compares an implementation against a reference
baseline where a case declares a check, and drives the build's
[instrumentation](/testing/end-to-end/instrumentation/) to decide the objective,
mechanically verifiable review points and synthesize their evidence.

Validation assesses part of an implementation, not all of it. A game's feel and
quality are graded by a person playing the build and writing its
[review](/components/core/results/#reviews), which is where the per-domain
ratings and the subjective checklist verdicts come from. What validation can
decide, it decides: an objective point backed by a validation script is scored
from that script's result, pre-filled into the reviewer's checklist and
overridable there.

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

## Checks

Reference comparison is opt-in. A test case seeds reference screenshots as
visual targets, and a view is compared only where the case declares a check for
it. This keeps comparison honest: a view is scored only when it can be reached
and captured reliably.

- A test case declares each check in its manifest: the view, an optional display
  name defaulting to a humanized form of the view slug (`game-over` becomes
  `Game Over`), the reference whose rendered screenshot is the comparison
  baseline, and the actions that drive the built implementation into that view.
  A check with no actions captures the view shown on load.
- Validation serves the build, drives it through the check's actions, captures a
  screenshot, and scores its similarity against the baseline.
- The result is a similarity signal recorded with the run rather than a strict
  match requirement. A check that cannot be driven or captured is recorded as
  not reached rather than as a failure.

Driving an arbitrary implementation into a deep state is unreliable, so most
test cases validate a small number of deterministic views, often just the
initial screen, even when they seed more references as visual targets.

## Proofs

A test case can ask the build to produce proof of implementation: a screenshot
or short clip written to a known path as evidence that a feature works (see
[`[[proof]]`](/testing/end-to-end/manifests/)). Clips are captured as `.webm`,
Playwright's native recording format, and the public gallery transcodes them to
`.mp4` at snapshot time for universal playback.

Validation records, for each declared proof, whether the file turned up in the
produced tree and is non-empty. It judges no proof's contents. A proof the build
did not produce is recorded as missing rather than failing the run.

A proof the build submits is informational: a missing submitted proof leaves the
run's load result and status untouched. It is surfaced so a reviewer sees the
gap, and so the reviewer UI can show the submitted media beside the expected
reference for a review item that pairs them. Each present proof is uploaded when
the run finishes and served back as per-run media (see [run
records](/components/core/run-records/)).

## Instrumentation

Beyond the load check and reference comparison, validation drives a case's
required [instrumentation](/testing/end-to-end/instrumentation/): the debug API
the build installs on a case-specific global, backed by a deterministic core.
This is what lets it check requirements a screenshot cannot. A script resets the
build to a known state, calls the case's control operations to set up a
verdict's precondition, steps the real simulation forward, and reads the outcome
back from a state snapshot and the rendered canvas.

A script runs per verdict unit, meaning a whole review item or an individual
sub-item, so each independently graded point gets its own script and its own
evidence. Each script produces an auto verdict, decided from a list of
assertions and passing only when every assertion passed, together with the media
outputs it declares. Media is captured from the model's build as the actual
result; the matching baseline is captured once from the case's reference
implementation and served case-scoped, so a reviewer sees the two side by side.

### Scripts that fail to complete

A script that could be run but did not complete against a conformant build fails
the checklist point it backs. The case mandates the debug-API surface, so a
missing handle, a call that threw, a malformed return, or a declared output the
build never produced synthesizes a failed verdict for that point. The verdict is
pre-filled into the review like any auto verdict and the reviewer may override
it. The run itself stays reviewable: a build that loads is scored down by
exactly the points its checks could not answer.

An unmet precondition is held apart. A script's setup often searches the model's
own world for a place to pose its scenario, such as a blind corner in an
invented maze or a legal build tile, and that search can come up empty against a
fully conformant build. That outcome is inconclusive, so no verdict is
synthesized and the reviewer decides the point by hand.

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
implementation loaded and how closely each declared check matched its reference
baseline. Each check result carries its display name as well as its view slug so
the site can label it without re-deriving one. The summary also carries:

- A proof result per declared proof: its id, display name, media kind, expected
  `dest`, and whether it was present.
- A debug-script result per verdict unit: the item and sub-item ids, the script
  path, whether it ran, whether it gates, its auto verdicts and their
  assertions, and its captured outputs.
- For a run of any other test type, that type's own result block in place of the
  end-to-end checks. An [asset-generation](/testing/asset-generation/overview/)
  run records the produced media, the recorded action log, and the operation
  count for its [asset kind](/testing/asset-generation/overview/#asset-kinds).
