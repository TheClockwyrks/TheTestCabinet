---
title: Overview
---

The backend is a Rust server that holds The Test Cabinet's definitions and
results. It distributes the test case definitions a runner needs to execute a
run, and it stores the run records those runs produce, so every run and every
published result is coordinated through one service.

Two interfaces are the backend's cross-component contracts: its [HTTP
API](/components/backend/api/) and the [public
snapshot](/components/backend/snapshot/) it exports. Everything else, including
how it stores what it serves, is internal.

## Responsibilities

The backend serves two kinds of client, described in [Runners and
Reporters](/components/architecture/#runners-and-reporters):

- Runners (the [CLI](/components/cli/overview/),
  [driver](/components/driver/overview/) and [Tauri
  app](/components/tauri/overview/)) resolve test case definitions from the
  backend. The driver reports each [run record](/components/core/run-records/)
  back to it when the run finishes.
- Reporters (the consoles, and the [public site](/components/site/overview/)
  through the snapshot) read definitions and published results to display them.

Each runner resolves its run-container image from its own registry
configuration. The backend neither stores nor serves image references.

The backend holds two bodies of data.

### Test case definitions

Cases are authored in the repository's `test-cases/` and `game-jams/` folders,
in the formats the [testing](/testing/overview/) pages specify. An ingest scan
copies each new or changed version out of the repository checkout into the
backend's on-disk definition store, rendering the version's reference mockups to
screenshots as it goes. The repository is the editing source; the store is the
distribution source a runner resolves at run time. Ingest caches a version
rather than transforming it.

Ingest writes each version as a resolved record whose shape the backend build
defines, so the store is only readable by a build that agrees on that shape. The
store therefore records a record-format version, stamped by the ingest that
wrote it, and the backend compares it against the format the running build
reads. A store stamped with any other format holds records this build cannot
read: the backend reports it unready, and the next ingest scan re-ingests the
whole catalog so the store returns to a format it can serve. This is what keeps
a shape change from silently reducing the served catalog to the handful of
versions that happen to have been re-ingested since.

### Run results

The stored [run records](/components/core/run-records/) with their reviews and
links, persisted through SeaORM in a relational database (embedded SQLite by
default, or PostgreSQL). A run's proof, asset and validation media is written
beside the definitions in the on-disk store rather than into that database. This
is the system of record for every run, published or not.

A stored record can predate a change to the run record contract, leaving it
unreadable by the running build. The backend therefore records, per run, whether
the build can read that run's record and the record-format generation the
decision was made under. Every run listing counts and serves exactly the readable
runs, so a listing's reported total equals the number of rows it can return and a
numbered pager offers only pages that hold rows. A build whose record format
differs from the stamp on a row re-decides that row's readability once at
startup, before it serves.

The generation is pinned to the shape of the run record contract. The build
records the contract shape each generation was decided against, and a change to
that shape fails the build's tests until it is either recorded under the current
generation, which asserts that stored records survive it, or given a new
generation. The generation is therefore a fact about the contract rather than a
constant somebody remembers to raise.

A run the build cannot read is still reachable on its own terms. `GET
/runs/unreadable` lists each such run's lifted identity together with the error
its stored record now produces, paged like every other listing, and `DELETE
/runs/{id}` deletes it, because both act on the stored row rather than on the
record. A published run is deletable here: it is already absent from the snapshot
and the gallery, which is what the publication guard exists to protect. The
consoles surface this as the runs section's Unreadable tab.

## Authentication

The backend stays on a private network. In a [cluster
deployment](/deployment/kubernetes/overview/) it is a `ClusterIP` service with
no public `Ingress`, so reachability is the first line of access control.

On top of that boundary, bearer tokens identify who is acting:

- Reads are open. Resolving definitions and reading runs require only that the
  caller can reach the backend.
- Mutations require a token. The mutating run endpoints answer `401` without an
  `Authorization: Bearer <token>` header. The backend stores no credentials of
  its own; it resolves each token to an account by calling the standalone [auth
  service](/components/auth/overview/), and attributes the resulting
  [review](/components/core/results/#reviews) to that account.

The dispatcher authenticates with a shared service token
(`TCAB_BACKEND_SERVICE_TOKEN`) to claim queued jobs, and each driver
authenticates with the per-job token minted when its job was enqueued.

## Review and publish

A produced run reaches the gallery through two steps the backend mediates. The
[lifecycle](/components/core/results/#lifecycle) is the conceptual account of
them; this is the backend's part.

A run's record is stored privately the moment the run finishes: the driver
reports it when it posts the job's terminal status, and the produced build and
media land on the [artifact service](/components/artifacts/overview/). The build
is playable, so the run can be reviewed. Review attaches one review per account
to the run.

Publish releases the run: its generated source to its own public repository and
its build to Cloudflare Pages. The endpoint gates the run, refusing a legacy
run with no review, and enqueues a per-publish `tcab-publisher` Job that the
[dispatcher](/components/dispatcher/overview/) claims. When that Job reports a
terminal success the backend marks the run published, uploads the run's
documents and media to the public bucket, and writes its row to the public
projection.

The backend serializes publishes so two operators cannot race on shared state.

## Artifact reclamation

The backend owns the lifetime of a run's tree on the
[artifact service](/components/artifacts/overview/). It reaches the service over
`TCAB_ARTIFACTS_URL`, the in-cluster address, presenting the shared service
token.

Deleting a run prunes its tree. The prune is best-effort, because the run row is
already gone and the delete must succeed regardless of the data plane's health.

A periodic sweep reclaims what a failed prune left, and anything else the volume
holds with no run behind it. Each pass lists the service's stored trees, keeps
every tree whose id still has a run row, and deletes the rest once they are
older than a grace window. The grace window exists because a driver uploads a
run's tree before it reports the run terminal, so a freshly uploaded tree
legitimately has no row yet.

`TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS` sets the pass interval and `0` disables the
sweep; `TCAB_ARTIFACT_SWEEP_GRACE_HOURS` sets the grace window.

A pass acts only on a run-id set the backend read and found at least one run in.
A query that fails and one that comes back empty both abandon the pass, which is
retried at the next interval: an empty set makes every stored tree an orphan, so
a database fault, or a backend brought up against a fresh database beside a
populated volume, leaves the volume intact. A failing tree listing abandons the
pass the same way.

## Review scheduling

The backend also holds each account's reviewer scheduling state: what runs that
account wants to exist, and how fast it wants them arriving. The data is
private, per-account and console-only — no runner consults it and none of it
reaches the public snapshot or the projection.

- A [coverage plan](/components/backend/coverage/) declares cases pinned to a
  version, variant and engine, crossed with combinations and a target run count
  per cell. The backend expands the declaration into a matrix, counts what
  exists against it, and enqueues what is missing.
- A [ladder](/components/backend/ladders/) applies the same machinery to an
  ordered series of cases, which each combination climbs until a gate stops it.

Two properties of that design follow from the backend being the single central
entity, and are its to enforce. Run counts stay global while judgement stays
per-account: a run someone else produced satisfies a plan's target and is never
re-requested, but "unreviewed" means unreviewed by the requesting account, and a
ladder's gate reads only that account's own review, so two reviewers share the
cabinet's runs without sharing each other's worklists. And enqueueing is bounded
and serialized: a plan holds a bounded review buffer rather than firing its
whole matrix, refilling it is an endpoint the console calls rather than a
background daemon, and each plan's or ladder's top-up claims its row first, so
two console tabs cannot both observe the same shortfall and both enqueue for it.

## Public snapshot

The [gallery](/components/site/serving/) shows published runs to anonymous
visitors while the backend stays private. The backend publishes to two public
stores that the gallery reads.

- Documents and media go to a [Cloudflare R2](https://developers.cloudflare.com/r2/)
  bucket, whose layout is specified in [Public Snapshot](/components/backend/snapshot/).
- Index rows go to the [public projection](/components/backend/projection/),
  which the gallery queries for listings, search, leaderboards, and short codes.

Only published runs are exported, apart from the redacted [gg document
corpus](/components/backend/snapshot/#the-gg-document-corpus), which is not
gated on publication. Writing the bucket takes the `TCAB_R2_*` credentials,
which the backend holds and `tcab publish-reference` is given to upload a case's
reference frames. Both stores are read-only to everyone else.

Every connection flows outward from the backend, and what crosses into public
reach is a read-only copy of already-published runs.

## Configuration

The backend is configured entirely through environment variables.
`TCAB_BACKEND_CHECKOUT` is the only required one. With the R2 and projection
variables omitted the backend still ingests, records reviews and publishes,
skipping the public write.

| Variable | Purpose | Default |
| --- | --- | --- |
| `TCAB_BACKEND_CHECKOUT` | The repository checkout ingest scans. Required. | — |
| `TCAB_BACKEND_BIND` | Bind address. | `127.0.0.1:8787` |
| `TCAB_BACKEND_DATABASE_URL` | System-of-record database; the scheme picks SQLite or PostgreSQL. | `sqlite://./tcab-backend.sqlite?mode=rwc` |
| `TCAB_BACKEND_DB_AZURE_AD` | Authenticate to PostgreSQL with a Microsoft Entra managed-identity token. | `false` |
| `TCAB_BACKEND_STORE` | The on-disk definition store. | `./tcab-store` |
| `TCAB_BACKEND_AUTH_URL` | The auth service bearer tokens are verified against. | `http://127.0.0.1:8789` |
| `TCAB_BACKEND_SERVICE_TOKEN` | Shared token the dispatcher claims jobs with. Unset disables the claim endpoints. | — |
| `TCAB_BACKEND_ALLOW_EXPERIMENTAL` | Offer experimental case versions to the UI. | `false` |
| `TCAB_ENV` | Deployment environment name, selecting this backend's entries in the reference-builds lockfile. | `local` |
| `TCAB_R2_*` | Credentials and bucket the public documents and media are uploaded to. | — |
| `TCAB_PROJECTION_DATABASE_URL` | Connection string of the [public projection](/components/backend/projection/) the backend writes on publish. | — |
| `TCAB_OPENROUTER_API_KEY` | OpenRouter key the backend's own completion calls are billed to, today only [model probes](/components/backend/api/#model-probes). Distinct from the runners' `OPENROUTER_API_KEY`. Unset, a probe trigger fails with `openrouter_key_missing`. | — |
| `TCAB_REFERENCE_BROWSER` | Headless browser used to render references at ingest. | image Chromium |
| `TCAB_GG_REFERENCE` | Directory holding gg's projected reference documents. | `<checkout>/target/gg-reference` |
| `TCAB_ARTIFACTS_PUBLIC_URL` | Artifact service base URL, advertised to consoles. | — |
| `TCAB_ARTIFACTS_URL` | Artifact service base URL the backend itself calls to prune and sweep run trees. Unset disables the prune, the sweep, and the snapshot's artifact media fallback. | — |
| `TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS` | Interval between reclamation sweeps; `0` disables the sweep. | `6` |
| `TCAB_ARTIFACT_SWEEP_GRACE_HOURS` | How old a run-less tree must be before a sweep deletes it. | `24` |
| `TCAB_ARENA_PUBLIC_URL` | Arena service base URL, advertised to consoles. | — |
| `TCAB_GRAFANA_PUBLIC_URL` | Grafana base URL, advertised to consoles. | — |
| `TCAB_SNAPSHOT_PUBLIC_URL` | Public read base URL of the document bucket, advertised to consoles. | — |

The backend binds `8787`, the [auth service](/components/auth/overview/) `8789`,
the [artifact service](/components/artifacts/overview/) `8790`, and the
[arena](/components/arena/overview/) `8791`, so all four coexist on one host.
