---
title: Overview
---

The backend is a Rust server that holds The Test Cabinet's definitions and
results. It distributes the test case definitions a runner needs to execute a
run and stores the run records those runs produce, so every run and every
published result is coordinated through one service.

Two interfaces are the backend's cross-component contracts: its [HTTP
API](/components/backend/api/) and the [public
snapshot](/components/backend/snapshot/) it exports. Everything else, including
how it stores what it serves, is internal.

## Responsibilities

The backend serves two kinds of client, described in [Runners and
Reporters](/components/architecture/#runners-and-reporters):

- Runners (the CLI and driver) resolve test case definitions from the
  backend. The driver reports each [run record](/components/core/run-records/)
  back to it when the run finishes.
- Reporters (the web console, and the public site through the snapshot) read
  definitions and published results to display them.

Each runner resolves its run-container image from its own registry
configuration.

The backend holds two bodies of data.

### Test case definitions

Cases are authored in the repository's `test-cases/` and `game-jams/` folders,
in the formats the [testing](/testing/overview/) pages specify. An ingest scan
copies each new or changed version out of the repository checkout into the
backend's on-disk definition store, rendering the version's reference mockups to
screenshots as it goes. The repository is the editing source and the store is
the distribution source a runner resolves at run time. Ingest caches a version
rather than transforming it.

A version's baseline validation media lives in the checkout's `cold-storage`
submodule rather than in its folder. Ingest copies it into the stored version's
`validation-baseline/`, where the API serves it and the snapshot publishes it
(see [where baselines live](/components/core/validation/#where-baselines-live)).
The deployed ingest sidecar fetches the submodule shallowly on every refresh of
its checkout, and asks for no ingest when the checkout or the submodule could
not be brought to the branch tip (see [the ingest
sidecar](/deployment/kubernetes/control-plane/#the-ingest-sidecar)).

Ingest writes each version as a resolved record whose shape the backend build
defines, so a store is readable only by a build that agrees on that shape. The
store records a record-format version stamped by the ingest that wrote it, and
the backend compares it against the format the running build reads. A store
stamped with any other format holds records the running build cannot read. The
backend reports it unready, and the next ingest scan re-ingests the whole
catalog so the store returns to a format it can serve.

### Run results

The stored [run records](/components/core/run-records/) with their reviews and
links, persisted in a relational database (embedded SQLite by default, or
PostgreSQL). A run's proof, asset and validation media is written beside the
definitions in the on-disk store rather than into that database. This is the
system of record for every run, published or not.

A stored record can predate a change to the run record contract, leaving it
unreadable by the running build. The backend records, per run, whether the build
can read that run's record and the record-format generation the decision was
made under. Every run listing counts and serves exactly the readable runs, so a
listing's reported total equals the number of rows it can return. A build whose
record format differs from the stamp on a row re-decides that row's readability
once at startup, before it serves.

The generation is pinned to the shape of the run record contract, which covers
the record schema together with every schema it references, such as the gg
capability set a gg run's record embeds. The build records the contract shape
each generation was decided against, and a change to that shape fails the
build's tests until it is either recorded under the current generation, which
asserts that stored records survive it, or given a new generation.

A run the build cannot read stays reachable on its own terms. `GET
/runs/unreadable` lists each such run's lifted identity together with the error
its stored record produces, paged like every other listing, and `DELETE
/runs/{id}` deletes it. Both act on the stored row rather than on the record, so
a published run is deletable here, being already absent from the snapshot and
the gallery.

## Authentication

The backend stays on a private network. In a [cluster
deployment](/deployment/kubernetes/overview/) it is a `ClusterIP` service with
no public `Ingress`, so reachability is the first line of access control.

On top of that boundary, bearer tokens identify who is acting:

- Reads are open. Resolving definitions and reading runs require only that the
  caller can reach the backend.
- Mutations require a token. The mutating run endpoints answer `401` without an
  `Authorization: Bearer <token>` header. Each token is resolved to an account
  by the standalone [auth service](/components/auth/overview/), and the
  resulting [review](/components/core/results/#reviews) is attributed to that
  account.

The dispatcher authenticates with a shared service token
(`TCAB_BACKEND_SERVICE_TOKEN`) to claim queued jobs, and each driver
authenticates with the per-job token minted when its job was enqueued.

## Review and publish

A produced run reaches the gallery through steps the backend mediates.

A run's record is stored privately the moment the run finishes: the driver
reports it when it posts the job's terminal status, and the produced build and
media land on the [artifact service](/components/artifacts/overview/). The build
is playable, so the run can be reviewed. Review attaches one review per account
to the run.

Publish releases the run: its generated source to its own public repository and
its build to Cloudflare Pages. The endpoint gates the run, refusing a legacy run
with no review, and enqueues a per-publish `tcab-publisher` Job that the
[dispatcher](/components/dispatcher/overview/) claims. A run with a publish
already under way is attached to that job, so a run never has two releases in
flight.

A completed validator-rated run is published by the backend itself, with no
operator action, as described under
[automatic publishing](/components/core/results/#automatic-publishing).
When that Job reports a
terminal success the backend marks the run published, regenerates the public
snapshot from the full set of published runs, uploads it, and triggers a site
rebuild.

The backend serializes refreshes so two of them cannot race on shared state,
and it batches the requests for one. Regenerating the whole published set on
each refresh keeps the operation idempotent.

### Refresh batching

Each refresh ends in a full site rebuild, so the backend releases refreshes in
batches. A request is one change to what the public snapshot shows: a run's
publish, a review on a published run, a published comparison, an ingest that
changed the definition store, or a change to the model catalog or a list price.
Each request counts as one, whatever its kind.

A batch is released by whichever of two conditions comes first:

- Threshold: the number of pending requests reaches
  `TCAB_SNAPSHOT_BATCH_SIZE`.
- Quiet: no request has arrived for `TCAB_SNAPSHOT_COALESCE_MS`.

A long sequence of publishes therefore reaches the gallery at least every
`TCAB_SNAPSHOT_BATCH_SIZE` runs, sooner when requests of the other kinds arrive
among them. A sequence that stops short of the threshold is released one quiet
window after its last request.

Two releases are at least `TCAB_SNAPSHOT_MIN_INTERVAL_MS` apart, measured from
the end of one refresh to the start of the next. A batch that becomes due inside
the interval is held until the interval ends and then carries every request that
arrived in the meantime. A burst of 100 publishes with the default settings is
one rebuild at once and a second one ten minutes later.

A request that arrives while a refresh is running counts toward the next batch.
Pending requests are recorded in the database, so a backend that restarts with
requests pending refreshes once at startup. That refresh waits out what the last
upload before the restart left of the minimum interval, so a backend restarting
in a loop rebuilds the gallery no more often than one that stays up. A backend
that cannot read the record at startup refreshes as though requests were
pending.

A refresh that fails keeps its requests, which are released again after the
minimum interval or one minute, whichever is longer. The wait doubles with each
consecutive failure, up to six hours, and returns to the minimum interval with
the first refresh that succeeds. A refresh still running after
`TCAB_SNAPSHOT_REFRESH_TIMEOUT_MS` is abandoned and counts as failed, so a
stalled bucket call cannot hold up every later refresh.

The deploy hook is the last step of a refresh, after the upload has cut over
and the superseded generations have been pruned. A hook that fails, or gives no
answer within 30 seconds, fails the refresh, and each retry uploads a new
generation, which is what the growing wait bounds.

[`POST /snapshot/refresh`](/components/backend/api/#post-snapshotrefresh) is the
one immediate path. It waits for a refresh already running, refreshes, carries
every pending request, and starts the minimum interval. It is exempt from the
wait that follows a failed refresh.

Each release logs one `info` line, `releasing a snapshot refresh batch`, with
the `reason` (`threshold`, `quiet`, `recovery` or `forced`) and the number of
`requests` it carried.

## Artifact reclamation

The backend owns the lifetime of a run's tree on the [artifact
service](/components/artifacts/overview/), reaching the service over
`TCAB_ARTIFACTS_URL` with the shared service token.

Deleting a run removes its row and then prunes its tree. The prune is
best-effort, so the delete succeeds regardless of the data plane's health.

A periodic sweep reclaims what a failed prune left, and anything else the volume
holds with no run behind it. The tree of a run that still exists is never
reclaimed, whatever the run's age or state, so the sweep frees space only as
runs are deleted. Each pass lists the service's stored trees, keeps
every tree whose id still has a run row, and deletes the rest once they are
older than a grace window. The grace window covers the interval between a driver
uploading a run's tree and reporting the run terminal.

`TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS` sets the pass interval and `0` disables the
sweep. `TCAB_ARTIFACT_SWEEP_GRACE_HOURS` sets the grace window.

Every pass that lists the service's trees logs one `info` line, `artifact sweep
pass complete`, with six counts: the trees `listed`, the `orphans` selected for
deletion, the trees `reclaimed`, the deletes that `failed`, and the runs whose
[artifact presence](#artifact-presence) the pass changed, `marked_stored` and
`marked_not_stored`. A pass that changes nothing logs the same line with zero
counts.

A pass acts only on a run-id set the backend read and found at least one run in.
A query that fails and one that comes back empty both abandon the pass, which is
retried at the next interval, so a database fault or a backend brought up
against a fresh database beside a populated volume leaves the volume intact. A
failing tree listing abandons the pass the same way.

An abandoned pass logs one `warn` line in place of the `info` one, `artifact
sweep pass abandoned`, with the `reason` (`no_runs`, `runs_unreadable` or
`listing_failed`). Every pass therefore logs exactly one of the two lines.

## Artifact presence

A run can be released only from its stored tree, so the backend records for each
run whether the [artifact service](/components/artifacts/overview/) holds one.
The record has three values: stored, not stored, and unknown. Unknown is a run
nothing has reported on yet, which is every run of a backend with no artifact
service configured.

Three sources write it:

- The driver's terminal status report, whose `artifactsStored` says whether its
  upload was acknowledged.
- The reclamation sweep. Each pass that lists the service's trees marks every
  run in the listing stored and every other run not stored, which is how a run
  whose tree was lost before the backend recorded presence is found. The run ids
  are read before the trees are listed, so a run that lands during the pass is
  left for the next one. A listing that comes back empty marks nothing, for the
  reason an empty run-id set sweeps nothing.
- The publish gate below, which records the answer it was given.

Every publish passes one gate before a publish job is enqueued, whichever of the
three paths asked for it: [automatic
publishing](/components/core/results/#automatic-publishing), an operator's
[`POST /runs/{id}/publish`](/components/backend/api/#post-runsidpublish), and a
[comparison publish](/comparisons/publishing/). The gate asks the artifact
service directly whether the run's tree is stored, over `TCAB_ARTIFACTS_URL`
with the service token, and acts on the answer:

| Answer                         | Automatic publishing                          | An operator's publish | A comparison publish           |
| ------------------------------ | --------------------------------------------- | --------------------- | ------------------------------ |
| The tree is stored             | Enqueues                                      | Enqueues              | Enqueues                       |
| The run has no tree            | Passes over the run, recording no publish job | Refuses with `409`    | Skips the run, with the reason |
| The service gave no answer     | Passes over the run, which is retried         | Refuses with `503`    | Skips the run, with the reason |
| No artifact service configured | Enqueues                                      | Enqueues              | Enqueues                       |

A run whose release is already under way keeps its job and is not asked about.
Automatic publishing logs each run it passes over, at `warn`, with the run id
and which of the two answers it got. A status report whose driver could not
store the run's tree is logged at `warn` as it is accepted.

Automatic publishing marks each run it passes over and
[retries the marked runs](/components/core/results/#automatic-publishing) every
five minutes, so a run that finished while the artifact service gave no answer
publishes once it does. A service that answers any status but success gives no
answer in this sense, which includes an artifact service image that predates
the presence route: runs that finish while a rollout has the backend ahead of
the artifact service are published by the retry once the service has rolled.

Reconciliation leaves a run's mutation timestamp alone when it moves the run
from unknown to stored, since nothing a console shows has changed, and stamps
every other change. The first pass over an existing cabinet therefore stamps
only the runs it finds without a tree.

## Artifact capacity

A finishing run's tree is lost for good when the
[artifact service](/components/artifacts/overview/) cannot store it, so the
backend hands out a new run only while every condition for storing one is
green. It polls the service's `GET /capacity` over `TCAB_ARTIFACTS_URL` with the
service token. Each reading carries the volume's free space and the result of
the service's [write check](/components/artifacts/overview/#capacity), and the
backend derives one state from the latest reading:

| State         | Condition                                              | Runs       |
| ------------- | ------------------------------------------------------ | ---------- |
| `ok`          | Free space is at or above the warn threshold           | Dispatched |
| `low`         | Free space is under the warn threshold (default 3 GiB) | Dispatched |
| `blocked`     | Free space is under the stop threshold (default 2 GiB) | On hold    |
| `unwritable`  | The service's write check failed                       | On hold    |
| `unavailable` | The latest reading is older than three poll intervals  | On hold    |
| `unmonitored` | No artifact service or no service token is configured  | Dispatched |

`blocked` takes precedence over `unwritable`, since a full volume fails the
write check as well.

The stop threshold is the reserve for the runs in flight. The dispatcher runs up
to eight at once and the largest tree is about 180 MB, so the eight stored trees
take about 1.4 GB of the reserve. A tree needs about twice its size on the
volume while it uploads, and the rest of the reserve is that transient room: it
covers three of the eight landing at the same moment. A deployment that raises
`TCAB_DISPATCHER_MAX_INFLIGHT` raises the stop threshold in proportion.

### The hold

Runs are on hold while any of these is true, and the first that applies is the
reported reason:

| Reason                | Condition                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `unreadable`          | The state is `unavailable`                                                                        |
| `low-space`           | The state is `blocked`                                                                            |
| `unwritable`          | The state is `unwritable`                                                                         |
| `uploads-waiting`     | A run in flight is [waiting to store its tree](/components/driver/overview/#waiting-on-the-store) |
| `write-check-pending` | An upload failed while the store read as faulty, and no passing reading has arrived since         |
| `proving-store`       | An upload failed while the store read as healthy, and no tree has landed since                    |

While runs are on hold,
[`POST /jobs/next`](/components/dispatcher/overview/#backend-enforced-admission-rules)
claims nothing and every waiting run reads `pending`. The runs stay in the queue
and are dispatched in their original order once the hold lifts. The publish
queue is claimed as usual, since a publish reads a tree that is already stored.
`proving-store` is the one reason that still hands out a run, and it hands out
one at a time. [Evidence from uploads](#evidence-from-uploads) describes it.

The hold lifts by itself once every condition is green. The backend counts the
waiting runs from its own job table, as the jobs in the `storing` state, at
every poll, every claim and every driver report. A run stops counting when its
job leaves that state: its upload lands, its driver gives up, an operator
cancels it, or the dispatcher reports its driver
[lost](/components/dispatcher/overview/#lost-drivers).

### Evidence from uploads

A failed upload is evidence about the store that the write check may not have.
The check writes a small tree, and an upload can fail for a reason it does not
exercise: the artifact service cannot reach the backend to verify the job token,
or a fault that only a large write meets. So the backend remembers that an
upload failed for a reason that was the store's, and the queue reopens on
evidence that the fault is gone, never on the last waiting run leaving.

The backend learns of a failed upload from a driver's `storing` report, and from
a report that says the tree was not stored and names the store as the cause
(`storeFault`). Those reports count whatever state the job is in, so the upload
of a canceled run and of a run the dispatcher had already reported lost count as
well. What the backend then waits for depends on what the store read as when the
latest failure arrived:

- The store read as faulty: it was unreadable, short of space or failing its
  write check. The check has seen the fault, so a passing reading with no run
  waiting is evidence of the repair, and the queue reopens on it. Until then the
  reason is `write-check-pending`.
- The store read as healthy. The check cannot see this fault, so a passing
  reading proves nothing. Once no run is waiting the reason is `proving-store`:
  the backend hands out a run only while no run is in flight, so one run at a
  time proves the store. The first tree that lands, from any run, reopens the
  queue. A run whose upload fails goes back to waiting, and holds the queue as
  `uploads-waiting`.

A tree that lands always ends both: a report with `artifactsStored: true` is the
store taking a whole upload.

This memory is the backend process's own. When the backend starts, it reads the
most recently finished run's recorded
[artifact presence](#artifact-presence). If that run's tree was not stored, the
backend starts in `proving-store`, so a restart during a store fault does not
reopen the whole queue. That recorded presence does not say why the tree was
not stored, so a backend can start in `proving-store` after a tree the store
refused as the run's own fault. The first run to store its tree ends it. A run
the backend finds already `storing` when no failure is on record, which is
what a backend that restarted during a wait finds, is recorded as a failed
upload too.

A driver also reports `storing` when its first attempt has run for a minute
without an answer. A tree that is only slow to upload therefore holds the queue
until it lands, which is seconds later for a healthy store.

### An unreadable store

A read that fails pauses the claim at once: `POST /jobs/next` answers `204` and
leaves the queue as it is, so no run is dispatched into a store the backend
cannot see. The claim is paused while the latest poll failed or the latest
reading is older than two poll intervals. The pause changes neither the reported
state nor any run's display state, so one missed poll leaves the console as it
was.

Once the latest reading is older than three poll intervals the state is
`unavailable` and runs are on hold, with every waiting run reading `pending`.
The backend holds no reading when it starts, so it starts `unavailable`, and the
first reading that arrives decides the state at once.

The backend polls every `TCAB_ARTIFACT_CAPACITY_POLL_SECONDS`. It takes its
first reading before it serves a claim and gives it five seconds. A service that
answers in that time decides the first claim.

### Recovery

`unavailable` and `unwritable` are entered on the first reading that calls for
them and left only after three consecutive passing readings, about thirty
seconds at the default poll interval. One good answer from a store that is
failing intermittently therefore does not reopen the queue, and the dispatcher
cannot fill its lane in the gap before the next failed poll. A failed poll or a
failed write check during the recovery starts the count again. While the count
runs the state, the reason and the reported error stay as they were.

The three readings apply only to a state the backend has announced. A single
missed poll that only [paused the claim](#an-unreadable-store) ends with the
next reading, and so does the `unavailable` state the backend starts in.

### Thresholds

The byte states move with hysteresis. `low` returns to `ok`, and `blocked`
returns to `low` or `ok`, only once free space is `TCAB_ARTIFACT_FREE_RECOVER_MB`
above the threshold that was crossed, so a reading that hovers at a threshold
holds one state. The level survives an outage of the service, so a store that
was `blocked` before one is judged from `blocked` after it.

A run takes minutes between its claim and its upload, so a ten-second-old
reading decides a claim as well as a fresh one, and the reserve covers the runs
claimed before the state changed. A claim decided on a reading taken just above
the stop threshold can still admit a run the reserve has to absorb.

### Reporting

Each change of the state, the hold, its reason, the number of waiting runs or
the reported error logs one line. Entering a hold logs at `error` for `blocked`,
`unwritable` and `unavailable`, and at `warn` for the three reasons that come
from uploads. Entering `low` logs at `warn`, and a change that leaves the queue
open at `ok` logs at `info`. Every line carries the hold's reason, the number of
runs waiting to store, and the error text of the condition: the failed poll's
error, the write check's error, or the latest reason a driver reported. The
first reading the backend takes when it starts is logged the same way, so a
backend that starts beside a store it cannot read says so.

The free space of each reading is the `tcab.artifacts.free_bytes` gauge, beside
`tcab.artifacts.total_bytes`.
[`GET /artifacts/capacity`](/components/backend/api/#get-artifactscapacity)
reports the state, and the [console stream](/components/backend/api/#the-console-stream)
carries each change. Nothing is deleted to make room: space returns as runs are
deleted and the [reclamation sweep](#artifact-reclamation) runs.

### A driver lost while it waits

A waiting driver holds the run's record as well as its tree, since the record
travels on the terminal report. So the first `storing` report carries the
record, with the failure reason when the run failed, and the backend keeps it
on the job. If the dispatcher then reports that driver dead or
[lost](/components/dispatcher/overview/#lost-drivers), the backend finishes the
run from the kept record exactly as the driver's own report would have, with
its artifacts recorded as not stored. The run keeps its outcome, and it is
retried only if that outcome is one that retries. The tree, the playable-build
link and the media a driver
[mirrors into the backend store](/components/driver/overview/#waiting-on-the-store)
after its upload went with the pod. A driver lost after its wait ended with the
tree stored is finished the same way, with its artifacts recorded as stored.
Without the kept record a lost driver is an infrastructure failure with no
record, which re-runs a session that had already finished.

## Review scheduling

The backend holds each account's reviewer scheduling state: what runs that
account wants to exist, and how many of them it keeps in flight at once. The data
is private to the account, stays inside the backend and the web console, and
stays out of the public snapshot.

- A [coverage plan](/components/backend/coverage/) declares cases pinned to a
  version, variant and engine, crossed with combinations and a target run count
  per cell. The backend expands the declaration into a matrix, counts what
  exists against it, and fills what is missing when asked.
- A [ladder](/components/backend/ladders/) is a configuration of an ordered
  series of cases. Each Run dispatches it, and each combination climbs
  automatically until a gate over its runs' validator ratings stops it.

The validation scripts are assumed correct, so reviews never gate, meter, or
trigger the launching of runs. A plan and a ladder dispatch both count runs
globally, so a run someone else produced satisfies a cell's or a rung's target
and is never launched again.

Launching is limited and serialized. A plan or a ladder keeps at most its
runs-in-flight limit of its own jobs in flight, so it shares the global queue
fairly. Each run it launches gets the plan's or the ladder's `retryCount` of
automatic retries, and a launch that uses them up without a counted run blocks
its cell or climber until the owner retries it. A filling plan or a running
dispatch left with only blocked cells or climbers to wait for reports that it
needs attention. There is no background daemon: the backend runs a launch pass of a
filling plan or a running dispatch whenever a run of one of its cells finishes. Each pass
claims its row first, so two concurrent passes cannot both enqueue for one
shortfall.

## Restarts

The backend never fails in-flight jobs when it starts. Every driver runs as its
own Kubernetes `Job`, separate from the backend's lifecycle, so a run that was
executing when the backend restarted is still executing and reports its terminal
status itself once the backend is back.

A driver that dies without reporting is found by the dispatcher, not by the
backend's start. A driver `Job` that fails while the dispatcher holds its token is
reported by [death detection](/components/dispatcher/overview/#death-detection).
Every other lost driver, including every driver of a machine that restarted as a
whole, is reported by [lost-driver
detection](/components/dispatcher/overview/#lost-drivers). The dispatcher compares
the jobs the backend believes are executing with the driver `Job`s the cluster
runs, so it fails only jobs whose driver is actually gone.

Once the definition store is servable after a start, the backend releases every
launch-pass claim the previous process held and runs one launch pass for every
filling plan and every running ladder dispatch, restoring the launch moments the
restart lost.

## Public snapshot

The public site shows published runs to anonymous visitors without reaching the
private backend. The backend exports a snapshot of its published dataset to a
[Cloudflare R2](https://developers.cloudflare.com/r2/) bucket, and the site
build fetches that export.

- Only published runs are exported, apart from the redacted [gg document
  corpus](/components/backend/snapshot/#gg-runsjson--the-gg-document-corpus),
  which is not gated on publication.
- Writing the bucket takes the `TCAB_R2_*` credentials, which the backend holds
  and `tcab publish-reference` is given to upload a case's reference frames. The
  bucket is read-only to everyone else.
- The upload is atomic: a new generation is written first and a small pointer
  object is swapped in last, so a site build never reads a half-written dataset.
- After uploading, the backend fires the site's deploy hook. The site build
  fetches the snapshot and produces static output without connecting to the
  backend.

Every connection flows outward from the backend, and what crosses into public
reach is a read-only export of already-published runs. The snapshot's file
layout is specified in [Public Snapshot](/components/backend/snapshot/).

## Configuration

The backend is configured entirely through environment variables.
`TCAB_BACKEND_CHECKOUT` is the only required one. With the R2 and deploy-hook
variables omitted the backend still ingests, records reviews and publishes, and
regenerates the snapshot, skipping the upload and the rebuild.

| Variable                              | Purpose                                                                                                                                                                                                                                                                                                        | Default                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `TCAB_BACKEND_CHECKOUT`               | The repository checkout ingest scans. Required.                                                                                                                                                                                                                                                                | —                                         |
| `TCAB_BACKEND_BIND`                   | Bind address.                                                                                                                                                                                                                                                                                                  | `127.0.0.1:8787`                          |
| `TCAB_BACKEND_DATABASE_URL`           | System-of-record database; the scheme picks SQLite or PostgreSQL.                                                                                                                                                                                                                                              | `sqlite://./tcab-backend.sqlite?mode=rwc` |
| `TCAB_BACKEND_DB_AZURE_AD`            | Authenticate to PostgreSQL with a Microsoft Entra managed-identity token.                                                                                                                                                                                                                                      | `false`                                   |
| `TCAB_BACKEND_STORE`                  | The on-disk definition store.                                                                                                                                                                                                                                                                                  | `./tcab-store`                            |
| `TCAB_BACKEND_AUTH_URL`               | The auth service bearer tokens are verified against.                                                                                                                                                                                                                                                           | `http://127.0.0.1:8789`                   |
| `TCAB_BACKEND_SERVICE_TOKEN`          | Shared token the dispatcher claims jobs with. Unset disables the claim endpoints.                                                                                                                                                                                                                              | —                                         |
| `TCAB_BACKEND_ALLOW_EXPERIMENTAL`     | Offer experimental case versions to the UI.                                                                                                                                                                                                                                                                    | `false`                                   |
| `TCAB_ENV`                            | Deployment environment name, selecting this backend's entries in the reference-builds lockfile.                                                                                                                                                                                                                | `local`                                   |
| `TCAB_SNAPSHOT_COALESCE_MS`           | Quiet window: a pending [refresh batch](#refresh-batching) is released once no request has arrived for this long.                                                                                                                                                                                              | `120000`                                  |
| `TCAB_SNAPSHOT_BATCH_SIZE`            | Pending refresh requests that release a batch without waiting for the quiet window.                                                                                                                                                                                                                            | `20`                                      |
| `TCAB_SNAPSHOT_MIN_INTERVAL_MS`       | Minimum time between two batch releases; `0` removes the hold.                                                                                                                                                                                                                                                 | `600000`                                  |
| `TCAB_SNAPSHOT_REFRESH_TIMEOUT_MS`    | How long one refresh may run before it is abandoned as failed; `0` removes the bound.                                                                                                                                                                                                                          | `1800000`                                 |
| `TCAB_SNAPSHOT_RETENTION_HOURS`       | How long a superseded snapshot generation is kept before it is [pruned](/components/backend/snapshot/#pruning-superseded-generations).                                                                                                                                                                         | `24`                                      |
| `TCAB_R2_*`                           | Credentials and bucket the snapshot is uploaded to.                                                                                                                                                                                                                                                            | —                                         |
| `TCAB_SITE_DEPLOY_HOOK_URL`           | The site deploy hook fired after each upload.                                                                                                                                                                                                                                                                  | —                                         |
| `TCAB_OPENROUTER_API_KEY`             | OpenRouter key the backend's own [model probes](/components/backend/api/#model-probes) are billed to. Distinct from the runners' `OPENROUTER_API_KEY`. Unset, a probe trigger fails with `openrouter_key_missing`.                                                                                             | —                                         |
| `TCAB_REFERENCE_BROWSER`              | Headless browser used to render references at ingest.                                                                                                                                                                                                                                                          | image Chromium                            |
| `TCAB_GG_REFERENCE`                   | Directory holding gg's projected reference documents. The deployed image bakes them at `/opt/gg-reference`, projected by the same gg build the driver ships.                                                                                                                                                   | `<checkout>/target/gg-reference`          |
| `TCAB_ARTIFACTS_PUBLIC_URL`           | Artifact service base URL, advertised to the web console.                                                                                                                                                                                                                                                      | —                                         |
| `TCAB_ARTIFACTS_URL`                  | Artifact service base URL the backend itself calls to prune and sweep run trees, to check a run's tree before a publish and to read the store's free space and write check. Unset disables the prune, the sweep, the publish gate's tree check, the capacity hold, and the snapshot's artifact media fallback. | —                                         |
| `TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS`  | Interval between reclamation sweeps; `0` disables the sweep.                                                                                                                                                                                                                                                   | `6`                                       |
| `TCAB_ARTIFACT_SWEEP_GRACE_HOURS`     | How old a run-less tree must be before a sweep deletes it.                                                                                                                                                                                                                                                     | `24`                                      |
| `TCAB_ARTIFACT_FREE_WARN_MB`          | Free space on the artifact store, in MiB, under which [artifact capacity](#artifact-capacity) is `low`. At least the stop threshold.                                                                                                                                                                           | `3072`                                    |
| `TCAB_ARTIFACT_FREE_STOP_MB`          | Free space, in MiB, under which new runs are put on hold.                                                                                                                                                                                                                                                      | `2048`                                    |
| `TCAB_ARTIFACT_FREE_RECOVER_MB`       | Free space, in MiB, a reading must exceed a crossed threshold by before the state recovers.                                                                                                                                                                                                                    | `256`                                     |
| `TCAB_ARTIFACT_CAPACITY_POLL_SECONDS` | Interval between capacity readings. At least `1`.                                                                                                                                                                                                                                                              | `10`                                      |
| `TCAB_ARENA_PUBLIC_URL`               | Arena service base URL, advertised to the web console.                                                                                                                                                                                                                                                         | —                                         |
| `TCAB_GRAFANA_PUBLIC_URL`             | Grafana base URL, advertised to the web console.                                                                                                                                                                                                                                                               | —                                         |
| `TCAB_SNAPSHOT_PUBLIC_URL`            | Public read base URL of the snapshot bucket, advertised to the web console.                                                                                                                                                                                                                                    | —                                         |

The backend binds `8787`, the [auth service](/components/auth/overview/) `8789`,
the [artifact service](/components/artifacts/overview/) `8790`, and the
[arena](/components/arena/overview/) `8791`, so all four coexist on one host.
