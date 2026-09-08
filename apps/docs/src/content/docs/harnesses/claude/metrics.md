---
title: Metrics
---

Claude Code reports its token usage and its own cost on the terminal `result`
event of its [stream](/harnesses/claude/events/). Usage is aggregated as `Last`:
the values from the final reporting event win, because the `result` event
carries the run's cumulative totals rather than a per-turn delta.

## Token classes

Usage is read from the Anthropic-native field names and folded into the
normalized [token classes](/components/core/metrics/#tokens):

| Normalized class | Claude Code field                                 |
| ---------------- | ------------------------------------------------- |
| Uncached input   | `input_tokens` plus `cache_creation_input_tokens` |
| Cached input     | `cache_read_input_tokens`                         |
| Output           | `output_tokens`                                   |
| Reasoning        | not reported, so `null`                           |

Claude Code reports input that already excludes cached reads, so `input_tokens`
is taken as uncached input with no subtraction. Cache-creation tokens are billed
as input rather than as cache reads, so they fold into the uncached-input class.

Reasoning tokens are counted within `output_tokens` and are not broken out, so
the reasoning class is `null` (not determinable) rather than zero. A Claude Code
run's [token total](/components/core/metrics/#tokens) still reflects them, so
the run participates in token comparisons.

## Cost

Claude Code reports the exact charge for a run as `total_cost_usd` on its
terminal `result` event. That figure is used as both the [comparable and the
actual cost](/components/core/metrics/#harness-reported-cost), and the
OpenRouter price lookup is skipped for two reasons. One provider at one price
already yields a provider-stable charge, which is the normalization the
OpenRouter figure exists to provide. Claude Code also passes the provider's
native model ID, which OpenRouter's catalog lists under different names.
