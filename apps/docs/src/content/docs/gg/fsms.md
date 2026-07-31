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
skip to "implement" before "write tests", because each state runs a different agent
and only the machine decides when one hands over to the next.

The machine is **entirely yours**. gg implements the engine; the states, the agents
they run, and what each transition carries are configuration.

## The shape of a machine

An agent profile that enables the `fsm` capability is an **FSM shell**. It has no
turns of its own — its model binding and its other capabilities are ignored — and its
whole content is the `states` param: an ordered list of states over the run's *other*
[agent profiles](/gg/configurations/#agents).

```jsonc
{
  "name": "Feature",
  "capabilities": [
    {
      "id": "fsm",
      "enabled": true,
      "params": {
        "states": [
          {
            "name": "explore",
            "agent": "Explorer",
            "transitions": [
              { "to": "build", "transfer": ["history", "tasks"],
                "description": "when you understand the change and have a task list" }
            ]
          },
          {
            "name": "build",
            "agent": "Builder",
            "transitions": [
              { "to": "verify", "transfer": ["history", "tasks"],
                "description": "when the change compiles and you are ready to check it" },
              { "to": "explore", "transfer": ["memories"],
                "description": "when the change turns out to need more understanding" }
            ]
          },
          { "name": "verify", "agent": "Verifier", "transitions": [] }
        ]
      }
    }
  ]
}
```

- **The entry state is the first one declared.** It is a position rather than a flag,
  matching how the run's root agent is `agents[0]` — a document that says which one
  starts in two places can disagree with itself.
- **A state with no transitions is terminal.** Its agent is offered no transition call
  at all, so the machine ends when that agent ends, and its ending is the FSM agent's
  return value to whoever put it to work.
- **A machine may loop.** `build → explore` is an ordinary edge; nothing about the
  table has to be acyclic.

An FSM shell is namable everywhere an agent profile is: as the run's root, as a
`spawn_subagent` target, as an issue's implementer, as a workflow stage. Whoever put
it to work cannot tell the difference — the whole machine is **one agent**, with one
id in the tree, one scheduler slot, and one return value.

## How a transition happens

The state's agent is offered a `transition_state` call listing exactly the states it
may move to, with each transition's `description` beside it — the same shape
`spawn_subagent` lists the agents it may spawn. Naming an undeclared target is a
**tool refusal** that lists the legal ones: the agent stays where it is and the run
carries on.

The move itself is deferred to the end of the turn, exactly as an ending is: the call
returns, the turn's remaining tool results are recorded, and only then does gg tear the
running instance down and stand the next state's up. In
[responses-as-code](/gg/responses-as-code/) mode `agents.transitionState(…)` is the
same deferred declaration — the program runs to its end first, because replacing the
agent (and its window) mid-program would pull every remaining call out from under it.
The **first** declaration in a turn stands; a second is refused, and a turn that also
declared an ending keeps the ending.

Each incarnation gets a fresh agent id, parents to the one before it, and keeps the
**same depth**: succession is not delegation, and the depth cap exists to bound the
delegation tree. Accounting keys on the state's agent profile, so a machine's cost
splits per state in the run's per-slot rollup.

## What a transition carries

`transfer` names the [modules](/gg/modules/) the successor inherits — in the state
they were in, not as a summary. A transition declaring `["history", "tasks"]` hands
over the whole conversation and the task list itself; the successor's first turn opens
on its predecessor's thread, with its own system prompt rebased in over the top.

**The list is explicit, and an absent or empty one carries nothing.** That is a
deliberate hard reset between states rather than an oversight: a recorded configuration
has to say what it does, and a default nobody wrote down is exactly the sort of decision
a reader of the record cannot see. The console's editor pre-fills `["history"]` on every
transition it creates, so the common case is still one click.

Per module, a transition does one of three things:

| | |
| --- | --- |
| **Transferred** | Named by the edge and held by the outgoing agent — the live module moves across, with its caps, mode and ownership re-resolved from the receiving profile. |
| **Dropped** | Held by the outgoing agent and not named (or named, but turned off on the receiving profile) — its backing store is deleted. |
| **Initialized** | Enabled on the receiving profile and not carried — a fresh, empty module, exactly as a new agent would get. |

The successor is **told** all of this in an opening note at the tail of its window,
along with whatever the transition's `note` argument said. An agent left to discover an
empty task list by calling `add_task` has spent a turn learning something a sentence
could have said.

### Windows of different sizes

A successor's compaction check runs before its first turn, against **its own** window
limit — so an agent moving from a million-token model into a state on a 32k one is over
its window the moment it arrives, and compacts immediately. gg does not try to be clever
about the mismatch. If two states' windows differ greatly, configure a
[compaction](/gg/compaction/) strategy whose summarizer runs on a separate model. That
is a configuration decision, not something the harness should be guessing at.

## What is refused at launch

These are **launch failures**, in the same class as a roster reference naming an
undeclared profile — a run carrying one is not a differently-configured run, it is an
unrunnable one:

- an enabled `fsm` capability whose `states` is absent, unparseable, or empty;
- a state with an empty name, or two states with the same name;
- a state whose `agent` names a profile the set does not declare;
- a transition whose `to` names a state the machine does not declare;
- an FSM shell named as a state's `agent` — a machine cannot be a state of another
  machine.

These are **warnings**: the machine still runs, and what it will actually do is stated
on the root agent's stream before the first turn.

- a `transfer` entry naming something that is not a module kind (it carries nothing);
- a state unreachable from the entry state (it is kept, but nothing can enter it);
- an FSM shell declaring capabilities other than `fsm` (they are ignored).

## Telemetry

Each incarnation emits an `fsm_state` event on its own stream naming the machine, the
state it entered, the profile that state runs, and the state it came from (absent for
the entry state). Each succession emits an `agent_transition` on the **outgoing**
instance's stream, immediately before the successor's `agent_spawned`, carrying what
each module did — transferred, dropped, or initialized fresh.

Together they are what lets the console render a succession as a lineage rather than as
N unrelated agents that happened to appear in order.

## The built-in machines are gone

gg's first FSM engine shipped a small library of **harness-authored** machines — `tdd`
and `plan-first` — selected by a `machine` param. Both were removed, along with the
planning capability whose read-only mode and fresh-context reset `plan-first` reused. A
machine only the harness can author is a machine only the harness can study, and a fixed
pair of built-ins was an answer to a question a configuration should be able to ask for
itself.

A configuration written against the old engine does **not** silently degrade into an
ordinary single agent: `"machine": "tdd"` with no `states` is a launch failure. That is
the one intentional hard break in this rework, and it is deliberate — a run recorded as
"the TDD arm" that was nothing of the sort would poison every comparison drawn from it.
