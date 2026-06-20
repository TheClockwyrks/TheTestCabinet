---
title: Overview
---

The web console is The Test Cabinet's runner/reporter GUI running in a plain
browser. It is the same console as the [Tauri app](/components/tauri/overview/) —
configure and launch runs, watch their live [event](/components/core/events/)
stream, return to any run still in progress and be notified when one completes,
read [specs](/testing/end-to-end/overview/), review finished runs, and publish —
but delivered as a static web app instead of a desktop binary, and backed by
**remote workers** rather than a built-in local one.

It shares its entire UI with the Tauri app through the
[UI library](/components/ui/overview/): both mount the same `GalleryApp` and
differ only in what they connect to. The shared app gates its run-execution
surface on a `canExecute` flag, which both consoles set; the static site leaves
it off.

## Two kinds of connection

The console talks to two distinct services, mirroring
[Runners and Reporters](/components/architecture/#runners-and-reporters):

- A single **backend** — the source of truth for the test case catalog,
  definitions, and published results. The console resolves the catalog and reads
  published data from here, over the [backend HTTP API](/components/backend/api/).
  It is **never** asked to a worker.
- A set of **workers** — the [runners](/components/worker/overview/) that actually
  execute a run. A launched run is submitted to the selected worker over the
  [worker API](/components/worker/overview/), and its live events stream back
  from there.

The web console **starts with no workers**: a person adds worker servers by URL
in the Connections settings (under the Settings gear), then picks which one a run
is submitted to. This is the one substantive difference from the Tauri app, which
pre-adds its host's [built-in local worker](/components/tauri/overview/); the
desktop's connections are otherwise fixed (nothing to add or remove).

## One backend, consistent workers

There can be several backend instances (for example staging and production), but
the console points at exactly **one at a time**. Because every worker is itself
bound to a backend (`TCAB_BACKEND_URL`), the console checks each connected worker
against the active backend and flags a worker bound to a different one — so it
can't ask a worker to run a test case that worker's backend can't resolve.
Launching on a mismatched worker is disabled.

The worker reports the backend it is bound to from its `GET /healthz` probe (as
`backendUrl`), which the console compares against the backend it is itself
pointed at. A worker that can't be reached or doesn't report a backend is shown
as *unverified* rather than blocked, so an unreachable health probe degrades
gracefully instead of locking the worker out.

## Deployment

Like the [public site](/components/site/overview/), the web console is a fully
static bundle (`vite build`). Unlike the site, it is an **operator** tool, not a
public gallery: it reads from and writes to the private backend and drives
private workers, so it is served on the same private network as the services it
talks to (see [Authentication](/components/backend/overview/#authentication)),
not deployed to the public internet.

## Status

`apps/web` is a thin host: it supplies the HTTP `BackendClient` and
`WorkerClient` transports and the connection state (backend selection and worker
add/remove/select), then mounts the shared `GalleryApp`. The whole console UI —
the routed gallery plus the run-execution screens — comes from the
[UI library](/components/ui/overview/), so it is the same app the desktop renders.

It runs against the now-implemented [backend](/components/backend/overview/) and
[worker](/components/worker/overview/) contracts: the backend serves the catalog
and published runs, and the worker exposes its run-execution, produced-run
listing, recorded-event, notification, and publish endpoints. Where a host can't
provide a piece of data — for example a worker that returns no recorded events
for an older run — the shared UI degrades gracefully rather than erroring.
