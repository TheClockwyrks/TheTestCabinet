---
title: Validation
---

Validation is an automated first pass over a finished implementation. Its
purpose is to catch gross failures cheaply and, where a test case opts in with a
check, to compare an implementation against a reference baseline.

Full automated validation is **not** a goal. It is not expected that an entire
implementation can be assessed automatically. Validation produces signals that
are surfaced on the [site](/components/site/overview/); it is not a pass/fail
gate and it does not produce a ranking. The real evaluation is a person playing
the implementation.

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
screenshot or short `.mp4` written to a known path as evidence that a feature
works (see [`[[proof]]`](/testing/end-to-end/manifests/)). Validation does
not judge a proof's contents; it records, for each declared proof, whether the
file turned up in the produced tree and is non-empty. A proof that the build did
not produce is recorded as **missing** rather than failing the run.

This is deliberately **informational**: a missing proof never changes whether the
run loaded or its status. It is surfaced so a reviewer sees the gap, and so the
reviewer UI can show the submitted media beside the expected reference for a
review item that pairs them. Each present proof is uploaded with the published run
and served back as per-run media (see
[run records](/components/core/run-records/)).

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
