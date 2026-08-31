---
title: "Overview"
---

gg analysis is the layer that makes a finished gg run answerable. Three features
carry it, each documented on its own page.

- [Session records](/gg/analysis/session-records/) pin what a session consumed,
  so a run that was torn down without its working tree can still be explained.
- [The query language](/gg/analysis/query-language/) reifies every recorded run
  as a flat document of dotted, typed fields and runs text queries over the
  corpus, so a study of which configurations produce which outcomes is a query.
- [Code analysis](/gg/analysis/code-analysis/) is a static read of the source a
  run produced: size and shape, per-function complexity, the module import graph
  and its cycles, the exported API surface, per-language type discipline, and
  copy-paste detection.

Session-record assembly and code analysis are both host-side stages of one
post-run seam. Code metrics reach the query language as `code.*` fields on the
run document.

## Where analysis runs

All post-run analysis runs on the host, after the working tree is collected,
before validation, and outside the run's runtime cap. The run engine has one
insertion point for it and every stage goes through that point. Three properties
follow from the placement:

- Analysis never spends the test case's runtime budget. The cap bounds the
  harness session and bounds each in-container setup step, each on its own, and
  the run's measured duration is frozen before the seam runs.
- What is measured is the code the model wrote. Validation runs the case's
  install and build commands in the produced tree itself, so a stage placed
  after it would measure build output, a rewritten lockfile and toolchain caches
  too.
- A canceled gg run is analysed exactly as a completed one is. A stage reads
  bytes that already exist and renders no verdict, which is the same posture
  that keeps a killed run's metrics.

A stage reads the produced tree. Building or executing it belongs to validation.

## Design principles

### Deterministic measurement

Every figure defined in this section is computed by parsing bytes. A figure that
is an approximation is labelled as such in the metric catalog, which the field
sidebar, the chart axis, the symbol-table header and the docs page all read, so
the four cannot disagree.

### Self-identifying partial answers

A session record whose journal has no terminating marker is marked truncated. A
code analysis that hit a tree-wide cap records that it did, so the filter
`not code.notes.truncated` excludes it from an aggregate. Every aggregate
carries the `contributing` count that is its denominator, and a run analysed on
a degraded basis records which basis. A reader must be able to tell a low figure
from an unmeasured one.

### An open field space over typed data

The query language resolves a field by map lookup, so a number a feature newly
emits is queryable, chartable and groupable with no Rust change, no contract
regeneration and no TypeScript label. The measurements themselves are structs
with units, labels, a JSON Schema and a test that fails when a catalogued path
stops resolving.

### Separation of measurement bases

A figure computed on a different tree basis, by a different analyzer generation,
or over a differently resolved authored set is a different measurement. Each
basis is recorded, each is a queryable field, and a bucket that spans two of
them says so.

## Scope

Code analysis counts `#[test]` functions and `*.test.*` files. Those are static
counts of the test code the model chose to write, they are an authorship signal,
and they are never presented as coverage. The
[validator](/components/core/validation/) runs a case's install and build
commands, so there is no suite run in the produced repo for anything here to
measure.

A run's own code-analysis document is served for every harness's runs, since
analysing a directory involves no harness-specific work. The aggregate query
surface covers gg runs.
