---
title: Ladders
---

A **ladder** is an ordered series of test cases that harness+model combinations
climb one step at a time, stopping at the first step they cannot clear. Where a
[coverage plan](/components/backend/coverage/) asks *"have I run this yet?"* and
treats its cells as an unordered set, a ladder asks *"how far does this model
get?"* and treats its steps as a sequence with a meaning: rung three is harder
than rung two, so the rung a model stops at **is** the result.

A ladder is a sibling of the coverage plan, not a mode of it. It shares the
plan's machinery wholesale — the same
[global counting](/components/backend/coverage/#counts-are-global-judgement-is-yours),
the same [review buffer and top-up](/components/backend/coverage/#the-review-buffer),
the same [pause / halt / halt all](/components/backend/coverage/#pausing-and-halting),
the same [emission-order-is-execution-order](/components/backend/coverage/#emission-order-is-execution-order)
mechanism, and the same `coverage_group` pointers for its members. What it adds is
an order, a gate, and per-combination progress. Read the
[coverage plan page](/components/backend/coverage/) first; this page covers only
the difference.

## Rungs

A **rung** is exactly one test case, pinned to an exact `(slug, version, variant)`.
The rungs' order, low to high, *is* the climb.

Each rung carries a **stable opaque id**, minted when the rung is added and never
reused — emphatically not its position. Rungs get reordered, and rungs get bumped
to a newer version of their case; every recorded verdict references this id, so a
positional identifier would silently reattribute a climber's history to a different
case the moment the ladder was rearranged. `POST /ladders/{id}/rungs/order` takes a
permutation of those ids and nothing else: a reorder must not be able to edit a rung
in passing, and edits go through `PUT /ladders/{id}` where the consequences are
visible.

A rung may override the ladder's `runsPerCell` with its own `runs`, so one pivotal
step can demand more evidence without making the whole climb more expensive.

Ladders are capped at fifty rungs. Past a few dozen steps a ladder is a coverage
plan wearing a costume, and every climber's progress walk grows with the length.

### Test types a rung may not hold

Two test types are **rejected at author time** with an explicit message rather than
being allowed to stall a climb weeks later:

- **[Performance](/testing/performance/overview/)** cases are graded automatically
  and are excluded from every reviewer worklist. Nobody can ever clear one, so its
  runs would stay unjudged permanently — occupying the review buffer *and* leaving
  the gate undecided forever.
- **[Game jam](/testing/game-jam/overview/)** cases are reviewed on a graded
  category scale (💩→💎) and record no domain ratings at all, so even a fully
  reviewed jam run yields no [rating](/terminology/#rating) for the gate to compare
  against its floor.

Both belong in a coverage plan, which wants runs to exist rather than verdicts to
compare, and the error says so. Silently stalling would be the genuinely hard
failure to diagnose: a ladder that looks healthy and never moves.

A rung pinned to a version the backend has not ingested is *allowed* — the driver
reports that far better than an author-time check can.

## Climbers

The combinations that climb are called **climbers**, and they are referenced
through the same `kind = "combo"` coverage groups a plan uses, plus any one-off
combinations pinned on the ladder. One saved set of models therefore drives both a
plan and a ladder, and editing the group reshapes both.

**Progress is stored per combination, never as one ladder-wide pointer.** This is
not a storage detail; it is what makes a ladder a standing object rather than a
one-shot sweep. Add a model to a ladder that has been running for a month and it
starts at rung one while everyone else carries on from where they were. A single
"the ladder is on rung four" cursor would either drag the newcomer to rung four
untested or drag everyone else back to rung one.

Each climber also carries steering, set through `POST /ladders/{id}/climbers`:

- **`priority`** — climb-order weight, higher first. It pushes one model to the
  front of the feed **without reordering the ladder**, which would change what every
  *other* climber is measured against.
- **`focused`** — a "watch this one" flag, and the tiebreak between equal
  priorities.
- **`held`** — stop this climber where it stands (see
  [manual control](#manual-control-in-both-directions)).

A combination with no steering row sorts as priority zero, unfocused, which is how a
newly added model takes its place at the back without anything having to be written
for it.

### Where a climber stands

`GET /ladders/{id}/progress` reports one of five statuses per climber. "Stopped" has
three genuinely different causes and conflating them makes a ladder impossible to
act on:

| status | meaning | whose move |
| --- | --- | --- |
| `climbing` | runs are still to complete on the current rung | the ladder's |
| `awaitingReview` | the rung ran everything it was going to; it is waiting on *your* review | yours |
| `walled` | the current rung was failed | yours, if you disagree |
| `held` | stopped by hand | yours |
| `toppedOut` | every rung cleared | nobody's — it is done |

`awaitingReview` is the state a full review buffer is made of, and separating it
from `climbing` is what lets a dashboard say "nothing will move until you look"
instead of leaving an idle ladder looking broken.

The board is a **read**: verdicts the gate has resolved but nobody has written down
yet are computed live and flagged `recorded: false`. They are persisted by the next
top-up, which is a write endpoint. A `GET` that silently advanced climbers would
make refreshing a dashboard part of the climb.

## The gate

There is exactly **one** rule, parameterised — not a menu of modes:

```text
advance when count(my runs on this rung rated FLOOR or better) >= THRESHOLD
```

- **`floor`** is a [rating](/terminology/#rating) — `flawless`, `great`,
  `passable`, `scuffed`, or `broken`. A run rated at the floor or better passes.
- **`threshold`** is either an absolute run **count** or a **fraction** of the
  rung's completed runs, compared as `count >= fraction * completed`.

The gate is stored per ladder, not per rung: a ladder is one question asked of an
ordered series of cases, so the bar it sets is the ladder's, and a rung only varies
how many runs it takes to answer.

Two parameters cover the shapes reviewers actually ask for without any of them
being a special case in the code. At five runs per rung:

| what you mean | `floor` | `threshold` | what happens |
| --- | --- | --- | --- |
| stop when over half are broken | `scuffed` | fraction `0.5` | 2.5 runs must be scuffed-or-better, so three must be — a climber walls once three of the five are broken |
| stop when all are broken | `scuffed` | count `1` | one playable run is enough to advance; the wall needs every run broken |
| pass if any run is passable+ | `passable` | count `1` | a single genuinely decent run carries the rung, however bad the rest are |

The second row is the **default gate**: the gentlest rule that still stops a
hopeless climb. A fractional bar is measured against the run count the rung *will*
finish with, not the count it has so far, so the bar does not drift as runs land one
by one.

### What the gate is allowed to read

Only the **requesting account's own** judgement — the worst domain within that one
account's single review of the run. A run's stored `rating` is the worst domain
across *every* reviewer, so gating on it would let a stranger's harsh review wall
someone else's ladder. See
[counts are global, judgement is yours](/components/backend/coverage/#counts-are-global-judgement-is-yours).

Two things are decided without waiting for a review:

- **A run whose build never loaded counts as `broken` outright**, when the ladder's
  `unloadedCountsAsBroken` is on — which it is by **default**. There is nothing for
  a reviewer to play, so waiting for a human to say so both stalls the climb and
  holds a review-buffer slot hostage. The unloaded verdict overrides a recorded
  review rather than being averaged with it: it is the harshest rating there is, and
  a review of a build that never loaded cannot be describing something that ran.
- **A failed or canceled *job* is never a wall at all**, and never reaches the gate.
  Infrastructure failures are retried (`job.attempt`); a node eviction is not
  evidence about a model. Only **completed runs** feed the gate.

### Deciding early, or not

`earlyStop` is **off by default**, and this is the decision most likely to look
wrong at first glance.

With it off, a rung **completes all of its runs** even when the outcome is already
certain — the gate answers "not decided yet" while runs remain, however obvious the
verdict is. That is deliberate: the runs are *evidence* as much as they are a gate.
Five runs of a case on a model are worth having in full, and a ladder that stops at
run two leaves a permanently thinner record of the exact model everyone will want
to look at hardest.

Turned on, the gate decides the moment the outcome is determined and the ladder
cancels that rung's still-queued runs. That is the right trade when the ladder is
being used to save money rather than to build a record.

Either way the decision is conservative in both directions, so an outcome never has
to be taken back as more evidence lands: **advance** only when the runs already in
hand clear the bar (every unreviewed and still-running run could come back broken
and the answer would not change), **wall** only when they cannot possibly clear it
(every remaining run could come back flawless and it would still fall short), and
**undecided** in between.

The evidence behind any of those answers is reported as a `tally` —
completed, judged, unjudged, passing, pending, and the number of passing runs
required — so a dashboard can say *why* a climber is walled or waiting without
re-deriving the floor and unloaded-run rules a second time and getting them subtly
different.

## Manual control in both directions

The gate is a computed opinion, and a reviewer can disagree with it either way.
Both directions are reversible and neither destroys what the gate said.

- **Down: `hold`.** Stops a climber where it stands. It does **not** pretend a rung
  was decided, so clearing the hold resumes the climb from exactly where it left
  off. This is the control for "I do not want to spend any more on this model right
  now", which is not the same claim as "this model failed".
- **Up: `promote` (or `wall`).** `POST /ladders/{id}/outcomes` imposes a verdict on
  a rung the gate has already decided — advancing past a wall it built, or walling a
  rung its runs passed.

An override is stored **beside** the automatic verdict, never over it. Three
consequences follow, and all three are the point:

1. A later recompute can never silently undo an override.
2. Clearing the override restores exactly what the gate itself says.
3. The disagreement between reviewer and gate stays legible, which is the record
   worth keeping.

Overriding a rung that is not decided yet is a `409`: there is nothing to promote
*past*, and the control for "stop here regardless" is a hold, which does not pretend
a rung was decided.

## Version pins and honest history

Every recorded verdict stores the **exact case version it was decided against**.
That is part of the verdict's identity, not decoration.

Rungs pin exact versions, and cases get revised. When a rung is bumped to a newer
version, a verdict earned on the old one is neither erased nor silently inherited:
it is kept, flagged `stale`, and no longer allowed to govern the climb — the rung is
re-opened, because a model clearing v1.0.0 says nothing certain about v1.1.0.
Re-pinning back restores it. A ladder that quietly carried old verdicts forward
would be claiming evidence it does not have.

The board also reports each rung's `latestVersion` and whether the pin has fallen
behind, so bumping is an informed choice rather than something noticed months later.

## Feeding a ladder

A ladder's top-up is the plan's top-up with one restriction: **only a climber's
current rung is ever launched.** That is what makes it a ladder rather than a plan —
running rung five for a model that is walled at rung two would be spending money to
answer a question the ladder has already refused to ask.

`outerAxis` selects which loop is outer, with the same emission-order-is-execution-
order mechanism a plan uses:

- **`rung`** (the default) — bring every climber up one rung before anyone moves on.
  The board advances as a row, which is what makes a ladder comparable across
  models. The console calls it **"Rung by rung"**.
- **`combination`** — take one climber as far as it gets before starting the next.
  The board advances as a column, and answers "how far does *this* model get?"
  soonest. The console calls it **"Model by model"**.

Everything else is shared: whole cells, the account-wide buffer target with a
per-ladder override, the per-ladder claim that serializes concurrent top-ups,
`autoTopUp` firing on review submit, and `GET /ladders/{id}/queue` returning the
unreviewed-by-you runs on the climbers' current rungs **in the ladder's own order**.
On a ladder that last one matters more than it does on a plan: the review *is* the
verdict, so reviewing in the order the buffer was filled is what decides climbers in
the order the ladder meant to decide them.

Deleting a ladder deliberately leaves the jobs it launched alone. They record the
ladder only as their origin, and deleting the ladder you launched from is not a
reason to throw away runs that already cost money. [Halt](/components/backend/coverage/#pausing-and-halting)
first if that is what you meant.

## Endpoints

The ladder surface is specified in the
[HTTP API](/components/backend/api/#coverage-plans-ladders-and-the-review-buffer),
alongside the coverage-plan endpoints it mirrors.
