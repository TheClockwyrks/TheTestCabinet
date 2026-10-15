---
format: nyxsis-issue
version: 2
id: txf8l556rdhfmbw9k1bxwvet
zone: REPOS
number: 1
title: Dissolve the core crate into its owning repositories
type: generic
state: open
created: 2026-10-13T21:11:34.211847136Z
---

`crates/core` still exists in the superrepo, and `crates/gg` depends on it by
path. The documentation assigns every module of it to an owner, and names
`contracts` as the one library every other repository may depend on:
`apps/docs/src/content/docs/development/repositories.md`, section "Where each
responsibility lives", and
`apps/docs/src/content/docs/components/contracts/overview.md`.

## What is missing

- The contracts, suites, telemetry, redact, backend-client and api-codegen
  crates in `contracts`, holding what the pages list, with the generated
  packages and schemas beside them.
- The run engine, harnesses, orchestrators, events, validators and code
  analysis in the driver crate; the review and comparison scoring, pricing,
  TCQ, model-id canonicalization and publish orchestration in the backend;
  match play, foray and lattice in `engines`; the playable serving in the
  artifacts service.
- The runtime traits the contracts page names (`RunToolingExt`,
  `RunStateExt`, `HarnessEventExt`) defined beside their runtime.
- `crates/core` deleted, every consumer depending on `contracts` as the
  "How a dependency is named" section states, and the patch table, package
  links and `edges.py` of the repository kit matching.

## Verify

`cargo build --workspace` passes in every repository with no path dependency
on a core crate, the `dependency-graph` and `contract-drift` gates pass, and a
run on the local stack records the same run record it does today.
