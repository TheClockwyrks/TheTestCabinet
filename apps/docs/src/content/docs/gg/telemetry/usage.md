---
title: "Usage"
---

One `usage` event rides on the stream per model call that reported tokens or
cost, emitted on the stream of the agent that made the call. The events are
deltas: summing one `(profile, model)` key's events reproduces that key's
`slot_usage` rollup, so a consumer sums the deltas or the rollups, never both.

## What the event carries

| Field                  | What it carries                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `profileId`, `modelId` | The agent [profile](/gg/configurations/#identity) and the model that spent the tokens.                                                    |
| `tokens`               | The call's four normalized token classes, with output and reasoning split as described below.                                             |
| `cost`                 | The call's cost, when the provider reported one.                                                                                          |
| `provider`             | The upstream provider that served the call, when the gateway named one.                                                                   |
| `figure`               | `work` when the call's reply produced a program or a tool call gg ran, `total` otherwise. See [`maxCost`](/gg/execution-limits/#maxcost). |
| `wire`                 | The provider's usage object, verbatim as the gateway returned it. Present on every row whose call reported usage.                         |
| `reconciled`           | `true` on a row whose output and reasoning figures are gg's bound rather than the provider's split. Omitted otherwise.                    |

`wire` keeps the provider's own keys and every field gg maps nothing onto, so a
disagreement between the provider's figures and the recorded split can be read
off the row.

Every call is in the run's total cost, and the calls marked `work` are also in
its work cost. A call whose reply gg rejected or could not read is recorded
with the usage it reported and marked `total`.

## The output split

A provider reports its completion total as `completion_tokens` and, in
`completion_tokens_details.reasoning_tokens`, how much of that total was
reasoning. gg bounds that split by the reply it received. Output is at least the
reply's own estimated size, which is gg's estimate of the reply's text and tool
calls: the same estimate its [context accounting](/gg/context-visibility/)
charges the reply. Reasoning is what remains of `completion_tokens`.

A provider whose reasoning figure leaves the reply room under the completion
total is recorded as given, with output as `completion_tokens` minus
`reasoning_tokens`. A provider whose reasoning figure leaves the reply less room
than its estimated size is recorded with that size as output and the remainder as
reasoning, and the row carries `reconciled`. When the estimated size exceeds the
completion total, output is the whole total and reasoning is zero.

Output plus reasoning equals `completion_tokens` on every row, so the billed total
is the provider's either way. A call that reported no completion total,
returned an empty reply, or returned a reply gg could not read is recorded as
the provider reported it.
