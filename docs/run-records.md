# Run Records

## Overview

A run record is the data contract produced by every run. It is what the testing
harness emits, what gets published, and what the [site](./site.md) consumes. Every
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
- The agent harness slug and, where available, the harness version.
- The model ID that was used.

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

- Run time, as defined in [Metrics](./metrics.md#run-time).
- The four token classes, as defined in [Metrics](./metrics.md#tokens).
- Comparable cost and actual cost, as defined in [Metrics](./metrics.md#cost).

### Validation

- A summary of the [validation](./validation.md) results, including whether the
  implementation loaded and the similarity signal from each declared check.

### Links

- A link to the public repository holding the run's generated source.
- A link to the playable build, when one has been published.

### Status

- Whether the run completed, failed, or could not be evaluated, with enough detail
  to understand a failure.
