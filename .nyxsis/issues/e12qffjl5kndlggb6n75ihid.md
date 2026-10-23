---
format: nyxsis-issue
version: 3
id: e12qffjl5kndlggb6n75ihid
zone: DATA
number: 5
title: Recognize dead publishers and retry failed publishes
type: generic
state: done
depends_on:
  - s6w5mx066ipgbht3fkhxnbki
created: 2026-10-19T00:38:20.886775153Z
done: 2026-10-19T23:53:43.089112056Z
outcome: |
  Landed as superrepo PR 4461 into nightly: publish-job leases with the renew,
  active and lost routes under the service token, the backend's failed-publish
  retry pass (5 min doubling to 4 h within 24 h) and hour-long abandonment sweep,
  the dispatcher renewing publish leases, reporting lost publishers and giving
  publisher Jobs a 45-minute activeDeadlineSeconds. Left: the staging check
  (delete a publisher pod, see the job fail within two minutes and retry five
  minutes later) was not run because staging runs older images and the private AKS
  cluster is unreachable from here; Kubernetes enforcing the deadline and the
  Postgres path were covered by unit tests only.
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
