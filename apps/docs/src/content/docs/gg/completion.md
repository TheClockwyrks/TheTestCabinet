---
title: "Completion"
---

Every gg run needs a rule for **when it is done**. Historically that rule was fixed per
execution mode: a [tool-calling](/gg/prompts/) turn that requested no tools ended the
run, and a [responses-as-code](/gg/responses-as-code/) program ended it by calling
`finish`. The **completion** capability makes that rule configurable per agent, along two
independent knobs that compose with both execution modes.

It is off by default, and — like every capability — it is per agent, so one run can give
its root a loose rule and its implementers a strict, validated one. An absent or disabled
capability yields the historical defaults exactly, so a run that never configures
completion behaves as it always has.

gg makes the rule configurable **so its effect can be measured**: an explicit `finish`
versus an implicit stop, a validated completion versus an unchecked one, are the kind of
question gg exists to answer.

## The completion signal

The capability's **implementation** selects how the model says it believes the work is
done.

| Signal | What ends a tool-calling run |
| --- | --- |
| **Plain text** (default) | A reply that requests **no tools**. What an unconfigured run does. |
| **Explicit `finish` call** | The model must call the **`finish`** tool. A reply with no tool call is **not** a completion — it is an error fed back to the model. |

The `finish` tool takes a short `summary` of the completed work, which becomes the run's
final message. It is a loop-level tool gg appends to the offered set and intercepts
itself; it is not a registry tool, and it is not
[ablatable](/gg/toolset-ablation/) — withholding the only way to finish is not an arm
anyone would run.

Under the explicit signal a model that loops emitting prose does not quietly burn its
whole turn budget: each text-only reply is an **error turn**, so the run trips its
[consecutive-error and error-rate ceilings](/gg/execution-limits/) and stops early with a
diagnosis, rather than running to exhaustion with nothing to point at.

### Responses-as-code is always explicit

A [responses-as-code](/gg/responses-as-code/) agent's every reply is a program, and no
*shape* of program means "finished" — so such a run always ends through its program's
`harness.finish()` call. The signal is therefore **inert** in code mode: a code-mode agent
is locked to explicit completion whatever the picker says, and the console shows the
signal fixed rather than offering a choice that would do nothing. (A plain-text signal
stored on a code-mode agent is ignored, and gg says so at launch.)

## Validation commands

The capability's **`validation`** param is an ordered list of commands that **gate** a
completion — in either execution mode, under whichever signal is in force. When the model
signals it is done, gg runs them in order, and the run only ends if **every one exits
`0`**. A failing command's output is handed back to the model, which then keeps working
and signals completion again.

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
[shell output policy](/gg/shell/#output-offloading), so a failing test suite that arrives by the
megabyte is offloaded exactly as a `shell` call's output would be.

An empty or absent `validation` leaves completion **ungated** — the model's word is taken
for it, which is what an unconfigured run does.

## Issue completion

An agent gg [auto-dispatched to implement a board issue](/gg/project-management/) hands its
work back by **finishing**, under whatever completion rule that agent's own profile
configures. There is no separate "complete issue" move, so the same lever governs both:
put an explicit signal and a validation gate on your implementer profile and an issue can
only reach review once its build passes.

## Configuring it

In the console's [configuration editor](/gg/configurations/), **Completion** sits under
**Process & quality** on each agent. Its **Completion signal** picker offers the two
signals (fixed to the explicit call for a responses-as-code agent), and its **Validation
commands** rows take a command, an optional working directory, and an optional timeout.

| Param | Default | Meaning |
| --- | --- | --- |
| `implementation` | `plain-text` | The [completion signal](#the-completion-signal). |
| `validation` | — (ungated) | The [commands](#validation-commands) that gate a completion. |
