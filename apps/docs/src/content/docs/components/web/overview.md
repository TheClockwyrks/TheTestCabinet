---
title: Overview
---

The web console is The Test Cabinet's runner/reporter GUI running in a plain
browser. It is the same console as the [Tauri app](/components/tauri/overview/) —
sign in, configure and launch runs, watch their live
[event](/components/core/events/) stream, return to any run still in progress —
and **kill** one from its live monitor — be notified when one completes, read
[specs](/testing/end-to-end/overview/),
[review](/components/core/results/#review) finished runs, and
[publish](/components/core/results/#publish) them — but delivered as a static web
app instead of a desktop binary. (A produced run's record is
[stored](/components/core/results/#stored-when-produced) on the backend by the
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

## Bounded run loading

The console does **not** drain the whole cabinet into memory. Its run and model
list pages are **server-paged**: each page issues a
[`GET /runs?fields=summary`](/components/backend/api/#get-runs) query in the
numbered-offset mode (`offset` + `limit`), driving the numbered pager off the
returned `total`. Search (debounced, then sent as `q`), the page-scoped filters (a
model id on the model-runs page, a case slug and variant on the case/jam Runs
tab), and column-header sort are sent as query params, so filtering and sorting
happen in the backend, not client-side; changing any of them re-queries and resets
to page 0.

Every run listing carries the same **filter bar**: the free-text field plus the
equality facets its route does not already pin — test case, version, harness, and
model — and the **Current versions only** toggle, which is **on by default**. The
facets exist because `q` alone is one substring OR'd across the recorded identity
columns, so it can express neither "this case *and* this model" nor a test-case
version at all; each facet is its own server-side equality filter, so they AND with
each other and with the search. The toggle scopes every case's runs to its current
`major.minor` — a case version is frozen once it has runs, so an older minor is a
different spec whose runs are not comparable with the current one's — and steps
aside when an exact version is picked (see
[`latestVersions`](/components/backend/api/#get-runs)). All of it lives in the URL
(`?q=`, `?case=`, `?version=`, `?harness=`, `?model=`, `?latest=0`, `?page=`), so a
narrowed listing is a link someone else can open. Those listings draw from the
[`state=any`](/components/backend/api/#get-runs) slice, so a produced —
unpublished, and so unreviewed — run sorts and pages among the published ones
rather than being pinned ahead of them; only **in-progress** runs, which have no
record to list yet, still lead the first page. The home page fetches a recent
window, and the case-scoped leaderboard and metrics views fetch one bounded,
case-scoped summary set. A model's **Overview** tab fetches two such sets: a
model-scoped one, which is what its case/variant picker is built from, and the
selected case's case-scoped one, which is the field it places the model against.
Only a run's **detail** page loads that run's full
[record](/components/core/run-records/) (and its reviews),
[lazily](/components/backend/api/#get-runsid), one run at a time. Lightweight
[`RunSummary`](/components/backend/snapshot/#runsjson--the-run-index) cards back
every list, card, leaderboard, and metric.

## The runs section

`/runs` is four linkable tabs, each its own route. **Runs** is the all-runs index
above; the other three are console-only worklists, and the public gallery — which
holds nothing unreviewed or unpublished by definition — sees only the first, where
a tab bar would be redundant and is dropped entirely.

- **Failures** — the produced
  [publishable failures](/components/core/results/#publish) awaiting publish, each
  showing its failure tier and recorded detail so a real model failure can be told
  from a subscription auth-token refresh before it is released.
- **Unreviewed** — completed runs no account has reviewed yet
  ([`state=unreviewed`](/components/backend/api/#get-runs)): the "needs a first
  pass" queue.
- **Unpublished** — runs that have cleared the publish gate but have not been
  released ([`state=publishable`](/components/backend/api/#get-runs)). This is the
  publish backlog, and it exists chiefly because a publish is asynchronous and can
  fail: a release that did not land leaves the run *exactly* as it was, which in
  the all-runs listing is indistinguishable from one nobody has got round to
  publishing. Runs collect here instead. The list is the same dense run log with
  the same filter bar, so a backlog can be narrowed to one case or model, and rows
  are **selectable**: check them and right-click to publish the whole selection.
  The slice is deliberately the publish gate rather than everything unpublished —
  a worklist whose purpose is "select these and publish them" must not offer rows
  the backend is about to refuse.

A batch publish **enqueues** each release and stops there rather than watching them
finish: a release takes minutes in its own Job, and awaiting them would hold a live
stream open per run and pin the user to the page. A refused gate still surfaces
immediately; a release that starts and then fails arrives as a
[publish-failed notification](/components/core/results/#publish).

## Planning and steering runs

The console's Account section is where a reviewer declares what they want run and
how fast: [coverage plans](/components/backend/coverage/) (cases × combinations,
with a target per cell) and [ladders](/components/backend/ladders/) (an ordered
climb each combination ascends until it fails a rung). Both dashboards read the
backend's derived board and drive the same controls — top up now, pause, halt, halt
all — and both show the plan's or ladder's own unreviewed queue **in its own order**
rather than newest-first, which is the point of having chosen an emission order at
all.

Nothing here polls in the background. Topping up happens when the console asks:
opening a dashboard, pressing the button, or — where the plan or ladder has
`autoTopUp` on — submitting a review, which is exactly when a buffer slot frees. The
run order picker is labelled **"One case at a time" / "One model at a time"** (and,
on a ladder, "Rung by rung" / "Model by model"); the words depth- and breadth-first
appear nowhere in the console, because the choice is about what you want to review
side by side rather than about tree traversal.

Because reviewing is the loop these dashboards exist to close, opening a run from
one and pressing back returns to **that dashboard** rather than to the global run
list — the shared back-return machinery records the coverage section as the place to
come back to.

The Runs page carries the global counterparts to a plan's halt, on the trailing edge
of its tab bar: **Clear pending**, **Kill active**, and **Stop all**. These are
scoped to nothing — they stop the cabinet, not one plan — so the two that discard
work in progress confirm first, and all three report how many runs they actually
cancelled.

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
produced-run listing, recorded-event,
[console stream](/components/backend/api/#the-console-stream), auth-proxy, and
review/publish endpoints. Where a host can't
provide a piece of data — for example a worker that returns no recorded events
for an older run — the shared UI degrades gracefully rather than erroring.
