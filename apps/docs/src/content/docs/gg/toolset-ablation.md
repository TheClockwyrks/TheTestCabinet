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
detail carries the same set unioned across its instances:

- a tool the model **called** leads with its count — and for a code agent that count is
  the **function's own**, since gg records a model-facing call under the function the
  program wrote rather than under whatever tool ran underneath it;
- a tool it was **offered and never called** stays in the list, reading a real `0×` and
  muted — the model ignored it, which is a result about the model;
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

## One confound this page cannot remove: a code agent's own runtime

Under [responses as code](/gg/responses-as-code/) the guest is linked against the full
WASI surface, so a program has the host's filesystem, clock, randomness and sockets
through **the language's own standard library** — not through a gg tool. That is
deliberate ([why](/gg/program-languages/#what-the-host-links-and-why-it-is-the-same-for-every-language)),
and it has a consequence an ablation has to be told about rather than discover.

Withholding the filesystem tools from a code agent does **not** withhold the workspace. It
withholds gg's *typed, recorded* way of reaching it: an arm without `read_file` still has
whatever its language spells `open(path)`, and nothing about that call appears in the
offered set, in the call counts, or in the run's tool records. The same is true of `shell`
and of the network.

So for a code agent, an ablation of the filesystem or shell families measures **whether
the model reaches for gg's surface**, not whether it can reach the resource. That is still
a real and interesting question — it is the question of whether the typed surface earns its
place — but it is not the question the same ablation answers for a tool-calling agent, and
the two arms must not be read as the same experiment. An ablation that needs the resource
genuinely absent has to be run in an environment that lacks it.
