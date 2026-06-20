---
title: Create a Variant
---

Add a new playable [variant](/testing/end-to-end/overview/#variants) (a
mode/configuration) to an existing version. The full procedure, including the
self-containment rules, is in
[Creating a Test Case Variant](/guides/creating-a-test-case-variant/); the
`adding-a-variant` skill is the hands-on guide to follow.

A variant seeds the version's **common specs** plus its own **additive** specs,
so you describe only the delta — never duplicate the shared specification.

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
5. Register the variant in `test-case.toml`:

```toml
[[variant]]
slug = "gyre"
name = "Gyre"
description = "Standard plus a mode whose obstacles oscillate and rotate."
spec = [{ source = "specs/modes/gyre.md", dest = "specs/modes/gyre.md" }]
reference = [{ view = "title", path = "reference/menu-gyre.html" }]
```

`spec` and `reference` entries are additive. Within one variant no two seeded
specs may share a `dest`, and any [checked](/components/core/validation/#checks)
view must be supplied by **every** variant.

## Validate

```sh
tcab seed   --test-case <slug> --version <version> --variant <new-variant>
tcab prompt --test-case <slug> --version <version> --variant <new-variant>
```

Seed and render the **new** variant and re-check the **existing** ones to confirm
nothing else changed.
