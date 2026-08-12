---
title: Evaluation
---

An end-to-end run is scored in two stages: an automated validation pass and a
review written by a person who plays the build. Validation catches gross
failures cheaply and, through the [instrumentation](#instrumentation) a case
requires, drives the build into the states a review needs so it can decide the
objective, mechanically checkable requirements and synthesize their evidence.
The review is where subjective judgement is made: the quality rating per scoring
domain, and the checklist verdicts automation cannot produce honestly.

The mechanism behind each stage lives under Core:
[Validation](/components/core/validation/) for the automated pass and
[Results](/components/core/results/) for publishing and reviews. This page
covers how the two combine into a run's score.

## Load check

The most important automated signal is whether the implementation runs at all.
Validation builds the produced implementation with the manifest's `[build]`
commands, install then build, serves the output directory (`dist/`, `build/`, or
`out/`) as a static site, loads it in a headless browser, and detects fatal
errors. The install and the build are reported as separate results rather than
one opaque step. A run that cannot load is recorded as such, which is the
clearest negative signal available.

## Checks

Reference comparison is opt-in. A case seeds reference views as visual targets,
and a view is scored only when the case declares a
[`[[check]]`](/testing/end-to-end/manifests/) for it. The harness serves the
build, drives it through the check's actions, captures a screenshot, and scores
its similarity against the reference baseline. The result is a similarity signal
recorded with the run rather than a strict match requirement, and a view that
cannot be reached or captured is recorded as not reached. Because driving an
arbitrary implementation into a deep state is unreliable, most cases check only
a few deterministic views even though they seed more references as targets.

## Proofs

A case can ask the build to produce proof of implementation: a screenshot or
short clip written to a known path as evidence that a feature works, declared
with a [`[[proof]]`](/testing/end-to-end/manifests/). Validation records only
whether each declared proof turned up in the produced tree and is non-empty; it
does not judge the contents. A proof is informational, so a missing one never
changes whether the run loaded or what its status is. It is surfaced so a
reviewer sees the gap, and so the reviewer UI can show the submitted media
beside the expected reference for a review item that pairs them.

A proof the build submits is evidence a reviewer weighs. Media The Test Cabinet
synthesizes itself by driving the build through its
[instrumentation](#instrumentation) is a different thing: it is captured from a
scenario the harness constructed, and it backs an automatically decided verdict.

## Instrumentation

An end-to-end case requires the build to ship
[instrumentation](/testing/end-to-end/instrumentation/): a debug API that puts
the game into a precise state and reports the state it is in, a deterministic
core that makes that reproducible, and a read-only debug overlay. This is what
lets validation reach past gross failures. For an objective review item, the
harness resets the build to a known start, calls the case's control operations
to establish the item's precondition, steps the real simulation forward, and
reads the result back, both synthesizing the proof media and deciding the
verdict.

The debug API is load-bearing rather than informational: a build that does not
expose the contract the case declares, or whose API is non-conformant, fails
every checklist point its broken instrumentation hid. An implementation that
cannot expose the mandated contract has not met the spec. See
[load-bearing](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing).
Instrumentation decides only the objective half of a review; the judgement below
stays human.

## Review

The evaluation proper is the [review](/components/core/results/#reviews): a
person plays the finished build and writes it up. A review carries three things.

- A short writeup the site shows before the playable build.
- A rating per scoring domain, one hand-assigned tier for each
  [`[[domain]]`](/testing/end-to-end/manifests/) in the run's effective domain
  set: the case's common domains plus any the run's variant declares. The five
  tiers, in descending order of fidelity to the spec, are flawless, great,
  passable, scuffed, and broken. The run's overall rating is the worst across
  that set, so a flawless mode cannot mask a broken one.
- A checklist of binary verdicts, pass or fail with an optional note, one per
  verdict id the case version declares for the run's variant. An item graded as
  a whole carries one verdict; an item broken into
  [sub-items](/testing/end-to-end/manifests/#sub-items) carries one per
  sub-item. Every verdict must be recorded, and the writeup and every domain
  rating supplied, before a review can be submitted, so a reviewer cannot
  silently skip a requirement the author called out.

An automatically validated point arrives pre-filled with the verdict its debug
script decided, marked as machine-set and shown in a distinguishable color. The
reviewer can override any of them.

## Scoring

A run's score is earned points over available points, like an academic test. The
score and the overall rating are shown together on the run, and each test case's
[leaderboard](/components/site/overview/#leaderboard) ranks the harness and
model pairs that have scored runs of the selected variant by average score.

- An item graded as a whole is worth its declared `weight`: a `pass` earns all
  of it and a `fail` earns none.
- An item broken into sub-items is scored per sub-item. Each name-only sub-item
  is worth one point, and each review item under a
  [category](/testing/end-to-end/manifests/#the-categories-grammar-format--2) is
  worth its own `weight`, defaulting to one. The item's available points are the
  sum of its sub-items', so a build gets partial credit for a section it mostly
  gets right.
- A point an [erratum](/testing/end-to-end/manifests/#errata) excludes from
  scoring counts toward neither side of the ratio. It is still checked, driven,
  and shown.

Publishing refuses a completed run with no review, so every published end-to-end
implementation is both scored and framed by a human assessment. For how a
reviewer arrives at the per-domain ratings and works the checklist, see
[Reviewing Test Run Results](/guides/development/reviewing-test-run-results/).
