---
title: Overview
---

The artifact service serves the produced run trees off a persistent volume: a
run's playable build, its proof clips, its validation media, its
[asset-generation](/testing/asset-generation/overview/) media, its
[showcase](/components/core/showcase/) files, and its recorded event logs. Those
bytes survive the ephemeral [driver](/components/driver/overview/) `Job`s that
produced them. The driver uploads each run's tree here when it finishes, and a
[console](/components/web/overview/) reads it here to play and review a run
before it is published.

The service is a data-plane peer of the control-plane
[backend](/components/backend/overview/). A console reads a run's bytes from the
service directly, so serving them scales independently of the run queue. The
backend reports the artifact service's public base URL
(`TCAB_ARTIFACTS_PUBLIC_URL`) via `GET /config`, and the console resolves a
pre-publish run's `playableBuild` link and its media against that.

The backend is also a caller in its own right, over an in-cluster URL of its own
(`TCAB_ARTIFACTS_URL`). It prunes a deleted run's tree, enumerates stored trees
for its [reclamation sweep](/components/backend/overview/#artifact-reclamation),
and reads a published run's media here when baking the public snapshot, for the
files its own store does not hold. The sweep decides how
long each tree is kept: the service stores a tree until the backend deletes
it. The two URLs are
separate because the advertised one is whatever a browser can resolve, which in
a port-forwarded development cluster is a loopback address the backend pod
cannot reach.

The backing store is a local filesystem, and can move to an object store as an
internal detail without touching the backend or the console.

## Routes

Each run's tree lives at `<root>/<run-id>/`, and the path `{id}` on every route
is the run record's id.

| Route                                                                                    | Caller                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /runs/{id}/artifacts`                                                              | The driver, uploading a finished run's tree as a tar                                            |
| `DELETE /runs/{id}/artifacts`                                                            | The backend, pruning a deleted run's tree and reclaiming the trees its sweep selects            |
| `GET /runs/{id}/artifacts`                                                               | The backend, asking whether a run's tree is stored before it enqueues a publish                 |
| `GET /runs`                                                                              | The backend, listing every stored tree for its reclamation sweep                                |
| `GET /capacity`                                                                          | The backend, reading the store volume's free space                                              |
| `GET /runs/{id}/tree.tar`                                                                | The publisher Job, pulling the source tree to release                                           |
| `GET /runs/{id}/build[/{path}]`                                                          | A console, loading the playable build                                                           |
| `GET /runs/{id}/proof/{file}`, `/asset/{file}`, `/validation/{file}`, `/showcase/{file}` | A console, loading a run's media; the backend, baking a published run's media into the snapshot |
| `GET /runs/{id}/media`                                                                   | The backend, listing the validation, showcase and root files of a published run's tree          |
| `GET /runs/{id}/root/{name}`                                                             | The backend, baking a file at the root of a published run's tree into the snapshot              |
| `GET /runs/{id}/events.jsonl`, `/raw.jsonl`                                              | A console, reading the recorded logs                                                            |
| `GET /runs/{id}/archive.tar.gz`                                                          | A reviewer, downloading the whole run                                                           |

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
[the shared image store](/components/core/validation/#the-shared-image-store).

## Storing a tree

An upload replaces a run's tree as a whole. The service spools the tar to the
store's volume, unpacks it into a staging directory on that volume, and renames
the staging directory to `<root>/<run-id>/` once every entry has been written.
A run directory therefore always holds a complete tree: an upload that fails
part way, on a full volume or a refused entry, removes its staging directory and
leaves the run with the tree it had before, or with none.

How an upload fails says whose fault it was, because the
[driver](/components/driver/overview/#artifacts) waits on the store's faults and
not on its own tree's:

| Answer | Meaning                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ |
| `400`  | An entry names a path outside the tree                                                                 |
| `413`  | The tree is over the size cap                                                                          |
| `422`  | The body is not an archive the service can read, with no error from the volume anywhere in the failure |
| `503`  | The request body stopped arriving                                                                      |
| `500`  | The volume refused a write: full, read-only, a disk fault, lost permissions                            |

Directories are created with the service's own mode rather than the archive's,
so a tree that holds a read-only directory unpacks like any other.

A tree that replaces an earlier one is exchanged with it in a single step, so
the run directory holds a complete tree at every instant. A filesystem with no
such step has the earlier tree moved aside first, and a service that stops
between the two moves puts it back when it next starts.

Staging directories live under `<root>/.staging/`. The listing, the presence
check and every read address run directories only, so a staged upload is never
reported as a tree, and the service clears the staging directory at startup.

`GET /runs/{id}/artifacts` answers `200` with `{ "id", "stored" }`, where
`stored` says whether the run has a tree. Absence is an answer rather than an
error status, so a caller can tell a run with no tree from a service it could
not reach. An id that is not a single path segment answers `400`.

## Capacity

`GET /capacity` answers `200` with `{ "freeBytes", "totalBytes", "writable" }`.
The two byte figures are read from the filesystem the store root is on at the
moment of the request. `freeBytes` is the space an upload can still be written
into, and `totalBytes` is the filesystem's size.

`writable` is the result of a write check made for the request. The check
takes the path an upload takes, with a tree of one small file:

1. It spools a file in the directory uploads are spooled into and syncs it to
   the volume.
2. It creates a staging directory and unpacks a one-file archive into it.
3. It renames the staging directory into the store root, as
   `.write-check.<pid>.<n>`.
4. It reads the file back, and removes what it made.

A check that fails at any step answers `"writable": false` with the error as
`writeError`, so a read-only volume, a disk fault, lost permissions, a full
volume and a store root that takes no new directory are each reported before a
run's tree depends on the store. A check directory left by a service that
stopped part way is removed when the service next starts, and is never listed
as a run.

The check does not cover everything an upload needs. It writes a few bytes, so
a quota or a fault that only a large write meets passes it, and it does not
verify a job token with the backend, which every upload does. The backend
covers both from the other side: an
[upload that fails](/components/backend/overview/#evidence-from-uploads) holds
the queue whatever the check says.

One check runs at a time. A request that arrives while an earlier check has not
returned, which is what a hung volume looks like, is answered at once with the
last byte figures and
`"writable": false, "writeError": "the previous write check has not returned"`,
or with `503` when no figures have been read yet. Neither the check nor the
free-space read runs on the threads that serve requests.

The backend polls the route and
[holds new runs back](/components/backend/overview/#artifact-capacity) while
the volume is nearly full or the write check fails.

An upload needs about twice its tree's size while it lands, because the tar is
spooled onto the volume before it is unpacked there.

`GET /runs/{id}/media` answers `200` with `{ "id", "stored", "validation",
"showcase", "root" }`. `validation` and `showcase` are the names of the files the
tree holds in its validation media directory and its showcase directory, each a
name the `/validation/{file}` or `/showcase/{file}` route serves, and both are
empty for a run with no tree. `root` names the files the `/root/{name}` route
serves for the run. The backend's snapshot refresh reads it for a published
run whose media it has not yet confirmed in the bucket. Two of a run's file sets
are named by nothing but the directory they sit in: the image store its
recordings share, and showcase files that neither the carousel nor the
description mentions. The refresh publishes them from this listing, and a run
is [confirmed](/components/backend/overview/#artifact-reclamation) only once
every file listed here is in the bucket. The route is ungated, like the media
routes whose names it lists. As with the presence check, absence is an answer
in the body, and an id that is not a single path segment answers `400`.

`GET /runs/{id}/root/{name}` serves one of two files that sit outside the
tree's media directories, under the name the backend stores each as:

| `{name}`             | The file in the tree                                    |
| -------------------- | ------------------------------------------------------- |
| `controller.wasm`    | The controller module an adversarial run's record names |
| `code-analysis.json` | `code-analysis.json.gz` at the tree's root              |

The bytes are served as stored, so the document arrives gzipped. `404` for
any other name and for a file the tree does not hold, and `500` for a file that
could not be read. A caller that has to tell a missing file from a service too
old to have the route reads `root` in the listing first. The route is ungated,
like the archive that carries the same files.

## Auth

The artifact service has no Kubernetes API access. It only talks HTTP.

- Uploads present the driver's per-job token, which the service forwards to the
  backend, the token authority, to verify. The token is minted for the job id,
  which is a different UUID from the run id in the upload path, so the driver
  sends its job id in the `x-tcab-job-id` header and the service verifies
  against that. Only the driver holding a job's token can upload for it.
- The tree delete, the presence check, the `GET /runs` listing and the
  `GET /capacity` reading present the shared control-plane service token
  (`TCAB_BACKEND_SERVICE_TOKEN`, the same secret the backend and dispatcher
  share), so only a trusted control-plane caller can enumerate, probe, measure
  or prune the store. When the token is unset the four routes reject every
  caller.

  `GET /runs` answers one entry per stored tree carrying the run id and the
  tree's last-modified time, which is when the driver uploaded it. An upload in
  flight is spooled to an unnamed scratch file and unpacked into a staging
  directory, so it is listed only once its tree is complete.

- The publisher's `tree.tar` pull presents its per-publish-job token, verified
  the same way against the backend's publish-job endpoint, with the publish job
  id in the `x-tcab-publish-job-id` header. This is the one gated read.
- Reviewer reads are ungated. A console loads a run's build and media as
  ordinary browser requests, which carry no `Authorization` header, and the
  service's CORS grants no credentials. Read protection is the private-network
  boundary plus unguessable run ids, the same posture the backend applies to a
  run's record.

## Downloading a whole run

The console offers this download for an unpublished run. A published run's
download is its released source instead, since the backend
[reclaims a published run's tree](/components/backend/overview/#artifact-reclamation).

`GET /runs/{id}/archive.tar.gz` returns a run's entire stored tree as one gzip
tar: the generated source, the built playable output, the proof, asset,
validation and showcase media, and the `events.jsonl` and `raw.jsonl` logs.
Every entry sits under a `<run-id>/` prefix, so the archive unpacks into its own
directory. The archive is the resource the reviewer asked for, so it is served
as `application/gzip` with no content encoding and lands on disk as the file it
names.

Both whole-tree downloads, this one and the publisher's `tree.tar` pull, are
written to the response as the archive is built. The service's peak allocation
is a small fixed buffer plus the compressor's window whatever the tree's size,
and a client on a slow link slows the walk down. Both responses are chunked and
carry no `Content-Length`.

The run's existence, and its id's shape as a single safe path segment, are
checked before the first byte is written, since the status code is spent once
the body has begun. A failure raised part-way through the walk is logged and
aborts the response body, so a truncated download reaches the client as a failed
transfer.

The web console offers this download to a reviewer, gated so the public gallery
never exposes it.

This is the fast path for pulling a run's produced assets onto a machine, for
example to feed an asset-generation run's output into another test case.
`scripts/extract-cluster-assets.sh` does the same job for a deployed cluster
reachable only through `az aks command invoke`. Reach for the script only when
the console cannot reach the artifact service.

## Deployment

The artifact service is the `test-cabinet-artifacts` crate (`crates/artifacts`),
an Axum server backed by a local-filesystem store rooted at
`TCAB_ARTIFACTS_ROOT`, a `PersistentVolumeClaim` in a deployment. Its
configuration is entirely environment variables, documented in
`crates/artifacts/src/config.rs`. An upload's body is spooled to the store's
volume as it arrives, so the route's 2 GiB limit bounds disk rather than memory.

It binds all interfaces by default (`0.0.0.0:8790`), because the driver and
console both reach it over the cluster network, and the deployment fronts it
with the same private-network boundary as the other services. It is deployed as
a single-replica `StatefulSet` with a `Service` and its own `ServiceAccount`
with no API access. The local-disk store is single-node, so scaling out means
moving the store rather than adding replicas. See [Kubernetes: staging &
prod](/deployment/kubernetes/run-plane/).
