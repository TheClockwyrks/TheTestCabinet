---
format: nyxsis-issue
version: 3
id: hot8ejn610udnofiil1p75be
zone: REPOS
number: 21
title: Move the superrepo to contracts v0.2.3 and engines v1.1.2 so a clean install resolves
type: generic
state: open
created: 2026-10-21T02:34:27.77546927Z
---

The superrepo links the packages its checked-out repositories produce, and
every repository names a dependency at a release the kit's tag table
records: `apps/docs/src/content/docs/development/repositories.md`, sections
"How a dependency is named" and "The record of what builds together", and
`apps/docs/src/content/docs/development/building.md`, section "The npm
workspace".

## What is wrong

`nightly` pins `contracts` at v0.2.3 and `ui-common` at a master commit whose
packages pin the engines packages at 1.1.1, and `engines` at 3c3bced, the
last master commit whose packages are 1.1.1. The engines v1.1.2 release and
the master beyond it (9b5f32c, which settles the case-harness fixture
deterministically) are what the superrepo should link. `ui-common` master
now pins the engines packages at 1.1.2, and the test-suites workspace
lockfiles pin engines 1.1.1.

## What to do

Move the superrepo's `engines` submodule to 9b5f32c and its `ui-common`
submodule to the master commit that pins the engines packages at 1.1.2.
Regenerate the test-suites workspace lockfiles for engines 1.1.2 with the
repository's workspace-lockfiles tool, land that in `test-suites` and move
its submodule. Refresh `package-lock.json`.

## Verify

`npm ci --offline` succeeds from a clean checkout of `nightly`, `make gate`
passes, and every test-suites workspace lockfile resolves engines 1.1.2.
