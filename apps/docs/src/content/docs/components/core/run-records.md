---
title: Run Records
---

A run record is the data contract produced by every run. It is what the testing
harness emits, what [publishing](/components/core/results/#publishing) uploads
to the [backend](/components/backend/overview/), and what the
[site](/components/site/overview/) ultimately consumes. Every other part of the
system is built around producing or reading this record, so its shape is
deliberately fixed.

A run record must be serialized in a machine readable format such as JSON and
stored with the run's other artifacts. It is written locally beside those
artifacts when a run finishes (see [Co-located Run Files](#co-located-run-files))
and uploaded to the backend when the run is published.

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
  media kind, expected `dest`, and whether the build produced it). Proof presence
  is informational and does not affect the run's status.
- For an [asset-generation](/testing/asset-generation/overview/) run, an
  **asset** result instead of (end-to-end) checks: the run-root-relative paths to
  the regenerated image (the scored output), the model's on-disk preview, the
  seeded target, and the recorded action log; the recorded operation count; the
  **target fidelity** (similarity of the regenerated image to the target,
  `0..=1`); and the
  **cheat divergence** (how far the regenerated image differs from the model's
  preview, `0..=1`, or null when there was no readable preview to compare).
  Like checks, both signals are recorded rather than gated. On publish the four
  media files are uploaded and served back as per-run media
  (`/runs/<id>/asset/<file>`, where `<file>` is `regenerated.png`, `preview.png`,
  `target.png`, or `actions.json`) so the gallery can show the side-by-side
  result. The field is absent on an end-to-end run.

### Links

- A link to the public repository holding the run's generated source.
- A link to the playable build, when one has been published.

### Status

- Whether the run completed, failed, or could not be evaluated, with enough
  detail to understand a failure.

## Co-located Run Files

The record is written into a per-run directory alongside the run's other
artifacts:

- `run-record.json` — the run record described above.
- `implementation/` — a copy of the produced working tree. Any proof-of-
  implementation files the build wrote live here at their declared `dest`; on
  publish, each present proof is uploaded and served back as per-run media
  (`/runs/<id>/proof/<proof-id>.<ext>`) so the reviewer UI can show the submitted
  evidence beside the expected reference.
- `raw.jsonl` — the harness's raw output, one JSON object per captured line in
  arrival order, each tagging the [stream](/components/core/events/) the line
  came from and the line's verbatim text.
- `events.jsonl` — the [normalized events](/components/core/events/) translated
  from that raw output, one event per line, in the order they were produced.
- `writeup.md` — the run's [review](/components/core/results/#reviews), when one
  has been written.

Recording the raw output beside its translation makes a run's event
classification auditable: replaying `raw.jsonl` through the harness layer's
translation reproduces `events.jsonl`, so a real run doubles as a fixture for
checking the parsing logic. Shipping both files with a run also lets the raw
stream be inspected directly when diagnosing a harness, and lets a harness's
translation be re-derived if its mapping later improves.
