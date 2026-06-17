---
title: Creating a Test Case Variant
---

A test case version offers one or more [variants](/components/core/test-cases/#variants),
and a run selects exactly one. Every variant seeds the version's **common specs**
plus its own **additive** specs, so a single case can describe several builds —
the same game with or without an extra mode, say — without duplicating the shared
specification. The chosen variant's slug is recorded in the run record, so every
result is attributed to a specific build.

This guide is the end-to-end procedure for adding a variant to an **existing**
version. The authoritative rules live in
[Test Cases](/components/core/test-cases/) (see its *Variants* and
*Self-Contained Specifications* sections); read them first. While doing the work,
follow the `adding-a-variant` skill. The worked example is the **Gyre** variant
of the `pong` case, in which the obstacles oscillate and rotate — read the
existing `frenzy`, `multi`, and `gyre` mode specs alongside this guide.

To author a brand-new case rather than add a mode to one, see
[Authoring a Test Case](/guides/authoring-a-test-case/).

## What a variant adds

A variant typically adds **one** mode spec and (where the menu differs) **one**
`title` mockup, and registers itself in `test-case.toml`. Everything else is
shared. A variant's `spec` and `reference` entries are **additive** — they layer
on top of the common ones rather than replacing them.

## Procedure

### 1. Choose the variant

Decide and keep consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the mode spec filename
  (e.g. `gyre`);
- **display name** — title case, the variant's `name` (e.g. `Gyre`);
- **menu label** — the upper-case main-menu entry (e.g. `GYRE`);
- **HUD / in-game label** — usually the same upper-case token.

Favor a single evocative word that matches the case's existing mode names.

### 2. Write the mode spec

Create `specs/modes/<slug>.md`, following the shape of the sibling mode specs:

- open by stating which common specs it builds on, by name;
- a **Menu entry** section saying which label it adds and where it sits;
- a **Mode** section describing the rules as a delta against an existing mode
  ("same as Solo, except …");
- whatever mechanic sections the variant needs, with **precise, testable
  numbers** (pixels, degrees, seconds, multipliers) in the same coordinate system
  and style as the common specs;
- the exact HUD label.

A variant spec **may** reference the common specs freely — they are always seeded
— but must **not** reference another variant's spec, because that variant is not
seeded when this one runs.

### 3. If you contradict a common spec, soften the common spec

Common specs are seeded for *every* variant, so a variant cannot simply ignore a
flat statement in one — the contradiction would ship to the model. When a new
variant overrides something a common spec asserts absolutely, generalize that
statement to **defer to the active mode spec**, exactly as the speed-cap rule
already does ("modes may override this; see the mode specs").

- Keep the change minimal and **generic**: refer to "a mode spec under
  `specs/modes/`", never to your new variant file by name. Naming a variant-only
  spec from a common spec would break self-containment for every *other* variant.
- Existing variants' behavior must not change — you are only widening wording
  from "never" to "unless a mode says so".

For Gyre this meant softening the "obstacles do not move" / "axis-aligned" /
"moving obstacles out of scope" statements in `playfield.md`, `physics.md`, and
`flow.md` to point at the mode specs, while `gyre.md` carries the actual moving,
rotating-obstacle rules.

### 4. Add the per-variant `title` mockup (if the menu differs)

The main menu usually differs per variant, so the `title` view is
variant-specific. Copy the closest sibling `reference/menu-<other>.html` to
`reference/menu-<slug>.html` and:

- update the comment block (variant name, modes listed, matching spec);
- insert the new menu entry in the right position;
- optionally tweak the dimmed field furniture to hint at the mechanic, but keep
  `theme.css`, layout, and palette unchanged.

These mockups are **source only**: the harness renders them to screenshots and
seeds the *screenshot*, never the HTML. Do not hand-create anything under the
git-ignored `reference/screenshots/`.

### 5. Register the variant in `test-case.toml`

Add a `[[variant]]` table after the existing ones (the first variant is the
default):

```toml
[[variant]]
slug = "gyre"
name = "Gyre"
description = "Standard plus a mode whose obstacles oscillate and rotate."
spec = [{ source = "specs/modes/gyre.md", dest = "specs/modes/gyre.md" }]
reference = [{ view = "title", path = "reference/menu-gyre.html" }]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- `reference` entries are additive on the common `[[reference]]` views; a view
  slug must not be declared both commonly and by a variant.
- Any **checked** view (declared under `[[check]]`) must be supplied by *every*
  variant — for `pong`, every variant provides its own `title`, which is what the
  `title` check baselines against.

Also update the human-readable comment in the manifest that enumerates the
variants so the list stays accurate.

## Validate your work

Seed and render the **new** variant, and re-check the **existing** ones to
confirm your common-spec edits changed nothing for them:

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Read the seeded output to confirm the new variant's set is self-contained and
that the menu mockup renders. Then exercise it with
[Run a Test Case](/quickstarts/run-a-test-case/).
