---
format: nyxsis-issue
version: 2
id: zwdbu3cf0k1byv4js6vtj29b
zone: REPOS
number: 8
title: Extract the UI library into ui-common
type: generic
state: open
created: 2026-10-13T21:12:04.822055014Z
---

`packages/ui` and `packages/run-stats` live in the superrepo. The
documentation places `@clockwyrks/ui` and `@clockwyrks/run-stats` in the
`ui-common` repository, a library the console, the public site and the
operator client depend on through the npm feed:
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories", "The edges" and "How a dependency is named", and
`apps/docs/src/content/docs/components/ui/overview.md`.

## What is missing

The `ui-common` repository on Azure, populated with the two packages' history,
rendered by the kit with its `typescript` gate and pipeline, publishing both
packages to the feed on a tag, mirrored to GitHub, and the package links of
the superrepo pointing a consumer at the sibling checkout. The packages are
removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, and the
scoring goldens in `contracts/fixtures/` hold `run-stats` to the backend's
scoring.

## Blocked

Not a docs defect: the docs are consistent. This issue cannot finish before
REPOS-9 (Extract the engines into the engines repository), and its frontmatter
does not depend on it.

- repositories.md "The edges": `ui-common -> contracts, engines (the voxel and
  particle runtimes)`; "How a dependency is named": an npm manifest names
  another repository's package at the exact version a tag of that repository
  published to the feed.
- `packages/ui/package.json` depends on `@clockwyrks/voxel-runtime`,
  `@clockwyrks/particle-runtime` and (dev) `@clockwyrks/simple-2d`,
  `@clockwyrks/structured-2d`, all still in the superrepo's `packages/`.
- The `engines` Azure repository is empty (no branch, tag or pipeline), so
  nothing of it is on the feed; ui-common's lock cannot resolve on its own and
  its `make gate` and pipeline cannot pass.
- REPOS-9 also moves the lattice renderer and interpolation out of
  `@clockwyrks/ui` into `@clockwyrks/lattice-runtime`, which changes what this
  issue extracts.

Within this issue's scope once unblocked: contracts tag `v0.1.0` lacks
`@clockwyrks/backend-api`, so a new contracts tag is published and recorded in
`TAGS` of `scripts/repos/render.py`.

The user decides:

1. Add REPOS-9 to this issue's `depends_on` and work it after REPOS-9 lands
   (recommended)?
2. Or change the order of the REPOS issues some other way (for instance
   extract engines first under a different issue)?
