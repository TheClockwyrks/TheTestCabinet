---
title: Coverage Plans
---

A **coverage plan** is a reviewer's standing declaration of the runs they want to
exist: a set of version-pinned [test cases](/testing/overview/) crossed with a set
of harness+model combinations, plus a target number of runs for each
`case × combination` **cell**. The backend expands that declaration into a
**matrix**, counts what already exists against it, and — when asked — enqueues
the runs that are still missing.

Plans are per [account](/components/backend/overview/#accounts) and an account may
hold many. Their members are normally pointers to reusable **coverage groups** (a
group holds either combinations or version-pinned cases), so one saved set of
models can drive several plans and editing the group reshapes all of them at once.
A plan may also pin one-off members directly; the two are unioned.

A plan answers "have I run this yet?". Its sibling, the
[ladder](/components/backend/ladders/), answers "how far does this model get?" —
the same buffer, the same counting rules, and the same halting controls, applied to
an *ordered* series of cases that a combination climbs until it fails one. Read
this page first: everything below about counting, buffering, and halting is shared.

## Counts are global, judgement is yours

This is the seam the whole feature is built on, and getting it backwards makes a
plan either wasteful or unusable.

**Run and job counts are global.** A cell's `completed` and `inFlight` counts every
run of that exact `case@version/variant × harness/model` cell, whoever launched it
and for whatever reason. A run someone else produced satisfies the target and is
never re-requested. A plan does not own runs; it observes them.

**Judgement is per account.** "Unreviewed" means there is no
[review](/components/core/results/#reviews) row for the *requesting* account, and
every gate and buffer decision reads only that account's own review. A run's stored
`rating` is the worst domain across **every** reviewer, so a plan or ladder must
never read it: one stranger's harsh review would otherwise stall a queue that is
not theirs, or wall a climb they are not on.

The practical consequence is that two reviewers pointed at the same cabinet share
its runs and not each other's worklists. Neither re-runs work the other already
paid for; neither is blocked by the other's backlog.

## The matrix

`GET /coverage-plans/{id}/coverage` resolves the plan's group pointers, crosses the
cases with the combinations, and returns one cell per pair with the counts that say
where it stands:

| field | meaning |
| --- | --- |
| `desired` | the target, from the plan's `runsPerCell` |
| `completed` | completed runs of the cell, counted globally |
| `inFlight` | jobs queued, pending, dispatched, starting, or running — globally |
| `pending` | the subset of `inFlight` the queue is deliberately holding back |
| `unreviewed` | completed runs **you** have not reviewed |
| `remaining` | `max(0, desired - (completed + inFlight))` |
| `latestVersion` / `stale` | whether a newer version of the case has been ingested |

`pending` is a subset of `inFlight`, not an addition to it. It is surfaced
separately because it is the answer to "my buffer is full but nothing is running":
a job sits `pending` when its harness is at its
[parallelism cap](/components/core/harnesses/#per-harness-configuration), or when
it is a [game jam](/testing/game-jam/overview/#repeated-runs-build-something-distinct)
run of a model that already has a jam run in flight. Both are the queue working as
designed, and neither is distinguishable from a wedged dispatcher unless the count
is reported on its own. A top-up will not *prefer* to create the first kind — see
[harness parallelism comes first](#harness-parallelism-comes-first) — but it will
still queue depth behind a cap once there is nothing else to launch.

A cell counts against the **pinned** version only. A case version is frozen once it
has runs, so an older minor is a different specification whose runs are not
comparable; `stale` flags that a newer version exists without silently moving the
target.

## Emission order is execution order

A plan's cells are emitted in a deliberate order, and that order survives all the
way to execution without any component in between having to preserve it.

Each job takes a monotonic `queue_seq` when it is inserted, and the
[dispatcher](/components/dispatcher/overview/#queue-order) claims strictly in
ascending order — passing over only a job whose harness is at its cap. So the
sequence in which a top-up *emits* cells is the sequence in which the runs *start*.
Nothing in the dispatcher, the driver, or the queue needs to know a plan exists:
choosing the emission order is the entire mechanism. That is also why the top-up
itself reads the caps when it chooses that order — see
[harness parallelism comes first](#harness-parallelism-comes-first).

That is what makes `outerAxis` a real control rather than a cosmetic one:

- **`case`** (the default, and what every plan did before the axis existed) —
  finish one case across every combination before starting the next case. You get
  every model's attempt at one case together, which is the comparison a reviewer
  usually wants to make.
- **`combination`** — finish one combination across every case before starting the
  next. You get one model's whole run of the plan first, which is what you want
  when the question is about the model rather than about the case.

The console labels these **"One case at a time"** and **"One model at a time"**.
They are deliberately never described as depth- or breadth-first: the choice is
about what you want to be able to review side by side, not about tree traversal,
and the traversal framing invites the reader to reason about a tree that does not
exist.

Within a cell the repeats are always emitted together — see
[why whole cells](#why-whole-cells).

## The review buffer

A plan is not a queue. Firing every missing run the moment a plan is saved spends
the entire budget before a single run has been looked at, and the first review is
usually what tells you the plan was wrong — the wrong variant, the wrong version, a
model that cannot get off the title screen. So a plan holds a bounded **review
buffer** instead: keep *N* runs outstanding, and refill as they are reviewed.

**Outstanding** is what the reviewer still owes attention to, across the plan's
cells:

```text
outstanding = in-flight jobs + completed runs the requesting account has not reviewed
```

Both halves belong there. In-flight work is already coming, and a finished run
nobody has judged is exactly the backlog the buffer is meant to bound. This is the
one place the [per-account](#counts-are-global-judgement-is-yours) number enters the
arithmetic: it never changes what a cell *needs*, only whether the plan is allowed
to ask for more right now.

### The buffer target

How much work you want waiting on you is a property of the **reviewer**, not of any
one plan, so it lives on the account: `GET`/`PUT /coverage-settings` holds a single
`bufferTarget`, defaulting to ten runs (roughly two cells at a typical five runs
per cell) until the account chooses its own. A plan — or a ladder — may override it
for the exceptions.

The override is nullable, and null is not zero: **null means "no opinion, inherit
the account's setting"** while **`0` means "never top this up automatically"**.
Collapsing the two would make "leave me alone" unexpressible.

### Topping up

Top-up is a **server endpoint the console calls**, not a background daemon. There
is no ticker quietly spending money while nobody is looking: a plan enqueues when
you open its dashboard, when you press *Top up now*, or — if `autoTopUp` is on —
when you submit a review, which is precisely the moment a buffer slot frees.

A [ladder](/components/backend/ladders/#a-ladder-starts-disabled) is fed by the same
endpoint but not by the same moments: it is created *disabled*, opening its dashboard
enqueues nothing, and enabling it is what starts the climb.

The algorithm is the same for plans and ladders:

1. Walk the cells in the plan's configured [outer-axis order](#emission-order-is-execution-order).
2. Skip any cell already at its per-cell target, counted **globally**.
3. Defer any cell whose harness is already at its
   [parallelism cap](#harness-parallelism-comes-first).
4. Emit **whole** cells — all of a cell's missing repeats together — until
   `outstanding` reaches the buffer target.
5. Walk the deferred cells, in the same order, until the buffer target is reached.

`POST /coverage-plans/{id}/topup` reports what it did in enough detail that an idle
plan is never a mystery: the buffer target in force, the occupancy it observed, the
cells it launched (in emission order) with their job ids, or a `skipped` reason. A
top-up that ran and enqueued nothing reports `skipped: null` with `enqueued: 0` —
deliberately distinct from one that never ran because the plan was `paused` or
because another top-up held the claim.

### Harness parallelism comes first

The buffer bounds the *reviewer's* backlog, but what produces that backlog is the
queue — and the queue will not start a run whose harness is already at its
[maximum parallelism](/components/core/harnesses/#per-harness-configuration).

Filling the buffer without reading that cap is how a plan starves itself. Walk the
cells in plain order and the whole buffer goes to the first harness the walk meets;
if that harness is throttled to two, ten queued runs still produce two at a time
while every other harness in the plan sits idle. The reviewer then drains the buffer
faster than a deliberately-throttled harness can refill it, and the buffer — the
thing that exists to keep them fed — becomes the thing holding the machine back. It
looks like a resource limit and is not one.

So the walk prefers cells that can actually start. A cell whose harness has no free
slot is set aside, the cells behind it on idle harnesses are emitted first, and the
set-aside cells are picked up in a second pass over whatever buffer is left. Within
one harness the plan's order is untouched; only the interleaving *between* harnesses
changes — which is the same reordering the
[dispatcher](/components/dispatcher/overview/#queue-order) already performs when it
skips a capped job to claim a later claimable one.

The second pass is not an afterthought. A plan whose harnesses are *all* throttled
must still queue real depth ahead of the reviewer, because top-up is an endpoint the
console calls and not a daemon: a plan holding only as many runs as can execute at
once would stop dead the moment the reviewer stopped submitting reviews. A single-
harness plan therefore enqueues exactly what it always did.

Capacity is read **globally** and across every job state, not just the states that
occupy a slot: a run merely queued for a harness consumes that harness's cap before
anything enqueued after it, whoever queued it. The question being asked is "would one
more run start soon", not "is a slot free this instant".

### Why whole cells

Step 4 overshoots the buffer target by up to one cell, on purpose.

A cell's repeats are the **unit of judgement**. Five runs of one case on one model
are reviewed against each other — that is how you tell a model that fails from a
model that got unlucky — so splitting them across two top-ups, and therefore across
whatever else the queue picked up in between, destroys the comparison the repeats
existed for. Briefly running a few runs over target is cheap; arriving interleaved
is not recoverable.

The check therefore happens at the boundary *between* cells and never inside one.

### One top-up at a time

Top-up is **serialized per plan**. Two console tabs, or a fast double review submit,
would otherwise both observe the same shortfall and both enqueue for it — and
because each is individually correct, nothing downstream would catch the doubling.

The serialization is a claim marker on the plan row (`topping_up_at`), taken by a
conditional update, so it is a real mutual exclusion rather than a check followed by
a hopeful write. A caller that finds the claim held answers `skipped: "busy"` rather
than waiting; the work will be done by the caller that holds it. The claim carries a
two-minute lease, because the request that takes it is also the request that
releases it and a request that dies in between would otherwise wedge the plan
forever.

Beyond that, the endpoint is **idempotent**: it recomputes outstanding from the
database on every call, so calling it twice after the first call's launches have
landed yields the next slice of work, not the same slice twice.

## The scoped review queue

`GET /coverage-plans/{id}/queue` returns the plan's completed-but-unreviewed-by-you
runs **in the plan's own order** — the order its cells were emitted — rather than
newest-first like the global Unreviewed page.

This is the payoff for having chosen an emission order at all. The buffer was filled
deliberately, a case's repeats adjacent so they can be judged against each other; a
newest-first worklist throws that ordering away and hands them back interleaved with
everything else that finished recently. The queue is capped rather than paginated,
because it exists to be walked from the front, and reports `truncated` when there is
more behind it.

Runs of [auto-graded](/testing/performance/overview/) test types never appear: they
are graded by machine, no reviewer can clear them, and listing them would produce a
worklist item nobody can act on.

## Pausing and halting

Three controls, deliberately distinct, because "stop" means three different things
with three different costs:

- **`pause`** — stop topping up. The queue is left completely alone. Reversible, and
  the mildest thing a reviewer can do when they want to think.
- **`halt`** — pause, then cancel this plan's `queued` and `pending` jobs. Those
  jobs have no driver and have spent nothing, so this throws away no work at all,
  which is why it needs no confirmation. **This is the common case.**
- **`halt all`** — the above, plus `dispatched`, `starting`, and `running`. Those
  runs are partly or wholly paid for, so the console confirms first and never makes
  it the default.

Both halts reuse the same atomic cancel transition a single
`POST /jobs/{id}/cancel` uses; there is no second state machine for bulk work.

**A halt reports how many jobs it cancelled**, and that count is the point rather
than a nicety. A halt that answered only "OK" cannot be told apart from a halt whose
scope was wrong, and the reviewer's next move differs completely between "the queue
was already empty" and "nothing I launched was found".

The global equivalents — **Clear pending**, **Kill active**, and **Stop all** on the
console's Runs page — sweep the same states with no origin filter at all. They are
explicitly *not* plan-scoped: they are the "stop the cabinet" controls, and
narrowing them by account would silently skip jobs recorded before attribution
existed.

## Attribution: which plan launched a run

For a scoped halt to be safe, a job has to know where it came from, so a job records
two nullable columns:

- **`user_id`** — the account that launched it. The authenticated user was already
  resolved on every launch and was simply being discarded.
- **`origin`** — `plan:<id>` or `ladder:<id>`, or null for a launch by hand. The
  prefix matters: plan and ladder ids are minted independently and nothing stops
  them colliding, so a bare id would let a ladder's halt cancel a plan's runs.

Both are nullable so existing rows need no backfill, and a run launched by hand
stays out of every scoped halt by construction.

An automatic retry inherits the **original** launcher and origin rather than taking
the retrier's, so a retried run stays inside the buffer that asked for it and remains
reachable by that plan's halt.

It is also **withheld while that plan or ladder is paused**. A retry is a fresh queued
job, and one appearing minutes after a reviewer halted the queue and watched it empty
is the same surprise as a top-up nobody asked for — worse, because there is no control
in the console that appears to have caused it. Runs already in flight when the pause
landed still finish, which is exactly what a pause promises; only the next attempt is
withheld. A run launched by hand has no plan speaking for it and retries as always.

**Coverage counting ignores both columns.** They exist for halting and for
attribution, and folding them into the counts would quietly re-introduce the
per-account counting this design rejects.

## Endpoints

The plan surface, all auth-gated and keyed to the token's account, is specified in
the [HTTP API](/components/backend/api/#coverage-plans-ladders-and-the-review-buffer):
groups and plans, the matrix, the account-wide settings, the schedule, top-up, the
scoped queue, and the three halting controls. The ladder counterparts are on the
[Ladders](/components/backend/ladders/) page.
