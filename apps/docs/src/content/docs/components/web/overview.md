---
title: Overview
---

The web console is The Test Cabinet's runner and reporter GUI, delivered as a
static browser bundle. It is the same console as the [Tauri
app](/components/tauri/overview/), built from the same [UI
library](/components/ui/overview/) app and differing only in how it is delivered
and in where its service URLs come from.

From the console a person signs in, configures and launches a run, watches its
live [event](/components/core/events/) stream, returns to a run still in
progress, kills a run before it finishes, reads the
[specification](/testing/end-to-end/overview/) a run was built from,
[reviews](/components/core/results/#reviews) a finished run, and
[publishes](/components/core/results/#publish) it.

The console executes no test case itself. It enqueues the run at the backend,
where a [dispatcher](/components/dispatcher/overview/) claims it and a per-run
[driver](/components/driver/overview/) `Job` runs it. The driver stores the
finished record on the backend, so the console has no push step.

## Service dependencies

The console is bound to exactly one [backend](/components/backend/overview/) at
a time. That backend is the source of truth for the test-case catalog, the run
queue, produced and published runs, and the [console
stream](/components/backend/api/#the-console-stream) of completion notifications
and run-lifecycle events, all reached over the [backend HTTP
API](/components/backend/api/).

Three further services are called directly, and the backend reports the base URL
of each from `GET /config`:

- The [auth service](/components/auth/overview/) serves register, log in, and
  account profile pictures. The console posts credentials to it and carries the
  returned bearer token when it reviews or publishes.
- The [artifact service](/components/artifacts/overview/) serves a produced
  run's build, proof media, showcase files, and asset-generation media before it
  is published.
- The [arena service](/components/arena/overview/) runs
  [adversarial](/testing/adversarial/overview/) matches and tournaments.

## Configuration

The backend URL is resolved from the first of three sources that supplies one: a
value the operator stored through the console, the deployment's runtime
`/config.js` (read as `window.__TCAB_CONFIG__`), and the build-time
`VITE_BACKEND_URL`. The auth service URL resolves the same way and falls back to
the backend URL. With no backend URL the console reports itself unconfigured.

Browser tracing is gated on `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`. When that
variable is set the console exports spans over OTLP/HTTP and injects a
`traceparent` header on every outbound fetch. See
[Observability](/development/observability/).

## Bounded run loading

Run and model listings are server-paged. Each page issues a
[`GET /runs?fields=summary`](/components/backend/api/#get-runs) query in
numbered-offset mode (`offset` plus `limit`) and sizes its pager from the
returned `total`. Search, filters, and sort travel as query parameters, so
filtering and sorting happen in the backend.

Run listings carry a filter bar whose state lives in the URL, so a narrowed
listing is a link someone else can open. A case's own run listing is scoped to
that page's [anchored
coordinate](/components/ui/overview/#the-case-detail-coordinate).

Those listings draw from the `state=any` slice, so a produced run sorts and
pages among the published ones. [In-progress
runs](/components/ui/overview/#the-run-log) lead the first page. A listing
re-queries whenever a run finishes, is published, is killed, or is deleted.

Every other surface reads bounded, scoped summary sets. The home page also reads
[cabinet statistics](/components/backend/api/#get-statscabinet), draws its
[showcase](/components/core/showcase/) from runs at the `legendary` aesthetic
tier, and scopes a group leaderboard to the member cases of its [test-case
group](/components/core/test-case-groups/). Only a run's detail page loads that
run's full [record](/components/core/run-records/) and its reviews, [one run at
a time](/components/backend/api/#get-runsid). Summary records back every
listing, leaderboard, and metric.

## The test cases section

`/test-cases` is the searchable catalog of every visible case. From a case a
person reads its description and [showcase](/components/core/showcase/) media,
launches the deployed [reference
build](/components/core/results/#reference-implementations) for the anchored
variant and engine, reads the case's changelog, and reads how runs of the case
are scored.

A case, a run, and a game jam each show everything a run of that coordinate is
seeded with, a jam's prior-entry READMEs included. A workspace file's body is
fetched on demand, because a starter project can be large.

## The runs section

`/runs` is the run index and the reviewer's worklists, each its own route. The
all-runs index and the signed-in account's
[comparisons](/comparisons/overview/), published or not, render on every host,
and the read-only static site lists the published set off its snapshot. The
worklists are console-only, and the public gallery leaves their routes
unmounted.

- Failures: the produced publishable failures awaiting publish, so a real model
  failure can be told from a subscription auth-token refresh before it is
  released.
- Unreviewed: completed runs no account has reviewed yet (`state=unreviewed`),
  validator-rated runs included, since a review can be added to those at any
  time.
- Unpublished: runs that have cleared the publish gate but have not been
  released (`state=publishable`), which is the publish backlog.
- Unreadable: runs whose stored record this build can no longer read
  ([`GET /runs/unreadable`](/components/backend/api/#get-runsunreadable)). The
  worklist is present only while the cabinet holds at least one such run, and it
  is the one surface these runs are reachable from and deleted from.

On a [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run the
automated verdict is available the moment the run completes. It is
informational, so every visitor sees it, the public gallery included.

A run's checklist is the case's checklist restricted to the run's engine,
holding the points whose [validator covers that
engine](/components/core/validation/). A review records one run-wide aesthetic
tier, a writeup, and a verdict for each point of that checklist. Publish is
offered whether or not a review exists.

The publish backlog is its own worklist because a publish is asynchronous and
can fail. Its slice is the publish gate rather than everything unpublished, so
it offers only rows the backend will accept. A batch publish enqueues each
release and stops there. A refused gate surfaces immediately, and a release that
fails after starting arrives as a
[publish-failed notification](/components/core/results/#publish).

## Planning and steering runs

The console's Account section is where a reviewer declares what they want run
and how fast: [coverage plans](/components/backend/coverage/), which are cases
against combinations with a target per cell, and
[ladders](/components/backend/ladders/), an ordered climb each combination
ascends until it fails a rung. Both read the backend's derived board and offer
the same actions: an auto top-up setting, top up now, halt, and halt all. Both
serve the plan's or ladder's own unreviewed queue in its own order rather than
newest-first.

A plan's auto top-up setting drives the backend's
[`paused`](/components/backend/coverage/#pausing-and-halting) and `autoTopUp`
together, because a halt sets `paused` and that blocks every top-up. A halt
therefore turns auto top-up off, turning it back on clears the halt and tops up
at once, and a top-up requested by hand on a halted plan clears the halt without
turning auto top-up on. A ladder's setting is whether it is enabled, because a
ladder [starts disabled](/components/backend/ladders/#a-ladder-starts-disabled)
and enabling it starts the climb; whether it tops up on review is a separate
setting.

A control carries its own state, so nothing beside it restates that state. A
status note explains only what no control shows: a full review buffer, runs the
queue is holding back, cells nothing can launch, or a plan that is finished. A
halt reports what it cancelled.

Nothing here polls in the background. A top-up happens when the console asks:
opening a plan with auto top-up on, turning a plan's auto top-up or a ladder on,
asking for one by hand, or, where the plan or ladder tops up on review,
submitting a review, which is exactly when a buffer slot frees.

A plan and a ladder pin a case coordinate of test type, case, version, variant,
and engine, held to what the resolved version declares. The engine is part of
what the pin commits to. A combination takes either shape: a harness with its
model, or a saved gg configuration with a model bound to each of its launch
slots, so two members of one configuration that bind different models are two
cells the plan will run. A plan also sets runs per cell, the run order, the
buffer-target override, and auto top-up. The buffer target may be set to no
limit, as may the account-wide default it overrides, so a plan or ladder can run
with no review buffer.

Launching a cell's runs by hand uses the cell's own engine, in both combination
shapes, exactly as that plan's own top-up does. A run launched on another engine
is counted against another cell.

A rung's runs are narrowed by the whole cell the gate counted: the rung's pin,
engine included, crossed with the climber's combination. An in-flight run is
narrowed the same way, off the engine its job records when it is enqueued. A
ladder's board holds the console stream's [`runs`
topic](/components/backend/api/#topics) open while it is on screen, which keeps
the tallies and verdicts moving as runs finish under it.

The runs section offers the cabinet-wide counterparts to a plan's halt: clear
pending, kill active, and stop all. These are scoped to nothing, stopping the
cabinet rather than one plan, so the two that discard work in progress confirm
first. All three report how many runs they actually cancelled.

## Deployment

`vite build` emits a fully static bundle, packaged as the `tcab-web` image: nginx
serving that bundle, with an entrypoint that renders `/config.js` from the
container's environment. One image therefore serves every environment, because
the service URLs are injected at start rather than baked at build.

The console is an operator tool. It reads from and writes to the private backend,
so it is served on the same private network as the services it talks to. In a
cluster deployment it is the in-cluster `tcab-web` workload, reached at a private
hostname through the [internal
ingress](/deployment/kubernetes/internal-ingress/).
