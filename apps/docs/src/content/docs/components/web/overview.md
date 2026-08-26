---
title: Overview
---

The web console is The Test Cabinet's runner and reporter GUI, delivered as a
static browser bundle. It is the same console as the [Tauri
app](/components/tauri/overview/): both mount the `GalleryApp` component from
the [UI library](/components/ui/overview/) and differ only in how they are
delivered and in where their service URLs come from.

From the console a person signs in, configures and launches a run, watches its
live [event](/components/core/events/) stream, returns to a run still in
progress, kills a run from its live monitor, reads the
[specification](/testing/end-to-end/overview/) a run was built from,
[reviews](/components/core/results/#reviews) a finished run, and
[publishes](/components/core/results/#publish) it. The console executes no test
case itself. It enqueues the run at the backend, where a
[dispatcher](/components/dispatcher/overview/) claims it and a per-run
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
  run's build, proof media, showcase files, and asset-generation media before
  it is published.
- The [arena service](/components/arena/overview/) runs
  [adversarial](/testing/adversarial/overview/) matches and tournaments.

Run execution is the backend's queue, presented to the shared app as one fixed
execution handle bound to the active backend.

## Configuration

The backend URL is resolved from the first of three sources that supplies one: a
value the operator stored through Settings → Connections, the deployment's
runtime `/config.js` (read as `window.__TCAB_CONFIG__`), and the build-time
`VITE_BACKEND_URL`. The auth service URL resolves the same way and falls back to
the backend URL, which is what a single-host development stack wants. With no
backend URL the console reports itself unconfigured.

Browser tracing is gated on `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`. When that
variable is set the console exports spans over OTLP/HTTP and injects a
`traceparent` header on every outbound fetch; when it is unset the whole
pipeline is inert. See [Observability](/development/observability/).

## Bounded run loading

The run and model list pages are server-paged. Each page issues a
[`GET /runs?fields=summary`](/components/backend/api/#get-runs) query in
numbered-offset mode (`offset` plus `limit`) and sizes its pager from the
returned `total`. The debounced search field, the filters, and column-header
sort travel as query parameters, so filtering and sorting happen in the backend;
changing any of them re-queries and returns to page 0.

The cross-case run listings carry the same filter bar: the free-text field, the
equality facets its route does not already pin (test case, version, harness, and
model), and a "Current versions only" toggle that is on by default. The facets
exist because `q` alone is one substring matched across the recorded identity
columns, so it can express neither one case together with one model nor a
test-case version at all; each facet is its own server-side equality filter, so
the facets narrow each other and the search. The toggle scopes every case's runs
to its current `major.minor`, since a case version is frozen once it has runs
and an older minor is a different spec whose runs are not comparable, and it
steps aside when an exact version is picked. The whole state lives in the URL
(`?q=`, `?case=`, `?version=`, `?harness=`, `?model=`, `?latest=0`, `?page=`),
so a narrowed listing is a link someone else can open.

A test case's own Runs tab keeps the free-text field and the harness and model
facets, but scopes version, variant, and engine relative to the page's [anchored
coordinate](/components/ui/overview/#the-case-detail-coordinate) instead of
carrying the version facet and the toggle.

Those listings draw from the [`state=any`](/components/backend/api/#get-runs)
slice, so a produced run, unpublished and therefore unreviewed, sorts and pages
among the published ones rather than being pinned ahead of them. Only
in-progress runs, which have no record to list yet, still lead the first page.

A listing re-queries whenever a run finishes, is published, is killed, or is
deleted, so a run that completes moves from the in-progress rows into the listing
under the filters and sort already applied.

The home page issues bounded reads of its own: one five-run summary query
filtered to the `legendary` aesthetic tier for its showcase, loading each
featured run's record for its [showcase](/components/core/showcase/) media; the
[cabinet statistics](/components/backend/api/#get-statscabinet) read for its
totals band and activity chart; and one member-case-scoped summary query per
[test-case group](/components/core/test-case-groups/) for its group
leaderboards. The case-scoped leaderboard and
metrics views fetch one bounded, case-scoped summary set. A model's Overview tab
fetches two such sets: a model-scoped one, which its case and variant picker is
built from, and the selected case's case-scoped one, which is the field it
places the model against. Only a run's detail page loads that run's full
[record](/components/core/run-records/) and its reviews, [one run at a
time](/components/backend/api/#get-runsid). Lightweight `RunSummary` cards back
every list, card, leaderboard, and metric.

## The runs section

`/runs` is a strip of linkable tabs, each its own route. Tests is the all-runs
index above and Comparisons lists the signed-in account's
[comparisons](/comparisons/overview/), published or not; both render on every
host, and the read-only static site lists the published set off its snapshot. The
other three are console-only worklists whose routes the public gallery leaves
unmounted, since it holds nothing unreviewed or unpublished.

- Failures: the produced
  [publishable failures](/components/core/results/#publish) awaiting publish, each
  showing its failure tier and recorded detail, so a real model failure can be told
  from a subscription auth-token refresh before it is released.
- Unreviewed: completed runs no account has reviewed yet
  ([`state=unreviewed`](/components/backend/api/#get-runs)), including
  validator-rated runs already publishable on their functional rating, since an
  aesthetic review can be added to those at any time; the queue that needs a
  first pass.
- Unpublished: runs that have cleared the publish gate but have not been released
  ([`state=publishable`](/components/backend/api/#get-runs)), which is the publish
  backlog.

A run with a playable build opens its detail page on the Play tab, which leads
the tab strip: the run's [showcase](/components/core/showcase/), when its
record carries one, and the playable embed. A run with no playable build opens
on Verdict, which then leads the strip as before.

On a [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run the
Verdict panel shows the points and the functional rating from the run record
the moment the run completes, with a per-domain breakdown naming each failing
item and the cap it applied, and a read-only browser of the automated items: a
rail listing every item, each item's validator verdict and per-verdict
assertions, and the implementation's replay beside the reference baseline's,
scrubbed together. The browser is informational, so every visitor sees it, the
public gallery included. The review form asks only for a per-domain aesthetic
tier and the writeup, and Publish is offered whether or not a review exists. On
a legacy run the panel is the guided review: the checklist takes verdicts, the
form takes the per-domain functional rating, and Publish waits on a review.

The publish backlog has a tab because a publish is asynchronous and can fail: a
release that did not land leaves the run exactly as it was, which in the all-runs
listing reads the same as a run nobody has got round to publishing. Those runs
collect here instead. The list is the same dense run log with the same filter bar,
so a backlog can be narrowed to one case or model, and its rows are selectable:
check them and right-click to publish the whole selection. The slice is the publish
gate rather than everything unpublished, so a worklist whose purpose is "select
these and publish them" offers only rows the backend will accept.

A batch publish enqueues each release and stops there. A release takes minutes in
its own Job, and awaiting them would hold a live stream open per run and pin the
person to the page. A refused gate surfaces immediately, and a release that starts
and then fails arrives as a
[publish-failed notification](/components/core/results/#publish).

## Planning and steering runs

The console's Account section is where a reviewer declares what they want run
and how fast: [coverage plans](/components/backend/coverage/), which are cases
against combinations with a target per cell, and
[ladders](/components/backend/ladders/), an ordered climb each combination
ascends until it fails a rung. Both dashboards read the backend's derived board
and drive the same controls, meaning top up now, pause, halt, and halt all, and
both show the plan's or ladder's own unreviewed queue in its own order rather
than newest-first, which is the point of having chosen an emission order at all.

Nothing here polls in the background. A top-up happens when the console asks:
opening a dashboard, pressing the button, or, where the plan or ladder has
`autoTopUp` on, submitting a review, which is exactly when a buffer slot frees.
The run-order picker is labelled "One case at a time" and "One model at a time",
and on a ladder "Rung by rung" and "Model by model"; the words depth-first and
breadth-first appear nowhere in the console, because the choice is about what a
reviewer wants to see side by side rather than about tree traversal.

Because reviewing is the loop these dashboards exist to close, opening a run
from one and pressing back returns to that dashboard rather than to the global
run list: the shared back-return machinery records the coverage section as the
place to come back to.

A ladder's board closes that loop on the page itself. Expanding a climber lists
its rungs, and expanding a rung lists that rung's own runs inline, in-flight ones
included, in the same dense run log the runs section uses. A rung's verdict is an
argument about its runs, so the runs sit under the rung rather than behind a link
to a pre-filtered listing. The board holds the console stream's [`runs`
topic](/components/backend/api/#topics) open while it is on screen, which is what
keeps the tallies and verdicts moving as runs finish under it.

Every page of the runs section carries the global counterparts to a plan's halt
on the trailing edge of its page header: Clear pending, Kill active, and Stop
all. These are scoped to nothing, stopping the cabinet rather than one plan, so
the two that discard work in progress confirm first, and all three report how
many runs they actually cancelled. The section's tab bar holds its tabs alone,
which is what keeps it on one row as tabs are added.

## Deployment

`vite build` emits a fully static bundle, packaged as the `tcab-web` image:
nginx serving that bundle, with an entrypoint that renders `/config.js` from the
container's environment. One image therefore serves every environment, because
the service URLs are injected at start rather than baked at build.

The console is an operator tool. It reads from and writes to the private
backend, so it is served on the same private network as the services it talks
to. In a cluster deployment it is the in-cluster `tcab-web` workload, reached at
a private hostname through the [internal
ingress](/deployment/kubernetes/internal-ingress/).
