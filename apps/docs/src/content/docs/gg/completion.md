---
title: "Completion"
---

Every agent gg drives has to say when it is done, and **saying it is always an explicit
call**. There is no shape of reply that means "finished" by implication: a
[tool-calling](/gg/prompts/) turn that requests no tools is an **error**, and a
[responses-as-code](/gg/responses-as-code/) reply that is not a program is an error. One
rule, both execution modes, no per-run variation.

*Which* call an agent makes depends on the **role it was dispatched in** — see
[ending calls](#ending-calls). The **completion** capability configures the one thing that
genuinely varies between studies: the [validation commands](#validation-commands) that
gate the ending.

A model that loops emitting prose therefore does not quietly burn its whole turn budget:
each text-only reply is an **error turn**, so the run trips its
[consecutive-error and error-rate ceilings](/gg/execution-limits/) and stops early with a
diagnosis, rather than running to exhaustion with nothing to point at.

## Ending calls

An ending is a **result**, and a role's result is not always a summary. An agent doing
work reports what it did; a reviewer returns a verdict, and a verdict that requests
changes is meaningless without the list of changes; a judge names which attempt won. Those
are three different shapes, so they are three different calls, and each call's signature
carries exactly what that result is made of.

| Role | Ending calls | Dispatched for |
| --- | --- | --- |
| **Standard** | `finish(summary)` | The root agent, a spawned subagent, an issue's implementer, a [speculation](/gg/speculative-execution/) attempt, the merge agent. |
| **Review** | `approve()` / `requestChanges(items)` | An issue's [reviewers](/gg/project-management/). |
| **Judge** | `selectWinner(attempt, rationale)` | A [speculation](/gg/speculative-execution/)'s judge. |

Only the role's own group is offered. A reviewer has **no `finish`** — "the work is
complete" is not a verdict it was asked for — and an implementer has no `approve`. In
responses-as-code that is enforced by scope: the calls a role does not have are not
identifiers in its programs at all, exactly as a withheld tool is not. In tool calling,
only the role's tools are in the offered set.

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

`requestChanges` refuses an **empty** list, and `selectWinner` refuses an attempt number
outside the range the judge was shown. Both are refused at the membrane, so the run
continues and the model is told what to send instead.

That is the point of typing them. gg used to hand every role the same `finish(summary)`
and read the verdict back out of the summary text — a `REVIEW: APPROVED` marker to match,
a bulleted list to scrape. Every such parse fails by producing a *plausible* answer rather
than an error: a reviewer that rejected the work and listed nothing (leaving the agent
that had to fix it with nothing to act on), or a judge whose marker line never appeared.
A typed call cannot fail that way, because the shape is refused before it is ever a
verdict.

## Validation commands

The capability's **`validation`** param is an ordered list of commands that **gate** an
ending — in either execution mode, for any role. When the model signals it is done, gg
runs them in order, and the session only ends if **every one exits `0`**. A failing
command's output is handed back to the model as a **`Notice`** — the harness's band for a
process fact the model could not otherwise know, which a rejected ending is: nothing the
program did went wrong, the run simply is not over. It then keeps working and signals
again.

Each entry names a `command` (run through `sh -c`, exactly as the [shell](/gg/shell/) tool
runs one), and optionally:

| Field | Default | Meaning |
| --- | --- | --- |
| `command` | — (**required**) | The command line. |
| `cwd` | the agent's workspace root | Where to run it. A relative path is joined onto the workspace; an absolute path is used as-is. |
| `timeoutSecs` | 300 | How long it may run before it is killed. Generous, because a validation command is typically a build or a test suite. |

Commands run **fail-fast**: the first non-zero exit stops the batch, because a later
command usually depends on an earlier one (a test suite on a build) and its output would
only add noise to the one the model must actually fix. Output goes through the agent's own
[shell output policy](/gg/shell/#output-offloading), so a failing test suite that arrives
by the megabyte is offloaded exactly as a `shell` call's output would be.

An empty or absent `validation` leaves the ending **ungated** — the model's word is taken
for it, which is what an unconfigured run does.

## Issue completion

An agent gg [auto-dispatched to implement a board issue](/gg/project-management/) hands its
work back by **finishing**, under whatever validation gate that agent's own profile
configures. There is no separate "complete issue" move, so the same lever governs both:
put a validation gate on your implementer profile and an issue can only reach review once
its build passes.

## Configuring it

In the console's [configuration editor](/gg/configurations/), **Completion** sits under
**Process & quality** on each agent. Its **Validation commands** rows take a command, an
optional working directory, and an optional timeout.

| Param | Default | Meaning |
| --- | --- | --- |
| `validation` | — (ungated) | The [commands](#validation-commands) that gate an ending. |
