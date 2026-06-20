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
| Uncached input | _(none read — always 0)_ |
| Cached input | _(none read — always 0)_ |
| Output | _(none read — always 0)_ |
| Reasoning | _(none read — always 0)_ |

`UsageShape::NONE` declares no JSON keys for any class, so the usage parser finds
nothing to read and all four classes stay at their default of 0.

## Cost

Antigravity reports no self-reported cost field, and with no token usage there is
nothing to price through OpenRouter either, so no cost figure is produced. This
reflects the same limitation that makes the harness unavailable: Antigravity
reports no token usage in its non-interactive mode (and authenticates only
through a Google account), so The Test Cabinet has neither usage to normalize nor
a runnable session to record. See the [overview](./) for that availability
limitation.

See [Metrics](/components/core/metrics/) for the cost and token-class contract.
