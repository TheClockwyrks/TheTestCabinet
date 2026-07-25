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
| `board.hbs`        | The pinned [epic/issue board](/gg/epics-and-issues/) block.                  |
| `memories.hbs`     | The pinned [memories](/gg/memories/) block.                                  |
| `plan-mode.hbs`    | The [planning](/gg/planning/) capability's read-only plan-mode guidance.     |
| `plan-framing.hbs` | How an accepted plan is framed as it seeds the fresh implementation context. |

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
- the [epic and issue](/gg/epics-and-issues/) ceilings;
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

## The pinned blocks carry state, not instructions

The [task list](/gg/tasks/), [board](/gg/epics-and-issues/), and
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
