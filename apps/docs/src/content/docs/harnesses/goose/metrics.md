---
title: Metrics
---

Goose reports token usage on its terminal `complete` event. The harness layer
reads the token fields from that event and normalizes them into the standard
[token classes](/components/core/metrics/#tokens). Usage uses the `Last`
aggregation: the values are cumulative session totals, so the last event that
carries them wins.

## Token classes

| Normalized class | Goose JSON key |
| ---------------- | -------------- |
| Uncached input | `input_tokens` |
| Cached input | _(none read)_ |
| Output | `output_tokens` |
| Reasoning | _(none read)_ |

This is the whole of what Goose reports: its `complete` event carries only
`input_tokens`, `output_tokens`, and `total_tokens` (where `total` is exactly
`input + output`). There is no cache or reasoning breakdown anywhere in the
stream — not on `complete`, and not on the per-message records — so cached input
and reasoning are recorded as 0. This is a limitation of Goose's reporting, not a
parsing gap: even when Goose drives a cache-backed model and emits extensive
reasoning (its `thinking` blocks, surfaced as
[reasoning](/components/core/events/#reasoning) events in the
[event stream](./events/)), those reads and reasoning tokens are folded into the
flat `input_tokens`/`output_tokens` totals and cannot be separated out. Input is
not treated as cache-inclusive (`input_includes_cache = false`), so nothing is
subtracted from it.

## Cost

Goose reports no self-reported cost field, so its comparable cost is derived from
the OpenRouter prices for the model used, applied to the normalized token
classes. The model ID is an OpenRouter slug passed through unchanged for that
lookup.

See [Metrics](/components/core/metrics/) for the cost and token-class contract.
