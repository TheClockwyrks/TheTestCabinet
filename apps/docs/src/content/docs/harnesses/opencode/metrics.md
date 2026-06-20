---
title: Metrics
---

OpenCode reports token usage per step, on the `step_start`/`step_finish`
boundary events of its `opencode run --format json` stream. The harness layer
reads those figures from the JSON stream and produces the normalized
[token classes](/components/core/metrics/#tokens). Aggregation is `Sum`: each
usage-bearing line adds to the running total rather than replacing it, so the
recorded totals are the sum across every step.

## Token classes

The normalized classes are derived from these JSON keys (the first match found
anywhere in a usage-bearing record wins):

| Token class | OpenCode key(s) |
| ----------- | --------------- |
| Input | `input` |
| Cached input | `cache_read`, `cacheRead` |
| Cache creation | `cache_write`, `cacheWrite` |
| Output | `output` |
| Reasoning | `reasoning` |

OpenCode's `input` is treated as not including cached reads
(`input_includes_cache` is false), so the cached input is not subtracted from it;
the cache-creation count is folded into the uncached input recorded as the
[uncached input class](/components/core/metrics/#tokens). Reasoning is reported on
its own key and tracked separately from `output`.

These token field names are provider-shaped and best-effort. Like the other
OpenRouter-routed harnesses (Kilo Code and Pi), OpenCode's usage keys are read
from a small set of candidate names and should be confirmed against real CLI
output; the [`raw.jsonl` and `events.jsonl`](/components/core/run-records/#co-located-run-files)
files a run records make it straightforward to verify and refine them against an
actual stream.

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
