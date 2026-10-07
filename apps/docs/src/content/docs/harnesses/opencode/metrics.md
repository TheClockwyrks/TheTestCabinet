---
title: Metrics
---

OpenCode reports token usage per step, in a `tokens` object under `part.tokens`
on each `step_finish` record of its `opencode run --format json` stream. Usage
is read from `step_finish` alone, and the search is confined to that
`part.tokens` sub-object so the bare cache keys resolve unambiguously. Each
step's usage adds to the running total, so the recorded figures are the sum
across every step.

## Token classes

The [normalized classes](/components/core/metrics/#tokens) are derived from
these keys within `part.tokens`, where the cache counts are nested one level
deeper in a `cache` object:

| Normalized class | OpenCode key                 |
| ---------------- | ---------------------------- |
| Uncached input   | `input` (plus `cache.write`) |
| Cached input     | `cache.read`                 |
| Output           | `output`                     |
| Reasoning        | `reasoning`                  |

OpenCode's `input` excludes cached reads, so it is taken as uncached input
directly and `cache.read` is recorded as the cached class. Cache-creation tokens
(`cache.write`) are billed as input and are folded into the uncached input
class. Reasoning is reported on its own key and tracked separately from
`output`.

## Cost

OpenCode reports no run cost of its own, so the comparable cost is computed
from the model's curated list price. The `openrouter/` prefix is stripped from
the model ID (`openrouter/minimax/minimax-m3` is priced as
`minimax/minimax-m3`) and the list price's rates are applied to the recorded
token classes. See [Cost](/components/core/metrics/#cost).
