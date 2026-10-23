---
format: nyxsis-issue
version: 2
id: fjzi5csv2xodvyj7qz6pw2tq
zone: RUN
number: 1
title: Hand a finished run to durable storage before the driver exits
type: generic
state: done
created: 2026-10-19T00:36:36.216805336Z
done: 2026-10-19T15:36:04.199235552Z
---

A finished run's result lives only on the driver pod's disk until its one
terminal report lands, and that report is a single attempt. `post_status` in
`crates/driver/src/client.rs` sends once, and `main` in
`crates/driver/src/main.rs` exits non-zero when it fails. The dispatcher then
reports the job failed or lost, the backend records `infrastructure` with no
record, and the automatic retry runs the whole paid-for run again.

The uploads before it are single attempts too. `upload_run_tree` in
`crates/driver/src/artifacts.rs` posts the tree once and the caller only logs a
failure, and the bundle upload does the same. The upload retry, the `storing`
report and the held record that prod runs (`UploadRetry`, `RunWait::holding`
and `retry_until_stored` in `crates/driver/src/artifacts.rs` on `master`,
commit `cc1cd73ab`) are absent from `nightly`, and the `storing` state,
`artifactsStored` and `storeFault` are absent from `DriverState` and
`StatusUpdate` in `contracts/crates/contracts/src/job_api.rs`. Nothing
handles `SIGTERM`.

The documentation states the finishing sequence:

- `apps/docs/src/content/docs/components/driver/overview.md`, "Finishing a
  run", "Retries", "Late terminal reports", "Termination", "Artifacts" and
  "The implementation bundle"
- `apps/docs/src/content/docs/components/driver/execution.md`, "Artifact
  collection"
- `apps/docs/src/content/docs/components/dispatcher/overview.md`, "The driver
  Job", "Death detection" and "Lost drivers"
- `apps/docs/src/content/docs/components/backend/api.md`, "The held record"
  and "Leases and lost jobs"

## What is missing

- The `storing` driver state with `artifactsStored` and `storeFault` on the
  status update, and the record carried on the first `storing` report.
- The driver posting the held report as soon as the record is written, before
  any upload, on the succeeded, failed and canceled paths alike.
- One retry policy for every finishing call: 5, 10, 20 and 40 seconds and then
  60 seconds between attempts, ending at once on a `4xx` other than `408` and
  `429` or on the run's own upload failure (`413`, `400`, `422`, a tree that
  cannot be tarred).
- `TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS` bounding each upload and
  `TCAB_DRIVER_REPORT_WAIT_SECONDS` bounding the held and terminal reports,
  each defaulting to `21600`, `0` meaning a single attempt and an unparsable
  value stopping the driver; the dispatcher forwarding both.
- The tree upload ported from `master`'s `UploadRetry` and stall detection,
  with a repeated `storing` report after each failed attempt.
- The bundle upload retried under the same policy, writing to a key of the
  run id that a repeat replaces.
- The terminal report retried until it lands, is refused, or the report
  deadline passes; the driver exiting successfully on landing or refusal and
  non-zero only at the deadline.
- An operator cancellation ending any wait, with the driver then posting
  `canceled` carrying the record; an already-canceled gg run retrying each
  upload for at most ten minutes.
- A `SIGTERM` handler: with a record, post the held report at once and keep
  finishing until the grace ends; without one, report `failed` with state
  `infrastructure` and the detail `driver interrupted by SIGTERM` naming the
  stage. Both delete the sandbox before exiting.
- The backend storing the held record in Postgres against the job, and
  finishing a job reported dead or lost from it with the state the run
  reached and no retry.
- The backend answering a repeated terminal report with success when the job
  already holds that state, and accepting a terminal report for a job already
  reported lost: recording the run from it and withdrawing the retry the lost
  outcome enqueued, canceling it when it was already claimed.
- The driver `Job`'s `terminationGracePeriodSeconds` set from
  `TCAB_DISPATCHER_DRIVER_TERMINATION_GRACE_SECONDS` (default `120`) in
  `crates/dispatcher/src/job.rs`.

## Verify

- A test runs the finishing sequence against a backend that refuses every
  call for a minute with `503`, then accepts: the held report, every upload
  and the terminal report each land once, and the driver exits successfully.
- A test makes the artifacts service answer `413`: the upload ends after one
  attempt and the terminal report carries `artifactsStored: false`.
- A test with a report deadline of a few seconds and a backend that never
  answers sees the driver exit non-zero after the held report was attempted
  first.
- A test sends the driver `SIGTERM` mid-session and sees a `failed` report
  with state `infrastructure` and the sandbox deleted; another sends it
  during the uploads and sees the held report already accepted.
- A test repeats the tree upload and the bundle upload and finds one stored
  copy of each.
- A backend test reports a job lost after its held report, and sees the run
  recorded from the held record with no retry enqueued; another reports it
  lost with no held record, then posts a terminal report, and sees the record
  kept and the queued retry withdrawn.
- `crates/dispatcher/src/job.test.rs` asserts the grace period and the two
  forwarded deadlines on the built `Job`.
