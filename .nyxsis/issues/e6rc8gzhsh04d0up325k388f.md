---
format: nyxsis-issue
version: 2
id: e6rc8gzhsh04d0up325k388f
zone: BACK
number: 1
title: Persist each relayed event batch in Postgres as it arrives
type: generic
state: open
created: 2026-10-19T00:38:30.451934995Z
---

The backend holds a running job's relayed events only in the in-memory relay
(`crates/backend/src/relay.rs`, `ingest_events` in
`crates/backend/src/api/jobs.rs`) and writes them to the database only when the
terminal record arrives (`persist_record`). A backend restart mid-run loses the
events relayed before it, and a job that ends with no record keeps none. The
driver drops a batch the backend refuses (`flush_events` in
`crates/driver/src/sink.rs`).

The documentation has every accepted batch stored before it is acknowledged,
keyed by job and sequence, with the driver holding and resending a batch until
it is acknowledged:

- `apps/docs/src/content/docs/components/driver/events.md`, "Delivery to the
  backend"
- `apps/docs/src/content/docs/components/backend/overview.md`, "Durable state"
  and "Restarts"
- `apps/docs/src/content/docs/components/backend/api.md`,
  "`GET /runs/{id}/events`" and "Reviewing, publishing, and reading runs"

## What is missing

- The `POST /jobs/{id}/events` body as `{ sequence, events }`, with the driver
  numbering a job's events from `0` and the contracts crate's job client
  sending that shape.
- A table of relayed events keyed by (job id, sequence), with a migration, and
  `ingest_events` inserting a batch in one transaction, skipping keys already
  stored, before answering `204` and fanning out.
- The driver's relay posting one batch at a time and resending an
  unacknowledged batch with backoff on a connection error or `5xx`, and every
  terminal-status path, failure included, waiting until every batch is
  acknowledged.
- `persist_record` and the `canceled` path reading the job's stored events
  instead of the relay's snapshot, and `GET /runs/{id}/events` serving them in
  sequence order.
- `GET /jobs/{id}/live` replaying the stored events as its backlog before the
  live tail.

## Verify

- A test posts a batch, restarts the backend state (a fresh relay over the same
  database), posts the next batch and the terminal record, and reads the whole
  stream back from `GET /runs/{id}/events`.
- A test posts the same batch twice and reads each event once.
- A driver test has the backend answer `503` to a batch and then `204`, and
  sees the batch delivered and the terminal status posted after it.
- `make gate` passes in the backend and driver checkouts.
