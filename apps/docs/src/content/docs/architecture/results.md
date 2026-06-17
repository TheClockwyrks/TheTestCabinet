---
title: Results
---

## Overview

A run's value is in its output: the implementation a model produced, together with
the metrics describing how it got there. The Test Cabinet publishes both so that
anyone can inspect, clone, and play the result. The final product is released as
it is, including any bugs and flaws, rather than being reduced to graphs or a
single percentage.

## Generated Code

Each published run's generated implementation must be released as its **own**
public git repository.

- Releasing each run as a standalone repository keeps results independent and maps
  cleanly onto per run hosting and embedding. See [Site](/architecture/site/#hosting).
- The generated implementation must include a README and any other documentation
  that a user needs to clone the repository and run it locally. Requiring this
  documentation is part of every test case.

## Run Record

Each published run's [run record](/architecture/run-records/) must be added to the dataset
the site is built from, with its links pointing at the run's source repository and
playable build.

## Publishing

Publishing a run must be an explicit operation that takes a finished run and:

- Releases its generated code to a public repository.
- Makes its playable build available for embedding.
- Adds its run record to the site's dataset.
- Includes the run's [review](#reviews) — its writeup and rating.

Publishing must refuse a run that has no review: a run cannot be released without
a hand-written writeup and a rating. This keeps every published implementation
framed by a human assessment rather than dropped onto the site as raw output.

The publish operation must be idempotent and must be usable in batch, so that a
sweep producing many runs can be published without manual handling of each one.
When publishing a batch, a single run missing its review must stop the batch
before anything is released, so a sweep is never left half published.

## Reviews

Every published run carries a hand-written **review**: a short
[writeup](/architecture/site/#implementation-writeups) the site shows before the playable
build, together with a **rating** that records the reviewer's overall assessment.

A review is curatorial — authored separately by a person after playing the
finished build, rather than emitted by a run — and it is **not** part of the
[run record](/architecture/run-records/) contract. The rating travels with the writeup (in
its frontmatter), not in the record. Publishing makes the review available to the
site alongside the run record.

The rating is one of four tiers, assigned by hand:

- **Flawless** — implemented according to spec with no noticeable bugs.
- **Great** — implemented according to spec; may have minor issues so long as
  they don't impact playability.
- **Scuffed** — mostly implemented according to spec. Playable, but may deviate
  from the spec or have bugs that impact playability.
- **Broken** — doesn't follow the spec, or has bugs severe enough to render the
  game unplayable.

The rating is a subjective, per-run signal. It is shown alongside a run but is
never aggregated or used to rank runs (see [Site](/architecture/site/)).
