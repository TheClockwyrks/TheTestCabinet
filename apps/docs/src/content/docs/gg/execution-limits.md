---
title: "Execution limits"
---

Execution limits are an operator's bounds on a gg run: how many of its agents
run at once, how many turns an agent may take, how long the run and any one of
its model calls may take, how many failing turns it tolerates, and how much it
may spend. They apply to every
capability and to both execution modes.

Five ceilings stop work:

| Ceiling                            | Accounted | Effect on breach                      | Terminal status  |
| ---------------------------------- | --------- | ------------------------------------- | ---------------- |
| `maxTurns`                         | per agent | ends that agent                       | `exhausted`      |
| `maxRuntimeSecs`                   | run-wide  | ends every agent at its next boundary | `timed_out`      |
| `maxConsecutiveErrors`             | per agent | ends that agent                       | `limit_exceeded` |
| `maxErrorRate` + `errorRateWindow` | per agent | ends that agent                       | `limit_exceeded` |
| `maxCost`                          | run-wide  | ends every agent at its next boundary | `limit_exceeded` |

A ceiling is a safeguard, and a run is not expected to reach one. A run that
breaches any of them, in any agent of its tree, stops early and gg exits `3`. The
host records such a run as
[`limit_exceeded`](/components/core/run-records/#status) and never retries it.

Four further bounds are declared, resolved and recorded with those five.
[`maxParallel`](#parallelism) queues agents rather than stopping them,
`replayMaxBytes` bounds the [session capture journal](/gg/session-record/)
rather than the run, and [`modelCallTimeoutSecs`](#modelcalltimeoutsecs) and
[`modelStreamIdleSecs`](#modelstreamidlesecs) bound one model request rather
than the run that made it. [Cancellation](#cancellation)
stops a run on an operator's instruction, with no threshold declared anywhere.

[Loop detection](/gg/loop-detection/) bounds a single reply rather than a run. A
discarded attempt is not a turn, so no ceiling on this page observes one.

## What counts as an error

> A turn is an error when the work the turn declared could not be carried out as
> declared. A failure inside a turn that was reported back into the turn, and
> that left the rest of the turn's work intact, is not a turn error.

The same sentence holds in both execution modes. Under tool calling, a failure
comes back to the model as a tool result it reads on its next turn. Under
[responses as code](/gg/responses-as-code/overview/), it comes back to the
program as a typed throw at the statement that made the call. The rule is about
the turn's declared work: a program is expected to anticipate individual calls
failing and to handle them.

Counts as an error:

- The model call failed after the client exhausted its own retry and backoff. No
  turn happened at all, and this one is separately [fatal](#model-api-errors).
- The model call ran into gg's [per-call ceiling](#model-api-errors) without
  producing a reply. The turn is recorded as a `model_timeout` error and retried,
  so a stalled provider spends the error ceilings rather than hanging the run.
- The reply hit the provider's output cap (`finish_reason: length`). gg presumes
  a length-capped reply is a degenerate generation and
  [rejects it whole](#model-api-errors): recorded as a `model_length_capped`
  error and retried on the same terms as a timeout.
- The program did not compile: it did not parse, it broke an early error, or the
  language's compiler read it whole and rejected it. Nothing ran, and the model
  gets a `Compiler error` carrying the compiler's diagnostic and nothing else.
- The program threw uncaught. Every statement after the throw never ran, so the
  model must re-declare the remainder; it gets a `Runtime error` carrying the
  throw and nothing else.
- The sandbox stopped the program at its execution timeout or memory ceiling, or
  the guest trapped. The program's landed calls stand, and the work it declared
  was cut short, reported as the same `Runtime error`.
- A tool-calling turn requested no call. Ending a session is always an explicit
  call, so the model is answered by naming the ending calls its role has.
- A turn requested no call while a compaction was pending. The compaction
  instruction is restated, so an agent that never complies stops on an error
  ceiling.

Does not count:

- A tool call that failed inside a program that carried on. Counting it would
  penalise a program that correctly anticipates failure as much as one that
  crashes.
- A refused call: a compaction the loop is waiting for, a tool this run
  withholds, a spent wall-clock budget. It never reached the loop and is
  reported to the program as a value it can react to.
- A program that put nothing in its own window. It ran, and a value it returned
  is discarded and reported to the run's operator. The model hears a `Notice`
  saying its program put nothing in its context, and only when the turn would
  otherwise end on its own submission.
- A tool-calling turn whose dispatched calls all failed. Every requested call
  was dispatched and answered, so nothing was cut short.
- gg's own machinery failing, which covers the language's compiler failing to
  finish and any turn whose failure gg's own defect caused. Recorded so the
  accounting stays exact, excluded from every ceiling, and fatal on its first
  occurrence. The run ends under `internal_error`, the status that says the fault
  was gg's. See [gg's own defects](#ggs-own-defects).

### One judgement per turn

The definition is evaluated once per turn, at a single seam, and everything
downstream reads that one answer. The ceilings are enforced on it, it is emitted
on the run's [telemetry](/gg/telemetry/turn-outcomes/) as a `turn_outcome`
event, and it is rolled up onto the session summary as `errors`. A run's
reported error rate and the threshold that would have stopped it are the same
measurement.

The rollup carries `turns`, `errors`, `maxConsecutive`, the per-kind split, and
the replies loop detection discarded on the way with the size of the output they
threw away, for every run rather than only for the runs a ceiling stopped. A
discarded reply counts towards neither the errors nor the turns, because the
request was retried and the turn was judged on whatever the retry produced. Its
output has no price, because an abandoned stream never delivers its usage, so it
is in neither of the run's two [cost figures](#maxcost). A
[rejected length-capped reply](#model-api-errors) does count as an error, so the
ceilings bound a model that keeps capping out. Its usage is in the run's total
cost and outside its work cost and its turn count, and the summary's
`rejectedResponses` rollup sums the rejections.

## What is required and what is armed

Two keys are required, because gg conducts every run under them and
neither has an off it could take instead.

- `maxParallel` bounds the running pool. A run with no agent able to run is not a
  run, so there is no figure that means "no cap".
- `replayMaxBytes` bounds the [session capture journal](/gg/session-record/),
  which gg writes on every run.

`modelCallTimeoutSecs` and `modelStreamIdleSecs` are two of four keys an absence
answers with a figure rather than with "off": every model call is made under
both, so a configuration that leaves them out is conducted under 900 and 60
seconds, and one that writes `0` for either is refused. `maxModelRetries` and
`modelRetryMaxDelaySecs` are the other two: every failed model request is
retried on a schedule, so a configuration that leaves them out retries ten times
against a 60-second delay ceiling. See [model API errors](#model-api-errors).

The other five are ceilings, and a ceiling is armed by writing it. `maxTurns`,
`maxRuntimeSecs`, `maxCost`, `maxConsecutiveErrors`, and `maxErrorRate` with its
`errorRateWindow` are each unarmed when the configuration leaves them out. gg
arms no error ceiling nobody wrote: an agent stopped for looping on errors was
stopped by a threshold the operator chose, which is what makes the stop a
finding rather than an artefact of the harness. The host (The Test Cabinet)
enforces a wall-clock cap on every run regardless.

The run records the ceilings that were in force on the session summary, beside
the breach if there was one, and records an unarmed ceiling as unbounded. The run
also logs one `info` line at launch naming every armed ceiling, or _"no execution
ceiling is armed; the run is bounded only by the host's clock"_ when a
configuration arms none.

## The ceilings

### `maxParallel` {#parallelism}

How many of the run's agents may run at once: the root and every subagent, issue
implementer and reviewer, counted together regardless of which profile or model
each runs on. Every configuration states it.

An agent spawned while the pool is full is created normally and waits for a
slot, so setting this low serializes a run without losing any of its work. There
is no breach, no terminal status and nothing recorded. What it bounds is how
much a run does at once: provider rate limits, host CPU, and how legible the
[agent tree](/gg/subagents/) is.

Two rules govern the queue.

- A suspended agent does not count. An agent blocked on its subagents or on an
  [issue](/gg/project-management/) releases its slot for the duration of the
  wait.
- Resuming beats starting. When a slot frees it goes to a suspended agent whose
  wait is satisfied ahead of any not-yet-started one, so a fleet cannot fill its
  whole pool with agents waiting on each other. Ties within either class go to
  the agent that queued first.

A [persistent](/gg/agent-persistence/) profile is additionally capped at one
running instance within this pool.

### `maxConsecutiveErrors`

One counter per agent. It increments on every error turn and is cleared by a
turn that carried out its declared work, and by nothing else: a compaction does
not clear it, and a subagent returning does not clear it. The check fires as
soon as the count reaches the configured value.

A sandbox limit stop is an error here: the declared work did not complete and
the model must re-declare it. A run that is mostly working and occasionally too
big is bounded by the error-rate ceiling rather than by this one.

### `maxErrorRate` and `errorRateWindow`

A sliding window of an agent's last `errorRateWindow` turn outcomes, breached
when the fraction of errors in it is strictly above `maxErrorRate`. At `0.5`
over a window of ten, five errors is not a breach and six is. `0.0` is legal and
means "any error at all, once the window is full".

The window is both the lookback and the minimum sample: the ceiling cannot fire
until the agent has recorded that many outcomes. The earliest turn it can stop a
run on is therefore turn `errorRateWindow`. With a window of one, the
declaration says "stop on any error" and behaves as written.

It is evaluated after every recorded outcome, including a good one. A good turn
can be the turn that fills the window, and a window that becomes judgeable at
three errors in four is judged then.

The two halves stand or fall together. A set that writes both arms the ceiling; a
set that writes neither leaves it unarmed; a set that writes one half refuses the
launch, because a rate with no window and a window with no rate each describe a
ceiling gg has no threshold to judge against.

### `maxCost`

Compared against the run's **total cost**, which is the USD figure the run's
closing summary prints and the one that lands in the run record's per-profile
costs. It is checked at each agent's turn boundary, before the next model call,
exactly as the wall-clock deadline is.

The session summary records the run's spend as two figures, per model slot on
`slotCosts` and summed run-wide as `cost` and `workCost`:

- The total cost (`cost`) is the sum over every request that reported a price.
  It includes the [error turns](#model-api-errors) and the rejected replies.
- The work cost (`workCost`) is the sum over the turns that produced a program
  (responses as code) or a tool call gg ran (tool calling).

The difference between the two is what the run's faults cost. Every `usage`
event names the figure its turn fed in its `figure` field, so a consumer sums the
deltas marked `work` for the work cost and every delta for the total. This
ceiling reads the total, because a model that caps out or sends
unparseable arguments spends real money whether or not any of it did work.

1. The turn that crosses the line completes in full, because gg has already paid
   for that response.
2. The run's final recorded cost therefore exceeds the ceiling, by at most one
   turn's cost per concurrently running agent. `maxCost` bounds starting new
   work rather than capping spend, and the breach record's observed value is the
   spend already accumulated.
3. A run whose model reports no cost is never stopped by it. gg will not invent
   a figure to stop a run with.

The compaction summarizer's own model calls sit outside gg's run totals, so this
ceiling measures exactly what the run record reports.

### `modelCallTimeoutSecs`

The ceiling on one attempt at a model request, in seconds, from sending the
request to the last chunk of its reply. A breach does not stop anything: the
attempt is recorded as a `model_timeout` error turn and the agent asks the same
question again. A configuration that leaves the key out is conducted under 900
seconds, because there is no run whose calls may hang forever, and `0` refuses
the launch.

A reply that goes quiet is cut sooner by
[`modelStreamIdleSecs`](#modelstreamidlesecs), so the ceiling is what bounds a
reply whose deltas keep arriving for longer than it. The backoff between the
client's retries sits outside it, so a long retry schedule runs to its end under
any ceiling. A timeout surfaces immediately, without spending the retry
schedule, since each retry would cost the full ceiling again. A `model_timeout`
turn names the figure that fired.

### `modelStreamIdleSecs`

How long a model request may go without a delta from the model, in seconds,
before the attempt is cancelled. Every reply is read as a
[stream](/gg/loop-detection/#the-transport), and the clock restarts on each
chunk whose `delta` carries content, reasoning or tool-call arguments. It starts
when the request is sent, so a provider that never sends a response head is
cut by it too. Keep-alive comments and blank lines leave it running, which is
what separates a provider that has stopped answering from a model that is still
thinking: a model that reasons for minutes streams reasoning deltas for the
whole of that time.

A configuration that leaves the key out is conducted under 60 seconds, and `0`
refuses the launch. A provider that sends nothing until its reply is complete
needs a figure above its longest reply, at which point
[`modelCallTimeoutSecs`](#modelcalltimeoutsecs) is the bound that fires first.

A cancelled attempt is a transport failure. It is retried on the client's
[schedule](#maxmodelretries-and-modelretrymaxdelaysecs) and logged like any
other retry, with a cause that names the stall and the provider the stream had
named, if any, such as `the stream stalled: no delta from the model for 60s
(provider: Z.AI)`.

### `maxModelRetries` and `modelRetryMaxDelaySecs`

The schedule the model client retries a failed request on. A request answered
`429` or `5xx`, one that failed in transport, or one whose stream
[stalled](#modelstreamidlesecs) is retried; any other status is
[fatal](#model-api-errors) on its first response.

- `maxModelRetries` is the number of retries after the first attempt. It
  defaults to 10, and `0` is honoured as a run that gives up on the first
  failure.
- `modelRetryMaxDelaySecs` is the ceiling on one backoff delay. It defaults to
  60 seconds, and `0` refuses the launch, since a schedule of no waits hammers a
  provider that has just said it is down.

The first retry waits 1 second and each later one waits twice the last, capped
at the ceiling. The defaults wait about five minutes in all, and 30 retries at
the same ceiling wait about half an hour. A `429` or `503` carrying a
`Retry-After` in seconds waits that long instead when it is longer than the
schedule's delay. An operator sets the retries by what the run is worth against
what an outage costs, since a run of a long test case may be hours in when the
provider it is pinned to goes down.

Each retry is logged at `warn` on the stream of the agent that made the request,
naming the attempt, the status or transport error, and the delay before the
next attempt:

```text
model request attempt 3 of 11 failed (HTTP 502: bad gateway); retrying in 4.0s
```

Like the model-call timeout, the schedule never stops a run by being reached.
Spending it is what turns a provider's failure into a
[failed model call](#model-api-errors). A call that hits
[`modelCallTimeoutSecs`](#modelcalltimeoutsecs) bypasses the schedule, because
each retry would cost the ceiling again, and the turn-level retry is the bounded
one.

## Per agent, or run-wide

The two error ceilings are per agent. "Consecutive" and "the last N turns" are
definable only within one agent's turn sequence: gg's agents run concurrently on
the [subagent](/gg/subagents/) scheduler and their turns interleave
nondeterministically. A breaching subagent ends itself, its parent is told
through the ordinary agent-return channel, and the run carries on. When the
breaching agent is the root, the run ends.

Cost is run-wide, because every agent bills the same run and a per-agent cost
ceiling would be defeated by delegating. One shared total is fed by every agent
at its model-response site and read by every agent at its own turn boundary, so
the figure is current to within one in-flight turn per agent. Propagating a
breach needs no cancellation machinery: N independent readers of one value, each
stopping itself.

The wind-down bound is therefore one turn per agent, worst case a long `shell`
build. A turn is the loop's atomic unit, and interrupting one would leave a
half-applied tool batch behind and, on an OpenAI-shaped provider, an assistant
`tool_calls` message with no `tool` message answering it.

### Successions and forks

An agent that [becomes another agent](/gg/fork-and-exec/) through an `exec` or
an [FSM transition](/gg/fsms/) is one agent to every ceiling here. A
succession's incarnations spend one turn allowance between them, so a
three-state machine under `maxTurns: 60` gets sixty turns for the whole process
rather than sixty each. Turns are numbered continuously across the handoff,
which keeps a transferred `Turn #37` meaning turn 37 afterwards.

The error ceilings are the exception: each incarnation starts its
consecutive-error count and its error-rate window fresh. They measure whether
this agent, with this toolset on this model, is thrashing.

A [`fork`](/gg/fork-and-exec/) is a child rather than a succession, so it gets
its own error ceilings like any subagent. Its turns are numbered from the count
its forker had already spent, so a copy has the remainder of the turn ceiling.
Forking at turn 55 of a 60-turn ceiling buys five turns.

## Cancellation

An operator can kill a running gg run from the host's live monitor. It stops the
run through the same machinery as the two run-wide ceilings, at the same point
in the loop.

The channel is a file. The host names a sentinel path in the
[invocation](/gg/overview/) document (`cancelFile`) and creates that file when
the run is killed. Signalling the process would throw away the session summary,
the per-profile rollups and the [session record](/gg/session-record/), which are
emitted in the session's epilogue and are what the operator killed the run to
look at.

Every agent checks the sentinel at its own turn boundary, next to the run
deadline and the cost ceiling, so the wind-down bound is again one turn per
agent and nothing is abandoned half-applied. The observation latches: once any
agent has seen the sentinel the whole run is canceled, whatever happens to the
file afterwards.

The terminal status is `canceled`. Like the ceiling statuses it is not a failure
status, and it is the one terminal status that says nothing about the model. It
records no breach: every [breach](#breach-records) names a ceiling that was
measured and crossed, so a canceled run's `limitHit` stays empty.

[What a stopped run leaves behind](#what-a-stopped-run-leaves-behind) applies
with one exception. The epilogue runs in full, the process exits 0, and the
workspace is exactly as the last completed turn left it. The host writes the
sentinel, keeps draining the stream so the epilogue is ingested, and records the
run through its ordinary post-session path. The exception is the host's: a
canceled run is collected but not validated, since validating it would mean
building and driving an implementation the run was told to stop writing. See the
[driver's cancellation](/components/driver/overview/#cancellation) for that half.

## gg's own defects

A failure of gg's own machinery stops the whole run, whichever agent met it.
Failures of that kind are:

- a state gg's launch validation proves unreachable, such as an agent whose
  profile the run does not declare;
- a [fatal sandbox fault](/gg/responses-as-code/programs/) under a turn the model
  answered;
- a [program language](/gg/languages/overview/)'s compiler failing to finish;
- an agent task that panics; and
- a value the run cannot honour that only becomes visible once the agent is being
  stood up. Every configured value gg can read from the document
  [refuses the launch](/gg/configurations/) instead, so what is left here is the
  handful of questions a document cannot answer: a
  [handoff compaction](/gg/compaction/) model that resolves in the catalog and
  cannot be reached at run time, a
  [system-prompt override](/gg/prompts/) that will not render against a live
  context, an [autoloaded specification](/gg/autoload-specifications/) that
  cannot be read, an [inheriting agent](/gg/memories/) whose live spawner
  organizes memories another way, and a [transfer](/gg/modules/) meeting a module
  its predecessor does not hold.

Each of them has one thing in common: the only alternative to stopping is
substituting something for what was configured — gg's prompt for the operator's,
the working model for the handoff model, a private notebook for an inherited one
— and a run that measures the substitute while its record names the
configuration is worse than no run.

The run's output is attribution data: the tree it leaves is scored against the
model that produced it and compared against the tree another configuration
produced. A run gg broke in did not produce its tree. Some part of it is work an
agent was stopped in the middle of, or work the rest of the run built around
that hole, and a reader of the record sees a result rather than a defect. So the
run is disqualified instead: the terminal status is `internal_error`, the
process exits `1`, and the host records a harness error rather than collecting
the tree.

The wind-down is the [cancellation](#cancellation) wind-down. The agent that met
the defect records it on a run-wide latch and ends; every other agent reads the
latch at its own turn boundary and stops there, so the bound is again one turn
per agent and the epilogue is emitted in full. What the run leaves behind is
what a killed run leaves behind, which is the evidence an operator debugs the
defect from.

An agent gg has suspended reaches no turn boundary, so raising the latch also
releases every suspended wait in the run. A
[`wait_for_issue`](/gg/project-management/#waiting-on-an-issue) ends only when
its issue reaches a terminal state, and a faulted run dispatches nothing further,
so a wait left armed is a wait that outlasts the run: the session never returns,
no session ending is emitted, and the host records a hung run under its own
status rather than gg's. Each released agent rejoins the scheduler queue as a
woken one does and winds down at the boundary it then reaches.

A faulted run starts no new work. The board stops dispatching, so an issue it
never reached stays open, and an issue whose attempt the fault stopped is
recorded failed with its worktree left in place for the operator. Re-dispatching
it would spend an attempt on an agent that stops at its first turn boundary and
leave the board claiming work was tried.

The diagnostic names the agent, its profile and what broke. It is reported on
the stream of the agent that met the defect, repeated by each agent that winds
down, and stated once more on the root's stream in the epilogue, so a reader
starting from "why did this run fail?" gets the cause rather than the status
alone.

A panicking agent is the one defect that reaches the latch from outside the
agent, since the frame that reads the latch at a turn boundary is the frame the
panic unwinds. gg catches it one frame above the agent's loop and finishes what
the agent owed there: the fault is raised with the panic's message, the agent's
id and its profile, its running slot returns to the scheduler if it was holding
one, a spawner blocked on it is woken at once, and an issue it was implementing
is marked failed rather than left claiming work is under way. An agent that
panics while it is itself suspended returns nothing, because a suspended agent
has already given its slot up — returning it again would put the run over its
own parallelism cap and hand a persistent profile to a second instance. The
panicked instance is recorded as a failed agent that ended under
`internal_error`, and its spawner collects no return value from it.

A dispatch gg could not carry out is the same defect one step earlier, before
there is an agent to stop. A [board issue](/gg/project-management/) that names
no assignee, an assignee, reviewer or merge profile that cannot be resolved to a
model, and a subagent a spawning agent named from its own roster that gg then
could not stand up are all this case. The issue is marked failed so the board
says what is true, the spawning call fails, and the run ends, because the tree
is missing whatever that agent was for. The diagnostic names the issue rather
than an agent when the dispatch was for one, since no agent ran.

A refused credential is a separate case, and it is the operator's rather than
gg's. It ends the run when it is the root's ending; a subagent whose credential
was refused took no turns, and an issue whose assignee's client was refused
fails alone, so the run around either is still a run the model produced. Its
terminal status is `auth_error`. Every place gg resolves a model client draws
this split, so a missing key never disqualifies a run and a defect never hides
behind one.

### A compiler that could not finish

A language whose [preparation](/gg/languages/overview/) runs a real compiler
fails in two ways, and gg attributes them to different owners.

- The compiler rejected the program. That is the model's: a type error, a borrow
  error, a name that does not resolve. It is handed the compiler's own
  diagnostics, and the turn is recorded as `transpile_compile` under the
  `transpile` base kind.
- The compiler could not finish. It crashed, its own timeout killed it, or the
  binary is missing from the run's image. Nothing read the program, so nothing
  about it was rejected and there is no diagnostic to hand back.

The second is gg's. The model is told nothing, no ceiling counts it, and the run
ends under `internal_error`. A compiler gg's image never installed and a
compiler it installed that then crashed are one defect from the model's side: it
answered, and its answer was never read. Feeding the failure back asks a model to
fix an environment it cannot see, and counting it lets gg's own image end a run
under `limit_exceeded` with the model's name on it. The same holds for the code
a [skill or memory](/gg/skills/) carries, which gg prepares through the same
step.

This trade is deliberate. A compiler that crashed once may well compile the next
program, so a run a retry would have rescued now ends. A run whose environment
interfered with it cannot be compared against a run whose environment did not,
and an operator is better served re-running the case than reading a tree they
cannot trust.

### A turn gg's defect failed

A defect raised while a turn is still running comes back to that turn as a
refused call. Under [responses as code](/gg/responses-as-code/overview/) an
uncaught throw from that call would otherwise be filed as a program fault, which
puts gg's defect in the model's error record and counts it against the model's
ceilings.

Every turn is judged against the latch at the one seam that records it. A turn
whose outcome is an error while the latch is raised is recorded as fatal
instead, on the terms every other gg defect is recorded on: counted in `turns`
so the accounting stays whole, charged to no ceiling, and attributed to gg. A
run that both broke and failed a turn is recorded under the fault, since that is
the fact which disqualifies it.

### An ending taken on a broken run

An agent's terminal status is judged against the latch at the one seam that
produces it, on the same rule the turn is judged on. Every failure status an
agent can end under is gg's when the run was already broken, so `model_error`,
`auth_error`, `hook_error` and `compaction_failed` all become `internal_error`,
and the record of the turn and the record of the agent agree about whose failure
it was. An agent's
final word is written from the status it actually ended under, since a spawner
reads that sentence as its child's answer.

An agent that completed, that spent a ceiling, or that a host killed keeps the
status it earned. The run's own terminal status comes from the latch, so a run
gg broke is disqualified once, at the session, rather than restated on every
agent that had already finished.

## What a stopped run leaves behind

1. Nothing is aborted mid-turn. A cost or deadline breach is detected before a
   turn, so nothing is in flight; an error breach is detected after the turn's
   outcome is fully recorded, so its feedback is already in the context and its
   telemetry has already streamed.
2. The agent logs a `warn` naming the ceiling and the observed value, emits a
   structured `limit_exceeded` telemetry event, and returns `limit_exceeded` as
   its status.
3. A stopped subagent reports `Done` to its parent rather than `Failed`. A limit
   stop is the operator's ceiling, which is why `exhausted` and `timed_out` are
   not failure statuses either.
4. In-flight subagents are neither killed nor specially waited on. Under a cost
   or deadline breach each observes the same shared figure at its own next
   boundary; under an error breach, which is that agent's own, they run to their
   natural end.
5. The session tail runs unchanged: the per-profile rollups, the closing log,
   the [session record](/gg/session-record/), the session summary, the
   session-ended event.
6. The process exits `3`, and the host records the run as `limit_exceeded`. See
   [what the process exits with](#what-the-process-exits-with).
7. The workspace is exactly as the last completed turn left it, and gg rolls
   nothing back. A limit-stopped subagent's isolated worktree is discarded
   unmerged: the run's artifact is the main tree, and a subagent cut off mid-task
   holds half-finished work that merging could turn into a broken artifact.

Nothing about a ceiling is said to the model, in the system prompt or in any
turn feedback. A model told there is a cost budget behaves differently because
it was told, which makes its behaviour a function of the guardrail and confounds
every measurement the capability set exists to make.

### What the process exits with

A gg session leaves one of three exit codes, and the host classifies the run by
it before it collects anything.

| Exit | Meaning                                                                                            | Recorded as                           |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `0`  | The session ran to a natural end                                                                   | its own outcome, collected and scored |
| `1`  | A launch failure, a refused root credential, a root model call the provider failed, or a gg defect | `harness_error`, retryable            |
| `3`  | Any agent breached one of the five ceilings                                                        | `limit_exceeded`, never retried       |

A model call the provider failed is one whose
[retry schedule](#maxmodelretries-and-modelretrymaxdelaysecs) was spent, or one
answered with a fatal status on its first attempt. Both are the provider's
failure rather than the model's or the configuration's, and a harness error is
what the host retries, so a pinned provider's outage costs a run a retry rather
than a scored failure. Like the refused credential it is read off the root's
ending. A subagent whose model call failed is a failed node in a session that
can still complete and be scored.

Exit `3` is read off the whole tree rather than off the root's ending, the way a
gg defect is. A subagent that spent its turn budget, or an issue implementer that
breached after the root had already finished, leaves the root's own status saying
`completed`, and a run that exited `0` on it would be collected as one that
finished.

The host holds `limit_exceeded` apart from `harness_error` because a breached
ceiling is a property of the configuration. A retry runs the same capability set
into the same bound and reports the same state, so the run settles immediately
instead of spending its retry allowance. It is publishable as a per-model
statistic like a harness error, and releases no source and no playable build.

A gg defect outranks a breached ceiling. A run that did both exits `1` under
`internal_error`, because a spent ceiling stopped a measurement while a defect
means there was none.

The exit code is the only thing that changes about a stopped run. The agent that
breached a ceiling was already ended by that ceiling, and every other agent of
the run goes on working.

The exit code and the session summary's `limitHit` answer two different
questions, so a run can exit `3` and still record `limitHit: null`. `limitHit` is
how the **run** ended, which is the root's own ending, while the exit code says a
ceiling was breached **somewhere in the tree**. A run whose subagent spent its
error ceiling and reported back, leaving the root to finish its work, is exactly
that case. Every breach is on the stream as its own `LimitExceeded` event naming
the agent, the ceiling and the figure, which is where the breach the exit code
was raised on is read.

## Configuring them

Limits live on the capability set rather than on a capability's params or on the
launch envelope, so a run stopped by a ceiling records both the breach and the
ceiling that produced it:

```jsonc
"capabilitySet": {
  "capabilities": [ /* … */ ],
  "slots": [{ "slot": "primary", "modelId": "anthropic/claude-opus-5" }],
  "limits": { "maxParallel": 16, "maxTurns": 60, "maxRuntimeSecs": 5400,
              "modelCallTimeoutSecs": 900, "modelStreamIdleSecs": 60,
              "maxModelRetries": 10, "modelRetryMaxDelaySecs": 60,
              "maxConsecutiveErrors": 5,
              "maxErrorRate": 0.5, "errorRateWindow": 10,
              "maxCost": 25.0, "replayMaxBytes": 268435456 }
}
```

In the console the limits are a Run limits fieldset above the capability groups
in the [configuration](/gg/configurations/) editor, one field per key. A fresh
configuration is seeded with the parallelism and journal figures, a model-call
timeout of 900 seconds, a stream idle bound of 60 seconds, the retry schedule's
10 retries against a 60-second delay ceiling, a consecutive-error ceiling of 5,
and an error rate of 0.2 over a window of 50 turns; the turn, runtime and cost
fields start empty. Each seeded error figure is a guardrail the operator keeps,
changes, or clears. An empty ceiling field is an unarmed ceiling, except the
model-call timeout, the stream idle bound and the retry schedule, which an empty
field conducts under their defaults; a stored configuration that omitted a
ceiling opens with that field empty.

A key that is present is armed exactly as written, and one gg cannot arm that way
refuses the launch. So does an absent `maxParallel` or `replayMaxBytes`. The
refusal names every such key in the set at once, so a single pass over the
document fixes them all. A count declared as an integral JSON number is read as
that integer, so `60` and `60.0` are one declaration.

| Declaration                                                               | Result                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `maxParallel` or `replayMaxBytes` absent, `limits` absent altogether      | refused                                                            |
| any of the five ceilings absent                                           | that ceiling unarmed                                               |
| `modelCallTimeoutSecs` absent                                             | every model call bounded at 900 seconds                            |
| `modelStreamIdleSecs` absent                                              | every model call cancelled after 60 seconds without a delta        |
| `maxModelRetries` or `modelRetryMaxDelaySecs` absent                      | failed requests retried 10 times against a 60-second delay ceiling |
| `maxModelRetries: 0`                                                      | honoured: the first failure ends the session                       |
| one error-rate half declared, the other not                               | refused                                                            |
| `maxErrorRate: 0.0`                                                       | armed: any error at all, once the window is full                   |
| `errorRateWindow` ≥ a set `maxTurns`                                      | armed as declared, warned that it can fire only on the last turn   |
| any key but `maxErrorRate` and `maxModelRetries` declared `0` or negative | refused                                                            |
| `maxErrorRate` outside `0.0..=1.0`, or a float that is not finite         | refused                                                            |
| a key gg cannot read as the number it is                                  | refused                                                            |

Every ceiling is declared in `capabilitySet.limits`. A capability's params bound
that capability alone, so the subagents capability's `maxDepth` is the only
per-capability bound gg reads.

### Model API errors

Most model-call failures end the agent on their first occurrence. The client has
already retried `429`, `5xx` and transport failures on the run's
[schedule](#maxmodelretries-and-modelretrymaxdelaysecs), so one reaching the
loop means the provider failed every attempt within a single turn. Counting it
against a ceiling would be a second retry layer with a worse backoff.

Such an agent ends under `model_error`. When it is the root, a spent schedule or
a fatal status on the first attempt exits the process `1`, so the host records a
retryable harness error rather than scoring a run the provider cut short. A
refused credential ends under `auth_error` and exits `1` on the same terms, so
it is never scored against a model that never ran.

Four model-call failures are answered as error turns instead: a timed-out call,
a length-capped reply, an unparseable reply, and a reply that
[looped](/gg/loop-detection/) on every one of the client's attempts. Each spends
the consecutive-error count and the error-rate window exactly as a failed call
does, and the same request is then asked again on the same turn. Nothing enters
the context between the attempts, so the retry is byte-identical. Only the error
ceilings, the run's wall clock and an operator's kill (both re-checked between
attempts) decide when to stop asking, so a model that loops once or emits
arguments gg cannot read loses a turn rather than the run. Whatever usage one of
these attempts reported is charged to the run's [total cost](#maxcost) and kept
out of its work cost.

- A timed-out call. Every attempt runs under the run's
  [`modelCallTimeoutSecs`](#modelcalltimeoutsecs) ceiling over its whole
  duration. A timeout surfaces immediately, without spending the client's
  retry schedule, since each retry would cost the full ceiling again.
  Recorded as `model_timeout`. A stream that stalls within the ceiling is not
  this failure: it is retried by the client under
  [`modelStreamIdleSecs`](#modelstreamidlesecs).
- A length-capped reply. A reply whose finish reason is `length` hit the
  provider's own output cap, and gg presumes it is a degenerate generation
  rather than work. It is rejected whole, and the turn count shows only the
  turn that eventually answered. A `response_rejected` event carries the
  reply's size, usage, cost and serving provider, and the session summary's
  `rejectedResponses` rollup sums them. Recorded as `model_length_capped`.
- An unparseable reply. A `2xx` stream gg could not read into a reply: an
  unreadable event, a provider error object, or tool call arguments that are
  not JSON, which is what a provider that cuts arguments off produces. A reply
  that made no tool call at all is readable and is answered as a
  `missing_completion` error. Recorded as `model_parse`.
- A reply that looped on every one of the client's attempts. The failure is the
  model's rather than the provider's, and it is named separately in the log
  (_"model looped every attempt"_), because "retries exhausted" would send an
  operator looking at the provider for an outage that never happened. The size
  of the discarded replies rides the error turn's `loopAborts` figures. They
  have no price, since an abandoned stream never delivers its usage. The
  recorded base error kind is `model_api` and the recorded type is
  `model_response_loop`.

A run that ends on these does so under `limit_exceeded`, on whichever error
ceiling the repeated failures breached, and never under `model_error`.

## Breach records

Every stop, the turn ceiling's and the wall clock's included, records the same
structure: on the agent's stream as a `limit_exceeded` event, and, when the root
agent was the one that stopped, on the run's session summary as `limitHit`.

```jsonc
{
  "limit": "cost",
  "threshold": 25.0,
  "observed": 25.41,
  "turns": 37,
  "agentId": "root",
}
```

Every figure is an `f64`, so one shape carries a turn count, a number of
seconds, a consecutive count, a fraction and an amount of money, and one query
can slice across all five. An error-rate breach additionally carries the
`window` it was measured over. The `agentId` is whichever agent observed the
breach, which for a run-wide ceiling is whichever one reached its turn boundary
first.

The turn and runtime ceilings end an agent under `exhausted` and `timed_out`,
and the other three share `limit_exceeded`. Which ceiling stopped a run is
answered by the breach, which all five carry, and by the `limit` field in the
[query language](/gg/analysis/query-language/), which buckets a run that hit no
ceiling under `"none"`.
