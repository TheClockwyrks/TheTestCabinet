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

| Template           | What it renders                                                              |
| ------------------ | ---------------------------------------------------------------------------- |
| `system.hbs`       | The system prompt: the base framing plus one section per enabled capability. |
| `tasks.hbs`        | The pinned [task list](/gg/tasks/) block.                                    |
| `board.hbs`        | The pinned [Project management](/gg/project-management/) board block.        |
| `memories.hbs`     | The pinned [memories](/gg/memories/) block.                                  |
| `plan-mode.hbs`    | The [planning](/gg/planning/) capability's read-only plan-mode guidance.     |
| `plan-framing.hbs` | How an accepted plan is framed as it seeds the fresh implementation context. |
| `code-result.hbs`  | The turn feedback for a [responses-as-code](/gg/responses-as-code/) program that ran — its call roster, its output, and anything it needs telling. |
| `code-transpile-error.hbs` | The turn feedback for a [program](/gg/responses-as-code/) that did not compile, so nothing ran. |
| `code-sandbox-error.hbs` | The turn feedback for a [program](/gg/responses-as-code/) the sandbox could not run to a result — a fuel or memory ceiling. |
| `code-not-a-program.hbs` | The turn feedback for a reply that was not a program at all — prose, empty, comments only, or several candidate blocks. |
| `healing-note.hbs`  | The partial at the top of all four code feedback templates, disclosing what [healing](/gg/response-healing/) repaired. |

## The system prompt is assembled from the capability set

gg's whole premise is that capabilities are independently toggleable, and that extends
to the prompt: **a capability that is off contributes no prompt text at all**. That is
what makes an [ablation](/gg/overview/#the-capability-set) clean — the off arm's model
is never told about a feature it does not have.

So `system.hbs` is one `{{#if}}` section per capability, over a rendering context that
carries both _whether_ each capability is on and _how it is configured_. A run's actual
limits are interpolated inline rather than restated in prose:

- the `read_file` [line cap](/gg/filesystem/#read-modes), and whether it is a hard
  ceiling or a default the agent may exceed;
- the [memories](/gg/memories/) budget (count, per-memory length, total length);
- the [task](/gg/tasks/) count ceiling;
- the [Project management](/gg/project-management/) epic and issue ceilings;
- the name of the [FSM](/gg/fsms/) driving the run;
- the catalog of available [skills](/gg/skills/), each with its description.

The rendering context is a typed Rust struct (`prompts::SystemContext`), and rendering
runs in **strict mode**: a template that references a variable the context does not
carry fails rather than silently rendering a blank. The struct is therefore the
documented list of what a template may reference, and the crate's tests render every
template with the capability sections both on and off — so a typo in a `.hbs` file fails
the build instead of reaching a model.

Because the prompt is one file, editing it is editing prose: rewording the tasks section,
reordering the capability sections, or tightening the base framing needs no Rust change.

## The code-mode arm teaches a different contract

[Responses as code](/gg/responses-as-code/) replaces the base framing's ending rule as
well as its tool listing, so `system.hbs` renders one of two whole arms. The code arm
teaches four things the tool-calling arm has no need of, and each is gated on something
about the run:

- **What a reply *is*.** The model's whole reply is the program: no fence, no language
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
- **How the run ends**: `finish(summary)`, and nothing else. The signature and its
  documentation are interpolated from the sandbox's own catalogue, like every tool
  signature, and the section is gated on the run being in code mode at all — a
  tool-calling run can never be shown a function it has no way to call.
- **Whose ending it is**, gated on whether the agent is a **delegated** worker rather than
  the run's root. A subagent renders this same prompt, and a model told "this ends the
  run" while it is a delegated worker has a strong reason not to call it — and a worker
  that never calls it never returns the verdict a [code review](/gg/code-reviews/) or a
  [speculation](/gg/speculative-execution/) judge is waiting for. The same fix runs
  through the briefs gg generates for those roles: in code mode they ask for a `finish`
  call rather than for a final message.

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
