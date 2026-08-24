---
title: "Ending a session"
---

Every agent gg drives ends its session with an explicit call. A tool-calling
turn that requests no tools is an error turn, and a responses-as-code turn ends
the session only when the program it compiled calls its ending function. The
rule is the same in both execution modes and is not configurable.

A model that loops emitting prose therefore trips the run's
[consecutive-error and error-rate ceilings](/gg/execution-limits/) and stops
early with a diagnosis rather than running to exhaustion. On the tool-calling
path each text-only reply is an error turn. Under responses as code a reply
that makes no `submit_program` call is the same error turn: only a submitted
`program` string is ever compiled, and reply text never is.

## Ending calls

The role an agent was dispatched in decides which call it makes. An agent doing
work reports what it did. A reviewer returns a verdict, and a verdict that
requests changes carries the list of changes. Each call's signature carries
exactly what that result is made of.

| Role | Ending calls | Dispatched for |
| --- | --- | --- |
| Standard | `finish(summary)` | The root agent, a spawned subagent, an issue's implementer, the merge agent. |
| Review | `approve()` / `requestChanges(items)` | An issue's [reviewers](/gg/project-management/). |

Only the role's own group is offered: a reviewer is given no `finish`, and an
implementer no `approve`. Both modes name the same three calls. The tool-calling
loop offers the synthetic tools `finish`, `approve` and `request_changes`; a
program calls `gg.session.finish`, `gg.session.approve` and
`gg.session.requestChanges`, each spelled the way its own language spells it.

None of the three is a registry tool. No capability offers them and no toolset
arm withholds them, so every agent always has the calls its role gives it.

### Where the role is enforced

Under responses as code every arm's [SDK](/gg/languages/static-sdks/) declares
all three calls, so the [sandbox membrane](/gg/responses-as-code/sandbox/) is
where the role is checked: an ending call outside the agent's group is refused as
`unavailable`, with a message naming the endings the agent does have. On the
tool-calling path only the role's own tools are in the offered set.

The role is checked before the declaration's shape, so an agent doing work that
calls `requestChanges([])` is told it is not the one to give verdicts.

An on-use script, being the code a skill or a memory runs on every use, is given
no ending group at all. The model did not write it and is not
answering for it.

### The declared shapes

`finish` requires a non-empty summary, and `requestChanges` requires at least
one change. `requestChanges` trims its entries and drops blank ones before that
check, so the agent that has to act on the list always has something to act on.
Both refusals are made at the membrane: the model is told what to send instead
and the session continues.

gg reads a reviewer's answer straight off the ending it declared. Nothing
downstream re-derives the verdict from prose.

## Revoked endings

Under responses as code an ending call is a statement in a program like any
other, so a program can call it and then throw. The ending is revoked and the
session continues, because the declaration rests on checks the program never
finished running. The turn's feedback carries the
[runtime error](/gg/execution-limits/#what-counts-as-an-error) alone, and the
revocation is reported on the run's own stream for the operator. The rule itself
is stated once in the system prompt, which is where a model needs it.

Declaring an ending sets a flag rather than unwinding the program, so a program
runs on after declaring one and may declare again. The last declaration is the
one gg reads, and the count of superseded declarations is reported to the
operator.

## The ending gate

An ending passes the agent's `agent-stop` [hooks](/gg/hooks/) before the session
ends, in both execution modes and for every role. A blocking hook hands its
reason back to the model and the session continues, so the model fixes the
problem and declares again. A run that can never satisfy the gate goes on taking
turns until it trips a ceiling.

## Issue completion

An agent [dispatched to implement a board issue](/gg/project-management/) hands
its work back by finishing, under whatever `agent-stop` hooks the run declares
for it. gg has no separate "complete issue" call, so one lever governs both:
bind a hook to `agent-stop` and an issue reaches review only once its build
passes.
