---
title: Metrics
---

The Antigravity adapter declares `UsageShape::NONE`, which names no JSON keys for
any token class. The usage parser has nothing to read, so every normalized
[token class](/components/core/metrics/#tokens) is recorded as not determinable
rather than zero.

## Token classes

| Normalized class | Antigravity source |
| ---------------- | ------------------ |
| Uncached input   | (not reported)     |
| Cached input     | (not reported)     |
| Output           | (not reported)     |
| Reasoning        | (not reported)     |

## Cost

The usage shape declares no cost field, so a run carries no harness-reported
cost. With no token counts there is nothing to price from the model's list
price either, so a run produces no cost figure at all.

See [Metrics](/components/core/metrics/) for the cost and token-class contract.
