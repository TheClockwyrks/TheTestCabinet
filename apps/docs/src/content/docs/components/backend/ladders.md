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

A ladder is a sibling of the coverage plan rather than a mode of it, and shares
the plan's machinery wholesale: global counting, the buffer target and the
launch algorithm, halt and halt all, the emission-order-is-execution-order
mechanism, and the same `coverage_group` pointers for its members. What it adds
is an order, a gate, per-combination progress, and a climb that launches itself.
Read the [coverage plan page](/components/backend/coverage/) first. This page
covers only the difference.

## How a ladder flows

A ladder is a fully automatic test of how far each model gets. The validators
decide every run's functional rating, the gate reads those ratings, and the
backend launches the next rung itself. Nobody has to review anything for a climb
to move.

1. The owner enables the ladder. The backend launches each climber's first rung.
2. Each run completes and its validators rate it at push time.
3. Every finished run of one of the ladder's cells makes the backend evaluate the
   gate on each climber's current rung.
4. Once the rung's runs meet the gate's threshold, the climber passes the rung
   and the backend launches its next one.
5. A climber continues until it passes every rung and is `completed`, or fails a
   rung and is `failed` there.

The validators are assumed correct, so a failed rung is the climber's result for
that version of the case. The gate's verdict governs the climb, and the owner's
controls decide only whether and how fast a climber runs.

Reviews are optional and come after the fact. A reviewer may label a run's
aesthetic rating, write it up, or override checklist verdicts, and none of it
gates or moves a climb.

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
reused, rather than a positional identifier. Rungs get reordered and get bumped
to a newer version of their case, and every recorded verdict references this id,
so a positional identifier would reattribute a climber's history to a different
case the moment the ladder was rearranged. `POST /ladders/{id}/rungs/order` takes
a permutation of those ids and nothing else, and edits go through
`PUT /ladders/{id}`.

A rung may override the ladder's `runsPerCell` with its own `runs`, so one
pivotal step can demand more evidence without making the whole climb more
expensive.

Ladders are capped at fifty rungs.

### A rung must be validator-rated

Every rung pins a [validator-rated](/terminology/#validator-rated) case version,
because the gate reads only the ratings validators decide. Three kinds of case
version are rejected at author time with an explicit message:

- A **legacy** version, whose functional rating only a reviewer supplies, so its
  runs would never be rated without one.
- A **[performance](/testing/performance/overview/)** case, which is graded on
  its own scale and records no functional rating.
- A **[game jam](/testing/game-jam/overview/)** case, which is reviewed on a
  graded category scale and records no domain ratings.

All three belong in a coverage plan, which wants runs to exist rather than
verdicts to compare, and the error says so.

A stored ladder may still hold such a rung, since the check runs only when a
ladder is saved. It stays readable, and progress reports the rung
`supported: false`. The ladder never launches it, and a climber that reaches it
without a recorded verdict stands there as `blocked` with the reason
`unsupportedRung`. Replacing the rung with a validator-rated version, or removing
it, resumes the climb.

A rung pinned to a version the backend has not ingested, or to an engine the
pinned version does not declare, is allowed. The driver reports that far better
than an author-time check can.

## Climbers

The combinations that climb are called **climbers**, and they are referenced
through the same `kind = "combo"` coverage groups a plan uses, plus any one-off
combinations pinned on the ladder. One saved set of models therefore drives both
a plan and a ladder, and editing the group reshapes both. A climber is either
shape a [combination](/components/backend/coverage/#combinations) takes, so a
[gg configuration](/gg/configurations/) climbs beside a third-party harness and
is measured against the same gate.

Every climber carries a **key**, the canonical text a ladder stores its steering
and its verdicts against. A harness climber's key is its `harness|model|provider`
triple, and a gg climber's is the configuration it names and the models it binds.
The key has to distinguish two gg climbers running one configuration on different
models, since those are the two arms a ladder exists to separate.

Progress is stored per climber rather than as one ladder-wide pointer. Adding a
model to a ladder that has been running for a month starts it at rung one while
everyone else carries on from where they were.

Each climber also carries steering, set through `POST /ladders/{id}/climbers`:

- **`priority`**, climb-order weight, higher first. It pushes one model to the
  front of the launch order without reordering the ladder, which would change
  what every other climber is measured against.
- **`focused`**, a "watch this one" flag, and the tiebreak between equal
  priorities.
- **`paused`**, stop this climber where it stands. A pause decides no rung and
  cancels nothing, so resuming continues the climb from exactly where it
  stopped. It stops one model's climb, where disabling the ladder stops them all.

A combination with no steering row sorts as priority zero, unfocused, so a newly
added model takes its place at the back without anything having to be written for
it.

### Where a climber stands

`GET /ladders/{id}/progress` reports one of five statuses per climber:

| status      | meaning                                                         |
| ----------- | --------------------------------------------------------------- |
| `running`   | the current rung is undecided and its runs can still launch     |
| `blocked`   | the current rung is undecided and nothing the ladder does helps |
| `failed`    | the current rung was failed                                     |
| `paused`    | stopped by the owner                                            |
| `completed` | every rung passed                                               |

A `blocked` climber carries a `blocked` reason naming its fix:

| reason            | cause                                     | fix                                   |
| ----------------- | ----------------------------------------- | ------------------------------------- |
| `unsupportedRung` | the rung's version is not validator-rated | replace or remove the rung            |
| `unlaunchable`    | the combination cannot be launched        | fix or drop the combination           |
| `failing`         | the rung's recent runs all failed         | fix the cause, then retry the climber |
| `unrated`         | completed runs carry no validator rating  | re-push the runs, or replace the rung |

See [a rung must be validator-rated](#a-rung-must-be-validator-rated),
[a member that cannot be launched](/components/backend/coverage/#a-member-that-cannot-be-launched),
and [a failing rung](#a-failing-rung). A paused climber keeps its `blocked`
reason, so the fix stays visible while it is paused. A climber whose combination
cannot be launched also carries that reason in `unlaunchable`, on every status,
so the reason travels with the climber rather than only with the launch pass that
skipped it.

Progress also counts the climbers in each status (`climbersRunning`,
`climbersCompleted`, `climbersFailed`, `climbersBlocked`, `climbersPaused`), so a
summary never re-derives them.

Progress is a read. Verdicts the gate has resolved but no launch pass has written
down yet are computed live and flagged `recorded: false`, and are persisted by
the next launch pass.

## The gate

There is exactly one rule, parameterised:

```text
pass when count(runs on this rung rated FLOOR or better) >= THRESHOLD
```

- **`floor`** is a [rating](/terminology/#rating): `flawless`, `great`,
  `passable`, `scuffed`, or `broken`. A run rated at the floor or better passes.
- **`threshold`** is either an absolute run count or a fraction of the rung's
  completed runs, compared as `count >= fraction * completed`.

A rung's verdict is `passed` or `failed`. An undecided rung has no verdict.

The gate is stored per ladder rather than per rung. A ladder is one question
asked of an ordered series of cases, so the bar it sets is the ladder's, and a
rung only varies how many runs it takes to answer.

The default gate is floor `scuffed` with a threshold count of `1`: one playable
run passes the rung, and failing it takes every run broken. A fractional bar is
measured against the run count the rung will finish with rather than the count
it has so far, so the bar does not drift as runs land one by one.

### What the gate reads

The gate reads each completed run's validator rating: the functional rating the
[validators decide](/testing/end-to-end/evaluation/#the-validator-decided-functional-rating)
from the run record and the case version's checklist, with the toolchain gate on
top. The validator scripts are assumed correct, so this rating is the verdict.

The run's stored `rating` folds in every reviewer's checklist overrides, so the
gate never reads it, and it never reads a review. A ladder's climb is therefore
the same whoever looks at its runs and whatever they conclude.

The backend lifts the validator rating onto the run row as `validator_rating`
when the run is pushed, and a re-push rewrites it. Reviews never touch it.

Four more rules apply:

- A run whose build never loaded counts as `broken` outright, when the ladder's
  `unloadedCountsAsBroken` is on, which it is by default.
- A run that ended on the model's own failure (catastrophic, timed out, harness
  error, limit exceeded, or hung) counts as `broken`, whatever
  `unloadedCountsAsBroken` says, and uses one of the rung's runs. The model had
  its attempt and produced nothing to rate.
- An infrastructure failure or a canceled run never fails a rung and never
  reaches the gate. A cancel was somebody's decision.
- A run whose job the backend retried automatically is left out, and its retry
  takes its place. Infrastructure failures, catastrophic runs, harness errors and
  hung runs are retried up to the launch's `retryCount`. The job records its
  retry in `job.retried_by`, so an attempt and its retry use one of the rung's
  runs, and the gate waits for the retry rather than deciding on the attempt.
  The retry is enqueued, and the attempt stamped, before the attempt's run is
  stored, so no launch pass ever sees that run without the stamp. On the upgrade
  that added the column, the backend paired the retries it already held with
  their attempts: a retry created within ten minutes of an attempt ending on a
  retryable outcome, for the same launch request, account and origin, closest
  first.

A completed run with no validator rating, which happens when the backend did not
hold the case version when the run was pushed, counts as unrated. It can still
pass later, so the gate treats it as a possible pass in both directions and a
rung left with only unrated runs short of its bar is `blocked` as `unrated`.

### Deciding early, or not

`earlyStop` is off by default. With it off, a rung completes all of its runs even
when the outcome is already certain, and the gate answers "not decided yet" while
runs remain, because the runs are evidence as much as they are a gate.

Turned on, the gate decides the moment the outcome is determined. The launch pass
that records the decision cancels that cell's jobs that have not started yet:
the `queued` and `pending` jobs of that rung and climber whose origin is this
ladder. A job already dispatched or running finishes, and its run is kept.

Either way the decision is conservative in both directions, so an outcome never
has to be taken back as more evidence lands. It passes only when the runs already
in hand clear the bar, fails only when they cannot possibly clear it, and is
undecided in between.

The evidence behind any of those answers is reported as a `tally`: completed,
rated, unrated, passing, pending, and the number of passing runs required, so
why a climber failed or is still running needs no re-deriving of the floor and
unloaded-run rules.

## Version pins and honest history

Every recorded verdict stores the exact case version it was decided against, as
part of the verdict's identity.

Rungs pin exact versions on exact engines, and cases get revised. When a rung is
bumped to a newer version, a verdict earned on the old one is kept, flagged
`stale`, and no longer allowed to govern the climb, so the rung is re-opened.
Re-pinning back restores it.

A recorded verdict at the rung's current pin governs the climb whatever the rung
is now, so a climber that passed a rung before it became unsupported stays past
it.

Progress also reports each rung's `latestVersion` and whether the pin has fallen
behind, so bumping is an informed choice.

## A ladder starts disabled

Creating a ladder enqueues nothing. A new ladder is created disabled and stays
that way until its owner enables it, which is the gesture that says "start
spending on this climb". A client that creates a ladder already enabled has made
that gesture in the same write, and the climb starts at once. A ladder is a
question, and writing the question down is not the act of paying for the answer.

Enabled is the ladder's one on/off control. An enabled ladder always launches its
own climb, and a disabled one launches nothing.

Three consequences follow:

- **Opening a ladder is a read.** It never enqueues, so its owner can look at a
  ladder they have deliberately stopped without restarting it.
- **Enabling starts the climb.** The write that enables a ladder makes the
  backend launch whatever the climb needs, with no second call.
- **Disabling stops new work only.** It is the same flag as a pause: nothing
  further is enqueued, and runs already queued or in flight carry on to
  completion. Cancelling those is
  [halt](/components/backend/coverage/#pausing-and-halting).

## Launching runs

An enabled ladder launches its runs in a **launch pass**: it records every
verdict the gate can now decide, then enqueues what the climb needs, up to the
runs-in-flight cap. The backend runs a launch pass whenever the climb may have
moved: a run of one of its cells finishes, its owner writes to it (enabling it
included), a climber is retried, or the backend starts. A launch pass on a
disabled ladder enqueues nothing.

A launch pass checks that the ladder is still enabled immediately before it
enqueues, and again after. A disable or halt that lands during a pass therefore
never leaves a refilled queue behind: the pass either enqueues nothing or cancels
the jobs it just enqueued, and only those.

### When a run finishes

There is no background daemon. The backend runs a launch pass itself, with no
console open, at the moment a job reaches a terminal state:

- A job that **succeeded** feeds every enabled ladder whose rungs pin the job's
  case, version, variant and engine, plus the ladder its `origin` names.
- A job that **failed** does the same unless it enqueued an automatic retry. The
  retry takes the failed job's place in flight, so there is nothing new to
  launch.
- A **canceled** job feeds nothing. Somebody stopped it, and the next run to
  finish feeds the ladder.

The launch pass runs as the ladder's owner after the job's status is stored, so a
failed pass never fails the driver's report. It takes the per-ladder claim every
launch pass takes. A pass that finds the claim held marks the ladder for another
pass and tries the claim once more. The holder checks for a pass after it
releases the claim, so the pass is run either by the holder or by the caller
that asked for it, and a run that lands during a pass is never left undecided.

A holder serves at most five passes. A pass still requested after the last one,
or after a pass that failed, is served by a fresh launch pass.

### When the owner writes to a ladder

An edit can reopen a climb with nothing in flight, so no finishing run would
feed it. After any write to a ladder's declaration (`PUT /ladders/{id}` and
`POST /ladders/{id}/rungs/order`), its schedule or its enabled state, a
climber's steering, or a climber's retry, the backend runs a launch pass, and
it runs one after creating a ladder that is already enabled. The write answers
without waiting for it.

### When the backend starts

A restart loses some launch moments: the single-box reconciliation fails the
jobs a restart orphaned without feeding anyone, and a launch pass that was
running dies with the process. The backend is the single coordinator, so it
releases every ladder's claim before it serves. Once the definition store is
servable, it runs one launch pass for every enabled ladder. A ladder that is
already fed finds nothing missing.

### A failing rung

A cell whose jobs keep failing on infrastructure would otherwise be relaunched
by every failure. When a cell's three most recent terminal jobs all failed with
no run of the model's, the cell is failing: every launch pass skips it and
reports it, and its climber is `blocked` as `failing`.

`POST /ladders/{id}/climbers/retry` retries one such climber once its owner has
fixed the cause. The retry is recorded on the climber, and only jobs that ended
after it count toward the streak, so the climber is `running` again and the
launch pass that follows relaunches its rung. Three more failures block it again.

A job whose run ended on the model's own failure is evidence for the gate and
counts as a break in the streak. A job the backend failed because it restarted
while the job was executing is skipped, since the restart is not the cell's
fault.

### What a launch pass launches

A ladder's launch pass is the plan's
[top-up algorithm](/components/backend/coverage/#topping-up) with one
restriction: only a climber's current rung is ever launched. Running rung five
for a model that failed rung two would answer a question the ladder has already
answered.

`outerAxis` selects which loop is outer, with the same
emission-order-is-execution-order mechanism a plan uses:

- **`rung`**, the default, brings every climber up one rung before anyone moves
  on, which is what makes a ladder comparable across models.
- **`combination`** takes one climber as far as it gets before starting the next,
  answering "how far does this model get?" soonest.

Everything else is shared: whole cells, the
[harness-parallelism preference](/components/backend/coverage/#harness-parallelism-comes-first),
the account-wide [buffer target](/components/backend/coverage/#the-buffer-target)
with a per-ladder override, and the per-ladder claim that serializes concurrent
passes.

### Runs in flight

On a ladder the buffer target caps the runs in flight at once: the jobs of the
ladder's cells that are `queued`, `pending`, `dispatched`, `starting`, or
`running`, across every rung a climber has reached. Completed runs never occupy
it, whether anyone has reviewed them or not, so a climb never waits on a person.

The target keeps its shape. A bound limits how many runs the climb spends at
once, with the same whole-cell overshoot a plan has, and `unbounded` launches
every climber's current rung as soon as it is earned. A bound of `0` launches
nothing, so a ladder with that bound cannot climb.

### Reviewing a ladder's runs

`GET /ladders/{id}/queue` returns the completed runs its owner has not reviewed,
in the ladder's own order, across every rung each climber has reached: the ones
it passed, the one it stands on, and the one it failed. Progress reports their
count as `runsUnreviewed`.

The queue is there for labelling after the fact, so its runs can be given an
aesthetic rating and a writeup. It neither blocks nor feeds the climb.

Deleting a ladder leaves the jobs it launched alone, since they record the ladder
only as their origin. Cancelling them as well means
[halting](/components/backend/coverage/#pausing-and-halting) first.

## Endpoints

The ladder surface is specified in the
[HTTP API](/components/backend/api/#coverage-plans-ladders-and-the-review-buffer),
alongside the coverage-plan endpoints it mirrors.
