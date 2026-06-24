---
title: Overview
---

The artifact service serves the **produced run trees** — a run's playable build,
its proof clips, and its [asset-generation](/testing/asset-generation/overview/)
media — off a persistent volume, so those bytes survive the ephemeral
[driver](/components/driver/overview/) `Job`s that produced them. The driver
**uploads** each run's tree here when it finishes; a [console](/components/web/overview/)
**reads** it here to play and review a run before it is published.

It is a deliberate data-plane peer, kept **separate** from the control-plane
[backend](/components/backend/overview/): artifact bytes never transit the backend,
and serving them scales independently of the run queue. The backend only tells the
console *where* the artifacts live — it reports the artifact service's public base
URL (`TCAB_ARTIFACTS_PUBLIC_URL`) via `GET /config`, and the console resolves a
pre-publish run's `playableBuild` link (and its proof/asset media) against that.

## Why a separate service

A run executes in a throwaway sandbox pod whose disk is gone the moment the run
ends. The old worker kept the produced tree on its own disk and served it from
there, which only worked because the worker was long-lived. With runs now
[per-run Jobs](/deployment/kubernetes/), there is no long-lived disk to serve from —
so retention moves to a service whose whole job is to hold those bytes.

Splitting it from the backend keeps two concerns apart:

- **The control plane stays light.** The backend records who ran what and relays a
  run's live events; it never carries the (potentially large) artifact payloads.
- **Serving scales on its own.** The artifact service is a plain data server; its
  backing store is local disk first, and can move to an object store (R2) later as
  an internal detail without touching the backend or the console.

## Auth

The artifact service has **no** Kubernetes API access — it only talks HTTP.

- **Uploads** (from a driver) — it forwards the driver's per-job token to the
  backend, the token authority, to authenticate the upload. Only the driver holding
  a job's token can upload for it.
- **Reads** (from a reviewer, before a run is published) — **ungated**. The console
  loads a run's build and proof/asset media as ordinary browser requests
  (`<img src>`, an `<iframe>` build, and the build's own relative sub-resources),
  none of which can carry an `Authorization` header, and the service's CORS is
  permissive (no credentials), so there is no cookie path either. Reads therefore
  rely on the **private-network boundary plus unguessable run ids** — the same read
  posture as the backend, which already serves a run's record and its *published*
  media to a signed-out reader. (Restoring a real read gate would mean cookie-based
  session auth; a bearer token here only made the media unloadable in a browser.)

Published runs' media are public anyway; the pre-publish window is private by the
network boundary rather than a per-read token.

## Status

The artifact service is implemented as the `test-cabinet-artifacts` crate
(`crates/artifacts`), an [Axum](https://github.com/tokio-rs/axum) server backed by
a local-filesystem store (`TCAB_ARTIFACTS_ROOT`, a `PersistentVolumeClaim` in a
deployment); each run's tree lives at `<root>/<run-id>/`. Its configuration is
entirely environment variables, documented on its
[`config.rs`](https://github.com/TheClockwyrks/TheTestCabinet/blob/master/crates/artifacts/src/config.rs).
It binds all interfaces by default (`0.0.0.0:8790`) because the driver and console
both reach it over the cluster network; the deployment fronts it with the same
private-network boundary as the other services. It is deployed as a single-replica
`StatefulSet` + `Service` + its own `ServiceAccount` (no API access) — see
[Kubernetes: staging & prod](/deployment/kubernetes/).
