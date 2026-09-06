---
title: Metrics
---

Kilo Code runs on OpenCode's runtime, so it reports token usage the same way:
per step, in a `tokens` object under `part.tokens` on each `step_finish` record.
Usage is read from `step_finish` alone, and the search is confined to that
`part.tokens` sub-object so the bare cache keys resolve unambiguously. Each
step's usage adds to the running total, so the recorded figures are the sum
across every step.

## Token classes

The [normalized classes](/components/core/metrics/#tokens) are derived from
these keys within `part.tokens`, where the cache counts are nested one level
deeper in a `cache` object:

| Normalized class | Kilo JSON key                |
| ---------------- | ---------------------------- |
| Uncached input   | `input` (plus `cache.write`) |
| Cached input     | `cache.read`                 |
| Output           | `output`                     |
| Reasoning        | `reasoning`                  |

Kilo Code's `input` excludes cached reads, so it is taken as uncached input
directly and `cache.read` is recorded as the cached class. Cached reads are the
bulk of a cache-heavy run, so they carry most of that run's comparable cost.
Cache-creation tokens (`cache.write`) are billed as input and are folded into
the uncached input class.

## Cost

The comparable cost is derived from OpenRouter's listed per-token prices for the
model used, applied to the recorded token classes, rather than from the per-step
cost Kilo Code reports. See [Cost](/components/core/metrics/#cost).
