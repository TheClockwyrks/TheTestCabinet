---
title: Overview
---

The console is The Test Cabinet's runner and reporter GUI, delivered as a
static browser bundle from the `console.testcabinet.ai` repository. It mounts
the routed application from the [UI library](/components/ui/overview/) with the
run-execution surface enabled, and reaches every service it uses at a path of
its own origin.

From the console a person configures and launches a run, watches its live
[event](/components/driver/events/) stream, returns to a run still in progress,
kills a run before it finishes, reads the
[specification](/testing/end-to-end/overview/) a run was built from,
[reviews](/components/backend/results/#reviews) a finished run, and shares a
[published](/components/backend/results/#publish) one.

The console executes no test case itself. It enqueues the run at the backend,
where a [dispatcher](/components/dispatcher/overview/) claims it and a per-run
[driver](/components/driver/overview/) `Job` runs it. The driver stores the
finished record on the backend, so the console has no push step.

The repository builds against `contracts` (`@clockwyrks/run-record` and
`@clockwyrks/backend-api`), `engines` and `ui-common`, and vendors the replay
assets it needs from `test-suites`.

## Service dependencies

The console is served at one origin per environment, `console.testcabinet.ai`
in prod and `console.staging.testcabinet.ai` in staging, and every service it
talks to is a path of that origin:

- `/api/` is the [backend](/components/backend/overview/), the source of truth
  for the test-case catalog, the run queue, produced and published runs, and
  the [console stream](/components/backend/api/#the-console-stream) of
  completion notifications and run-lifecycle events, all reached over the
  [backend HTTP API](/components/backend/api/).
- `/artifacts/` is the [artifacts service](/components/artifacts/overview/),
  which serves a run's build, proof media, showcase files, and asset-generation
  media, published or not. The console resolves every media link under it.
- `/arena/` is the [arena service](/components/arena/overview/), which runs
  [adversarial](/testing/adversarial/overview/) matches and tournaments.

The console reopens its console stream at once, without backoff, when the
window receives the `tcab:resume` event. The
[operator client](/components/client/overview/) dispatches it when the app
returns from the background, so a run watched before the app was suspended
resumes updating.

The origin is a Cloudflare Tunnel into the cluster, fronted by Cloudflare
Access; see [Edge](/deployment/kubernetes/edge/). A person signs in on the
Microsoft login page the first time they open the origin, and the browser holds
the Access cookie from then on. Every request the console makes carries that
cookie, so the console stores no token and presents no login form. The reviewer
a review is attributed to is the [identity](/components/auth/overview/) of the
assertion the edge adds to the request.

## Configuration

The console names no service URL. Its requests address paths of its own origin,
so a deployment configures nothing at start. The one build-time value,
`VITE_SHARE_ORIGIN`, is the origin a [share link](#sharing-a-published-run) is
built on, `https://tcab.ai` for prod and `https://staging.tcab.ai` for staging,
so the two environments are two builds of the bundle. In development the
Vite dev server proxies `/api`, `/artifacts` and `/arena` to the forwarded
local services; `TCAB_PROXY_BACKEND`, `TCAB_PROXY_ARTIFACTS` and
`TCAB_PROXY_ARENA` in a gitignored `.env.development.local` override the
targets.

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
[showcase](/components/driver/showcase/) from runs at the `legendary` aesthetic
tier, and scopes a group leaderboard to the member cases of its [test-case
group](/components/backend/test-case-groups/). Only a run's detail page loads that
run's full [record](/components/contracts/run-records/) and its reviews, [one run at
a time](/components/backend/api/#get-runsid). Summary records back every
listing, leaderboard, and metric.

## The test cases section

`/test-cases` is the searchable catalog of every visible case. From a case a
person reads its description and [showcase](/components/driver/showcase/) media,
launches the deployed [reference
build](/components/backend/results/#reference-implementations) for the anchored
variant and engine, reads the anchored version's own description, reads the
case's changelog, and reads how runs of the case are scored. While an older
version is anchored, the page names the latest version and links to it.

A test suite's detail page and the version page of a test case a suite defines
show one Reference entry per engine with an [uploaded reference
build](/components/backend/api/#put-suitesslugversionsversionreference-buildsengine),
played inline exactly as a legacy reference build is. An engine with no uploaded
build is listed without a play action.

A case, a run, and a game jam each show everything a run of that coordinate is
seeded with, a jam's prior-entry READMEs included. A workspace file's body is
fetched on demand, because a starter project can be large.

## The runs section

`/runs` is the run index and the reviewer's worklists, each its own route. The
all-runs index and the signed-in reviewer's
[comparisons](/comparisons/overview/), published or not, render on every host,
and the read-only gallery lists the published set. The worklists are
console-only, and the public gallery leaves their routes unmounted.

- Failures: the produced publishable failures awaiting publish, so a real model
  failure can be told from a subscription auth-token refresh before it is
  released.
- Unreviewed: completed runs no reviewer has reviewed yet (`state=unreviewed`),
  validator-rated runs included, since a review can be added to those at any
  time.
- Unpublished: runs that have cleared the publish gate but have not been
  released (`state=publishable`), which is the publish backlog. A completed
  validator-rated run
  [publishes itself](/components/backend/results/#automatic-publishing), so it is
  here only while its release is in flight or after its release failed.
- Unreadable: runs whose stored record this build can no longer read
  ([`GET /runs/unreadable`](/components/backend/api/#get-runsunreadable)). The
  worklist is present only while the cabinet holds at least one such run, and it
  is the one surface these runs are reachable from and deleted from.

On a [validator-rated](/testing/end-to-end/evaluation/#rating-channels) run the
automated verdict is available the moment the run completes. It is
informational, so every visitor sees it, the public gallery included. Every
capped point carries its failure cap as a rating badge, in the tier's colour
while the point fails and the cap is in force, and dimmed while it passes or is
undecided. Either side of a point's reference-versus-run media can be
downloaded: an image or a clip as the file it is, and a replay rendered to a
WebM clip at its recorded pace.

A run's checklist is the case's checklist restricted to the run's engine,
holding the points whose [validator covers that
engine](/components/driver/validation/). A review records one run-wide aesthetic
tier, a writeup, and a verdict for each point of that checklist. Publish is
offered whether or not a review exists.

The publish backlog is its own worklist because a publish is asynchronous and
can fail. Its slice is the publish gate rather than everything unpublished, so
it offers only rows the backend will accept. A batch publish enqueues each
release and stops there. A refused gate surfaces immediately, and a release that
fails after starting arrives as a
[publish-failed notification](/components/backend/results/#publish).

## Sharing a published run

A published run carries a short code on its record, assigned the first time it
publishes and never reassigned. The run's share control offers the two links
[tcab.ai](/components/site/serving/) resolves from that code:
`<share origin>/r/<code>`, the run's verdict page on the gallery, and
`<share origin>/p/<code>`, its play page. Both are built from the record's code
and the build's share origin, never from the console's own location, so a link
copied from the console opens on the public gallery. A run with no code offers
no share control.

## Planning and steering runs

The console's Account section, the signed-in identity's own, is where a
reviewer declares what they want run:
[coverage plans](/components/backend/coverage/), which are cases against
combinations with a target per cell, and [ladders](/components/backend/ladders/),
an ordered climb each combination ascends automatically until it fails a rung.
Both serve their own unreviewed queue in their own order rather than
newest-first. A review queue is for labelling runs after the fact, and nothing on
it launches or holds back a run.

The reviewer's runs-in-flight limit lives in Settings → Runs. A plan and a
ladder may override it, and either may be set to no limit.

A control carries its own state, so nothing beside it restates that state. Every
figure on a card or a dashboard sits in a fixed slot with tabular numerals, so a
number changing never moves anything else.

### The plans list

Each plan's card shows its name and, below it, its runs per cell. A progress bar
measures runs: the runs that count, capped at each cell's target, out of every
cell's target. The text beside the bar is the cells filled, for example
"5/8 cells". The bar's hover text gives the run detail: runs done of the total,
runs in flight, and runs still to launch. A filling plan that
[needs attention](/components/backend/coverage/#needs-attention) carries a Needs
attention status beside its name, and the bar's hover text says so.

### A plan

A plan opens on three tabs, each its own URL so a reviewer can link and return
to the one they are working from. Dashboard carries where the plan stands and
every control that moves it. Reviews is the plan's unreviewed queue, one row per
run, each row opening that run's verdict. Tests is the matrix of what the plan
still needs, grouped and ordered exactly as the plan runs it.

The three tabs are one surface with three bodies. They share one read of the
board and one set of controls, so pressing a tab moves only the body and the
report of what a control just did survives the press.

The Dashboard states the plan's position as counts: cells filled, runs done of
the total, runs in flight against the limit, runs to review, and blocked cells.
To review is informational. Its controls are All missing, which starts
[filling](/components/backend/coverage/#filling-a-plan) the plan, Halt, and Halt
all, which is confirmed. While the plan is filling, the control line says so and
Halt stops it. A filling plan that
[needs attention](/components/backend/coverage/#needs-attention) says that
instead, since only a blocked cell's Retry moves it, and the plan carries a Needs
attention status beside its name on every tab. All missing stays available,
and pressing it runs another launch pass, which resumes a fill left with nothing in
flight. Under a runs-in-flight limit of 0 the plan says it launches nothing, and All
missing is unavailable.

The Dashboard also breaks the plan's runs down by model, by combination, by test
case, and by rating, and charts the rating mix per combination. The board's
counts say how many runs a cell has; the breakdowns say what those runs were,
which is what tells a covered plan apart from a covered plan whose runs are all
broken. The breakdowns read [the plan's runs](/components/backend/coverage/#the-plans-runs),
so they describe the same runs the counts do (less any run whose record this build
can no longer decode), and a run beyond a cell's target appears in neither. The In
flight figure is the one exception: it is the plan's own jobs against its limit,
which can include a job whose cell other runs have since filled, and its tooltip
says so.

Each cell of the Tests matrix links to the run listing narrowed to that cell's
case, version, harness, and model. The listing cannot be narrowed to the plan's
runs alone, so the link is named All runs and says that it includes runs beyond
the cell's target.

Each cell of the Tests matrix offers two launches by hand: one more run, or the
cell's whole shortfall. Both launch the cell's own pin, engine included, so a run
bought by hand counts against the cell it came from. A
[blocked](/components/backend/coverage/#a-blocked-cell) cell shows as blocked
with a Retry action.

A plan's editor sets its members, runs per cell, the run order, the
runs-in-flight override, and the retry limit. The pickers pin a case coordinate of
test type, case,
version, variant, and engine, held to what the resolved version declares. A
combination takes either shape: a harness with its model, or a saved gg
configuration with a model bound to each of its launch slots, so two members of
one configuration that bind different models are two cells the plan will run.

### The ladders list

Each ladder's card is laid out in two rows, so its right side lines up with the
name and the description on its left:

| row | left                                            | right                    |
| --- | ----------------------------------------------- | ------------------------ |
| 1   | the name                                        | the status, then the bar |
| 2   | "N rungs · N runs/rung · N climbers"            | the rung-slot totals     |

The status is one of Not run yet, Running,
[Needs attention](/components/backend/ladders/#needs-attention), Finished, or
Stopped. The bar measures
the latest dispatch's
[runs done of its total](/components/backend/ladders/#progress), so a full bar
means nothing is left to execute. Its hover text gives the run detail, and names
the blocked and pending slots when there are any. The rung-slot totals cover the
whole ladder, never one climber: running, passed, failed, and skipped. A
[blocked](/components/backend/ladders/#rung-slots) slot is still the dispatch's
unfinished work, so it is counted in the running total. A ladder never run shows
an empty bar and zero totals in the same slots, so a first Run moves nothing.

### A ladder

A ladder's dashboard heads with its status, Run ladder, Stop, and Stop and cancel
running, which is confirmed. Run is unavailable while a dispatch is running,
which includes one that reads Needs attention. Stop and a blocked climber's Retry
stay available on it. Beside the order the dispatch climbs in, the control line
gives the retry limit the dispatch took at Run.

Its summary counts the climbers as Climbers, Running, Completed, and Failed, then
the rung slots skipped, the runs in flight against the limit, and the runs to
review. Blocked follows only when a climber is blocked, last, so a figure
appearing never moves the others.

Each climber's card heads with its identity, its status, and its rung track in
fixed slots, so a status changing during a climb never moves the track. A
blocked climber's reason and its fix take a line of their own under the header,
and a climber blocked as failing or unlaunchable offers Retry. Every status names
its rung: "Running rung 2", "Failed at rung 3", "Blocked at rung 4" with the
reason, and "Completed". Once a dispatch is stopped, a climber that was running
or blocked reads "Stopped at rung 2".

Expanded, a climber lists every rung with its slot status: Running, Blocked,
Passed, Failed, Pending, or Skipped. Only a running climber's current rung is
highlighted, and the highlight changes no row's layout. A rung's evidence reads
as its tally, for example "2 of 3 runs passed (1 needed)".

A ladder's status note states only what the summary figures cannot: the blocked
climbers and the fix for each, or a dispatch that cannot climb because its
runs-in-flight limit is zero. On a dispatch that reads Needs attention it says
first that nothing is running and the blocked climbers are waiting on the owner.

A ladder's editor sets its rungs, its climbers, runs per rung, the gate, the run
order, the runs-in-flight override, and the retry limit, and offers only validator-rated case
versions as rungs. It flags a rung whose pinned version is no longer the newest
ingested one, and says that an edit applies to the next Run.

A rung's runs are the [slot's runs](/components/backend/ladders/#a-rung-slots-runs)
the board reports for that rung and climber, whoever launched them, and the jobs
the dispatch has in flight for it. A ladder's board holds the console stream's [`runs`
topic](/components/backend/api/#topics) open while it is on screen, which keeps
the tallies and statuses moving as runs finish under it.

### Polling

Nothing here polls in the background. Every launch of a plan's fill or a
ladder's dispatch happens in the backend, prompted by the owner's control and by
each run that finishes, so a page being open or a review being submitted never
launches a run.

The runs section offers the cabinet-wide counterparts to a plan's halt: clear
pending, kill active, and stop all. These are scoped to nothing, stopping the
cabinet rather than one plan, so the two that discard work in progress confirm
first. All three report how many runs they actually cancelled.

## Deployment

`vite build` emits a fully static bundle, packaged as the `tcab-web` image:
nginx serving that bundle. The bundle names no service URL, so the image takes
no configuration at start, and the prod and staging images differ only in the
share origin their builds carry.

The console is an operator tool. It reads from and writes to the private
backend, so it is reachable only through the environment's Cloudflare Tunnel,
at `/` of the environment's origin, behind the Access application that protects
the origin. See [Edge](/deployment/kubernetes/edge/). The [operator
client](/components/client/overview/) is a shell that loads this same origin,
so a person on a desktop or on Android uses the console deployed here.
