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
- **Deletes** (from the backend, when a run is deleted) — `DELETE /runs/{id}/artifacts`,
  gated by the **shared control-plane service token** (`TCAB_BACKEND_SERVICE_TOKEN`,
  the same secret the backend and dispatcher share). Only a trusted control-plane
  caller can prune a tree. When the token is unset the route is **disabled** (it
  rejects every caller), which is the safe default for a dev or single-box setup
  that never deletes through the data plane. The backend issues this best-effort
  when a run is deleted (see the backend's
  [`DELETE /runs/{id}`](/components/backend/api/)).

Published runs' media are public anyway; the pre-publish window is private by the
network boundary rather than a per-read token.

## Downloading a whole run

`GET /runs/{id}/archive.tar.gz` returns a run's **entire** stored tree — the
generated source, the built playable output, the proof/asset/validation media, and
the `events.jsonl`/`raw.jsonl` logs — as one gzip tar, with every entry under a
`<run-id>/` prefix so it unpacks into its own directory.

The consoles (web and Tauri) surface this as a **Download** link on the run detail
page's control strip, beside the Grafana traces link. It is gated on the same
`canExecute` flag as the rest of the internal-only affordances, so the public
gallery never shows it.

This is the fast path for pulling a run's produced assets onto a machine — for
example to feed an asset-generation run's output into another test case.
`scripts/extract-cluster-assets.sh` does the same job for a **deployed** cluster,
but it can only reach one through `az aks command invoke`, which is a command
channel with no file channel: it moves the tree as base64 over stdout in ~320 KiB
chunks (the invoke response is truncated at 512 KiB), one helper-pod round trip of
~15s each. A full-stack run's tree is ~150 chunks, so the script takes tens of
minutes where this endpoint takes one request. Reach for the script only when the
console cannot reach the artifact service.

The read is **ungated**, for the same reason the build and media reads are: the
console offers it as an ordinary download link, which carries no `Authorization`
header. (The separate `GET /runs/{id}/tree.tar` stays token-gated — it is the
publisher's server-to-server pull, whose caller *can* hold a token, and it carries
only the subset the publisher republishes.)

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
