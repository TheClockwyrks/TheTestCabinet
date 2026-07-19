---
title: Creating an End-to-End Variant
---

An [end-to-end](/testing/end-to-end/overview/) test case version offers one or
more [variants](/testing/end-to-end/overview/#variants), and a run selects exactly
one. Every variant seeds the version's **common specs** plus its own **additive**
specs, so a single case can describe several builds — the same game with or
without an extra mode, say — without duplicating the shared specification. The
chosen variant's slug is recorded in the run record, so every result is
attributed to a specific build.

This guide is the full procedure for adding a variant to an **existing**
end-to-end version. The authoritative rules live in
[End-to-End Tests](/testing/end-to-end/overview/) (see its *Variants* and
*Self-Contained Specifications* sections); read them first. The worked example is
the **Gyre** variant of the `carom` case, in which the obstacles oscillate and
rotate — read the existing `frenzy`, `multi`, and `gyre` mode specs alongside this
guide.

The editorial rules in
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
apply to a variant's specs as much as to the common ones. One of them matters
especially here: a variant's seeded specs must never mention the other variants,
because a run only ever receives the one it selected.

To author a brand-new case rather than add a mode to one, see
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/).
To add a variant to an [asset-generation](/testing/asset-generation/overview/)
case instead, see
[Creating a Single-Sprite Variant](/guides/authoring/creating-a-sprite-variant/) or
[Creating a Sprite-Sheet Variant](/guides/authoring/creating-a-sprite-sheet-variant/)
(pick by the case's `asset_kind`) — there a variant varies the drawing brief
against a shared target, not a game mode.

## What a variant adds

A variant typically adds **one** mode spec and (where the menu differs) **one**
`title` mockup, lives in its **own file** under `variants/`, and is listed in the
`variants` array in `test-case.toml`. Everything else is shared. A variant's
`spec` and `reference` entries are **additive** — they layer on top of the common
ones rather than replacing them — and a variant may declare its **own scoring
domain** for the mode it introduces (rated only when it runs).

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
git-ignored `reference/.rendered/` cache (a media-based case instead commits its
captured screenshots under the tracked `reference/screenshots/`).

### 5. Create the variant file and list it

Write `variants/<slug>.toml` as a standalone TOML document whose **top-level keys
are the variant's fields**, then add its path to the `variants` array in
`test-case.toml` (the first entry is the default). Every path inside the variant
file resolves against the version folder, and `dest` defaults to `source` (a
trailing `.hbs` stripped), so most specs just name their `source`:

```toml
# variants/gyre.toml
slug = "gyre"
name = "Gyre"
description = "Standard plus a mode whose obstacles oscillate and rotate."
spec = [{ source = "specs/modes/gyre.md" }]
reference = [{ view = "title", path = "reference/menu-gyre.html" }]

# A mode a variant introduces is usually rated on its own domain rather than folded
# into the common ones. Declare it here, and roll the mode's review item up to it.
[[domain]]
id = "gyre"
name = "Gyre"
description = "The Gyre mode: swaying, rotating obstacles the ball bounces off at oriented angles."

[[review_item]]
id = "gyre-oriented-bounce"
title = "Oriented bounces"
text = "In Gyre the obstacles sway and rotate, and the ball bounces off their tilted faces at oriented angles."
weight = 1
domain = "gyre"
```

```toml
# test-cases/end-to-end/easy/carom/v1.0.0/test-case.toml — add the new file to the ordered list
variants = [
  "variants/base.toml",
  "variants/frenzy.toml",
  "variants/multi.toml",
  "variants/gyre.toml",
]
```

Rules enforced at resolution:

- `spec` entries are **additive** on the common specs; within one variant, no two
  seeded specs (common + own) may share a `dest`.
- `reference` entries are additive on the common `[[reference]]` views; a view
  slug must not be declared both commonly and by a variant.
- A variant's own `[[domain]]` tables are **additional** to the case's common
  domains; a domain id must be unique across the common domains and this variant's
  own. A variant's review item may name a common domain or one of its own, and may
  pair an expected `reference` view with a submitted `proof` (each must resolve for
  this variant).
- `[[proof]]` entries are additive on the common proofs — declare one only if this
  variant asks for evidence a standard mode doesn't. A proof `id` must be unique
  within the variant's effective set, and the seeded mode spec must instruct the
  build to write the file at that same `dest`.
- Any **checked** view (declared under `[[check]]`) must be supplied by *every*
  variant — for `carom`, every variant provides its own `title`, which is what the
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
that the menu mockup renders, and lint the specs with `npm run lint:specs`
(markdownlint + cspell; see [Building](/development/building/)). Then exercise it
with [Run a Test Case](/quickstarts/development/run-a-test-case/) — a backend that already
holds this version keeps serving the old definition until you **force a
re-ingest**, so re-ingest the case after adding the variant (see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/)).
