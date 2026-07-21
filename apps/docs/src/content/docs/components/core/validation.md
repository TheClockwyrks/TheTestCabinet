---
title: Validation
---

Validation is the automated pass over a finished implementation. It catches
gross failures cheaply, compares an implementation against a reference baseline
where a case opts in with a check, and — through the
[instrumentation](/testing/end-to-end/instrumentation/) a case requires the build
to ship — drives the build into specific states to check the objective,
mechanically-verifiable requirements and synthesize their evidence — per verdict
unit, so a review item broken into sub-items gets one script and one proof clip for
each sub-item.

Validation is not expected to assess an *entire* implementation: a game's feel
and quality cannot be graded automatically, so the run's per-domain **ratings**
and the subjective checklist verdicts still come from a person playing the build
and writing its [review](/components/core/results/#reviews). But validation is no
longer purely advisory. It **scores**: a build that fails the
[debug-API contract](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing)
a case mandates automatically fails every checklist point the broken
instrumentation kept a check from answering. And for the objective checklist items
it can, via instrumentation, both synthesize the proof and decide the verdict. What it cannot judge honestly, it leaves to the review.

## Load Check

The most important automated check is whether the implementation runs at all.
Many failures are gross: the build fails, or the page throws an error on load
and nothing renders. The testing harness must:

- Build the implementation — running the test case's required `[build]` install
  and build commands from the produced repository — and serve its output
  directory (`dist/`, `build/`, or `out/`) as a static site.
- Load it in a headless browser.
- Detect fatal errors, including build failures and uncaught runtime errors that
  prevent the application from rendering.

A run that cannot load is the clearest possible signal and must be recorded as
such.

## Checks

Reference comparison is **opt-in**, not automatic. A test case seeds reference
screenshots as visual targets, but those are not validated unless the test case
declares a **check** for the view. This keeps comparison honest: a view is only
scored when it can be reached and captured reliably.

- A test case declares each check in its manifest: the view, an optional
  human-readable display name (defaulting to a humanized form of the view slug —
  `game-over` becomes `Game Over`), the reference whose rendered screenshot is
  the comparison baseline, and the actions that drive the built implementation
  into that view (no actions means the view shown on load).
- The harness serves the build, drives it through the check's actions, captures
  a screenshot, and scores its similarity against the baseline.
- The result is a similarity signal recorded with the run, not a strict match
  requirement. A check that cannot be driven or captured is recorded as not
  reached rather than as a failure.

Because driving an arbitrary implementation into a deep state is unreliable,
most test cases will validate only a small number of deterministic views (often
just the initial screen), even though they seed more references as visual
targets.

## Proofs

A test case can ask the build to produce **proof of implementation** — a
screenshot or short `.webm` clip written to a known path as evidence that a
feature works (see [`[[proof]]`](/testing/end-to-end/manifests/)). Clips are
captured as `.webm` (Playwright's native recording format); the public gallery
transcodes them to `.mp4` at snapshot time for universal playback. Validation does
not judge a proof's contents; it records, for each declared proof, whether the
file turned up in the produced tree and is non-empty. A proof that the build did
not produce is recorded as **missing** rather than failing the run.

A proof the build **submits** is deliberately **informational**: a missing
submitted proof never changes whether the run loaded or its status. It is
surfaced so a reviewer sees the gap, and so the reviewer UI can show the
submitted media beside the expected reference for a review item that pairs them.
Each present proof is uploaded with the published run and served back as per-run
media (see [run records](/components/core/run-records/)). A proof that validation
**synthesizes** by driving the build's [instrumentation](#instrumentation),
rather than one the build submitted, is not informational in the same way — it is
captured from a scenario the harness constructed and can back a verdict it
decides.

## Instrumentation

Beyond the load check and reference comparison, validation drives a case's
required [instrumentation](/testing/end-to-end/instrumentation/) — the **debug
API** the build installs on a case-specific global, backed by a **deterministic
core**. This is what lets it check requirements that a screenshot cannot: it
`reset`s the build to a known state, calls the case's control operations to set
up a verdict's precondition, `step`s the real simulation forward, and reads
the outcome back from a state snapshot and the rendered canvas — enough to both
synthesize that point's proof and decide its verdict. A verdict unit is a whole
review item, or an individual sub-item of one, so each independently graded point
gets its own script and its own evidence.

Unlike a submitted proof, the debug API is a **gate**. A build that does not
install the declared handle, is missing a required operation, or whose API is
non-conformant when exercised is recorded as failing the debug-API contract, and
that **fails the run** — the clearest possible negative signal short of a build
that does not load, and one that needs no human to confirm. The contract is kept
small and mechanical precisely so a complete build satisfies it almost
incidentally. See
[The debug API is load-bearing](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing).

## Results

Validation output is summarized into the [run record](/components/core/run-records/)
so the site can surface what validation did. Building an implementation is not a
single opaque step: installing dependencies and building the static site are
**required steps** that every run performs, and each is reported as its own
result with its outcome rather than being folded silently into the load signal.
The summary therefore covers the install and the build alongside whether the
implementation loaded and how closely each declared check matched its reference
baseline. Each check result additionally carries its display name alongside its
view slug so the site can label it without re-deriving one. The summary also
carries a **proof** result per declared proof — its id, display name, media kind,
expected `dest`, and whether it was present — so the site and reviewer UI can show
each proof's status and resolve its submitted media.
