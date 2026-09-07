---
title: Overview
---

The artifact service serves the produced run trees off a persistent volume: a
run's playable build, its proof clips, its validation media, its
[asset-generation](/testing/asset-generation/overview/) media, its
[showcase](/components/core/showcase/) files, and its recorded event logs.
Those bytes survive the ephemeral
[driver](/components/driver/overview/) `Job`s that produced them. The driver
uploads each run's tree here when it finishes, and a
[console](/components/web/overview/) reads it here to play and review a run
before it is published.

The service is a data-plane peer of the control-plane
[backend](/components/backend/overview/). A console reads a run's bytes from the
service directly, so serving them scales independently of the run queue. The
backend tells the console where the artifacts live by reporting the artifact
service's public base URL (`TCAB_ARTIFACTS_PUBLIC_URL`) via `GET /config`, and
the console resolves a pre-publish run's `playableBuild` link and its media
against that.

The backend is also a caller in its own right, over an in-cluster URL of its own
(`TCAB_ARTIFACTS_URL`). It prunes a deleted run's tree, enumerates stored trees
for its [reclamation sweep](/components/backend/overview/#artifact-reclamation),
and reads a published run's media here when baking the public snapshot, for the
runs whose media has aged out of its own ephemeral store. The two URLs are
separate because the advertised one is whatever a browser can resolve, which in a
port-forwarded development cluster is a loopback address the backend pod cannot
reach.

Keeping the two apart keeps the control plane light and lets serving scale on
its own. The backing store is a local filesystem, and can move to an object
store as an internal detail without touching the backend or the console.

## Routes

Each run's tree lives at `<root>/<run-id>/`, and the path `{id}` on every route
is the run record's id.

| Route                                                                                    | Caller                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /runs/{id}/artifacts`                                                              | The driver, uploading a finished run's tree as a tar                                            |
| `DELETE /runs/{id}/artifacts`                                                            | The backend, pruning a deleted run's tree                                                       |
| `GET /runs`                                                                              | The backend, listing every stored tree for its reclamation sweep                                |
| `GET /runs/{id}/tree.tar`                                                                | The publisher Job, pulling the source tree to release                                           |
| `GET /runs/{id}/build[/{path}]`                                                          | A console, loading the playable build                                                           |
| `GET /runs/{id}/proof/{file}`, `/asset/{file}`, `/validation/{file}`, `/showcase/{file}` | A console, loading a run's media; the backend, baking a published run's media into the snapshot |
| `GET /runs/{id}/events.jsonl`, `/raw.jsonl`                                              | A console, reading the recorded logs                                                            |
| `GET /runs/{id}/archive.tar.gz`                                                          | A reviewer, downloading the whole run                                                           |

Both `/runs/{id}/build` and `/runs/{id}/build/` serve the build's `index.html`,
because the build link the driver emits carries a trailing slash and doubles as
the build's `<base href>`. The serve handlers reuse the core's resolvers, so the
per-run base-href rewrite and the path-traversal guard are the same ones every
other host applies.

Every served file states what the resource is and how its body is framed, and
for a name ending `.gz` the compound suffix decides both. A validation recording
is a JSON document travelling compressed, so the media routes serve
`<verdict>__<output>.json.gz` as `application/json` with a gzip content
encoding, and the browser inflates the body before any script reads it.

A recording's images travel beside it as flat files of the same directory,
`img.<id>.png` for a bitmap and `img.<id>.bin` for a raw RGBA pixel buffer,
served by the validation media route as `image/png` and
`application/octet-stream`. An entry inside a recording names one by file name,
so a console resolves it through the lookup it resolved the recording with. See
[the shared image store](/components/core/validation/#the-shared-image-store).

## Auth

The artifact service has no Kubernetes API access. It only talks HTTP.

- Uploads present the driver's per-job token, which the service forwards to the
  backend, the token authority, to verify. The token is minted for the job id,
  which is a different UUID from the run id in the upload path, so the driver
  sends its job id in the `x-tcab-job-id` header and the service verifies
  against that. Only the driver holding a job's token can upload for it.
- The tree delete and the `GET /runs` listing present the shared control-plane
  service token (`TCAB_BACKEND_SERVICE_TOKEN`, the same secret the backend and
  dispatcher share), so only a trusted control-plane caller can enumerate or
  prune trees. When the token is unset both routes reject every caller, which is
  the safe default for a setup that never manages trees through the data plane.

  `GET /runs` answers one entry per stored tree carrying the run id and the
  tree's last-modified time, which is when the driver uploaded it. An upload in
  flight is spooled to an unnamed scratch file, so it is listed only once it has
  been unpacked into a run directory.

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
tar: the generated source, the built playable output, the proof, asset,
validation and showcase media, and the `events.jsonl` and `raw.jsonl` logs. Every entry sits
under a `<run-id>/` prefix, so the archive unpacks into its own directory.

Here the gzip is the resource the reviewer asked for, so the archive is served
as `application/gzip` with no content encoding and lands on disk as the file it
names.

Both whole-tree downloads, this one and the publisher's `tree.tar` pull, are
written to the response as the archive is built. A stored tree can be gigabytes
and the archive route is ungated, so the size a caller asks for must not decide
the service's peak allocation. That peak is a small fixed buffer plus the
compressor's window, independent of the tree, and a client on a slow link slows
the walk down rather than making the service hold a whole tree for it. Both
responses are chunked and carry no `Content-Length`, and the archive's
`Content-Disposition` still names the file.

The run is checked to exist, and its id checked to be a single safe path
segment, before the first byte is written, since the status code is spent once
the body has begun. A failure raised part-way through the walk is logged and
aborts the response body: the buffered tail is dropped and the stream ends with
an error, so the client sees a failed transfer.

The abort is deliberate and the archive's own framing cannot replace it. A tar
builder writes the two zero blocks that terminate an archive from its clean-up
path, and a gzip encoder writes its trailer the same way, so an archive that
stopped half way through the tree is a perfectly well-formed archive: it unpacks
without complaint and `tar -tzf` exits 0. Were the stream simply closed, the
publisher would release a partial source tree and deploy a partial build with
nothing reported anywhere.

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
`crates/artifacts/src/config.rs`. An upload's body is spooled to the store's
volume as it arrives rather than buffered, so the route's 2 GiB limit bounds
disk rather than memory.

It binds all interfaces by default (`0.0.0.0:8790`), because the driver and
console both reach it over the cluster network, and the deployment fronts it
with the same private-network boundary as the other services. It is deployed as
a single-replica `StatefulSet` with a `Service` and its own `ServiceAccount`
with no API access; the local-disk store is single-node, so scaling out means
moving the store rather than adding replicas. See [Kubernetes: staging &
prod](/deployment/kubernetes/run-plane/).
