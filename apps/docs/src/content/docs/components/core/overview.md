---
title: Overview
---

The core component is a Rust library that implements the majority of The Test
Cabinet's functionality. Every other component links against this library and
exposes its functionality through its own interface rather than re-implementing
any of it, so a run behaves identically whether it is launched from a script, a
remote request, or a window. See [Architecture](/components/architecture/).

## Responsibilities

The core owns everything that happens during a run, and defines the data
contracts the rest of the system is built around.

- **[Test cases](/testing/end-to-end/overview/)** — resolving a test case
  version and its selected [variant](/testing/end-to-end/overview/#variants),
  and reading the `test-case.toml` manifest that says what gets seeded,
  rendered, and checked.
- **[Execution](/components/core/execution/)** — seeding a fresh git repository,
  running the harness inside an isolated container, and collecting the produced
  working tree.
- **[Agent harnesses](/components/core/harnesses/)** — a single abstraction for
  invoking any supported coding harness, absorbing each one's quirks.
- **[Orchestrators](/components/core/orchestrators/)** — the harness-agnostic
  strategy that decides how a run's harness sessions are conducted.
- **[Engines](/components/core/engines/)** — the runtime a produced game is built
  on, selected independently of the test case.
- **[Test case groups](/components/core/test-case-groups/)** — the repo-defined
  sets of related cases the home page renders one leaderboard per.
- **[Harness events](/components/core/events/)** — translating each harness's
  raw output into one normalized, live event stream.
- **[Metrics](/components/core/metrics/)** — recording the run time, token, and
  cost data every run produces.
- **[Validation](/components/core/validation/)** — the automated first pass that
  builds, loads, and optionally screenshot-compares an implementation.
- **[Run records](/components/core/run-records/)** — the fixed data contract a
  run emits.
- **[Results](/components/core/results/)** — getting a finished run onto the
  gallery through review and publish.

## The contracts crate

The data contracts the core defines live in their own crate, `crates/contracts`
(`test-cabinet-contracts`), beside the core in `crates/core`. A shape belongs there
when more than one party reads or writes it: gg's configuration, telemetry and
session record, the TCQ query shapes, the metrics, toolchain and code-analysis
blocks of a run record, the engine identity a run names, the ingest feed, and the
names of the files and directories a run tree is made of.

The contracts crate holds data and the pure functions over it. Anything that
reaches a container, a process, the network or a clock stays in the core, which
splits a module along that line where it has to: the TCQ shapes are contracts and
the document builder and evaluator are core, and the engine shapes are contracts
and the engine catalog is core. The core depends on the contracts crate and
re-exports every moved module and item at its previous path, so
`test_cabinet_core::gg::GgConfig` and `test_cabinet_contracts::gg::GgConfig` name
the same type.

The TypeScript bindings and JSON Schemas are generated from both crates through
the core's `contract` feature, which turns on the contracts crate's. See
[Generating the data contract](/development/building/#generating-the-data-contract).

## Wrapping the core

The wrapping components are thin, adding only the surface their own interface
requires. The behavior of a run lives in the core.

- The [CLI](/components/cli/overview/) exposes the core as the `tcab` binary.
- The [driver](/components/driver/overview/) exposes the same run functionality
  as a per-run executor that the dispatcher creates a Kubernetes `Job` for.
