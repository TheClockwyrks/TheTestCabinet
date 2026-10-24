---
format: nyxsis-issue
version: 3
id: lk0nqbngol05n14gw1yeo972
zone: REPOS
number: 2
title: Split the Spec Cabinet into its own repository
type: generic
priority: 3
state: done
created: 2026-10-13T21:11:39.153491809Z
done: 2026-10-24T04:52:58.220878047Z
outcome: |
  Done:

  - The `the-spec-cabinet` repository on Azure holds the branch's Spec Cabinet
    paths, with their history (see its `history/README.md`), is rendered by the
    kit, and is a submodule of the superrepo. The pointer is moved to `c33c415`
    (its `nightly`).
  - `make gate` passes in a standalone clone of `the-spec-cabinet` at `c33c415`
    (2623 Rust tests pass and the npm workspace's tests pass). Run in place in the
    nyxsis worktree, `cspell`, `typescript` and one browser-served Rust test fail
    only because the checkout's path lies under `.git/`: Vite refuses to serve
    from it and cspell finds no files there.
  - The branch's shared-code edits are carried elsewhere. ui-common v0.1.4
    exports `@clockwyrks/ui/embed`, the fixture check became the-spec-cabinet's
    `fixture-suite-drift` gate, and its sandbox build is its own. The branch's
    documentation landed in `c018cd1da`, adapted to the split.
  - In the superrepo, every gate passes, `dependency-graph` included. `cspell`
    and `workspace-test` fail in place for the same `.git/` path reason, and pass
    outside it: cspell from a worktree under /tmp, and the four engines packages'
    tests from a clone at the pinned commit. No `spec-cabinet` crate, app or
    package is in the tree.

  Left: deleting `feat/the-spec-cabinet` waits until this branch reaches
  `nightly` (REPOS-25). The default port clash with the repos forward is
  REPOS-26.
---

The Spec Cabinet lives on `feat/the-spec-cabinet` in the superrepo. The
documentation places it in the `the-spec-cabinet` repository, an application
depending on `contracts` and on nothing else of the project:
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories" and "The edges".

## What is missing

- The `the-spec-cabinet` repository on Azure, populated from the branch's
  Spec Cabinet paths with their history, rendered by the repository kit as
  the "The kit" section states, and building on its own against the suites
  crate of `contracts`.
- The test-suite support in shared code that the branch also carries, landed
  on the superrepo's `nightly` and none of the Spec Cabinet paths with it.
- `feat/the-spec-cabinet` deleted once both hold its content.

## Verify

`make gate` passes in the new repository and in the superrepo, the
`dependency-graph` gate accepts the new edge, and the superrepo's `nightly`
holds no `spec-cabinet` crate, app or package.

## Blocked

Not a docs defect: the docs are consistent. A prerequisite is missing.

- repositories.md "The edges": `the-spec-cabinet -> contracts, engines,
  ui-common` (this supersedes the body's "on nothing else"; `edges.py`
  already carries the row). "How a dependency is named": an npm manifest
  names another repository's package at the exact version a tag of that
  repository published to the feed.
- `apps/spec-cabinet/package.json` on the branch depends on `@clockwyrks/ui`
  (and its `/app`, `/embed` exports).
- `@clockwyrks/ui` is not on the `the-test-cabinet` feed (checked
  2026-10-20: only asset-contract, backend-api, run-record 0.2.1 and the
  engines packages 1.1.1). No `ui-common` Azure repository exists, and the
  agents' principal cannot create one (TF401027). REPOS-8, which publishes
  it, is open and itself blocked.
- Until then the new repository's lock cannot resolve, so its `typescript`
  gate, its Rust tests (the sandbox build runs npm tooling) and its pipeline
  cannot pass.

Can land now: the shared test-suite support on `nightly` (no Spec Cabinet
paths). Waits: populating `the-spec-cabinet`, its gates and pipeline, and
deleting `feat/the-spec-cabinet`.

The user decides:

1. Add REPOS-8 to this issue's `depends_on` and finish it after REPOS-8
   lands (recommended), creating the `ui-common` Azure repository by hand?
2. Meanwhile, land the shared test-suite support on `nightly` now under this
   issue, or split it into its own issue?
