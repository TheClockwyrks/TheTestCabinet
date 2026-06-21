---
title: Terminology
---

## Backend

The [backend](/components/backend/overview/) is The Test Cabinet's single private
service. It is the canonical source of test case definitions for runners and the
system of record for published run results.

## Catalog

The term "catalog" is used to refer to The Test Cabinet's full set of test
cases.

## Domain

A scoring domain is a facet of a test case the reviewer rates independently —
for example a game's single-player and versus modes. A case declares one or more
domains; the reviewer assigns a [rating](#rating) to each while playing the
build, and the run's **overall rating** is the *worst* across them, so a flawless
mode cannot mask a broken one. A [review item](#reviewer-checklist) may roll up
to a domain, or stay general when it applies to every mode.

## Harness

In the context of The Test Cabinet, "harness" can refer to two elements:

1. The Test Cabinet itself
2. Agentic harnesses used to drive model(s)

The Test Cabinet handles running other harnesses. It does not directly hit LLM
APIs or implement an agentic loop. That responsibility lies entirely with the
agentic harnesses that The Test Cabinet uses to run the tests.

## Leaderboard

Each test case has a per-variant leaderboard ranking the models that have scored
runs of it. A model appears once, represented by its best-scoring run; the
ranking is by [score](#score) (points), not by rating.

## Model

Models are the large language models that determine the actions an agentic
harness takes.

## Orchestrator

An orchestrator decides how a run's [harness](#harness) sessions are conducted —
how many sessions to drive, what each is told, and when the work is done — while
the harness still owns each individual session. It is distinct from the
agentic harness (which performs the work of a single session) and from the
[runner](#runners)/[reporter](#reporters) component terms (which name The Test
Cabinet components that execute and report runs): an orchestrator is selected per
run, defaults to `one-shot` (a single session), and is harness-agnostic. See
[Orchestrators](/orchestrators/overview/).

## Publishing

"Publishing" refers to releasing an implementation to GitHub and uploading its
run record to The Test Cabinet's [backend](/components/backend/overview/), from
which a public snapshot is exported for the website. Test runs exist only locally
until published.

## Rating

A rating is the reviewer's subjective quality tier for one [domain](#domain) of a
run — one of `flawless`, `great`, `scuffed`, or `broken`. A run carries one
rating per domain; its **overall rating** is the worst across them.

## Reporters

Reporters are The Test Cabinet components capable of reporting run results. Only
GUI reporters allow users to interact with test case implementations. The
[Tauri desktop app](/components/tauri/overview/) and the
[web console](#web-console) are both reporters (and runners).

## Review

All test cases are manually reviewed after the implementation is complete. This
allows the reviewer to assess how well a model matched the spec, check for any
bugs, and otherwise provide non-automated feedback about the run result. Reviews
are slightly subjective since games don't map cleanly to a rigid grading scale.
A review carries a per-domain [rating](#rating), a prose writeup, and a verdict on
each [reviewer-checklist](#reviewer-checklist) item the case declares. The
verdicts and item [weights](#score) together produce the run's numeric score.

## Reviewer Checklist

A test case may declare a reviewer checklist: a list of major, observable
requirements that every reviewer must explicitly verify by playing the build.
Each item carries a point **weight**. The [consoles](#web-console) present it as a
guided review with a completeness gate — every item needs a binary verdict (pass
/ fail) before a review can be saved or the run published. The checklist is
reporter-side and is never seeded, so it never reaches the model.

## Run Records

A run record is produced each time a test case runs to completion. This records
all information from the run, such as its run time, version information, and
token/cost data.

## Runners

The term "runner" is used to refer to any The Test Cabinet component that is
capable of running test cases — the [CLI](/components/cli/overview/), a
[worker](#worker), the desktop app's built-in local worker, and the
[core](/components/core/overview/) they all build on.

## Score

A run's score is its earned points over the points available: each
[reviewer-checklist](#reviewer-checklist) item is worth a `weight`, a `pass`
earns that weight and a `fail` earns none, and the total is the sum of every
declared item's weight. It is shown on the run alongside the per-domain
[ratings](#rating) and is what the per-case [leaderboard](#leaderboard) ranks on.

## Snapshot

A snapshot is the public export the [backend](#backend) produces from its
published results. The static [public site](/components/site/overview/) is built
from this snapshot, so the gallery keeps no live dependency on the backend.

## Test Case

Test cases provide the scenarios used for testing. Each test case represents
some isolated task that a harness/model must perform.

## Validation

The Test Cabinet makes use of a small amount of automated validation. These are
used for basic checks like "Does this implementation even build?" or "How well
does the implemented UI match the reference image?".

## Variant

Test cases may define multiple variants, which identify modifications to make to
the specifications provided as input for the test. These variants may change
game mechanics, add or remove content, and may noticeably affect the difficulty
of a test case.

## Web Console

The [web console](/components/web/overview/) is The Test Cabinet's
runner/reporter GUI running in a plain browser. It is the same console as the
[Tauri desktop app](/components/tauri/overview/), sharing its entire UI, but is
delivered as a static web app and executes runs on remote [workers](#worker)
rather than a built-in local one. It is an operator tool, served on the private
network, not a public site.

## Worker

A [worker](/components/worker/overview/) exposes the core's run functionality
over an HTTP API, so a test case can be executed on a remote machine. Workers are
the execution backend for the [web console](#web-console); the desktop app ships
with its own built-in local worker.
