---
format: nyxsis-issue
version: 3
id: j10f9ovm86bcv7wdesy1esf3
zone: UICOM
number: 2
title: Carry the back-navigation fix from staging into ui-common and the console
type: generic
priority: 3
state: open
created: 2026-10-22T14:47:09.756279949Z
---

Every on-page back control returns to the page the viewer came from, the app
records the tab's in-app history, a form that leads to what it saved replaces
itself in that history, and a control that must ask before leaving takes the
same step once answered: `apps/docs/src/content/docs/components/ui/overview.md`,
section "Back navigation". `ui-common` holds `@clockwyrks/ui`, released by
version and named by exact pin in `console.testcabinet.ai` and the superrepo:
`apps/docs/src/content/docs/development/repositories.md`, section "How a
dependency is named".

## What is missing

The superrepo's `staging` carries the change as pull request 5005 (commits
`b72922bb0` for the documentation and `9817f20e5` for the code) against the
`packages/ui` tree that now lives in `ui-common`. `nightly` and `ui-common`
lack it.

- The documentation commit on `nightly`.
- The code change in `ui-common`'s `master`, released as the next patch
  version with the packages published to the feed.
- `console.testcabinet.ai` and the superrepo's lock naming that version, the
  superrepo's `ui-common` and `console.testcabinet.ai` pointers at the
  masters that carry it.

## Verify

`make gate` passes in `ui-common`, `console.testcabinet.ai` and the superrepo,
`npm ci --offline` resolves from a clean clone of the superrepo, and on a run
detail page opened from the runs list the back chevron returns to the list.
