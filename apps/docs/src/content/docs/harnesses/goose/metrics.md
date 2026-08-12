---
title: Metrics
---

Goose reports token usage on its terminal `complete` event. The harness layer
reads the token fields from that event and normalizes them into the standard
[token classes](/components/core/metrics/#tokens). Aggregation is `Last`: the
values are cumulative session totals, so the last event that carries them wins.

## Token classes

| Normalized class | Goose JSON key |
| ---------------- | -------------- |
| Uncached input | `input_tokens` |
| Cached input | not reported, so `null` |
| Output | `output_tokens` |
| Reasoning | not reported, so `null` |

Goose's `complete` event carries `input_tokens`, `output_tokens`, and
`total_tokens`, where the total is exactly input plus output. Input is treated
as excluding cached reads, so nothing is subtracted from it.

Goose reports no cache or reasoning breakdown, on `complete` or on the
per-message records, so cached input and reasoning are recorded as `null` (not
determinable) rather than `0`. Cache reads and reasoning tokens are folded into
the flat input and output totals, so a Goose run's [token
total](/components/core/metrics/#tokens) still reflects them and the run
participates in token comparisons.

## Cost

Goose reports no cost of its own, so the comparable cost is derived from the
OpenRouter prices for the model used, applied to the normalized token classes.
The model ID is an OpenRouter slug used unchanged for that lookup. See
[Metrics](/components/core/metrics/) for the cost and token-class contract.
