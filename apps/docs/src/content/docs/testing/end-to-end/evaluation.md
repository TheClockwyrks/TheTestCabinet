---
title: Evaluation
---

An end-to-end run is scored in two stages: an automated **validation** pass that
catches gross failures cheaply, followed by a hand-written **review** by a person
who actually plays the build. Neither stage produces a ranking. The final product
is published as it is — bugs and all — framed by the reviewer's assessment rather
than reduced to a single percentage. This split is deliberate: an open-ended game
cannot be graded reliably by machine, so automation is used only for the signals
it can produce honestly, and the real judgement is human.

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
short `.mp4` written to a known path as evidence that a feature works, declared
with a [`[[proof]]`](/testing/end-to-end/manifests/). Validation does not judge a
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
- A **rating** — one of four hand-assigned tiers, **flawless**, **great**,
  **scuffed**, or **broken**, in descending order of fidelity to the spec. The
  rating is the reviewer's own call; it is a subjective, per-run signal, shown
  alongside a run but never aggregated or used to rank runs.
- A **checklist** of verdicts — **pass**, **fail**, or **na**, with an optional
  note — one for each [`[[review_item]]`](/testing/end-to-end/manifests/) the
  case version declares. The checklist guarantees coverage, not a score: every
  declared item must carry a verdict before a run can be published, so a reviewer
  cannot silently skip a requirement the author called out. The verdicts inform
  the rating; they do not compute it.

Publishing refuses a run with no review, so every published end-to-end
implementation is framed by a human assessment rather than dropped onto the site
as raw output. For how a reviewer arrives at the rating and works the checklist,
see [Reviewing Test Run Results](/guides/reviewing-test-run-results/).
