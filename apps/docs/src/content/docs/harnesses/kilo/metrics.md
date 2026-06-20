---
title: Metrics
---

Kilo Code reports its token usage per step, on the step events that bracket each
turn of its OpenCode-style stream. Because the numbers are per-step rather than
cumulative totals, the aggregation is `Sum`: the values across the stream are
added up. See [Metrics](/components/core/metrics/) for the normalized token
classes these map onto.

## Token classes

The raw JSON keys map onto the normalized classes as follows. Kilo Code reports
provider-shaped fields and is read from a small set of candidate keys, accepting
either naming variant:

| Normalized class | Kilo JSON keys |
| --- | --- |
| Uncached input | `inputTokens` / `input` (plus `cacheWriteTokens`, see below) |
| Cached input | `cacheReadTokens` / `cache_read` |
| Cache creation | `cacheWriteTokens` |
| Output | `outputTokens` / `output` |
| Reasoning | `reasoningTokens` / `reasoning` |

Kilo Code's input field does not already include the cached reads
(`input_includes_cache` is false), so the value is taken as uncached input
directly. Cache-creation tokens (`cacheWriteTokens`) are billed as input and are
folded into the uncached input class.

These field names are best-effort. The token reporting for Kilo Code — like
OpenCode and Pi — is provider-shaped and confirmed against real CLI output rather
than a published schema. The mapping reads each value from the candidate keys
above; where the stream has not been captured from a real run, a field that is
absent simply contributes nothing rather than being guessed.

## Cost

Kilo Code reports no cost of its own. It drives the model through OpenRouter, so
the comparable cost is derived from the OpenRouter prices for the model used
rather than a harness-reported figure. See
[Cost](/components/core/metrics/#cost) for how the comparable cost is computed.

---

For the normalized token classes and how cost is recorded, see
[Metrics](/components/core/metrics/).
