---
title: Run Records
---

## Overview

A run record is the data contract produced by every run. It is what the testing
harness emits, what the [driver](/components/driver/overview/) reports to the
[backend](/components/backend/overview/), and what the
[site](/components/site/overview/) consumes. Every other part of the system is
built around producing or reading this record, so its shape is fixed.

A run's [reviews](/components/core/results/#reviews) are authored separately and
travel alongside the record rather than inside it.

A run record must be serialized in a machine-readable format such as JSON and
stored with the run's other artifacts. It is written locally beside those
artifacts when a run finishes (see [Co-located run
files](#co-located-run-files)) and reported to the backend by the driver.

The record's JSON Schema is published at
<https://docs.testcabinet.ai/schema/core/run-record.schema.json>. The
[backend's API and snapshot](/components/backend/api/) contracts reference that
schema rather than redefining the record, so there is one source of truth for
its shape.

## Contents

A run record must capture at least the following.

### Identity

- A unique run ID.
- The time the run started and the time it finished.

### Subject

- The test case slug and the exact test case version that was run.
- The [test type](/testing/overview/) the case belongs to, recorded so a reader
  knows which validation shape to expect and the UI can pick the right result
  view without re-fetching the definition.
- The slug of the [variant](/testing/end-to-end/overview/#variants) that was
  run. Exactly one variant runs per run, and recording it attributes the result
  to a specific build of the case.
- The agent harness slug and, where available, the harness version.
- The resolved slug of the [orchestrator](/components/core/orchestrators/) that
  conducted the run's harness sessions. For an external orchestrator directory
  this is the directory's own manifest slug.
- The slug of the [engine](/components/core/engines/) the build was produced
  against and the exact engine version resolved for the run. A run with no engine
  records the slug `none` and no version.
- The model ID that was used. A [gg](/gg/overview/) run binds models to slots,
  so it records its primary slot's model as its representative identity.

A gg run additionally records the capability set it was configured with and, for
a run that completed a session, its session summary. Both are absent for a
third-party-harness run.

### Tooling

Provenance for the Test Cabinet build that orchestrated the run, distinct from
the harness it drove:

- The Test Cabinet commit the run's binary was built from, suffixed with
  `-dirty` when built from a modified working tree, or `null` when the build
  could not determine it, such as a build with no git repository. It is stamped
  into the binary at build time and lets a result be traced back to the exact
  orchestrator code that produced it.

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
- The Node.js version reported by `node --version`, where it could be
  determined.
- The [authentication mode](/components/core/harnesses/#authentication) the run
  used. This is how the run's cost should be read: an API-key run is billed
  against that key, while a subscription run carries no per-run provider charge.

The harness version lives in the subject rather than here.

### Metrics

- Run time, as defined in [Metrics](/components/core/metrics/#run-time).
- The four token classes, as defined in
  [Metrics](/components/core/metrics/#tokens).
- Comparable cost and actual cost, as defined in
  [Metrics](/components/core/metrics/#cost).

### Validation

A summary of the [validation](/components/core/validation/) results: the outcome
of the required install and build steps, whether the implementation loaded, the
similarity signal from each declared check, a proof result per declared
proof-of-implementation artifact, and a debug-script result per validated
verdict unit.

Each validated verdict unit carries one entry per media output its checklist
item declares, recording the output's id, its display name, its kind, and
whether the build produced it. A kind is one of three:

| Kind | Holds |
| --- | --- |
| `image` | A still image (`png`, `jpg`, `jpeg`, `webp`, `gif`). |
| `video` | A video clip, captured as `webm` and published as `mp4`. |
| `replay` | A draw-command [recording](/components/core/engines/#recording), captured and published as `json`. |

The same kinds label a declared proof, whose kind is inferred from the path the
build wrote it to. A reference view is an image or a video, because a recording
carries no picture of its own to commit as a mockup. A run that produced no
media for a declared output records it absent, which is a fact about the
evidence rather than about the verdict.

A run of another test type carries that type's own result block in place of the
end-to-end checks. An [asset-generation](/testing/asset-generation/overview/)
run records the run-root-relative paths to its produced media, its recorded
action log, and its recorded operation count. The media it carries depends on
the [asset kind](/testing/asset-generation/overview/#asset-kinds). A 2D sprite
or sprite-sheet run carries the image regenerated from the action log, the
model's on-disk preview, and the cheat divergence between them, recorded rather
than gated. A model run carries its emitted geometry and the binary's rendered
preview. When the run finishes these files are uploaded and served back as
per-run media under `/runs/<id>/asset/<file>`.

### Links

- A link to the public repository holding the run's generated source.
- A link to the playable build, when one has been released. The build is
  deployed publicly at [publish](/components/core/results/#publish); before
  that, a produced run's build is playable for review off the [artifact
  service](/components/artifacts/overview/).

### Status

The run's terminal state, with enough detail to understand a failure. One of:

- `completed`: the harness exited cleanly and the run produced a usable,
  evaluable implementation. Scored on the reviewer checklist: by its validators
  on a [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run,
  by its reviewers on a legacy run.
- `catastrophic`: the harness exited cleanly, meaning the model claimed
  completion, but the output did not build or load, so there was no playable
  build and nothing to evaluate. A publishable model failure with no review
  checklist, reported as a separate catastrophic-failure statistic. Reserved for
  a total failure to produce a runnable artifact: an output that builds and
  loads is reviewed however badly it behaves.
- `timed_out`: the run hit its maximum runtime and was stopped before the
  harness finished, meaning the model never converged. A publishable tier
  distinct from `catastrophic`, likewise unscored.
- `harness_error`: the agent harness, or the orchestrator runner driving it,
  exited non-zero. A reportable model outcome, publishable without a review, and
  the one publishable tier that releases no source repository and no playable
  build. It is recorded only as a per-model harness-error statistic. Publishing
  is deliberate rather than automatic, because a subscription auth-token refresh
  also surfaces as a non-zero exit and must be left unpublished.
- `limit_exceeded`: the agent harness stopped the run on one of the
  [execution ceilings](/gg/execution-limits/) its configuration armed, covering a
  turn count, a wall-clock budget, a spend, and a tolerance for failing turns.
  The model spent its whole allowance without finishing, which is a reportable
  model outcome, so it is published exactly like a `harness_error` and releases
  no source repository and no playable build. It is the one harness stop that is
  never retried: a breached ceiling is a property of the configuration, so a
  second attempt reaches the same bound. Only [gg](/gg/overview/) reaches this
  state, because gg is the only harness whose ceilings the Test Cabinet
  configures.
- `hung`: the agent harness stopped producing output altogether and was killed
  by the idle watchdog. It stalled on a provider request that never returned or
  a subagent that never reported back. Published exactly like `harness_error`.
  It is its own tier because nothing exited, so there is no exit code to report.
  A hang is the one failure the Test Cabinet ends on its own timer: the watchdog
  sits well below the platform limits, such as the kubelet closing an exec
  stream idle for four hours, so a run's fate is decided here and a case's
  `max_runtime_hours` stays reachable however long it is.
- `infrastructure`: the Test Cabinet's own infrastructure failed, covering a
  container that would not start or pull, an OOM-killed pod, and a failure in
  seeding or the case's init step. Retained with a diagnostic detail, never
  publishable, and excluded from every model statistic. A harness that exited
  non-zero is a `harness_error` and one that stopped responding is `hung`.
- `canceled`: an operator killed the run before it finished. Retained, visible,
  and inspectable, never publishable, and excluded from every model statistic,
  because nothing about the model can be concluded from a run a human ended.

A kill is a request to wind down rather than a teardown, so a canceled
[gg](/gg/overview/) run is recorded through the same post-session path as any
other run. It carries its real [metrics](#metrics), the collected working tree
as it stood at the last completed turn, its session summary, and everything it
streamed before the kill. Its [validation](/components/core/validation/) summary
is empty rather than failed, because validation is fresh work on an
implementation the run was told to stop writing. Two degraded paths yield a bare
record instead: a session that will not wind down inside its grace period, and a
run that errors on the way out. A third-party harness always takes one of them
(see the [driver](/components/driver/overview/#cancellation)).

### Recorded context

- The seed commit: the hash of the single commit made after the specs, assets,
  and rendered reference images were laid down and before the container started.
  Everything reachable from it is scaffolding the run was given, and everything
  else in the produced tree is the model's own work. It is computed on the host,
  where nothing the model does can affect it, which is why it is authoritative
  over any commit read back out of the produced tree. Absent for a run that
  failed before its workspace was seeded.
- Tool calls: how many times each tool the harness's agent invoked was called
  over the run, keyed by lowercased raw tool name, including tools recognized
  without emitting an event. A gg run carries none, since its per-tool detail
  comes from its own telemetry.
- The bounded tier of the run's [code analysis](/gg/analysis/code-analysis/): a
  deterministic, execute-nothing static read of the code the model wrote,
  computed after the tree is collected and before validation rewrites it.
  Nothing in it influences the run's score or verdict.
- For a [game-jam](/testing/game-jam/overview/) run, the gameplay `README.md`
  the run produced, captured from the produced tree and truncated past a fixed
  size cap, and a reference to each prior entry the run was seeded with and
  briefed to build something distinct from.

## Co-located run files

The record is written into a per-run directory alongside the run's other
artifacts:

- `run-record.json`: the run record described above.
- `implementation/`: a copy of the produced working tree. Any
  proof-of-implementation files the build wrote live here at their declared
  `dest`. When the run finishes, each present proof is uploaded to the [artifact
  service](/components/artifacts/overview/) and served back as per-run media
  (`/runs/<id>/proof/<proof-id>.<ext>`) so the reviewer UI can show the
  submitted evidence beside the expected reference.
- `raw.jsonl`: the harness's raw output, one JSON object per captured line in
  arrival order, each tagging the [stream](/components/core/events/) the line
  came from and the line's verbatim text.
- `events.jsonl`: the [normalized events](/components/core/events/) translated
  from that raw output, one event per line, in the order they were produced.
- `code-analysis.json.gz`: the unbounded tier of the run's [code
  analysis](/gg/analysis/code-analysis/), holding every authored file, symbol,
  import edge, cycle, and clone group. It is an analysis artifact, so it is
  written at the run tree's root and mirrored into the backend to be served per
  run. `implementation/` stays a verbatim copy of what the model produced. A gg
  run's [session record](/gg/analysis/session-records/) sits beside it as
  `replay.json.gz` under the same convention.
- `writeup.md`: a local [review](/components/core/results/#reviews) of the run,
  when one has been written. This is the operator's own review, used by the solo
  [`tcab publish`](/components/core/results/#combined-review-and-publish) path,
  which publishes a validator-rated run without one.
  A produced run can accumulate further reviews from other accounts, which are
  held on the backend rather than beside the run on disk.

Recording the raw output beside its translation makes a run's event
classification auditable: replaying `raw.jsonl` through the harness layer's
translation reproduces `events.jsonl`, so a real run doubles as a fixture for
checking the parsing logic. Shipping both files also lets the raw stream be
inspected directly when diagnosing a harness, and lets a harness's translation
be re-derived when its mapping improves.
