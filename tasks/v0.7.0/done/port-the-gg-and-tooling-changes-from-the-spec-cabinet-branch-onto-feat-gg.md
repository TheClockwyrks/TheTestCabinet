# Port the gg and tooling changes from the Spec Cabinet branch onto feat/gg

Bring the gg SDK test coverage, the SDK fixes it surfaced, and the repository
tooling changes that live only on `feat/the-spec-cabinet` onto `feat/gg`, which
is the branch v0.7.0 is cut from.

## Current state

`feat/the-spec-cabinet` is `feat/gg` plus the Spec Cabinet, the test-suite model
and ingest, and a set of changes that belong in the release. Its gg changes are
self-contained: the branch changed no `crates/core/src/gg*` file.

Both branches changed the gg trees after their merge base `58eb8a441a`. On
`feat/gg` the gg crate gained the routing key, tool-choice memory, provider pin
and candidate list, streaming transport, reasoning setting, output token split,
work and total cost figures, and a longer shell timeout. On
`feat/the-spec-cabinet` it gained the gg SDK test coverage and the SDK fixes
that coverage surfaced.

The `tcab ingest --env` command, the content-digest change detection, and the
suite reference-build upload are built on the test-suite ingest and conflict with
`feat/gg` throughout. They stay on `feat/the-spec-cabinet`, as do the Spec Cabinet
documentation pages and the test-suites submodule.

The commit hashes below are the ones the branch holds today. This issue runs
before
[the history rewrite](../rewrite-the-repository-history-without-baselines-and-wasm-blobs.md),
which renumbers every commit.

## Design

### The gg trees

Port the Spec Cabinet's changes to `crates/gg`, `crates/gg-sandbox-artifacts`,
every `packages/gg-sandbox*` package, `tasks/gg-sdk/` and `tasks/gg-tools/` onto
`feat/gg` in one commit, by a three-way merge of `feat/the-spec-cabinet`
restricted to those paths. A copy of the Spec Cabinet's trees would discard the
gg work `feat/gg` holds, so both sides' changes survive the merge:

- Conflicting test-file headers keep `feat/gg`'s account of how tests are
  grouped, plus the Spec Cabinet's pointers to where a JavaScript SDK case lands
  and which feedback functions the C# arm reaches.
- Ported tests are fitted to `feat/gg`: the shell default timeout constant, the
  `ModelResponse` usage fields, and the registered C# arm's membrane.
- `crates/gg-sandbox-artifacts` takes no change. Its only Spec Cabinet change is
  commit `9c4c05e3ea`'s build-support hunks, which serve only the Spec Cabinet
  sandbox.
- The ECMAScript guest's `Cargo.toml` change arrives with `54e2fcb410` below.

### The tooling commits

Cherry-pick these commits onto `feat/gg` with `-x`, in this order:

| Hash         | Subject                                                                                 | Outcome                                                                     |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `cdef007dc2` | build(devcontainer): bake Playwright's Chromium and its system libraries into the image | Picked                                                                      |
| `a2c331824e` | fix(devcontainer): admit the Playwright Chromium installer to the build context         | Picked                                                                      |
| `54e2fcb410` | fix(build): admit the ECMAScript guests' lockfiles to both image contexts               | Picked without the Spec Cabinet guest's manifest, allowlist lines and notes |
| `86c9f36c14` | chore: update repo tasks skill                                                          | Picked                                                                      |
| `fff7505fb0` | chore(claude): make completed issues immutable with a PreToolUse hook                   | Picked                                                                      |
| `29030a3f6f` | chore: silence ts-rs serde attribute warnings                                           | Picked                                                                      |
| `2260749ebc` | fix(lattice-designer): resync the board-size draft during render                        | Picked                                                                      |
| `cb7828f895` | chore: redirect to the docs site instead of updating the README                         | Picked                                                                      |
| `33c78c3003` | fix: stop applying prettier to Markdown                                                 | Picked                                                                      |
| `a77ffc8e30` | docs: add a skill for autonomously handling issues                                      | Picked                                                                      |
| `43a90be65d` | chore: autoformat                                                                       | Skipped: `feat/gg` already holds both formatted files                       |
| `0294d06b5a` | chore(hooks): move the heavy Rust gates to pre-push                                     | Skipped: `feat/gg` removed those hooks from every stage                     |
| `14c2b30a74` | perf(scripts): format only what prettier parses, across every core                      | Picked, keeping `feat/gg`'s submodule gitlink filter                        |
| `7636d9c097` | declank: throw out pointless slop                                                       | Picked                                                                      |
| `02773dffcd` | fix(docs): register the query-language grammars the observability page uses             | Picked                                                                      |

`14c2b30a74` goes before `7636d9c097`, the order the Spec Cabinet branch holds
them in: `7636d9c097` removes a paragraph `14c2b30a74` adds.

`0294d06b5a` does not apply because `feat/gg` dropped clippy, rustdoc and the
front-end suite from the hooks: run on push, they outlast the Azure connection.
The development docs that still listed them as commit gates are corrected
alongside the port.

## Done when

- [x] `feat/gg` holds the Spec Cabinet's gg tree changes in one commit, with
      the moved gg issue files, and `cargo nextest run -p test-cabinet-gg`
      passes.
- [x] The Spec Cabinet-only hunks in `build-support/src/lib.rs` are absent.
- [x] Every tooling commit the table marks as picked is on `feat/gg`, picked
      with `-x`.
- [x] No test-suite, ingest `--env`, content-digest, or Spec Cabinet
      documentation change is on `feat/gg`.
- [x] Gates green.
