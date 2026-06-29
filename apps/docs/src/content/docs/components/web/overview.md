---
title: Overview
---

The web console is The Test Cabinet's runner/reporter GUI running in a plain
browser. It is the same console as the [Tauri app](/components/tauri/overview/) —
sign in, configure and launch runs, watch their live
[event](/components/core/events/) stream, return to any run still in progress and
be notified when one completes, read [specs](/testing/end-to-end/overview/),
[review](/components/core/results/#review) finished runs, and
[publish](/components/core/results/#publish) them — but delivered as a static web
app instead of a desktop binary. (A produced run's record is
[pushed](/components/core/results/#push) to the backend by the
[driver](/components/driver/overview/) when the run finishes, so the console has
no separate push step.) Both consoles
enqueue runs at the [backend](/components/backend/overview/)'s run queue and watch
them; neither runs a test case itself.

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
- The **backend** also owns the run queue — a launched run is **enqueued** at the
  backend over the [backend HTTP API](/components/backend/api/), where a
  [dispatcher](/components/dispatcher/overview/) claims it and creates a per-run
  [driver](/components/driver/overview/) `Job`; the driver's live events stream
  back through the backend to the console. The backend also **proxies** account
  register/login to the
  [auth service](/components/auth/overview/) and forwards the signed-in account's
  bearer token to the backend when the console reviews or publishes, so the
  console authenticates through the same worker it runs on.

The web console and the [Tauri app](/components/tauri/overview/) are now wired the
same way: both enqueue runs at a single backend over the **same HTTP transport**
(`@test-cabinet/ui/transport`) and watch them. The desktop app additionally runs
the [adversarial](/testing/adversarial/overview/) arena locally, in-process; that
is the only execution either console performs on its own machine.

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
not deployed to the public internet. In a cluster deployment that bundle is the
in-cluster `tcab-web` workload, reached over the VPN at a private hostname through
the [internal ingress](/deployment/kubernetes/#internal-ingress) — never a public
FQDN.

## Status

`apps/web` is a thin host: it supplies the HTTP `BackendClient` and
`WorkerClient` transports and the connection state (backend selection and worker
add/remove/select), then mounts the shared `GalleryApp`. The whole console UI —
the routed gallery plus the run-execution screens — comes from the
[UI library](/components/ui/overview/), so it is the same app the desktop renders.

It runs against the now-implemented [backend](/components/backend/overview/)
contract: the backend serves the catalog and published runs, owns the run queue
that the [dispatcher](/components/dispatcher/overview/) drains into per-run
[driver](/components/driver/overview/) `Job`s, and exposes its run-enqueue,
produced-run listing, recorded-event, notification, auth-proxy, and
push/review/publish endpoints. Where a host can't
provide a piece of data — for example a worker that returns no recorded events
for an older run — the shared UI degrades gracefully rather than erroring.
