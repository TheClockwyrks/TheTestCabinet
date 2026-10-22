---
format: nyxsis-issue
version: 3
id: m358ewsd4s59g0lcfok9oh9a
zone: CICD
number: 2
title: Keep the superrepo's Rust gate job and Windows binary job within the hosted agent limits
type: generic
priority: 3
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

The pipeline's run 18224 on `nightly` (commit a9463e064) failed in both Rust
jobs while the `Web` and `submodule_pins` jobs passed:

- The job "Rust" spent 46 minutes in "Restore the build output" and then the
  agent stopped answering ("We stopped hearing from agent Azure Pipelines
  7"), so no gate step ran.
- The job "Rust: link every target & seed the rust job" built in 3 minutes
  but its cache save failed twice over: the `cargo-target` key's resolved
  value changed between the restore and the save (a file the key hashes is
  rewritten by the build), and "Free disk space on / is lower than 5%".
- In the earlier run 17178 the "Rust" job ran past the hosted agent's
  maximum of 120 minutes, and the job "Binary: release build & smoke
  (windows)" failed in "Restore the build output" with the same disk
  message and its "Release build" step exited 101.

The Rust workspace the superrepo still holds is small, since the services
and tools were extracted, so the caches these jobs restore and save are
sized for a workspace that no longer exists.

## What to do

Bring the jobs back inside the agent's limits: key the build-output cache on
files the build leaves unchanged, build only what each job gates, restore a
cache that fits the agent's disk, and split or shorten the Rust gate job
where a cache alone does not. A stale CI image can make every build start
cold, so land the image pin first.

## Verify

A `nightly` run of `the-test-cabinet` completes green with every job well
under 120 minutes, every cache save succeeding, and the Windows job's
restore step succeeding.
