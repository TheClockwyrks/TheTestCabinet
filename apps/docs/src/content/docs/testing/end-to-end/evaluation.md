---
title: Evaluation
---

An end-to-end run is scored in two stages: an automated **validation** pass that
catches gross failures cheaply, followed by a hand-written **review** by a person
who actually plays the build. The review is where the run gets its numbers: a
**score** in points and a quality **rating** per scoring domain. Automation
cannot grade an open-ended game reliably, so it is used only for the signals it
can produce honestly (does it build, does it load, does it match a reference),
and the scoring judgement is human.

The mechanism behind each stage is documented under Core —
[Validation](/components/core/validation/) for the automated pass and
[Results](/components/core/results/) for publishing and reviews. This page covers
how those mechanisms combine into the score for an end-to-end test case.

## Load check

The most important automated signal is whether the implementation runs at all.
Many failures are gross: the build fails, or the page throws on load and nothing
renders. Validation builds the produced implementation with the manifest's
required [`[build]` commands](/testing/end-to-end/manifests/) — install, then
build — serves the output directory (`dist/`, `build/`, or `out/`) as a static
site, loads it in a headless browser, and detects fatal errors. The install and
the build are each reported as their own result rather than folded into one
opaque step, and a run that cannot load is recorded as such — the clearest
possible negative signal. See [Load Check](/components/core/validation/#load-check).

## Checks

Reference comparison is **opt-in**. A case seeds reference screenshots as visual
targets, but a view is only scored when the case declares a
[`[[check]]`](/testing/end-to-end/manifests/) for it. The harness serves the
build, drives it through the check's actions, captures a screenshot, and scores
its similarity against the reference baseline. The result is a similarity signal
recorded with the run, not a strict match requirement; a view that cannot be
reached or captured is recorded as not reached rather than as a failure. Because
driving an arbitrary implementation into a deep state is unreliable, most cases
check only a few deterministic views — often just the initial screen — even
though they seed more references as targets. See
[Checks](/components/core/validation/#checks).

## Proofs

A case can ask the build to produce **proof of implementation** — a screenshot or
short `.webm` clip written to a known path as evidence that a feature works,
declared with a [`[[proof]]`](/testing/end-to-end/manifests/). A clip is a
`.webm` (the format Playwright records natively; the public gallery transcodes it
to `.mp4` for universal playback). Validation does not judge a
proof's contents; it records only whether each declared proof turned up in the
produced tree and is non-empty. This is **informational**: a missing proof never
changes whether the run loaded or its status. It is surfaced so a reviewer sees
the gap, and so the reviewer UI can show the submitted media beside the expected
reference for a review item that pairs them. See
[Proofs](/components/core/validation/#proofs).

## Review

The real evaluation is the [review](/components/core/results/#reviews): a person
plays the finished build and writes it up. A review carries three things:

- A short **writeup** the site shows before the playable build.
- A **rating per scoring domain** — one of four hand-assigned tiers, **flawless**,
  **great**, **scuffed**, or **broken**, in descending order of fidelity to the
  spec — for each [`[[domain]]`](/testing/end-to-end/manifests/) in the run's
  **effective** domain set: the case's common domains plus any the run's variant
  declares in its own file. The run's **overall rating** is the *worst* across that
  effective set, so a flawless mode cannot mask a broken one.
- A **checklist** of binary verdicts — **pass** or **fail**, with an optional
  note — one for each [`[[review_item]]`](/testing/end-to-end/manifests/) the
  case version declares, or one per **sub-item** for an item that declares
  [sub-items](/testing/end-to-end/manifests/#sub-items). Every declared item (and
  every sub-item) must carry a verdict before a run can be published, so a reviewer
  cannot silently skip a requirement the author called out.

## Scoring

Each `[[review_item]]` carries a point **weight**. A `pass` earns the item's
weight and a `fail` earns none, so the run's **score** is the earned weight over
the total declared weight — `scored / total` points, like an academic test. The
score and the overall rating are shown together on the run, and each test case's
[leaderboard](/components/site/overview/#leaderboard) ranks the models that have
scored runs of it by points (each model's best run).

An item with [sub-items](/testing/end-to-end/manifests/#sub-items) is scored per
sub-item instead of as a whole: its weight splits evenly across them, so it earns
`weight × (passed sub-items ÷ total sub-items)` — partial credit for a section a
build gets mostly right. The available total is unchanged (still the sum of item
weights); only the earned score becomes fractional.

Publishing refuses a run with no review, so every published end-to-end
implementation is both scored and framed by a human assessment rather than
dropped onto the site as raw output. For how a reviewer arrives at the per-domain
ratings and works the checklist, see
[Reviewing Test Run Results](/guides/reviewing-test-run-results/).
