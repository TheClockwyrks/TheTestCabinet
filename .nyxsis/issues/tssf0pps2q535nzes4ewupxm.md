---
format: nyxsis-issue
version: 3
id: tssf0pps2q535nzes4ewupxm
zone: BACK
number: 2
title: Move the backend's stored files into Postgres and artifacts
type: generic
state: open
depends_on:
  - mkwwaowuuf9kuvps1wmow2pi
created: 2026-10-19T00:38:39.876038831Z
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
