---
title: Metrics
---

Claude Code reports its token usage and its own cost on the terminal `result`
event of its [stream](./events/). The harness layer reads usage with an
aggregation of `Last`: the values from the final reporting event win, since the
`result` event carries the run's cumulative totals rather than a per-turn delta.

## Token classes

Usage is read from the Anthropic-native field names and folded into the
normalized [token classes](/components/core/metrics/#tokens):

| Normalized class | Claude Code field |
| ---------------- | ----------------- |
| Uncached input | `input_tokens` (plus `cache_creation_input_tokens`) |
| Cached input | `cache_read_input_tokens` |
| Output | `output_tokens` |
| Reasoning | _(not reported → `null`)_ |

Claude Code reports input as **already excluding** cached reads
(`input_includes_cache` is false), so `input_tokens` is taken as uncached input
directly, with no subtraction. Cache-creation tokens
(`cache_creation_input_tokens`) are billed as input rather than cache reads, so
they are folded into the uncached-input class. Claude Code does not break out
reasoning tokens, so the reasoning class is `null` (not determinable) rather than
zero; those tokens are still counted within `output_tokens`, so a Claude Code
run's [token total](/components/core/metrics/#tokens) stays meaningful and the run
participates in token comparisons — only the reasoning breakdown is unavailable.

## Cost

Claude Code drives the Anthropic API directly through an API key and reports the
exact charge for a run as `total_cost_usd` on its terminal `result` event. That
figure is used directly as **both** the [comparable and the actual
cost](/components/core/metrics/#harness-reported-cost), and the OpenRouter price
lookup is skipped:

- Talking to one provider at one price already yields a provider-stable charge,
  so the normalization the OpenRouter figure exists to provide does not apply.
- Claude Code passes the provider's native model ID, which is not guaranteed to
  appear in OpenRouter's catalog, so a lookup would fail regardless.

See the [metrics](/components/core/metrics/) reference for the normalized token
classes and the comparable/actual cost contract.
