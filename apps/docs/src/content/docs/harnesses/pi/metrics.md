---
title: Metrics
---

Pi reports token usage per assistant message, in a `usage` object under
`message.usage` on each `message_end` event. The harness layer reads usage from
`message_end` alone and confines the search to that `message.usage` sub-object,
so usage restated on the surrounding `turn_end` is never double-counted. Each
message's usage adds to the running total, and the recorded totals are the sum
across every message of the run.

## Token classes

The normalized classes are derived from these keys within `message.usage`:

| Token class | Pi key |
| ----------- | ------ |
| Uncached input | `input`, plus any `cacheWrite` count |
| Cached input | `cacheRead` |
| Output | `output` |
| Reasoning | (not reported) |

Pi's `input` is the uncached prompt and excludes cached reads, which sit beside
it under `cacheRead` and become the
[cached input class](/components/core/metrics/#tokens). Any `cacheWrite` count
folds into the uncached input.

Pi reports no separate reasoning class, so reasoning is recorded as not
determinable rather than zero. Those tokens are still counted within `output`, so
a Pi run's token total stays meaningful and the run participates in token
comparisons.

## Cost

Pi's usage shape declares no cost field, so a run carries no harness-reported
cost. The comparable cost is computed from OpenRouter's listed per-token prices
applied to the recorded token classes, looked up under the run's model ID, which
is already an OpenRouter slug.

For how these classes and the comparable cost are defined, see
[Metrics](/components/core/metrics/).
