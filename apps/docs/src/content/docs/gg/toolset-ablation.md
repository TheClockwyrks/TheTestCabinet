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

## Reading the arm on a single run

Aggregation compares the arms; it does not tell you whether one run's arm was really
applied. For that, every agent instance reports the toolset gg **resolved** for it, on the
run's own stream — see [`agent_surface`](/gg/telemetry/#what-an-agent-is-offered). That is
the configuration after it was applied, not the configuration itself: capabilities,
[modules](/gg/modules/) that actually bound, position in an [FSM](/gg/fsms/), and the
per-agent `disabledTools` that strike a tool whose capability is on.

So the console can state the difference this page exists to make. In the **Instances**
explorer each agent gets a **tools** file (**apis**, for a
[code-shaped](/gg/responses-as-code/) agent), and in the **Agents** panel each profile's
detail leads with the same set unioned across its instances:

- a tool the model **called** carries its count — for a code agent that figure belongs to
  the tool and is named with it, since one tool can gate several of the functions a program
  may write;
- a tool it was **offered and never called** stays in the list, dimmed — the model ignored
  it, which is a result about the model;
- a tool `disabledTools` **withheld** is listed apart and marked as such — the harness
  never offered it, which is a result about the run.

That third list is gg's own, carried on the surface event beside the offered set rather
than re-read from the configuration, and it holds only the `disabledTools` entries that
**name a gg tool**. A name gg does not know — a typo, a tool since removed — is absent
from it, because it withheld nothing: gg treats such a name as inert, warns about it at
startup (*"it is not a tool gg offers, so it withholds nothing"*), and offers the agent
exactly the surface it would have had. So the panel cannot show an ablation that never
applied as applied, which on the one page whose job is telling *never offered* from
*never called* would be the worst thing it could say. The configuration speaks for itself
in exactly one place: an arm no instance of which ever reported a surface — one the run
never spawned, or a record written before gg emitted the event — where the **Agents**
panel names the ablation the arm *asked for* and says, in as many words, that whether it
applied is unknown.

Without the offered set the second and third are the same empty space on the page, which
is precisely the confound an ablation is trying to remove. It is also how you catch an arm
that never took, in either of its two shapes: an ablation whose withheld tool still
appears in an instance's offered set is a configuration that did not do what it said, and
a `disabledTools` entry that reaches neither list — absent from the offered set and absent
from the withheld one — is a name gg never recognized, which the run log will have warned
about.
