---
title: Overview
---

The backend is a Rust server that acts as The Test Cabinet's centralized source
of truth. It distributes the definitions that [runners](/components/architecture/#runners-and-reporters)
need to execute a test case and stores the results they produce, so that runs and
published results are coordinated through one service rather than scattered across
repositories and machines.

It replaces The Test Cabinet's original "git-as-a-db" design, in which run
records were committed directly into the public site's dataset. That approach
was chosen for convenience rather than because it was a sound way to store
results; the backend takes over that responsibility. See [Results](/components/core/results/).

## Responsibilities

The backend serves two kinds of client, as described in
[Runners and Reporters](/components/architecture/#runners-and-reporters):

- **Runners** ([CLI](/components/cli/overview/),
  [driver](/components/driver/overview/), [Tauri app](/components/tauri/overview/))
  resolve test case definitions from the backend; the driver reports each
  [run record](/components/core/run-records/) back to it when the run finishes, and
  the run is then [reviewed and published](/components/core/results/#lifecycle).
  (Container images are not resolved from the backend — a runner pulls them from
  its configured registry directly; see
  [Execution](/components/core/execution/#containerization).)
- **Reporters** ([Tauri app](/components/tauri/overview/), and indirectly the
  [public site](/components/site/overview/)) read those definitions and
  published results to display them.

Concretely, the backend holds:

- **Test case definitions.** Test cases are authored in the repository's
  `test-cases/` folder; a finished version is published to the backend, which
  then holds the canonical copy a runner resolves at run time. The repository is
  the editing source; the backend is the distribution source. The on-disk format
  is unchanged by this — publishing caches a version, it does not transform it.
  See [Test Cases](/testing/end-to-end/overview/#catalog-layout).
- **Run results.** The published [run records](/components/core/run-records/),
  with their links to each run's public source repository and playable build.
  This is the system of record for published runs, persisted in a relational
  database (embedded SQLite by default, or PostgreSQL) through SeaORM. (The exact
  tables are a backend implementation detail; what is
  fixed is the [run record](/components/core/run-records/) shape stored in them
  and the [HTTP API](/components/backend/api/) and
  [public snapshot](/components/backend/snapshot/) that expose them.)

Every component interacts with the backend over one [HTTP API](/components/backend/api/);
that interface and the [public snapshot](/components/backend/snapshot/) it exports
are the backend's two cross-component contracts. The backend itself is configured
entirely through environment variables (its bind address, database and store
paths, the repository checkout it ingests from, and its R2 and deploy-hook
credentials) — no configuration file is required.

## Authentication

The backend has no public write surface, and it stays on a **private network** —
in a [cluster deployment](/deployment/kubernetes/), a `ClusterIP` service with no
public `Ingress` — so that reachability is the first line of access control and
the service is never exposed to the public internet. On top of that network boundary,
a second, application-level layer **identifies who is acting**: real user
[accounts](#accounts), so that every [review](/components/core/results/#reviews) a
run carries is attributed to a person rather than being anonymous. The network
boundary is not replaced — auth is an *added* layer.

- **Reads stay open.** Pulling definitions and reading runs require only that the
  caller can reach the backend on its private network.
- **Mutations require an account.** The mutating run endpoints — reviewing and
  publishing — require a **bearer token** identifying the account acting; without
  one the backend answers `401`. The backend does not itself store
  credentials; it verifies each token against a separate [auth
  service](/components/auth/overview/) (see [Accounts](#accounts)).

Because the backend is private, the [public site](/components/site/overview/)
does **not** read from it directly.

## Accounts

User identity lives in a **standalone [auth service](/components/auth/overview/)**
(`crates/auth-service`, the `tcab-auth-service` binary), not in the backend
itself. The auth service handles open self-registration and password login
(hashing with Argon2id) and mints opaque **bearer tokens**; the backend stays out
of the credential business entirely.

On every mutating run request (review, publish) the caller presents its
token as `Authorization: Bearer <token>`, and the backend **verifies** it against
the auth service (`POST /auth/verify`) to resolve the acting account — failing the
request `401` if the token is missing or invalid. The account it resolves is what a
review is [attributed](/components/core/results/#reviews) to.

The backend is pointed at the auth service with `TCAB_BACKEND_AUTH_URL` (default
`http://127.0.0.1:8789`). Identity is an *added* layer on top of the private
network, not a replacement for it: the auth service is itself a private-network
service, and open self-registration is acceptable precisely because reaching it
already requires being on that network. See the
[auth service overview](/components/auth/overview/).

## Review, Publish, and Synchronization

A produced run reaches the gallery through two steps the backend mediates —
**review**, then **publish** (the [lifecycle](/components/core/results/#lifecycle)
is the conceptual account; this is the backend's role in it).

A run's record is stored **privately** the moment the run finishes — the
[driver](/components/driver/overview/) reports it when it posts the job's terminal
status, and the produced build and media land on the
[artifact service](/components/artifacts/overview/). It is not in the public
snapshot, but its build is playable so it can be reviewed. **Review** attaches one
or more [reviews](/components/core/results/#reviews) (one per account) to the run.

The public **release** of the run — its generated code to its own public
repository, its build to Cloudflare Pages — happens only on **publish**, and the
backend owns this **synchronized** half. Being a single, central entity is the
point: it serializes publish requests so that two operators publishing at the same
time cannot race on the shared state. Publish is a gate — it **refuses a run that
has no review** (`422`) — and on each accepted publish the backend enqueues a
per-publish [`tcab-publisher`](/components/dispatcher/overview/) Job to do the
release, then on its terminal success:

1. Marks the run published in its store, the system of record.
2. Regenerates the [public snapshot](#public-snapshot) from the full set of
   **published** runs (an unpublished run is excluded), each with its reviews.
3. Uploads the snapshot to its public bucket and triggers a rebuild of the site.

Because the backend coordinates this, it can also **coalesce** a burst of
publishes — a batch sweep, or several operators at once — into a single snapshot
regeneration, one upload, and one site rebuild, rather than one of each per run.
Regenerating the whole published set each time (rather than applying deltas)
keeps the operation idempotent: re-running it converges on the same snapshot.

Both of these mutations require a bearer token (see [Accounts](#accounts));
reviews are attributed to the account the token resolves to.

## Public Snapshot

The public site must show published runs to anonymous visitors without depending
on the private backend. To bridge this, the backend **exports a public
snapshot** of its published dataset — the run records, their reviews (each
attributed to its reviewer), and the case metadata the gallery needs — that the
static site is built from. Only **published** runs are exported; a produced run
that has not been published is never in the snapshot.

- The snapshot is uploaded to a **[Cloudflare R2](https://developers.cloudflare.com/r2/)**
  bucket, which pairs naturally with the site's Cloudflare Pages deployment. The
  backend holds the only credential that can write to it; the bucket is
  read-only to everyone else.
- The upload is **atomic** — a new snapshot is written and then swapped into
  place — so a site build never reads a half-written dataset.
- After uploading, the backend fires the site's **deploy hook** to trigger a
  rebuild. The site build fetches the snapshot from R2 and produces static
  output; it never connects to the backend.

This keeps the trust boundary clean: the backend stays private and authenticated,
the only thing that crosses into public reach is an exported, read-only dataset
of already-published runs, and the connection always flows *outward* from the
backend — nothing reaches in. The site has no live dependency on the backend and
remains a fully static deployment. See [Site](/components/site/overview/).

The snapshot's exact file layout — the keys, the atomic-swap pointer, and the
shape of each file the site reads — is specified in
[Public Snapshot](/components/backend/snapshot/).

## Status

The backend ships in [v0.2.0](/changelogs/v0.2.0/) as the
`test-cabinet-backend` crate (`crates/backend`): an [Axum](https://github.com/tokio-rs/axum)
server backed by a SeaORM system of record (embedded SQLite by default, or an
external PostgreSQL) and an on-disk definition store. It is configured entirely
through environment variables — its bind address (`TCAB_BACKEND_BIND`), database
connection URL (`TCAB_BACKEND_DATABASE_URL`), definition store
(`TCAB_BACKEND_STORE`), the repository checkout it ingests from
(`TCAB_BACKEND_CHECKOUT`), the snapshot coalescing window
(`TCAB_SNAPSHOT_COALESCE_MS`), whether experimental (still-being-iterated-on) test
cases are offered to the UI (`TCAB_BACKEND_ALLOW_EXPERIMENTAL`, truthy to enable;
default hidden), and its R2 (`TCAB_R2_*`) and deploy-hook
(`TCAB_SITE_DEPLOY_HOOK_URL`) credentials, and the
[auth service](/components/auth/overview/) it verifies bearer tokens against
(`TCAB_BACKEND_AUTH_URL`, default `http://127.0.0.1:8789`). The backend binds to
`8787` by default (the worker uses `8788`, the auth service `8789`). Only
`TCAB_BACKEND_CHECKOUT` is required; with the R2 and deploy-hook variables omitted
the backend still ingests, records reviews/publishes, and regenerates the
snapshot on disk, skipping only the upload and rebuild — a dev-only mode.

User identity is **not** part of this crate. It lives in the standalone
[auth service](/components/auth/overview/) (`crates/auth-service`,
`tcab-auth-service`), which the backend treats as an external dependency it
verifies tokens against — keeping credential storage out of the backend entirely.
