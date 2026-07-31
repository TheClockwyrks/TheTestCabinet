---
title: "Fork & exec"
---

Two calls that let an agent change **what it is** and **how many of it there are**:

- **`exec`** — become a different agent. The running instance is replaced by one running
  another [agent profile](/gg/configurations/#agents), and everything both profiles have
  moves across live: the conversation above all, so the successor is not caught up, it
  simply *continues*.
- **`fork`** — run a copy of yourself. A child agent with your model, your tools and a
  private copy of your whole conversation, working a second line in parallel.

Both come from the `agent-transitions` capability, and both are the same operation over
[modules](/gg/modules/) that an [FSM transition](/gg/fsms/) performs — with the *model*
choosing when it happens rather than a declared machine.

## `exec` — become another agent

```jsonc
{
  "id": "agent-transitions",
  "enabled": true
}
```

The call takes an `agent` and an optional `prompt` (the successor's opening message). The
target is validated against the agent's own **delegation roster** — the same allowlist
`spawn_subagent` is checked against, because putting a profile to work is putting a profile
to work and a separate "may be exec'd into" scope would be contract surface earning nothing.
Naming an agent that is not on the roster is a tool refusal listing the ones that are.

Naming **yourself** is legal, when your roster admits you. It re-initializes every module
the two of you both have, which is a deliberate self-reset rather than a mistake.

### What the successor gets

Keyed on capability presence, per [module](/gg/modules/):

| | |
| --- | --- |
| **Present in both** | **Transferred** — the live module, with its contents, re-resolved against the successor's profile. `history` is in every set, which is why an exec'd successor opens on its predecessor's whole conversation. |
| **Held, but the successor's profile turns it off** | **Dropped** — its backing store is deleted. |
| **Enabled on the successor and not held before** | **Initialized fresh** — an empty task list, an empty notebook. |

The successor is **told** all three, in an opening note at the tail of the window it
inherited, along with whatever the `prompt` said. An agent left to discover an empty task
list by calling `add_task` has spent a turn learning something a sentence could have said.

### It is one agent throughout

Each incarnation gets a fresh agent id, parents to the one before it, and keeps the **same
depth**. Succession is not delegation: the depth cap exists to bound the delegation tree,
and a chain of execs that exhausted it would be measuring the wrong thing. The whole chain
runs on **one scheduler slot** and produces **one return value**, so whatever put the agent
to work cannot tell that anything happened.

A fresh id per incarnation is deliberate — it gives the successor its own message pool, so
its telemetry stream re-states every context message it references and is self-contained,
which is what the console's per-agent reduction needs.

Per-slot accounting keys on the profile each incarnation actually ran, so an exec'd session
splits its cost between the agents that spent it.

### Windows of different sizes

The successor's compaction check runs before its first turn, against **its own** window
limit — so an agent that filled a million-token window and then became one on a 32k model
is over its window the moment it arrives, and [compacts](/gg/compaction/) immediately.

gg does not try to be clever about the mismatch. If the two profiles' windows differ
greatly, configure a compaction strategy whose summarizer runs on a **separate model** (the
`model` / `modelSlot` handoff). That is a configuration decision, and one gg has no basis
for guessing at.

A model that compacts and hands off in the **same turn** is not a special case either: the
compaction is applied first, on both execution paths, so what the successor inherits is the
window the turn actually produced rather than the one it started with.

### Becoming a whole process

If the named agent is an [FSM shell](/gg/fsms/), the successor **enters that machine** at
its entry state and runs the state's agent — which is how a plain agent hands its work to a
declared process. Its opening note says so, and the transfer is computed against the entry
state's profile rather than against the shell's.

The reverse is refused: an agent already standing in a machine state is **not offered
`exec` at all**. Inside a process the next move belongs to the process, and
`transition_state` is how it is made. `fork` stays available there — a copy is a second
worker, not a second driver of the machine.

## `fork` — run a copy of yourself

The call takes a `prompt`: what the copy should do that you will not. It takes no `agent`,
because a fork can only ever be the agent making it — and that is the whole point. A
subagent starts from a brief somebody had to write; a copy starts already knowing
everything its forker worked out.

The copy is an **ordinary child** from there. Its own id, one level deeper, its own
scheduler slot, the same depth and parallelism caps, `agent_spawned` telemetry, and the
same `wait_for_subagents` / `send_message` handles every other subagent has. The forker
gets the copy's id back on the call, exactly as `spawn_subagent` returns one.

Because it is a child, `fork` needs a way to **collect** what it makes: it is offered only
when the agent's profile also carries [subagents](/gg/subagents/), which is what contributes
`wait_for_subagents` and `send_message`. A copy nobody can wait on or message is a leak
rather than a second worker. The **roster** is not part of that test — a fork names no
target — so an agent whose allowlist is empty can still fork itself, and gets those two
collection calls on account of the fork even though it can spawn nobody.
[Workflows](/gg/workflows/) do not qualify: gg drives their stages itself and the capability
offers neither call.

### What a copy holds

Everything, cloned — nothing is dropped and nothing starts empty, because the copy runs the
very profile the original does. The window above all, deep-copied, with the turn counter
carried rather than restarted so a later `archive_thread` from either copy names the same
turns.

Memories are the one exception, and they follow the forker's
[scope](/gg/memories/#scoping-whose-memories-are-these):

| Scope | The copy's memories |
| --- | --- |
| `isolated` | An independent copy — the two diverge |
| `shared` | The same profile-bound instance (they were already one) |
| `inherited` | Linked to the forker's instance, read/write; both are holders, and both get [notices](/gg/memories/#linked-instances-being-told-what-somebody-else-wrote) |
| `read-only` | Linked to the forker's instance; the copy may not write it, because its own profile says so |

A fork is not a reason to split what a configuration deliberately joined, which is why
every scope that links agents at all stays linked across one.

The copy's opening message names the agent and the turn it was forked from, says the
original is still running its own copy of that conversation in parallel, and carries the
`prompt`.

## Both are turn-final

A call **declares**; the loop **applies**, once every tool result of the turn has been
recorded.

That is not a convenience. A window rewritten or copied mid-turn would carry an assistant
message whose tool results had not been written yet, which an OpenAI-shaped provider
rejects outright — and under [responses-as-code](/gg/responses-as-code/) it would pull the
very window a running program is composing into out from under it.

Two consequences the tool descriptions state outright:

- **A fork cannot be waited on in the turn that created it.** Its id is real from the
  moment the call returns, but it is not a child until the turn ends. Collect it on a later
  turn.
- **A turn makes one succession.** The first `exec` or `transition_state` stands and a
  second is refused — an invisibly replaced successor identity is a change the model cannot
  see, which is exactly why a `compact` may be replaced and this may not. An ending declared
  in the same turn beats both: the agent said its work was done, so there is nothing left
  to hand on.

Forks are the exception to first-wins: they are additive, so a turn may declare several and
every one of them runs. A fork declared in a turn that also finished still runs — handing
work to somebody else and then ending your own session is not a retraction.

## Ablation

The two calls are separately withholdable through
[per-tool overrides](/gg/toolset-ablation/): `"disabledTools": ["fork"]` leaves an agent
able to become something else but not to duplicate itself, and the reverse leaves it able
to work two lines at once but not to change what it is. The capability itself is opt-in and
off by default, so every configuration that predates it behaves exactly as it did.

## What is warned at launch

None of these stops a run; each is a call that will simply not be there, which is the one
misconfiguration a model can never report — it never makes the call, and the record reads
as an agent that chose not to.

- a profile enabling `agent-transitions` with an **empty roster** (nothing for `exec` to
  become);
- a profile enabling it without `subagents` (no `wait_for_subagents` and no `send_message`,
  so there would be no way to collect a copy and `fork` is withheld);
- a profile enabling it that a declared machine runs as one of its **states** (`exec` is
  withheld there; `fork` is unaffected).

## Telemetry

Every succession emits an `agent_transition` event on the **outgoing** instance's stream,
immediately before the new agent's `agent_spawned`, carrying `kind: "exec"`, `"fork"` or
`"fsm"` and what each module did — transferred, dropped, or initialized fresh. It is what
lets the console show a handoff as a handoff, and a copy as a copy, rather than as an
unexplained second agent.

An `exec` that entered a machine also emits an `fsm_state` for the entry state on the
successor's stream, with no `from` — it came from outside the process.
