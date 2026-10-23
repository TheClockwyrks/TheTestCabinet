---
title: Overview
---

The artifacts service owns every byte a run produces and every byte the public
reads. It is the write-through store of run trees: a run's playable build, its
proof clips, its validation media, its
[asset-generation](/testing/asset-generation/overview/) media, its
[showcase](/components/driver/showcase/) files, and its recorded event logs. The
[driver](/components/driver/overview/) uploads each run's tree here when it
finishes, a [console](/components/web/overview/) reads it here to play and
review a run before it is published, and the
[backend](/components/backend/overview/) writes the public dataset through it
when a run publishes.

The service is a data-plane peer of the control-plane backend. A console reads a
run's bytes from the service directly, so serving them scales independently of
the run queue. The console and the service share one origin: the
[edge](/deployment/kubernetes/edge/) routes `/artifacts/` of the environment's
hostname to the service, and the console resolves a pre-publish run's
`playableBuild` link and its media under that path.

## Object stores

The service is the one writer of two object stores, and no other component
holds a credential for either.

- A private Azure Blob container per environment holds the run trees. The
  service authenticates to it with its managed identity. An unpublished run is
  served to the console from this container, through the routes below, behind
  the Access boundary.
- The public Cloudflare R2 bucket (`snapshot.testcabinet.ai`) holds the
  [public dataset](/components/backend/snapshot/): documents, media, index
  objects and short-code objects. The backend composes each object and writes
  it through the service.

The service is stateless. It holds no volume, and a replica is interchangeable
with any other, so the deployment scales it horizontally.

## Routes

The path `{id}` on every route is the run record's id.

| Route                                                                                    | Caller                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /runs/{id}/artifacts`                                                              | The driver, uploading a finished run's tree as a tar                                                                                    |
| `DELETE /runs/{id}/artifacts`                                                            | The backend, pruning a deleted run's tree                                                                                               |
| `GET /runs`                                                                              | The backend, listing every stored tree for its reclamation sweep                                                                        |
| `GET /runs/{id}/tree.tar`                                                                | The publisher Job, pulling the source tree to release                                                                                   |
| `GET /runs/{id}/build[/{path}]`                                                          | A console, loading the playable build                                                                                                   |
| `GET /runs/{id}/proof/{file}`, `/asset/{file}`, `/validation/{file}`, `/showcase/{file}` | A console, loading a run's media                                                                                                        |
| `GET /runs/{id}/events.jsonl`, `/raw.jsonl`                                              | A console, reading the recorded logs                                                                                                    |
| `GET /runs/{id}/archive.tar.gz`                                                          | A reviewer, downloading the whole run                                                                                                   |
| `GET /runs/{id}/replay`, `/code-analysis`                                                | A person or an analysis tool, reading the gg session record or the code analysis                                                        |
| `POST /runs/{id}/publish-media`                                                          | The backend, copying a published run's media from Blob to R2                                                                            |
| `PUT /public/{key}`                                                                      | The backend, writing one object of the public dataset; the CLI, an asset reference                                                      |
| `GET /public?prefix={prefix}`                                                            | The backend, listing the public keys under a prefix (the publish's skip sets, the prune of superseded generations, reference discovery) |
| `DELETE /public/{key}`                                                                   | The backend, deleting one public object (pruning superseded generations)                                                                |

An upload is written straight through to the run's prefix in the private
container, and the response lands once the tree is stored. A read is answered
either by streaming the object or by a `302` to a short-lived signed URL of the
object store, and the service chooses per route. A client follows the redirect
as any browser or HTTP client does, so the choice is invisible to it.

Both `/runs/{id}/build` and `/runs/{id}/build/` serve the build's `index.html`,
because the build link the driver emits carries a trailing slash and doubles as
the build's `<base href>`. Every host that serves a build applies the same
per-run base-href rewrite and the same path-traversal guard.

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
[the shared image store](/components/driver/validation/#the-shared-image-store).

### Publishing a run's media

`POST /runs/{id}/publish-media` copies the run's publishable media, its proof,
asset, validation and showcase files, from the private container to the public
bucket under `media/runs/<run-id>/`, and answers with the public keys it wrote.
The copy is object-store to object-store, so no byte passes through the backend.
It is idempotent: an object the bucket already holds is left in place, and a
second call answers the same keys.

`PUT /public/{key}` writes one object of the public dataset at the given key
with the request's body and content type. The backend writes a run's document,
the index objects and the `index.json` pointer with it, and the
[CLI](/components/cli/overview/#reference-implementations-and-baselines) writes
an asset-generation case's reference frames with it. A key is written whole, so
a reader sees either the previous object or the new one.

### Listing and deleting public objects

`GET /public?prefix={prefix}` answers every object of the public bucket whose key
starts with the prefix, each with its key, its size in bytes and its
last-modified time. An absent or empty prefix lists the whole bucket. The answer
is one response, because the service follows the store's paging itself. A prefix
may end in `/` and is otherwise validated like a key.

`DELETE /public/{key}` deletes one object of the public bucket. It is idempotent:
deleting a key the bucket does not hold succeeds.

## Auth

The artifacts service has no Kubernetes API access. It only talks HTTP.

- Uploads present the driver's per-job token, which the service forwards to the
  backend, the token authority, to verify. The token is minted for the job id,
  which is a different UUID from the run id in the upload path, so the driver
  sends its job id in the `x-tcab-job-id` header and the service verifies
  against that. Only the driver holding a job's token can upload for it.
- The tree delete, the `GET /runs` listing, `publish-media`, the backend's
  `PUT /public/{key}` writes, and the `GET /public` listing and
  `DELETE /public/{key}` present the shared control-plane service token
  (`TCAB_BACKEND_SERVICE_TOKEN`, the same secret the backend and dispatcher
  share). When the token is unset these routes reject every caller.

  `GET /runs` answers one entry per stored tree carrying the run id and the
  tree's last-modified time, which is when the driver uploaded it. `GET /public`
  answers one entry per object carrying its key, its size and its last-modified
  time.

  The `GET /public` listing and `DELETE /public/{key}` admit the service token
  alone. The CLI's Access service token writes with `PUT /public/{key}` and is
  refused by both.

- The publisher's `tree.tar` pull presents its per-publish-job token, verified
  the same way against the backend's publish-job endpoint, with the publish job
  id in the `x-tcab-publish-job-id` header.
- Every request that arrives through the edge carries the
  `Cf-Access-Jwt-Assertion` header, which the service verifies against the
  Access application's certificates and audience tag exactly as the
  [backend](/components/backend/overview/#identity) does, refusing a request
  without a valid one. A console's reads are ordinary browser requests under the
  Access cookie, and the CLI's `PUT /public/{key}` carries an Access service
  token whose assertion names a `common_name`. In-cluster callers never cross
  the edge and present the tokens above instead.

## Downloading a whole run

`GET /runs/{id}/archive.tar.gz` returns a run's entire stored tree as one gzip
tar: the generated source, the built playable output, the proof, asset,
validation and showcase media, and the `events.jsonl` and `raw.jsonl` logs.
Every entry sits under a `<run-id>/` prefix, so the archive unpacks into its own
directory. The archive is the resource the reviewer asked for, so it is served
as `application/gzip` with no content encoding and lands on disk as the file it
names.

Both whole-tree downloads, this one and the publisher's `tree.tar` pull, are
written to the response as the archive is built from the stored objects. The
service's peak allocation is a small fixed buffer plus the compressor's window
whatever the tree's size, and a client on a slow link slows the walk down. Both
responses are chunked and carry no `Content-Length`.

The run's existence, and its id's shape as a single safe path segment, are
checked before the first byte is written, since the status code is spent once
the body has begun. A failure raised part-way through the walk is logged and
aborts the response body, so a truncated download reaches the client as a failed
transfer.

The console offers this download to a reviewer, and the public gallery never
exposes it. It is the fast path for pulling a run's produced assets onto a
machine, for example to feed an asset-generation run's output into another test
case. A run's implementation as a git repository is the
[repos service](/components/repos/overview/)'s download instead.

## Deployment

The artifacts service is the `tcab-artifacts` binary of the
`microservice-artifacts` repository, an Axum server over the two object stores.
Its configuration is entirely environment variables, documented in the
repository's `crates/artifacts/src/config.rs`: the private container's account
and name, the public bucket's endpoint, name and credentials, the backend URL
the tokens are verified against, the service token, and the Access application's
team domain and audience tag. An upload's body is streamed to the private
container as it arrives, so the route's 2 GiB limit bounds the object rather
than memory.

It binds all interfaces by default (`0.0.0.0:8790`), because the driver, the
backend and the edge all reach it over the cluster network. It is deployed as a
`Deployment` behind a `ClusterIP` `Service`, with its own `ServiceAccount` with
no API access and the workload identity its managed identity binds to, and its
replica count is a free choice. See [Run plane](/deployment/kubernetes/run-plane/).
