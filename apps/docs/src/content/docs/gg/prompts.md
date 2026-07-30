---
title: "Prompts"
---

Everything gg _says_ to a model is authored as a **Handlebars template**, not as a
string literal in Rust. The templates live in
[`crates/gg/templates/`](https://github.com/TheClockwyrks/the-test-cabinet/tree/master/crates/gg/templates)
and are embedded into the binary at compile time, so gg keeps its
[no-external-resources](/gg/overview/#installation--distribution) property: the binary
carries its own prompts.

This is the same templating idiom — and the same strict-mode, no-escaping engine — that
renders a test case's [`prompt.hbs`](/testing/end-to-end/overview/#prompt-template).

| Template                   | What it renders                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-tools.hbs`         | The **tool-calling** system prompt: the base framing plus one section per enabled capability, each naming its free-standing tools (`add_task`, `create_epic`).                         |
| `system-code.hbs`          | The **responses-as-code** system prompt: the same capability sections with their calls in grouped-method form (`tasks.addTask`, `project.createEpic`), plus the code-protocol framing. |
| `tasks.hbs`                | The pinned [task list](/gg/tasks/) block.                                                                                                                                              |
| `board.hbs`                | The pinned [Project management](/gg/project-management/) board block.                                                                                                                  |
| `memories.hbs`             | The pinned [memories](/gg/memories/) block.                                                                                                                                            |
| `code-result.hbs`          | The turn feedback for a [responses-as-code](/gg/responses-as-code/) program that ran — its call roster, its output, and anything it needs telling.                                     |
| `code-transpile-error.hbs` | The turn feedback for a [program](/gg/responses-as-code/) that did not compile, so nothing ran.                                                                                        |
| `code-sandbox-error.hbs`   | The turn feedback for a [program](/gg/responses-as-code/) the sandbox could not run to a result — a memory ceiling or a trap.                                                          |
| `code-timeout.hbs`         | The turn feedback for a [program](/gg/responses-as-code/) the sandbox stopped at its execution timeout — its own message, because a timeout means a program that did not terminate.    |
| `code-not-a-program.hbs`   | The turn feedback for a reply that was not a program at all — prose, empty, comments only, or several candidate blocks.                                                                |

### The briefs gg dispatches with

A **brief** is the whole task from its reader's point of view: it is the only thing a
freshly spawned agent has ever been told. They are product text of exactly the same weight
as the system prompt, so they live in the same place.

| Template            | What it renders                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-brief.hbs`   | A [board issue](/gg/project-management/) as its assigned agent is given it — title, overview, in/out of scope, and what "done" means.                |
| `review-brief.hbs`  | The [reviewer](/gg/project-management/)'s brief: the issue brief, earlier verdicts, and where the work is and what it touched.                       |
| `fix-brief.hbs`     | The brief an issue's own agent is re-dispatched with after a review requested changes — the issue brief plus the reviewer's numbered items.          |
| `merge-brief.hbs`   | The merge agent's brief when an issue's branch conflicts: which branch, and what git reported.                                                       |
| `attempt-brief.hbs` | One attempt's brief in a [speculative execution](/gg/speculative-execution/) — the shared task and its assigned approach if any.                     |
| `judge-brief.hbs`   | The judge's brief for a [speculative execution](/gg/speculative-execution/): the task and each candidate's own summary.                              |

### The rest of the loop's prose

| Template                                | What it renders                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `compaction-instruction.hbs`            | The message that opens an in-loop [compaction](/gg/compaction/), one section per requirement (summary, `compact` call, memory writes) and mode. |
| `compaction-unsatisfied.hbs`            | The feedback for a reply that satisfied the pending compaction in no way at all — the instruction again, prefaced by what went wrong.           |
| `compaction-refusal.hbs`                | The refusal that answers a call the pending compaction does not accept, naming both what was refused and what is wanted.                        |
| `compaction-handoff-summary.hbs`        | The system prompt the `handoff-summarization` strategy gives the separate compaction model.                                                     |
| `compaction-handoff-compact.hbs`        | The system prompt the `handoff-compaction` strategy gives the separate compaction model, which answers with a `compact` call.                   |
| `compaction-preface.hbs`                | The summary item a compacted thread is restarted from — the heading that frames it as a recap, then the summary itself.                         |
| `compaction-fallback.hbs`               | The note used when the summarization call fails, so a failed summary never aborts the run it serves.                                            |
| `compaction-memory-summary.hbs`         | What a `memory` compaction restarts the thread from: a bare note that a boundary was crossed, rather than a recap.                              |
| `completion-missing.hbs`                | The feedback for a tool-calling turn that requested no tools, naming this agent's own [ending calls](/gg/completion/#ending-calls).             |
| `completion-validation-failure.hbs`     | The feedback for an ending a [validation command](/gg/completion/) rejected: which command failed, and its output.                              |
| `context-pressure.hbs`                  | The per-turn [context-pressure](/gg/agent-managed-context/) signal — how full the window is, what is filling it, and how to reclaim space.      |

## The system prompt is assembled from the capability set

gg's whole premise is that capabilities are independently toggleable, and that extends
to the prompt: **a capability that is off contributes no prompt text at all**. That is
what makes an [ablation](/gg/overview/#the-capability-set) clean — the off arm's model
is never told about a feature it does not have.

So each system template is one `{{#if}}` section per capability, over a rendering context
that carries both _whether_ each capability is on and _how it is configured_. A run's actual
limits are interpolated inline rather than restated in prose:

- the `read_file` [line cap](/gg/filesystem/#read-modes), and whether it is a hard
  ceiling or a default the agent may exceed;
- the [memories](/gg/memories/) budget (count, per-memory length, total length);
- the [task](/gg/tasks/) count ceiling;
- the [Project management](/gg/project-management/) epic and issue ceilings;
- the catalog of available [skills](/gg/skills/), each with its description.

The rendering context is a typed Rust struct (`prompts::SystemContext`), and rendering
runs in **strict mode**: a template that references a variable the context does not
carry fails rather than silently rendering a blank. The struct is therefore the
documented list of what a template may reference, and the crate's tests render every
template with the capability sections both on and off — so a typo in a `.hbs` file fails
the build instead of reaching a model.

Because each prompt is one self-contained file, editing it is editing prose: rewording the
tasks section, reordering the capability sections, or tightening the base framing needs no
Rust change.

## Two whole templates, chosen by execution mode

[Responses as code](/gg/responses-as-code/) does not just add to the tool-calling prompt —
it rewrites it. Every capability's calls change shape (there is no free-standing `add_task`
in code mode, only `tasks.addTask`, a method on the `tasks` object), and the base framing's
ending rule and tool listing are replaced wholesale. So the two arms are **separate files**,
`system-tools.hbs` and `system-code.hbs`, and `prompts::render_system` selects between them
on the run's execution mode. An operator's per-agent template override still renders against
the same context in either mode; the console seeds its editor with whichever built-in default
matches the agent's mode.

The code arm teaches two things the tool-calling arm has no need of, and each is gated on
something about the run:

- **What a reply _is_.** The model's whole reply is the program: no fence, no language
  tag, no prose around it, exactly one program per reply — with a top-level `return`
  named as the thing that ends it, since a model that pastes a second draft after the
  first is pasting it after a `return` — and nothing that narrates a result the model has
  not seen yet. **No backtick fence appears anywhere in the rendered code-mode
  prompt** — every worked example is indented instead, and a test asserts it — because an
  example is the one part of a prompt a model copies verbatim, so a fenced one would both
  re-teach the abolished contract and corrupt the instruction-following signal the
  capability exists to collect.
- **Why not to fence**, gated on whether [healing](/gg/response-healing/)'s fence
  stripping is armed. With it off, a fence really is a syntax error on line 1 and the
  prompt says so; with it on, that sentence would be false — gg strips the fence and says
  it did — and a model that tested the claim would learn that gg's rules are negotiable.
  The armed arm therefore states the repair honestly and calls it a repair rather than
  the contract.

Both arms then carry an **Ending your session** section naming this agent's own
[ending calls](/gg/completion/#ending-calls) — `finish`, the two review verdicts, or
`selectWinner` — spelled the way that execution mode writes them. It is the only place
the ending is taught: the briefs gg dispatches with say nothing about it, because a brief
that restated the contract would be a second authority on it, arriving later in the
context and therefore winning any disagreement. That is how a code-mode reviewer once came
to be told to end with a final message its protocol does not have.

## The pinned blocks carry state, not instructions

The [task list](/gg/tasks/), [board](/gg/project-management/), and
[memories](/gg/memories/) are each pushed into the window as a **pinned** block that is
rebuilt whenever the model changes it. Those blocks are **state only** — a heading and
the current items:

```text
# Your tasks
- [x] `scaffold` (done) — Scaffold the project
- [ ] `movement` (pending) — Player movement  [blocked by `scaffold`]
```

How to _use_ the tools that maintain them is stated once, in the system prompt's section
for that capability, gated on the capability being enabled. Saying it in both places
would spend context re-teaching `add_task` on every refresh, for the life of the session
— and would give the model two texts to reconcile whenever they drifted apart.

The derived parts of a block — whether an item is _ready_ or _blocked by_ specific
incomplete items — are computed in Rust by the store that owns the DAG. The template only
lays the result out.
