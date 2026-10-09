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
when more than one party reads or writes it: the run record and every part of it
(the subject and state, the normalized events, the validation summary, the metrics,
toolchain and code-analysis blocks), the review shapes, a resolved test case
version, the test suite format and its export and save rules, gg's configuration,
telemetry and session record, the TCQ query shapes, the engine identity a run
names, the ingest API's request, report and feed, and the names of the files and
directories a run tree is made of.

The contracts crate holds data, the functions over it, and the reading and writing
of the files that data is stored in: a suite version's export, a partial suite tree,
the cold storage root a checkout names. Anything that reaches a container, a
process, the network or a clock stays in the core, which splits a module along that
line where it has to. The TCQ shapes are contracts and the document builder and
evaluator are core. A resolved test case is contracts and the manifest formats and
the catalog that resolves them are core. The event shapes are contracts and the
per-harness parsers are core. The review shapes are contracts, and so is
`merge_review_items`, which a resolved test case's checklist is built with; the
scoring rules over them are core. The scoring rules have a TypeScript mirror,
`@clockwyrks/run-stats`, and the
[scoring goldens](/development/building/#the-scoring-goldens) in the contracts
crate's `fixtures/scoring/` hold the two to the same cases.

## The suites crate

The test-suite runtime lives in `crates/suites` (`test-cabinet-suites`), between the
contracts crate and the core: it depends on the contracts crate and on no other crate
of this project, and the core depends on it. It sits on the contracts side of the
[repository cut](/development/repositories/), so The Spec Cabinet runs the same
suite logic the core does. It holds what reads a `test-suites/` checkout and turns an
offered definition into something a run executes: the suite catalog and the lowering
of a definition onto a test case version, previews, a definition's prompt, and the
runner for a suite's validator project. It also holds what that runtime shares with
the core's validators: the built-in [engine catalog](/components/core/engines/), the
vitest runner a case's validator project runs through, the static server and browser
driver, and the content digests and labels an ingest keys a version by.

The suite format is contracts and its runtime is the suites crate. The engine shapes
are contracts and the engine catalog is the suites crate. The authored catalog a suite
definition's identity collides with is the core's, and the suites crate asks it
through `AuthoredLookup`, which the core implements for its `TestCaseCatalog`. The
suites crate's errors are a subset of the core's, with the same messages, and convert
to them one variant for one.

## Re-exports

The core re-exports every module and item the two crates hold at its previous path,
so `test_cabinet_core::gg::GgRunLimits` and `test_cabinet_contracts::gg::GgRunLimits`
name the same type, as do `test_cabinet_core::test_suite::TestSuiteCatalog` and
`test_cabinet_suites::test_suite::TestSuiteCatalog`.

A method that needs runtime cannot stay on a contract type, so it is a trait with the
same name and signature in the crate that holds the runtime. The core has
`RunToolingExt::current` (the build's commit), `RunStateExt::classify_failure` (over
the core's error) and `HarnessEventExt::system` (stamped with the clock). The suites
crate has `PartialSuiteTreeExt::complete` and `complete_preview` (over the engine
catalog). Each is re-exported beside its type, so a caller that imports the module or
the crate root calls `RunTooling::current()` as before.

The suite export rules take the engines a declared slug is checked against
(`validate_tree_with` and the rest, over an `EngineLookup`). The suites crate's
`validate`, `validate_tree`, `validate_preview_tree` and `load_and_validate` pass the
built-in engine catalog.

The suites crate links no OpenTelemetry. Its browser driver calls (`capture`,
`drive_script` and `smoke_check`) take the function that names the current span's
`traceparent`, and the core's `browser` module, which re-exports the rest of the
suites crate's, keeps the three with their old signatures and passes the telemetry
crate's propagation.

The data contract's TypeScript bindings (`@clockwyrks/run-record` and
`@clockwyrks/asset-contract`) and their JSON Schemas are generated from the
contracts crate alone, through its `contract` feature. The backend API's
(`@clockwyrks/backend-api`) are generated from the core and the backend, through
the core's feature of the same name, which turns on the contracts crate's. See
[Generating the data contract](/development/building/#generating-the-data-contract).

## Wrapping the core

The wrapping components are thin, adding only the surface their own interface
requires. The behavior of a run lives in the core.

- The [CLI](/components/cli/overview/) exposes the core as the `tcab` binary.
- The [driver](/components/driver/overview/) exposes the same run functionality
  as a per-run executor that the dispatcher creates a Kubernetes `Job` for.
