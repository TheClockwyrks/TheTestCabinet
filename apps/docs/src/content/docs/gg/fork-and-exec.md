---
title: "Exec & fork"
---

Two calls let an agent change what it is and how many of it there are.

- `exec` replaces the running instance with one running another
  [agent profile](/gg/configurations/). Everything both profiles have moves
  across live, the conversation above all, so the successor continues rather than
  being caught up.
- `fork` runs a copy of the agent: a child with its model, its tools and a
  private copy of its whole conversation, working a second line in parallel.

They are two capabilities, `exec` and `fork`, enabled independently. Both are the
same operation over [modules](/gg/modules/) that an
[FSM transition](/gg/fsms/) performs, with the model choosing when it happens
rather than a declared machine.

## `exec`

```jsonc
{
  "id": "exec",
  "enabled": true
}
```

The call takes an `agent` and an optional `prompt`, the successor's opening
message. The target is validated against the agent's own delegation roster, the
same allowlist `spawn_subagent` is checked against. Naming an agent that is not
on the roster is a tool refusal listing the ones that are.

### What the successor gets

Keyed on capability presence, per [module](/gg/modules/):

| | |
| --- | --- |
| Present in both | Transferred. The live module, with its contents, re-resolved against the successor's profile. `history` is in every set, which is why an exec'd successor opens on its predecessor's whole conversation. |
| Held, but the successor's profile turns it off | Dropped. Its backing store is deleted. |
| Enabled on the successor and not held before | Initialized fresh: an empty task list, an empty notebook. |

The successor is told all three in an opening note at the tail of the window it
inherited, along with whatever the `prompt` said. An agent left to discover an
empty task list by calling `add_task` has spent a turn learning something a
sentence could have said.

The system prompt is not on that table, because it never crosses. It describes
the agent it was rendered for: its toolset, its roster, its capability prose, and
the calls that end its session. The prompt is not a message in the thread at all.
It lives in a [slot of its own](/gg/context-visibility/) that
renders first on every request, the window crosses the boundary with that slot
empty, and the successor's own prompt is set before its first turn. The same
holds for a `fork`'s copy.

### One agent throughout

Each incarnation gets a fresh agent id, parents to the one before it, and keeps
the same depth. Succession is not delegation, and the depth cap bounds the
delegation tree. The whole chain runs on one scheduler slot and produces one
return value, so whatever put the agent to work cannot tell that anything
happened.

A fresh id per incarnation gives the successor its own message pool, so its
telemetry stream re-states every context message it references and is
self-contained. Per-slot accounting keys on the profile each incarnation actually
ran, so an exec'd session splits its cost between the agents that spent it.

### Windows of different sizes

The successor's compaction check runs before its first turn against its own
window limit, so an agent that filled a million-token window and then became one
on a 32k model is over its window the moment it arrives and
[compacts](/gg/compaction/) immediately. Where the two profiles' windows differ
greatly, configure a compaction strategy whose summarizer runs on a separate
model.

A model that compacts and hands off in the same turn applies the compaction
first, on both execution paths, so the successor inherits the window the turn
actually produced.

### Entering a machine

Naming an [FSM shell](/gg/fsms/) enters that machine at its entry state and runs
the entry state's agent, which is how a plain agent hands its work to a declared
process. The opening note says so, and the transfer is computed against the entry
state's profile rather than against the shell's.

An agent already standing in a machine state is offered no `exec` at all. Inside
a process the next move belongs to the process, and `transition_state` is how it
is made. `fork` stays available there: a copy is a second worker, not a second
driver of the machine.

## `fork`

```jsonc
{
  "id": "fork",
  "enabled": true
}
```

The call takes a `prompt`: what the copy should do that its forker will not. It
takes no `agent`, because a fork can only ever be the agent making it. A subagent
starts from a brief somebody had to write; a copy starts already knowing
everything its forker worked out.

The copy is an ordinary child from there: its own id, one level deeper, its own
scheduler slot, the same depth and parallelism caps, `agent_spawned` telemetry,
and the same `wait_for_subagents` and `send_message` handles every other subagent
has. The forker gets the copy's id back on the call, exactly as `spawn_subagent`
returns one.

`fork` needs a way to collect what it makes, so it is offered only when the
agent's profile also carries [subagents](/gg/subagents/), which is what
contributes `wait_for_subagents` and `send_message`. The roster is not part of
that test, since a fork names no target: an agent whose allowlist is empty can
still fork itself, and gets those two collection calls on account of the fork.

### What a copy holds

Everything, cloned: the copy runs the very profile the original does. The window
above all, deep-copied, with the turn counter carried rather than restarted so a
later `archive_thread` from either copy names the same turns.

Memories follow the forker's [scope](/gg/memories/):

| Scope | The copy's memories |
| --- | --- |
| `isolated` | An independent copy; the two diverge |
| `shared` | The same profile-bound instance |
| `inherited` | Linked to the forker's instance, read/write; both are holders and both get notices |
| `read-only` | Linked to the forker's instance; the copy may not write it, because its own profile says so |

Every scope that links agents at all stays linked across a fork.

The copy's opening message names the agent and the turn it was forked from, says
the original is still running its own copy of that conversation in parallel, and
carries the `prompt`.

## Turn finality

A call declares; the loop applies, once every tool result of the turn has been
recorded. A window rewritten or copied mid-turn would carry an assistant message
whose tool results had not been written yet, which an OpenAI-shaped provider
rejects outright, and under
[responses-as-code](/gg/responses-as-code/overview/) it would pull the very
window a running program is composing into out from under it.

Two consequences the tool descriptions state outright:

- A fork cannot be waited on in the turn that created it. Its id is real from the
  moment the call returns, and it is a child once the turn ends. Collect it on a
  later turn.
- A turn makes one succession. The first `exec` or `transition_state` stands and
  a second is refused, because an invisibly replaced successor identity is a
  change the model cannot see. An ending declared in the same turn beats both.

Forks are the exception to first-wins. They are additive, so a turn may declare
several and every one of them runs. A fork declared in a turn that also finished
still runs: handing work to somebody else and then ending your own session is not
a retraction.

## Configuring them

Each is its own capability, so an arm is a capability set rather than a setting
inside one. Enabling `exec` alone leaves an agent able to become something else
but not to duplicate itself, and `fork` alone leaves it able to work two lines at
once but not to change what it is. Both are off by default.

Each is also individually grantable through an agent's
[allowlist](/gg/configurations/#granting-calls), on the same terms as every other
call.

## What is warned at launch

Each of these leaves the run runnable and a call simply absent, which is the one
misconfiguration a model can never report: it never makes the call, and the
record reads as an agent that chose not to. Each warning names the capability
that will come up short, so an agent that enables only `fork` is never told about
a roster it has no use for.

- A profile enabling `exec` with an empty roster. There is nothing for it to
  become.
- A profile enabling `fork` without `subagents`. There would be no
  `wait_for_subagents` and no `send_message` to collect a copy with, so `fork` is
  withheld.
- A profile enabling `exec` that a declared machine runs as one of its states.
  `exec` is withheld there; `fork` is unaffected.

## Telemetry

Every succession emits an `agent_transition` event on the outgoing instance's
stream, immediately before the new agent's `agent_spawned`, carrying
`kind: "exec"`, `"fork"` or `"fsm"` and what each module did. It is what lets the
console show a handoff as a handoff and a copy as a copy.

An `exec` that entered a machine also emits an `fsm_state` for the entry state on
the successor's stream, with no `from`: it came from outside the process.
