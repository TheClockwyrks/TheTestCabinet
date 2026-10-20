---
format: nyxsis-issue
version: 3
id: zgoe8lwdkdi6knxhfdchxir9
zone: ENGINE
number: 1
title: Remove the timing dependence from case-harness's late-bed audio test
type: generic
state: open
created: 2026-10-20T06:15:36.988899275Z
---

`@clockwyrks/case-harness` in the `engines` repository is the shared
validator harness, and its tests are deterministic:
`apps/docs/src/content/docs/components/engines/overview.md` and
`apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`.

## What is wrong

`engines/packages/case-harness` `audio.spec.ts`, test "steps until a bed that
starts late is running, and counts its start", failed once in the superrepo's
`workspace-test` gate with `expected 1 to be +0` and passed when rerun. A test
that passes only on a retry is a failing test.

## What to do

Find what the test's count of the bed's start depends on in time or
scheduling, and make the harness or the test deterministic there.

## Verify

The test passes across repeated runs of `workspace-test` in the superrepo
and of the `typescript` gate in `engines`.
