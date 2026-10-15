---
format: nyxsis-issue
version: 2
id: nqyjmaxipw9c5rmmh18fdl0d
zone: REPOS
number: 20
title: Move the lattice designer into test-suites over the lattice runtime
type: generic
state: open
depends_on:
  - gfqpmecuzk31twz3dxn6hugm
created: 2026-10-14T00:20:41.017191733Z
---

The lattice factory designer is `apps/lattice-designer` in the superrepo,
aliasing the console's `pages/runs/lattice` renderer and `numberFieldRules` by
path and reading the case bundle's `lattice-core.wasm`. The documentation places
it in `test-suites` as `tools/lattice-designer`, drawing through
`@clockwyrks/lattice-runtime` from `engines` and editing the lattice version's
scored scenarios beside it:
`apps/docs/src/content/docs/testing/performance/lattice/architecture.md`,
section "The factory designer", and
`apps/docs/src/content/docs/development/repositories.md`, sections "The kinds",
"Where each responsibility lives" and "The edges".

## What is missing

- The designer at `tools/lattice-designer` in `test-suites`, a workspace of the
  repository's root `package.json`, importing `@clockwyrks/lattice-runtime` for
  the engine, the renderer and the sheet loader and holding its own
  numeric-field reading; its dev server opens and saves the lattice version's
  `cases/*.json` in place.
- The `content` kind carrying an npm workspace: `KINDS` in the kit's `edges.py`
  and the `typescript` gate rendered into `test-suites`, with the designer's
  tests run by it.
- `apps/lattice-designer` removed from the superrepo, with its workspace entry,
  its mention in `ci/gates/workspace-test.py` and the
  `@clockwyrks/lattice-designer` package row of `edges.py`.

## Verify

`make gate` passes in `test-suites` and in the superrepo, and from the
`test-suites` checkout `npm run dev -w tools/lattice-designer` opens the lattice
version's `medium` scenario, saves an edited copy of it and leaves every other
file untouched.
