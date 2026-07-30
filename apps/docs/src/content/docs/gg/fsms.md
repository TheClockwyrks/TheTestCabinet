---
title: "FSM-driven processes"
---

A structured alternative to [workflows](/gg/workflows/) built on a **finite state
machine**. Where a workflow is a fan-out plus sequencing the agent assembles, an FSM
is a **process the agent is driven through**.

The motivating example is enforcing a **test-driven development** order:

```
write tests → implement → verify with tests
```

as opposed to the default `implement → write tests`. The FSM makes the *order* a
property of the process, not a matter of the model's discretion — the agent cannot
skip to "implement" before "write tests" because the machine will not let it.

## The capability is currently inert

:::caution
gg drives **no** state machine at present. Enabling the `fsm` capability produces a
launch warning naming the agent profile, and that agent runs as an ordinary agent.
:::

gg's first FSM engine shipped a small library of **harness-authored** machines —
`tdd` and `plan-first` — selected by a `machine` param. Both have been removed,
along with the planning capability whose read-only mode and fresh-context reset
`plan-first` reused. A machine only the harness can author is a machine only the
harness can study, and a fixed pair of built-ins was an answer to a question a
configuration should be able to ask for itself.

The replacement is a **user-authored** state table over the run's other
[agent profiles](/gg/configurations/#agents): each state binds a profile, and a
transition replaces the running agent instance with the next state's, carrying the
[modules](/gg/modules/) the transition names. That is not implemented yet; this page
is updated when it lands.

A configuration written against the old engine does not silently degrade. Because a
capability id is an open string, a set naming `"machine": "tdd"` still loads — and
gg says, before the first turn, that nothing is driving the run.
