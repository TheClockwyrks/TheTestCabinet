---
title: "Toolset ablation"
---

Because gg's [modularity comes from the toolset](/gg/overview/#modularity-through-tools),
the **set of tools offered to agents is itself an experimental variable**. Toolset
ablation makes that variable first-class: the toolset is recorded as part of the
[capability set](/gg/overview/#the-capability-set) and exposed as a slice-by facet
in [result aggregation](/gg/result-aggregation/), so "which tools actually matter?"
is a query, not a guess.

This is the purest expression of gg's reason for existing. Because switching a
capability on or off *is* offering or withholding its tools, most ablation studies
reduce to varying the toolset. Examples:

- Does an agent with semantic search do better than one with `grep` only?
- Does `apply-patch` beat whole-file `write-file`, or vice versa?
- Does **removing** a tool the model over-uses improve results?

It costs almost nothing beyond what the capability set and aggregation already
provide, which makes it the cheapest way to start producing findings.
