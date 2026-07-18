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

Include a scope for commits that target specific components, e.g. `feat(foo):`.

## Correctness

When implementing changes, do **NOT** attempt to optimize for change size.
Always implement the most correct change, not the smallest change.

## Rust Tests

Unit tests for Rust code must not follow standard Rust conventions of placing
the into the source file they test. This results in significantly larger file
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

The shared CI scripts (`scripts/ci/rust-test.sh`, `scripts/ci/binary-smoke.sh`)
follow exactly this split; both CI systems install nextest first via
`scripts/ci/install-nextest.sh`.

## User Experience

Always consider the user experience when implementing user-facing code. If some
feature is implemented but is so tedious or difficult to use that users won't
want to use it, the feature may as well have not been implemented in the first
place.
