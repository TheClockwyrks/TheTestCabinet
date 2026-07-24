---
title: "Multi-model"
---

[Subagents](/gg/subagents/) can be **dispatched using different models** — and, in
The Test Cabinet's case, **not necessarily from the same provider** as the parent.
Some third-party harnesses support multi-model in a limited, same-provider way; gg's
contribution is making it **cross-provider** and **slot-bound**, so it is a clean
experimental variable.

## Model slots

Model selection is expressed through **slots**. Rather than binding a single model
to the whole run, a [capability set](/gg/overview/#the-capability-set) binds models
to a small set of named **slots** (for example a `primary` slot and a `subagent`
slot, or role-specific slots like `planner`, `implementer`, `reviewer`).

- Capabilities reference models **by slot**, never by a hardcoded model ID. A
  subagent is dispatched "on the `reviewer` slot", not "on `claude-opus-4-8`".
- Slots are **bound at run configuration time** as part of the capability set, so a
  study can re-point a slot without touching any capability's logic.
- Slots may be bound to models from **different providers** — there is no
  requirement that every slot use the same vendor.

Model slots are the seam between the abstract "which agent uses which model"
question and the concrete provider/credentials plumbing, and they make questions
like "does using a cheaper model for subagents cost much accuracy?" a one-line
change to the capability set.

Because a single gg run spans **several models**, usage and cost are accounted **per
slot** (and per model within a slot), not as one figure for one model. This per-slot
accounting is also the concrete reason a gg run cannot be a single point on the
existing per-model metric graphs — there is no one model it belongs to — and hence
why gg results live in their own space (see
[Overview → How gg fits into The Test Cabinet](/gg/overview/#how-gg-fits-into-the-test-cabinet)).
