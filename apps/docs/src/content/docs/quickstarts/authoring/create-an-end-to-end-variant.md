---
title: Create an End-to-End Variant
---

Add a new playable [variant](/testing/end-to-end/overview/#variants) (a
mode/configuration) to an existing [end-to-end](/testing/end-to-end/overview/)
version. The full procedure, including the self-containment rules, is in
[Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/);
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
is the editorial rulebook the variant's specs must follow, including the rule
that they never mention the other variants.

A variant seeds the version's **common specs** plus its own **additive** specs,
so you describe only the delta — never duplicate the shared specification.

Adding a variant to an [asset-generation](/testing/asset-generation/overview/)
case instead? See
[Create a Single-Sprite Variant](/quickstarts/authoring/create-a-sprite-variant/) or
[Create a Sprite-Sheet Variant](/quickstarts/authoring/create-a-sprite-sheet-variant/)
(pick by the case's `asset_kind`) — there a variant varies the drawing brief, not
a game mode.

## Steps

1. Choose a consistent **slug** (`gyre`), **display name** (`Gyre`), and
   **menu/HUD label** (`GYRE`).
2. Write `specs/modes/<slug>.md`: state which common specs it builds on, the menu
   entry it adds, and its rules framed as a delta against an existing mode — with
   **precise, testable numbers**. It may reference common specs but **not**
   another variant's spec.
3. If the variant contradicts an absolute statement in a common spec, **soften
   the common spec** generically to defer to "a mode spec under `specs/modes/`"
   — never name your variant file from a common spec, and don't change existing
   variants' behavior.
4. If the menu differs, add a per-variant `title` mockup
   (`reference/menu-<slug>.html`) copied from a sibling; mockup source is never
   seeded.
5. Create `variants/<slug>.toml` (a standalone TOML file whose top-level keys are
   the variant's fields; `dest` defaults to `source`) and add its path to the
   `variants` list in `test-case.toml` (first = default):

```toml
# variants/gyre.toml
slug = "gyre"
name = "Gyre"
description = "Standard plus a mode whose obstacles oscillate and rotate."
spec = [{ source = "specs/modes/gyre.md" }]
reference = [{ view = "title", path = "reference/menu-gyre.html" }]

# A mode a variant introduces is usually rated on its own domain, layered on the
# case's common ones; roll the mode's review item up to it.
[[domain]]
id = "gyre"
name = "Gyre"
description = "The Gyre mode: swaying, rotating obstacles the ball bounces off at oriented angles."
```

`spec` and `reference` entries are additive; a variant's own `[[domain]]` tables
are additional to the common domains. Within one variant no two seeded specs may
share a `dest`, and any [checked](/components/core/validation/#checks) view must be
supplied by **every** variant.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm
nothing else changed.
