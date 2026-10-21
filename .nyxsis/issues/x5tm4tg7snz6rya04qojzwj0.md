---
format: nyxsis-issue
version: 3
id: x5tm4tg7snz6rya04qojzwj0
zone: UICOM
number: 1
title: Remove the timing dependence from the console's reference-page redirect test
type: generic
state: open
created: 2026-10-21T01:27:57.004626233Z
---

`@clockwyrks/ui` in the `ui-common` repository holds the console's pages,
and its tests are deterministic:
`apps/docs/src/content/docs/components/ui/overview.md` and
`apps/docs/src/content/docs/components/web/overview.md`.

## What is wrong

`ui-common` `src/app/pages/testcases/[slug]/TestCaseReferencePage.test.tsx`,
test "redirects to the detail landing when the variant declares no reference
at all", failed once in the superrepo's `workspace-test` gate with
`Unable to find an element with the text: landing` after 4.3 seconds, and
passed in every other run, taking under 40 milliseconds. The test waits one
second for the redirect, so a stall of the test process longer than that
fails it. A test that passes only on a retry is a failing test.

## What to do

Find what the redirect's observation depends on in time or scheduling, and
make the page or the test deterministic there: the test observes the
navigation the page performs rather than waiting a fixed time for its
result.

## Verify

The test passes across repeated runs of `workspace-test` in the superrepo
and of the `typescript` gate in `ui-common`.
