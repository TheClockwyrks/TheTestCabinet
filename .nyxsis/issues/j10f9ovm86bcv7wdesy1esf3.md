---
format: nyxsis-issue
version: 3
id: j10f9ovm86bcv7wdesy1esf3
zone: UICOM
number: 2
title: Carry the back-navigation fix from staging into ui-common and the console
type: generic
priority: 3
state: done
created: 2026-10-22T14:47:09.756279949Z
done: 2026-10-22T18:28:12.172594881Z
outcome: |
  Landed in PR 5068 into nightly (bbaeed318): the "Back navigation" docs section
  carried from staging's PR 5005, ui-common PR 5017 porting the code onto its tree
  and PR 5018 releasing @clockwyrks/ui and @clockwyrks/run-stats 0.1.2 to the feed
  (tag v0.1.2), console.testcabinet.ai PR 5032 pinning 0.1.2 with a browser test
  that a run page opened from the runs list returns to the list, and the
  superrepo's ui-common and console pointers and lock following. Superrepo gates
  22 of 22 on the branch; a clean clone's npm ci resolves. Not exercised: the back
  controls in a running console or on staging (covered by ui-common's vitest suite
  and the console's browser test). The gallery in testcabinet.ai still pins ui
  0.1.1 (SITE-4).
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
