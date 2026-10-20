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
