---
title: Metrics
---

OpenCode reports token usage **per step**, in a `tokens` object under
`part.tokens` on each `step_finish` event of its `opencode run --format json`
stream. The harness layer reads usage from `step_finish` alone and confines the
search to that `part.tokens` sub-object. Aggregation is `Sum`: each step's usage
adds to the running total, so the recorded totals are the sum across every step.

## Token classes

The normalized classes are derived from these keys within `part.tokens`, where
the cache counts are nested one level deeper in a `cache` object:

| Token class | OpenCode key |
| ----------- | ------------ |
| Input | `input` |
| Cached input | `cache.read` |
| Cache creation | `cache.write` |
| Output | `output` |
| Reasoning | `reasoning` |

OpenCode's `input` does **not** include cached reads (`input_includes_cache` is
false), so the cache read count (`cache.read`) is recorded directly as the
[cached input class](/components/core/metrics/#tokens); any `cache.write` count is
folded into the uncached input. Reasoning is reported on its own key and tracked
separately from `output`. Confining the search to `part.tokens` is what lets the
bare `read`/`write` cache keys resolve unambiguously.

These field names were confirmed against a real OpenCode run's recorded stream.
OpenCode routes through OpenRouter, so its usage shape remains provider-dependent;
the [`raw.jsonl` and `events.jsonl`](/components/core/run-records/#co-located-run-files)
files a run records make it straightforward to re-verify them against an actual
stream.

## Cost

OpenCode does not self-report a run cost — its usage shape declares no cost field
— so there is no harness-reported figure to use. The comparable cost is
therefore always OpenRouter-derived: the `openrouter/` prefix is stripped from
the model ID (for example `openrouter/minimax/minimax-m3` becomes
`minimax/minimax-m3`), and the comparable cost is computed from OpenRouter's
listed per-token prices applied to the recorded token classes.

---

For how these classes and the comparable cost are defined, see
[Metrics](/components/core/metrics/).
