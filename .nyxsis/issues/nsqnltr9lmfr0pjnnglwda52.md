---
format: nyxsis-issue
version: 3
id: nsqnltr9lmfr0pjnnglwda52
zone: REPOS
number: 22
title: Pin the engines runtimes to asset-contract 0.2.4 and move ui-common and test-suites to that engines release so a clean install resolves
type: generic
state: open
created: 2026-10-21T16:49:09.576458186Z
---

The superrepo links the packages its checked-out repositories produce, and every
repository names a dependency at the release the kit's tag table records:
`apps/docs/src/content/docs/development/repositories.md`, sections "How a
dependency is named" and "The record of what builds together", and
`apps/docs/src/content/docs/development/building.md`, section "The npm
workspace".

## What is wrong

On the branch `issue/cicd-4` (which carries staging's feature work onto
contracts v0.2.4 and engines v1.1.3), a clean `npm ci` of the superrepo fails:
`@clockwyrks/particle-runtime` and `@clockwyrks/voxel-runtime` at engines v1.1.3
pin `@clockwyrks/asset-contract` at exactly `0.2.3` while the linked `contracts`
checkout is 0.2.4, `@clockwyrks/ui` in `ui-common` pins the engines packages at
1.1.2 while the linked `engines` checkout is 1.1.3, and `tools/lattice-designer`
in `test-suites` pins `@clockwyrks/lattice-runtime` at 1.1.2. The gates passed
only because the worktree's `node_modules` was installed before the pointers
moved.

## What to do

Release an engines version whose runtimes pin `@clockwyrks/asset-contract` at
0.2.4 and whose packages otherwise match v1.1.3, record it in the kit's tag
table, move `ui-common` to a master commit pinning contracts 0.2.4 and that
engines release, regenerate the test-suites workspace lockfiles and the lattice
designer's pin for it with the repository's workspace-lockfiles tool, move the
three submodules on `issue/cicd-4`, and refresh `package-lock.json`.

## Verify

`npm ci --offline` succeeds from a clean clone of `issue/cicd-4` with the
superrepo's package cache, `make gate` passes, and every test-suites workspace
lockfile resolves the new engines release.
