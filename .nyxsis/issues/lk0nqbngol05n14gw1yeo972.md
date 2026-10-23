---
format: nyxsis-issue
version: 3
id: lk0nqbngol05n14gw1yeo972
zone: REPOS
number: 2
title: Split the Spec Cabinet into its own repository
type: generic
state: open
created: 2026-10-13T21:11:39.153491809Z
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
