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

## Documentation First

The documentation under `apps/docs/src/content/docs/` is authoritative over the
source code. If the documentation says one thing and the source says another,
the source is wrong. Any intentional design-level change to the source code is
therefore made to the documentation first, following the `documentation` skill,
and only then to the source code.

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

The retries exist so that flakiness can be told apart from a deterministic
failure, not to hide it. A test that passes only on a retry is still a failing
test: treat it as one, and fix it or the code under it.

The one exception: nextest does not execute doctests. When a change touches
doctests, additionally run `cargo test --workspace --doc` to cover them.

`crates/gg/Cargo.toml` sets `test = false`, so neither `cargo nextest run
--workspace` nor the `rust-test` gate runs gg's suite; the project's
`gg_tests_<k>` CI jobs do. After any change under `crates/gg/`, run it locally:

```sh
scripts/ci/gg-test.sh        # the whole suite
scripts/ci/gg-test.sh 1/4    # one hash partition of it, as CI runs it
```

## Gates

Every check is a gate, run as `uv run --quiet --project ci gate run <id>...`,
and `make gate` runs them all. Before reporting a change done, run at least the
gates for what it touched:

| Change | Gates |
| --- | --- |
| Rust (`crates/`, `Cargo.*`) | `rust-fmt`, `rust-clippy`, `rust-doc`, `rust-test`, `rust-doctest`; `contract-drift` when a contract type changed |
| `crates/gg/` | the above, plus `scripts/ci/gg-test.sh` |
| `apps/web/` | `web-lint`, `web-typecheck`, `web-test`, `web-browser-test`, `web-build` |
| `packages/`, `apps/site/` | `web-lint`, `workspace-test`, `site-build`, `seeded-contract`, `format` |
| Documentation (`apps/docs/`) | `markdownlint`, `cspell`, `docs-typecheck`, `docs-build` |
| Any Markdown elsewhere | `markdownlint`, `cspell` |
| A test case, game jam or group | `frozen-paths`, `spec-prose`, `spec-vocabulary`, `audio-packs`, `validators-typecheck`, `format` |
| A Dockerfile, `.dockerignore`, `rust-toolchain.toml` | `build-context` |
| `deployments/k8s/`, the deploy scripts | `k8s-manifests`, `k8s-deploy-sets` |
| `scripts/` | `shell-tests`, `scripts-test`, and `shellcheck` (`pre-commit run shellcheck --files …`) |
| `ci/`, `.azure/project/`, `ci/images/tags.yml` | `python-lint`, `ci-tests`, `ci-image-pins` |
| The repository kit (`copier.yml`, `templates/repository/`, `scripts/repos/`), `.gitmodules`, `.cargo/config.toml`, `.package-links.json` | `python-lint`, `ci-tests`, `shell-tests`, `dependency-graph` |
| `.claude/hooks/` | every `.claude/hooks/*.test.sh`, run directly, and `shellcheck` |
| Anything | `no-nul-bytes`, and `pre-commit run --all-files` for the upstream file checks |

## User Experience

Always consider the user experience when implementing user-facing code. If some
feature is implemented but is so tedious or difficult to use that users won't
want to use it, the feature may as well have not been implemented in the first
place.
