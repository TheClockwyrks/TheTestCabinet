---
title: Coverage Plans
---

A **coverage plan** is an account's standing declaration of the runs it wants to
exist: a set of [pinned cases](#pinned-cases) crossed with a set of
[combinations](#combinations), plus a target number of runs for each
`case × combination` **cell**. The backend expands that declaration into a
matrix, counts what already exists against it, and launches the missing runs
when its owner asks it to [fill](#filling-a-plan) the plan.

Plans are per [account](/components/backend/overview/#authentication) and an
account may hold many. Their members are normally pointers to reusable **coverage
groups**, where a group holds either combinations or pinned cases, so one saved
set of models can drive several plans and editing the group reshapes all of them
at once. A plan may also pin one-off members directly, and the two sets are
unioned.

A plan answers "have I run this yet?". Its sibling, the
[ladder](/components/backend/ladders/), answers "how far does this model get?"
using the same counting rules, the same runs-in-flight limit, and the same launch
algorithm applied to an ordered series of cases. This page specifies everything
the two share; the ladder page covers only the difference.

## Counts are global, reviews are labels

A cell is filled by runs of that exact cell, whoever launched them and for
whatever reason. A run someone else produced satisfies the target and is never
re-requested. A plan observes runs rather than owning them, and it takes only as
many as its target asks for (see [a cell's runs](#a-cells-runs)).

The validation scripts are assumed correct, so a run's result is known the moment
it finishes. Reviews never gate, meter, or trigger the launching of runs on a plan
or a ladder. A review stays an optional label: an aesthetic rating, a writeup, or
checklist overrides. A completed validator-rated run
[publishes itself](/components/core/results/#automatic-publishing) when it
finishes, whatever launched it, and publishing any other run reads reviews as
described in [Results](/components/core/results/).

"Unreviewed" means there is no [review](/components/core/results/#reviews) row
for the requesting account, so two reviewers pointed at the same cabinet share its
runs and keep separate review queues.

## Pinned cases

A plan's case axis is a set of pinned cases, and a pin names four things: a
[test case](/testing/overview/)'s slug, an exact version, a variant of that
version, and the [engine](/components/core/engines/) its runs are built on. A pin
that names no engine covers the `none` engine.

The engine is part of the pin because a result is only comparable with another
result on the same engine. One case at one version and variant on two engines is
two pinned cases, and each crosses the plan's combinations on its own.

A pin naming an engine the case version does not declare support for is accepted
at author time and reported by the run, exactly as a version the backend has not
ingested is. The catalogue moves under a standing plan, so the check belongs at
the moment a run is executed.

## Combinations

A combination is what a cell's runs are executed by, and it takes one of two
shapes:

- a **harness combination**: a harness, the model it runs, and a provider for a
  provider-routed harness;
- a **gg combination**: a [gg configuration](/gg/configurations/) the account has
  saved, plus a model for each
  [launch slot](/gg/configurations/#configuration-slots) that configuration asks
  for.

The two shapes sit side by side in one plan, in one ladder, and in one
`kind = "combo"` group, and are crossed with the cases alike. One case under a
third-party harness and the same case under a gg configuration are two cells,
each counted on its own and each asking for `runsPerCell` runs.

A gg combination is launched like everything else. The launch pass resolves the
configuration as the account saved it at that moment, binds its launch slots to
the models the member names, and enqueues a gg run carrying that capability set.

### What identifies a gg cell

A harness cell is identified by `case@version/variant/engine × harness/model`. A
gg cell adds the configuration's id and the models the bound set runs on.

The id is the identity because an operator renames a configuration freely and two
of an account's configurations may carry one name. A
[ladder's climber key](/components/backend/ladders/#climbers) names a
configuration by its id as well, so a member, the cell counted for it, and the
climber that carries its results all resolve to the same configuration. The name
is what a run records, and it is what the run log and the
[query language](/gg/analysis/query-language/) slice by.

The bound models are part of the identity because a configuration can run
several. Two members of one configuration that agree on the root agent's model
and differ on a reviewer's are two arms of a study, and a cell reading only the
root model would merge them.

Every endpoint that enqueues a run refuses a launch naming a configuration the
launching account does not own. Counts are global, so an id recorded by an
account that cannot resolve it would satisfy a cell of somebody else's plan.

### A member that cannot be launched

A gg member stops being launchable when the configuration it names has been
deleted, when it leaves a launch slot unbound, or when it binds a model the
catalog can resolve no context window for. A harness member stops being
launchable when the catalog can resolve no
[list price](/components/core/metrics/#cost) for its model, and so does a gg
member binding such a model.

The matrix reports the reason on the cell as `unlaunchable`, and a launch pass
skips that cell and reports it, leaving the rest of the plan being filled.

## Which runs count

One rule decides which finished runs count toward a cell, on a plan and on a
ladder alike. A run that counts fills one of its cell's target runs, and on a
ladder it is evidence for the rung's gate.

| run state                                                              | class          | counts | on a ladder's gate   |
| ---------------------------------------------------------------------- | -------------- | ------ | -------------------- |
| `completed`                                                            | model result   | yes    | its validator rating |
| `catastrophic`, `timed_out`, `harness_error`, `limit_exceeded`, `hung` | model result   | yes    | a `broken` run       |
| `infrastructure`                                                       | infrastructure | no     | never read           |
| `canceled`                                                             | stopped        | no     | never read           |

A run of the model's own failure counts because the model had its attempt and
produced nothing that works. Leaving it out would have the cell relaunched for as
long as the model keeps failing it. A harness error is one of them: once its
automatic retries are used up, the last attempt is the model's result, it fills
one of the cell's runs, and nothing launches the cell again for it.

The backend retries a run that ends `infrastructure`, `catastrophic`,
`harness_error`, or `hung` automatically, up to the launch's
[`retryCount`](#the-retry-limit). The job records its retry in `job.retried_by`,
and the run of a retried attempt never counts: the attempt and its retry count
once, as whatever the last attempt became. The retry is enqueued, and the attempt
stamped, before the attempt's run is stored and before the attempt becomes
terminal, so no launch pass ever sees that run without the stamp, and none sees
a failed attempt whose retry is still to be enqueued.

### The retry limit

A plan and a ladder each carry a `retryCount`: the number of automatic retries
every run their launch passes enqueue gets. It defaults to `1`, ranges from `0`
to `10`, and a value above the range is clamped to `10`. Every job a launch pass
or a blocked cell's Retry enqueues carries it as its launch request's
`retryCount`, and an automatic retry repeats its attempt's launch request, so it
inherits the same count. A ladder snapshots the value at Run, and a plan reads
its own at each pass.

A launch by hand from the plan's Tests tab is a launch request the console
sends, and the console puts the plan's `retryCount` on it.

The retry limit is the whole allowance of a cell or a rung slot. A launch that
uses it up without a counted run [blocks](#a-blocked-cell) the cell, and the
plan or the ladder launches no replacement by itself.

### A cell's runs

A plan cell's runs are the first `runsPerCell` counted runs of the cell to land,
ordered by when each run finished, with the run id breaking a tie. A counted run
beyond that number is not the plan's. It stays an ordinary run everywhere else,
and nothing on the plan counts it, shows it, or queues it for review.

Taking the first to finish keeps a filled cell's runs stable: a run that
finishes later never changes which runs the cell holds. The order is by finish
time rather than by when the backend stored the run, so a run whose record
reaches the backend late, after a run that finished after it, takes its place
ahead of that run, and the cell's latest run drops out. A run that does not count,
such as an infrastructure failure, takes no place in the order, so the next
counted run takes the place instead. Raising `runsPerCell` takes in the next runs
in the same order, and lowering it lets go of the latest.

A run whose stored record this build can no longer decode still counts and keeps
its place, since it is the model's result all the same, and dropping it would
relaunch the cell. It cannot be opened, though, so it is never in the
[review queue](#the-scoped-review-queue) or in a cell's `unreviewed`, and
[the plan's runs](#the-plans-runs) leave it out, so the run breakdowns can total
fewer runs than the matrix counts.

A cell's jobs in flight are shown only while the cell still needs them, up to its
target less its runs. A cell holding its target shows none, so a cell never
reads more runs than its target. The jobs still occupy the limit of the plan or
ladder whose [origin](#attribution-which-plan-or-ladder-launched-a-run) they
carry, because the limit counts what that plan or ladder launched.

Every figure a plan reports is computed over the plan's runs: the matrix and its
roll-ups, the summary, the [review queue](#the-scoped-review-queue), and the run
breakdowns on the console's dashboard, which read
[the plan's runs](#the-plans-runs). A ladder dispatch takes each
[rung slot's runs](/components/backend/ladders/#a-rung-slots-runs) by the same
rule, under the rung's target.

### A blocked cell

A cell is **blocked** as soon as one of its jobs ends without a counted run and
with its automatic retries used up. Every launch pass skips a blocked cell and
reports it, and the console shows it blocked with a Retry action. With a
`retryCount` of `1`, an infrastructure failure costs two attempts and then
blocks the cell.

The block is read off the cell's jobs. A job is an **exhausted failure** when all
three of the following hold:

- it ended, and was not canceled, so a run cancelled by hand is launched again;
- it has no counted run;
- the backend did not retry it, so `job.retried_by` is null.

An exhausted failure is **replaced** once a launch of the cell is created after
it ended: a launch pass after a Retry, a launch by hand, or another plan's
launch. A job created before the failure ended does not replace it, whatever
that job goes on to do, and neither does a job created at the same instant. An
automatic retry belongs to the launch it retries, so it replaces nothing.

A cell is blocked while it is missing a run, counting its jobs in flight toward
its target, and holds an exhausted failure that is not replaced. With five runs
launched together, one that uses up its retries blocks the cell while the other
four are still running and after they complete, and nothing is launched in its
place. A blocked cell whose missing run arrives from elsewhere is filled, and a
filled cell is not blocked.

Retrying a blocked cell records the retry. Only jobs that ended after it are
read as exhausted failures, so the cell is launched again, and the next launch
to use up its retries blocks it again. On a plan the jobs read are every job of
the cell, matching the global counts. On a ladder they are the jobs the dispatch
launched for that rung and climber (see
[a blocked climber](/components/backend/ladders/#a-blocked-climber)).

## The matrix

`GET /coverage-plans/{id}/coverage` resolves the plan's group pointers, crosses
the cases with the combinations, and returns one cell per pair:

| field                     | meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `desired`                 | the target, from the plan's `runsPerCell`                        |
| `runIds`                  | the [cell's runs](#a-cells-runs), in the order they finished     |
| `counted`                 | how many runs the cell holds, at most `desired`                  |
| `inFlight`                | jobs of the cell in flight globally, at most `desired - counted` |
| `pending`                 | the subset of `inFlight` the queue is deliberately holding back  |
| `unreviewed`              | the cell's completed runs you have not reviewed                  |
| `remaining`               | `desired - (counted + inFlight)`                                 |
| `filled`                  | whether `counted` has reached `desired`                          |
| `blocked`                 | whether the cell is [blocked](#a-blocked-cell)                   |
| `latestVersion` / `stale` | whether a newer version of the case has been ingested            |
| `unlaunchable`            | why no launch pass can launch this cell, or null                 |

`pending` is a subset of `inFlight` rather than an addition to it, and is
surfaced separately so that a plan at its limit with nothing running is
distinguishable from a wedged dispatcher. A job sits `pending` when its harness
is at its [parallelism cap](/components/core/harnesses/#per-harness-configuration),
or when it is a [game jam](/testing/game-jam/overview/#repeat-runs) run of a model
that already has a jam run in flight.

`inFlight` is counted by the same identity as `counted`. A job records its case
pin's engine beside its harness and its model when it is enqueued, so the
in-flight count is one grouped query over the job table.

A cell counts against the pinned version and the pinned engine only. A case
version is frozen once it has runs, so an older minor is a different
specification whose runs are not comparable, and a run on another engine was
built against another runtime. `stale` flags that a newer version exists without
moving the target. A run recorded with no engine counts as a `none` run.

The matrix also reports the plan's roll-ups: cells filled, cells total, runs
done (the sum of every cell's `counted`), runs total, runs in flight against the
plan's limit, runs pending, runs unreviewed, cells blocked, and whether the plan
[needs attention](#needs-attention). Runs in flight
against the limit are the plan's own jobs, which the limit counts until they
finish. It is the one figure that can include runs beyond the plan's: a job
whose cell other runs filled in the meantime is still in flight against the
limit, though its run will not be one of the cell's runs, so the figure can
exceed the sum of the cells' `inFlight`, and the console says so beside it.

### The plan's runs

`GET /coverage-plans/{id}/runs` returns the summary card of every run the plan's
cells hold, in the matrix's cell order and in landing order within a cell. It is
what the console's run breakdowns are computed from, so they describe exactly the
runs the matrix counts, less any run this build can no longer decode (see
[a cell's runs](#a-cells-runs)).

## Emission order is execution order

Each job takes a monotonic `queue_seq` when it is inserted, and the
[dispatcher](/components/dispatcher/overview/#queue-order) claims strictly in
ascending order, passing over only a job whose harness is at its cap. The
sequence in which a launch pass emits cells is therefore the sequence in which
the runs start, and nothing in the dispatcher, the driver, or the queue needs to
know a plan exists.

`outerAxis` chooses that sequence:

- **`case`**, the default, finishes one case across every combination before
  starting the next case. Every model's attempt at one case arrives together.
- **`combination`** finishes one combination across every case before starting
  the next. One model's whole run of the plan arrives first.

Within a cell the repeats are always emitted together.

## The runs-in-flight limit

A plan or a ladder never fires its whole shortfall at once by default. It keeps
at most _N_ of its own jobs in flight, so it shares the global FIFO queue fairly
with everything else waiting on it. Its own jobs in flight are the jobs whose
[origin](#attribution-which-plan-or-ladder-launched-a-run) names it and whose
state is `queued`, `pending`, `dispatched`, `starting`, or `running`. Completed
runs never occupy the limit, reviewed or not.

The account's default is held by `GET`/`PUT /coverage-settings` as
`inFlightLimit`, a bound of ten runs until the account chooses one. A plan or a
ladder may override it. The limit is a tagged shape rather than a bare number:

```json
{ "kind": "bounded", "runs": 10 }
{ "kind": "unbounded" }
```

A **bounded** limit stops a launch pass once that many of the plan's or ladder's
jobs are in flight, and its bound is clamped to a ceiling of 500 runs. An
**unbounded** limit launches every missing cell in one pass, and the per-cell
target and the harness parallelism preference still apply. A bound of `0`
launches nothing.

The override is nullable, and null is not zero. Null inherits the account's
setting, a bound of `0` launches nothing, and unbounded launches everything. Each
is a distinct instruction.

## Filling a plan

A plan launches nothing until its owner asks it to fill. Filling is a state of
the plan that survives a backend restart:

1. The owner presses All missing (`POST /coverage-plans/{id}/fill`). The plan
   starts filling, and the backend runs a launch pass that queues missing runs up
   to the plan's limit. Pressing it again while the plan fills runs another pass.
2. Each of the plan's runs finishes. The backend runs another launch pass, which
   launches more missing runs into the room the finished run left.
3. A cell whose launch used up its retries without a counted run becomes
   [blocked](#a-blocked-cell). Launch passes skip it until its owner retries it.
4. Filling ends by itself once every launchable cell is filled. Halt and halt all
   end it at once.

A plan that is filling stays filling while a blocked cell remains, so a Retry
relaunches that cell under the limit.

### Needs attention

A filling plan reports `needsAttention` while all of the following hold:

- none of the plan's own jobs is in flight;
- every cell is filled, blocked, unlaunchable, or has the jobs in flight it
  still needs;
- at least one cell is blocked.

Nothing a launch pass can launch is left, so the plan is waiting on its owner.
It is a reading of a filling plan and changes nothing else about it: the plan
stays filling, Halt ends the fill, and a cell's Retry or a run arriving for one
of its cells resumes it. The backend derives it on the matrix and on
`GET /coverage-plans/summary`, the two reads that resolve the plan's cells.

A write to a filling plan's declaration or limit runs a launch pass, so a cell
the edit added is filled too. Raising runs per cell is how a plan gathers more
evidence; a plan has no re-run.

### A launch pass

The algorithm is the same for plans and ladders:

1. Walk the cells in the configured
   [outer-axis order](#emission-order-is-execution-order).
2. Skip any cell already at its target, counting `counted + inFlight`.
3. Skip any cell whose combination
   [cannot be launched](#a-member-that-cannot-be-launched), and any
   [blocked](#a-blocked-cell) cell, reporting each.
4. Defer any cell whose harness is already at its
   [parallelism cap](#harness-parallelism-comes-first).
5. Emit whole cells, all of a cell's missing repeats together, until the plan's
   or ladder's jobs in flight reach its limit. An unbounded limit is never
   reached, so every missing cell is emitted in one pass.
6. Walk the deferred cells, in the same order, until the limit is reached.

Step 5 overshoots the limit by up to one cell, on purpose. A cell's repeats are
compared against each other, so the check happens at the boundary between cells
rather than inside one.

Every run a launch pass enqueues carries its cell's whole pin: the slug, the
version, the variant, and the engine, and the plan's or the dispatch's
[`retryCount`](#the-retry-limit). Both combination shapes carry it, so a gg
cell's runs are built on the cell's engine exactly as a harness cell's are.

A launch pass reports the limit in force, the jobs in flight it observed, the
cells it launched in emission order with their job ids, and the cells it could
not launch with why.

### Harness parallelism comes first

The queue will not start a run whose harness is already at its
[maximum parallelism](/components/core/harnesses/#per-harness-configuration), so
a walk that ignored the cap would hand the whole limit to the first harness it
met and leave every other harness in the plan idle.

The walk therefore prefers cells that can actually start. A cell whose harness
has no free slot is set aside, the cells behind it on idle harnesses are emitted
first, and the set-aside cells are picked up in a second pass over whatever room
is left. Within one harness the plan's order is preserved, and only the
interleaving between harnesses changes.

gg is one lane like any other harness: every configuration's runs share the gg
cap, because what a cap bounds is how many runs of a harness execute at once.

Capacity is read globally and across every job state, including states that
occupy no slot. A run merely queued for a harness consumes that harness's cap
before anything enqueued after it, whoever queued it.

### When launch passes run

There is no background daemon. The backend runs a plan's launch pass when the
owner starts filling it, edits it while it fills, or retries a blocked cell, and
when a job reaches a terminal state:

- A job that **succeeded** or **failed** feeds every filling plan whose cells
  include the job's cell, and every running ladder dispatch one of whose rung
  slots is that cell. A failed job that enqueued an automatic retry feeds
  nothing, since the retry takes its place in flight.
- A **canceled** job feeds the same plans and dispatches. It was in flight, so
  it held its cell for every plan and dispatch counting that cell and held a
  place under its plan's or dispatch's limit. Once it is gone, the
  cell is missing again and nothing else would notice, because a canceled job
  never finishes. This covers a cancel by hand, a plan's halt or a ladder's stop
  reaching another plan's cells, and a gate's early stop. A plan that was just
  halted, or a dispatch that was just stopped, launches nothing, because its fill
  or dispatch has ended.
- The [global bulk-cancel endpoints](/components/backend/api/#stopping-runs-in-bulk)
  feed nothing. They stop the cabinet, and refilling the queue they just emptied
  would undo that. A plan they leave filling with nothing in flight resumes when
  its owner presses All missing again.

The launch pass runs as the plan's owner after the job's status is stored, so a
failed pass never fails the driver's report. Once the definition store is
servable after a start, the backend runs one launch pass for every filling plan.

### One launch pass at a time

Launch passes are serialized per plan or ladder by a leased claim on its row. A
pass that finds the claim held leaves a request for another pass and tries the
claim once more. The holder checks for a request after it releases the claim,
so a run that lands during a pass is never left unseen. A holder serves at most
five passes, and a request still standing after the last one, or after a pass
that failed, is served by a fresh launch pass.

The claim carries a two-minute lease, so a pass that dies before releasing it
frees the row when the lease expires. The backend is the single coordinator, so
it releases every claim before it serves.

A pass recomputes everything from the database, the limit included, so a second
pass after the first one's launches have landed yields the next slice of work,
and a pass served for a request launches under the limit as it stands then.

### Launching a cell by hand

The Tests tab launches one more run of a cell, or the cell's whole shortfall, at
once. A launch by hand is the owner's explicit decision, so it ignores the limit.
It is attributed to the plan, so it occupies the plan's limit while it runs and
a halt reaches it.

## The scoped review queue

`GET /coverage-plans/{id}/queue` returns the plan's completed runs the requesting
account has not reviewed, in the order its cells are emitted rather than
newest-first, so a case's repeats can be labelled side by side. Only the
[cell's runs](#a-cells-runs) are offered, so a run beyond a cell's target never
reaches the queue. The queue is
capped rather than paginated, because it exists to be walked from the front, and
reports `truncated` when there is more behind it.

The queue is informational. Nothing on it launches or holds back a run.

Runs of [auto-graded](/testing/performance/overview/) test types never appear.
They are graded by machine, so listing them would produce a worklist item nobody
can act on.

## Halting

Two controls, distinct because stopping carries two different costs:

- **`halt`** ends the plan's filling, then cancels the plan's `queued` and
  `pending` jobs. Those jobs have no driver and have spent nothing, so it needs
  no confirmation. This is the common case.
- **`halt all`** does the above, plus `dispatched`, `starting`, and `running`.
  Those runs are partly or wholly paid for, so it is confirmed before it runs.

Both reuse the same atomic cancel transition a single `POST /jobs/{id}/cancel`
uses, reach only jobs whose origin names this plan, and report how many jobs they
cancelled, so "the queue was already empty" and "nothing I launched was found"
are distinguishable.

A launch pass checks that its fill is still the plan's filling one immediately
before it enqueues, and again after. A halt that lands during a pass therefore
never leaves a refilled queue behind: the pass either enqueues nothing or cancels
the jobs it just enqueued, and only those. An automatic retry is checked the same
way: a retry enqueued while the halt swept is cancelled once it exists.

The [global bulk-cancel endpoints](/components/backend/api/#stopping-runs-in-bulk)
sweep the same states with no origin filter, stopping the cabinet rather than one
plan.

## Attribution: which plan or ladder launched a run

A job records two nullable columns:

- **`user_id`**, the account that launched it.
- **`origin`**, the plan or ladder that launched it, or null for a launch by
  hand from the run form.

An origin takes one of three forms:

| origin                                    | launched by                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `plan:<planId>`                           | a launch by hand from the plan's Tests tab                                                       |
| `plan:<planId>/<fillId>`                  | a launch pass while the plan was filling                                                         |
| `ladder:<ladderId>/<dispatchId>/<rungId>` | a launch pass of one [dispatch](/components/backend/ladders/#a-configuration-and-its-dispatches) |

The prefix matters, because plan and ladder ids are minted independently and
nothing stops them colliding. A plan mints a fresh `fillId` each time it starts
filling, and a ladder mints a `dispatchId` for each Run. A plan's halt and its
limit reach every job whose origin names the plan in either form. A run launched
from the run form stays out of every scoped halt.

An automatic retry inherits the original launcher and origin, so a retried run
stays inside the limit that launched it and remains reachable by its halt. A
retry is withheld when its origin no longer launches anything: a fill that has
ended, or a dispatch that is no longer the ladder's running one. A run launched
by hand, from the run form or a plan's Tests tab, retries as always.

Coverage counting ignores both columns, on a plan and on a ladder alike. A
ladder dispatch reads its own origin only for its limit, its Stop and its
failing block.

## Endpoints

The plan surface, all auth-gated and keyed to the token's account, is specified
in the [HTTP API](/components/backend/api/#coverage-plans-and-ladders): groups
and plans, the matrix, the account-wide settings, filling, the per-cell retry,
the scoped queue, and the two halting controls. The ladder counterparts are on
the [Ladders](/components/backend/ladders/) page.
