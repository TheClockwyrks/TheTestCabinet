# Answer a looping or unparseable reply as an error turn

Treat a reply gg abandoned or could not read as one error turn, kept out of
the context and counted toward the error ceilings, so a model that loops once
loses a turn rather than the run, and record what the run's faults cost apart
from what its work cost.

## Current state

A `2xx` reply whose tool call arguments do not parse is `ModelError::Parse`,
and the turn loop in `crates/gg/src/agent.rs` ends the session as
`model_error` on any `ModelError` other than a timeout. On 2026-09-23 a run of
`tencent/hy4-preview` emitted a `submit_program` call whose arguments ran past
100,000 lines before the provider cut it off, gg reported
`tool call #0 (submit_program) had unparseable arguments: EOF while parsing an
object`, and 65 turns of uncommitted work were left in the worktree.

A reply the [loop detector](../../apps/docs/src/content/docs/gg/loop-detection.md)
abandons is retried inside the client, and when the retry policy is spent the
result is `ModelError::ResponseLoop`, which ends the session the same way. A
reply the provider capped for length is already answered as an error turn,
`model_length_capped`, and the loop continues.

The `usage` event and `session_summary` record one cost per model slot. A turn
the model spent looping costs the same output tokens as a turn of work and is
counted with it.

## Design

`Parse` and `ResponseLoop` are answered as error turns, `model_parse` and
`model_response_loop`, on the terms `model_length_capped` already has: the
reply is not pushed into the context, the turn counts toward
`maxConsecutiveErrors`, and the loop continues. A `Parse` on a reply that was
not a tool call at all keeps its meaning through the existing
`missing_completion` errors.

Cost is recorded in two figures. The work cost is the sum over turns that
produced a program or a tool call gg ran. The total cost is the sum over every
request, including the turns above and every reply the loop detector
abandoned. The `session_summary` carries both per model slot and in the
rollup, and the `usage` event names which figure its turn contributed to.
Describe the two on the telemetry page for `session_summary` and on the
execution limits page beside the cost ceiling, which stays on the total.

## Done when

- [x] An unparseable reply and a spent loop retry are error turns that leave
      the run running, and the reply stays out of the context.
- [x] `session_summary` records the work cost and the total cost, and the
      `usage` event says which a turn fed.
- [x] The telemetry and execution limits pages describe the two figures.
- [x] Gates green.
