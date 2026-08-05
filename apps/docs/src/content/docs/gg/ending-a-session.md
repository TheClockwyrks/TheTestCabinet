---
title: "Ending a session"
---

Every agent gg drives has to say when it is done, and **saying it is always an explicit
call**. There is no shape of reply that means "finished" by implication: a
[tool-calling](/gg/prompts/) turn that requests no tools is an **error**, and a
[responses-as-code](/gg/responses-as-code/) turn ends the session only when the program it
compiled calls the ending function. One rule, both execution modes, no per-run variation.

*Which* call an agent makes depends on the **role it was dispatched in** — see
[ending calls](#ending-calls). None of it is configurable, and this page is a reference
rather than a capability: what used to *gate* an ending — the `completion` capability's
validation commands — is now an [agent-stop hook](/gg/hooks/#agent-stop), which does the
same job for every agent instead of for the profiles that remembered to enable it.

A model that loops emitting prose therefore does not quietly burn its whole turn budget.
On the tool-calling path each text-only reply is an **error turn**; under responses as
code prose is compiled like anything else and fails to, so the turn is a type-strip error.
Either way the run trips its
[consecutive-error and error-rate ceilings](/gg/execution-limits/) and stops early with a
diagnosis, rather than running to exhaustion with nothing to point at.

## Ending calls

An ending is a **result**, and a role's result is not always a summary. An agent doing
work reports what it did; a reviewer returns a verdict, and a verdict that requests
changes is meaningless without the list of changes. Those are different shapes, so they are
different calls, and each call's signature carries exactly what that result is made of.

| Role | Ending calls | Dispatched for |
| --- | --- | --- |
| **Standard** | `finish(summary)` | The root agent, a spawned subagent, an issue's implementer, the merge agent. |
| **Review** | `approve()` / `requestChanges(items)` | An issue's [reviewers](/gg/project-management/). |

Only the role's own group is offered. A reviewer has **no `finish`** — "the work is
complete" is not a verdict it was asked for — and an implementer has no `approve`. In
responses-as-code that is enforced twice, and it needs to be. The guest builds the
program's scope from the role, so the calls a role does not have are not identifiers in
its programs at all, exactly as a withheld tool is not — but that is a property of the
language's SDK rather than of gg, and a language whose SDK is linked as an ordinary
library has every name in scope. So **the membrane holds the role too**, and an ending
call outside the group is refused `unavailable` there. A verdict is the one declaration
nothing downstream re-examines: gg reads the reviewer's answer straight off the ending it
declared, and never re-asks whose it was. In tool calling, only the role's tools are in the
offered set.

The role is checked **before** the declaration's shape, so an agent doing work that calls
`requestChanges([])` is told it is not the one to give verdicts, rather than told to write
a better list of changes it may not request.

An **on-use script** — the code a [skill](/gg/skills/) or a [memory](/gg/memories/) runs
when the agent first reads it — has no ending group at all. It is not the agent's turn: the
model did not write it, does not see it, and is not answering for it, so a skill that could
end the session would end it on nobody's authority.

The calls are named the same in both modes, so ending a session is one vocabulary a model
learns once: `harness.finish(…)` in a program and `finish` as a tool are the same call.
None of them is a registry tool, and none is [ablatable](/gg/toolset-ablation/) —
withholding the only way to end a session is not an arm anyone would run.

### A failing program revokes its own ending

In [responses-as-code](/gg/responses-as-code/), an ending call is a statement in a program
like any other, so a program can call it and then throw. When it does, the ending is
**revoked** and the session continues: a program that failed did not finish the work its
summary claims, and taking the summary at its word would publish a run whose last act was
an error. The model is told the rule once, in its system prompt, rather than on the turn it
happens — the turn carries the [runtime error](/gg/execution-limits/#what-counts-as-an-error)
and nothing else, and the revocation itself is recorded on the run's own stream for the
[operator](/gg/telemetry/). What the model needs in that moment is the fault; what it needs
to know about revocation it needed *before* it wrote the program.

### The shapes are enforced, not parsed

`requestChanges` refuses an **empty** list. It is refused at the membrane, so the run
continues and the model is told what to send instead.

That is the point of typing them. gg used to hand every role the same `finish(summary)`
and read the verdict back out of the summary text — a `REVIEW: APPROVED` marker to match,
a bulleted list to scrape. Every such parse fails by producing a *plausible* answer rather
than an error: a reviewer that rejected the work and listed nothing, leaving the agent
that had to fix it with nothing to act on. A typed call cannot fail that way, because the
shape is refused before it is ever a verdict.

## Issue completion

An agent gg [auto-dispatched to implement a board issue](/gg/project-management/) hands its
work back by **finishing**, under whatever [agent-stop hooks](/gg/hooks/#agent-stop) the
run declares. There is no separate "complete issue" move, so the same lever governs both:
bind a hook to `agent-stop` and an issue can only reach review once its build passes.
