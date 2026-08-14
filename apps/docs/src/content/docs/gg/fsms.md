---
title: "FSM-driven processes"
---

An FSM agent is a process an agent is driven through. Each state runs an agent
profile, and only the machine decides when one state hands over to the next, so
the order of the work is a property of the configuration rather than of the
model's discretion.

The motivating example is enforcing a test-driven order: write tests, then
implement, then verify with the tests. An agent cannot reach the implementing
state before it has left the test-writing one. gg implements the engine. The
states, the agents they run, and what each transition carries are configuration.

## The shape of a machine

A profile that enables the `fsm` capability is an FSM shell. It takes no turns of
its own, so it carries no model, no prompt, no roster and no other capabilities.
Its whole content is the `states` param: an ordered list of states over the run's
other [agent profiles](/gg/configurations/).

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

The entry state is the first one declared, a position rather than a flag,
matching how the run's root agent is `agents[0]`. A state with no transitions is
terminal: its agent is offered no transition call, so the machine ends when that
agent ends, and its ending is the FSM agent's return value to whoever put it to
work. A machine may loop, so `build → explore` is an ordinary edge.

An FSM shell is namable wherever an agent profile is: as the run's root, as a
`spawn_subagent` target, as an issue's implementer. The whole machine is one
agent, with one id in the tree, one scheduler slot and one return value, so
whoever put it to work cannot tell the difference.

A machine has no model, so the agent dispatched onto one resolves its client from
the entry state's profile, which is also the model a run whose root is a machine
is recorded under. A launch collects no model for a machine, the editor offers it
no such field, and a hand-written set that binds one anyway refuses the launch.

## How a transition happens

The state's agent is offered a `transition_state` call listing exactly the states
it may move to, with each transition's `description` beside it. Naming an
undeclared target is a tool refusal that lists the legal ones; the agent stays
where it is and the run carries on.

The move is deferred to the end of the turn: the call returns, the turn's
remaining tool results are recorded, and only then does gg tear the running
instance down and stand the next state's up. In
[responses-as-code](/gg/responses-as-code/overview/) mode
`gg.delegation.transitionState(…)` is the same deferred declaration, and the
program runs to its end first. The first declaration in a turn stands, a second
is refused, and a turn that also declared an ending keeps the ending. A turn that
also compacted applies the compaction first, so the successor inherits the window
the turn actually produced.

Each incarnation gets a fresh agent id, parents to the one before it, and keeps
the same depth: succession is not delegation, and the depth cap bounds the
delegation tree. Accounting keys on the state's agent profile, so a machine's
cost splits per state in the run's per-slot rollup.

## What a transition carries

`transfer` names the [modules](/gg/modules/) the successor inherits, in the state
they were in rather than as a summary. A transition declaring
`["history", "tasks"]` hands over the whole conversation and the task list
itself, so the successor's first turn opens on its predecessor's thread under its
own system prompt. A system prompt is never one of the things a transfer carries.

The list is explicit. An absent or empty one carries nothing, which is a hard
reset between states, and it is what a recorded configuration has to say out
loud. The console's editor pre-fills `["history"]` on every transition it
creates.

A transition that does not carry `history` gives the successor an empty window,
so gg opens it exactly as it opens a new agent's: the successor's own system
prompt, then the run's build prompt (or, for an agent that was spawned, the brief
it was spawned with), then whatever its own capabilities pre-load, with the
handoff note at the tail. A state that has been reset still knows what the run is
for.

Per module, a transition does one of three things.

| | |
| --- | --- |
| Transferred | Named by the edge and held by the outgoing agent. The live module moves across, with its caps, its mode and (where it has one) its [ownership](/gg/modules/) re-resolved from the receiving profile. |
| Dropped | Held by the outgoing agent and not named, or named but turned off on the receiving profile. Its backing store is deleted. |
| Initialized | Enabled on the receiving profile and not carried. A fresh, empty module, exactly as a new agent would get. |

The successor is told all of this in an opening note at the tail of its window,
along with whatever the transition's `note` argument said. An agent left to
discover an empty task list by calling `add_task` has spent a turn learning
something a sentence could have said.

### Windows of different sizes

A successor's compaction check runs before its first turn against its own window
limit, so an agent moving from a million-token model into a state on a 32k one is
over its window the moment it arrives and compacts immediately. Where two states'
windows differ greatly, configure a [compaction](/gg/compaction/) strategy whose
summarizer runs on a separate model.

## Authoring a machine in the console

A machine is written in the [configuration editor](/gg/configurations/). Setting
a profile's agent type to FSM gives it two tabs, Agent and States, and the States
tab is the process editor: one card per state, in order, with the first badged
entry and a state with no outgoing edges badged terminal.

Per state: a name, the agent it runs as a select over the configuration's other
profiles, and its outgoing edges. Per edge: the target as a select over the
sibling state names, the free-text `description` the model is shown beside the
target, and a checkbox per [module kind](/gg/modules/) for what transfers. A new
edge arrives with History ticked, and an edge carrying nothing says so on its
face.

Two editing affordances exist because the mistakes they prevent are silent ones.
Make entry moves a state to the front rather than asking anyone to reorder
rows. Renaming a state carries its inbound edges, so every transition pointing at
the old name follows it.

The editor refuses to save a machine gg would refuse to launch, in the same words
and beside the row that has to change.

## What is refused at launch

A machine gg cannot run exactly as it is written refuses the launch, and one
refusal names every offending declaration at once.

- An enabled `fsm` capability whose `states` is absent, unparseable, or empty.
- A state with an empty name, or two states with the same name.
- A state whose `agent` names a profile the set does not declare.
- A transition whose `to` names a state the machine does not declare.
- An FSM shell named as a state's `agent`. A machine cannot be a state of another
  machine.
- A `transfer` entry naming something that is not a module kind.
- A `transfer` entry naming a module the outgoing state's own agent does not
  hold. The successor would open with an empty one under a configuration that
  says it continues.
- A state unreachable from the entry state. The machine would run a strictly
  smaller process than the one written.
- An FSM shell declaring any of a worker's configuration: a model binding, a
  prompt, a roster, or capabilities other than `fsm`. The editor offers a machine
  none of these fields, so this is a hand-written set.

## Telemetry

Each incarnation emits an `fsm_state` event on its own stream naming the machine,
the state it entered, the profile that state runs, and the state it came from
(absent for the entry state). Each succession emits an `agent_transition` on the
outgoing instance's stream, immediately before the successor's `agent_spawned`,
carrying what each module did. Together they are what lets the console render a
succession as a lineage rather than as unrelated agents that happened to appear
in order.

## Relation to exec and fork

A transition is one of the three [successions](/gg/fork-and-exec/) gg performs,
and all three are the same operation over [modules](/gg/modules/). What a machine
adds is that the order is declared: a state's agent may move only where the table
says, carrying only what the edge names. An agent standing in a state is offered
no `exec`, because inside a process the next move belongs to the process. `fork`
stays available: a copy of a state's agent is a second worker, not a second
driver of the machine.

An `exec` may name an FSM shell, which enters that machine at its entry state.
That is how an ordinary agent hands its work to a declared process.
