---
title: "Toolset ablation"
---

The set of tools an agent is offered is an experimental variable. gg records the
toolset a run resolved to, and every agent instance reports the surface it was
given, so a study can vary the toolset between arms and read what each arm
actually offered out of the record.

Enabling a capability is what offers its tools, so an ablation is expressed as a
capability set plus the per-agent `disabledTools` list, which strikes individual
tools whose capability is on.

## The toolset on the run record

The session summary records `effective_tools`: the root agent's resolved toolset,
in the order the model was shown it, after capability gating and after
`disabledTools`. The [query language](/gg/analysis/query-language/) exposes it as
`tool.<name>`, written only for the tools a run offered. "Never offered this
tool" is therefore asked as `not tool.<name>`.

## The surface of one agent instance

The run record answers whether an arm applied through `agent_surface`, which
every instance emits once per incarnation with the surface gg resolved for it.
See [telemetry](/gg/telemetry/overview/) for the event itself. It carries:

- `tools` is every gg tool name the instance was offered, in the order the model
  was shown them, including the ending calls its dispatched role may end with.
- `apis` is the capability modules a responses-as-code program binds, and is
  empty for a tool-calling instance.
- `withheld` is the `disabledTools` entries that name a gg tool.
- `execution_mode`, `program_language` and `doc_view_types` are per-agent
  settings a single run may hold two values of, which is what makes an A/B
  within one run readable.

The resolved surface accounts for facts no re-derivation from the configuration
could reach: which [modules](/gg/modules/) bound, which memory strategy is in
force, where the instance stands in an [FSM](/gg/fsms/), and which tools an
ablation struck.

## Names that withhold nothing

`withheld` holds only the `disabledTools` entries that name a gg tool. A name gg
does not recognize is inert: gg warns about it at startup and offers the agent
exactly the surface it would have had. A consumer may therefore state every entry
as an ablation gg applied, without checking it against a vocabulary it has no way
to know.

An entry that names a real tool no enabled capability was contributing stays in
the list. It withholds nothing in practice and is a deliberate setting for one
arm of a sweep. What was offered is `tools`, and neither field derives the other.

## Reading it in the console

In the Instances explorer each agent instance gets a tools file, or an apis file
where it answers as code. A tool the model called leads with its count, and for a
code agent that count is the function's own, because gg records a model-facing
call under the function the program wrote. A tool that was offered and never
called stays in the list reading zero. A withheld tool is listed apart and marked
as withheld.

The Agents panel carries the same material per profile, unioned across the
profile's instances, with the count of instances that were offered each entry. A
profile no instance of which reported a surface is described from its
configuration, and the panel says that whether the ablation applied is unknown.

## Ablating a code agent's tools

Under [responses as code](/gg/responses-as-code/overview/) the guest is linked
against WASI: the container root is preopened at `/`, the network is inherited,
and the process environment, a real clock and a real RNG are available. A program
reaches the filesystem and the network through its own language's standard
library, without a gg tool, and nothing about such a call appears in the offered
set, in the call counts, or in the run's tool records.

Withholding the filesystem or network families from a code agent measures whether
the model reaches for gg's typed surface, which is a different question from the
one the same ablation answers for a tool-calling agent. An ablation that needs
the filesystem or the network genuinely absent has to run in an environment that
lacks it.

`shell` is the exception. WASI p2 exposes no process-spawn interface, so a guest
cannot execute a command through its standard library either. Withholding the
shell family from a code agent withholds the capability, exactly as it does for a
tool-calling agent.
