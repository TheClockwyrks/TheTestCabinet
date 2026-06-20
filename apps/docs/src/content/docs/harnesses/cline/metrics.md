---
title: Metrics
---

Cline's token usage is read from the totals on its terminal `run_result` record.
Because the numbers reported across the stream are cumulative session totals, the
aggregation is `Last`: the last record carrying usage wins rather than summing
per-step deltas. See [Metrics](/components/core/metrics/) for the normalized
token classes these map onto.

## Token classes

The raw JSON keys map onto the normalized classes as follows:

| Normalized class | Cline JSON key |
| --- | --- |
| Uncached input | `inputTokens` − `cacheReadTokens` (plus `cacheWriteTokens`, see below) |
| Cached input | `cacheReadTokens` |
| Cache creation | `cacheWriteTokens` |
| Output | `outputTokens` |
| Reasoning | _(not reported → `null`)_ |

Cline's `inputTokens` is **cache-inclusive** — it already contains the
`cacheReadTokens`, restated alongside it — so `input_includes_cache` is true and
the cache reads are subtracted to recover the uncached input. Counting
`inputTokens` as uncached input *and* `cacheReadTokens` as cached input (the prior
behavior) double-counted every cached read at the full prompt rate: a run whose
real total input was 3.5M tokens and whose real cost was \$1.86 was recorded at
6.6M tokens and \$6.45. The fix was confirmed against a run's per-iteration and
total `cost`, which only reconcile when uncached input is
`inputTokens − cacheReadTokens`. Cache-creation tokens (`cacheWriteTokens`) are
billed as input and are folded into the uncached input class.

Cline does not break out a reasoning-token count in its usage totals, so the
reasoning class is `null` (not determinable) rather than `0` — even for a model
that reasons. Those reasoning tokens are still accounted within `outputTokens`, so
a Cline run's [token total](/components/core/metrics/#tokens) remains meaningful
and the run participates in token comparisons; only the reasoning *breakdown* is
unavailable. This is independent of the [event stream](./events/), which does
surface reasoning *content* as [reasoning](/components/core/events/#reasoning)
events when Cline reports it as a distinct block; some models instead fold their
reasoning into the visible text, and in neither case is a separate reasoning token
count available.

## Cost

Cline reports no cost of its own. It drives the model through OpenRouter, so the
comparable cost is derived from the OpenRouter prices for the model used rather
than a harness-reported figure. See
[Cost](/components/core/metrics/#cost) for how the comparable cost is computed.
