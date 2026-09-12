---
title: Run Records
---

## Overview

A run record is the data contract produced by every run. It is what the testing
harness emits, what the driver reports to the backend, and what the site
consumes, so its shape is fixed.

A run's [reviews](/components/core/results/#reviews) are authored separately and
travel alongside the record rather than inside it.

A run record must be serialized in a machine-readable format such as JSON and
stored with the run's other artifacts. It is written locally beside those
artifacts when a run finishes (see [Co-located run
files](#co-located-run-files)) and reported to the backend by the driver.

The record's JSON Schema is published at
<https://docs.testcabinet.ai/schema/core/run-record.schema.json>. The
[backend's API and snapshot](/components/backend/api/) contracts reference that
schema rather than redefining the record, so there is one source of truth for its
shape.

## Contents

A run record must capture at least the following.

### Identity

- A unique run ID.
- The time the run started and the time it finished.

### Subject

- The test case slug and the exact test case version that was run.
- The [test type](/testing/overview/) the case belongs to.
- The slug of the [variant](/testing/end-to-end/overview/#variants) that was run.
  Exactly one variant runs per run.
- The agent harness slug and, where available, the harness version.
- The resolved slug of the [orchestrator](/components/core/orchestrators/) that
  conducted the run's harness sessions. For an external orchestrator directory
  this is the directory's own manifest slug.
- The slug of the [engine](/components/core/engines/) the build was produced
  against and the exact engine version resolved for the run. A run with no engine
  records the slug `none` and no version.
- The model ID that was used. A [gg](/gg/overview/) run binds models to slots, so
  it records its primary slot's model as its representative identity.

A gg run additionally records the capability set it was configured with and, for
a run that completed a session, its session summary. Both are absent for a
third-party-harness run.

### Tooling

Provenance for the Test Cabinet build that orchestrated the run, distinct from
the harness it drove:

- The Test Cabinet commit the run's binary was built from, stamped into the
  binary at build time. It is suffixed with `-dirty` when built from a modified
  working tree, and is `null` when the build could not determine it, such as a
  build with no git repository.

### Environment

The container environment the run executed in, captured from inside the run
container so it reflects what the harness actually built in:

- The container OS, taken from `/etc/os-release`'s `PRETTY_NAME`, or `unknown`
  when it could not be probed.
- The run-container image the run executed in, resolved to its registry digest
  reference where it has one (for example
  `ghcr.io/<org>/test-cabinet-base-wasm@sha256:…`) so the record pins the exact
  image bytes even when the image was launched by a mutable tag. A purely local
  image with no registry digest records the reference it was launched by.
- The Node.js version reported by `node --version`, where it could be determined.
- The [authentication mode](/components/core/harnesses/#authentication) the run
  used. This is how the run's cost should be read: an API-key run is billed
  against that key, while a subscription run carries no per-run provider charge.

### Metrics

- Run time and the setup, session, teardown and validation durations, as defined
  in [Metrics](/components/core/metrics/#durations).
- The four token classes, as defined in
  [Metrics](/components/core/metrics/#tokens).
- Comparable cost and actual cost, as defined in
  [Metrics](/components/core/metrics/#cost).

### Validation

A summary of the [validation](/components/core/validation/) results: the outcome
of the required install and build steps, whether the implementation loaded, the
similarity signal from each declared check, a proof result per declared
proof-of-implementation artifact, and a debug-script result per validated verdict
unit. Each install or build step that ran carries a bounded excerpt of its
captured output, and the install carries the number of attempts it took.

Each validated verdict unit carries one entry per media output its checklist item
declares, recording the output's id, its display name, its kind, and whether the
build produced it. A kind is one of three:

| Kind     | Holds                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------- |
| `image`  | A still image (`png`, `jpg`, `jpeg`, `webp`, `gif`).                                               |
| `video`  | A video clip, captured as `webm` and published as `mp4`.                                           |
| `replay` | A draw-command [recording](/components/core/engines/#recording), captured and published as `json`. |

The same kinds label a declared proof, whose kind is inferred from the path the
build wrote it to. A reference view is an image or a video, because a recording
carries no picture of its own to commit as a mockup. A run that produced no media
for a declared output records it absent.

A run of another test type carries that type's own result block in place of the
end-to-end checks. An [asset-generation](/testing/asset-generation/overview/) run
records the run-root-relative paths to its produced media, its recorded action
log, and its recorded operation count. The media it carries depends on the [asset
kind](/testing/asset-generation/overview/#asset-kinds). A 2D sprite or
sprite-sheet run carries the image regenerated from the action log, the model's
on-disk preview, and the cheat divergence between them, recorded rather than
gated. A model run carries its emitted geometry and the binary's rendered
preview. When the run finishes these files are uploaded and served back as
per-run media under `/runs/<id>/asset/<file>`.

### Showcase

The run's [showcase](/components/core/showcase/), when the produced tree carried
a readable one: the player-facing markdown description and the ordered media
carousel, each entry recording its file name, its caption, and its kind on the
same three-kind scale as validation media. The field is optional. A run whose
tree carried no parseable showcase omits it, and a showcase problem never changes
the run's status.

### Links

- A link to the public repository holding the run's generated source.
- A link to the playable build, when one has been released. The build is deployed
  publicly at [publish](/components/core/results/#publish); before that, a
  produced run's build is playable for review off the [artifact
  service](/components/artifacts/overview/).

### Status

The run's terminal state, with enough detail to understand a failure. One of:

- `completed`: the harness exited cleanly and the run produced a usable,
  evaluable implementation. Scored on the reviewer checklist: on a
  [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run by its
  validators, overlaid with any reviewer overrides, and on a legacy run by its
  reviewers.
- `catastrophic`: the harness exited cleanly, meaning the model claimed
  completion, but the output did not build or load, so there was no playable
  build and nothing to evaluate. A publishable model failure with no review
  checklist, reported as a separate catastrophic-failure statistic. Reserved for
  a total failure to produce a runnable artifact: a tree with no `package.json`,
  or one whose build or load failed after its dependency install succeeded. An
  output that builds and loads is reviewed however badly it behaves.
- `timed_out`: the run hit its maximum runtime and was stopped before the harness
  finished, meaning the model never converged. A publishable tier distinct from
  `catastrophic`, likewise unscored.
- `harness_error`: the agent harness, or the orchestrator runner driving it,
  exited non-zero. A reportable model outcome, publishable without a review, and
  the one publishable tier that releases no source repository and no playable
  build. It is recorded only as a per-model harness-error statistic. Publishing
  is deliberate rather than automatic, because a subscription auth-token refresh
  also surfaces as a non-zero exit and must be left unpublished.
- `limit_exceeded`: the agent harness stopped the run on one of the [execution
  ceilings](/gg/execution-limits/) its configuration armed, covering a turn
  count, a wall-clock budget, a spend, and a tolerance for failing turns. The
  model spent its whole allowance without finishing, which is a reportable model
  outcome, so it is published exactly like a `harness_error` and releases no
  source repository and no playable build. It is the one harness stop that is
  never retried: a breached ceiling is a property of the configuration, so a
  second attempt reaches the same bound. Only [gg](/gg/overview/) reaches this
  state, because gg is the only harness whose ceilings the Test Cabinet
  configures.
- `hung`: the agent harness stopped producing output altogether and was killed by
  the idle watchdog. It stalled on a provider request that never returned or a
  subagent that never reported back. Published exactly like `harness_error`, with
  no exit code to report. The watchdog sits well below the platform's own idle
  limits, so a run's fate is decided here and a case's `max_runtime_hours` stays
  reachable however long it is.
- `infrastructure`: the Test Cabinet's own infrastructure failed, covering a
  container that would not start or pull, an OOM-killed pod, a failure in
  seeding or the case's init step, and a collected tree whose
  [dependency install](/components/core/validation/#the-dependency-install) did
  not succeed after its retries. Retained with a diagnostic detail giving the
  reason, never publishable, and excluded from every model statistic. A run
  that reached the install carries its collected tree and its validation
  summary.
- `canceled`: an operator killed a [gg](/gg/overview/) run before it finished.
  Retained, visible, and inspectable, never publishable, and excluded from every
  model statistic, because nothing about the model can be concluded from a run a
  human ended.

A kill is a request to a gg session to wind down rather than a teardown, so a
canceled gg run is recorded through the same post-session path as any other run.
It carries its real [metrics](#metrics), the collected working tree as it stood
at the last completed turn, its session summary, and everything it streamed
before the kill. Its [validation](/components/core/validation/) summary is empty
rather than failed, because validation is fresh work on an implementation the run
was told to stop writing. Two degraded paths yield a bare record instead: a
session that will not wind down inside its grace period, and a run that errors on
the way out.

Killing a run of any other harness produces no record. Such a harness has no
wind-down to ask for, so the [driver](/components/driver/overview/#cancellation)
destroys the run instead of waiting on it. A run that reached its own ending
before its driver noticed the kill is not destroyed, but it still records
nothing: the backend accepts no terminal status on a canceled job other than a
driver's `canceled` acknowledgement, so the record it posts is turned away.

#### Failure detail style

A failure detail reports the error, not the error handling. It is one terse
declarative clause that reads on its own, naming its own subject rather than
borrowing one from the caller that wraps it. Exactly one layer supplies the
verb that claims the failure: a wrapping layer names the stage it was running
and leaves that verb to the layer inside it, as in `run failed: collecting run
artifacts: {detail}`, and a layer that wraps nothing keeps the verb itself, as
in `seeding {dest} in run pod {pod} failed: {detail}`.

Parentheses carry figures and a bare inner clause, and a colon introduces a
nested message that is itself a sentence. The subsystem word is carried wherever
the slug alone leaves the failing part ambiguous, and the slug stands alone
where the rest of the clause already names the subsystem, as in `gg execution
ceiling hit`.

Every figure the failure carries is kept, covering limits, thresholds, observed
values, ids, exit codes, statuses, environment variable names, config keys, file
paths, and the command that resolves the condition. `set TCAB_CONTAINER_RUNTIME
to override` is data about the error and stays, while `stopping rather than
spending the rest of the run on the same failure` narrates the handling and is
dropped. A message carries at least one figure, and when the inner layer
supplies none the outer layer contributes the ones it holds, such as an exit
code or a terminal status. Where one function renders several variants of a
single condition, covering ceilings on turns, runtime, spend, error rate, and
consecutive errors, the variants share one grammar and each names both the
observed value and the configured limit.

A gg execution-ceiling stop reads `run failed: gg execution ceiling hit (5
consecutive turns failed)`.

### Recorded context

- The seed commit: the hash of the single commit made after the specs, assets,
  and rendered reference images were laid down and before the container started.
  Everything reachable from it is scaffolding the run was given, and everything
  else in the produced tree is the model's own work. It is computed on the host,
  which is why it is authoritative over any commit read back out of the produced
  tree. Absent for a run that failed before its workspace was seeded.
- Tool calls: how many times each tool the harness's agent invoked was called
  over the run, keyed by lowercased raw tool name, including tools recognized
  without emitting an event. A gg run carries none, since its per-tool detail
  comes from its own telemetry.
- The bounded tier of the run's [code analysis](/gg/analysis/code-analysis/): a
  deterministic, execute-nothing static read of the code the model wrote,
  computed after the tree is collected and before validation rewrites it. Nothing
  in it influences the run's score or verdict.
- For a [game-jam](/testing/game-jam/overview/) run, the gameplay `README.md` the
  run produced, captured from the produced tree and truncated past a fixed size
  cap, and a reference to each prior entry the run was seeded with and briefed to
  build something distinct from.

## Co-located run files

The record is written into a per-run directory alongside the run's other
artifacts:

- `run-record.json`: the run record described above.
- `implementation/`: a copy of the produced working tree. Any
  proof-of-implementation files the build wrote live here at their declared
  `dest`. When the run finishes, each present proof is uploaded to the [artifact
  service](/components/artifacts/overview/) and served back as per-run media
  (`/runs/<id>/proof/<proof-id>.<ext>`) so a reviewer compares the submitted
  evidence against the expected reference. A
  [showcase](/components/core/showcase/) the model wrote lives here at
  `showcase/`, and its files are uploaded and served back the same way
  (`/runs/<id>/showcase/<file>`).
- `raw.jsonl`: the harness's raw output, one JSON object per captured line in
  arrival order, each tagging the [stream](/components/core/events/) the line
  came from and the line's verbatim text.
- `events.jsonl`: the [normalized events](/components/core/events/) translated
  from that raw output, one event per line, in the order they were produced.
- `code-analysis.json.gz`: the unbounded tier of the run's [code
  analysis](/gg/analysis/code-analysis/), holding every authored file, symbol,
  import edge, cycle, and clone group. It is written at the run tree's root and
  mirrored into the backend to be served per run. `implementation/` stays a
  verbatim copy of what the model produced. A gg run's [session
  record](/gg/analysis/session-records/) sits beside it as `replay.json.gz` under
  the same convention.
- `writeup.md`: a local [review](/components/core/results/#reviews) of the run,
  when one has been written. This is the operator's own review, used by the solo
  [`tcab publish`](/components/core/results/#combined-review-and-publish) path,
  which publishes a validator-rated run without one. A produced run can
  accumulate further reviews from other accounts, which are held on the backend
  rather than beside the run on disk.

Replaying `raw.jsonl` through the harness layer's translation reproduces
`events.jsonl`, so a run's event classification is auditable and a real run
doubles as a fixture for checking the parsing logic.
