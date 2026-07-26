---
title: Run Records
---

A run record is the data contract produced by every run. It is what the testing
harness emits, what the [driver](/components/driver/overview/) reports to
the [backend](/components/backend/overview/), and what the
[site](/components/site/overview/) ultimately consumes. Every other part of the
system is built around producing or reading this record, so its shape is
deliberately fixed. A run's [reviews](/components/core/results/#reviews) — the
hand-written assessments a run accumulates before it is published — are
**not** part of this contract; they are authored separately and travel alongside
the record.

A run record must be serialized in a machine readable format such as JSON and
stored with the run's other artifacts. It is written locally beside those
artifacts when a run finishes (see [Co-located Run Files](#co-located-run-files))
and reported to the backend by the driver when the run finishes.

Schema: [`core/run-record.schema.json`](https://docs.testcabinet.ai/schema/core/run-record.schema.json).
The [backend's API and snapshot](/components/backend/api/) contracts reference
this schema rather than redefining the record, so there is one source of truth
for its shape.

## Contents

A run record must capture at least the following.

### Identity

- A unique run ID.
- The time the run started and the time it finished.

### Subject

- The test case slug and the exact test case version that was run.
- The [test type](/testing/overview/) the case belongs to (`end-to-end` or
  `asset-generation`), recorded so a reader knows which validation shape to
  expect and so the UI can pick the right result view without re-fetching the
  definition.
- The slug of the [variant](/testing/end-to-end/overview/#variants) that was run
  — exactly one variant runs per run, and recording it attributes the result to
  a specific build of the case.
- The agent harness slug and, where available, the harness version.
- The model ID that was used.

### Tooling

Provenance for the Test Cabinet build that orchestrated the run, distinct from
the harness it drove:

- The Test Cabinet commit the run's binary was built from, suffixed with
  `-dirty` when built from a modified working tree, or `null` when the build
  could not determine it (for example, a build with no git repository). This is
  stamped into the binary at build time and lets a result be traced back to the
  exact orchestrator code that produced it.

### Environment

The container environment the run executed in, captured from **inside** the run
container (not the host) so it reflects what the harness actually built in:

- The container OS, taken from `/etc/os-release`'s `PRETTY_NAME` (for example,
  `Debian GNU/Linux 12 (bookworm)`), or `unknown` when it could not be probed.
- The run-container image the run executed in — the single shared base image, the
  same for every harness — resolved to its registry digest reference where it has
  one (for example, `ghcr.io/<org>/test-cabinet-base@sha256:…`) so the record pins
  the exact image bytes even when the image was launched by a mutable tag; a
  purely local image with no registry digest records the reference it was launched
  by.
- The Node.js version reported by `node --version`, where it could be
  determined.

The harness version is not duplicated here; it lives in the subject.

### Metrics

- Run time, as defined in [Metrics](/components/core/metrics/#run-time).
- The four token classes, as defined in [Metrics](/components/core/metrics/#tokens).
- Comparable cost and actual cost, as defined in [Metrics](/components/core/metrics/#cost).

### Validation

- A summary of the [validation](/components/core/validation/) results, including
  the outcome of the required install and build steps, whether the
  implementation loaded, the similarity signal from each declared check, and a
  **proof** result per declared proof-of-implementation artifact (its id, name,
  media kind, expected `dest`, and whether the build produced it). A submitted
  proof's presence is informational and does not by itself affect the run's
  status — unlike the [debug-API contract](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing),
  whose failure does.
- For an [asset-generation](/testing/asset-generation/overview/) run, an
  **asset** result instead of (end-to-end) checks: the run-root-relative paths to
  the run's produced media, the recorded action log, and the recorded operation
  count. There is no target image and no fidelity score — the asset is judged
  subjectively against the brief. The produced media, and whether a cheat signal is
  recorded, depend on the
  [asset kind](/testing/asset-generation/overview/#asset-kinds). A **2D sprite or
  sprite-sheet** run carries the regenerated image (the output a human reviews
  against the brief), the model's on-disk preview, and the **cheat divergence** (how
  far the regenerated image differs from the model's preview, `0..=1`, or null when
  there was no readable preview to compare), which is recorded rather than gated. A
  **voxel** run is not regenerated and carries no cheat divergence: it carries the
  **emitted geometry** — a per-part `.glb` (plus `rig.json` for an animated model) —
  and the binary's rendered preview. On publish the media files are uploaded and
  served back as per-run media (`/runs/<id>/asset/<file>`, where `<file>` is
  `regenerated.png`, `preview.png`, or `actions.json` for a sprite and `.glb`
  (`mesh.glb` or `meshes/{part}.glb`), `rig.json`, or `preview.png` for a voxel run)
  so the gallery can show the result. The field is
  absent on an end-to-end run.

### Links

- A link to the public repository holding the run's generated source.
- A link to the playable build, when one has been released (the build is deployed
  publicly at [publish](/components/core/results/#publish); before that, a produced
  run's build is already playable for review off the
  [artifact service](/components/artifacts/overview/)).

### Status

- The run's terminal state, with enough detail to understand a failure. One of:
  - **`completed`** — the harness exited cleanly and the run produced a usable,
    evaluable implementation. Reviewed and scored on the reviewer checklist.
  - **`catastrophic`** — the harness exited cleanly (the model claimed
    completion), but the output did not build or load, so it produced **no playable
    build** and there was nothing to evaluate. A publishable model failure with no
    review checklist; reported as a separate catastrophic-failure statistic.
    Reserved for a total failure to produce a runnable artifact — an output that
    builds and loads is reviewed however badly it behaves, including one whose
    [debug API](/testing/end-to-end/instrumentation/) is missing or non-conformant.
  - **`timed_out`** — the run hit its maximum runtime and was stopped before the
    harness finished (the model never converged). A distinct publishable tier from
    `catastrophic`, likewise unscored.
  - **`harness_error`** — the agent harness (or the orchestrator runner driving it)
    exited **non-zero**: the model drove the harness to exit early. A real, reportable
    model outcome, publishable without a review — but, unlike the other failure tiers,
    it releases **no** source repo and no playable build; it is recorded only as a
    per-model harness-error statistic (shown as a ring on the model page). Publishing
    is never automatic — a subscription auth-token refresh also surfaces here and
    must **not** be reported — so a human records each one deliberately from the same
    publish-failures affordance the other tiers use.
  - **`hung`** — the agent harness stopped producing output altogether and was
    killed by the idle watchdog: it neither finished nor failed, it stalled (a
    provider request that never returned, a subagent that never reported back).
    Published exactly like `harness_error` — no review, no source repo, no playable
    build, recorded only as a per-model statistic — but kept as its own tier because
    nothing exited, so there is no exit code to report. A hang is also the one
    failure the Test Cabinet ends on **its own** timer: the watchdog is deliberately
    set well below the platform limits (the kubelet closes an exec stream idle for
    4h) so that a run's fate is always decided by us, and a case's
    `max_runtime_hours` stays reachable however long it is.
  - **`infrastructure`** — the Test Cabinet's own infrastructure failed (the
    container would not start or pull, a pod was OOM-killed, or seeding/init failed).
    Not the model's fault: retained with a diagnostic detail, but **never** publishable
    and excluded from every model statistic. A harness that merely exited non-zero is
    a `harness_error`, and one that stopped responding is `hung`, not this.

## Co-located Run Files

The record is written into a per-run directory alongside the run's other
artifacts:

- `run-record.json` — the run record described above.
- `implementation/` — a copy of the produced working tree. Any proof-of-
  implementation files the build wrote live here at their declared `dest`; when
  the run finishes, each present proof is uploaded to the
  [artifact service](/components/artifacts/overview/) and served back as per-run
  media (`/runs/<id>/proof/<proof-id>.<ext>`) so the reviewer UI can show the
  submitted evidence beside the expected reference.
- `raw.jsonl` — the harness's raw output, one JSON object per captured line in
  arrival order, each tagging the [stream](/components/core/events/) the line
  came from and the line's verbatim text.
- `events.jsonl` — the [normalized events](/components/core/events/) translated
  from that raw output, one event per line, in the order they were produced.
- `writeup.md` — a local [review](/components/core/results/#reviews) of the run,
  when one has been written. This is the operator's own review, used by the solo
  [`tcab publish`](/components/core/results/#tcab-publish-the-solo-path) path; a
  produced run can also accumulate further reviews from other accounts, which are
  held on the backend rather than beside the run on disk.

Recording the raw output beside its translation makes a run's event
classification auditable: replaying `raw.jsonl` through the harness layer's
translation reproduces `events.jsonl`, so a real run doubles as a fixture for
checking the parsing logic. Shipping both files with a run also lets the raw
stream be inspected directly when diagnosing a harness, and lets a harness's
translation be re-derived if its mapping later improves.
