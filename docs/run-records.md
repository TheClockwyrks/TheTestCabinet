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

### Metrics

- Run time, as defined in [Metrics](./metrics.md#run-time).
- The four token classes, as defined in [Metrics](./metrics.md#tokens).
- Comparable cost and actual cost, as defined in [Metrics](./metrics.md#cost).

### Validation

- A summary of the [validation](./validation.md) results, including whether the
  implementation loaded and any reference comparison signals.

### Links

- A link to the public repository holding the run's generated source.
- A link to the playable build, when one has been published.

### Status

- Whether the run completed, failed, or could not be evaluated, with enough detail
  to understand a failure.
