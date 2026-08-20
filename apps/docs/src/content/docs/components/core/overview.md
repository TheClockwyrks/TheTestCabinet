---
title: Overview
---

The core component is a Rust library that implements the majority of The Test
Cabinet's functionality. Every other component links against this library and
exposes its functionality through its own interface rather than re-implementing
any of it. Keeping the orchestration here is what lets runs be driven
identically whether they are launched from a script, a remote request, or a
window. See [Architecture](/components/architecture/).

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

## Wrapping the core

The wrapping components are thin.

- The [CLI](/components/cli/overview/) exposes the core as the `tcab` binary.
- The [driver](/components/driver/overview/) exposes the same run functionality
  as a per-run executor that the dispatcher creates a Kubernetes `Job` for.
- The [Tauri app](/components/tauri/overview/) exposes it as an interactive
  desktop GUI.

Each adds only the surface its interface requires. The behavior of a run lives
here.
