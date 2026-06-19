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
  [worker](/components/worker/overview/), [Tauri app](/components/tauri/overview/))
  resolve test case definitions from the backend, then push their
  [run records](/components/core/run-records/) back to it when a run is published.
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
  See [Test Cases](/components/core/test-cases/#catalog-layout).
- **Run results.** The published [run records](/components/core/run-records/),
  with their links to each run's public source repository and playable build.
  This is the system of record for published runs, persisted in an embedded
  SQLite database. (The exact tables are a backend implementation detail; what is
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

The backend has no end-user accounts and no public write surface. Only the
operator and other authorized users may push to or pull from it. Rather than
hand-rolling an authentication mechanism, the backend is intended to sit on a
**private network** — using something like [Tailscale](https://tailscale.com/)
or a comparable mesh/VPN — so that reachability itself is the access control and
the service is never exposed to the public internet.

- Pushing results (publishing) and pulling definitions both require the caller
  to be on that private network; a runner authenticates to the backend by being
  able to reach it.
- Keeping authentication at the network layer means the backend does not need to
  implement and maintain its own login, token, or session handling.

Because the backend is private, the [public site](/components/site/overview/)
does **not** read from it directly.

## Publishing and Synchronization

[Publishing](/components/core/results/#publishing) a run is split into a half
that operators do directly and a half the backend owns. An operator's component
(the [CLI](/components/cli/overview/) or [Tauri app](/components/tauri/overview/))
releases the run's generated code to its own public repository and makes the
playable build embeddable — work that has no shared state, since each run is a
distinct repository — and then submits the run record, the review, and the
resulting links to the backend.

The backend owns the **synchronized** half. Being a single, central entity is
the point: it serializes publish requests so that two operators publishing at
the same time cannot race on the shared state. On each request it:

1. Ingests the run record and its [review](/components/core/results/#reviews)
   into its store, the system of record for published runs.
2. Regenerates the [public snapshot](#public-snapshot) from the full set of
   published runs.
3. Uploads the snapshot to its public bucket and triggers a rebuild of the site.

Because the backend coordinates this, it can also **coalesce** a burst of
publishes — a batch sweep, or several operators at once — into a single snapshot
regeneration, one upload, and one site rebuild, rather than one of each per run.
Regenerating the whole published set each time (rather than applying deltas)
keeps the operation idempotent: re-running it converges on the same snapshot.

## Public Snapshot

The public site must show published runs to anonymous visitors without depending
on the private backend. To bridge this, the backend **exports a public
snapshot** of its published dataset — the run records, the reviews, and the case
metadata the gallery needs — that the static site is built from.

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
server backed by an embedded SQLite system of record and an on-disk definition
store. It is configured entirely through environment variables — its bind
address (`TCAB_BACKEND_BIND`), SQLite path (`TCAB_BACKEND_DB`), definition store
(`TCAB_BACKEND_STORE`), the repository checkout it ingests from
(`TCAB_BACKEND_CHECKOUT`), the snapshot coalescing window
(`TCAB_SNAPSHOT_COALESCE_MS`), and its R2 (`TCAB_R2_*`) and deploy-hook
(`TCAB_SITE_DEPLOY_HOOK_URL`) credentials. Only `TCAB_BACKEND_CHECKOUT` is
required; with the R2 and deploy-hook variables omitted the backend still
ingests and records publishes and regenerates the snapshot on disk, skipping
only the upload and rebuild — a dev-only mode.
