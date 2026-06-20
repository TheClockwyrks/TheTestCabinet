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

Goose reports no cache fields, so cached input is always 0 and the full
`input_tokens` value is counted as uncached input. Input is not treated as
cache-inclusive (`input_includes_cache = false`), so nothing is subtracted from
it. No reasoning tokens are read.

## Cost

Goose reports no self-reported cost field, so its comparable cost is derived from
the OpenRouter prices for the model used, applied to the normalized token
classes. The model ID is an OpenRouter slug passed through unchanged for that
lookup.

See [Metrics](/components/core/metrics/) for the cost and token-class contract.
