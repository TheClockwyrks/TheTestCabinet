---
description: Defines policies that apply when writing code in this repository.
name: coding
---

# Coding Policies

## Overview

All policies defined in this skill apply when writing code in this repository.
Follow these policies at all times.

## Conventional Commits

When creating commits, always use Conventional Commits format with the following
guidelines:

- `feat`: Use for changes whose primary purpose is feature enhancements
- `refactor`: Use only for non-functional refactoring
- `test`: Use for changes whose primary purpose is adding tests
- `docs`: Use for changes whose primary purpose is changing/adding documentation
- `chore`: Use for most other changes (i.e. config changes)

Include a scope for commits that target specific components, e.g. `feat(foo):`,
and write the subject in the imperative.

## Documentation first

The documentation of The Test Cabinet lives in the superrepo, under
`../apps/docs/src/content/docs/`, and is the source of truth. A change that
alters what a component does changes its page there first, in the superrepo's
own commit, and the code here follows it. This repository documents its own
code with rustdoc and its README, and links a page rather than restating it.

## Correctness

When implementing changes, do **NOT** attempt to optimize for change size.
Always implement the most correct change, not the smallest change.

## Rust Tests

Unit tests for Rust code must not follow standard Rust conventions of placing
them into the source file they test. This results in significantly larger file
sizes (with respect to line count).

Instead, place tests into `.test.rs` files with the same name as the file they
test and import it using a block like:

```rs
#[cfg(test)]
#[path = "foo.test.rs"]
mod tests;
```

If the test count is particularly high, further split tests by grouping tests
into multiple test files and have the source file import all test files. All
test files must still end in `.test.rs`; e.g. `foo.parsing.test.rs` and
`foo.validation.test.rs`. This strategy may also be used to reduce the line
count of non-test source files by splitting them into `foo.parsing.rs` and
`foo.validation.rs`. This should generally be done for functions only, grouping
them separately to keep each individual file reasonably sized.

This policy *only* applies to tests in the `src/` folder. It does not apply to
integration/e2e tests in the `tests/` folder.

## Running Tests

Run Rust tests with [`cargo nextest`](https://nexte.st), **not** `cargo test`.
The gate command is:

```sh
cargo nextest run --workspace
```

nextest is configured via `.config/nextest.toml` (retries, no fail-fast, and a
per-test hard timeout) and is installed in the devcontainer. `cargo test` must
not be used to run the test suite.

The one exception: nextest does not execute doctests. When a change touches
doctests, additionally run `cargo test --workspace --doc` to cover them.

## Gates

A change is not done until the gates pass. `make gate` runs every one; while
iterating, `uv run --quiet --project ci gate run <id>...` runs the ones the
change touches, and `uv run --quiet --project ci gate list` names them all. A
flaky test is a failing test: the fix is to remove its dependence on timing or
scheduling, never to rerun it until it passes or to load the machine to
provoke it.

## User Experience

Always consider the user experience when implementing user-facing code. If some
feature is implemented but is so tedious or difficult to use that users won't
want to use it, the feature may as well have not been implemented in the first
place.
