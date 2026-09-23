---
title: "Usage"
---

Every model call that reports usage emits one `usage` event, on the stream of the
agent that took the turn. It carries that call's four normalized token classes and
its cost, named to the agent [profile](/gg/configurations/#identity) and the model
that spent them, beside the upstream provider that served the call. The events are
deltas, so a consumer sums them; the `slot_usage` rollups, one per
`(profile, model)`, carry the same figures for the durable record, and a consumer
sums one, never both.

Attribution on each delta is what makes a live multi-model run readable: summing
one `(profile, model)` key's deltas reproduces that key's rollup exactly, so the
per-model split is derivable from the first turn rather than once an agent ends.

## The output split

A provider reports its completion total and, in `completion_tokens_details`, how
much of that total was reasoning. gg records output as the remainder. The
provider's split is recorded as given when it is consistent with the reply gg
holds — when the reply fits under it. Otherwise the split is bounded by the reply:
output is never recorded below the reply's own estimated size, the figure the
[message log](/gg/context-visibility/#the-message-log) charges the reply, and
reasoning is what remains of `completion_tokens` after it.

The bound exists because a provider's reasoning figure can leave the reply no room.
A provider that reports `reasoning_tokens` equal to `completion_tokens` on every
turn would otherwise record every reply it serves as zero output and all reasoning,
however large the reply gg measures in its own hand. On such a row output is
recorded as the reply's own size and the event marks the row `reconciled`, so a
reader of the record can tell gg's figure from the provider's.

The total is the provider's either way. Reasoning is priced as output, so the
billed figure is unaffected, and `output` plus `reasoning` is `completion_tokens`
on every row.

## The provider's object

`wire` carries the provider's usage object verbatim, exactly as the gateway
returned it, beside the mapped counts. It is present on every row that reported
usage, so a disagreement between the provider's own figures and the split gg
recorded is checkable from the record rather than invisible: a dashboard figure and
a published per-turn output figure can be read against each other and against the
row's own `reconciled` flag.

| Field        | What it carries                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `wire`       | The provider's usage object, verbatim as the gateway returned it, beside the mapped counts. Present whenever the call reported usage.     |
| `reconciled` | Set on a row whose output/reasoning split is gg's bound rather than the provider's. Absent on a row recorded as the provider reported it. |
