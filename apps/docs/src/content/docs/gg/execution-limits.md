---
title: "Execution limits"
---

Execution limits are an operator's bounds on a gg run: how many of its agents
run at once, how many turns an agent may take, how long the run may take, how
many failing turns it tolerates, and how much it may spend. They apply to every
capability and to both execution modes.

Five ceilings stop work:

| Ceiling | Accounted | Effect on breach | Terminal status |
| --- | --- | --- | --- |
| `maxTurns` | per agent | ends that agent | `exhausted` |
| `maxRuntimeSecs` | run-wide | ends every agent at its next boundary | `timed_out` |
| `maxConsecutiveErrors` | per agent | ends that agent | `limit_exceeded` |
| `maxErrorRate` + `errorRateWindow` | per agent | ends that agent | `limit_exceeded` |
| `maxCost` | run-wide | ends every agent at its next boundary | `limit_exceeded` |

Two further bounds are declared, resolved and recorded with those five.
[`maxParallel`](#parallelism) queues agents rather than stopping them, and
`replayMaxBytes` bounds the [session capture journal](/gg/session-record/)
rather than the run. [Cancellation](#cancellation) stops a run on an operator's
instruction, with no threshold declared anywhere.

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
- The program did not compile: it did not parse, it broke an early error, or the
  language's compiler read it whole and rejected it. Nothing ran, and the model
  gets a `Compiler error` carrying the compiler's diagnostic and nothing else.
- The language's compiler could not finish. Nothing ran and nothing was decided
  about the program, so the model gets a `Notice` saying its program was not run
  and that nothing about it was rejected. See
  [toolchain failures](#toolchain-failures).
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
- A healed reply. [Healing](/gg/response-healing/) repairs the message rather
  than the turn, and heal counts and error counts are independent measurements.
- A program that put nothing in its own window. It ran, and a value it returned
  is discarded and reported to the run's operator. The model hears a `Notice`
  saying its program put nothing in its context, and only when the turn would
  otherwise end on the assistant's own message.
- A tool-calling turn whose dispatched calls all failed. Every requested call
  was dispatched and answered, so nothing was cut short.
- gg's own machinery failing. Recorded so the accounting stays exact, excluded
  from every ceiling, and fatal on its first occurrence.

### Toolchain failures

A language whose [preparation](/gg/languages/overview/) runs a real compiler has
two ways to fail, and gg keeps them apart everywhere.

- The compiler rejected the program: a type error, a borrow error, a name that
  does not resolve. That is the model's. It is handed the compiler's own
  diagnostics, and the turn is recorded as `transpile_compile` under the
  `transpile` base kind.
- The compiler could not finish: it crashed, its own timeout killed it, or the
  binary is not in the run's image. Nothing read the program, so there is no
  diagnostic and nothing to fix. The turn is recorded as `toolchain_failed`
  under the `toolchain` base kind, which exists for this one distinction.

The second is still an error turn and is still counted against
`maxConsecutiveErrors` and the error rate. The ceilings count errors without
distinguishing kinds, and a run whose compiler is broken must stop rather than
run to its deadline. The separate base kind keeps the attribution readable:
pooled under `transpile`, an arm with a flaky toolchain would read as an arm
with a worse model.

### One judgement per turn

The definition is evaluated once per turn, at a single seam, and everything
downstream reads that one answer. The ceilings are enforced on it, it is emitted
on the run's [telemetry](/gg/telemetry/turn-outcomes/) as a `turn_outcome`
event, and it is rolled up onto the session summary as `errors`. A run's
reported error rate and the threshold that would have stopped it are the same
measurement.

The rollup carries `turns`, `errors`, `maxConsecutive`, the per-kind split, and
the replies loop detection discarded on the way, for every run rather than only
for the runs a ceiling stopped. A discarded reply counts towards neither the
errors nor the turns, because the request was retried and the turn was judged on
whatever the retry produced.

## Defaults

The host (The Test Cabinet) enforces a wall-clock cap on every run, so the turn
ceiling is unbounded when unset. What gg arms by default are the two error
ceilings that end a run whose model has stopped making progress.

- `maxConsecutiveErrors` defaults to 5. Five failing turns in a row ends the
  agent.
- `maxErrorRate` defaults to 0.4 over an `errorRateWindow` of 50. Once an agent
  has taken 50 turns, more than 40% of its recent turns being errors ends it.

Runtime and cost stay off when unset. `maxParallel` defaults to 16 and
`replayMaxBytes` to 256 MiB. A ceiling that is set replaces its default. A
partially declared error rate warns and arms nothing rather than filling in the
missing half, whether it is a rate without a window or a window without a rate.

The run records the ceilings that were in force on the session summary, beside
the breach if there was one, including an unset turn ceiling recorded as
unbounded. The run also logs one `info` line at launch naming every armed
ceiling, or *"no execution ceiling is armed; the run is bounded only by the
host's clock"* when a configuration disables everything.

## The ceilings

### `maxParallel` {#parallelism}

How many of the run's agents may run at once: the root and every subagent, issue
implementer and reviewer, counted together regardless of which profile or model
each runs on. The default is 16.

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

Both halves are needed. A rate with no window has nothing to measure over, and a
window with no rate has no threshold. Either alone is a startup warning and no
ceiling.

### `maxCost`

Compared against the run's accumulated cost, which is the USD figure the run's
closing summary prints and the one that lands in the run record's per-slot
costs. It is checked at each agent's turn boundary, before the next model call,
exactly as the wall-clock deadline is.

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
the per-slot rollups and the [session record](/gg/session-record/), which are
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
5. The session tail runs unchanged: slot rollups, the closing log, the
   [session record](/gg/session-record/), the session summary, the session-ended
   event.
6. The process exits 0. Of the sessions that ran, only two exit non-zero: one
   whose credential was refused (`auth_error`) and one stopped by a gg defect
   (`internal_error`). Both are reported as harness errors rather than scored,
   so a limit-stopped run is collected, validated and scored on whatever
   artifact it produced.
7. The workspace is exactly as the last completed turn left it, and gg rolls
   nothing back. A limit-stopped subagent's isolated worktree is discarded
   unmerged: the run's artifact is the main tree, and a subagent cut off mid-task
   holds half-finished work that merging could turn into a broken artifact.

Nothing about a ceiling is said to the model, in the system prompt or in any
turn feedback. A model told there is a cost budget behaves differently because
it was told, which makes its behaviour a function of the guardrail and confounds
every measurement the capability set exists to make.

## Configuring them

Limits live on the capability set rather than on a capability's params or on the
launch envelope, so a run stopped by a ceiling records both the breach and the
ceiling that produced it:

```jsonc
"capabilitySet": {
  "capabilities": [ /* … */ ],
  "slots": [{ "slot": "primary", "modelId": "anthropic/claude-opus-5" }],
  "limits": { "maxParallel": 16, "maxTurns": 60, "maxRuntimeSecs": 5400,
              "maxConsecutiveErrors": 5, "maxErrorRate": 0.5, "errorRateWindow": 10,
              "maxCost": 25.0, "replayMaxBytes": 268435456 }
}
```

A set that declares nothing omits the key entirely, so every stored
configuration round-trips unchanged. In the console the limits are a Run limits
fieldset above the capability groups in the
[configuration](/gg/configurations/) editor, one field per key. A fresh
configuration shows gg's defaults in the fields that have one, so an empty
parallelism, error-ceiling or journal field falls back to that default, while an
empty `maxTurns`, `maxRuntimeSecs` or `maxCost` leaves that ceiling off.

Resolution is total: an unset, zero, negative or nonsensical declaration becomes
"the ceiling is off" plus a warning, never a launch error. A sweep's one shared
configuration document has to stay interpretable by every arm.

| Declaration | Resolves to | Warning |
| --- | --- | --- |
| `limits` absent | every default above | — |
| `maxParallel: 0` or absent | `16` | — |
| `maxTurns: 0` or absent | unbounded | — |
| `maxRuntimeSecs: 0` or absent | no budget | — |
| `maxConsecutiveErrors` absent | `5` | — |
| `maxConsecutiveErrors: 0` | off | it would stop a run before its first turn |
| both error-rate halves absent | `0.4` over `50` | — |
| a rate with no window, or a window with no rate | off | neither half means anything |
| `maxErrorRate` outside `0.0..=1.0`, or not finite | off | it could never be exceeded |
| `errorRateWindow: 0` | off | it has no turns to measure |
| `errorRateWindow` ≥ a set `maxTurns` | armed | it can fire only on the last turn |
| `maxCost` ≤ 0, or not finite | off | it must be greater than zero |
| `replayMaxBytes` absent | 256 MiB | — |
| `replayMaxBytes: 0` | off; capture unbounded | it would stop capture at once |

Every ceiling is declared in `capabilitySet.limits`. A capability's params bound
that capability alone, so the subagents capability's `maxDepth` is the only
per-capability bound gg reads.

### Model API errors

A failed model call ends the session on its first occurrence. The client has
already retried with exponential backoff over `429`, `5xx` and transport
failures, so one reaching the loop means the provider failed every attempt
within a single turn, and counting it against a ceiling would be a second retry
layer with a worse backoff and no jitter. A refused credential is the one
non-zero process exit, so it is never scored against a model that never ran.

A reply that [looped](/gg/loop-detection/) on every one of the client's attempts
arrives here too and ends the session on the same terms. It is named separately
in the log (*"model looped every attempt"*), because "retries exhausted" would
send an operator looking at the provider for an outage that never happened. The
recorded base error kind is `model_api` and the recorded type is
`model_response_loop`.

## Breach records

Every stop, the turn ceiling's and the wall clock's included, records the same
structure: on the agent's stream as a `limit_exceeded` event, and, when the root
agent was the one that stopped, on the run's session summary as `limitHit`.

```jsonc
{ "limit": "cost", "threshold": 25.0, "observed": 25.41,
  "turns": 37, "agentId": "root" }
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
