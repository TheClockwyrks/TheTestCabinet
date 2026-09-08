---
title: Metrics
---

Cline reports cumulative session totals rather than per-step deltas, so the last
record in the stream that carries usage wins. That is the terminal `run_result`
record for a completed session.

## Token classes

The raw JSON keys map onto the
[normalized classes](/components/core/metrics/#tokens) as follows:

| Normalized class | Cline JSON key                                              |
| ---------------- | ----------------------------------------------------------- |
| Uncached input   | `inputTokens` − `cacheReadTokens` (plus `cacheWriteTokens`) |
| Cached input     | `cacheReadTokens`                                           |
| Output           | `outputTokens`                                              |
| Reasoning        | not reported, recorded as `null`                            |

Cline's `inputTokens` is cache-inclusive: it already contains the
`cacheReadTokens` restated alongside it, so the cache reads are subtracted to
recover the uncached input. Cache-creation tokens (`cacheWriteTokens`) are
billed as input and are folded into the uncached input class.

Cline reports no reasoning-token count, so the reasoning class is `null` (not
determinable) rather than `0`, even for a model that reasons. Those tokens are
still accounted within `outputTokens`, so a Cline run's token total stays
meaningful and the run participates in token comparisons. Only the reasoning
breakdown is unavailable; the [event stream](/harnesses/cline/events/) still
surfaces reasoning content when Cline reports it as a distinct block.

## Cost

Cline reports no run cost of its own, so the comparable cost is derived from
OpenRouter's listed per-token prices for the model used, applied to the recorded
token classes. See [Cost](/components/core/metrics/#cost).
