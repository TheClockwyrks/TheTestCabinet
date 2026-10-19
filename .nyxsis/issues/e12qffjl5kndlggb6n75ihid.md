---
format: nyxsis-issue
version: 2
id: e12qffjl5kndlggb6n75ihid
zone: DATA
number: 5
title: Recognize dead publishers and retry failed publishes
type: generic
state: open
depends_on:
  - s6w5mx066ipgbht3fkhxnbki
created: 2026-10-19T00:38:20.886775153Z
---

A publisher Job that dies before reporting leaves its publish job `dispatched`
on nightly with nothing to end it: the publisher Job has no
`activeDeadlineSeconds`, no sweep records the job failed, the dispatcher's
death detection covers driver Jobs only, and a failed publish waits for an
operator. The documentation recognizes a dead publisher by three bounds and
retries a failed publish by itself for a day:
`apps/docs/src/content/docs/components/backend/results.md`, sections "A
publisher that stops" and "Retrying a failed publish", and section "Automatic
publishing" for the hand-off from an automatic publish. Master carries the
deadline, the sweep and the retry schedule in
`crates/dispatcher/src/job.rs` (`PUBLISH_ACTIVE_DEADLINE_SECONDS`),
`crates/backend/src/db.publish_retry.rs`, `crates/backend/src/publish_health.rs`
and `crates/backend/src/api/publish_retry.rs`, which nightly lacks.

## What is missing

- The dispatcher reporting a publish job held `dispatched` with no active
  publisher Job for two minutes as lost, with the service token, and the
  backend recording it failed.
- An `activeDeadlineSeconds` of 45 minutes on every publisher Job.
- The backend recording a publish job `dispatched` for an hour with no result
  as failed, with the reason that its publisher never reported, dated at that
  hour.
- The backend enqueuing the next publish job of each unpublished run whose
  latest publish job failed, on the page's schedule from 5 minutes doubling to
  4 hours, ending 24 hours after the run's first failed publish job, with the
  publish gate applied again before each retry and at most one publish job in
  flight per run.

## Verify

Tests cover the lost report, the deadline on the built Job, the sweep's
recorded instant, and the retry schedule and its end. On staging, deleting a
publisher pod mid-publish leaves its publish job failed within the dispatcher's
two minutes and a new publish job enqueued five minutes later that releases
the run. `make gate` passes in the dispatcher and backend checkouts.
