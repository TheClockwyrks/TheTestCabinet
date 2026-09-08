---
title: Coverage Plans
---

A **coverage plan** is a reviewer's standing declaration of the runs they want to
exist: a set of [pinned cases](#pinned-cases) crossed with a set of
[combinations](#combinations), plus a target number of runs for each
`case × combination` **cell**. The backend expands that declaration into a
matrix, counts what already exists against it, and enqueues the runs that are
still missing when asked.

Plans are per [account](/components/backend/overview/#authentication) and an
account may hold many. Their members are normally pointers to reusable **coverage
groups**, where a group holds either combinations or pinned cases, so one saved
set of models can drive several plans and editing the group reshapes all of them
at once. A plan may also pin one-off members directly, and the two sets are
unioned.

A plan answers "have I run this yet?". Its sibling, the
[ladder](/components/backend/ladders/), answers "how far does this model get?"
using the same buffer, counting rules, and halting controls applied to an ordered
series of cases. Everything below about counting, buffering, and halting is
shared by both.

## Counts are global, judgement is yours

**Run and job counts are global.** A cell's `completed` and `inFlight` count every
run of that exact cell, whoever launched it and for whatever reason. A run someone
else produced satisfies the target and is never re-requested. A plan observes runs
rather than owning them.

**Judgement is per account.** "Unreviewed" means there is no
[review](/components/core/results/#reviews) row for the requesting account, and
every gate and buffer decision reads only that account's own review. A run's
stored `rating` is the worst domain across every reviewer, so a plan or ladder
must never read it. Two reviewers pointed at the same cabinet therefore share its
runs and keep separate worklists.

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

A gg combination is fed by the same top-up as everything else. The top-up
resolves the configuration as the account saved it, binds its launch slots to the
models the member names, and enqueues a gg run carrying that capability set.

### What identifies a gg cell

A harness cell is identified by `case@version/variant/engine × harness/model`. A
gg cell adds the configuration's id and the models the bound set runs on.

The id is the identity because an operator renames a configuration freely and two
of an account's configurations may carry one name. A
[ladder's climber key](/components/backend/ladders/#climbers) names a
configuration by its id as well, so a member, the cell counted for it, and the
climber that carries its verdicts all resolve to the same configuration. The name
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
catalog can resolve no context window for. The matrix reports the reason on the
cell, and a top-up skips that cell and says so, leaving the rest of the plan
being fed.

## The matrix

`GET /coverage-plans/{id}/coverage` resolves the plan's group pointers, crosses
the cases with the combinations, and returns one cell per pair:

| field                     | meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `desired`                 | the target, from the plan's `runsPerCell`                        |
| `completed`               | completed runs of the cell, counted globally                     |
| `inFlight`                | jobs queued, pending, dispatched, starting, or running, globally |
| `pending`                 | the subset of `inFlight` the queue is deliberately holding back  |
| `unreviewed`              | completed runs you have not reviewed                             |
| `remaining`               | `max(0, desired - (completed + inFlight))`                       |
| `latestVersion` / `stale` | whether a newer version of the case has been ingested            |
| `unlaunchable`            | why a top-up cannot launch this cell, or null                    |

`pending` is a subset of `inFlight` rather than an addition to it, and is
surfaced separately so that a full buffer with nothing running is
distinguishable from a wedged dispatcher. A job sits `pending` when its harness
is at its [parallelism cap](/components/core/harnesses/#per-harness-configuration),
or when it is a [game jam](/testing/game-jam/overview/#repeat-runs) run of a model
that already has a jam run in flight.

`inFlight` is counted by the same identity as `completed`. A job records its case
pin's engine beside its harness and its model when it is enqueued, so the
in-flight count is one grouped query over the job table.

A cell counts against the pinned version and the pinned engine only. A case
version is frozen once it has runs, so an older minor is a different
specification whose runs are not comparable, and a run on another engine was
built against another runtime. `stale` flags that a newer version exists without
moving the target. A run recorded with no engine counts as a `none` run.

## Emission order is execution order

Each job takes a monotonic `queue_seq` when it is inserted, and the
[dispatcher](/components/dispatcher/overview/#queue-order) claims strictly in
ascending order, passing over only a job whose harness is at its cap. The
sequence in which a top-up emits cells is therefore the sequence in which the
runs start, and nothing in the dispatcher, the driver, or the queue needs to know
a plan exists.

`outerAxis` chooses that sequence:

- **`case`**, the default, finishes one case across every combination before
  starting the next case. Every model's attempt at one case arrives together.
- **`combination`** finishes one combination across every case before starting
  the next. One model's whole run of the plan arrives first.

Within a cell the repeats are always emitted together.

## The review buffer

By default a plan holds a bounded **review buffer** rather than firing every
missing run at once: keep _N_ runs outstanding, and refill as they are reviewed.
The first review is usually what reveals a plan was wrong, so spending the whole
budget before a single run has been looked at is wasteful.

**Outstanding** is what the reviewer still owes attention to, across the plan's
cells:

```text
outstanding = in-flight jobs + completed runs the requesting account has not reviewed
```

This is the one place the [per-account](#counts-are-global-judgement-is-yours)
number enters the arithmetic. It never changes what a cell needs, only whether
the plan is allowed to ask for more right now.

### The buffer target

How much work a reviewer wants waiting on them is a property of the account:
`GET`/`PUT /coverage-settings` holds a single `bufferTarget`, defaulting to a
bound of ten runs. A plan or a ladder may override it.

A buffer target is a tagged shape rather than a bare number:

```json
{ "kind": "bounded", "runs": 10 }
{ "kind": "unbounded" }
```

A **bounded** target stops a top-up once that many runs are outstanding, and its
bound is clamped to a ceiling of 500 runs. An **unbounded** target switches the
reviewer-backlog check off; the per-cell target, the harness parallelism
preference, and a ladder's gate still apply.

The override is nullable, and null is not zero. Null means "inherit the account's
setting", a bound of `0` means "never top this up automatically", and unbounded
means "top up everything". Each is a distinct instruction.

### Topping up

Top-up is a server endpoint rather than a background daemon. A plan enqueues when
it is opened, when a top-up is requested, and, with `autoTopUp` on, when a review
is submitted.

A [ladder](/components/backend/ladders/#a-ladder-starts-disabled) is fed by the
same endpoint at different moments: it is created disabled, opening it enqueues
nothing, and enabling it starts the climb.

The algorithm is the same for plans and ladders:

1. Walk the cells in the plan's configured
   [outer-axis order](#emission-order-is-execution-order).
2. Skip any cell already at its per-cell target, counted globally.
3. Skip any cell whose combination
   [cannot be launched](#a-member-that-cannot-be-launched), reporting the reason.
4. Defer any cell whose harness is already at its
   [parallelism cap](#harness-parallelism-comes-first).
5. Emit whole cells, all of a cell's missing repeats together, until
   `outstanding` reaches the buffer target. An unbounded target is never
   reached, so every missing cell is emitted in one pass.
6. Walk the deferred cells, in the same order, until the buffer target is
   reached.

Step 5 overshoots the buffer target by up to one cell, on purpose. A cell's
repeats are the unit of judgement, so the check happens at the boundary between
cells rather than inside one.

Every run a top-up enqueues carries its cell's whole pin: the slug, the version,
the variant, and the engine. Both combination shapes carry it, so a gg cell's
runs are built on the cell's engine exactly as a harness cell's are.

`POST /coverage-plans/{id}/topup` reports the buffer target in force, the
occupancy it observed, the cells it launched in emission order with their job
ids, the cells it could not launch with why, or a `skipped` reason. A top-up that
ran and enqueued nothing reports `skipped: null` with `enqueued: 0`, which is
distinct from one that never ran because the plan was `paused` or because another
top-up held the claim.

### Harness parallelism comes first

The queue will not start a run whose harness is already at its
[maximum parallelism](/components/core/harnesses/#per-harness-configuration), so
a walk that ignored the cap would hand the whole buffer to the first harness it
met and leave every other harness in the plan idle.

The walk therefore prefers cells that can actually start. A cell whose harness
has no free slot is set aside, the cells behind it on idle harnesses are emitted
first, and the set-aside cells are picked up in a second pass over whatever
buffer is left. Within one harness the plan's order is preserved, and only the
interleaving between harnesses changes.

The second pass queues real depth ahead of the reviewer. A plan whose harnesses
are all throttled would otherwise stop dead the moment the reviewer stopped
submitting reviews, because top-up is an endpoint rather than a daemon.

gg is one lane like any other harness: every configuration's runs share the gg
cap, because what a cap bounds is how many runs of a harness execute at once.

Capacity is read globally and across every job state, including states that
occupy no slot. A run merely queued for a harness consumes that harness's cap
before anything enqueued after it, whoever queued it.

### One top-up at a time

Top-up is serialized per plan by a claim marker on the plan row
(`topping_up_at`), taken by a conditional update so that it is a real mutual
exclusion. A caller that finds the claim held answers `skipped: "busy"` rather
than waiting. The claim carries a two-minute lease, so a request that dies before
releasing the claim frees the plan when the lease expires.

The endpoint is idempotent: it recomputes outstanding from the database on every
call, so calling it twice after the first call's launches have landed yields the
next slice of work.

## The scoped review queue

`GET /coverage-plans/{id}/queue` returns the plan's
completed-but-unreviewed-by-you runs in the order its cells were emitted rather
than newest-first. The buffer is filled with a case's repeats adjacent so they
can be judged against each other. The queue is capped rather than paginated,
because it exists to be walked from the front, and reports `truncated` when
there is more behind it.

Runs of [auto-graded](/testing/performance/overview/) test types never appear.
They are graded by machine, so listing them would produce a worklist item nobody
can act on.

## Pausing and halting

Three controls, distinct because "stop" carries three different costs:

- **`pause`** stops topping up and leaves the queue completely alone. It is
  reversible.
- **`halt`** pauses, then cancels this plan's `queued` and `pending` jobs. Those
  jobs have no driver and have spent nothing, so it needs no confirmation. This
  is the common case.
- **`halt all`** does the above, plus `dispatched`, `starting`, and `running`.
  Those runs are partly or wholly paid for, so it is confirmed before it runs.

Both halts reuse the same atomic cancel transition a single
`POST /jobs/{id}/cancel` uses.

A halt reports how many jobs it cancelled, so "the queue was already empty" and
"nothing I launched was found" are distinguishable.

The [global bulk-cancel endpoints](/components/backend/api/#stopping-runs-in-bulk)
sweep the same states with no origin filter, stopping the cabinet rather than one
plan.

## Attribution: which plan launched a run

For a scoped halt to be safe, a job records two nullable columns:

- **`user_id`**, the account that launched it.
- **`origin`**, either `plan:<id>` or `ladder:<id>`, or null for a launch by
  hand. The prefix matters, because plan and ladder ids are minted independently
  and nothing stops them colliding.

A run launched by hand stays out of every scoped halt.

An automatic retry inherits the original launcher and origin rather than taking
the retrier's, so a retried run stays inside the buffer that asked for it and
remains reachable by that plan's halt.

A retry is also withheld while that plan or ladder is paused. Runs already in
flight when the pause landed still finish, and only the next attempt is withheld.
A run launched by hand retries as always.

Coverage counting ignores both columns. They exist for halting and for
attribution, and folding them into the counts would re-introduce the per-account
counting this design rejects.

## Endpoints

The plan surface, all auth-gated and keyed to the token's account, is specified
in the [HTTP API](/components/backend/api/#coverage-plans-ladders-and-the-review-buffer):
groups and plans, the matrix, the account-wide settings, the schedule, top-up,
the scoped queue, and the three halting controls. The ladder counterparts are on
the [Ladders](/components/backend/ladders/) page.
