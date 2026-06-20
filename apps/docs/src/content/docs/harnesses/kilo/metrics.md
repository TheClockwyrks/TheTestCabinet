---
title: Metrics
---

Kilo Code runs on OpenCode's runtime, so it reports its token usage exactly the
way OpenCode does: per step, under `part.tokens` on each `step_finish` event.
Because the numbers are per-step rather than cumulative totals, the aggregation is
`Sum`: the `part.tokens` values across every `step_finish` are added up. The
search is scoped to the `step_finish` event type and the `part.tokens` sub-object,
so the usage is read from exactly one place per step. See
[Metrics](/components/core/metrics/) for the normalized token classes these map
onto.

## Token classes

Within `part.tokens`, the raw JSON keys map onto the normalized classes as
follows. The cache reads and writes are nested one level deeper, in a `cache`
object:

| Normalized class | Kilo JSON key (within `part.tokens`) |
| --- | --- |
| Uncached input | `input` (plus `cache.write`, see below) |
| Cached input | `cache.read` |
| Cache creation | `cache.write` |
| Output | `output` |
| Reasoning | `reasoning` |

Kilo Code's `input` field does not already include the cached reads
(`input_includes_cache` is false), so the value is taken as uncached input
directly. Cache-creation tokens (`cache.write`) are billed as input and are folded
into the uncached input class.

The cache reads are the bulk of a cache-heavy run. A prior version of this mapping
searched the whole record for flat `cacheReadTokens`/`cache_read` keys that this
nested shape never exposes, so every cached-read token was silently dropped —
leaving the comparable cost far too low (a real run that should have cost ~$0.24
was recorded at ~$0.08). Scoping the search to `part.tokens` is what lets the bare
`read`/`write` keys resolve to the cache counts.

## Cost

Kilo Code reports a per-step `cost`, but, like OpenCode, it drives the model
through OpenRouter, so the comparable cost is derived from the OpenRouter prices
for the model used (applied to the normalized token classes above) rather than the
harness-reported figure. With the cached reads now counted, that derived cost
matches Kilo's own per-step cost sum. See
[Cost](/components/core/metrics/#cost) for how the comparable cost is computed.

---

For the normalized token classes and how cost is recorded, see
[Metrics](/components/core/metrics/).
