---
title: Overview
---

The artifact service serves the produced run trees off a persistent volume: a
run's playable build, its proof clips, its validation media, its
[asset-generation](/testing/asset-generation/overview/) media, and its recorded
event logs. Those bytes survive the ephemeral
[driver](/components/driver/overview/) `Job`s that produced them. The driver
uploads each run's tree here when it finishes, and a
[console](/components/web/overview/) reads it here to play and review a run
before it is published.

The service is a data-plane peer of the control-plane
[backend](/components/backend/overview/). Artifact bytes never transit the
backend, and serving them scales independently of the run queue. The backend
only tells the console where the artifacts live: it reports the artifact
service's public base URL (`TCAB_ARTIFACTS_PUBLIC_URL`) via `GET /config`, and
the console resolves a pre-publish run's `playableBuild` link and its media
against that.

Keeping the two apart keeps the control plane light and lets serving scale on
its own. The backing store is a local filesystem, and can move to an object
store as an internal detail without touching the backend or the console.

## Routes

Each run's tree lives at `<root>/<run-id>/`, and the path `{id}` on every route
is the run record's id.

| Route | Caller |
| --- | --- |
| `POST /runs/{id}/artifacts` | The driver, uploading a finished run's tree as a tar |
| `DELETE /runs/{id}/artifacts` | The backend, pruning a deleted run's tree |
| `GET /runs/{id}/tree.tar` | The publisher Job, pulling the source tree to release |
| `GET /runs/{id}/build[/{path}]` | A console, loading the playable build |
| `GET /runs/{id}/proof/{file}`, `/asset/{file}`, `/validation/{file}` | A console, loading a run's media |
| `GET /runs/{id}/events.jsonl`, `/raw.jsonl` | A console, reading the recorded logs |
| `GET /runs/{id}/archive.tar.gz` | A reviewer, downloading the whole run |

Both `/runs/{id}/build` and `/runs/{id}/build/` serve the build's `index.html`,
because the build link the driver emits carries a trailing slash and doubles as
the build's `<base href>`. The serve handlers reuse the core's resolvers, so the
per-run base-href rewrite and the path-traversal guard are the same ones every
other host applies.

## Auth

The artifact service has no Kubernetes API access. It only talks HTTP.

- Uploads present the driver's per-job token, which the service forwards to the
  backend, the token authority, to verify. The token is minted for the job id,
  which is a different UUID from the run id in the upload path, so the driver
  sends its job id in the `x-tcab-job-id` header and the service verifies
  against that. Only the driver holding a job's token can upload for it.
- Deletes present the shared control-plane service token
  (`TCAB_BACKEND_SERVICE_TOKEN`, the same secret the backend and dispatcher
  share), so only a trusted control-plane caller can prune a tree. When the
  token is unset the route rejects every caller, which is the safe default for a
  setup that never deletes through the data plane. The backend issues the delete
  best-effort when a run is deleted.
- The publisher's `tree.tar` pull presents its per-publish-job token, verified
  the same way against the backend's publish-job endpoint, with the publish job
  id in the `x-tcab-publish-job-id` header. This is the one gated read. It is a
  server-to-server pull whose caller can hold a token, and it carries only the
  subset the publisher republishes.
- Reviewer reads are ungated. A console loads a run's build and media as
  ordinary browser requests: an `<img src>`, an `<iframe>` build, the build's
  own relative sub-resources, and a plain download link for the archive. None of
  those carry an `Authorization` header, and the service's CORS grants no
  credentials. Read protection is therefore the private-network boundary plus
  unguessable run ids, the same posture the backend applies to a run's record.

## Downloading a whole run

`GET /runs/{id}/archive.tar.gz` returns a run's entire stored tree as one gzip
tar: the generated source, the built playable output, the proof, asset and
validation media, and the `events.jsonl` and `raw.jsonl` logs. Every entry sits
under a `<run-id>/` prefix, so the archive unpacks into its own directory.

The web and Tauri consoles surface this as a Download link on the run detail
page's control strip. It is gated on the same `canExecute` flag as the rest of
the internal-only affordances, so the public gallery never shows it.

This is the fast path for pulling a run's produced assets onto a machine, for
example to feed an asset-generation run's output into another test case.
`scripts/extract-cluster-assets.sh` does the same job for a deployed cluster it
can only reach through `az aks command invoke`, a command channel with no file
channel: it moves the tree as base64 over stdout in roughly 320 KiB chunks, one
helper-pod round trip of about 15 seconds each. A full-stack run's tree is
around 150 chunks, so the script takes tens of minutes where this endpoint takes
one request. Reach for the script only when the console cannot reach the
artifact service.

## Deployment

The artifact service is the `test-cabinet-artifacts` crate (`crates/artifacts`),
an [Axum](https://github.com/tokio-rs/axum) server backed by a local-filesystem
store rooted at `TCAB_ARTIFACTS_ROOT`, a `PersistentVolumeClaim` in a
deployment. Its configuration is entirely environment variables, documented in
`crates/artifacts/src/config.rs`. An upload's body is buffered before it is
unpacked, so the upload route carries a 2 GiB limit.

It binds all interfaces by default (`0.0.0.0:8790`), because the driver and
console both reach it over the cluster network, and the deployment fronts it
with the same private-network boundary as the other services. It is deployed as
a single-replica `StatefulSet` with a `Service` and its own `ServiceAccount`
with no API access; the local-disk store is single-node, so scaling out means
moving the store rather than adding replicas. See [Kubernetes: staging &
prod](/deployment/kubernetes/run-plane/).
