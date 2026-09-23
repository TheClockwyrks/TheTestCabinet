---
title: Public Projection
---

The public projection is a PostgreSQL database the backend writes and the
[gallery](/components/site/serving/) reads. The backend writes it as part of
publishing, so a published run appears on the gallery immediately.

The projection is the index half of the public dataset. The document half stays
in the public bucket described in [Public Snapshot](/components/backend/snapshot/),
and the two are joined by object key.

## What it holds

The projection carries the published set in the shape the gallery queries:

- One row per published run, holding the run's summary fields and the object key
  of its full document.
- One row per case version that a published run built, holding the case metadata
  the gallery frames a run with.
- One row per model a published run references.
- One row per short code.

Run records, event streams, and media are named from these rows by object key
rather than stored here.

## What reaches it

Published runs. A run's row is written when the run is published and removed
when it is unpublished or deleted, so the projection holds exactly the set the
gallery is allowed to show.

Provider tokens are scrubbed from a run's document and events before they are
uploaded. Redaction matches any provider-shaped token, and the backend's own
stored copy keeps the original.

## Write ordering

A publish writes the run's document and media to the bucket first and the
projection row last. The row is what makes a run visible, so it is written once
every object it names is in place.

## Durability

The backend records each pending projection write in an outbox and drains it. A
publish completes on the outbox write, so a projection database that is briefly
unreachable delays a run's appearance and leaves the publish itself intact.

The backend can regenerate the whole projection from its published set. The
operation is idempotent and is the repair path for a projection that has been
rebuilt or has drifted.

## Short codes

A run is assigned a short code the first time it is published. The code is the
shortest prefix of the run's digest that no published run already holds, and it
is stored on the run's row.

Assignment happens once. A code that has been handed out keeps addressing the
run it was minted for, whatever is published afterwards, and the web console reads a
run's code from its record.

## Schema version

The projection carries a schema version. The gallery reads it at startup and
refuses to serve a version it does not implement, so a projection written by a
newer backend is reported rather than misread.
