---
title: Ladders
---

A **ladder** is an ordered series of test cases that
[combinations](/components/backend/coverage/#combinations) climb one step at a
time, stopping at the first step they fail. Where a
[coverage plan](/components/backend/coverage/) asks "have I run this yet?" and
treats its cells as an unordered set, a ladder asks "how far does this model
get?" and treats its steps as a sequence: rung three is harder than rung two, so
the rung a model stops at is the result.

A ladder is a sibling of the coverage plan rather than a mode of it. It shares
the plan's [counting rules](/components/backend/coverage/#which-runs-count), the
[runs-in-flight limit](/components/backend/coverage/#the-runs-in-flight-limit),
the [launch pass](/components/backend/coverage/#a-launch-pass) and its claim, and
the same `coverage_group` pointers for its members. Read the
[coverage plan page](/components/backend/coverage/) first. This page covers only
the difference.

## A configuration and its dispatches

A ladder is a configuration, and it does nothing by itself. The configuration
holds:

- a name;
- the [rungs](#rungs), each a validator-rated pinned case;
- the [climbers](#climbers), as combination groups and one-off combinations;
- the [gate](#the-gate): its floor, its threshold, `unloadedCountsAsBroken`, and
  `earlyStop`;
- the runs per rung, which a rung may override;
- the runs-in-flight limit, or null to inherit the account's;
- the climb order, `outerAxis`.

Pressing Run starts a **dispatch** of the configuration as it stands at that
moment. Editing the configuration never touches a running dispatch, and applies
to the next Run.

### How a ladder dispatch flows

1. The owner presses Run. The backend snapshots the configuration: the rungs and
   their targets, the climbers resolved from the groups and one-offs, the gate,
   the climb order, and the limit in force. It mints a dispatch id and runs a
   launch pass.
2. A launch pass evaluates the gate on each climber's current rung over the runs
   that [already exist](#a-rung-slots-runs) for it, and launches only the runs
   the rung is still missing, up to the limit.
3. Each run completes and its validators rate it at push time.
4. Every finished run of a rung slot's cell makes the backend run another launch
   pass.
5. A climber that passes its rung moves to the next one, which the same pass
   evaluates and launches. A climber that fails a rung stops there.
6. The dispatch is **Finished** once every climber has completed or failed and
   none of its runs is in flight. The owner may stop it earlier.

A ladder holds at most one running dispatch, so Run is unavailable while one is
running. A Run after a dispatch ended replaces it.

### A rung slot's runs

A dispatch counts runs the way a
[plan counts them](/components/backend/coverage/#counts-are-global-reviews-are-labels):
a rung and a climber form one coverage cell, and the slot's runs are
[that cell's runs](/components/backend/coverage/#a-cells-runs) under the rung's
target. They are the first `target` counted runs of the cell to finish, whoever
launched them and whenever: an earlier dispatch, a coverage plan, a launch by
hand, or this dispatch. The gate, the progress and the review queue all read
these runs.

A dispatch therefore launches only what a rung is missing. A rung whose target
the existing runs already meet is decided by the first launch pass with nothing
launched, and a dispatch decided entirely by existing runs finishes without
launching a run. Running the same configuration again reads the same runs and
reaches the same standing. It launches runs only where a target was raised or a
cell is short of its target.

A slot's jobs in flight are counted the same way: every job of the cell in
flight, whoever launched it, up to what the slot still needs. A run someone else
has queued for the cell holds the slot's place, and the dispatch waits for it.

A slot reads its cell once its climber reaches the rung. A slot the climber has
not reached holds no runs and no jobs in flight.

Two rungs that pin the same case at the same version, variant and engine are the
same cell for a climber, so both read the same runs.

A launch pass stamps every job it enqueues with the origin
`ladder:<ladderId>/<dispatchId>/<rungId>`. The origin is what the dispatch's
runs-in-flight limit, its Stop, and its
[failing streak](#a-blocked-climber) act on, and it plays no part in which runs
count.

### No history

The ladder keeps only its latest dispatch: enough to show its progress while it
runs and its final standing until the next Run. Pressing Run replaces it. The
runs themselves are the results, and stay in the run list like any run.

### Stopping a dispatch

- **Stop** ends the dispatch and cancels the `queued` and `pending` jobs it
  launched. Runs already dispatched or running finish.
- **Stop and cancel running** also cancels the `dispatched`, `starting`, and
  `running` jobs it launched. Those are partly or wholly paid for, so the
  console confirms it first.

Both report how many jobs they cancelled. A stopped dispatch launches nothing
more, and its status is **Stopped**.

A launch pass checks that its dispatch is still the ladder's running one
immediately before it enqueues, and again after. A Stop that lands during a pass
therefore never leaves a refilled queue behind: the pass either enqueues nothing
or cancels the jobs it just enqueued, and only those. An automatic retry is
checked the same way: a retry enqueued while the Stop swept is cancelled once it
exists.

Deleting a ladder deletes its dispatch and leaves the dispatch's jobs alone,
since they record the ladder only as their origin. Cancelling them as well means
stopping first.

## Rungs

A **rung** is exactly one
[pinned case](/components/backend/coverage/#pinned-cases): a slug, an exact
version, a variant, and the engine the rung's runs are built on, with an absent
engine meaning `none`. The rungs' order, low to high, is the climb.

A rung's pin is its identity within the climb, so one ladder holds the same case
at the same version and variant twice when the two pins name different engines.
Clearing a case with a runtime underneath is a different achievement from
clearing it with nothing.

Each rung carries a stable opaque id, minted when the rung is added and never
reused. A dispatch's snapshot and every job it launches reference that id.
`POST /ladders/{id}/rungs/order` takes a permutation of those ids and nothing
else, and edits go through `PUT /ladders/{id}`.

A rung may override the ladder's `runsPerCell` with its own `runs`, so one
pivotal step can demand more evidence without making the whole climb more
expensive. Ladders are capped at fifty rungs.

The editor flags a rung whose pinned version is no longer the newest ingested
one. A Run uses whatever version the configuration pins.

### A rung must be validator-rated

Every rung pins a [validator-rated](/terminology/#validator-rated) case version,
because the gate reads only the ratings validators decide. Three kinds of case
version are rejected when a ladder is saved and again when it is run, each with
an explicit message:

- A **legacy** version, whose functional rating only a reviewer supplies, so its
  runs would never be rated without one.
- A **[performance](/testing/performance/overview/)** case, which is graded on
  its own scale and records no functional rating.
- A **[game jam](/testing/game-jam/overview/)** case, which is reviewed on a
  graded category scale and records no domain ratings.

All three belong in a coverage plan, and the error says so.

A rung pinned to a version the backend has not ingested, or to an engine the
pinned version does not declare, is allowed. The driver reports that far better
than an author-time check can.

## Climbers

The combinations that climb are called **climbers**, and they are referenced
through the same `kind = "combo"` coverage groups a plan uses, plus any one-off
combinations pinned on the ladder. One saved set of models therefore drives both
a plan and a ladder. A climber is either shape a
[combination](/components/backend/coverage/#combinations) takes, so a
[gg configuration](/gg/configurations/) climbs beside a third-party harness and
is measured against the same gate.

Every climber carries a **key**, the canonical text a dispatch records its
climber state against. A harness climber's key is its `harness|model|provider`
triple, and a gg climber's is the configuration it names and the models it binds.
The key has to distinguish two gg climbers running one configuration on different
models, since those are the two arms a ladder exists to separate.

A dispatch climbs its climbers in their resolved declaration order: the
referenced groups' members in group order, then the one-offs. A gg climber's
configuration is resolved when each of its runs launches.

A dispatch finds a climber's runs by the climber's **cells**: the harness, the
launch model, and for a gg climber the configuration's id and the models its
bound set runs. The cells are pinned on the climber when it first resolves, at
Run or at the first launch pass that can resolve it. They are never resolved
again, so editing or deleting a gg configuration mid-dispatch cannot hide the
runs the dispatch already read. Those runs keep counting, and a climber with
runs in flight keeps running. A climber whose configuration now resolves to
other cells is held [`unlaunchable`](#where-a-climber-stands), since its new runs
would land where the dispatch never looks. Restoring the configuration, or a
Stop and a new Run, resolves it.

Two declarations that resolve to the same cells are one climber. A Run stores
the first and drops the other, so a dispatch never launches or judges one set of
runs twice. A climber that first resolves mid-dispatch to cells another climber
already holds is held `unlaunchable`.

### Where a climber stands

Within a dispatch a climber is in one of four statuses:

| status      | console wording           | meaning                                           |
| ----------- | ------------------------- | ------------------------------------------------- |
| `running`   | Running rung X            | its current rung is undecided and can be launched |
| `blocked`   | Blocked at rung X: reason | its current rung is undecided and cannot progress |
| `failed`    | Failed at rung X          | it failed rung X                                  |
| `completed` | Completed                 | it passed every rung                              |

A `blocked` climber carries a reason naming its fix:

| reason         | cause                                    | fix                       |
| -------------- | ---------------------------------------- | ------------------------- |
| `unlaunchable` | the combination cannot be launched       | fix the cause, then Retry |
| `failing`      | the rung's recent runs all failed        | fix the cause, then Retry |
| `unrated`      | completed runs carry no validator rating | re-push the runs, or Stop |

A blocked climber keeps its dispatch running, so a Retry resumes the climb
within it. A dispatch whose blocked climbers cannot be helped is ended with Stop.

### Rung slots

The unit every rung count is reported in is the **rung slot**: one climber on one
rung. A dispatch of three climbers over four rungs has twelve rung slots, and each
is in one of six states:

| slot status | meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `running`   | the climber's current rung, undecided, with runs launched or waiting for room |
| `blocked`   | the climber's current rung, undecided and [blocked](#where-a-climber-stands)  |
| `passed`    | the gate passed it                                                            |
| `failed`    | the gate failed it                                                            |
| `pending`   | not reached yet, while the dispatch is running                                |
| `skipped`   | never to run: the climber failed an earlier rung, or the dispatch ended first |

When a dispatch is stopped, every slot that was `running`, `blocked`, or
`pending` becomes `skipped`.

### A blocked climber

A climber's current rung is blocked as `failing` when the three most recent
terminal jobs this dispatch launched for it all failed with no run that counts, as described
under [a blocked cell](/components/backend/coverage/#a-blocked-cell). A job whose
run ended on the model's own failure counts toward the gate, so it breaks the
streak.

`POST /ladders/{id}/climbers/retry` retries a climber blocked as `failing` or
`unlaunchable`. The retry is recorded on the dispatch's climber, only jobs that
ended after it count toward the streak, and the launch pass that follows
relaunches the rung under the dispatch's limit. A retry of an `unlaunchable`
climber resolves its combination again, which helps once its configuration or
its model's catalog entry has been fixed.

## The gate

There is exactly one rule, parameterised:

```text
pass when count(runs on this rung rated FLOOR or better) >= THRESHOLD
```

- **`floor`** is a [rating](/terminology/#rating): `flawless`, `great`,
  `passable`, `scuffed`, or `broken`. A run rated at the floor or better passes.
- **`threshold`** is either an absolute run count or a fraction of the rung's
  runs, compared as `count >= fraction * runs`.

A rung's verdict is `passed` or `failed`. An undecided rung has no verdict.

The gate is stored per ladder rather than per rung. A ladder is one question
asked of an ordered series of cases, so the bar it sets is the ladder's, and a
rung only varies how many runs it takes to answer.

The default gate is floor `scuffed` with a threshold count of `1`: one playable
run passes the rung, and failing it takes every run broken.

### What the gate reads

The gate reads the [slot's runs](#a-rung-slots-runs). A completed run is read
at its validator rating: the functional rating the
[validators decide](/testing/end-to-end/evaluation/#the-validator-decided-functional-rating)
from the run record and the case version's checklist, with the toolchain gate on
top. A run of the model's own failure is read as `broken`, whatever
`unloadedCountsAsBroken` says.

The run's stored `rating` folds in every reviewer's checklist overrides, so the
gate never reads it, and it never reads a review. The backend lifts the validator
rating onto the run row as `validator_rating` when the run is pushed, and a
re-push rewrites it.

A completed run whose build never loaded counts as `broken` outright when the
ladder's `unloadedCountsAsBroken` is on, which it is by default.

A completed run with no validator rating, which happens when the backend did not
hold the case version when the run was pushed, counts as unrated. It can still
pass later, so the gate treats it as a possible pass in both directions, and a
rung left with only unrated runs short of its bar is `blocked` as `unrated`.

### When a rung is decided

A rung is judged against the number of runs it will finish with:

```text
final   = max(target, counted + inFlight)
pending = final - counted
```

`target` is the rung's runs, `counted` the number of the
[slot's runs](#a-rung-slots-runs), and `inFlight` the slot's jobs in flight.
Both are read up to the target, so `final` is the target. A fractional threshold
is measured against `final`, so the bar does not drift as runs land one by one.

`earlyStop` is off by default. With it off, a rung is undecided while `pending`
is above zero, so it completes every run it started even when the outcome is
already certain, because the runs are evidence as much as they are a gate.

With `earlyStop` on, the gate decides the moment the outcome is certain, counting
every pending run as a possible pass and as a possible failure. It passes only
when the runs already counted clear the bar, fails only when they cannot clear it
even if every pending and unrated run passes, and is undecided in between. The
launch pass that records the decision cancels the `queued` and `pending` jobs
the dispatch launched for the slot. A job already dispatched or running
finishes, and its run is kept.

Either way an outcome never has to be taken back as more evidence lands. The
evidence behind any answer is reported as a `tally`: counted, rated, unrated,
passing, pending, in flight, and the number of passing runs required.

## Launching runs

A running dispatch launches its runs in a launch pass: it records every verdict
the gate can now decide, then enqueues what each current rung is missing, its
target less its runs and its jobs in flight, up to the dispatch's limit. A
launch pass of a ladder is the plan's
[launch pass](/components/backend/coverage/#a-launch-pass) with one restriction:
only a climber's current rung is ever launched. Running rung five for a model
that failed rung two would answer a question the dispatch has already answered.

`outerAxis` selects which loop is outer, with the same
emission-order-is-execution-order mechanism a plan uses:

- **`rung`**, the default, brings every climber up one rung before anyone moves
  on, which is what makes a ladder comparable across models.
- **`combination`** takes one climber as far as it gets before starting the next,
  answering "how far does this model get?" soonest.

The dispatch's runs in flight are the jobs it launched that are `queued`,
`pending`, `dispatched`, `starting`, or `running`, across every rung. The limit
caps those alone. A bound of `0` launches nothing, so a dispatch under it climbs
only as far as existing runs take it.

The backend runs a launch pass of the running dispatch when it is started, when
one of its climbers is retried, when a job of one of its rung slots' cells
reaches a terminal state, and once at startup. A job feeds every running
dispatch that holds its cell, whoever launched the job, as it feeds every
filling plan. A failed job that enqueued an automatic retry feeds nothing.

A canceled job feeds a dispatch as it feeds a plan, as described under
[when launch passes run](/components/backend/coverage/#when-launch-passes-run),
so a run cancelled by hand is launched again. The pass runs as the ladder's
owner after the job's status is stored, so a failed pass never fails the
driver's report.

Every pass launches under the limit in the snapshot of the dispatch it reads. A
pass that serves a request left during another pass can be reading a newer
dispatch than the one that took the claim, and launches it under that
dispatch's own limit.

A launch pass that finds every climber completed or failed and none of the
dispatch's own jobs in flight marks the dispatch Finished.

## Progress

`GET /ladders/{id}/progress` reports the configuration's rungs, the latest
dispatch, and every climber of that dispatch with its status, its blocked reason,
its current rung's cell and tally, and the status of each of its rung slots.
Progress is a read. Verdicts the gate has resolved that no launch pass has
written down yet are computed live and persisted by the next pass.

A dispatch reports its status, its rung-slot counts in each slot status, and its
runs:

- **total** is the sum over rung slots of the rung's target runs;
- **done** is the runs that need no more executing, summed per slot as below;
- **in flight** is the jobs the dispatch launched that are still in flight.

| slot status                   | runs done                        |
| ----------------------------- | -------------------------------- |
| `running`, `blocked`          | `counted`                        |
| `passed`, `failed`, `skipped` | `target - min(launched, target)` |
| `pending`                     | `0`                              |

`counted` is the number of the [slot's runs](#a-rung-slots-runs), so a run that
existed before the dispatch started is done from its first pass. `launched` is
the jobs the dispatch launched for the slot that are still in flight. A decided
or skipped slot needs no more runs, so its whole target is done once those
finish. When done equals total, nothing is left to execute in the dispatch.

A ladder with no dispatch reports its status as Not run yet. The ladder's status
is one of Not run yet, Running, Finished, or Stopped.

### Reviewing a dispatch's runs

`GET /ladders/{id}/queue` returns the completed runs among the latest
dispatch's [slot runs](#a-rung-slots-runs) that its owner has not reviewed, in
the ladder's own order, so they can be given an aesthetic rating and a writeup.
A run the dispatch read counts here the same as one it launched, and a run two
rungs share is listed once, under the lower rung. Progress reports their count
as `runsUnreviewed`. The queue neither blocks nor feeds the climb.

### Publishing a dispatch's runs

A rung is a validator-rated case, so a run a dispatch launches
[publishes itself](/components/core/results/#automatic-publishing) when it
completes. Every launch pass of a running dispatch also applies that rule to the
[slot runs](#a-rung-slots-runs) it reads, so a completed run the dispatch counts
is published even when another launch produced it and left it unpublished. A
run beyond a slot's target, a run of a rung the climber has not reached, and a
run that ended on the model's own failure are left as they are.

## Endpoints

The ladder surface is specified in the
[HTTP API](/components/backend/api/#ladders), alongside the coverage-plan
endpoints it mirrors.
