---
title: "FSM-driven processes"
---

A structured alternative to [workflows](/gg/workflows/) built on **predetermined
finite state machines**. Where a workflow is a fan-out plus sequencing the agent
assembles, an FSM is a **fixed, named process** the agent is driven through.

The motivating example is enforcing a **test-driven development** order:

```
write tests → implement → verify with tests
```

as opposed to the default `implement → write tests`. The FSM makes the *order* a
property of the process, not a matter of the model's discretion — the agent cannot
skip to "implement" before "write tests" because the machine will not let it.

FSMs compose with other capabilities: [planning](/gg/planning/)'s "plan then
implement from a fresh context" is itself a small FSM, and
[speculative execution](/gg/speculative-execution/) is a `fan-out → judge → merge`
machine.

FSMs are **authored as part of the harness** — a built-in library shipped with gg
(for example the TDD-ordered and plan-first machines), not a per-study
data format and not something the model defines for itself. Selecting which FSM (if
any) drives a run is part of the [capability set](/gg/overview/#the-capability-set).
