# Bound the output token split by the reply's own size

Record the provider's usage object as it arrived, and split completion tokens
into output and reasoning so that a reply gg holds in hand is never counted as
zero output tokens.

## Current state

`map_usage` in `crates/gg/src/client.rs` reads `completion_tokens` and
`completion_tokens_details.reasoning_tokens` from the response and records
`output` as the difference. The provider's figures are trusted as given.

On 2026-09-23 a run of `moonshotai/kimi-k3`, served by Sail Research, recorded
2,481 output tokens over 155 program turns. Per turn the provider reported
`reasoning_tokens` equal to `completion_tokens`, so a reply gg measured at 230
tokens (`responseOutputTokens` on the `turn_outcome` event) was recorded as 0
output and 230 reasoning. A run of `x-ai/grok-4.7` on the same day recorded
the two consistently. The billed total is unaffected, since both halves are
priced as output, but every per-turn and per-run output figure The Test
Cabinet publishes for the affected models is wrong, and nothing in the
telemetry keeps the provider's original object to check against.

## Design

The `usage` event carries the provider's usage object verbatim as `wire`,
beside the mapped counts, so a disagreement can be read off the record.

The split is bounded by the reply gg has: output tokens are at least the
reply's own estimated size, and reasoning is what remains of
`completion_tokens` after that. A provider whose details are consistent with
the reply is recorded as given. A provider whose reasoning figure leaves the
reply no room is recorded with the reply's size as output, and the `usage`
event marks the row `reconciled` so the console can show that the figure was
gg's rather than the provider's.

Describe the bound and the `wire` and `reconciled` fields on the telemetry page
for the `usage` event.

## Done when

- [x] The `usage` event carries the provider's usage object verbatim.
- [x] A reply is never recorded with fewer output tokens than its own size, and
      a reconciled row is marked.
- [x] The telemetry page describes the bound and the fields.
- [x] Gates green.
