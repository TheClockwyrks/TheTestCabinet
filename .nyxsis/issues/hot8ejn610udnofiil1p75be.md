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

`npm ci` fails on `nightly`. The `engines` submodule is at 9b5f32c, past its
v1.1.2 release, whose packages are version 1.1.2 and depend on
`@clockwyrks/asset-contract` 0.2.3. The `contracts` submodule is at v0.2.2,
the `ui-common` submodule at 07c869df pins `@clockwyrks/backend-api` and
`@clockwyrks/run-record` at 0.2.2 and the engines packages at 1.1.1, and
`package-lock.json` records the 1.1.1 runtimes. No set of linked packages
satisfies these pins, so npm reaches for the public registry and fails.
Contracts v0.2.3 also holds the browser driver as
`contracts/packages/browser-driver`, which the superrepo still carries as
`packages/browser-driver`, a duplicate workspace.

## What to do

Land a `ui-common` master commit that pins the contracts packages at 0.2.3
and the engines packages at 1.1.2. Move the superrepo's `contracts` submodule
to v0.2.3 and its `ui-common` submodule to that commit, keep `engines` at
9b5f32c, take the browser driver from `contracts/packages/browser-driver`
(the services image, the allowlist, the package links and the setup prose
name it there) and remove `packages/browser-driver`. Refresh
`package-lock.json` and the five path-patched contracts crates in
`Cargo.lock`. Move the kit's dependency tags to the releases the superrepo
links where the documentation's tag table says they follow.

## Verify

`npm ci --offline` succeeds from a clean checkout of `nightly`, and
`make gate` passes.
