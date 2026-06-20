---
title: Metrics
---

Codex reports token usage as cumulative totals on its terminal items — the
`usage` object carried by `turn.completed`. The harness layer reads those totals
from the JSON stream and produces the normalized
[token classes](/components/core/metrics/#tokens). Aggregation is `Last`: each
usage-bearing line replaces the running total rather than adding to it, so the
final reported totals are the ones recorded.

## Token classes

The normalized classes are derived from these JSON keys:

| Token class | Codex key |
| ----------- | --------- |
| Input | `input_tokens` |
| Cached input | `cached_input_tokens` |
| Output | `output_tokens` |
| Reasoning | `reasoning_output_tokens` |

Codex's `input_tokens` is inclusive of cached reads (`input_includes_cache` is
true), so the cached input is subtracted from it to yield the uncached input
recorded as the [uncached input class](/components/core/metrics/#tokens). Codex
has no cache-creation class. Reasoning is reported on its own key
(`reasoning_output_tokens`) and tracked separately from `output_tokens`, which
already excludes it.

## Cost

Codex does not self-report a run cost — its usage shape declares no cost field —
so there is no harness-reported figure to use. The comparable cost is therefore
always OpenRouter-derived: the bare OpenAI model ID is prefixed with `openai/`
(for example `gpt-5.5` becomes `openai/gpt-5.5`), and the comparable cost is
computed from OpenRouter's listed per-token prices applied to the recorded token
classes.

---

For how these classes and the comparable cost are defined, see
[Metrics](/components/core/metrics/).
