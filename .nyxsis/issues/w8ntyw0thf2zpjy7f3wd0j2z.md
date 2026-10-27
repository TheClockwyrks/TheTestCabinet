---
format: nyxsis-issue
version: 3
id: w8ntyw0thf2zpjy7f3wd0j2z
zone: UICOM
number: 3
title: Move ui-common onto contracts v0.2.5 and engines v1.1.5 so the superrepo can pin them
type: generic
priority: 3
state: open
created: 2026-10-27T21:21:47.738975253Z
modified: 2026-10-27T21:21:47.738975253Z
---

`contracts` v0.2.5 and `engines` v1.1.5 are released (ARENA-2), and each
repository's `nightly` now carries those versions in its manifests (`contracts`
2dfb6ad, `engines` 6c75201). The superrepo still pins the commits before the
bump (`contracts` 8f9d640, `engines` d47b044), because moving either pin breaks
its `npm-lock` gate: `ui-common/packages/ui` and `ui-common/packages/run-stats`
require `@clockwyrks/backend-api`, `run-record`, `lattice-runtime`,
`particle-runtime`, `voxel-runtime`, `simple-2d` and `structured-2d` at exactly
0.2.4 / 1.1.4. They are workspace packages of the superrepo, so npm looks for
those versions on the registry instead of linking the checkouts, and `npm ci`
fails.

Move `ui-common`'s requirements to 0.2.5 and 1.1.5 with its lock, both on the
feed now, and check `make gate` in `ui-common`. Then move the superrepo's
`contracts`, `engines` and `ui-common` pins together, with the root `Cargo.lock`
(the contracts crates and the `[[patch.unused]]` entries `api-codegen`,
`contract-codegen` and `test-cabinet-backend-client` go to 0.2.5) and
`package-lock.json`, and check `dependency-graph` and `npm-lock` pass. The edges
and package links are the ones
[Repositories](apps/docs/src/content/docs/development/repositories.md) states.

The standalone checkouts of `console.testcabinet.ai`, `testcabinet.ai`,
`the-spec-cabinet`, `microservice-driver` and `test-suites` also require 0.2.4 /
1.1.4, against their own locks. They are not part of the superrepo's npm
workspace, so each can move when it next takes new contracts.
