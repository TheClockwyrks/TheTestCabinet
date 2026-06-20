---
title: Metrics
---

The Antigravity adapter declares `UsageShape::NONE`: it reads **no token fields**
from the harness's output. Every normalized
[token class](/components/core/metrics/#tokens) is therefore zero, and because no
usage is reported, no cost is derived for a run.

## Token classes

| Normalized class | Antigravity source |
| ---------------- | ------------------ |
| Uncached input | _(not reported → `null`)_ |
| Cached input | _(not reported → `null`)_ |
| Output | _(not reported → `null`)_ |
| Reasoning | _(not reported → `null`)_ |

`UsageShape::NONE` declares no JSON keys for any class, so the usage parser has
nothing to read and every class is `null` (not determinable) rather than `0`. In
practice this is moot — Antigravity has no API-key mode, so it never produces a
run to record usage for.

## Cost

Antigravity reports no self-reported cost field, and with no token usage there is
nothing to price through OpenRouter either, so no cost figure is produced. This
reflects the same limitation that makes the harness unavailable: Antigravity
reports no token usage in its non-interactive mode (and authenticates only
through a Google account), so The Test Cabinet has neither usage to normalize nor
a runnable session to record. See the [overview](./) for that availability
limitation.

See [Metrics](/components/core/metrics/) for the cost and token-class contract.
