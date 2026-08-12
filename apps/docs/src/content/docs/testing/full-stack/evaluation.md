---
title: Evaluation
---

A full-stack run is scored exactly as an
[end-to-end](/testing/end-to-end/evaluation/) run is: an automated validation
pass that catches gross failures cheaply, then a hand-written review by a person
who plays the build and assigns a score in points and a quality rating per
scoring domain. What full-stack adds is that the reviewer also judges the assets
the model produced.

This page covers the differences. Read
[End to End → Evaluation](/testing/end-to-end/evaluation/) for the shared
detail.

## Validation

The automated pass is identical to end-to-end. The load check builds the
produced implementation with the manifest's required `[build]` commands, serves
the static output, loads it in a headless browser, and records whether it runs
at all. Checks (opt-in reference comparison), proofs (submitted evidence,
recorded rather than graded), and
[instrumentation](/testing/end-to-end/instrumentation/) all work as they do for
an end-to-end case.

The produced assets carry no validation of their own. They are
[build inputs](/testing/full-stack/overview/), exercised by being loaded and
played inside the running program and judged as part of that program by the
reviewer. Action-log regeneration and cheat detection belong to an
[asset-generation](/testing/asset-generation/evaluation/) run, where the asset
is the scored output.

## Review

The review carries the same three things an end-to-end review does: a writeup, a
rating per scoring domain (flawless, great, passable, scuffed, or broken, for
each `[[domain]]` in the run's effective set, the overall rating being the worst
across them), and a checklist of pass/fail verdicts, one per `[[review_item]]`
or one per sub-item for an item that declares them.

The reviewer is judging assets the model produced rather than assets the case
provided, so the quality of the art, the sprite motion, the particle effects,
and the sound is part of the experience being rated. A case makes this explicit
by wording its review items and scoring domains to cover the asset dimensions
that matter: a domain or item for the art direction, for the feel of the
effects, for the audio. A build whose code is solid but whose assets are
placeholder rectangles or silence is unfinished work and is rated as such.

## Scoring

Scoring is identical to end-to-end. Each `[[review_item]]` carries a point
weight, a `pass` earns it and a `fail` earns none, and the run's score is the
earned weight over the total declared weight. The score and the overall rating
are shown together on the run, and the case's
[leaderboard](/components/site/overview/) ranks models by points. Publishing a
completed run requires at least one review, so every published full-stack
implementation was played and judged by a person, code and assets alike.
