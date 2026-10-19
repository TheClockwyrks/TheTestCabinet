---
format: nyxsis-issue
version: 2
id: s6w5mx066ipgbht3fkhxnbki
zone: DATA
number: 4
title: Make every publish step safe to repeat
type: generic
state: open
created: 2026-10-19T00:36:18.627190718Z
---

A publish that stops partway can leave a run that publishing again cannot
release. The publisher commits the run's tree with the current time, so a
repeat after the push landed makes a commit with a different SHA, and the
plain push of `main` is refused as a non-fast-forward. A repeat after the Pages
deploy makes a second Pages deployment. Only the push retries; the download,
the deploy and the result report fail the publish on one transient error, and
the publisher has no `SIGTERM` handling. The documentation makes a publish
resumable and idempotent:
`apps/docs/src/content/docs/components/backend/results.md`, sections "Repeating
a step" and "A publisher that stops", and
`apps/docs/src/content/docs/components/repos/overview.md`, section
"Publishing". The requirements hold wherever the commit and push live, in the
publisher's `release.rs` today or in the repos service's publish route.

## What is missing

- The implementation commit made deterministic: the fixed message, author and
  committer `Clockwyrks <runs@clockwyrks.invalid>`, and both dates set to the
  run's end time from its record, on top of the tree's tip.
- The push treating a remote whose `main` already holds the same tree as a
  success, whatever commit carries it.
- The Pages deploy carrying the digest of the scrubbed build as the
  deployment's commit hash, and first looking up the run's branch for a
  deployment with that digest, reusing one it finds and reporting its URL.
- Retries with backoff on a transient failure of the download, the Pages
  deploy, the repository publish and the result report.
- The backend accepting a repeated success result for a published run,
  re-asserting the same links and keeping its publication time.
- The publisher handling `SIGTERM`: it starts no further step, finishes the
  step it is on when that ends within the termination grace period, abandons
  it otherwise, and reports the publish failed with the reason that it was
  interrupted.

## Verify

Tests show that committing the same tree twice gives the same SHA, that a
push to a remote already holding the tree succeeds, that a deploy finding a
deployment with the build's digest makes none, and that `SIGTERM` mid-step
reports an interrupted failure. On staging, deleting the publisher pod after
the push and before the deploy and then publishing again releases the run with
the repository's `main` at the first SHA and one Pages deployment on the run's
branch. `make gate` passes in the publisher and backend checkouts.
