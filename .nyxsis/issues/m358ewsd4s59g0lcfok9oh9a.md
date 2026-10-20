---
format: nyxsis-issue
version: 3
id: m358ewsd4s59g0lcfok9oh9a
zone: CICD
number: 2
title: Keep the superrepo's Rust gate job and Windows binary job within the hosted agent limits
type: generic
state: open
depends_on:
  - j10x004gco5coyozcwcqla2b
created: 2026-10-20T06:15:02.689354007Z
---

The superrepo's `azure-pipelines.yml` runs one gate job per track and the
release jobs on hosted agents:
`apps/docs/src/content/docs/development/building.md`, section "Continuous
integration", and `apps/docs/src/content/docs/development/releasing.md`.

## What is wrong

The pipeline's run 17178 on `nightly` (commit 943c8991) failed:

- The job "Rust" ran longer than the hosted agent's maximum of 120 minutes
  and was cancelled.
- The job "Binary: release build & smoke (windows)" failed in "Restore the
  build output" with "Free disk space on / is lower than 5%", and its
  "Release build" step exited 101.

## What to do

Bring both jobs back inside the agent's limits: build only what each job
gates, restore a cache that fits the agent's disk, and split or shorten the
Rust gate job where a cache alone does not. A stale CI image can make every
build start cold, so land the image pin first.

## Verify

A `nightly` run of `the-test-cabinet` completes green with every job well
under 120 minutes and the Windows job's restore step succeeding.
