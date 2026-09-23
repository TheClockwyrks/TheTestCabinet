---
title: Metrics
---

Codex reports token usage as cumulative totals in the `usage` object carried by
`turn.completed`. The harness layer reads those totals from the [JSON
stream](/harnesses/codex/events/) and produces the normalized [token
classes](/components/core/metrics/#tokens). Aggregation is `Last`: each
usage-bearing line replaces the running total, so the final reported totals are
the ones recorded.

## Token classes

| Normalized class | Codex key                                 |
| ---------------- | ----------------------------------------- |
| Uncached input   | `input_tokens` less `cached_input_tokens` |
| Cached input     | `cached_input_tokens`                     |
| Output           | `output_tokens`                           |
| Reasoning        | `reasoning_output_tokens`                 |

Codex's `input_tokens` is inclusive of cached reads, so the cached input is
subtracted from it to yield the uncached input. Codex has no cache-creation
class. Reasoning is reported on its own key and tracked separately from
`output_tokens`, which already excludes it.

## Cost

Codex reports no cost of its own, so the comparable cost is computed from the
model's list price. The bare OpenAI model ID is prefixed with `openai/`, so
`gpt-5.5` resolves to the catalog entry as `openai/gpt-5.5`, and the comparable
cost is computed from the entry's list price applied to the recorded token
classes. See [Metrics](/components/core/metrics/) for that contract.
