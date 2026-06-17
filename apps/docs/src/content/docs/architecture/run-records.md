---
title: Run Records
---

## Overview

A run record is the data contract produced by every run. It is what the testing
harness emits, what gets published, and what the [site](/architecture/site/) consumes. Every
other part of the system is built around producing or reading this record, so its
shape is deliberately fixed.

A run record must be serialized in a machine readable format such as JSON and
stored with the run's other artifacts.

## Contents

A run record must capture at least the following.

### Identity

- A unique run ID.
- The time the run started and the time it finished.

### Subject

- The test case slug and the exact test case version that was run.
- The slug of the [variant](/architecture/test-cases/#variants) that was run — exactly one
  variant runs per run, and recording it attributes the result to a specific
  build of the case.
- The agent harness slug and, where available, the harness version.
- The model ID that was used.

### Tooling

Provenance for the Test Cabinet build that orchestrated the run, distinct from
the harness it drove:

- The Test Cabinet commit the run's binary was built from, suffixed with `-dirty`
  when built from a modified working tree, or `null` when the build could not
  determine it (for example, a build with no git repository). This is stamped
  into the binary at build time and lets a result be traced back to the exact
  orchestrator code that produced it.

### Environment

The container environment the run executed in, captured from **inside** the run
container (not the host) so it reflects what the harness actually built in:

- The container OS, taken from `/etc/os-release`'s `PRETTY_NAME` (for example,
  `Debian GNU/Linux 12 (bookworm)`), or `unknown` when it could not be probed.
- The per-harness container image (for example, `test-cabinet/codex:latest`).
- The Node.js version reported by `node --version`, where it could be
  determined.

The harness version is not duplicated here; it lives in the subject.

### Metrics

- Run time, as defined in [Metrics](/architecture/metrics/#run-time).
- The four token classes, as defined in [Metrics](/architecture/metrics/#tokens).
- Comparable cost and actual cost, as defined in [Metrics](/architecture/metrics/#cost).

### Validation

- A summary of the [validation](/architecture/validation/) results, including whether the
  implementation loaded and the similarity signal from each declared check.

### Links

- A link to the public repository holding the run's generated source.
- A link to the playable build, when one has been published.

### Status

- Whether the run completed, failed, or could not be evaluated, with enough detail
  to understand a failure.

## Co-located Run Files

The record is written into a per-run directory alongside the run's other
artifacts:

- `run-record.json` — the run record described above.
- `implementation/` — a copy of the produced working tree.
- `raw.jsonl` — the harness's raw output, one JSON object per captured line in
  arrival order, each tagging the [stream](/architecture/events/) the line came from and
  the line's verbatim text.
- `events.jsonl` — the [normalized events](/architecture/events/) translated from that raw
  output, one event per line, in the order they were produced.
- `writeup.md` — the run's [review](/architecture/results/#reviews), when one has been
  written.

Recording the raw output beside its translation makes a run's event
classification auditable: replaying `raw.jsonl` through the harness layer's
translation reproduces `events.jsonl`, so a real run doubles as a fixture for
checking the parsing logic. Shipping both files with a run also lets the raw
stream be inspected directly when diagnosing a harness, and lets a harness's
translation be re-derived if its mapping later improves.
