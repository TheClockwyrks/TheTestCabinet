# Port the gg and tooling changes from the Spec Cabinet branch onto feat/gg

Bring the gg SDK test coverage, the SDK fixes it surfaced, and the repository
tooling changes that live only on `feat/the-spec-cabinet` onto `feat/gg`, which
is the branch v0.7.0 is cut from.

## Current state

`feat/the-spec-cabinet` is `feat/gg` plus the Spec Cabinet, the test-suite model
and ingest, and a set of changes that belong in the release. The gg changes are
self-contained: the branch changed no `crates/core/src/gg*` file, so the gg trees
on it build against the core `feat/gg` holds. The tooling commits listed below
each apply to `feat/gg` without conflict.

The `tcab ingest --env` command, the content-digest change detection, and the
suite reference-build upload are built on the test-suite ingest and conflict with
`feat/gg` throughout. They stay on `feat/the-spec-cabinet`, as do the Spec Cabinet
documentation pages and the test-suites submodule.

The commit hashes below are the ones the branch holds today. This issue runs
before
[the history rewrite](rewrite-the-repository-history-without-baselines-and-wasm-blobs.md),
which renumbers every commit.

## Design

### The gg trees

Copy `crates/gg`, `crates/gg-sandbox-artifacts`, and every `packages/gg-sandbox*`
package from `feat/the-spec-cabinet` onto `feat/gg` as they stand, together with
the issue files the test work moved into `tasks/gg-sdk/done/` and
`tasks/gg-tools/done/`, in one commit. `crates/gg-sandbox-artifacts/build-support/src/lib.rs`
carries hunks from commit `9c4c05e3ea` that serve only the Spec Cabinet sandbox;
those hunks are dropped from the copy. The commit builds and its tests pass
against the core on `feat/gg`.

### The tooling commits

Cherry-pick these commits onto `feat/gg` in this order:

| Hash         | Subject                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| `cdef007dc2` | build(devcontainer): bake Playwright's Chromium and its system libraries into the image |
| `a2c331824e` | fix(devcontainer): admit the Playwright Chromium installer to the build context         |
| `54e2fcb410` | fix(build): admit the ECMAScript guests' lockfiles to both image contexts               |
| `86c9f36c14` | chore: update repo tasks skill                                                          |
| `fff7505fb0` | chore(claude): make completed issues immutable with a PreToolUse hook                   |
| `29030a3f6f` | chore: silence ts-rs serde attribute warnings                                           |
| `2260749ebc` | fix(lattice-designer): resync the board-size draft during render                        |
| `cb7828f895` | chore: redirect to the docs site instead of updating the README                         |
| `33c78c3003` | fix: stop applying prettier to Markdown                                                 |
| `a77ffc8e30` | docs: add a skill for autonomously handling issues                                      |
| `43a90be65d` | chore: autoformat                                                                       |
| `0294d06b5a` | chore(hooks): move the heavy Rust gates to pre-push                                     |
| `7636d9c097` | declank: throw out pointless slop                                                       |
| `14c2b30a74` | perf(scripts): format only what prettier parses, across every core                      |
| `02773dffcd` | fix(docs): register the query-language grammars the observability page uses             |

Every pick except `54e2fcb410` was verified to apply cleanly with a merge-tree dry
run; `54e2fcb410` touches only the devcontainer, the docker ignore files, the
guest `Cargo.toml`, and `scripts/ci/build-context.sh`, and is expected to apply
cleanly too.

## Done when

- [ ] `feat/gg` holds the gg trees from `feat/the-spec-cabinet` in one commit,
      with the moved gg issue files, and `cargo test -p test-cabinet-gg` passes.
- [ ] The Spec Cabinet-only hunks in `build-support/src/lib.rs` are absent.
- [ ] Every tooling commit in the table is on `feat/gg`, picked with `-x`.
- [ ] No test-suite, ingest `--env`, content-digest, or Spec Cabinet
      documentation change is on `feat/gg`.
- [ ] Gates green.
