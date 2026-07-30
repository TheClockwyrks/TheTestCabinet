---
title: "Execution limits"
---

The **guardrails a gg run is bounded by**: how much of it happens at once, how many turns
an agent may take, how long the run may take, how many failing turns it tolerates, and how
much it may spend. They are deliberately **not** capabilities — a capability is a feature
under ablation, with tools and an on/off arm a study varies, while a guardrail is an
operator's bound that applies to every capability and to **both execution modes** at once.
A runaway is a runaway whether the model is calling tools one at a time or writing
[programs](/gg/responses-as-code/).

Five ceilings, one home, one resolution path, one breach record:

| Ceiling | Accounted | Effect on breach | Terminal status |
| --- | --- | --- | --- |
| `maxTurns` | per agent | ends **that agent** | `exhausted` |
| `maxRuntimeSecs` | run-wide | ends **every agent** at its next turn boundary | `timed_out` |
| `maxConsecutiveErrors` | per agent | ends **that agent** | `limit_exceeded` |
| `maxErrorRate` + `errorRateWindow` | per agent | ends **that agent** | `limit_exceeded` |
| `maxCost` | run-wide | ends **every agent** at its next turn boundary | `limit_exceeded` |

Plus one guardrail that is not a ceiling at all — [`maxParallel`](#parallelism), which
**queues** rather than stops. It lives here because it is configured, resolved and recorded
with the other five, and because it is the other thing an operator reaches for when a run
is doing too much.

And one stop that is not configured at all — an operator's
[cancellation](#cancellation), which nobody declares and no threshold expresses. It is
documented here because it is read at exactly the same place as the two run-wide ceilings,
on exactly the same terms, and stops a run in exactly the same shape.

Three of them are new. The turn ceiling and the wall-clock budget predate them and are
folded in **unchanged in behaviour**, so there is one place to configure a ceiling, one
place a breach is recorded, and one aggregation facet across all five, rather than two
vocabularies that drift.

## What counts as an error

Everything on this page rests on one sentence, and it is the same sentence in both
execution modes:

> **A turn is an error when the work the turn declared could not be carried out as
> declared.** A failure *inside* a turn that was reported back to the model, and that
> left the rest of the turn's work intact, is not a turn error.

It is deliberately about the turn's *declared work* rather than "did anything go wrong",
because the whole premise of responses as code is that a program **expects** individual
calls to fail and handles them. Counting those would make the one capability that expects
failures the one capability that cannot survive them.

**Counts as an error**

| Turn | Why |
| --- | --- |
| the model call failed, after the client's own retry/backoff was exhausted | no turn happened at all (and this one is separately fatal — see [below](#a-model-api-error-is-still-fatal)) |
| the reply was **not a program** — prose, empty, comments only, native tool calls and no text, no block gg reads as a program, or several candidate blocks | nothing ran; the model is told so and told that only `finish` ends the run |
| the program did not type-strip | nothing ran |
| the program threw uncaught | every statement after the throw never ran, so the model must re-declare the remainder |
| the sandbox stopped the program at its execution timeout or memory ceiling, or the guest trapped | the program ran and its landed calls stand, but the work it declared was cut short |

**Does not count**

| Not an error | Why not |
| --- | --- |
| a tool call that **failed inside** a program that carried on | the program handled it — caught it, branched on `result.exitCode`, or ignored it. Counting it would penalise a program that correctly anticipates failure exactly as much as one that crashes. |
| a **refused** call — a compaction the loop is waiting for, a tool this run withholds, a spent wall-clock budget | it never reached the loop and is reported to the program as a value it can react to |
| a **healed** reply | [healing](/gg/response-healing/) repairs the message, not the turn. A reply healing turned into a program that then ran is a good turn. Heal counts and error counts are independent measurements. |
| a program that returned **nothing** | it ran; the feedback nudges it, the ceilings do not |
| a tool-calling turn whose dispatched calls **all failed** | every requested call was dispatched and answered; nothing was cut short. The mirror of the first row, and keeping the two symmetrical is what lets one definition serve both modes. |
| a **compaction** | not a turn outcome at all |
| gg's own machinery failing | gg's fault, not the model's: recorded so the accounting stays exact, excluded from every ceiling, and fatal on its first occurrence anyway |

A tool-calling turn is total in three rows: it requested calls (a good turn), it
requested none (it ended the session), or the model call failed. That asymmetry — four of
the five error shapes are code-mode shapes — is real rather than an oversight: a
tool-calling turn has no way to declare work that can be cut short.

## The defaults catch a failing run, not a long one

gg's host (The Test Cabinet) already enforces a wall-clock cap on every run, so a turn
ceiling is redundant as the backstop it used to be — armed as one, it mostly cut
productive runs short before they were done. So the **turn ceiling is unbounded when
unset**. What gg arms by default instead are the two error ceilings that end a run whose
model has stopped making progress:

- **`maxConsecutiveErrors` defaults to 5** — five failing turns in a row ends the agent.
- **`maxErrorRate` defaults to 0.4 over an `errorRateWindow` of 50** — once an agent has
  taken 50 turns, more than 40% of its recent turns being errors ends it.

Runtime and cost stay **off** when unset: the host owns the clock, and gg will not invent
a spend ceiling nobody asked for. A pathological run is therefore still bounded — it trips
an error ceiling rather than burning turns — while a run that keeps making progress is
bounded only by the host's clock.

A ceiling you *do* set replaces its default; a **partially** declared error rate (a rate
without a window, or a window without a rate) is a mistake, so it warns and arms nothing
rather than filling in the missing half from the default.

What makes the defaults honest rather than hidden is that **the run records the ceilings
that were actually in force**, on the session summary, beside the breach if there was one
— including an unset turn ceiling, recorded as unbounded (`maxTurns` absent). "What was
this run bounded by?" is answerable for every run. The run also logs one `info` line at
launch naming every armed ceiling, or *"no execution ceiling is armed; the run is bounded
only by the host's clock"* when a configuration disables everything.

## The ceilings, exactly

### `maxParallel` {#parallelism}

How many of the run's agents may **run at once** — the root and every subagent, issue
implementer, reviewer and [speculation](/gg/speculative-execution/) attempt, counted
together regardless of which profile or model each runs on. **The default is 16.**

It is the only guardrail here that stops nothing. An agent spawned while the pool is full
is created normally and **waits for a slot**, so setting this low serializes a run without
losing any of its work, and there is no breach, no terminal status and no
`limit_exceeded` to record. What it bounds is how much a run does at the same time —
provider rate limits, host CPU, and how legible the [agent tree](/gg/subagents/) is.

Two rules make the queue behave sensibly under a small pool:

- **A suspended agent does not count.** An agent blocked on its subagents or on an
  [issue](/gg/project-management/) releases its slot for the duration of the wait.
- **Resuming beats starting.** When a slot frees, it goes to a suspended agent whose wait
  is satisfied ahead of any not-yet-started one. A suspended agent is holding work that is
  already half-done; starting fresh agents ahead of it is how a fleet fills its whole pool
  with agents that are all waiting on each other.

A [persistent](/gg/agent-persistence/) profile is additionally capped at **one running
instance** *within* this pool — the one per-agent exception, and the only other thing that
can make an agent queue.

### `maxConsecutiveErrors`

One counter per agent. It increments on every error turn and is cleared by — and only by
— a turn that carried out its declared work. Not by a compaction, not by a subagent
returning: a *turn* is the unit, and only a turn that did its job is evidence the agent
recovered. The check fires as soon as
the count reaches the configured value.

A sandbox limit stop **is** an error here, which is a change from the fixed five-failure
guard this replaces (under which a sandbox-limit trap reset the counter). The declared work did not
complete and the model must re-declare it. Nothing is lost by dropping the old exemption,
because the case it protected — a run that is mostly working and occasionally too big —
is exactly what the error-rate ceiling expresses and a consecutive counter cannot, which
is *why* it needed an exemption at all.

### `maxErrorRate` and `errorRateWindow`

A sliding window of an agent's last `errorRateWindow` turn outcomes, breached when the
fraction of errors in it is **strictly above** `maxErrorRate` — matching "more than X%":
at `0.5` over a window of ten, five errors is not a breach and six is. `0.0` is legal and
means "any error at all, once the window is full".

The window is **both the lookback and the minimum sample**: the ceiling cannot fire until
the agent has recorded that many outcomes, so one number does both jobs and there is no
second fudge factor. The property that follows is exactly this — **the earliest turn this
ceiling can stop a run on is turn `errorRateWindow`**. With a window of ten, a run cannot
die before its tenth turn; with a window of one, the declaration says "stop on any error",
which is a legitimate thing to ask for and behaves as written. It is evaluated after
**every** recorded outcome, including a good one — a good turn can be the turn that *fills*
the window, and a window that becomes judgeable at three errors in four must be judged
then rather than waiting for a fourth failure.

Both halves are needed: a rate with no window has nothing to measure over, and a window
with no rate has no threshold. Either alone is a startup warning and no ceiling.

### `maxCost`

Compared against the run's accumulated cost — the same USD figure the run's closing
summary prints and the same one that lands in the run record's per-slot costs, because a
ceiling measuring something the record does not show would be unauditable. It is checked
at each agent's **turn boundary, before the next model call**, exactly as the wall-clock
deadline is.

Three consequences, stated plainly because they are the whole content of the decision:

1. **The turn that crosses the line completes in full.** gg has already paid for that
   response; discarding it would waste the money *and* abandon work the model asked for.
2. **The run's final recorded cost therefore exceeds the ceiling**, by at most one turn's
   cost per concurrently running agent. So `maxCost` is a ceiling on **starting new
   work**, not a hard cap on spend, and the breach record's observed value is the spend
   already accumulated (at or above the threshold), never the threshold itself.
3. **A run whose model reports no cost can never be stopped by it.** gg will not invent a
   figure to stop a run with.

The compaction summarizer's own model calls are deliberately outside gg's run totals, so
this ceiling measures exactly what the run record reports and no more.

## Per agent, or run-wide

The two error ceilings are **per agent**, and that is a correctness property rather than
a preference. "Consecutive" and "the last N turns" are only definable within one agent's
turn sequence: gg's agents run concurrently on the [subagent](/gg/subagents/) scheduler,
their turns interleave nondeterministically, and a run-wide consecutive counter would be
counting a sequence that never happened, with a value depending on thread scheduling —
not a knob, a race.

It is also substantively right: a subagent's failures are its own.
[Speculative execution](/gg/speculative-execution/) fans out K attempts precisely so that
some may fail, and a thrashing fix agent must not take the run down with it. A breaching
subagent ends **itself**, its parent is told through the ordinary agent-return channel,
and the run carries on. When the breaching agent is the root, the run ends — the root
ending has always ended the session.

**Cost is run-wide**, because every agent bills the same run and a per-agent cost ceiling
would be trivially defeated by delegating. One shared total is fed by every agent at its
model-response site and read by every agent at its own turn boundary, so the figure is
current to within one in-flight turn per agent. Propagating a breach needs no cancellation
machinery — N independent readers of one value, each stopping itself, exactly as the run
deadline already works.

The wind-down bound is therefore **one turn per agent**, worst case a long `shell` build.
That is deliberate: a turn is the loop's atomic unit, and interrupting one would leave a
half-applied tool batch behind and, on an OpenAI-shaped provider, an assistant
`tool_calls` message with no `tool` message answering it — which would invalidate the
conversation for every later turn.

## Cancellation

An operator can kill a running gg run from the host's live monitor. That is not a ceiling
— nothing was declared and nothing was measured — but it stops the run through the same
machinery, at the same point in the loop, and it is worth reading beside the two run-wide
ceilings because it behaves identically to them in every respect but why it fired.

**The channel is a file.** gg runs as its own process inside the run container, and the
host driving it holds no handle on that process — it holds the *container*, and reads gg's
telemetry off an exec stream. What it can always do is put a file inside the container, so
the host names a sentinel path in the [invocation](/gg/overview/) document (`cancelFile`)
and creates that file when the run is killed. Signalling the process instead would be
worse in the way that matters: gg's result *is* its telemetry, and the most valuable part
of it — the session summary, the per-slot rollups, the [replay](/gg/replay/) sidecar — is
emitted in the session's epilogue. A signal that cut the process down would throw away
precisely what the operator killed the run to look at.

**The reading is at the turn boundary.** Every agent — the root and every subagent —
checks the sentinel at its own boundary, next to the run deadline and the cost ceiling and
on exactly the same terms: N independent readers of one value, each stopping itself, with
no cancellation machinery to propagate anything. So the wind-down bound is again **one
turn per agent**, the turn in flight completes, and nothing is abandoned half-applied. One
`stat` per turn, against turns measured in seconds, is not a cost worth engineering around.

The observation **latches**: once any agent has seen the sentinel the whole run is
canceled, whatever happens to the file afterwards. Otherwise a sentinel removed
mid-wind-down would stop the agents that had already reached a boundary and leave the rest
running, which is not a state anybody asked for.

**The terminal status is `canceled`**, and like the ceiling statuses — and unlike the two
error statuses — it is **not** a failure: a run a human stopped has not failed at
anything. It is kept distinct from all of them because it is the one terminal status that
says nothing whatsoever about the model; it is the only one caused entirely from outside
the run.

**It records no breach**, and that absence is the point. Every
[breach](#what-a-breach-records) names a ceiling that was measured and crossed; a
cancellation crossed nothing. Fabricating one would put a ceiling that does not exist into
the single field a study reads to find out why runs stop, so a canceled run's `limitHit`
stays empty.

[What a stopped run leaves behind](#what-a-stopped-run-leaves-behind) applies with one
exception. The epilogue runs in full — slot rollups, the closing log, the replay record,
the session summary, the session-ended event — the process exits 0, and the workspace is
exactly as the last completed turn left it. On the host's side that epilogue is what makes
a killed run worth keeping: the host writes the sentinel, keeps draining the stream so the
epilogue is ingested, and then records the run through its ordinary post-session path. The
exception is the host's, not gg's: a canceled run is collected but **not validated**, since
validating it would mean building and driving an implementation the run was told to stop
writing. See the [driver's cancellation](/components/driver/overview/#cancellation) for
that half.

## What a stopped run leaves behind

1. **Nothing is aborted mid-turn, ever.** A cost or deadline breach is detected *before* a
   turn, so nothing is in flight; an error breach is detected *after* the turn's outcome
   is fully recorded, so its feedback is already in the context and its telemetry has
   already streamed.
2. The agent logs a `warn` naming the ceiling and the observed value, emits a structured
   `limit_exceeded` telemetry event, and returns `limit_exceeded` as its status.
3. A stopped **subagent** reports `Done` to its parent, not `Failed`: a limit stop is the
   operator's ceiling, not the agent failing at its work — which is exactly why
   `exhausted` and `timed_out` are not failure statuses either.
4. In-flight subagents are neither killed nor specially waited on. Under a cost or
   deadline breach each observes the same shared figure at its own next boundary; under
   an error breach — which is that agent's own — they run to their natural end, still
   bounded by their own turn ceiling and the run deadline.
5. The session tail runs **unchanged**: slot rollups, the closing log, the
   [replay](/gg/replay/) record, the session summary, the session-ended event. A limit
   stop is a normal loop ending, not an exception path.
6. The process exits **0**. Of the sessions that actually ran, only one with a refused
   credential exits non-zero, and a spent budget is not a rejected credential — so a
   limit-stopped run is collected, validated and scored on whatever artifact it produced,
   exactly like an exhausted or timed-out one.
7. **The workspace is exactly as the last completed turn left it.** gg rolls nothing back.
   The one nuance worth stating: a limit-stopped subagent's isolated
   worktree is **discarded unmerged**, exactly as an exhausted or
   timed-out one is. The run's artifact is the main tree, and a subagent cut off mid-task
   holds half-finished work that merging could turn from a working artifact into a broken
   one.

Nothing about a ceiling is ever said to the **model**, in the system prompt or in any turn
feedback. A ceiling is not actionable — there is nothing a model can do about a cost
budget except behave differently *because it was told there was one*, which makes its
behaviour a function of the guardrail and confounds every measurement the capability set
exists to make. It is also consistent with how the turn ceiling has always worked: a turn
budget has never been told to a model either.

## Configuring them

Limits live on the **capability set**, not on a capability's params and not on the launch
envelope — because the capability set is what a run *records*, so a run stopped by a
ceiling carries both the breach and the ceiling that produced it:

```jsonc
"capabilitySet": {
  "capabilities": [ /* … */ ],
  "slots": [{ "slot": "primary", "modelId": "anthropic/claude-opus-5" }],
  "limits": { "maxParallel": 16, "maxTurns": 60, "maxRuntimeSecs": 5400,
              "maxConsecutiveErrors": 5, "maxErrorRate": 0.5, "errorRateWindow": 10,
              "maxCost": 25.0 }
}
```

A set that declares nothing omits the key entirely, so every stored configuration
round-trips unchanged. In the console they are a **Run limits** fieldset above the
capability groups in the [configuration](/gg/configurations/) editor. A fresh
configuration shows gg's defaults in the fields — the parallelism cap and the two error
ceilings seeded, the turn ceiling left empty (unbounded) — so an empty parallelism or
error-ceiling field falls back to its default, while an empty `maxTurns`,
`maxRuntimeSecs` or `maxCost` leaves that ceiling off.

Resolution is **total**: an unset, zero, negative or nonsensical declaration becomes "the
ceiling is off" plus a warning, never a launch error, on the same terms an unknown name in
the [tool ablation](/gg/toolset-ablation/) list is read on. A sweep's one shared
configuration document has to stay interpretable by every arm.

| Declaration | Resolves to | Warning |
| --- | --- | --- |
| `limits` absent | 16 agents in parallel, turns unbounded, the error defaults armed, runtime and cost off | — |
| `maxParallel: 0` or absent | `16` (the default) | — |
| `maxParallel` on the **subagents** capability's params | honored, but the run-level value wins | — |
| `maxTurns: 0` or absent | **unbounded** (no turn ceiling) | — |
| `maxRuntimeSecs: 0` or absent | no budget | — |
| `maxConsecutiveErrors` absent | `5` (the default) | — |
| `maxConsecutiveErrors: 0` | off | it would stop a run before its first turn |
| both error-rate halves absent | `0.4` over `50` (the default) | — |
| a rate with no window, or a window with no rate | off | neither half means anything alone |
| `maxErrorRate` outside `0.0..=1.0`, or not finite | off | it could never be exceeded |
| `errorRateWindow: 0` | off | it has no turns to measure |
| `errorRateWindow` ≥ `maxTurns` (when a turn ceiling is set) | **armed** | it can only ever fire on the run's last turn |
| `maxCost` ≤ 0, or not finite | off | it must be greater than zero |
| `maxTurns` / `maxRuntimeSecs` on a **capability's** params | ignored | move it to `capabilitySet.limits` |

That last row is a migration guard rather than a hypothetical. Both values used to be
read from any capability's params, and the console round-trips undeclared params
losslessly, so a configuration saved before limits had a home may still carry
`{"maxTurns": 8}` on some capability — a ceiling the operator meant to set that gg would
otherwise ignore, running unbounded instead. gg names the capability and the param.

### A model API error is still fatal

A failed model call is named in the error taxonomy so the definition stays whole, but it
is **not** something a ceiling ever gets to count twice: it ends the session on its first
occurrence, as it always has. The client has already retried with exponential backoff over
`429`/`5xx`/transport failures, so one reaching the loop means the provider failed every
attempt within a single turn; counting it and looping again would be a second,
undocumented retry layer with a worse backoff and no jitter. The deterministic kinds recur
identically, and a refused credential must remain the one non-zero process exit, or it
gets scored against a model that never ran.

## What a breach records

Every stop — including the turn ceiling's and the wall clock's — records the same
structure, on the agent's stream as a `limit_exceeded` event and, when the **root** agent
was the one that stopped, on the run's session summary as `limitHit`:

```jsonc
{ "limit": "cost", "threshold": 25.0, "observed": 25.41,
  "turns": 37, "agentId": "root" }
```

Every figure is an `f64` so one shape carries all five ceilings — a turn count, a number
of seconds, a consecutive count, a fraction and an amount of money — and one query can
slice across them without five parallel fields, four of which would be null on any given
run. An error-rate breach additionally carries the `window` it was measured over. The
`agentId` is whichever agent observed the breach, which for a run-wide ceiling is
whichever one reached its turn boundary first — that is why it is carried rather than
assumed.

Two of the five keep terminal statuses that predate this vocabulary (`exhausted`,
`timed_out`). That is compatibility, not inconsistency: those statuses are recorded on
every historical run and are what the console, the aggregation facet and the run-state
mapping already read, so re-labelling them would rewrite the meaning of runs nobody
re-ran. Which ceiling stopped a run is answered by the breach, which all five carry —
and by the `limitHit` facet in [result aggregation](/gg/result-aggregation/), which
buckets a run that hit none under `"none"` rather than treating it as absent, because
"ran to its own conclusion" is the arm every ceiling comparison is measured against.
