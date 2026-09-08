---
title: Ladders
---

A **ladder** is an ordered series of test cases that
[combinations](/components/backend/coverage/#combinations) climb one step at a
time, stopping at the first step they cannot clear. Where a
[coverage plan](/components/backend/coverage/) asks "have I run this yet?" and
treats its cells as an unordered set, a ladder asks "how far does this model
get?" and treats its steps as a sequence: rung three is harder than rung two, so
the rung a model stops at is the result.

A ladder is a sibling of the coverage plan rather than a mode of it, and shares
the plan's machinery wholesale: global counting, the review buffer and top-up,
pause, halt and halt all, the emission-order-is-execution-order mechanism, and
the same `coverage_group` pointers for its members. What it adds is an order, a
gate, and per-combination progress. Read the
[coverage plan page](/components/backend/coverage/) first. This page covers only
the difference.

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

### Test types a rung may not hold

Two test types are rejected at author time with an explicit message:

- **[Performance](/testing/performance/overview/)** cases are graded
  automatically and are excluded from every reviewer worklist, so their runs
  would stay unjudged permanently, occupying the review buffer and leaving the
  gate undecided.
- **[Game jam](/testing/game-jam/overview/)** cases are reviewed on a graded
  category scale and record no domain ratings, so even a fully reviewed jam run
  yields no [rating](/terminology/#rating) for the gate to compare against its
  floor.

Both belong in a coverage plan, which wants runs to exist rather than verdicts to
compare, and the error says so.

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
  front of the feed without reordering the ladder, which would change what every
  other climber is measured against.
- **`focused`**, a "watch this one" flag, and the tiebreak between equal
  priorities.
- **`held`**, stop this climber where it stands (see
  [manual control](#manual-control-in-both-directions)).

A combination with no steering row sorts as priority zero, unfocused, so a newly
added model takes its place at the back without anything having to be written for
it.

### Where a climber stands

`GET /ladders/{id}/progress` reports one of five statuses per climber:

| status           | meaning                                                        | whose move             |
| ---------------- | -------------------------------------------------------------- | ---------------------- |
| `climbing`       | runs are still to complete on the current rung                 | the ladder's           |
| `awaitingReview` | the rung ran everything it was going to and awaits your review | yours                  |
| `walled`         | the current rung was failed                                    | yours, if you disagree |
| `held`           | stopped by hand                                                | yours                  |
| `toppedOut`      | every rung cleared                                             | nobody's, it is done   |

A climber whose combination
[cannot be launched](/components/backend/coverage/#a-member-that-cannot-be-launched)
carries that reason. Such a climber stands where it is with the gate undecided,
so the reason travels with the climber rather than only with the top-up that
skipped it.

Progress is a read. Verdicts the gate has resolved but nobody has written down
yet are computed live and flagged `recorded: false`, and are persisted by the
next top-up.

## The gate

There is exactly one rule, parameterised:

```text
advance when count(my runs on this rung rated FLOOR or better) >= THRESHOLD
```

- **`floor`** is a [rating](/terminology/#rating): `flawless`, `great`,
  `passable`, `scuffed`, or `broken`. A run rated at the floor or better passes.
- **`threshold`** is either an absolute run count or a fraction of the rung's
  completed runs, compared as `count >= fraction * completed`.

The gate is stored per ladder rather than per rung. A ladder is one question
asked of an ordered series of cases, so the bar it sets is the ladder's, and a
rung only varies how many runs it takes to answer.

The default gate is floor `scuffed` with a threshold count of `1`: one playable
run advances the climber, and the wall needs every run broken. A fractional bar
is measured against the run count the rung will finish with rather than the count
it has so far, so the bar does not drift as runs land one by one.

### What the gate is allowed to read

Only the requesting account's own judgement: the worst domain within that one
account's single review of the run. A run's stored `rating` is the worst domain
across every reviewer, so gating on it would let a stranger's harsh review wall
someone else's ladder. See
[counts are global, judgement is yours](/components/backend/coverage/#counts-are-global-judgement-is-yours).

Two things are decided without waiting for a review:

- A run whose build never loaded counts as `broken` outright, when the ladder's
  `unloadedCountsAsBroken` is on, which it is by default. The unloaded verdict
  overrides a recorded review rather than being averaged with it.
- A failed or canceled job is never a wall and never reaches the gate.
  Infrastructure failures are retried (`job.attempt`), and only completed runs
  feed the gate.

### Deciding early, or not

`earlyStop` is off by default. With it off, a rung completes all of its runs even
when the outcome is already certain, and the gate answers "not decided yet" while
runs remain, because the runs are evidence as much as they are a gate.

Turned on, the gate decides the moment the outcome is determined and the ladder
cancels that rung's still-queued runs.

Either way the decision is conservative in both directions, so an outcome never
has to be taken back as more evidence lands. It advances only when the runs
already in hand clear the bar, walls only when they cannot possibly clear it, and
is undecided in between.

The evidence behind any of those answers is reported as a `tally`: completed,
judged, unjudged, passing, pending, and the number of passing runs required, so
why a climber is walled or waiting needs no re-deriving of the floor and
unloaded-run rules.

## Manual control in both directions

The gate is a computed opinion, and a reviewer can disagree with it either way.
Both directions are reversible and both preserve what the gate said.

- **Down: `hold`.** Stops a climber where it stands. It does not decide a rung,
  so clearing the hold resumes the climb from exactly where it left off.
- **Up: `promote` (or `wall`).** `POST /ladders/{id}/outcomes` imposes a verdict
  on a rung the gate has already decided, advancing past a wall it built or
  walling a rung its runs passed.

An override is stored beside the automatic verdict rather than over it, so a
later recompute can never silently undo an override, clearing the override
restores exactly what the gate itself says, and the disagreement between reviewer
and gate stays legible.

Overriding a rung that is not decided yet is a `409`. The control for "stop here
regardless" is a hold.

## Version pins and honest history

Every recorded verdict stores the exact case version it was decided against, as
part of the verdict's identity.

Rungs pin exact versions on exact engines, and cases get revised. When a rung is
bumped to a newer version, a verdict earned on the old one is kept, flagged
`stale`, and no longer allowed to govern the climb, so the rung is re-opened.
Re-pinning back restores it.

Progress also reports each rung's `latestVersion` and whether the pin has fallen
behind, so bumping is an informed choice.

## A ladder starts disabled

Creating a ladder enqueues nothing. A new ladder is created disabled and stays
that way until its reviewer enables it, which is the gesture that says "start
spending on this climb". A ladder is a question, and writing the question down is
not the act of paying for the answer.

Three consequences follow:

- **Opening a ladder is a read.** It never enqueues, so a reviewer can look at a
  ladder they have deliberately stopped without restarting it.
- **Disabling stops new work only.** It is the same flag as a pause: nothing
  further is enqueued, and runs already queued or in flight carry on to
  completion. Cancelling those is
  [halt](/components/backend/coverage/#pausing-and-halting).
- **`autoTopUp` is on by default**, which is safe because it can only ever feed a
  ladder somebody has already enabled. Once a ladder is climbing, the review that
  decides a rung is the natural moment to ask for the next one's runs.

An enabled ladder is fed by exactly three gestures: enabling it, requesting a
top-up, and submitting a review. A disabled one is fed by none, and a top-up of a
disabled ladder answers `skipped: "paused"` and enqueues nothing, whoever called
it.

## Feeding a ladder

A ladder's top-up is the plan's top-up with one restriction: only a climber's
current rung is ever launched. Running rung five for a model that is walled at
rung two would answer a question the ladder has already refused to ask.

`outerAxis` selects which loop is outer, with the same
emission-order-is-execution-order mechanism a plan uses:

- **`rung`**, the default, brings every climber up one rung before anyone moves
  on, which is what makes a ladder comparable across models.
- **`combination`** takes one climber as far as it gets before starting the next,
  answering "how far does this model get?" soonest.

Everything else is shared: whole cells, the
[harness-parallelism preference](/components/backend/coverage/#harness-parallelism-comes-first),
the account-wide [buffer target](/components/backend/coverage/#the-buffer-target)
with a per-ladder override, the per-ladder claim that serializes concurrent
top-ups, `autoTopUp` firing on review submit, and
`GET /ladders/{id}/queue` returning the unreviewed-by-you runs in the ladder's
own order. On a ladder the review is the verdict, so reviewing in the order the
buffer was filled is what decides climbers in the order the ladder meant to
decide them.

### Feeding and reviewing are different sets of rungs

The restriction above is on launching, and only on launching. What the ladder
offers for review, and what occupies the review buffer, is every rung each
climber has reached: the ones it advanced past, the one it stands on, and the one
it walled at.

The two sets have to differ, because the gate decides a rung as soon as the runs
in hand settle it. A queue drawn from the current rung alone would drop paid-for
runs the instant the reviewer judged enough of them to decide the rung, while the
buffer they still occupied reported itself full.

The buffer therefore counts every reached rung's unreviewed runs, which is
deliberate backpressure: a ladder whose reviewer has fallen behind stops
launching until they catch up. The reported buffer occupancy and the review queue
are drawn from that one set, so they can never disagree about which runs are
waiting.

A ladder that leans on its gate to do the stopping can set its buffer target to
`unbounded`. Each climber then launches its current rung as soon as it earns it,
whatever the reviewer's backlog. The gate still walls a climber whose rung fails,
and a rung is still decided by the requester's reviews.

Deleting a ladder leaves the jobs it launched alone, since they record the ladder
only as their origin. Cancelling them as well means
[halting](/components/backend/coverage/#pausing-and-halting) first.

## Endpoints

The ladder surface is specified in the
[HTTP API](/components/backend/api/#coverage-plans-ladders-and-the-review-buffer),
alongside the coverage-plan endpoints it mirrors.
