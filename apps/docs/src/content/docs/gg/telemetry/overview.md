---
title: "Overview"
---

gg streams richer telemetry than the normalized [event](/components/core/events/)
and [metric](/components/core/metrics/) contracts require, and the backend and
console read that stream natively. gg runs headless, so the stream is the only
live window into a run.

Each page in this section documents one part of it.

- [Console surfaces](/gg/telemetry/console/) — the five read-outs a console
  assembles from the stream, and what each must show.
- [Agent holdings and surface](/gg/telemetry/agent-surface/) — which module
  stores an instance bound, which calls it was offered, and the record of the
  calls its programs made.
- [Context spend](/gg/telemetry/context-spend/) — attributing a run's input
  tokens to the material that occupied the window.
- [Turn timing](/gg/telemetry/turn-timing/) — where a turn's wall-clock went, and
  the per-request metric graphs.
- [Usage](/gg/telemetry/usage/) — what each model call spent, and how its
  output/reasoning split is bounded by the reply's own size.
- [Turn outcomes](/gg/telemetry/turn-outcomes/) — how each turn ended, the error
  taxonomy, and the run-level error rollup.
- [Code execution](/gg/telemetry/code-execution/) — what one code-shaped turn's
  program did.
- [Shell commands](/gg/telemetry/shell-commands/) — every command line gg ran on
  an agent's behalf, with its exit code and capped output.

## What the stream carries

The telemetry must let a console display:

- The [project management](/gg/project-management/) board and its issue statuses.
  The board is run-global.
- The [agents](/gg/subagents/) that are running, and the tree they form.
- For each agent, whether it is executing or blocked waiting on other agents.
- For each agent, the surface it was offered. A tool a model was never given and
  a tool it ignored are otherwise the same silence.
- Every succession: an [`exec`](/gg/fork-and-exec/), a `fork`, or an
  [FSM transition](/gg/fsms/). One `agent_transition` on the outgoing instance's
  stream carries one row per [module](/gg/modules/) kind, naming its disposition
  and the store id on each side of the handoff, and an `fsm_state` on the
  incoming instance names the machine, the state, and the state it came from.
- The [context-window breakdown](/gg/context-visibility/) over time.
- Where each turn's time went: one `turn_timing` per turn.
- What each call spent: one `usage` per model call that reported tokens or cost,
  carrying the four token classes, the cost, and the provider's usage object
  verbatim. See [usage](/gg/telemetry/usage/).
- How each turn ended: one `turn_outcome` per turn, carrying gg's own judgement
  of whether the turn did what it declared, why it did not, and how long the
  agent's failing streak is. Without it, a run's error rate is observable only
  for the runs a [ceiling](/gg/execution-limits/) stopped.
- Every reply gg [rejected whole](/gg/execution-limits/#model-api-errors) — a
  length-capped one — as one `response_rejected` per rejection, carrying the
  reply's size, the usage and cost the provider billed for it, and the provider
  that served it. The same spend reaches the run's
  [total cost](/gg/execution-limits/#maxcost) on a `usage` event marked
  `total`.
- Every shell command gg ran on an agent's behalf: one `shell` event per command
  line, naming which of the three command paths issued it, where it ran, its
  exit code, and the capped tails of its streams. See
  [shell commands](/gg/telemetry/shell-commands/).
- The message log: the exact request each turn sent and the reply it got,
  streamed as a de-duplicated pool of message bodies (`context_message`) plus one
  pointer list per turn (`prompt`), so a console reconstructs every prompt
  without the stream carrying a repeated message twice.

## The opening event

`session_started` is the first event of a session and carries the run's whole
[capability set](/gg/overview/#the-capability-set) and `modelProviders`, the
ordered candidate list each bound model may run on. A console therefore shapes
itself to the run from the moment it starts watching, rather than once the run
record lands, and a reader can see which providers the run may spend against
before the first request. A stream that omits the capability set falls back to
the set recorded on the run record, which records the lists as well.

`session_started` also carries `routingKey`, the key gg minted at launch and
sends on every request of the run as both `session_id` and `prompt_cache_key`
(see [prompt caching](/gg/overview/#prompt-caching)). It is the value a provider
dashboard shows for the run's requests, so it is how a dashboard row is matched
to a run.

## The closing summary

The last typed event before `session_ended` is `session_summary`, the run's
[aggregatable outcome](/gg/telemetry/turn-outcomes/#the-run-rollup) folded from
the stream as it ran. It records the run's spend as two figures, on each
`slotCosts` entry and summed run-wide:

- `cost`, the total cost: the sum over every request that reported a price,
  including the [error turns](/gg/execution-limits/#model-api-errors) and the
  rejected replies. The run's `maxCost` ceiling reads this figure.
- `workCost`, the work cost: the sum over the turns that produced a program or
  a tool call gg ran.

The difference between the two is what the run's faults cost. Each `usage`
event carries a `figure` naming the one its turn fed: `work` for a turn whose
spend is in both figures, and `total` for a turn whose spend is in the total
alone. A consumer sums the events marked `work` for the work cost and every
event for the total. An event without a `figure` counts toward the total alone.

The summary ends with the ceilings in force, the ceiling that stopped the run
when one did, the per-slot and per-provider cost rollups, and the capability set
the run executed under.

## The channel

This telemetry is a purpose-built structured channel to The Test Cabinet. It
carries the live, hierarchical, high-cardinality state above, principally the
agent tree and the issue board, which pure metrics and plain spans model poorly.
A run may also export [OpenTelemetry](/development/observability/) spans, metrics
and logs, as any run can. The custom channel is the primary telemetry.

It rides as an additional channel on top of the standard harness contract, so a
gg run is still a valid, scoreable run with the extended telemetry stripped. See
[how gg fits into The Test Cabinet](/gg/overview/). The schema is what the
[query language](/gg/analysis/query-language/) queries, so the two are designed
together.
