---
title: Metrics
---

Pi reports token usage on its JSON event stream. The harness layer reads the
token fields the code looks for today out of that stream and produces the
normalized [token classes](/components/core/metrics/#tokens). Aggregation is
`Last`: each usage-bearing line replaces the running total rather than adding to
it, so the final reported totals are the ones recorded.

## Token classes

As the code reads them today, the normalized classes are derived from these JSON
keys (each class is read from the first of its candidate keys that is present):

| Token class | Pi keys |
| ----------- | ------- |
| Input | `input_tokens`, `inputTokens`, `input` |
| Cached input | `cached_input_tokens`, `cacheReadTokens` |
| Output | `output_tokens`, `outputTokens`, `output` |
| Reasoning | `reasoning_output_tokens`, `reasoningTokens` |

Pi's input is inclusive of cached reads (`input_includes_cache` is true), so the
cached input is subtracted from it to yield the uncached input recorded as the
[uncached input class](/components/core/metrics/#tokens). Pi has no
cache-creation class. Reasoning is read from its own keys and tracked separately
from the output keys, which already exclude it.

These token field names are provider-shaped and best-effort: the names read for
Pi (along with Kilo Code and OpenCode) are inferred from the underlying
provider's usage shape and are still to be confirmed against real CLI output, so
they may not match exactly what the harness emits today.

## Cost

Pi does not self-report a run cost — its usage shape declares no cost field — so
there is no harness-reported figure to use. The comparable cost is therefore
always OpenRouter-derived: under the `Passthrough` pricing model the model ID is
already an OpenRouter slug, and the comparable cost is computed from OpenRouter's
listed per-token prices applied to the recorded token classes.

---

For how these classes and the comparable cost are defined, see
[Metrics](/components/core/metrics/).
