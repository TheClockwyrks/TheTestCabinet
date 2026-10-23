---
format: nyxsis-issue
version: 3
id: tssf0pps2q535nzes4ewupxm
zone: BACK
number: 2
title: Move the backend's stored files into Postgres and artifacts
type: generic
priority: 3
state: done
depends_on:
  - mkwwaowuuf9kuvps1wmow2pi
created: 2026-10-19T00:38:39.876038831Z
done: 2026-10-23T21:29:01.831772124Z
outcome: |
  The block was resolved in the docs first (`components/artifacts/overview.md`,
  "Routes", "Tournament match replays" and "Auth"). The artifacts service now has
  `PUT`/`GET /tournaments/{id}/matches/{matchId}/replay`, under the control-plane
  service token. A replay is stored at
  `tournaments/<id>/matches/<matchId>/replay.json` in the private container. `GET
  /runs` never lists it, and a run cannot be given the id `tournaments`.
  `components/backend/overview.md`, "Durable state", now names the route and
  describes the one-off move on start.

  Done:

  - **Controllers in the database:** a pushed `controller.wasm` lives in a new
    `run_controller` table (migration `m20261023_000066`). `GET`/`POST
    /runs/{id}/controller.wasm` and `GET /adversarial/controllers` read and write
    it there, and deleting a run deletes its controller. The table has no foreign
    key to the run, because the driver pushes the controller before the terminal
    report creates the run's row.
  - **Match replays:** written to and read back from the artifacts service.
    Without `TCAB_ARTIFACTS_URL` the backend's replay routes answer `503`.
  - **Backend run copies removed:** the session record, code-analysis and media
    copies under `runs/<id>/` are gone, along with their backend routes. The
    driver's mirror uploads are gone (only the controller push stays), and so are
    the matching backend-client methods in contracts. The publisher had no such
    uploads, only stale comments.
  - **Snapshot:** a run's media is now copied with `POST
    /runs/{id}/publish-media`, and the code analysis is read from the artifacts
    service. A media copy the service refuses fails the refresh, so the previous
    generation stays live.
  - **Console (ui-common):** a run's media and code analysis are now read from the
    artifacts service.
  - **One-off move on start:** controllers go into the database and match replays
    go through the artifacts service. The move runs in the background, and
    `/readyz` answers `503` "moving" until it finishes, while `/healthz` stays
    live. A file that fails to move is left for the next start.

  Verified: the backend test
  `a_backend_on_an_empty_store_serves_a_pushed_controller_and_a_stored_match_replay`
  passes, along with tests for the move on start. All Rust gates pass in the
  superrepo (1501 tests), plus the docs gates and the gates in artifacts (240
  tests), contracts, driver, publisher and ui-common.

  Not verified:

  - The arena-against-a-replaced-pod check was not run on a cluster.
  - `cspell` cannot check this worktree because it sits under `.git/`.
  - The superrepo's `dependency-graph` lock check fails the same way at the base
    commit: this machine has never downloaded the crate it needs to resolve
    offline.
  - In the driver and publisher, the `format`, `markdownlint` and `scripts-test`
    gates did not run because `npm ci` failed with E401. In contracts and the
    driver, one test fails the same way at the base commit (the suites browser
    test, and a bundle test affected by the shell's `GIT_AUTHOR_*` variables).

  Left:

  - A pushed controller whose run never gets a row stays in the table; nothing
    reclaims it.
  - One stale comment in
    `console.testcabinet.ai/apps/web/src/state/use-connections.ts`.
---

The backend writes durable files into its definition store on the pod's
`/state` volume (`crates/backend/src/store.rs`): a run's `replay.json`,
`code-analysis.json`, `controller.wasm`, its proof, asset, validation and
showcase media under `runs/<id>/`, and each tournament match's replay under
`tournaments/<id>/matches/<match>/replay.json`. They exist only on one
`ReadWriteOnce` disk, which is also what holds the backend to one replica and
the `Recreate` strategy.

The documentation keeps every durable thing the backend owns in the database or
on the artifacts service, and leaves the pod's disk holding only the definition
store and ingest checkout as caches:

- `apps/docs/src/content/docs/components/backend/overview.md`, "Durable state"
- `apps/docs/src/content/docs/deployment/backups.md`, "Data at risk" and
  "Recreating a cluster"
- `apps/docs/src/content/docs/components/artifacts/overview.md`, "Routes",
  which serves a run's media, session record and code analysis from its tree
- `apps/docs/src/content/docs/components/driver/overview.md`, "What the
  backend reads from the tree"

## What is missing

- A pushed `controller.wasm` stored in the database beside its run's row, with
  a migration, and `GET`/`POST /runs/{id}/controller.wasm` and the pushed
  controller listing reading and writing it there.
- Each tournament match replay written through the artifacts service to its
  private container and read back from there by
  `GET /tournaments/{id}/matches/{matchId}/replay.json`.
- The backend's `runs/<id>/` copies of the session record, code analysis and
  run media removed, with their backend `POST` routes and the driver's and
  publisher's mirror uploads to them, so the artifacts service is the one
  store of a run's tree.
- A one-off migration that moves the controllers and match replays already on a
  deployment's `/state` into their new homes.

## Verify

- A backend started on an empty definition store serves a pushed run's
  `controller.wasm` and a stored tournament's match replay.
- The arena pits a pushed controller and plays back a tournament match after
  the backend pod is replaced.
- `make gate` passes in the backend, driver and publisher checkouts.

## Blocked

`components/backend/overview.md`, "Durable state", says the backend writes and
reads each tournament match replay through "the object route ... listed with
the artifacts service's routes". `components/artifacts/overview.md`, "Routes"
and "Auth", lists no such route. Every route there is `/runs/{id}/...` or
`PUT /public/{key}`, and `PUT /public/{key}` writes the public R2 bucket, not
the private container. Adding the route to the API is a design decision for
the docs. The user must decide:

1. The route's path and methods. Two options:
   `PUT`/`GET /tournaments/{id}/matches/{matchId}/replay`, or a generic
   `PUT`/`GET /objects/{key}` limited to one prefix.
2. Its credential. The control-plane service token
   (`TCAB_BACKEND_SERVICE_TOKEN`) is the likely choice, but "Auth" must say so.
3. The key layout in the private container. One option is a `tournaments/`
   prefix. It must stay out of the `GET /runs` listing, or the reclamation
   sweep ("Artifact reclamation" in `backend/overview.md`) would delete the
   replays as orphaned run trees.

Not blocked: the controller in the database, the backend's reads from
artifacts, removing the backend's run copies and the driver and publisher
mirror uploads, and the controller half of the `/state` migration.
