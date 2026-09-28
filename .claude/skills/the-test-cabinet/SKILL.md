---
description: The Test Cabinet's own policies beyond the template's coding, documentation and repo-tasks skills, and which gates to run for a change. Read it alongside those skills before writing code, documentation or an issue here.
name: the-test-cabinet
---

# The Test Cabinet's Policies

## Overview

The `coding`, `documentation`, `repo-tasks` and `drain-issues-queue` skills come
from the workspace template this repository is rendered from, and are never
edited here. This skill holds the policies this project adds to them. Where the
two disagree, this skill wins for this repository.

## Documentation First

The Test Cabinet's documentation, under `apps/docs/src/content/docs/`, is
authoritative over the source code. If the documentation says one thing and the
source says another, the source is wrong. Any intentional design-level change to
the source code is therefore made to the documentation first (following the
`documentation` skill), and only then to the source code.

## Flaky Tests Fail

`.config/nextest.toml` enables retries so that flakiness can be told apart from a
deterministic failure. A test that passes only on a retry is still a failing
test: treat it as one, and fix it or the code under it.

## No Implementation Status Notes

Documentation is written and then immediately implemented. **NEVER** write
phrases like "The design is specified in full on these pages and awaiting its
implementation". All documentation is written as though the documented design
were already implemented.

## Issues

This project's issue board is one level of area folders, `tasks/<area>/`, with a
`done/` folder inside each area; the template's `tasks/README.md` and
`repo-tasks` skill describe a two-level epic/area board instead.

This project's documentation has no numbered requirement tables, so its issues
carry no `## Requirements` section and no requirement citations. This supersedes
the "Requirement Citations" section of the `repo-tasks` skill here. An issue
states what is wrong or missing, links the documentation page that describes the
intended behaviour, and says how to verify the fix.

A finished issue under `done/` is immutable. Work it describes that needs
reopening is filed as a new issue.

## Which gates to run

Every check is a gate, run as `uv run --quiet --project ci gate run <id>...`,
and `make gate` runs them all. Before reporting a change done, run at least the
gates for what it touched:

| Change | Gates |
| --- | --- |
| Rust (`crates/`, `Cargo.*`) | `rust-fmt`, `rust-clippy`, `rust-doc`, `rust-test`, `rust-doctest`; `contract-drift` when a contract type changed |
| `crates/gg/` | the above, plus `scripts/ci/gg-test.sh` (gg's unit tests are not part of `rust-test`) |
| `apps/web/` | `web-lint`, `web-typecheck`, `web-test`, `web-browser-test`, `web-build` |
| `packages/`, `apps/site/` | `web-lint`, `workspace-test`, `site-build`, `seeded-contract`, `format` |
| Documentation (`apps/docs/`) | `markdownlint`, `cspell`, `docs-typecheck`, `docs-build` |
| Any Markdown elsewhere | `markdownlint`, `cspell` |
| A test case, game jam or group | `frozen-paths`, `spec-prose`, `spec-vocabulary`, `audio-packs`, `validators-typecheck`, `format` |
| A Dockerfile, `.dockerignore`, `rust-toolchain.toml` | `build-context` |
| `deployments/k8s/`, the deploy scripts | `k8s-manifests`, `k8s-deploy-sets` |
| `scripts/` | `shell-tests`, `scripts-test`, and `shellcheck` (`pre-commit run shellcheck --files …`) |
| `ci/`, `.azure/project/`, `ci/images/tags.yml` | `python-lint`, `ci-tests`, `ci-image-pins` |
| Anything | `file-endings`, `no-nul-bytes` |

## gg's unit tests

`crates/gg/Cargo.toml` sets `test = false`, so `rust-test` and the template's
Rust CI job do not run gg's suite; the project's `gg_tests_<k>` CI jobs do. After
any change under `crates/gg/`, run it locally:

```sh
scripts/ci/gg-test.sh        # the whole suite
scripts/ci/gg-test.sh 1/4    # one hash partition of it, as CI runs it
```
