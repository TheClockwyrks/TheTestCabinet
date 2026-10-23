---
format: nyxsis-issue
version: 2
id: hl8j556cwn8aentf2zqkqv6s
zone: EDGE
number: 4
title: Slim tcab to the commands that operate on definitions
type: generic
state: done
depends_on:
  - ey5sbl6cm5bcwy5uvykmi6d1
created: 2026-10-13T21:12:37.385950171Z
done: 2026-10-19T09:11:34.411834274Z
---

`tcab` declares run-side commands beside the ones that operate on
definitions: `run`, `review`, `publish`, `harnesses`, `orchestrators`,
`engines`, `test-case-groups` and `analyze`. The documentation lists the
command set as validate, capture-baselines, seed, prompt, ingest,
publish-reference and publish-asset-reference, and has launching, reviewing
and publishing happen in the console:
`apps/docs/src/content/docs/components/cli/overview.md`.

## What is missing

The CLI declaring the documented commands and no other, the backend-client
code paths that only a removed command used gone with them, and the
`microservice-driver` pipeline building and smoke-testing the slim binary as
`apps/docs/src/content/docs/development/releasing.md`, section "Releasing
`tcab`", states.

## Verify

`tcab --help` lists the documented commands, and `make gate` passes in the
driver's checkout.
