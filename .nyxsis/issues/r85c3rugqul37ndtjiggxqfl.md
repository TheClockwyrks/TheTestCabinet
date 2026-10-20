---
format: nyxsis-issue
version: 3
id: r85c3rugqul37ndtjiggxqfl
zone: GGH
number: 4
title: Release gg with the heartbeat and move the driver's pin to the release
type: generic
state: open
created: 2026-10-20T06:15:17.3229195Z
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
