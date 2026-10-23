---
format: nyxsis-issue
version: 3
id: r85c3rugqul37ndtjiggxqfl
zone: GGH
number: 4
title: Release gg with the heartbeat and move the driver's pin to the release
type: generic
state: done
created: 2026-10-20T06:15:17.3229195Z
done: 2026-10-21T16:07:09.086689024Z
outcome: |
  Landed in PR 4978 into nightly: gg's nightly (heartbeat events, process-group
  kill on tool timeout, contracts v0.2.3) was promoted to master and tagged
  v0.7.2, pipeline 146's tag run uploaded the two musl binaries and
  gg-reference.tar.gz under gg-releases/v0.7.2 (all answer 200),
  microservice-driver PR 4954 moved crates/driver/gg-release-version to 0.7.2, and
  the superrepo's gg (4c7e6738) and microservice-driver (16d4dea2) gitlinks
  follow. Superrepo gates 28 of 28. Not verified: a staging run showing heartbeat
  events, which follows the staging promotion (CICD-4). gg.rocks still presents
  the 0.7.1 docs; releasing.md does not require the site to follow a release.
---

A running deployment fetches `gg` at the version the driver pins from the
`gg-releases` container, and a version is released by a `v*` tag on the `gg`
repository: `apps/docs/src/content/docs/development/releasing.md`, section
"Releasing gg", and `apps/docs/src/content/docs/gg/overview.md`.

## What is wrong

gg's heartbeat events and its process-group kill on a tool timeout are on
gg's `nightly` (a13c8fb1, pinned to contracts v0.2.2) and the superrepo's
`gg` gitlink names that commit, but the latest gg release is v0.7.1, so a
deployment's run containers fetch a gg without them and the driver's
heartbeat ingestion sees no heartbeat.

## What to do

Promote gg's `nightly` to `master`, tag the release, confirm the release
pipeline uploads the binaries and the reference, and move the driver's gg
version pin to it.

## Verify

The release's files exist under the `gg-releases` container at the new
version, and a run on staging shows `heartbeat` events in its event stream.
