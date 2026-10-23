# Requirement Outcomes Come From The Suite's Validators

Run a suite version's `validators/` project against the implementation a run
produced and record the requirement outcomes it decides. A run of a
suite-defined test case ends with a pass or fail per requirement, each carrying
the assertions behind it.

## Current state

[Validators](../../apps/docs/src/content/docs/test-suites/validators.md) is
authoritative for this issue. Requirement identity and the claim rule are stated
in
[Specifications](../../apps/docs/src/content/docs/test-suites/specifications.md),
and the `globalThis` handle the debug API root is reached by is stated in
[Debug APIs](../../apps/docs/src/content/docs/test-suites/debug-apis.md).

`crates/core/src/vitest_validator.rs` decides a test case's scripted review
points today. It stages the case's `validation/<engine>/` directory into the
collected tree, runs vitest there with the JSON reporter under a wall-clock cap,
and maps each test file back to a `DebugScriptResult`. File identity is the unit:
one staged suite file decides one verdict unit named by the variant's checklist.

`crates/core/src/validator.rs` builds and serves a produced tree through
`StaticServer` in `crates/core/src/browser.rs`, which is how the browser drive
reaches an `http://` build. `crates/core/src/validation.rs` holds the result
types, `run_record.rs` what a run records, and `review.rs` the scoring rules
mirrored by `packages/run-stats`.

A suite decides requirements rather than checklist items, its validators are
exported functions rather than test files, and its project runs in browser mode
against the served page. None of that is wired.

## Design

A new module beside the existing one, `crates/core/src/test_suite/validators.rs`,
runs a suite version's validator project. The existing case path is untouched, so
both shapes of test case run side by side.

The run resolves its suite version through the catalog
[`suite-catalog-in-core.md`](suite-catalog-in-core.md) delivers, runs the
definition's `[build]` install and build commands over the produced tree, serves
the build output with `StaticServer`, stages the version's `validators/`
directory into the collected tree, and runs that project with the JSON reporter
in browser mode against the served URL. Staging follows the existing rule: the
project is reporter-side material, is staged once the container is gone, and is
removed again whatever the outcome.

### Reaching the served build

`vitest.config.ts` inside `validators/` declares the project root, the
browser-mode configuration, and the include pattern. The served port is chosen at
run time, so the runner names the base URL to the project through an environment
variable and the config reads it, falling back to a local development URL when
the variable is absent. That fallback is what lets an author run the project
standalone from its own directory.

The debug API root is reached from the served page's `globalThis` through the
handle `debug-api.toml` declares. The runner passes the handle to the project the
same way it passes the base URL, so the project reads the suite's handle rather
than a literal.

### Mapping results onto requirements

The unit vitest reports is a test file driving one validator module against the
served build. The runner maps each reported unit back to that module's path
relative to `validators/`, which is exactly the string a requirement's
`validators` key lists. Each path is claimed by one requirement, so the claim is
the whole mapping: a requirement collects the results of every validator path it
lists.

- A requirement passes when every validator it claims ran and every assertion
  those validators returned passed.
- A requirement fails when any validator it claims returned a failed assertion,
  raised, or reported no assertion.
- A project the runner could not execute, including one stopped at the cap,
  leaves every requirement it covers undecided and leaves the run standing.

Only the requirements belonging to the specifications the definition selects are
run and recorded. Non-functional requirements declare no validators and record no
validator outcome, being judged by review.

### What is recorded

The run record gains a list of requirement outcomes keyed by
`<specification id>/<requirement id>`, each carrying the requirement's kind, its
pass or fail, the validator paths that decided it, and every assertion result
with its `name`, `passed` flag and `detail` where the validator supplied one.
Retaining each assertion is what lets a console show the conditions that ran
rather than a single verdict.

The contract types for the recorded outcomes are generated alongside the suite
model in `crates/contract-codegen/src/main.rs`, so the web console and the
desktop app read one shape.

### Bounds

The existing wall-clock cap and per-suite output cap behaviour carries over
unchanged, including the environment override and the process-group kill. The
cap stands as it is, because a suite's validators finish quickly.

### Out of scope

The scoring rules in `crates/core/src/review.rs` and `packages/run-stats` stay
as they are, and scoring a suite run from its requirement outcomes belongs to a
later pass. Rendering the outcomes is
`tasks/test-suites/suite-detail-surfaces.md`, authoring the validator project is
`tasks/spec-cabinet/validators-editor.md`, and exercising this path on the
cluster is `tasks/test-suites/run-a-suite-on-the-local-cluster.md`.

## Depends on

- [`suite-catalog-in-core.md`](suite-catalog-in-core.md)

## Done when

- [ ] A suite version's `validators/` project runs in browser mode against the
      build the definition's `[build]` commands produced.
- [ ] The project reads the served base URL and the debug API handle from the
      environment the runner sets, and runs standalone from its own directory
      against a locally served build.
- [ ] Each outcome is keyed by `<specification id>/<requirement id>` and names
      the validator paths the claiming requirement lists.
- [ ] A reference implementation run through this path passes every requirement.
- [ ] A deliberately broken implementation fails exactly the requirements whose
      validators fail.
- [ ] Each assertion is recorded with its name, its pass flag, and its detail
      where one was supplied.
- [ ] A validator that raises fails the requirement claiming it and leaves the
      run standing.
- [ ] A project stopped at the wall-clock cap leaves its requirements undecided.
- [ ] Non-functional requirements record no validator outcome.
- [ ] The generated contract types for the outcomes are committed and
      `scripts/ci/contract-drift.sh` is green.
- [ ] Gates green.
