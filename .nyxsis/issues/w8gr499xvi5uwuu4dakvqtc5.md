---
format: nyxsis-issue
version: 2
id: w8gr499xvi5uwuu4dakvqtc5
zone: RUN
number: 2
title: Classify every run the platform ended as infrastructure
type: generic
state: done
created: 2026-10-19T00:36:48.27058678Z
done: 2026-10-19T16:32:34.748682534Z
---

Runs the Test Cabinet's own platform ended are recorded as model outcomes.
`classify_exit` in `crates/driver/src/gg_exec.rs` maps every non-zero gg exit
other than `3` to `HarnessInvocation`, so a gg killed with `SIGKILL` by a
deleted sandbox pod (exit `137`) and an exec that returned no status (`-1`)
become `harness_error`. A gg exec that reported `0` with no `session_ended`
event, which is what a pod that died mid-turn can report, is collected,
validated and scored, and lands as `catastrophic`. The third-party path does
the same through `HarnessInvocation` in `crates/driver/src/harness_registry.rs`.

On `master` a session the container session log holds without its closing
marker fails the run with `HarnessSessionLost`, classified `infrastructure`
(`crates/core/src/orchestrator.rs`, commit `dea3573c4`). On `nightly` the same
condition in `crates/driver/src/orchestrator.rs` only emits a "usage
incomplete" warning and goes on to score the half-written tree, and
`HarnessSessionLost` is absent from `crates/driver/src/error.rs`.

The documentation lists every end the platform caused as `infrastructure` and
says how the driver tells one from the harness's own:

- `apps/docs/src/content/docs/components/contracts/run-records.md`, "Status"
- `apps/docs/src/content/docs/components/driver/execution.md`, "Attributing an
  end" and "Runtime limits"

## What is missing

- After a session's exec returns, and after the idle watchdog, the maximum
  runtime and cancellation are applied, the driver reading the sandbox pod and
  classifying the run `infrastructure` when the pod is gone or carries a
  `DisruptionTarget` condition, whatever the exit status.
- An exit code above 128 and an exit with no status (`-1`) classified
  `infrastructure` for gg and for every third-party harness, with a detail
  naming the code and the pod's reason.
- A gg exit `0` with no `session_ended` event classified `infrastructure`.
- `HarnessSessionLost` restored in `crates/driver/src/error.rs` and raised by
  `crates/driver/src/orchestrator.rs` when the container session log holds a
  session without its closing marker, ported from `master`'s
  `crates/core/src/orchestrator.rs`, with `classify_failure` in
  `crates/driver/src/run_record.rs` mapping it to `Infrastructure`.
- Each of these runs ending before validation, with its record carrying the
  metrics and events gathered so far.

## Verify

- Unit tests over the classification: exit `137`, `143` and `-1` each give
  `infrastructure`; exit `1` with a live pod gives `harness_error`; exit `3`
  gives `limit_exceeded`.
- A test with a fake runtime whose sandbox is reported deleted, and one whose
  pod carries `DisruptionTarget`, each give `infrastructure` with exit `0` and
  with exit `1`.
- A gg test streams telemetry with no `session_ended` and exits `0`, and sees
  `infrastructure` with no validation summary.
- The `master` orchestrator tests for a session log without its closing
  marker, ported, pass against `crates/driver/src/orchestrator.rs`.
