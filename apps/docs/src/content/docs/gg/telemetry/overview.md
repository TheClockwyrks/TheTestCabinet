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
- How each turn ended: one `turn_outcome` per turn, carrying gg's own judgement
  of whether the turn did what it declared, why it did not, and how long the
  agent's failing streak is. Without it, a run's error rate is observable only
  for the runs a [ceiling](/gg/execution-limits/) stopped.
- Every reply gg [rejected whole](/gg/execution-limits/#model-api-errors) — a
  length-capped one — as one `response_rejected` per rejection, carrying the
  reply's size, the usage and cost the provider billed for it, and the provider
  that served it. The run's own usage excludes a rejected call, so this event is
  the only place its spend appears live.
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
OpenRouter provider each bound model is pinned to. A console therefore shapes
itself to the run from the moment it starts watching, rather than once the run
record lands, and a reader can see which provider the run's cost is recorded
against before the first request. A stream that omits the capability set falls
back to the set recorded on the run record, which records the pins as well.

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
