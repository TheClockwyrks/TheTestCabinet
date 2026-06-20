---
title: Metrics
---

Pi reports token usage **per assistant message**, in a `usage` object under
`message.usage` on each `message_end` event. The same usage block is restated on
the surrounding `turn_end` (and streamed, all zeros, on `message_update`), so the
harness layer reads usage from `message_end` alone and confines the search to the
`message.usage` sub-object. Aggregation is `Sum`: each message's usage adds to
the running total, so the recorded totals are the sum across every message of the
run.

## Token classes

The normalized classes are derived from these keys within `message.usage`:

| Token class | Pi key |
| ----------- | ------ |
| Input | `input` |
| Cached input | `cacheRead` |
| Cache creation | `cacheWrite` |
| Output | `output` |

Pi's `input` is the uncached prompt and does **not** include cached reads
(`input_includes_cache` is false); the cache read count sits beside it under
`cacheRead` and becomes the
[cached input class](/components/core/metrics/#tokens). Any `cacheWrite` count is
folded into the uncached input. Pi reports no separate reasoning class in its
usage object, so reasoning is recorded as zero.

These field names were confirmed against a real Pi run's recorded stream. Pi
routes through OpenRouter, so its usage shape is still provider-dependent; the
[`raw.jsonl` and `events.jsonl`](/components/core/run-records/#co-located-run-files)
files a run records make it straightforward to re-verify them.

## Cost

Pi does not self-report a run cost — its usage shape declares no cost field — so
there is no harness-reported figure to use. The comparable cost is therefore
always OpenRouter-derived: under the `Passthrough` pricing model the model ID is
already an OpenRouter slug, and the comparable cost is computed from OpenRouter's
listed per-token prices applied to the recorded token classes.

---

For how these classes and the comparable cost are defined, see
[Metrics](/components/core/metrics/).
