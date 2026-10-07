# Price the replies the loop detector abandoned

Put the output a run threw away on abandoned replies into its total cost, so
the figure a run is billed at and the figure gg records agree for a model that
looped.

## Current state

A reply the [loop detector](../../apps/docs/src/content/docs/gg/loop-detection.md)
abandons is cancelled mid-stream, and a cancelled stream never delivers its
usage object. The session summary records how many replies were discarded and
how much output they generated, but their cost is in neither of the run's two
cost figures, and the execution limits and loop detection pages say so.

On 2026-09-23 a run of `x-ai/grok-4.7` produced four consecutive replies of
between 18,000 and 230,000 characters with no tool call, one of which reached
the provider's output cap of 65,537 completion tokens at a cost of $0.35, and a
relaunch with the detector armed abandoned two 250,000-character replies in a
row. The run's recorded cost omits every abandoned reply, so the run looks
cheaper than the key was billed.

OpenRouter's `GET /api/v1/generation?id=<id>` answers for a cancelled stream
with `total_cost`, the token counts and `cancelled: true`, but only after a
delay: for about ten seconds after the cancel the endpoint returns 404. The
generation id is the `id` on the first streamed chunk, which gg has read by the
time it abandons the reply.

## Design

The client keeps the generation id of every reply it abandons, on the same
record that carries the discarded reply's size. When the session ends, before
the `session_summary` is written, gg looks each one up on the generation
endpoint, retrying a 404 on a short schedule bounded by a few tens of seconds
in total, and adds the returned `total_cost` and token counts to the slot's
total cost figure. The work cost figure is unchanged. A lookup that never
answers leaves the reply unpriced and the summary says how many replies stayed
unpriced, so the two figures can still be compared against the key's billing.

The lookup runs once at session end rather than on the turn, so a looping
model does not add the delay to its own retry.

State the lookup and the unpriced count on the execution limits page beside the
two cost figures, and correct the loop detection page's statement that an
abandoned reply's cost is in neither figure.

## Done when

- [x] An abandoned reply's cost is in the run's total cost when the generation
      endpoint answers for it.
- [x] The session summary says how many abandoned replies stayed unpriced.
- [x] The lookup runs at session end and never on the turn.
- [x] The execution limits and loop detection pages describe the lookup.
- [x] Gates green.
