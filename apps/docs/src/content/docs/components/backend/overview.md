---
title: Overview
---

The backend is a Rust server that holds The Test Cabinet's definitions and
results. It distributes the test case definitions a runner needs to execute a
run and stores the run records those runs produce, so every run and every
published result is coordinated through one service.

Two interfaces are the backend's cross-component contracts: its [HTTP
API](/components/backend/api/) and the [public
dataset](/components/backend/snapshot/) it writes. Everything else, including
how it stores what it serves, is internal.

## Responsibilities

The backend serves two kinds of client, described in
[Architecture](/components/architecture/#the-services):

- Runners (the driver, and the CLI for the commands that resolve a definition)
  resolve test case definitions from the backend. The driver reports each [run
  record](/components/contracts/run-records/) back to it when the run finishes.
- Reporters (the console, and the public site through the public dataset) read
  definitions and published results to display them.

Each runner resolves its run-container image from its own registry
configuration.

The backend holds two bodies of data.

### Test case definitions

Cases are authored in the `test-suites` repository's `test-cases/` and
`game-jams/` folders, in the formats the [testing](/testing/overview/) pages
specify. An ingest scan copies each new or changed version out of the
repository checkout into the backend's on-disk definition store, rendering the
version's reference mockups to screenshots as it goes. The repository is the
editing source and the store is the distribution source a runner resolves at
run time. Ingest caches a version rather than transforming it.

Ingest builds each version in a staging area inside the store and swaps the
finished version into place, so a reader sees a version whole or not at all. A
pass that stops part way leaves its staging behind, and the backend empties the
staging area when it starts, before it serves or ingests anything.

The scan also reads the [test suites](/test-suites/overview/) tree. Every
definition a suite version offers is lowered into the same store as an ordinary
test case version, recording the suite coordinate it came from, so a runner
resolves a suite-defined case through the routes it resolves an authored one
through. The suite's own entities are stored beside them and served by the suite
read endpoints, which is what lets a console present a suite and the cases it
defines.

The scan reads each suite's exported versions and skips its drafts. A backend
with `TCAB_BACKEND_INGEST_PREVIEWS` set also reads the
[previews](/test-suites/overview/#previews) The Spec Cabinet writes to
the suites tree's `.previews/` folder. Previews are experimental and exist only
in the checkout they were written to, so the setting is enabled for the local
development stack alone.

A version's baseline validation media lives in the `cold-storage` repository
rather than in the version's folder, at the version's own path. Ingest copies it
into the stored version's `validation-baseline/`, where the API serves it and
the snapshot publishes it (see [where baselines
live](/components/driver/validation/#where-baselines-live)). The deployed
ingest sidecar clones `cold-storage` shallowly beside its `test-suites`
checkout and refreshes both together.

Ingest reads three trees, each from its own root. The definitions root holds
`test-cases/`, `game-jams/`, `test-case-groups/` and
`test-cases/reference-builds.lock.json`. The suites root is the test suites tree
itself, and the cold-storage root holds the baseline media, laid out like the
definitions root it mirrors. The definitions root and the suites root default
to their place in the repository checkout, and the cold-storage root to the
`cold-storage` directory beside it, which is the superrepo's layout, so a
backend given only `TCAB_BACKEND_CHECKOUT` reads the checkout's own trees and
the clone beside it. Each can be pointed at a separate checkout (see
[Configuration](#configuration)).

A whole-catalog scan prunes what its trees no longer declare, and it refuses a
prune that an empty tree would cause. When the scan finds no version under
`test-cases/`, it keeps every stored authored test-case version, and when it
finds none under `game-jams/`, every stored game jam. Each tree answers for its
own kind, although one catalog reads both, so a jam that came through does not
vouch for an emptied case tree. When it finds no suite version while the store
holds suites, it keeps every stored suite version and the case versions they
defined. When it accepts no test-case group while the store holds groups, it
keeps the stored set. The scan still ingests everything it did find, logs each
refusal, and reports it to the caller (see
[`POST /ingest`](/components/backend/api/#post-ingest)). It does not record its
catalog token, so the next scan carrying the same token rewrites every version
rather than skipping the ones the store kept. An empty suites tree on a store
that holds no suites is an ordinary state, since a checkout may leave the test
suites tree uninitialized.

The guard is the reason ingest never applies a catalog that retires every
version of a kind, or every group: no request lifts it, `force` included. Such
a retirement is applied to the definition store by hand, by removing the
retired `test-cases/<slug>/` directories under `TCAB_BACKEND_STORE`, or its
`test-case-groups/test-case-groups.json` for the groups. A scan against a store
written in another record format is exempt, since this build can read nothing
it would keep.

Ingest writes each version as a resolved record whose shape the backend build
defines, so a store is readable only by a build that agrees on that shape. The
store records a record-format version stamped by the ingest that wrote it, and
the backend compares it against the format the running build reads. A store
stamped with any other format holds records the running build cannot read. The
backend reports it unready, and the next ingest scan re-ingests the whole
catalog so the store returns to a format it can serve.

### Run results

The stored [run records](/components/contracts/run-records/) with their reviews
and links, persisted in a relational database (embedded SQLite by default, or
PostgreSQL). A run's bytes, its build, media, logs and bundle, live on the
[artifacts](/components/artifacts/overview/) and
[repos](/components/repos/overview/) services rather than in that database or
beside the definitions. This is the system of record for every run, published or
not.

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
a published run is deletable here, being already absent from the public dataset
and the gallery.

## Identity

Nothing in a cluster is reachable from outside it except through the
[edge](/deployment/kubernetes/edge/): a Cloudflare Tunnel that routes the
environment's one hostname to the in-cluster services by path, with a
Cloudflare Access application in front of it. The backend answers under
`/api/`. Who is acting is decided by one of two credentials on every request,
and a request carrying neither is a `401`.

- An Access assertion. Every request through the edge carries
  `Cf-Access-Jwt-Assertion`, which the backend verifies against the Access
  application's certificates and audience tag, refusing a request without a
  valid one. A person's assertion carries their Entra ID `email`, which is the
  reviewer identity a [review](/components/backend/results/#reviews), a
  [coverage plan](/components/backend/coverage/) and a launch are recorded
  under. An Access service token's assertion carries a `common_name` instead,
  which is how automation acts: the CLI's ingest and reference publishing, and
  CI.
- A backend-minted token. The dispatcher claims queued jobs with the shared
  service token (`TCAB_BACKEND_SERVICE_TOKEN`), each driver and publisher Job
  presents the per-job token minted when its job was enqueued, and the ingest
  sidecar presents the service token. These callers reach the backend over its
  in-cluster `Service` and never cross the edge.

Identity is held entirely by Access: the backend stores no credential and keeps
no session. The mutating routes that automation drives, ingest, the public
dataset's refresh, tournaments and reference-build writes, take the service
token or a service token's assertion.
See [Identity](/components/auth/overview/) for the Access design and
[the API's conventions](/components/backend/api/#conventions) for how each
route is gated.

## Review and publish

A produced run reaches the gallery through steps the backend mediates.

A run's record is stored privately the moment the run finishes: the driver
reports it when it posts the job's terminal status, and the produced build and
media are already on the artifacts service, its bundle on the repos service. The
build is playable, so the run can be reviewed. Review attaches one review per
reviewer identity to the run.

Publish releases the run: its implementation to its own public repository and
its build to Cloudflare Pages. A completed validator-rated run is published by
the backend itself, with no operator action, as described under [automatic
publishing](/components/backend/results/#automatic-publishing); every other
publishable run is published through the endpoint, which gates it, refusing a
legacy run with no review. Either way the backend enqueues a per-publish
`tcab-publisher` Job that the [dispatcher](/components/dispatcher/overview/)
claims in its publish lane. A run with a publish already under way is attached
to that job, so a run never has two releases in flight.

The publisher fetches the build output from artifacts, deploys it to the per-run
Pages project, asks the repos service to publish the run's repository, and
reports both links. When the Job reports a terminal success the backend:

1. marks the run published and records the links;
2. mints the run's [short code](#short-codes) and writes `codes/<code>`;
3. has artifacts copy the run's publishable media to the public bucket;
4. writes the run's document and the updated index objects, which carry the
   code, through artifacts, swapping the `index.json` pointer last.

A publish is an upload. No site rebuild and no deploy hook follow it; the
gallery reads the index objects at runtime. The backend serializes publishes so
two cannot race on the index objects, and a burst of publishes is coalesced into
one rewrite of them.

### Short codes

A run gets a code the first time it publishes: the shortest prefix of the run
id, at least eight characters, that no published run already holds. The code is
stored on the run record and as the public object `codes/<code>`, naming the run
id, and is never reassigned. The `tcab.ai` share links resolve it; see [the
public gallery](/components/site/serving/).

## Artifact reclamation

The backend owns the lifetime of a run's tree on the artifacts service and its
bundle on the repos service, reaching both over `TCAB_ARTIFACTS_URL` and
`TCAB_REPOS_URL` with the shared service token. The repos service sits behind
no edge path, so the backend also serves a run's bundle to the console, as
`GET /runs/{id}/bundle`.

Deleting a run removes its row and then prunes its tree and its bundle. Each
prune is best-effort, so the delete succeeds regardless of the data plane's
health.

A periodic sweep reclaims what a failed prune left, and anything else the
private container holds with no run behind it. Each pass lists the artifacts
service's stored trees, keeps every tree whose id still has a run row, and
deletes the rest once they are older than a grace window. The grace window
covers the interval between a driver uploading a run's tree and reporting the
run terminal.

`TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS` sets the pass interval and `0` disables the
sweep. `TCAB_ARTIFACT_SWEEP_GRACE_HOURS` sets the grace window.

A pass acts only on a run-id set the backend read and found at least one run in.
A query that fails and one that comes back empty both abandon the pass, which is
retried at the next interval, so a database fault or a backend brought up
against a fresh database beside a populated container leaves the container
intact. A failing tree listing abandons the pass the same way.

## Review scheduling

The backend holds each reviewer's scheduling state: what runs that reviewer
wants to exist, and how many of them it keeps in flight at once. The data is
private to the reviewer, stays inside the backend and the console, and stays
out of the public dataset.

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
needs attention. There is no background daemon: the backend runs a launch pass
of a filling plan or a running dispatch whenever a run of one of its cells
finishes. Each pass claims its row first, so two concurrent passes cannot both
enqueue for one shortfall.

## Durable state

Everything the backend must keep lives in its database or on the
[artifacts service](/components/artifacts/overview/). A pod's local disk holds
only the definition store and the ingest checkout, which are caches ingest
fills from the repositories. A pod that starts with an empty store is held
unready until ingest fills it.

| State                                                        | Where it lives                                            |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Run records, reviews, links, jobs, plans, ladders and probes | The database                                              |
| A job's relayed event stream                                 | The database, one row per event keyed by job and sequence |
| A job's held record and claim lease                          | The database, on the job's row                            |
| An adversarial run's pushed `controller.wasm`                | The database, beside the run's row                        |
| A tournament, its standings and its match summaries          | The database                                              |
| A tournament match's replay                                  | The artifacts service's private container                 |
| A run's media, gg session record and code-analysis document  | The run's tree on the artifacts service                   |

The driver's upload of the run tree is what stores a run's media, its
`replay.json.gz` and its `code-analysis.json.gz`, and the artifacts service
serves them (see [Routes](/components/artifacts/overview/#routes)), so the
backend keeps no copy. The backend writes each tournament match replay through
the artifacts service when the arena persists it, and reads it back from there
to serve `GET /tournaments/{id}/matches/{matchId}/replay.json`. The object route
it writes and reads through is listed with the artifacts service's
[routes](/components/artifacts/overview/#routes).

Each accepted batch of relayed events is written to the database before the
backend acknowledges it, as [delivery to the
backend](/components/driver/events/#delivery-to-the-backend) specifies. The
live relay fans a stored batch out to the job's subscribers, and a subscriber
who connects mid-run is replayed the stored events first.

### Replicas

On PostgreSQL the backend runs as more than one replica, each with its own
definition store and ingest sidecar. Work one replica does on behalf of all is
claimed through the database:

- a launch pass claims its plan's or ladder's row with a lease;
- a snapshot refresh and a publish's index rewrite hold a database lock;
- a model probe holds a lease on its row, renewed while it runs;
- a reclamation sweep pass holds a database lock.

Each stored event batch and each [console stream](/components/backend/api/#the-console-stream)
message is announced through PostgreSQL `LISTEN`/`NOTIFY`, so a subscriber
connected to any replica receives what every replica accepts. An embedded SQLite
database is single-writer, so a SQLite deployment runs one replica.

## Finishing a job

A driver hands its finished run to the backend before anything else that could
fail. Its first `storing` report carries the run record, which the backend
stores in Postgres on the job's row, so the result survives the driver from
then on. A job that the dispatcher later reports lost while it holds a record
is finished from that record, with the state the record carries, and is never
retried. A job reported lost with no record is failed as
[`infrastructure`](/components/contracts/run-records/#status) and retried.

Every report is idempotent by job. A repeated `storing` report replaces the
held record with the same record, and a repeated terminal report for a job
already in that terminal state is answered with success. A terminal report
that arrives after the job was reported lost supersedes the lost outcome, and
the backend withdraws the automatic retry the lost outcome enqueued, canceling
it when it was already claimed.

Each claim carries a two-minute lease stored on the job's row, which the
dispatcher renews for every driver it still sees. A `dispatched` job whose
lease lapsed returns to the queue at its original position with a fresh
per-job token and no attempt counted. A later-state job whose lease lapsed is
the dispatcher's to report lost. The routes are specified under [the held
record](/components/backend/api/#the-held-record) and [leases and lost
jobs](/components/backend/api/#leases-and-lost-jobs).

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
launch-pass claim whose lease has lapsed and runs one launch pass for every
filling plan and every running ladder dispatch, restoring the launch moments the
restart lost.

The rest of the work the backend owns survives a restart in the database:

- A snapshot refresh, whatever requests it, sets the snapshot state's `dirty`
  flag before it is queued. A backend that starts with the flag set runs the
  refresh, and the flag clears only when a refresh has written the dataset.
- A model probe left `running` loses its lease and is resumed, as [model
  probes](/components/backend/api/#model-probes) describes.
- A job's relayed events are already stored, so the recorded stream and the
  live replay are whole across the restart.
- The ingest staging area is emptied, and the next ingest pass completes the
  work the interrupted pass left.

## The public dataset

The public site shows published runs to anonymous visitors without reaching the
private backend. The backend composes the public dataset, the documents, media
keys and index objects of [Public Snapshot](/components/backend/snapshot/), and
writes every object through the artifacts service, the one writer of the public
bucket.

- Only published runs are written, apart from the redacted [gg document
  corpus](/components/backend/snapshot/#gg-runsjson--the-gg-document-corpus),
  which is not gated on publication.
- The backend holds no bucket credential. It writes with `PUT /public/{key}`
  and copies a run's media with `POST /runs/{id}/publish-media`, both on
  artifacts over its in-cluster URL with the service token.
- A write is atomic: the objects of a new generation are written first and the
  small `index.json` pointer is swapped last, so a reader never sees a
  half-written dataset.
- `POST /snapshot/refresh` rewrites the whole dataset from the full published
  set, which is how a change to the documents' shape, or a dataset damaged by
  hand, is repaired.

Every connection flows outward from the backend, and what reaches the public
bucket is a read-only export of already-published runs.

## Configuration

The backend is configured entirely through environment variables.
`TCAB_BACKEND_CHECKOUT` is the only required one: a checkout of the
`test-suites` repository, which holds `test-cases/`, `game-jams/` and
`test-case-groups/` at its root and the suites under `test-suites/`, with a
`cold-storage` checkout holding the baseline media beside it, where the three
roots below default. A relative root resolves against the working directory.
With the artifacts URL omitted the backend still ingests, records reviews and
marks runs published, skipping the dataset writes.

| Variable                             | Purpose                                                                                                                                                                                                                              | Default                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `TCAB_BACKEND_CHECKOUT`              | The `test-suites` checkout ingest scans. Required.                                                                                                                                                                                   | —                                         |
| `TCAB_DEFINITIONS_ROOT`              | The directory holding `test-cases/`, `game-jams/` and `test-case-groups/` that ingest scans.                                                                                                                                         | `<checkout>`                              |
| `TCAB_SUITES_ROOT`                   | The suites directory ingest scans.                                                                                                                                                                                                   | `<checkout>/test-suites`                  |
| `TCAB_COLD_STORAGE_ROOT`             | The cold-storage tree ingest reads baseline media from. `TCAB_COLD_STORAGE_DIR` is read when it is unset.                                                                                                                            | `<checkout>/../cold-storage`              |
| `TCAB_BACKEND_BIND`                  | Bind address.                                                                                                                                                                                                                        | `127.0.0.1:8787`                          |
| `TCAB_BACKEND_DATABASE_URL`          | System-of-record database; the scheme picks SQLite or PostgreSQL.                                                                                                                                                                    | `sqlite://./tcab-backend.sqlite?mode=rwc` |
| `TCAB_BACKEND_DB_AZURE_AD`           | Authenticate to PostgreSQL with a Microsoft Entra managed-identity token.                                                                                                                                                            | `false`                                   |
| `TCAB_BACKEND_STORE`                 | The definition store, a cache ingest fills.                                                                                                                                                                                          | `./tcab-store`                            |
| `TCAB_ACCESS_TEAM_DOMAIN`            | The Cloudflare Access team domain whose certificates assertions are verified against. Unset with the audience (the `local` overlay), no assertion is verified and the identity is `Cf-Access-Authenticated-User-Email` as presented. | —                                         |
| `TCAB_ACCESS_AUDIENCE`               | The Access application's audience tag an assertion must name.                                                                                                                                                                        | —                                         |
| `TCAB_BACKEND_SERVICE_TOKEN`         | Shared token the dispatcher claims jobs with and the in-cluster services present. Unset disables the claim endpoints.                                                                                                                | —                                         |
| `TCAB_BACKEND_ALLOW_EXPERIMENTAL`    | Offer experimental case versions to the UI.                                                                                                                                                                                          | `false`                                   |
| `TCAB_BACKEND_INGEST_PREVIEWS`       | Also ingest the test suite previews The Spec Cabinet writes. Enabled for the local development stack.                                                                                                                                | `false`                                   |
| `TCAB_BACKEND_INGEST_REFRESH_URL`    | The ingest sidecar's localhost endpoint that refreshes the checkout, which an ingest asking for `refresh` calls before the scan. Unset, `refresh` is ignored.                                                                        | —                                         |
| `TCAB_ENV`                           | Deployment environment name, selecting this backend's entries in the reference-builds lockfile.                                                                                                                                      | `local`                                   |
| `TCAB_SNAPSHOT_COALESCE_MS`          | Sliding debounce a burst of publishes is coalesced over.                                                                                                                                                                             | `60000`                                   |
| `TCAB_SNAPSHOT_RETENTION_HOURS`      | How long a superseded generation of the index objects is kept before it is [pruned](/components/backend/snapshot/#pruning-superseded-generations).                                                                                   | `24`                                      |
| `TCAB_OPENROUTER_API_KEY`            | OpenRouter key the backend's own [model probes](/components/backend/api/#model-probes) are billed to. Distinct from the runners' `OPENROUTER_API_KEY`. Unset, a probe trigger fails with `openrouter_key_missing`.                   | —                                         |
| `TCAB_REFERENCE_BROWSER`             | Headless browser used to render references at ingest.                                                                                                                                                                                | image Chromium                            |
| `TCAB_GG_REFERENCE`                  | Directory holding gg's projected reference documents. The deployed image bakes them at `/opt/gg-reference`, fetched for the gg release the driver pins.                                                                              | `<checkout>/target/gg-reference`          |
| `TCAB_ARTIFACTS_URL`                 | Artifacts service base URL the backend calls to prune and sweep run trees and to write the public dataset. Unset disables the prune, the sweep and the dataset writes.                                                               | —                                         |
| `TCAB_REPOS_URL`                     | Repos service base URL the backend calls to serve a bundle download and prune a deleted run's bundle. Unset disables both.                                                                                                           | —                                         |
| `TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS` | Interval between reclamation sweeps; `0` disables the sweep.                                                                                                                                                                         | `6`                                       |
| `TCAB_ARTIFACT_SWEEP_GRACE_HOURS`    | How old a run-less tree must be before a sweep deletes it.                                                                                                                                                                           | `24`                                      |

The backend binds `8787`, the [artifacts service](/components/artifacts/overview/)
`8790`, the [arena](/components/arena/overview/) `8791` and the
[repos service](/components/repos/overview/) `8792`, so all four coexist on one
host. The backend advertises no URL: the console reaches every service by path
under its own origin.

## Deployment

The backend is the `tcab-backend` binary of the `microservice-backend`
repository, which also holds its ingest sidecar, the `entities` SeaORM models,
the `migration` crate and `db-auth`. The repository owns review and comparison
scoring, aggregation and gating, pricing, TCQ (`gg_query`), model-id
canonicalization, the publish orchestration, the public dataset writer and the
Access assertion check. Its image bakes the headless browser references are
rendered with and the `gg-reference` documents of the gg release the driver
pins. See [Kubernetes: the control
plane](/deployment/kubernetes/control-plane/).
